// MAYNE-24 slice II (Kimi): same-origin static supply, packaged CLI default
// paths and the real-browser matrix for the W1 text-intake vertical (P2
// matrix T-14, contract §9.4/§11, frozen web-api/1 §2).
//
// Three evidence layers:
//   1. Static supply: the backend serves the REAL product dist
//      (build/web-backend/static from npm run build:backend) same-origin —
//      correct MIME, long cache for hashed assets, no cache for index.html,
//      SPA fallback to index.html, and no SPA fallback under /api. A synthetic
//      fixture root signs fixture mechanics only and is recorded as such; an
//      explicit root pointing at the repository design/ prototype is rejected
//      (contract §9.4 forbids design previews as acceptance).
//   2. Packaged CLI: the real packaged CLI
//      (build/web-backend/server/entries/web-backend-entry.mjs) is launched
//      with only --root/--init, proving the default artifact resolution
//      (storage binary, static root) in the packaged layout, then shut down
//      cleanly. The pairing code the CLI prints stays in this process.
//   3. Browser matrix: headless Chrome at 1440x1000 and 640x900 loads the
//      backend-served UI, pairs through the product's own pairing gate,
//      loses and re-establishes the session, refreshes, and drives the
//      text-intake entry. The deep journey (paste -> candidates visible in
//      the UI) asserts the intake entry is enabled in the served product UI;
//      at the base tree it is disabled with the accurate "未接通" state, which
//      fails explicitly — slice I enables it.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeControlledModelConfig } from '../fixtures/web-text-intake/model-config.mjs';
import { spawn } from 'node:child_process';
import {
  startBackend, repositoryRoot, resolveSuiteStaticRoot, resolveArtifacts,
  writeEvidence, effectiveConfig, createControlledCredentialProvider, pollUntil,
  runtimeRootAvailable, bundledRuntimeRoot, PrerequisiteGap,
} from '../fixtures/web-text-intake/backend-process.mjs';
import { buildSyntheticStaticRoot } from '../fixtures/web-text-intake/static-root.mjs';
import { chromeAvailable, probeWithChrome, assertColdStartReport, pairInPage, openIntakeEntry, submitIntakeText, writeManualItemInPage } from '../fixtures/web-text-intake/browser-probe.mjs';
import { startControlledModelService, writeScript, queueExtractAnswer } from '../fixtures/web-text-intake/controlled-model.mjs';
import { sourceRows, taskRow, taskByOperationId, candidateRows } from '../fixtures/web-text-intake/db-observer.mjs';
import { queueText } from '../fixtures/web-text-intake/synthetic-inputs.mjs';

const SYNTHETIC_KEY = 'synthetic-web-text-intake-key-7f3a9c';
const CREDENTIAL_REF = 'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY';
const TERMINAL = ['succeeded', 'failed', 'cancelled'];

// Frozen case budget: the ticket freezes 20000ms per case (the aggregate runs
// `node --test --test-timeout=20000`, the W1 value), so no case declares a
// larger budget of its own. Every wait inside a case derives from ONE per-case
// deadline — polling and cleanup together can never outlive it — and heavy
// preparation (backend/model startup, the packaged artifacts themselves) stays
// outside the timed case in the before hook / build chain, the sanctioned
// exception. Wait caps below are backstops for failure diagnosability; each is
// additionally bounded by the remaining time to the case deadline.
const CASE_BUDGET_MS = 20000;
const CASE_MARGIN_MS = 2000;
const caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS;
const timeLeft = (deadline) => Math.max(250, deadline - Date.now());
const waitWithin = (deadline, capMs) => Math.max(250, Math.min(capMs, deadline - Date.now()));
// The private pairing channel's wait for the NEXT one-time code (GAP-2): the
// named PrerequisiteGap must surface inside the case budget, never as a
// budget kill. The first code arrives during startup, so this only bounds the
// second-code wait.
const PAIRING_WAIT_MS = 6000;

const evidence = join(repositoryRoot, 'build/web-text-intake-tests/static-browser');

let backend;
let model;
let scriptDir;
let staticRoot;
let staticRootMode;
let syntheticRoot = null;

before(async () => {
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const resolved = resolveSuiteStaticRoot();
  if (resolved.mode === 'synthetic') {
    syntheticRoot = mkdtempSync(join(tmpdir(), 'web-text-intake-static-'));
    staticRoot = buildSyntheticStaticRoot(syntheticRoot);
    staticRootMode = 'synthetic';
  } else {
    staticRoot = resolved.root;
    staticRootMode = resolved.mode;
  }
  assert.ok(existsSync(join(staticRoot, 'index.html')), `static root must contain index.html: ${staticRoot}`);
  const runtimeRoot = runtimeRootAvailable() ? bundledRuntimeRoot : undefined;
  backend = await startBackend({
    staticRoot,
    runtimeRoot,
    credentialProvider: createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    }),
  });
  writeFileSync(join(evidence, 'static-root.json'), JSON.stringify({
    mode: staticRootMode,
    root: staticRootMode === 'synthetic' ? 'synthetic fixture root (real files, not the product UI)' : staticRoot,
    backendOrigin: backend.origin,
  }, null, 2) + '\n', { mode: 0o600 });
  writeEvidence('static-effective-config.json', effectiveConfig({
    suite: 'web-text-intake-static', staticRootMode, runtimeRoot: runtimeRoot ?? null, credentialRef: CREDENTIAL_REF,
  }));
  // The controlled model service backs the browser journey's extract task.
  scriptDir = join(backend.root, 'model-script');
  const script = writeScript(scriptDir, [{ repeat: true, kind: 'sse', content: queueExtractAnswer() }]);
  model = await startControlledModelService({ script, record: join(backend.root, 'model.jsonl') });
  // II config prerequisite (dispatch 01a1be44): the inline writer used fields
  // outside the frozen configuration DTO, so the config store rejected the
  // document with `validation_failed: 供应商名称无效。`.
  writeControlledModelConfig(backend.root, model.url, CREDENTIAL_REF);
}, { timeout: 90000 });

after(async () => {
  await model?.stop();
  await backend?.close();
  if (syntheticRoot) rmSync(syntheticRoot, { recursive: true, force: true });
});

const LONG_CACHE = /(?:max-age\s*=\s*(\d+)|immutable)/i;

const HASHED_MIME = {
  '.js': /javascript/, '.mjs': /javascript/, '.css': /^text\/css/, '.map': /json/,
  '.woff2': /font\/woff2/, '.woff': /font\/woff/, '.ttf': /font\/ttf/, '.otf': /font\/otf/,
  '.svg': /image\/svg\+xml/, '.png': /image\/png/, '.jpg': /image\/jpeg/, '.jpeg': /image\/jpeg/,
  '.gif': /image\/gif/, '.ico': /image\/(x-icon|vnd\.microsoft\.icon)/, '.webp': /image\/webp/, '.avif': /image\/avif/,
};

test('static supply: index.html is served same-origin with correct MIME and without long caching', async () => {
  const response = await backend.request('GET', '/');
  assert.equal(response.status, 200, response.text.slice(0, 200));
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  const cacheControl = response.headers.get('cache-control') ?? '';
  assert.doesNotMatch(cacheControl, /immutable/i, 'index.html must not be immutably cached');
  const maxAge = cacheControl.match(/max-age\s*=\s*(\d+)/i);
  assert.ok(!maxAge || Number(maxAge[1]) < 3600, `index.html must not be cached long: ${cacheControl}`);
  assert.match(cacheControl, /no-cache|no-store|must-revalidate|max-age=0/i, `index.html must carry a no-cache directive: ${cacheControl}`);
  assert.match(response.text, /id="app"/, 'the served page must contain the application mount point');
});

test('static supply: hashed assets carry the MIME their extension requires with long caching', async () => {
  const hashed = staticRootMode === 'synthetic' ? ['/assets/app-9f8e7d6c5b4a.js'] : findHashedAssets(staticRoot);
  assert.ok(hashed.length > 0, 'a hashed asset must exist in the static root');
  for (const path of hashed) {
    const response = await backend.request('GET', path);
    assert.equal(response.status, 200, `${path}: ${response.text.slice(0, 120)}`);
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    const expected = HASHED_MIME[extension];
    assert.ok(expected, `${path}: unclassified hashed asset extension ${extension}; extend the MIME map deliberately`);
    assert.match(response.headers.get('content-type') ?? '', expected, `${path} MIME must match ${expected}`);
    const cacheControl = response.headers.get('cache-control') ?? '';
    const match = cacheControl.match(LONG_CACHE);
    assert.ok(match, `${path} must be cacheable: ${cacheControl}`);
    if (match[1]) assert.ok(Number(match[1]) >= 31536000, `${path} needs a long max-age: ${cacheControl}`);
  }
});

test('static supply: SPA routes fall back to index.html while /api paths never do', async () => {
  const index = await backend.request('GET', '/');
  const deepRoute = await backend.request('GET', '/workbench/today');
  assert.equal(deepRoute.status, 200, 'a client-side route must fall back to index.html');
  assert.match(deepRoute.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(deepRoute.text, index.text, 'the SPA fallback must serve the same index.html');
  for (const path of ['/api/unknown-route', '/api', '/api/events', '/api/manual-items', '/api/tasks', '/api/text-sources']) {
    const response = await backend.request('GET', path);
    assert.ok(response.status >= 400 && response.status < 500, `${path} must not fall back to index.html (got ${response.status})`);
    assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/, `${path} must not return HTML`);
    assert.ok(response.json, `${path} must return a JSON error envelope: ${response.text.slice(0, 200)}`);
    assert.equal(response.json.contractVersion, 'web-api/2', `${path} error envelope must carry the contract version`);
  }
  const posted = await backend.request('POST', '/api/unknown-route', { body: { hello: 'world' } });
  assert.ok(posted.status >= 400 && posted.status < 500, 'unknown API writes must not fall back either');
  assert.doesNotMatch(posted.headers.get('content-type') ?? '', /text\/html/);
});

// ---------------------------------------------------------------------------
// Packaged CLI default paths
// ---------------------------------------------------------------------------

test('packaged CLI: the real CLI starts on default artifact paths, serves the same-origin UI and API, pairs, and shuts down cleanly', async () => {
  const deadline = caseDeadline();
  const artifacts = resolveArtifacts();
  const cliEntry = artifacts.entry;
  assert.ok(existsSync(cliEntry), `the packaged CLI entry must exist: ${cliEntry}`);
  const root = mkdtempSync(join(tmpdir(), 'web-text-intake-cli-'));
  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, [cliEntry, '--root', root, '--init'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    // Default port from the CLI contract; wait for the startup line (no fixed
    // sleep) and read the pairing code from stdout in memory only. Only
    // --root/--init are passed: the storage binary and static root must
    // resolve through the packaged layout defaults (dispatch: "默认 binary/
    // static/runtime 定位必须按实际 bundle 布局，用真实 CLI 起包验证").
    let origin;
    try {
      origin = await pollUntil(() => {
        const match = /Web 后端已启动：(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
        if (match) return match[1];
        // A CLI that already exited will never print the startup line: fail
        // fast with its exit status and stderr instead of polling a corpse.
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`the CLI exited before startup (exitCode=${child.exitCode} signal=${child.signalCode}) stderr=${stderr.slice(0, 500)}`);
        }
        return null;
      }, { timeoutMs: waitWithin(deadline, 12000), message: 'the packaged CLI to start on its default port' });
    } catch (error) {
      // GAP-1 counterexample/regression (frozen 2026-11-08 arbitration): only
      // --root/--init are passed, so the storage binary and static root must
      // resolve through the packaged layout build/web-backend/{bin,static}.
      // An ENOENT here is the registered defect — the entry defaults resolve
      // one level short — and stays a hard failure until slice I lands the
      // entry fix; the III bundle layout itself is frozen and unchanged.
      const enoent = /ENOENT|spawn/.test(stderr);
      throw new PrerequisiteGap(
        `the packaged CLI did not start on default artifact paths (only --root/--init were passed): ${error.message}; `
        + `CLI exitCode=${child.exitCode} stderr=${stderr.slice(0, 500)}. `
        + (enoent
          ? 'The ENOENT signature is the registered GAP-1: the entry default binary/static resolution must match '
            + 'the actual bundle layout build/web-backend/{bin,static} (slice I owns the entry defaults).'
          : ''),
      );
    }
    const codeMatch = /配对码：([0-9a-f]+)/.exec(stdout);
    assert.ok(codeMatch, 'the CLI must print the one-time pairing code on stdout');
    const code = codeMatch[1];
    assert.ok(!stdout.includes(SYNTHETIC_KEY), 'the CLI stdout must not contain any synthetic secret');

    const request = async (method, path, options = {}) => {
      const { body, cookie, csrf, headers = {} } = options;
      const finalHeaders = { ...headers };
      if (cookie) finalHeaders.cookie = cookie;
      if (csrf) finalHeaders['X-CSRF-Token'] = csrf;
      if (body !== undefined) finalHeaders['content-type'] = 'application/json';
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      return { status: response.status, headers: response.headers, text, json, setCookie: response.headers.getSetCookie?.() ?? [] };
    };

    // Same-origin UI from the default static root.
    const index = await request('GET', '/');
    assert.equal(index.status, 200, `the CLI must serve the packaged static root: ${index.text.slice(0, 200)}`);
    assert.match(index.headers.get('content-type') ?? '', /text\/html/);
    assert.match(index.text, /id="app"/);
    const deep = await request('GET', '/workbench/today');
    assert.equal(deep.status, 200, 'the CLI must serve the SPA fallback');
    // Unauthenticated API answers with the frozen envelope.
    const session = await request('GET', '/api/session');
    assert.equal(session.status, 401, session.text);
    assert.equal(session.json.contractVersion, 'web-api/2');
    assert.equal(session.json.error?.code, 'unauthenticated');
    const events = await request('GET', '/api/events');
    assert.equal(events.status, 401, events.text);
    assert.equal(events.json.error?.code, 'unauthenticated');
    // Pairing with the CLI-printed code establishes a real session.
    const paired = await request('POST', '/api/pair', { body: { pairingCode: code } });
    assert.equal(paired.status, 200, `pairing with the CLI code must succeed: ${paired.text}`);
    const cookie = paired.setCookie.map((entryLine) => entryLine.split(';', 1)[0]).join('; ');
    assert.ok(cookie, 'pairing must set the session cookie');
    const sessionAfter = await request('GET', '/api/session', { cookie });
    assert.equal(sessionAfter.status, 200, sessionAfter.text);
    assert.ok(Array.isArray(sessionAfter.json.session?.capabilities), 'the session must carry capabilities');
    const logout = await request('DELETE', '/api/session', { cookie });
    assert.equal(logout.status, 200, logout.text);
    const afterLogout = await request('GET', '/api/session', { cookie });
    assert.equal(afterLogout.status, 401, 'logout must revoke the session');
  } finally {
    // The CLI may already be dead (the GAP-1 counterexample path): killing a
    // reaped child is a no-op and its 'exit' event has already fired, so only
    // wait when it is still running.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 5000).unref();
      });
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(!stderr.includes(SYNTHETIC_KEY), 'the CLI stderr must not contain any synthetic secret');
});

// ---------------------------------------------------------------------------
// Browser matrix (T-14)
// ---------------------------------------------------------------------------

// A dedicated unpaired backend for the browser journeys: the file-level
// backend is already paired, and the one-time pairing code it consumed at
// startup is exactly what the browser must spend. The same synthetic static
// root, controlled model service and credential provider are reused.
async function startUnpairedBackend() {
  const handle = await startBackend({
    pair: false,
    staticRoot,
    runtimeRoot: runtimeRootAvailable() ? bundledRuntimeRoot : undefined,
    pairingTimeoutMs: PAIRING_WAIT_MS,
    credentialProvider: createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    }),
  });
  // II config prerequisite (dispatch 01a1be44): see the note at the first site.
  writeControlledModelConfig(handle.root, model.url, CREDENTIAL_REF);
  return handle;
}

for (const width of [1440, 640]) {
  test(`browser cold start at ${width}px: the served UI mounts, reaches /api same-origin with the frozen 401 envelope, and shows the pairing gate`, {
    skip: chromeAvailable() ? false : 'Chrome unavailable; browser same-origin acceptance not verified',
  }, async () => {
    const page = await probeWithChrome(`${backend.origin}/`, width, {
      profileDir: join(evidence, `chrome-profile-${width}`),
    });
    try {
      const { report, dom, screenshot } = page;
      writeFileSync(join(evidence, `cold-start-${width}.dom.html`), dom, { mode: 0o600 });
      if (screenshot) writeFileSync(join(evidence, `cold-start-${width}.png`), Buffer.from(screenshot, 'base64'));
      writeFileSync(join(evidence, `cold-start-${width}.json`), JSON.stringify({ mode: staticRootMode, report }, null, 2) + '\n', { mode: 0o600 });
      assertColdStartReport(report, { origin: backend.origin, mode: staticRootMode, width });
      if (staticRootMode !== 'synthetic') {
        assert.equal(report.pairing.gateVisible, true, 'an unpaired cold start must show the product pairing gate');
        assert.equal(report.pairing.hasCodeInput, true, 'the pairing gate must expose the pairing-code input');
        assert.match(report.pairing.gateHeading ?? '', /配对码/, 'the pairing gate must be the product gate');
      }
    } finally {
      page.close();
    }
  });

  test(`browser pairing and session lifecycle at ${width}px: pair in the real UI, lose the session, refresh, and the gate persists`, {
    skip: chromeAvailable() ? false : 'Chrome unavailable; browser same-origin acceptance not verified',
  }, async () => {
    if (staticRootMode === 'synthetic') {
      // The pairing journey drives the REAL product UI through its own DOM
      // and response paths; a synthetic fixture root cannot sign it. Missing
      // the real product dist is an explicit PrerequisiteGap failure (M-5) —
      // never a silent `return` that records a pass.
      throw new PrerequisiteGap(
        `the product-UI pairing journey requires the real product dist `
        + `(build/web-backend/static from npm run build:backend, or WEB_TEXT_INTAKE_STATIC_ROOT); `
        + `this run resolved a synthetic fixture static root (mode=${staticRootMode}). `
        + 'No product-UI result is claimed.',
      );
    }
    const handle = await startUnpairedBackend();
    const page = await probeWithChrome(`${handle.origin}/`, width, {
      profileDir: join(evidence, `chrome-pairing-${width}`),
    });
    try {
      const code = await handle.receivePairingCode();
      const paired = await pairInPage(page.evaluate, code);
      assert.equal(paired?.ok, true, `pairing in the real UI must succeed: ${JSON.stringify(paired)}`);
      const afterPair = await page.evaluate(`(() => ({
        gateVisible: !!document.querySelector('.pairing-gate'),
        navVisible: !!document.querySelector('nav'),
        bodyText: (document.body.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 200),
      }))()`, { awaitPromise: false });
      assert.equal(afterPair.gateVisible, false, 'the pairing gate must close after a successful pair');
      assert.equal(afterPair.navVisible, true, 'the workbench navigation must appear after pairing');

      // Session invalidation: the page revokes its own session; the product's
      // session-lost path fires on the next authenticated request through its
      // own API client, so a real write in the capture form must surface the
      // 401 and return the UI to the pairing gate (no reload involved).
      const revoked = await page.evaluate(`(async () => {
        const response = await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
        return { status: response.status };
      })()`);
      assert.equal(revoked?.status, 200, `the in-page session revocation must succeed: ${JSON.stringify(revoked)}`);
      const writeAfterRevocation = await writeManualItemInPage(page.evaluate, '会话失效后的写入');
      assert.equal(writeAfterRevocation?.ok, true,
        `the post-revocation write must be driven through the product UI: ${JSON.stringify(writeAfterRevocation)}`);
      assert.equal(writeAfterRevocation.gateVisible, true,
        'a revoked session must return the product UI to the pairing gate on the next authenticated request');

      // Refresh: no session survives a reload, so the gate persists and the
      // pairing input is offered again.
      await page.navigate(`${handle.origin}/`);
      const refreshed = await page.evaluate(`(() => ({
        gateVisible: !!document.querySelector('.pairing-gate'),
        hasCodeInput: !!document.querySelector('input[aria-label="配对码"]'),
      }))()`, { awaitPromise: false });
      assert.equal(refreshed.gateVisible, true, 'a refresh without a session must show the pairing gate');
      assert.equal(refreshed.hasCodeInput, true);
      // Backend restart session invalidation is covered by the queue suite's
      // T-7 (a pre-restart cookie is rejected 401 by the fresh instance).
      //
      // Expiry re-pairing (frozen GAP-2 alignment): after the successful pair
      // consumed the startup code, the backend emits the NEXT one-time code
      // over the private onPairingCode callback; the fixture captures it (it
      // never reaches a URL, log or file) and the real UI pairs again with it.
      // TTL/one-time/rate-limit semantics stay production's and no
      // unauthenticated code-fetch interface is used. The base entry emits
      // exactly one code, so this fails with the named interface gap until
      // slice I lands the emission trigger.
      const code2 = await handle.receivePairingCode(1);
      const repaired = await pairInPage(page.evaluate, code2);
      assert.equal(repaired?.ok, true,
        `re-pairing in the real UI with the next one-time code must succeed: ${JSON.stringify(repaired)}`);
      const afterRepair = await page.evaluate(`(() => ({
        gateVisible: !!document.querySelector('.pairing-gate'),
        navVisible: !!document.querySelector('nav'),
      }))()`, { awaitPromise: false });
      assert.equal(afterRepair.gateVisible, false, 'the pairing gate must close after the re-pair');
      assert.equal(afterRepair.navVisible, true, 'the workbench navigation must appear after the re-pair');
      writeFileSync(join(evidence, `pairing-lifecycle-${width}.json`), JSON.stringify({
        pairingCodesObserved: handle.pairingCodes.length,
        rePairedWithSecondCode: true,
      }, null, 2) + '\n', { mode: 0o600 });
    } finally {
      page.close();
      await handle.close();
    }
  });
}

test('browser text-intake journey: the intake entry is enabled in the served product UI and a submitted text reaches candidates', {
  skip: chromeAvailable() ? false : 'Chrome unavailable; browser same-origin acceptance not verified',
}, async () => {
  const deadline = caseDeadline();
  if (staticRootMode === 'synthetic') {
    // The intake journey drives the REAL product UI (entry enabled, text
    // submitted through the product's own form, candidates read in the
    // product inbox); a synthetic fixture root cannot sign it. Missing the
    // real product dist is an explicit PrerequisiteGap failure (M-5) —
    // never a silent `return` that records a pass.
    throw new PrerequisiteGap(
      `the product-UI intake journey requires the real product dist `
      + `(build/web-backend/static from npm run build:backend, or WEB_TEXT_INTAKE_STATIC_ROOT); `
      + `this run resolved a synthetic fixture static root (mode=${staticRootMode}). `
      + 'No product-UI result is claimed.',
    );
  }
  const handle = await startUnpairedBackend();
  const page = await probeWithChrome(`${handle.origin}/`, 1440, {
    profileDir: join(evidence, 'chrome-journey'),
  });
  try {
    const code = await handle.receivePairingCode();
    const paired = await pairInPage(page.evaluate, code);
    assert.equal(paired?.ok, true, `pairing in the real UI must succeed: ${JSON.stringify(paired)}`);

    const entry = await openIntakeEntry(page.evaluate);
    assert.equal(entry?.ok, true, `the capture entry must be present in the served product UI: ${JSON.stringify(entry)}`);
    assert.equal(entry.tabPresent, true, 'the capture dialog must expose the 文本智能整理 tab');
    // The base tree disables the intake entry with the accurate "未接通"
    // state; slice I enables it for the browser path. An enabled tab is the
    // falsifiable signal that the text-intake slice is wired into the product.
    assert.equal(entry.tabDisabled, false,
      `the 文本智能整理 tab must be enabled in the served product UI (title: ${entry.tabTitle ?? ''}); `
      + 'a disabled tab means the intake path is not wired for the browser in this build');
    assert.equal(entry.formPresent, true, 'the intake form must render when the tab is selected');

    const submitted = await submitIntakeText(page.evaluate, queueText(1));
    assert.equal(submitted?.ok, true, `submitting the intake text in the real UI must succeed: ${JSON.stringify(submitted)}`);

    // The submission must reach the backend. The browser session is not
    // readable from the test process (HttpOnly cookie), so the business
    // read-back is done through read-only database observation on the same
    // root — never a second session or a forged result.
    const source = await pollUntil(() => {
      const rows = sourceRowsSafe(handle.root);
      return rows.length > 0 ? rows.at(-1) : null;
    }, { timeoutMs: waitWithin(deadline, 8000), message: 'the submitted source to appear in the database' });
    assert.ok(source, 'the UI submission must create a source row');
    assert.ok(String(source.raw_text ?? '').includes('合成整理输入标记'),
      'the source row must carry the text the browser submitted');
    const task = await pollUntil(() => {
      const row = taskByOperationSafe(handle.root, source.succeeded_run_id) ?? taskRowSafe(handle.root, source.succeeded_run_id);
      if (!row) return null;
      return TERMINAL.includes(row.state) ? row : null;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'the intake task to finish' });
    assert.equal(task.state, 'succeeded', `the controlled extract must succeed: ${JSON.stringify(task)}`);
    const candidates = candidateRows(handle.root, { sourceId: source.source_id });
    assert.ok(candidates.length > 0, 'the model candidates must be published');
    assert.ok(candidates.every((row) => row.status === 'pending'), 'published candidates must be pending');

    // The candidate must be visible in the product UI's inbox (the 待确认
    // entry is enabled once the intake path is wired).
    const inboxState = await page.evaluate(`(async () => {
      const nav = [...document.querySelectorAll('nav button')].find((node) => /待确认/.test(node.textContent ?? ''));
      if (!nav) return { ok: false, reason: 'the inbox nav entry is not present' };
      if (nav.disabled) return { ok: false, reason: 'the inbox nav entry is disabled in this build' };
      nav.click();
      await new Promise((r) => setTimeout(r, 500));
      const text = (document.body.textContent ?? '').replace(/\\s+/g, ' ');
      return { ok: true, hasCandidate: /整理合成队列输入/.test(text), text: text.slice(0, 300) };
    })()`);
    assert.equal(inboxState?.ok, true, `the inbox must be reachable in the product UI: ${JSON.stringify(inboxState)}`);
    assert.equal(inboxState.hasCandidate, true,
      `the published candidate must be visible in the product UI inbox: ${inboxState.text}`);
  } finally {
    page.close();
    await handle.close();
  }
});

function sourceRowsSafe(root) {
  try {
    return sourceRows(root);
  } catch {
    return [];
  }
}

function taskRowSafe(root, taskId) {
  try {
    return taskRow(root, taskId);
  } catch {
    return null;
  }
}

function taskByOperationSafe(root, operationId) {
  try {
    return taskByOperationId(root, operationId);
  } catch {
    return null;
  }
}

function findHashedAssets(root) {
  const assets = join(root, 'assets');
  if (!existsSync(assets)) return [];
  return readdirSync(assets)
    .filter((name) => statSync(join(assets, name)).isFile() && /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(name))
    .sort()
    .map((name) => `/assets/${name}`);
}
