// MAYNE-37: browser-side faces for the candidate direct-edit idempotency
// contract (edit / discard / applyPreview) on top of the LOCKED D backend.
//
// The backend-side contract (same-key replay, 409 on changed bytes, restart
// replay) was accepted for candidate 8b6052b/tree 883930d on the real
// HTTP surface (MAYNE-33, review closure 01a1c942, 11/11) and is NOT redone
// here. This suite adds the layer those cases could not observe: the REAL
// compiled CandidateCard driving the REAL organizer store over the REAL
// WebApiClient in a real Chrome, against the locked backend over real HTTP.
//
// What each result layer means (stated per assertion, not globally):
//   - "browser DOM" — the production PairingGate + InboxView + CandidateCard
//     compiled by this tree's own vite pipeline (mount harness
//     candidate-operations-browser-page/), driven through its own click
//     handlers. No store injection.
//   - "browser HTTP" — the page's same-origin requests, captured at the CDP
//     Fetch layer and reverse-proxied to the locked backend with Host/Origin
//     rewritten (the same controlled transport the locked tree's response
//     dropper performs for the test-process client). Transport drops are CDP
//     failRequest: Request stage = never sent; Response stage = sent and
//     processed, response destroyed.
//   - "controlled model" — the bundled Pi organizer runs for real; its model
//     answers come from the controlled OpenAI-compatible service. No real
//     model, no real credential, no real user root.
//   - "database" — read-only observations (node:sqlite) on the backend's
//     synthetic root: candidate_operations ledger rows, candidate rows.
//
// Prerequisites (named, explicit — no fallbacks):
//   - MAYNE37_BACKEND_TREE: a checkout/worktree AT the locked backend commit
//     8b6052b5f54f3f4dff89e46a1a49bd852c7b68da with build/web-backend
//     (entry + storage binary) and build/s0-runtime prepared (npm ci,
//     probe:prepare-cli, probe:prepare-pi, probe:bundle, build:backend in
//     that tree). The suite hard-pins the commit identity.
//   - Chrome at the platform default path or SIDEKICK_TEST_CHROME.
//   - This tree's node_modules (npm ci --ignore-scripts) for the vite
//     pipeline. Case budget: 20000ms per case including cleanup; build and
//     backend startup live outside the cases (before hook).
//
// Data preparation (honest seed statement): every candidate/preview is a real
// HTTP seed through the real intake against the controlled model — no
// hand-placed database rows, and the database is only ever read.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  startCandidateBrowser, startHarnessPage, startPageDropper, chromeAvailable, resolveChrome, HARNESS_PAGE_PATH,
} from '../fixtures/web-text-intake/candidate-operations-browser.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const evidenceDir = join(repositoryRoot, 'build/mayne37-candidate-browser');
const LOCKED_BACKEND_COMMIT = '8b6052b5f54f3f4dff89e46a1a49bd852c7b68da';
const BACKEND_TREE = process.env.MAYNE37_BACKEND_TREE ? resolve(process.env.MAYNE37_BACKEND_TREE) : repositoryRoot;
const SYNTHETIC_KEY = 'synthetic-mayne37-browser-key-4e8c11';
const CREDENTIAL_REF = 'env:MAYNE37_BROWSER_SYNTHETIC_KEY';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CASE_BUDGET_MS = 20000;
const CASE_MARGIN_MS = 2000;
const caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS;
const waitWithin = (deadline, capMs) => Math.max(250, Math.min(capMs, deadline - Date.now()));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class PrerequisiteGap extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrerequisiteGap';
  }
}

function writeEvidence(name, payload) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, name), JSON.stringify(payload, null, 2) + '\n');
}

const isTerminal = (task) => ['succeeded', 'failed', 'cancelled'].includes(task.state);

let backendProcess, dbObserver, controlledModel, syntheticInputs, browserProbe;
let backend, model, harness, browser, pageDropper;
let backendRoot, scriptDir, profileDir, sourceIndex = 0;
let cleanupReport = {};

function writeModelConfig(root, baseUrl) {
  const configDir = join(root, 'config');
  mkdirSync(join(configDir, 'agents'), { recursive: true });
  writeFileSync(join(configDir, 'providers.json'), JSON.stringify({
    providers: [{
      id: 'controlled-openai',
      name: 'Controlled',
      enabled: true,
      apiFormat: 'openai-compatible',
      baseUrl,
      auth: { type: 'bearer', apiKeyRef: CREDENTIAL_REF },
    }],
  }, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(configDir, 'models.json'), JSON.stringify({
    models: [{
      id: 'controlled-organizer-model',
      providerId: 'controlled-openai',
      apiModelId: 'controlled-organizer-model',
      name: 'Controlled',
      enabled: true,
      capabilities: { toolCall: true },
    }],
    sidekick: { defaultModelId: 'controlled-organizer-model', revision: 'rev1' },
  }, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(configDir, 'agents', 'organizer.json'), JSON.stringify({
    version: 1,
    agentId: 'organizer',
    revision: 'agent-rev-1',
    modelId: null,
    preferences: { detail: 'concise', focus: 'followups' },
    supplementalInstructions: '保留核对依据，日期只给原文表达式。',
  }, null, 2) + '\n', { mode: 0o600 });
}

async function waitForTask(taskId, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    const response = await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie });
    assert.equal(response.status, 200, `GET /api/tasks/${taskId} must succeed; got ${response.status}: ${response.text}`);
    last = response.json.task ?? response.json;
    if (predicate(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(`task ${taskId} did not reach the expected state within ${timeoutMs}ms; last: ${JSON.stringify(last)}`);
    }
    await sleep(25);
  }
}

// Synthetic seed: one real source through the real HTTP intake (the controlled
// model drives the real bundled Pi organizer) producing one real pending
// candidate. Nothing is hand-placed into the database.
async function seedCandidate(deadline) {
  sourceIndex += 1;
  const submitted = await backend.request('POST', '/api/text-sources', {
    body: syntheticInputs.submitSourceBody({ text: syntheticInputs.queueText(sourceIndex) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(submitted.status, 200, submitted.text);
  await waitForTask(submitted.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const listed = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  assert.equal(listed.status, 200, listed.text);
  const candidate = listed.json.candidates.find((row) => row.status === 'pending') ?? listed.json.candidates[0];
  assert.ok(candidate, 'the extract task must produce a candidate');
  return candidate;
}

async function seedRevision(candidateId, deadline) {
  const revision = await backend.request('POST', `/api/candidates/${candidateId}/revisions`, {
    body: syntheticInputs.revisionBody({}), cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(revision.status, 200, revision.text);
  const runId = revision.json.task.taskId;
  await waitForTask(runId, isTerminal, waitWithin(deadline, 10000));
  return runId;
}

// Load the harness page: the real app mounts, the SSE spy installs, and the
// inbox renders at least one candidate card. The session was paired once in
// before(), so later loads go straight to the paired slot; the newest seeded
// source is also the only pending one, so the inbox selects it.
async function loadAppWithCard(deadline) {
  await browser.navigate(harness.origin + HARNESS_PAGE_PATH);
  assert.ok(await browser.waitForFunction(
    `document.querySelector('#candidate-operations-root')?.childElementCount > 0`,
    waitWithin(deadline, 9000),
  ), 'the production app must mount into the harness root');
  assert.ok(await browser.waitForFunction(
    `window.__m37 && window.__m37.ready`, waitWithin(deadline, 2000),
  ), 'the in-page probe must be installed');
  assert.ok(await browser.waitForFunction(
    `window.__m37configReady === true`, waitWithin(deadline, 6000),
  ), `the configuration stores must load for the action guard; got ${JSON.stringify(await browser.evaluate('window.__m37configError ?? null'))}`);
  // This case's observations start HERE: earlier cases' captures must never
  // leak into this case's counts or lookups.
  browser.resetObserved();
  assert.ok(await browser.waitForFunction(
    `window.__m37.cardCount() >= 1`, waitWithin(deadline, 8000),
  ), 'the seeded candidate card must render in the live DOM');
  return browser.evaluate('window.__m37.card()');
}

// The armed drop consumes asynchronously (the request must traverse the
// proxy chain); poll instead of racing a single read.
async function waitForDropperFired(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pageDropper.consumeReport().fired) return true;
    if (Date.now() >= deadline) return false;
    await sleep(25);
  }
}

const ledgerCount = (operationIdValue) => dbObserver.observe(backend.root, (db) => (
  db.prepare('SELECT count(*) AS n FROM candidate_operations WHERE operation_id=?').get(operationIdValue).n
));

// Wait until a candidate POST with this URL part is CAPTURED at the CDP layer
// (dropped or delivered). Delivered-only waits use waitForCandidatePost.
async function waitForCapturedPost(urlPart, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = browser.candidateRequests().filter((entry) => entry.method === 'POST' && entry.url.includes(urlPart)).at(-1);
    if (found) return found;
    if (Date.now() >= deadline) {
      throw new Error(`no captured candidate POST matching ${urlPart}; captured: ${JSON.stringify(browser.candidateRequests().map((entry) => ({ url: entry.url, stage: entry.stage, dropped: entry.dropped })))}`);
    }
    await sleep(50);
  }
}

async function waitForCandidatePost(urlPart, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = browser.candidatePosts().filter((entry) => entry.url.includes(urlPart) && !entry.dropped).at(-1);
    if (found) return found;
    if (Date.now() >= deadline) {
      throw new Error(`no delivered candidate POST matching ${urlPart}; captured: ${JSON.stringify(browser.candidateRequests().map((entry) => ({ url: entry.url, stage: entry.stage, dropped: entry.dropped })))}`);
    }
    await sleep(50);
  }
}

// Same, but bounded BELOW by a captured count: for a repeated URL the caller
// pins how many matching posts existed before the click, so this helper can
// never hand back an older entry.
async function waitForNewCandidatePost(urlPart, minCount, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const matches = browser.candidatePosts().filter((entry) => entry.url.includes(urlPart) && !entry.dropped);
    if (matches.length > minCount) return matches.at(-1);
    if (Date.now() >= deadline) {
      const diag = await browser.evaluate('window.__m37.diag ? window.__m37.diag() : null').catch(() => null);
      throw new Error(`no NEW delivered candidate POST matching ${urlPart} beyond ${minCount}; captured: ${JSON.stringify(browser.candidateRequests().map((entry) => ({ url: entry.url, stage: entry.stage, dropped: entry.dropped })))}; card=${JSON.stringify(await browser.evaluate('window.__m37.card()'))}; store=${JSON.stringify(diag)}`);
    }
    await sleep(50);
  }
}

// Wait until the STORE's authoritative copy of this candidate carries the
// expected version — every refresh-triggered draft sync (including the stale
// flag) has then already run, so the stale reload decision is not racing an
// in-flight read-back.
// The locked backend's batch read carries PENDING candidates only
// (text-intake-service getSource, status:'pending'), so once a discard
// commits the card either still renders its pre-refresh pill or has already
// left the batch entirely — both are the authoritative read-back. The store
// and the database carry the verifiable truth.
async function waitForStoreCandidateStatus(status, deadline) {
  assert.ok(await browser.waitForFunction(
    `window.__m37.diag() && window.__m37.diag().candidates.some((row) => row.status === ${JSON.stringify(status)})`,
    waitWithin(deadline, 6000),
  ), `the store's candidate must reach ${status}; got ${JSON.stringify(await browser.evaluate('window.__m37.diag()'))}`);
}

async function waitForDiscardConvergence(deadline) {
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().pill === '已丢弃' || window.__m37.cardCount() === 0`,
    waitWithin(deadline, 6000),
  ), `the discard must converge (pill or batch drop); got card=${JSON.stringify(await browser.evaluate('window.__m37.card()'))} store=${JSON.stringify(await browser.evaluate('window.__m37.diag()'))}`);
}

async function waitForStoreCandidateVersion(expectedVersion, deadline) {
  assert.ok(await browser.waitForFunction(
    `window.__m37.diag() && window.__m37.diag().candidates.some((row) => row.version === ${expectedVersion})`,
    waitWithin(deadline, 6000),
  ), `the store's candidate must settle at version ${expectedVersion}; got ${JSON.stringify(await browser.evaluate('window.__m37.diag()'))}`);
}

// The product's own stale flow: a committed mutation while the draft was
// dirty flags the card ('这条候选已有更新，未保存输入仍保留。') and offers
// 重新载入候选 — the honest browser path before further edits.
async function reloadIfStale(deadline) {
  const card = await browser.evaluate('window.__m37.card()');
  if (String(card.alert).includes('这条候选已有更新')) {
    const click = await browser.evaluate(`window.__m37.clickButton('重新载入候选')`);
    assert.equal(click.ok, true, JSON.stringify(click));
    assert.ok(await browser.waitForFunction(
      `window.__m37.card().alert === ''`, waitWithin(deadline, 4000),
    ), `the stale flag must clear after the reload; got ${JSON.stringify(await browser.evaluate('window.__m37.card()'))}`);
  }
}

// After a failed mutation the saving flag settles slightly after the error
// text renders; the next click must wait for the two action buttons, not just
// for the error. (生成修改预览 is legitimately disabled without an
// instruction and is not part of this check.)
async function waitForButtonsEnabled(deadline) {
  assert.ok(await browser.waitForFunction(
    `window.__m37.cardCount() === 0 || window.__m37.card().buttons`
    + `.filter((button) => button.label === '保存候选修改' || button.label === '丢弃这条')`
    + `.every((button) => !button.disabled)`,
    waitWithin(deadline, 4000),
  ), 'the action buttons must re-enable after the failed mutation settles');
}

before(async () => {
  if (!chromeAvailable()) {
    throw new PrerequisiteGap(`Chrome not found at ${resolveChrome()}; set SIDEKICK_TEST_CHROME`);
  }
  const head = execFileSync('git', ['-C', BACKEND_TREE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (process.env.MAYNE37_BACKEND_TREE) assert.equal(head, LOCKED_BACKEND_COMMIT);
  const fixtureURL = (name) => pathToFileURL(join(BACKEND_TREE, 'tests/fixtures/web-text-intake', name)).href;
  backendProcess = await import(fixtureURL('backend-process.mjs'));
  dbObserver = await import(fixtureURL('db-observer.mjs'));
  controlledModel = await import(fixtureURL('controlled-model.mjs'));
  syntheticInputs = await import(fixtureURL('synthetic-inputs.mjs'));
  browserProbe = await import(fixtureURL('browser-probe.mjs'));

  const runtimeRoot = backendProcess.runtimeRootAvailable() ? backendProcess.bundledRuntimeRoot : undefined;
  const credentialProvider = backendProcess.createControlledCredentialProvider({
    [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
  });
  // A caller-supplied root survives close(), so the database observations and
  // the whole suite stay on one synthetic root.
  backendRoot = mkdtempSync(join(tmpdir(), 'mayne37-candidate-browser-'));
  backend = await backendProcess.startBackend({ root: backendRoot, runtimeRoot, credentialProvider });
  writeEvidence('effective-config.json', backendProcess.effectiveConfig({
    suite: 'web-text-intake-candidate-operations-browser',
    backendCommit: head,
    backendTree: BACKEND_TREE,
    runtimeRoot: runtimeRoot ?? null,
    credentialRef: CREDENTIAL_REF,
  }));
  scriptDir = join(backend.root, 'model-script');
  const script = controlledModel.writeScript(scriptDir, [
    { repeat: true, match: { userTextIncludes: '整理合成队列输入' }, kind: 'sse', content: controlledModel.reviseAnswer() },
    { repeat: true, kind: 'sse', content: controlledModel.queueExtractAnswer() },
  ]);
  model = await controlledModel.startControlledModelService({ script, record: join(backend.root, 'model.jsonl') });
  writeModelConfig(backend.root, model.url);

  // startBackend already pairs the HTTP client with the startup code
  // (shouldPair default true), which also issues the NEXT one-time code.
  // That second code goes to the real page's own pairing form.
  const browserCode = await backend.receivePairingCode(1);

  // The page's /api traffic traverses the one-shot page-traffic dropper (a
  // pass-through proxy that can destroy exactly one armed response); the
  // response-drop faces arm it and every other request passes untouched.
  pageDropper = await startPageDropper(backend.origin);
  harness = await startHarnessPage({ backendOrigin: pageDropper.origin });
  profileDir = mkdtempSync(join(tmpdir(), 'mayne37-browser-chrome-'));
  browser = await startCandidateBrowser({ profileDir, workDeadline: Date.now() + 20000 });

  // First load: the real PairingGate shows the gate; the code is typed into
  // the product's own form (the code never enters a URL or a log).
  await browser.navigate(harness.origin + HARNESS_PAGE_PATH);
  assert.ok(await browser.waitForFunction(
    `document.querySelector('#candidate-operations-root')?.childElementCount > 0`, 12000,
  ), 'the production app must mount into the harness root');
  const paired = await browserProbe.pairInPage(browser.evaluate, browserCode);
  assert.equal(paired.ok, true, `the real page must pair through its own form: ${JSON.stringify(paired)}`);
  writeEvidence('browser-session.json', {
    paired: paired.ok,
    pageOrigin: harness.origin,
    backendOrigin: backend.origin,
    note: 'the pairing code itself never leaves the onPairingCode channel and this request body',
  });
}, { timeout: 120000 });

after(async () => {
  if (browser) cleanupReport.browser = await browser.close();
  if (harness) cleanupReport.harness = await harness.close();
  if (pageDropper) await pageDropper.close();
  await model?.stop();
  await backend?.close();
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
  if (backendRoot) rmSync(backendRoot, { recursive: true, force: true });
  writeEvidence('cleanup.json', {
    ...cleanupReport,
    chromeExitConfirmed: cleanupReport.browser?.exitConfirmed === true,
    note: 'chrome SIGKILL confirmed, vite/http listeners closed, controlled model stopped, backend closed, synthetic root and chrome profile removed',
  });
});

test('browser DOM: the compiled card drives the save path with the operationId in the real request body', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  // Every case opens its own browser window: the shared session's startup
  // deadline must not be inherited by later cases.
  browser.deadline = deadline;
  const candidate = await seedCandidate(deadline);

  const card = await loadAppWithCard(deadline);
  assert.equal(card.pill, '未签收', 'the seeded pending candidate renders as 未签收');
  const labels = card.buttons.map((button) => button.label);
  assert.ok(labels.includes('保存候选修改'), `the save button must be present: ${JSON.stringify(labels)}`);
  assert.ok(labels.includes('丢弃这条'), `the discard button must be present: ${JSON.stringify(labels)}`);

  // 保存候选修改 through the real DOM: fill the title input, click, observe.
  const fill = await browser.evaluate(`window.__m37.fillTitle('浏览器改的标题')`);
  assert.equal(fill.ok, true, JSON.stringify(fill));
  const click = await browser.evaluate(`window.__m37.clickButton('保存候选修改')`);
  assert.equal(click.ok, true, JSON.stringify(click));
  const savePost = await waitForCandidatePost('/edits', waitWithin(deadline, 6000));
  const saveBody = JSON.parse(savePost.postData);
  assert.match(savePost.url, new RegExp(`/api/candidates/${candidate.candidateId}/edits$`), savePost.url);
  assert.match(saveBody.operationId, UUID_V4, `the browser-generated operationId must be a UUID: ${saveBody.operationId}`);
  assert.equal(saveBody.expectedVersion, candidate.version);
  assert.equal(saveBody.input.title, '浏览器改的标题');
  assert.equal(typeof saveBody.timeReviewed, 'boolean');

  // The read-back converges the card (mutation sync + refresh), the ledger
  // holds exactly one row for the key, and the version advanced exactly once.
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().title === '浏览器改的标题'`, waitWithin(deadline, 6000),
  ), `the card must show the saved title; got ${JSON.stringify(await browser.evaluate('window.__m37.card()'))}`);
  const row = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.version, candidate.version + 1, 'the edit must consume exactly one version');
  assert.equal(JSON.parse(row.fields_json).title, '浏览器改的标题');
  assert.equal(ledgerCount(saveBody.operationId), 1, 'exactly one ledger row for the browser key');
  writeEvidence('case1-dom-save.json', { candidateId: candidate.candidateId, savePost, card: await browser.evaluate('window.__m37.card()') });

  // Retire the candidate so no earlier source stays pending: every later case
  // (and any reload) then deterministically selects its own fresh source.
  await waitForStoreCandidateVersion(candidate.version + 1, deadline);
  await reloadIfStale(deadline);
  await browser.evaluate(`window.__m37.clickButton('丢弃这条')`);
  await waitForDiscardConvergence(deadline);
  const retired = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(retired.status, 'discarded');
  assert.equal(retired.version, candidate.version + 2, 'the retirement discard consumes exactly one version');
});

test('same-intent retry reuses the original operationId across an intervening different action', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  // Every case opens its own browser window: the shared session's startup
  // deadline must not be inherited by later cases.
  browser.deadline = deadline;
  const candidate = await seedCandidate(deadline);
  await loadAppWithCard(deadline);

  // Transport failure #1: the discard never leaves the browser (Request-stage
  // failRequest — controlled transport; nothing reaches the backend).
  browser.dropNext('/discard', { stage: 'request' });
  const discard1 = await browser.evaluate(`window.__m37.clickButton('丢弃这条')`);
  assert.equal(discard1.ok, true, JSON.stringify(discard1));
  const discardPost1 = await waitForCapturedPost('/discard', waitWithin(deadline, 6000));
  assert.equal(discardPost1.dropped, true, 'the first discard must fail at the controlled transport');
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().error !== ''`, waitWithin(deadline, 5000),
  ), 'the transport failure must surface as card error feedback');
  assert.equal(await browser.evaluate(`window.__m37.card().pill`), '未签收', 'the candidate must stay pending after the failed send');
  await waitForButtonsEnabled(deadline);

  // Intervening different action, also failing at transport: under a single
  // shared signature slot this would silently destroy the discard identity.
  browser.dropNext('/edits', { stage: 'request' });
  const save = await browser.evaluate(`window.__m37.clickButton('保存候选修改')`);
  assert.equal(save.ok, true, JSON.stringify(save));
  const savePost = await waitForCapturedPost('/edits', waitWithin(deadline, 6000));
  assert.equal(savePost.dropped, true, 'the intervening save must fail at the controlled transport too');
  await waitForButtonsEnabled(deadline);

  // Same-intent retry: identical canonical request (same action, same
  // candidate, same expectedVersion) — must reuse the FIRST key, not mint a
  // new one.
  const discard2 = await browser.evaluate(`window.__m37.clickButton('丢弃这条')`);
  assert.equal(discard2.ok, true, JSON.stringify(discard2));
  const discardPost2 = await waitForCandidatePost('/discard', waitWithin(deadline, 6000));
  const body1 = JSON.parse(discardPost1.postData);
  const body2 = JSON.parse(discardPost2.postData);
  assert.equal(body1.operationId, body2.operationId,
    `the same-intent retry must reuse the original operationId: ${body1.operationId} vs ${body2.operationId}`);
  assert.deepEqual(body1, body2, 'the retried request must carry identical canonical bytes');
  const saveBody = JSON.parse(savePost.postData);
  assert.notEqual(saveBody.operationId, body1.operationId, 'a different action keeps a different key');

  // The delivered retry applies once; the never-sent earlier attempts hold no
  // ledger rows.
  await waitForDiscardConvergence(deadline);
  const row = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.version, candidate.version + 1, 'exactly one discard applied');
  assert.equal(ledgerCount(body1.operationId), 1);
  assert.equal(ledgerCount(saveBody.operationId), 0, 'the never-sent save must hold no ledger row');
  writeEvidence('case2-same-intent-retry.json', { candidateId: candidate.candidateId, discardPost1, discardPost2, savePost });
});

test('changed intent mints a new key, and a verbatim replay of a captured browser body converges to the current state', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  // Every case opens its own browser window: the shared session's startup
  // deadline must not be inherited by later cases.
  browser.deadline = deadline;
  const candidate = await seedCandidate(deadline);
  await loadAppWithCard(deadline);

  await browser.evaluate(`window.__m37.fillTitle('意图甲的标题')`);
  const countA = browser.candidatePosts().filter((entry) => entry.url.includes('/edits')).length;
  await browser.evaluate(`window.__m37.clickButton('保存候选修改')`);
  const postA = await waitForNewCandidatePost('/edits', countA, waitWithin(deadline, 6000));
  const bodyA = JSON.parse(postA.postData);
  assert.ok(await browser.waitForFunction(`window.__m37.card().title === '意图甲的标题'`, waitWithin(deadline, 6000)));
  await waitForStoreCandidateVersion(candidate.version + 1, deadline);
  await reloadIfStale(deadline);

  await browser.evaluate(`window.__m37.fillTitle('意图乙的标题')`);
  const countB = browser.candidatePosts().filter((entry) => entry.url.includes('/edits')).length;
  await browser.evaluate(`window.__m37.clickButton('保存候选修改')`);
  const postB = await waitForNewCandidatePost('/edits', countB, waitWithin(deadline, 6000));
  const bodyB = JSON.parse(postB.postData);
  assert.notEqual(bodyB.operationId, bodyA.operationId, 'a genuinely changed edit must mint a new key');
  assert.equal(bodyB.expectedVersion, candidate.version + 1, 'the new key tracks the changed canonical request');
  assert.ok(await browser.waitForFunction(`window.__m37.card().title === '意图乙的标题'`, waitWithin(deadline, 6000)));
  await waitForStoreCandidateVersion(candidate.version + 2, deadline);
  await reloadIfStale(deadline);

  // Verbatim replay of body A from the page: same key, same bytes — the
  // ledger replays the CURRENT authoritative state without consuming a
  // version.
  const replay = await browser.evaluate(
    `window.__m37.pageFetch('/api/candidates/${candidate.candidateId}/edits', ${JSON.stringify(bodyA)}, ${JSON.stringify(browser.lastCsrfToken())})`,
  );
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.equal(replay.json.candidate.version, candidate.version + 2, 'the replay must not consume a version');
  assert.equal(replay.json.candidate.fields.title, '意图乙的标题', 'the replay answers the current authoritative state');
  const row = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.version, candidate.version + 2);
  assert.equal(ledgerCount(bodyA.operationId), 1, 'the replay adds no ledger row');
  assert.equal(ledgerCount(bodyB.operationId), 1);

  // Retire the candidate so no earlier source stays pending: every later case
  // (and any reload) then deterministically selects its own fresh source.
  await browser.evaluate(`window.__m37.clickButton('丢弃这条')`);
  await waitForDiscardConvergence(deadline);
  const retired = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(retired.status, 'discarded');
  assert.equal(retired.version, candidate.version + 3, 'the retirement discard consumes exactly one version');
  writeEvidence('case3-replay-converges.json', { candidateId: candidate.candidateId, postA, postB, replay });
});

test('unknown response read-back: a discarded-response discard converges the card via SSE with no automatic resend, and a reload reads authority first', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  // Every case opens its own browser window: the shared session's startup
  // deadline must not be inherited by later cases.
  browser.deadline = deadline;
  const candidate = await seedCandidate(deadline);
  await loadAppWithCard(deadline);
  const postsBefore = browser.candidatePosts().length;

  // Response drop at the page's proxy hop: the request reaches the locked
  // backend and commits; the page never sees status or body (the locked
  // tree's dropper semantics, one-shot and targeted).
  pageDropper.dropNext('/discard');
  await browser.evaluate(`window.__m37.clickButton('丢弃这条')`);
  const droppedPost = await waitForCapturedPost('/discard', waitWithin(deadline, 6000));
  assert.equal(droppedPost.dropped, false, 'the CDP capture must show the request DELIVERED (the drop happens below it)');
  assert.equal(await waitForDropperFired(), true, 'the one-shot page-traffic dropper must have consumed the arm');
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().error !== ''`, waitWithin(deadline, 5000),
  ), 'the transport failure must surface as card error feedback');
  const dropOp = JSON.parse(droppedPost.postData).operationId;
  const commitDeadline = Date.now() + waitWithin(deadline, 6000);
  for (;;) {
    if (ledgerCount(dropOp) === 1) break;
    if (Date.now() >= commitDeadline) throw new Error('the dropped discard did not commit');
    await sleep(50);
  }

  // The candidate.changed hint reaches the page; PairingGate routes it to
  // organizer.refresh(); the pending-only batch read then drops the card —
  // WITHOUT any new candidate POST (no auto-resend, no new-key resend).
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().pill === '已丢弃' || window.__m37.cardCount() === 0`, waitWithin(deadline, 8000),
  ), `the card must converge via the SSE read-back; got card=${JSON.stringify(await browser.evaluate('window.__m37.card()'))} store=${JSON.stringify(await browser.evaluate('window.__m37.diag()'))}`);
  // The convergence itself is the hint proof: only the pairing store's
  // candidate.changed routing could have re-read the authoritative state,
  // because the page's own write failed at the transport.
  assert.equal(browser.candidatePosts().length, postsBefore + 1, 'no candidate POST may fire beyond the single dropped discard');
  const row = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.status, 'discarded');
  assert.equal(row.version, candidate.version + 1, 'exactly one version consumed');

  // Reload: the app reads the authoritative state first and performs ZERO
  // candidate writes on load — a lost request identity must never auto-resend.
  const writesBeforeReload = browser.candidatePosts().length;
  await browser.navigate(harness.origin + HARNESS_PAGE_PATH);
  assert.ok(await browser.waitForFunction(
    `document.querySelector('#candidate-operations-root')?.childElementCount > 0`, waitWithin(deadline, 8000),
  ));
  // The authoritative state after the reload: NOTHING pending for this
  // source (the locked backend's batch read carries pending rows only), so
  // the inbox renders no card at all — and the load performed ZERO candidate
  // writes. A lost request identity must never auto-resend with a new key.
  assert.ok(await browser.waitForFunction(
    `window.__m37.cardCount() === 0`, waitWithin(deadline, 8000),
  ), `the reloaded inbox must hold no pending card; got cardCount=${JSON.stringify(await browser.evaluate('window.__m37.cardCount()'))} store=${JSON.stringify(await browser.evaluate('window.__m37.diag()'))}`);
  await sleep(500);
  assert.equal(browser.candidatePosts().length, writesBeforeReload,
    `the reload must issue no candidate writes; got ${JSON.stringify(browser.candidatePosts().slice(writesBeforeReload))}`);
  writeEvidence('case4-unknown-response-readback.json', { candidateId: candidate.candidateId, droppedPost });
});

test('applyPreview browser path: real revision preview, real apply through the card, verbatim replay converges', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  // Every case opens its own browser window: the shared session's startup
  // deadline must not be inherited by later cases.
  browser.deadline = deadline;
  const candidate = await seedCandidate(deadline);
  const runId = await seedRevision(candidate.candidateId, deadline);
  await loadAppWithCard(deadline);

  const cardBefore = await browser.evaluate('window.__m37.card()');
  assert.equal(cardBefore.preview, '班班的修改预览', `the revision preview must render: ${JSON.stringify(cardBefore)}`);
  const click = await browser.evaluate(`window.__m37.clickButton('应用到候选')`);
  assert.equal(click.ok, true, JSON.stringify(click));
  const applyPost = await waitForCandidatePost('/previews/', waitWithin(deadline, 6000));
  assert.match(applyPost.url, new RegExp(`/api/candidates/${candidate.candidateId}/previews/${runId}/apply$`), applyPost.url);
  const applyBody = JSON.parse(applyPost.postData);
  assert.match(applyBody.operationId, UUID_V4);
  assert.equal(applyBody.expectedVersion, candidate.version);

  // Applying a preview merges its draft INTO the candidate: the version
  // advances, the preview is consumed (its apply button disappears), and the
  // candidate stays pending — sign-off is the separate batch flow.
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().buttons.every((button) => button.label !== '应用到候选')`, waitWithin(deadline, 6000),
  ), `the preview must be consumed after the apply; got ${JSON.stringify(await browser.evaluate('window.__m37.card()'))}`);
  assert.equal(await browser.evaluate('window.__m37.card().pill'), '未签收');
  const row = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.status, 'pending');
  assert.equal(row.version, candidate.version + 1);
  assert.equal(ledgerCount(applyBody.operationId), 1);

  const replay = await browser.evaluate(
    `window.__m37.pageFetch('/api/candidates/${candidate.candidateId}/previews/${runId}/apply', ${JSON.stringify(applyBody)}, ${JSON.stringify(browser.lastCsrfToken())})`,
  );
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.equal(replay.json.candidate.version, candidate.version + 1, 'the replay must not consume a version');
  assert.equal(ledgerCount(applyBody.operationId), 1, 'the replay adds no ledger row');

  // Retire the candidate so no earlier source stays pending: every later case
  // (and any reload) then deterministically selects its own fresh source.
  await browser.evaluate(`window.__m37.clickButton('丢弃这条')`);
  await waitForDiscardConvergence(deadline);
  const retired = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(retired.status, 'discarded');
  assert.equal(retired.version, candidate.version + 2, 'the retirement discard consumes exactly one version');
  writeEvidence('case5-apply-preview.json', { candidateId: candidate.candidateId, runId, applyPost, replay });
});

test('applyPreview unknown response: a response-dropped apply commits once and the card converges via SSE with no resend', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  // Every case opens its own browser window: the shared session's startup
  // deadline must not be inherited by later cases.
  browser.deadline = deadline;
  const candidate = await seedCandidate(deadline);
  const runId = await seedRevision(candidate.candidateId, deadline);
  await loadAppWithCard(deadline);
  const postsBefore = browser.candidatePosts().length;

  pageDropper.dropNext('/previews/');
  const titleBefore = (await browser.evaluate('window.__m37.card()')).title;
  await browser.evaluate(`window.__m37.clickButton('应用到候选')`);
  const droppedApply = await waitForCapturedPost('/previews/', waitWithin(deadline, 6000));
  assert.equal(await waitForDropperFired(), true, 'the one-shot page-traffic dropper must have consumed the arm');
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().error !== ''`, waitWithin(deadline, 5000),
  ), 'the transport failure must surface as card error feedback');
  const applyOp = JSON.parse(droppedApply.postData).operationId;
  const commitDeadline = Date.now() + waitWithin(deadline, 6000);
  for (;;) {
    if (ledgerCount(applyOp) === 1) break;
    if (Date.now() >= commitDeadline) throw new Error('the dropped apply did not commit');
    await sleep(50);
  }
  // The candidate.changed hint drives the read-back: the merged preview
  // fields render (title changes) with NO further candidate POST.
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().title !== ${JSON.stringify(titleBefore)}`, waitWithin(deadline, 8000),
  ), `the card must converge via the SSE read-back; got ${JSON.stringify(await browser.evaluate('window.__m37.card()'))}`);
  assert.equal(await browser.evaluate('window.__m37.card().pill'), '未签收', 'an applied preview keeps the candidate pending');
  assert.equal(browser.candidatePosts().length, postsBefore + 1, 'no candidate POST beyond the single dropped apply');
  const row = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.status, 'pending');
  assert.equal(row.version, candidate.version + 1, 'exactly one version consumed');
  writeEvidence('case6-apply-unknown-response.json', { candidateId: candidate.candidateId, runId, droppedApply });

  // Retire the candidate (its apply kept it pending) for the same selection
  // determinism as the other cases.
  await browser.evaluate(`window.__m37.clickButton('丢弃这条')`);
  await waitForDiscardConvergence(deadline);
  const retired = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(retired.status, 'discarded');
  assert.equal(retired.version, candidate.version + 2, 'the retirement discard consumes exactly one version');
});

test('negative controls from the page: same key with changed bytes is 409 idempotency_conflict; a fresh key with a stale version consumes no ledger row', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  // Every case opens its own browser window: the shared session's startup
  // deadline must not be inherited by later cases.
  browser.deadline = deadline;
  const candidate = await seedCandidate(deadline);
  await loadAppWithCard(deadline);

  await browser.evaluate(`window.__m37.fillTitle('负控基准标题')`);
  await browser.evaluate(`window.__m37.clickButton('保存候选修改')`);
  const post = await waitForCandidatePost('/edits', waitWithin(deadline, 6000));
  const body = JSON.parse(post.postData);
  assert.ok(await browser.waitForFunction(`window.__m37.card().title === '负控基准标题'`, waitWithin(deadline, 6000)));

  // Same key, changed bytes -> 409 idempotency_conflict, surfaced as the
  // frozen envelope to the page.
  const conflicted = await browser.evaluate(
    `window.__m37.pageFetch('/api/candidates/${candidate.candidateId}/edits', ${JSON.stringify({ ...body, input: { ...body.input, title: '另一个标题' } })}, ${JSON.stringify(browser.lastCsrfToken())})`,
  );
  assert.equal(conflicted.status, 409, JSON.stringify(conflicted));
  assert.equal(conflicted.json.contractVersion, 'web-api/2');
  assert.equal(conflicted.json.error?.code, 'idempotency_conflict');

  // Fresh key + stale expectedVersion -> 409 version_conflict and NO ledger
  // row (a refused guard consumes no key).
  const staleOp = randomUUID();
  const stale = await browser.evaluate(
    `window.__m37.pageFetch('/api/candidates/${candidate.candidateId}/edits', ${JSON.stringify({ operationId: staleOp, expectedVersion: candidate.version + 99, input: body.input, timeReviewed: body.timeReviewed })}, ${JSON.stringify(browser.lastCsrfToken())})`,
  );
  assert.equal(stale.status, 409, JSON.stringify(stale));
  assert.equal(stale.json.error?.code, 'version_conflict');
  assert.equal(ledgerCount(staleOp), 0, 'the refused request must consume no ledger row');
  assert.equal(ledgerCount(body.operationId), 1);
  const row = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.version, candidate.version + 1, 'the refused requests must not move the candidate');
  writeEvidence('case7-negative-controls.json', { candidateId: candidate.candidateId, conflicted, stale });
});

test('canonical-equivalent edits reuse the original operationId: title/owner whitespace and tag order/duplicates do not mint a new key', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  browser.deadline = deadline;
  const candidate = await seedCandidate(deadline);
  await loadAppWithCard(deadline);
  const { canonicalize, normalizeInput } = await import(pathToFileURL(join(BACKEND_TREE, 'server/lib/manual-items-service.mjs')).href);
  const canonicalOf = (body) => canonicalize({
    action: 'edit', candidateId: candidate.candidateId, expectedVersion: body.expectedVersion,
    input: normalizeInput(body.input), timeReviewed: Boolean(body.timeReviewed),
  });

  // First attempt: title/owner carry trailing whitespace and the tag list has
  // an empty entry and a duplicate. It never leaves the browser (Request-stage
  // failRequest — controlled transport), so the key is captured but no ledger
  // row exists yet.
  await browser.evaluate(`window.__m37.fillTitle('规范等价标题 ')`);
  await browser.evaluate(`window.__m37.fillOwner('负责人 ')`);
  await browser.evaluate(`window.__m37.fillTags('甲，乙，，甲')`);
  browser.dropNext('/edits', { stage: 'request' });
  const first = await browser.evaluate(`window.__m37.clickButton('保存候选修改')`);
  assert.equal(first.ok, true, JSON.stringify(first));
  const post1 = await waitForCapturedPost('/edits', waitWithin(deadline, 6000));
  assert.equal(post1.dropped, true, 'the first canonical-equivalent attempt must fail at the controlled transport');
  const body1 = JSON.parse(post1.postData);
  await waitForButtonsEnabled(deadline);

  // Second attempt: the SAME canonical request — the locked backend trims
  // title/owner and normalizeTags drops empty/duplicate entries — with the
  // whitespace and tag noise removed. The browser must reuse the first key.
  await browser.evaluate(`window.__m37.fillTitle('规范等价标题')`);
  await browser.evaluate(`window.__m37.fillOwner('负责人')`);
  await browser.evaluate(`window.__m37.fillTags('甲，乙')`);
  const second = await browser.evaluate(`window.__m37.clickButton('保存候选修改')`);
  assert.equal(second.ok, true, JSON.stringify(second));
  const post2 = await waitForCandidatePost('/edits', waitWithin(deadline, 6000));
  const body2 = JSON.parse(post2.postData);
  assert.equal(canonicalOf(body2), canonicalOf(body1),
    'the two wire bodies must canonicalize to the same server request');
  assert.equal(body2.operationId, body1.operationId,
    `canonical-equivalent edits must reuse the original operationId: ${body1.operationId} vs ${body2.operationId}`);
  assert.equal(body2.expectedVersion, candidate.version, 'the retry keeps the same expected version');

  // The delivered retry commits exactly once and the ledger holds one row.
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().title === '规范等价标题'`, waitWithin(deadline, 6000),
  ), `the card must show the normalized title; got ${JSON.stringify(await browser.evaluate('window.__m37.card()'))}`);
  await waitForStoreCandidateVersion(candidate.version + 1, deadline);
  await reloadIfStale(deadline);
  assert.equal(ledgerCount(body1.operationId), 1, 'exactly one ledger row for the reused key');
  const row1 = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(row1.version, candidate.version + 1, 'the reused-key retry consumes exactly one version');

  // A verbatim replay of the whitespace-bearing first body hits the same
  // ledger row: the server canonicalizes it to the stored request and replays
  // the current authoritative state without consuming a version.
  const replay = await browser.evaluate(
    `window.__m37.pageFetch('/api/candidates/${candidate.candidateId}/edits', ${JSON.stringify(body1)}, ${JSON.stringify(browser.lastCsrfToken())})`,
  );
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.equal(replay.json.candidate.version, candidate.version + 1, 'the replay must not consume a version');
  assert.equal(ledgerCount(body1.operationId), 1, 'the replay adds no ledger row');

  // Genuine change -> a new key (the negative control for the equivalence).
  await reloadIfStale(deadline);
  await waitForButtonsEnabled(deadline);
  await browser.evaluate(`window.__m37.fillTitle('真正不同的标题')`);
  // Count DELIVERED edits only: a dropped attempt must not inflate the base.
  const count = browser.candidatePosts().filter((entry) => entry.url.includes('/edits') && !entry.dropped).length;
  const thirdClick = await browser.evaluate(`window.__m37.clickButton('保存候选修改')`);
  assert.equal(thirdClick.ok, true, JSON.stringify(thirdClick));
  const post3 = await waitForNewCandidatePost('/edits', count, waitWithin(deadline, 6000));
  const body3 = JSON.parse(post3.postData);
  assert.notEqual(body3.operationId, body1.operationId, 'a genuinely changed edit must mint a new key');
  assert.equal(body3.expectedVersion, candidate.version + 1, 'the new key tracks the advanced version');
  assert.ok(await browser.waitForFunction(
    `window.__m37.card().title === '真正不同的标题'`, waitWithin(deadline, 6000),
  ));
  await waitForStoreCandidateVersion(candidate.version + 2, deadline);
  await reloadIfStale(deadline);
  assert.equal(ledgerCount(body3.operationId), 1, 'the new key holds exactly one ledger row');

  // Retire for selection determinism.
  await browser.evaluate(`window.__m37.clickButton('丢弃这条')`);
  await waitForDiscardConvergence(deadline);
  const retired = dbObserver.candidateRow(backend.root, candidate.candidateId);
  assert.equal(retired.status, 'discarded');
  assert.equal(retired.version, candidate.version + 3, 'the retirement discard consumes exactly one version');
  writeEvidence('case8-canonical-equivalence.json', { candidateId: candidate.candidateId, post1, post2, replay, post3 });
});

test('page-traffic dropper close releases a half-sent downstream request without external destruction', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  browser.deadline = deadline;
  const dropper = await startPageDropper(backend.origin);
  const client = createConnection(new URL(dropper.origin).port, '127.0.0.1');
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
  // Half a request head: the http.Server request handler never fires, so the
  // accepted socket is only visible at the connection layer.
  client.write('POST /api/candidates/cand_half/edits HTTP/1.1\r\nHost: 127.0.0.1\r\n');
  await sleep(150);
  let closed = false;
  try {
    closed = await Promise.race([
      dropper.close().then(() => true),
      sleep(2000).then(() => false),
    ]);
    assert.equal(closed, true, 'close() must finish without external socket destruction');
  } finally {
    client.destroy();
  }
  writeEvidence('case9-dropper-half-request.json', { closedWithoutExternalDestruction: closed });
});

test('page-traffic dropper close releases a silent upstream and an unfinished downstream request', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  browser.deadline = deadline;
  const silent = createServer(() => { /* accept and never respond */ });
  const silentSockets = new Set();
  silent.on('connection', (socket) => {
    silentSockets.add(socket);
    socket.on('close', () => silentSockets.delete(socket));
  });
  const upstreamConnected = new Promise((resolve) => silent.once('connection', resolve));
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const dropper = await startPageDropper(`http://127.0.0.1:${silent.address().port}`);
  const client = createConnection(new URL(dropper.origin).port, '127.0.0.1');
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
  client.write('POST /api/candidates/cand_silent/edits HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\n\r\n{}');
  await upstreamConnected;
  const half = createConnection(new URL(dropper.origin).port, '127.0.0.1');
  await new Promise((resolve, reject) => { half.once('connect', resolve); half.once('error', reject); });
  half.write('POST /api/candidates/cand_half/edits HTTP/1.1\r\nHost: 127.0.0.1\r\n');
  await sleep(150);
  let closed = false;
  try {
    closed = await Promise.race([
      dropper.close().then(() => true),
      sleep(2000).then(() => false),
    ]);
    assert.equal(closed, true, 'close() must release both the silent upstream and the half-sent request');
  } finally {
    client.destroy();
    half.destroy();
    for (const socket of silentSockets) socket.destroy();
    await new Promise((resolve) => silent.close(resolve));
  }
  writeEvidence('case10-dropper-silent-upstream.json', { closedWithoutExternalDestruction: closed });
});

test('per-case budget: a renewed browser window restores the full command budget after expiry', { timeout: CASE_BUDGET_MS }, async () => {
  const deadline = caseDeadline();
  browser.deadline = deadline;
  // Force the current window to expire: the next command must be bounded to
  // the 250ms floor (the defect's observable behavior).
  browser.deadline = Date.now() - 1000;
  await assert.rejects(
    browser.evaluate('new Promise(resolve => setTimeout(() => resolve("finished"), 500))'),
    /within 250ms/,
  );
  // A new case opens its own window: the same 500ms command now succeeds.
  browser.deadline = Date.now() + 5000;
  const renewed = await browser.evaluate('new Promise(resolve => setTimeout(() => resolve("finished"), 500))');
  assert.equal(renewed, 'finished');
  // Leave the shared session with a fresh window for any later case.
  browser.deadline = caseDeadline();
  writeEvidence('case11-per-case-budget.json', { renewed });
});
