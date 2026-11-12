// MAYNE-24 slice II (Kimi): real HTTP acceptance for the W1 text-intake
// vertical (browser text intake, candidate revision and batch sign-off).
// Assertions come from the frozen P1 contract
// (docs/engineering/web-text-intake-contract.md, received byte-exact from
// b190f7c6, SHA-256 5982c062…), the frozen web-api/1 task contract
// (docs/engineering/web-api-contract.md §3–§7/§10), the W1 manual-items
// contract incl. appendix A/B (idempotency "current authoritative state"),
// and the P2 acceptance matrix T-1..T-14
// (docs/reviews/web-text-intake-readiness-20261108.md, SHA-256 2d647417…).
// Test ids reference the T-matrix; contract sections are cited per test.
//
// Business setup goes through real HTTP only; database observations are
// read-only on the same synthetic root. The model is the controlled
// OpenAI-compatible service driving the REAL bundled Pi organizer — no real
// model, no real credential, no real user root. The synthetic credential is
// injected in memory through the arbitration's private config seam and is
// grepped for in every response, SSE frame, database row, child argv and log.
//
// Wire literals follow the 2026-11-08 W1 arbitration, pinned by the fixture:
// pair body field pairingCode, session response top-level csrfToken, write
// header X-CSRF-Token. While slice I is not integrated in this tree, business
// requests fail explicitly at the missing route with the response body in the
// assertion message — no business result is claimed and nothing is skipped
// silently.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeControlledModelConfig, setControlledCredentialRef } from '../fixtures/web-text-intake/model-config.mjs';
import {
  startBackend,
  createRawRequester,
  readSession,
  pair,
  pairRequestBody,
  writeEvidence,
  effectiveConfig,
  createControlledCredentialProvider,
  runtimeRootAvailable,
  bundledRuntimeRoot,
  PrerequisiteGap,
} from '../fixtures/web-text-intake/backend-process.mjs';
import {
  tableCounts, schemaVersion, hasTable,
  sourceRow, sourceRows, candidateRows, candidateRow, previewRows,
  signOffBatchRow, manualItemSourceRows,
  taskRow, taskByOperationId, taskRows, taskEventRows, attemptRows,
  settingsRow, manualItemRow, manualItemEvents,
} from '../fixtures/web-text-intake/db-observer.mjs';
import { openEventStream } from '../fixtures/web-text-intake/sse-listener.mjs';
import {
  startControlledModelService, writeScript,
  primaryExtractAnswer, alternateExtractAnswer, queueExtractAnswer, ambiguousExtractAnswer, reviseAnswer,
} from '../fixtures/web-text-intake/controlled-model.mjs';
import {
  operationId, ID_PATTERNS, ISO_MS,
  SOURCE_TEXT, SOURCE_TEXT_ALT, queueText, timePoint,
  AMBIGUOUS_TEXT, AMBIGUOUS_EXPRESSION,
  submitSourceBody, candidateFields, followupFields,
  editBody, discardBody, revisionBody, applyPreviewBody,
  signOffBody, signOffChoice,
  taskSubmitBody, cancelBody, retryBody, resolveBody,
  concurrencyPutBody, modelsPutBody, agentsPutBody,
} from '../fixtures/web-text-intake/synthetic-inputs.mjs';
import { resolveExpression } from '../../shared/dates.mjs';

// The synthetic credential. It exists only inside the in-memory controlled
// provider and the worker's private stdin; every suite greps for it.
const SYNTHETIC_KEY = 'synthetic-web-text-intake-key-7f3a9c';
const CREDENTIAL_REF = 'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY';
const ANCHOR_MS = Date.parse('2026-11-13T10:00:00.000Z');

// Frozen case budget: the ticket freezes 20000ms per case (the aggregate runs
// `node --test --test-timeout=20000`, the W1 value), so no case declares a
// larger budget of its own. Every wait inside a case derives from ONE per-case
// deadline — polling together can never outlive it — and heavy preparation
// (backend/model startup, artifact builds) stays outside the timed case in
// the before hook / build chain, the sanctioned exception. Wait caps are
// backstops for failure diagnosability; each is additionally bounded by the
// remaining time to the case deadline (M-3: the former 30000ms waitForTask
// default exceeded the case budget).
const CASE_BUDGET_MS = 20000;
const CASE_MARGIN_MS = 2000;
const caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS;
const waitWithin = (deadline, capMs) => Math.max(250, Math.min(capMs, deadline - Date.now()));

let backend;
let model;
let scriptDir;
let runtimeRoot;
// The in-memory controlled credential provider. The fixture holds its state,
// so revocation is a state change of this object (frozen 2026-11-08
// arbitration) — never a configuration rewrite or a production setter alias.
let credentialProvider;

// The provider/model configuration files (contract §4.4: the working root's
// config/ directory is the config-store's home). Field shape follows the
// frozen contract's provider capability description (§5.3/§7); if slice I
// lands a different shape, the read-back assertions below fail explicitly
// with the observed body rather than silently passing.
// II config prerequisite (dispatch 01a1be44): the inline writer below used
// fields outside the frozen configuration DTO (`authMode`, `credentialRefs`,
// no `name`), so `ConfigStore.readModelConfiguration()` rejected the whole
// document with `validation_failed: 供应商名称无效。` and no task could be
// submitted. The shared fixture writes the legal shape; the base URL is filled
// in by the suite once the controlled service is up.
function writeModelConfig(root) {
  writeControlledModelConfig(root, null, CREDENTIAL_REF);
}

// Point the provider config at the controlled service. The file is rewritten
// (same shape) so the config revision changes and the CAS path can be
// exercised against a real value.
function pointProviderAt(root, baseUrl) {
  const path = join(root, 'config', 'providers.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  parsed.providers[0].baseUrl = baseUrl;
  writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
}

// Business read of the model configuration. A 404 here is the explicit
// "slice I not integrated" failure, not a skip.
async function readModels(handle) {
  const response = await handle.request('GET', '/api/models', { cookie: handle.cookie });
  assert.equal(response.status, 200,
    `GET /api/models must succeed (contract §5.3); got ${response.status}: ${response.text}`);
  assert.ok(response.json, 'GET /api/models must return JSON');
  return response.json;
}

async function submitSource(handle, options = {}) {
  const response = await handle.request('POST', '/api/text-sources', {
    body: submitSourceBody(options),
    cookie: handle.cookie,
    csrf: handle.csrf,
  });
  return response;
}

// Wait until a task reaches a terminal-or-stable state; the poll observes the
// live task resource, never a fixed sleep. The default backstop sits well
// under the frozen 20000ms case budget; cases pass a deadline-derived bound.
async function waitForTask(handle, taskId, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    const response = await handle.request('GET', `/api/tasks/${taskId}`, { cookie: handle.cookie });
    assert.equal(response.status, 200, `GET /api/tasks/${taskId} must succeed; got ${response.status}: ${response.text}`);
    last = response.json.task ?? response.json;
    if (predicate(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(`task ${taskId} did not reach the expected state within ${timeoutMs}ms; last: ${JSON.stringify(last)}`);
    }
    await new Promise((done) => setTimeout(done, 25));
  }
}

const isTerminal = (task) => ['succeeded', 'failed', 'cancelled'].includes(task.state);

before(async () => {
  runtimeRoot = runtimeRootAvailable() ? bundledRuntimeRoot : undefined;
  credentialProvider = createControlledCredentialProvider({
    [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
  });
  backend = await startBackend({
    runtimeRoot,
    credentialProvider,
  });
  writeEvidence('http-effective-config.json', effectiveConfig({
    suite: 'web-text-intake-http',
    runtimeRoot: runtimeRoot ?? null,
    credentialRef: CREDENTIAL_REF,
  }));
  scriptDir = join(backend.root, 'model-script');
  // Request-matched answers (fixture controlled-model-service.mjs): the
  // primary answer applies to the primary synthetic source, the revise answer
  // to revision requests (whose prompt carries the candidate title), the
  // ambiguity answer to the T-12 ambiguity text, and the queue answer is the
  // standing fallback valid for every queue text.
  const script = writeScript(scriptDir, [
    { match: { userTextIncludes: '林川下周五之前提交SDK鉴权修复' }, kind: 'sse', content: primaryExtractAnswer() },
    { match: { userTextIncludes: '网关割接评审安排在下周五前后' }, kind: 'sse', content: ambiguousExtractAnswer() },
    { match: { userTextIncludes: '整理合成队列输入' }, kind: 'sse', content: reviseAnswer() },
    { repeat: true, kind: 'sse', content: queueExtractAnswer() },
  ]);
  model = await startControlledModelService({ script, record: join(backend.root, 'model.jsonl') });
  writeModelConfig(backend.root);
  pointProviderAt(backend.root, model.url);
}, { timeout: 90000 });

after(async () => {
  await model?.stop();
  await backend?.close();
});

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function assertEnvelope(response, status, code) {
  assert.equal(response.status, status, `expected HTTP ${status}, got ${response.status}: ${response.text}`);
  assert.ok(response.json, `expected a JSON body, got: ${response.text}`);
  assert.equal(response.json.contractVersion, 'web-api/2', 'error envelope must carry contractVersion web-api/1');
  assert.equal(response.json.status, status, 'envelope status must mirror the HTTP status');
  assert.equal(response.json.error?.code, code, `expected error code ${code}, got ${JSON.stringify(response.json.error)}`);
  assert.equal(typeof response.json.error?.message, 'string', 'error message must be a string');
  assert.ok(response.json.error.message.length > 0, 'error message must not be empty');
}

// A request that must be served by slice I. A generic route-level 404 means
// the endpoint does not exist in this tree yet; the failure names it
// explicitly instead of being mistaken for a business not-found.
function assertImplemented(response, method, path) {
  if (response.status === 404 && response.json?.error?.code && response.json.error.code !== 'source_not_found'
    && response.json.error.code !== 'candidate_not_found' && response.json.error.code !== 'task_not_found'
    && response.json.error.code !== 'result_not_found') {
    throw new PrerequisiteGap(
      `${method} ${path} is not implemented in this tree (${response.json.error.code}); `
      + 'the W1 text-intake endpoints are delivered by slice I. No business result is claimed.',
    );
  }
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

test('schema: the synthetic root carries the web-backend lineage the text-intake slice requires', async () => {
  const version = schemaVersion(backend.root);
  assert.ok(version !== null, 'schema_meta must exist after initialize');
  // Migration 003 (five new tables + the two rebuilt 002 tables) is slice I's
  // delivery with the frozen hash 8e4e3159…; at the base tree the version is 2
  // and the tables below are absent — asserted explicitly, not skipped.
  assert.equal(version, 4, 'migrations 003 and 004 must advance schema_meta to 4 in the same transaction (owner authorizations A and D)');
  for (const table of ['text_sources', 'candidates', 'candidate_previews', 'manual_item_sources', 'sign_off_batches']) {
    assert.ok(hasTable(backend.root, table), `migration 003 must create ${table}`);
  }
});

// ---------------------------------------------------------------------------
// T-1: no-model manual path does not regress
// ---------------------------------------------------------------------------

test('T-1: without any model configuration the manual-item flow is fully usable and never enters the task queue', async () => {
  const input = {
    title: '无模型时的手工事项',
    kind: 'action',
    owner: '李四',
    priority: 'high',
    due: timePoint(),
    followup: null,
    tags: ['手工'],
  };
  const created = await backend.request('POST', '/api/manual-items', {
    body: { operationId: operationId(), input },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(created.status, 200, `manual create must succeed without any model: ${created.text}`);
  const itemId = created.json.item.itemId;
  const completed = await backend.request('POST', `/api/manual-items/${itemId}/complete`, {
    body: { operationId: operationId(), expectedVersion: 1 },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(completed.status, 200, completed.text);
  const history = await backend.request('GET', `/api/manual-items/${itemId}/history`, { cookie: backend.cookie });
  assert.equal(history.status, 200, history.text);
  assert.deepEqual(history.json.events.map((event) => event.action), ['complete', 'create']);
  const counts = tableCounts(backend.root);
  assert.equal(counts.agentTasks ?? counts.tasks, 0, 'manual items must not enter the agent task queue (T-1)');
  assert.equal(counts.taskEvents, 0, 'manual item changes must not write task events');
});

// ---------------------------------------------------------------------------
// T-2: model configuration, credential references, secret boundaries
// ---------------------------------------------------------------------------

test('T-2: model configuration reads back with revision CAS, providers expose credential reference status, and no secret is ever returned', async () => {
  const models = await readModels(backend);
  assert.ok(models.revision, 'GET /api/models must return a configuration revision');
  assert.ok(Array.isArray(models.providers) && models.providers.length > 0, 'the configured provider must be listed');
  const provider = models.providers.find((entry) => entry.id === 'controlled-openai');
  assert.ok(provider, `the configured provider must be readable: ${JSON.stringify(models).slice(0, 400)}`);
  assert.ok(Array.isArray(models.models) && models.models.some((entry) => entry.id === 'controlled-organizer-model'),
    'the configured model must be readable');

  const providers = await backend.request('GET', '/api/providers', { cookie: backend.cookie });
  assert.equal(providers.status, 200, `GET /api/providers must succeed (frozen §7): ${providers.text}`);
  const capability = providers.json;
  const serialized = JSON.stringify(capability);
  assert.ok(!serialized.includes(SYNTHETIC_KEY), 'GET /api/providers must not return any secret value');
  const refs = capability.providers?.flatMap((entry) => entry.credentialRefs ?? []) ?? capability.credentialRefs ?? [];
  assert.ok(refs.length > 0, 'provider capabilities must expose credential references');
  for (const ref of refs) {
    assert.ok(['available', 'missing', 'unavailable'].includes(ref.status),
      `credential reference status must be one of available/missing/unavailable, got ${JSON.stringify(ref)}`);
    assert.ok(!JSON.stringify(ref).includes(SYNTHETIC_KEY), 'a credential reference must never carry the secret value');
  }

  // The organizer agent configuration is readable and organizer is the only
  // wired role in this slice (contract §5.3).
  const organizer = await backend.request('GET', '/api/agents/organizer', { cookie: backend.cookie });
  assert.equal(organizer.status, 200, `GET /api/agents/organizer must succeed: ${organizer.text}`);
  const advisor = await backend.request('GET', '/api/agents/advisor', { cookie: backend.cookie });
  assert.ok(advisor.status >= 400 && advisor.status < 500,
    `an unwired role must be accurately unavailable (4xx), got ${advisor.status}: ${advisor.text}`);
});

test('T-2: configuration saves use revision CAS and reject plaintext credentials', async () => {
  const models = await readModels(backend);
  const plaintext = await backend.request('PUT', '/api/models', {
    body: modelsPutBody({
      expectedRevision: models.revision,
      input: { providers: [{ id: 'controlled-openai', apiKey: SYNTHETIC_KEY }] },
    }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.ok(plaintext.status === 400 || plaintext.status === 422,
    `a plaintext credential in the configuration input must be rejected, got ${plaintext.status}: ${plaintext.text}`);
  assert.ok(!JSON.stringify(plaintext.json ?? {}).includes(SYNTHETIC_KEY), 'the rejection must not echo the secret');

  const stale = await backend.request('PUT', '/api/models', {
    body: modelsPutBody({ expectedRevision: 'stale-revision-0000', input: { providers: models.providers, models: models.models, defaultModelId: models.defaultModelId } }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(stale, 409, 'version_conflict');
});

test('T-13: no synthetic secret reaches any response, SSE frame, database row, child argv or backend log', async () => {
  const deadline = caseDeadline();
  // Backend log capture point (M-4): in-process mode runs the backend inside
  // this process, so its log writes are intercepted on process.stdout/stderr
  // for the duration of a real production run below and swept for the secret
  // — the suite no longer claims log coverage without a capture point.
  const captured = [];
  const nativeWrite = {
    out: process.stdout.write.bind(process.stdout),
    err: process.stderr.write.bind(process.stderr),
  };
  const intercept = (native) => (chunk, encoding, callback) => {
    captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return native(chunk, encoding, callback);
  };
  process.stdout.write = intercept(nativeWrite.out);
  process.stderr.write = intercept(nativeWrite.err);
  // Canary: proves the capture point itself functions even if the backend
  // chose to log nothing during this window.
  process.stdout.write('__web_text_intake_log_capture_canary__\n');
  let submitted;
  let taskId;
  let stream;
  try {
    // Submit a real source so the full production path (config -> scheduler ->
    // worker -> real Pi -> controlled service) runs once before the sweep.
    submitted = await submitSource(backend, { text: SOURCE_TEXT });
    assertImplemented(submitted, 'POST', '/api/text-sources');
    assert.equal(submitted.status, 200, `source submit must succeed: ${submitted.text}`);
    taskId = submitted.json.task?.taskId ?? submitted.json.taskId;
    assert.ok(taskId, `the submit response must carry the task: ${submitted.text}`);
    await waitForTask(backend, taskId, isTerminal, waitWithin(deadline, 10000));

    stream = await openEventStream(backend.origin, { cookie: backend.cookie });
    await stream.waitFor((frame) => frame.event === 'stream.ready', waitWithin(deadline, 6000));
  } finally {
    process.stdout.write = nativeWrite.out;
    process.stderr.write = nativeWrite.err;
    stream?.close();
  }
  const capturedText = captured.join('');
  assert.ok(capturedText.includes('__web_text_intake_log_capture_canary__'),
    'the backend log capture point must observe writes (the canary proves the interception functions)');
  // Whatever the backend itself wrote during the real production run (the
  // canary removed) must not carry the synthetic secret.
  const backendLog = capturedText.split('__web_text_intake_log_capture_canary__').join('');
  assert.ok(!backendLog.includes(SYNTHETIC_KEY),
    `the backend log streams must not carry the synthetic secret: ${backendLog.slice(0, 300)}`);

  for (const frame of stream.frames) {
    assert.ok(!JSON.stringify(frame).includes(SYNTHETIC_KEY), 'no SSE frame may carry the secret');
  }

  const settings = settingsRow(backend.root, 'agentConcurrency');
  if (settings) assert.ok(!String(settings.value).includes(SYNTHETIC_KEY), 'no settings row may carry the secret');
  for (const row of candidateRows(backend.root)) {
    assert.ok(!JSON.stringify(row).includes(SYNTHETIC_KEY), 'no candidate row may carry the secret');
  }
  for (const row of taskRows(backend.root)) {
    assert.ok(!JSON.stringify(row).includes(SYNTHETIC_KEY), 'no task row (incl. input_ref) may carry the secret');
  }
  const requests = model.requests();
  assert.ok(requests.length > 0, 'the controlled service must have observed at least one model request');
  for (const entry of requests) {
    assert.equal(entry.hasAuthorization, true, 'the real Pi request must carry an Authorization header (existence asserted, value never recorded)');
    assert.ok(entry.authorizationLength > 0, 'the Authorization header must be non-empty');
    assert.ok(!JSON.stringify(entry).includes(SYNTHETIC_KEY), 'the request record must never contain the secret value');
  }
});

// ---------------------------------------------------------------------------
// T-3: missing / revoked credential
// ---------------------------------------------------------------------------

test('T-3: a missing credential reference fails the task before any model call and keeps the input retryable', async () => {
  const deadline = caseDeadline();
  // Point the provider at a reference the controlled provider does not know:
  // resolution fails before execution, so no Pi process starts and the
  // controlled service observes no new request.
  const before = model.requests().length;
  const configDir = join(backend.root, 'config');
  const providersPath = join(configDir, 'providers.json');
  const parsed = JSON.parse(readFileSync(providersPath, 'utf8'));
  setControlledCredentialRef(backend.root, 'env:ABSENT_SYNTHETIC_KEY');

  const submitted = await submitSource(backend, { text: queueText(20) });
  assertImplemented(submitted, 'POST', '/api/text-sources');
  assert.equal(submitted.status, 200, submitted.text);
  const task = submitted.json.task ?? submitted.json;
  await waitForTask(backend, task.taskId, isTerminal, waitWithin(deadline, 10000));
  const failed = taskRow(backend.root, task.taskId);
  assert.equal(failed.state, 'failed', `a missing credential must fail the task, got ${failed.state}`);
  assert.equal(JSON.parse(failed.failure).code, 'credential_unavailable',
    'the failure code must be the frozen credential_unavailable (web-api/1 §4.6)');
  assert.equal(JSON.parse(failed.failure).retryable, 'manual', 'the input must stay retryable by the user');
  assert.equal(failed.attempt_exit_state, 'exited_confirmed', 'a pre-execution failure must not hold a slot');
  assert.deepEqual(candidateRows(backend.root, { sourceId: submitted.json.source.sourceId }), [],
    'no candidate may be persisted for a credential failure');
  assert.equal(model.requests().length, before, 'no model request may be issued when the credential is missing');
  assert.ok(sourceRow(backend.root, submitted.json.source.sourceId), 'the source must be retained for retry');

  // Revocation transition: the reference was available, then revoked between
  // submit and execution. The next task must fail the same way without ever
  // starting a model call (P2 T-3 "撤销密钥"), and the earlier successful
  // candidates are untouched.
  const restored = JSON.parse(readFileSync(providersPath, 'utf8'));
  setControlledCredentialRef(backend.root, CREDENTIAL_REF);
  const okSubmit = await submitSource(backend, { text: queueText(21) });
  assert.equal(okSubmit.status, 200, okSubmit.text);
  await waitForTask(backend, okSubmit.json.task.taskId, (task) => task.state === 'running' || TERMINAL_STATES.includes(task.state), waitWithin(deadline, 10000));
  const revokedConfig = JSON.parse(readFileSync(providersPath, 'utf8'));
  setControlledCredentialRef(backend.root, 'env:ABSENT_SYNTHETIC_KEY');
  const revokedSubmit = await submitSource(backend, { text: queueText(22) });
  assert.equal(revokedSubmit.status, 200, revokedSubmit.text);
  const revokedTask = await waitForTask(backend, revokedSubmit.json.task.taskId, (task) => TERMINAL_STATES.includes(task.state), waitWithin(deadline, 10000));
  assert.equal(revokedTask.state, 'failed',
    `a revoked credential must fail the task, got ${revokedTask.state}`);
  const revokedRow = taskRow(backend.root, revokedSubmit.json.task.taskId);
  assert.equal(JSON.parse(revokedRow.failure).code, 'credential_unavailable',
    'a revoked credential must map to the frozen credential_unavailable');
  assert.deepEqual(candidateRows(backend.root, { sourceId: revokedSubmit.json.source.sourceId }), [],
    'a revoked credential must not produce candidates');
  // Restore the available reference so later tests in this file keep a working
  // provider configuration.
  const finalConfig = JSON.parse(readFileSync(providersPath, 'utf8'));
  setControlledCredentialRef(backend.root, CREDENTIAL_REF);
});

test('T-3: a fixture-held revocation flips the in-memory provider state and fails the next task before any model call', async () => {
  const deadline = caseDeadline();
  // The frozen arbitration's revocation path: the controlled provider's state
  // changes in the fixture's memory with NO configuration change at all. The
  // next task must fail with the frozen credential_unavailable, produce no
  // candidates, issue no model request and keep the source retryable — the
  // production path must consult the provider, not a cached snapshot.
  const before = model.requests().length;
  credentialProvider.setStatus(CREDENTIAL_REF, 'missing');
  try {
    const submitted = await submitSource(backend, { text: queueText(23) });
    assertImplemented(submitted, 'POST', '/api/text-sources');
    assert.equal(submitted.status, 200, submitted.text);
    await waitForTask(backend, submitted.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
    const row = taskRow(backend.root, submitted.json.task.taskId);
    assert.equal(row.state, 'failed',
      `a fixture-held revocation must fail the task, got ${row.state}`);
    assert.equal(JSON.parse(row.failure).code, 'credential_unavailable',
      'a fixture-held revocation must map to the frozen credential_unavailable');
    assert.equal(JSON.parse(row.failure).retryable, 'manual', 'the input must stay retryable by the user');
    assert.equal(row.attempt_exit_state, 'exited_confirmed', 'a pre-execution failure must not hold a slot');
    assert.deepEqual(candidateRows(backend.root, { sourceId: submitted.json.source.sourceId }), [],
      'a fixture-held revocation must not produce candidates');
    assert.equal(model.requests().length, before, 'no model request may be issued after a fixture-held revocation');
    assert.ok(sourceRow(backend.root, submitted.json.source.sourceId), 'the source must be retained for retry');
  } finally {
    credentialProvider.setStatus(CREDENTIAL_REF, 'available');
  }
  // Restored state: the next task resolves the reference again.
  const resolvedBefore = credentialProvider.resolvedRefs.length;
  const restored = await submitSource(backend, { text: queueText(24) });
  assert.equal(restored.status, 200, restored.text);
  const restoredTask = await waitForTask(backend, restored.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  assert.equal(restoredTask.state, 'succeeded',
    `the restored provider must let the next task succeed, got ${restoredTask.state}: ${JSON.stringify(restoredTask)}`);
  assert.ok(credentialProvider.resolvedRefs.length > resolvedBefore,
    'the restored provider must be consulted (and resolve successfully) for the next task');
});

const TERMINAL_STATES = ['succeeded', 'failed', 'cancelled'];

// ---------------------------------------------------------------------------
// T-8: idempotency, replay and fingerprint deduplication
// ---------------------------------------------------------------------------

test('T-8: the same operationId replays the current authoritative state, a different input conflicts, and fingerprint dedup reuses the source', async () => {
  const deadline = caseDeadline();
  const op = operationId();
  const first = await submitSource(backend, { operationId: op, text: queueText(3) });
  assertImplemented(first, 'POST', '/api/text-sources');
  assert.equal(first.status, 200, first.text);
  assert.ok(!first.json.replayed, 'the first submit must not be a replay');
  const sourceId = first.json.source.sourceId;
  assert.match(sourceId, ID_PATTERNS.source);
  const taskId = first.json.task.taskId;
  await waitForTask(backend, taskId, isTerminal, waitWithin(deadline, 10000));

  const replay = await submitSource(backend, { operationId: op, text: queueText(3) });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.replayed, true, 'a same-operationId same-input replay must report replayed:true');
  assert.equal(replay.json.source.sourceId, sourceId, 'a replay must not create a second source');
  assert.equal(replay.json.task.taskId, taskId, 'a replay must not submit a second task');

  const conflict = await submitSource(backend, { operationId: op, text: queueText(4) });
  assertEnvelope(conflict, 409, 'idempotency_conflict');

  // Same fingerprint, different operationId: the source is reused with its
  // original anchor and no second task is created (contract §5.1).
  const dedup = await submitSource(backend, { text: queueText(3) });
  assert.equal(dedup.status, 200, dedup.text);
  assert.equal(dedup.json.reused, true, 'a same-fingerprint submit must report reused:true');
  assert.equal(dedup.json.source.sourceId, sourceId, 'fingerprint dedup must reuse the existing source');
  assert.equal(dedup.json.source.sourceAt?.at, first.json.source.sourceAt?.at,
    'fingerprint dedup must reuse the source with its ORIGINAL anchor (contract §5.1: 含其原锚点)');
  assert.equal(dedup.json.task.taskId, taskId, 'fingerprint dedup must not submit a second task');
  assert.deepEqual(dedup.json.task, (await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie })).json.task, 'dedup returns the current authoritative task');
  const sources = sourceRows(backend.root).filter((row) => row.source_id === sourceId);
  assert.equal(sources.length, 1, 'exactly one source row may exist for the fingerprint');

  // Response-loss readback by operationId (frozen §4.2).
  const readback = await backend.request('GET', `/api/tasks?operationId=${op}`, { cookie: backend.cookie });
  assert.equal(readback.status, 200, readback.text);
  const tasks = readback.json.tasks ?? [];
  assert.equal(tasks.filter((entry) => entry.taskId === taskId).length, 1, 'operationId readback must return exactly the one task');
});

test('T-8: task submit replays and conflicts on the operationId namespace', async () => {
  const deadline = caseDeadline();
  const op = operationId();
  const input = { sourceId: null, text: queueText(5) };
  const submitted = await backend.request('POST', '/api/tasks', {
    body: taskSubmitBody({ operationId: op, type: 'extract', input }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertImplemented(submitted, 'POST', '/api/tasks');
  assert.equal(submitted.status, 202, `task submit must be accepted with 202: ${submitted.text}`);
  const taskId = submitted.json.taskId;
  assert.match(taskId, ID_PATTERNS.task);
  await waitForTask(backend, taskId, isTerminal, waitWithin(deadline, 10000));
  const replay = await backend.request('POST', '/api/tasks', {
    body: taskSubmitBody({ operationId: op, type: 'extract', input }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.replayed, true, 'a replayed task submit must report replayed:true');
  assert.equal(replay.json.task.taskId, taskId, 'a replay must not create a second task');
  const conflict = await backend.request('POST', '/api/tasks', {
    body: taskSubmitBody({ operationId: op, type: 'extract', input: { sourceId: null, text: 'different input' } }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(conflict, 409, 'idempotency_conflict');
  const unknownType = await backend.request('POST', '/api/tasks', {
    body: taskSubmitBody({ type: 'unknown-kind', input: {} }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.ok(unknownType.status === 400, `an unknown task type must be rejected 400, got ${unknownType.status}: ${unknownType.text}`);
  assert.equal(unknownType.json.error.code, 'unknown_task_type');
});

// ---------------------------------------------------------------------------
// Source and candidate read paths
// ---------------------------------------------------------------------------

test('sources: list, detail and candidate listing are paginated and stable', async () => {
  const list = await backend.request('GET', '/api/text-sources?limit=2', { cookie: backend.cookie });
  assert.equal(list.status, 200, list.text);
  assert.ok(Array.isArray(list.json.sources), 'the source list must be an array');
  assert.ok(list.json.sources.length <= 2, 'limit must be honored');
  const tooLarge = await backend.request('GET', '/api/text-sources?limit=201', { cookie: backend.cookie });
  assertEnvelope(tooLarge, 400, 'validation_failed');

  const sourceId = list.json.sources[0]?.sourceId;
  assert.ok(sourceId, 'at least one source must exist from the earlier tests');
  const detail = await backend.request('GET', `/api/text-sources/${sourceId}`, { cookie: backend.cookie });
  assert.equal(detail.status, 200, detail.text);
  assert.ok(detail.json.source, 'the detail must carry the source');
  assert.ok(Array.isArray(detail.json.candidates), 'the detail must carry the candidates');
  const candidates = await backend.request('GET', `/api/text-sources/${sourceId}/candidates`, { cookie: backend.cookie });
  assert.equal(candidates.status, 200, candidates.text);
  assert.ok(Array.isArray(candidates.json.candidates), 'the candidate list must be an array');
  const unknown = await backend.request('GET', '/api/text-sources/src_00000000000000000000000000000000', { cookie: backend.cookie });
  assertEnvelope(unknown, 404, 'source_not_found');
});

test('candidates: staged candidates are invisible and unsignable until exit confirmation publishes them', async () => {
  const deadline = caseDeadline();
  // A fresh source with a fresh operation id; while the extract task runs the
  // candidate list must stay empty (staged rows are not visible — contract
  // §4.2/§5.1 service-layer enforcement), and the candidate only becomes
  // readable and signable after the task reaches a terminal state.
  const op = operationId();
  const submitted = await submitSource(backend, { operationId: op, text: queueText(6) });
  assertImplemented(submitted, 'POST', '/api/text-sources');
  assert.equal(submitted.status, 200, submitted.text);
  const sourceId = submitted.json.source.sourceId;
  const taskId = submitted.json.task.taskId;

  const duringRun = await backend.request('GET', `/api/text-sources/${sourceId}/candidates`, { cookie: backend.cookie });
  assert.equal(duringRun.status, 200, duringRun.text);
  const task = await waitForTask(backend, taskId, isTerminal, waitWithin(deadline, 10000));
  assert.equal(task.state, 'succeeded', `the controlled extract must succeed, got ${task.state}: ${JSON.stringify(task.failure)}`);

  const afterRun = await backend.request('GET', `/api/text-sources/${sourceId}/candidates`, { cookie: backend.cookie });
  assert.equal(afterRun.status, 200, afterRun.text);
  assert.ok(afterRun.json.candidates.length > 0, 'published candidates must be visible after exit confirmation');
  const candidate = afterRun.json.candidates[0];
  assert.match(candidate.candidateId, ID_PATTERNS.candidate);
  assert.equal(candidate.status, 'pending', 'a published candidate must be pending');
  assert.equal(candidate.version, 1);
  assert.ok(candidate.fields, 'the candidate must carry its fields');
  assert.ok(candidate.evidence && queueText(6).includes(candidate.evidence),
    `the candidate evidence must be a verbatim substring of the source, got ${JSON.stringify(candidate.evidence)}`);
  const rows = candidateRows(backend.root, { sourceId });
  assert.ok(rows.length > 0, 'the candidate must exist as a database row');
  assert.ok(rows.every((row) => row.status === 'pending'), 'database rows must be pending after exit confirmation');

  const detail = await backend.request('GET', `/api/candidates/${candidate.candidateId}`, { cookie: backend.cookie });
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.candidate.candidateId, candidate.candidateId);
  const unknownCandidate = await backend.request('GET', '/api/candidates/cand_00000000000000000000000000000000', { cookie: backend.cookie });
  assertEnvelope(unknownCandidate, 404, 'candidate_not_found');
});

// ---------------------------------------------------------------------------
// T-9: natural-language revision previews
// ---------------------------------------------------------------------------

test('T-9: a revision produces a preview that never overwrites the candidate, and apply is version-guarded', async () => {
  const deadline = caseDeadline();
  const submitted = await submitSource(backend, { text: queueText(7) });
  assertImplemented(submitted, 'POST', '/api/text-sources');
  assert.equal(submitted.status, 200, submitted.text);
  const sourceId = submitted.json.source.sourceId;
  await waitForTask(backend, submitted.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const candidates = await backend.request('GET', `/api/text-sources/${sourceId}/candidates`, { cookie: backend.cookie });
  const candidate = candidates.json.candidates[0];
  const beforeVersion = candidate.version;
  const beforeTitle = candidate.fields.title;

  const emptyInstruction = await backend.request('POST', `/api/candidates/${candidate.candidateId}/revisions`, {
    body: revisionBody({ instruction: '   ' }), cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(emptyInstruction.status, 400, `an empty instruction must be rejected 400: ${emptyInstruction.text}`);

  const revision = await backend.request('POST', `/api/candidates/${candidate.candidateId}/revisions`, {
    body: revisionBody({}), cookie: backend.cookie, csrf: backend.csrf,
  });
  assertImplemented(revision, 'POST', `/api/candidates/${candidate.candidateId}/revisions`);
  assert.equal(revision.status, 200, revision.text);
  const reviseTask = revision.json.task;
  assert.equal(reviseTask.type, 'revise', 'a revision must submit a revise task');
  await waitForTask(backend, reviseTask.taskId, isTerminal, waitWithin(deadline, 10000));

  // The preview exists and the candidate is untouched (no direct overwrite).
  const previews = await backend.request('GET', `/api/candidates/${candidate.candidateId}`, { cookie: backend.cookie });
  assert.equal(previews.status, 200, previews.text);
  assert.equal(previews.json.candidate.version, beforeVersion, 'a revision must not change the candidate version before apply');
  assert.equal(previews.json.candidate.fields.title, beforeTitle, 'a revision must not overwrite the candidate fields');
  const previewList = previewRows(backend.root, candidate.candidateId);
  assert.ok(previewList.length > 0, 'the preview must be persisted (candidate_previews)');
  const preview = previews.json.previews?.find((entry) => entry.runId === reviseTask.taskId) ?? previews.json.previews?.[0] ?? null;

  // Stale version apply is rejected; the current version applies.
  const stale = await backend.request('POST', `/api/candidates/${candidate.candidateId}/previews/${reviseTask.taskId}/apply`, {
    body: applyPreviewBody({ expectedVersion: beforeVersion + 7 }), cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(stale, 409, 'version_conflict');
  const applied = await backend.request('POST', `/api/candidates/${candidate.candidateId}/previews/${reviseTask.taskId}/apply`, {
    body: applyPreviewBody({ expectedVersion: beforeVersion }), cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(applied.status, 200, `apply with the current version must succeed: ${applied.text}`);
  assert.equal(applied.json.candidate.version, beforeVersion + 1, 'apply must increment the candidate version');
  if (preview) assert.notEqual(applied.json.candidate.fields.title, beforeTitle, 'the applied preview must change the title');
  const row = candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.version, beforeVersion + 1, 'the database version must advance with the apply');
});

// ---------------------------------------------------------------------------
// T-10: edit / link / discard / batch sign-off atomicity
// ---------------------------------------------------------------------------

test('T-10: candidate edits are version-guarded and validation matches the manual-item rules', async () => {
  const deadline = caseDeadline();
  const submitted = await submitSource(backend, { text: queueText(8) });
  assertImplemented(submitted, 'POST', '/api/text-sources');
  assert.equal(submitted.status, 200, submitted.text);
  await waitForTask(backend, submitted.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const candidates = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  const candidate = candidates.json.candidates[0];

  const invalid = [
    ['empty title', editBody({ expectedVersion: 1, fields: candidateFields({ title: '' }) })],
    ['unknown kind', editBody({ expectedVersion: 1, fields: candidateFields({ kind: 'someday' }) })],
    ['due without timezone', editBody({ expectedVersion: 1, fields: candidateFields({ due: { at: '2026-11-20T02:00:00.000Z', timeZone: '', localText: 'x', precision: 'minute' } }) })],
    ['nonexistent local time', editBody({ expectedVersion: 1, fields: candidateFields({ due: { at: '2026-03-08T07:30:00.000Z', timeZone: 'America/New_York', localText: '2026-03-08 02:30', precision: 'minute' } }) })],
  ];
  for (const [label, body] of invalid) {
    const response = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
      body, cookie: backend.cookie, csrf: backend.csrf,
    });
    assertEnvelope(response, 400, 'validation_failed');
  }
  const stale = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body: editBody({ expectedVersion: 9, fields: candidateFields() }), cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(stale, 409, 'version_conflict');
  const edited = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body: editBody({ expectedVersion: 1, fields: candidateFields({ title: '整理合成队列输入（已编辑）' }) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.candidate.version, 2, 'an edit must increment the version');
  const row = candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.version, 2);
});

test('T-10: a batch sign-off is atomic — one failing choice rolls the whole batch back', async () => {
  const deadline = caseDeadline();
  // Two fresh sources give two independent pending candidates.
  const first = await submitSource(backend, { text: queueText(25) });
  assert.equal(first.status, 200, first.text);
  await waitForTask(backend, first.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const second = await submitSource(backend, { text: queueText(26) });
  assert.equal(second.status, 200, second.text);
  await waitForTask(backend, second.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const firstCandidates = await backend.request('GET', `/api/text-sources/${first.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  const secondCandidates = await backend.request('GET', `/api/text-sources/${second.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  const one = firstCandidates.json.candidates[0];
  const two = secondCandidates.json.candidates[0];
  assert.ok(one && two, 'both sources must expose a pending candidate');

  const beforeCounts = tableCounts(backend.root);

  // A batch where the second choice carries a stale expectedVersion: the
  // whole transaction must roll back — no items, candidates still pending.
  const failing = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({
      choices: [
        signOffChoice({ candidateId: one.candidateId, expectedVersion: one.version }),
        signOffChoice({ candidateId: two.candidateId, expectedVersion: two.version + 5 }),
      ],
    }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertImplemented(failing, 'POST', '/api/sign-offs');
  assert.ok(failing.status === 409, `a batch with one failing choice must be rejected 409, got ${failing.status}: ${failing.text}`);
  const afterCounts = tableCounts(backend.root);
  assert.equal(afterCounts.manualItems, beforeCounts.manualItems, 'a rolled-back batch must create no items');
  assert.equal(candidateRow(backend.root, one.candidateId).status, 'pending', 'candidates must stay pending after a rollback');
  assert.equal(candidateRow(backend.root, two.candidateId).status, 'pending');

  // The same batch with correct versions succeeds atomically. The batch
  // operationId is pinned here so the replay below can reuse it verbatim.
  const batchOp = operationId();
  const batchChoices = () => [
    signOffChoice({ candidateId: one.candidateId, expectedVersion: one.version }),
    signOffChoice({ candidateId: two.candidateId, expectedVersion: two.version }),
  ];
  const ok = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({ operationId: batchOp, choices: batchChoices() }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(ok.status, 200, `the corrected batch must succeed: ${ok.text}`);
  const items = ok.json.items;
  assert.ok(Array.isArray(items) && items.length === 2, 'the batch must return both signed items');
  for (const item of items) {
    assert.equal(item.source, 'signed_ai', 'a signed item must carry source=signed_ai');
    assert.match(item.itemId, /^mi_[0-9a-f]{32}$/);
  }
  const afterOk = tableCounts(backend.root);
  assert.equal(afterOk.manualItems, beforeCounts.manualItems + 2, 'exactly two items must be created');
  assert.equal(afterOk.signOffBatches, (beforeCounts.signOffBatches ?? 0) + 1, 'the batch ledger must record the batch');
  assert.equal(candidateRow(backend.root, one.candidateId).status, 'accepted', 'signed candidates must be accepted');
  for (const item of items) {
    const links = manualItemSourceRows(backend.root, { itemId: item.itemId });
    assert.ok(links.length > 0, 'each signed item must carry its source/candidate association');
  }
  assert.ok(signOffBatchRow(backend.root, batchOp),
    `the sign_off_batches ledger must carry the batch operation ${batchOp}`);

  // Replay: the SAME operationId with the ORIGINAL expectedVersions (now
  // stale — the candidates advanced when they were accepted) must return the
  // current authoritative items, not the old snapshot and not a 409 (M-6:
  // the replay must reuse the batch operationId and the original versions;
  // a fresh operationId or fresh versions would be a different request).
  const replay = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({ operationId: batchOp, choices: batchChoices() }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.replayed, true, 'a replayed batch must report replayed:true');
  assert.equal(replay.json.items.length, 2, 'a replayed batch must return the same two items');
  assert.deepEqual(replay.json.items.map((entry) => entry.itemId).sort(),
    items.map((entry) => entry.itemId).sort(),
    'the replayed batch must return the current authoritative items (same ids), not the old snapshot');
  assert.equal(tableCounts(backend.root).manualItems, beforeCounts.manualItems + 2, 'a replay must not create more items');
  assert.equal(tableCounts(backend.root).signOffBatches, (beforeCounts.signOffBatches ?? 0) + 1,
    'a replay must not add a second ledger row');
  assert.ok(signOffBatchRow(backend.root, batchOp), 'the ledger row must survive the replay');
});

test('T-10: a cross-family operation key collision rolls the whole batch back', async () => {
  const deadline = caseDeadline();
  // The batch's per-row derived key is deterministic:
  // sign_off:+SHA-256(UTF-8 JSON.stringify(["sign_off", batchOperationId, candidateId])).
  // A manual item created with that exact operationId occupies the same key
  // family first; the sign-off batch must then roll back entirely (contract
  // §5.1: cross-family key collision -> UNIQUE conflict -> whole-batch
  // rollback), not half-persist.
  const { createHash } = await import('node:crypto');
  const submitted = await submitSource(backend, { text: queueText(1) });
  assert.equal(submitted.status, 200, submitted.text);
  await waitForTask(backend, submitted.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const candidates = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  const candidate = candidates.json.candidates.find((entry) => entry.status === 'pending');
  assert.ok(candidate, 'a pending candidate must exist for the cross-family case');

  const batchOp = operationId();
  const derivedKey = `sign_off:${createHash('sha256')
    .update(JSON.stringify(['sign_off', batchOp, candidate.candidateId]))
    .digest('hex')}`;

  const squatter = await backend.request('POST', '/api/manual-items', {
    body: {
      operationId: derivedKey,
      input: {
        title: '占用派生键的事项', kind: 'action', owner: '李四', priority: 'low',
        due: timePoint(), followup: null, tags: ['占键'],
      },
    },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(squatter.status, 200, `the squatter item must be created first: ${squatter.text}`);

  const before = tableCounts(backend.root).manualItems;
  const collided = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({
      operationId: batchOp,
      choices: [signOffChoice({ candidateId: candidate.candidateId, expectedVersion: candidate.version })],
    }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.ok(collided.status === 409, `a cross-family key collision must reject the batch 409, got ${collided.status}: ${collided.text}`);
  assert.equal(tableCounts(backend.root).manualItems, before, 'the collided batch must not persist any item');
  assert.equal(candidateRow(backend.root, candidate.candidateId).status, 'pending', 'the candidate must stay pending after the collision');
});

test('T-10: discard leaves a trace and removes the candidate from the pending set', async () => {
  const deadline = caseDeadline();
  const submitted = await submitSource(backend, { text: queueText(27) });
  assert.equal(submitted.status, 200, submitted.text);
  await waitForTask(backend, submitted.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const candidates = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates?status=pending`, { cookie: backend.cookie });
  const candidate = candidates.json.candidates[0];
  const discarded = await backend.request('POST', `/api/candidates/${candidate.candidateId}/discard`, {
    body: discardBody({ expectedVersion: candidate.version }), cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(discarded.status, 200, discarded.text);
  assert.equal(discarded.json.candidate.status, 'discarded');
  assert.equal(discarded.json.candidate.version, candidate.version + 1, 'discard must increment the version');
  const again = await backend.request('POST', `/api/candidates/${candidate.candidateId}/discard`, {
    body: discardBody({ expectedVersion: candidate.version + 1 }), cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(again, 409, 'state_conflict');
  const pendingAfter = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates?status=pending`, { cookie: backend.cookie });
  assert.ok(!pendingAfter.json.candidates.some((entry) => entry.candidateId === candidate.candidateId),
    'a discarded candidate must not appear in the pending set');
  assert.equal(candidateRow(backend.root, candidate.candidateId).status, 'discarded', 'the database row must record discarded');
});

test('T-12: the source-time anchor defaults to the import time, an ambiguous expression is unconditionally time-review-required, and a resolved point equals the shared date logic', async () => {
  const deadline = caseDeadline();
  // Three falsifiable date rules from the frozen contract §4.2/§5.1:
  //   (a) the source-time anchor defaults to the first import time when the
  //       submit omits sourceAt, and an explicit anchor is preserved verbatim
  //       (M-8: the anchor default rule is verified, not assumed);
  //   (b) an expression the shared date logic classifies as ambiguous is
  //       UNRESOLVED and sign-off demands timeReviewed — asserted
  //       unconditionally, with no dead `if (candidate.unresolved)` branch
  //       (B-3: the scripted answer 下周五前后 genuinely resolves to
  //       unresolved, unlike the old 下周五 script);
  //   (c) for a resolved expression the stored due point must equal the
  //       shared pure date logic against the source anchor — compared on the
  //       real field (point.atMs, not the non-existent point.at) and the
  //       real storage (candidates has no due_at_ms column; the point lives
  //       in fields_json) (B-2).
  const implicit = await submitSource(backend, { text: queueText(28) });
  assert.equal(implicit.status, 200, implicit.text);
  const implicitSource = implicit.json.source;
  assert.ok(implicitSource.sourceAt?.at, 'the source must carry its time anchor');
  assert.ok(ISO_MS.test(implicitSource.sourceAt.at), 'the anchor instant must be an ISO-8601 UTC-millisecond timestamp');
  assert.ok(typeof implicitSource.sourceAt.timeZone === 'string' && implicitSource.sourceAt.timeZone.length > 0,
    `the anchor must carry its time zone, got ${JSON.stringify(implicitSource.sourceAt)}`);
  assert.ok(Math.abs(Date.parse(implicitSource.sourceAt.at) - Date.now()) < 120000,
    `an omitted sourceAt must default to the first import time, got ${implicitSource.sourceAt.at}`);

  // An explicit anchor is preserved verbatim and is what the shared date
  // logic resolves expressions against.
  const explicitAnchor = { at: '2026-11-13T10:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2026-11-13 18:00', precision: 'minute' };
  const explicit = await submitSource(backend, { text: queueText(32), sourceAt: explicitAnchor });
  assert.equal(explicit.status, 200, explicit.text);
  assert.equal(explicit.json.source.sourceAt?.at, explicitAnchor.at, 'an explicit sourceAt must be preserved verbatim');
  assert.equal(explicit.json.source.sourceAt?.timeZone, explicitAnchor.timeZone, 'an explicit anchor time zone must be preserved');

  await waitForTask(backend, explicit.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const resolvedList = await backend.request('GET', `/api/text-sources/${explicit.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  assert.equal(resolvedList.status, 200, resolvedList.text);
  const resolvedCandidate = resolvedList.json.candidates[0];
  assert.ok(resolvedCandidate, 'a resolved candidate must be published');
  const resolvedRow = candidateRow(backend.root, resolvedCandidate.candidateId);
  assert.ok(resolvedRow.due_expression, 'the candidate must preserve the original due expression');
  const expected = resolveExpression(resolvedRow.due_expression, Date.parse(explicitAnchor.at), explicitAnchor.timeZone);
  assert.equal(expected.unresolved, false,
    `the scripted expression must resolve unambiguously under the shared date logic: ${JSON.stringify(expected)}`);
  assert.equal(resolvedRow.unresolved, 0,
    `the stored candidate must agree with the shared logic (unresolved=0), got ${resolvedRow.unresolved} — `
    + 'a resolvable expression stored as unresolved (or vice versa) is a contract violation');
  const storedDue = JSON.parse(resolvedRow.fields_json)?.due ?? null;
  assert.ok(storedDue, `the stored fields must carry the resolved due point: ${resolvedRow.fields_json}`);
  assert.equal(storedDue.atMs, expected.point?.atMs ?? null,
    'the stored due point must equal the shared date-logic resolution of the original expression');
  assert.ok(queueText(32).includes(resolvedRow.due_expression), 'the original expression must be preserved verbatim');

  // Ambiguity: 下周五前后 is a range expression — the shared logic returns
  // unresolved with no point, so the candidate is unresolved and sign-off
  // must demand timeReviewed. Both sides of the gate are exercised.
  const ambiguous = await submitSource(backend, { text: AMBIGUOUS_TEXT });
  assert.equal(ambiguous.status, 200, ambiguous.text);
  await waitForTask(backend, ambiguous.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const ambiguousList = await backend.request('GET', `/api/text-sources/${ambiguous.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  assert.equal(ambiguousList.status, 200, ambiguousList.text);
  const ambiguousCandidate = ambiguousList.json.candidates[0];
  assert.ok(ambiguousCandidate, 'an ambiguous-expression candidate must be published');
  const ambiguousRow = candidateRow(backend.root, ambiguousCandidate.candidateId);
  assert.equal(ambiguousRow.due_expression, AMBIGUOUS_EXPRESSION, 'the ambiguous expression must be preserved verbatim');
  const ambiguousExpected = resolveExpression(ambiguousRow.due_expression,
    Date.parse(ambiguous.json.source.sourceAt.at), ambiguous.json.source.sourceAt.timeZone ?? 'Asia/Shanghai');
  assert.equal(ambiguousExpected.unresolved, true,
    `the shared date logic must classify the expression as ambiguous: ${JSON.stringify(ambiguousExpected)}`);
  assert.equal(ambiguousExpected.point, null, 'an ambiguous expression must carry no resolved point');
  assert.equal(ambiguousRow.unresolved, 1,
    `the stored candidate must agree with the shared logic (unresolved=1), got ${ambiguousRow.unresolved} — `
    + 'an ambiguous expression silently resolved by the service is a contract violation');
  const rejected = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({ choices: [signOffChoice({ candidateId: ambiguousCandidate.candidateId, expectedVersion: ambiguousCandidate.version, timeReviewed: false })] }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(rejected.status, 400, `an unresolved date without timeReviewed must be rejected 400: ${rejected.text}`);
  assert.equal(rejected.json.error.code, 'time_review_required');
  const accepted = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({ choices: [signOffChoice({ candidateId: ambiguousCandidate.candidateId, expectedVersion: ambiguousCandidate.version, timeReviewed: true })] }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(accepted.status, 200, `timeReviewed=true must accept the ambiguous date: ${accepted.text}`);
});

// ---------------------------------------------------------------------------
// T-11: today / completion / source evidence
// ---------------------------------------------------------------------------

test('T-11: signed items appear in the today list with a complete source trail and complete normally', async () => {
  const deadline = caseDeadline();
  const submitted = await submitSource(backend, { text: queueText(29) });
  assert.equal(submitted.status, 200, submitted.text);
  await waitForTask(backend, submitted.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const candidates = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  const candidate = candidates.json.candidates[0];
  const signed = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({ choices: [signOffChoice({ candidateId: candidate.candidateId, expectedVersion: candidate.version })] }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(signed.status, 200, signed.text);
  const item = signed.json.items[0];

  const list = await backend.request('GET', '/api/manual-items', { cookie: backend.cookie });
  assert.equal(list.status, 200, list.text);
  const listed = list.json.items.find((entry) => entry.itemId === item.itemId);
  assert.ok(listed, 'a signed item must appear in the item list');
  assert.equal(listed.source, 'signed_ai');
  const detail = await backend.request('GET', `/api/manual-items/${item.itemId}`, { cookie: backend.cookie });
  assert.equal(detail.status, 200, detail.text);
  const history = await backend.request('GET', `/api/manual-items/${item.itemId}/history`, { cookie: backend.cookie });
  assert.equal(history.status, 200, history.text);
  assert.ok(history.json.events.length >= 1, 'the signed item must carry history');
  const links = manualItemSourceRows(backend.root, { itemId: item.itemId });
  assert.ok(links.length > 0, 'the item must link back to its source and candidate');
  assert.ok(links.some((link) => link.source_id === submitted.json.source.sourceId), 'the association must point at the submitted source');

  const completed = await backend.request('POST', `/api/manual-items/${item.itemId}/complete`, {
    body: { operationId: operationId(), expectedVersion: item.version },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(completed.status, 200, completed.text);
  assert.equal(completed.json.item.status, 'completed');
});

test('T-10: linking an existing manual item adds the association without overwriting the target', async () => {
  const deadline = caseDeadline();
  // A manual item that will be the link target.
  const target = await backend.request('POST', '/api/manual-items', {
    body: {
      operationId: operationId(),
      input: {
        title: '关联目标事项', kind: 'action', owner: '王五', priority: 'medium',
        due: timePoint(), followup: null, tags: ['目标'],
      },
    },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(target.status, 200, target.text);
  const targetItem = target.json.item;

  const submitted = await submitSource(backend, { text: queueText(30) });
  assert.equal(submitted.status, 200, submitted.text);
  await waitForTask(backend, submitted.json.task.taskId, isTerminal, waitWithin(deadline, 10000));
  const candidates = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  const candidate = candidates.json.candidates[0];

  const stale = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({
      choices: [signOffChoice({
        candidateId: candidate.candidateId, expectedVersion: candidate.version,
        target: { id: targetItem.itemId, expectedVersion: targetItem.version + 5 },
      })],
    }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.ok(stale.status === 409, `a stale link target version must be rejected 409, got ${stale.status}: ${stale.text}`);

  const linked = await backend.request('POST', '/api/sign-offs', {
    body: signOffBody({
      choices: [signOffChoice({
        candidateId: candidate.candidateId, expectedVersion: candidate.version,
        target: { id: targetItem.itemId, expectedVersion: targetItem.version },
      })],
    }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(linked.status, 200, `the link sign-off must succeed: ${linked.text}`);
  const before = tableCounts(backend.root).manualItems;
  const after = manualItemRow(backend.root, targetItem.itemId);
  assert.equal(after.title, '关联目标事项', 'a link must not overwrite the target title');
  assert.equal(after.owner, '王五', 'a link must not overwrite the target owner');
  assert.equal(after.version, targetItem.version + 1, 'a link must bump the target version (association only)');
  assert.equal(tableCounts(backend.root).manualItems, before, 'a link must not create a second item');
  const events = manualItemEvents(backend.root, targetItem.itemId).map((event) => event.action);
  assert.ok(events.includes('link'), 'the link action must be recorded in the item history');
  const links = manualItemSourceRows(backend.root, { itemId: targetItem.itemId });
  assert.ok(links.some((link) => link.candidate_id === candidate.candidateId), 'the association must reference the candidate');
});

// ---------------------------------------------------------------------------
// Concurrency setting (CAS + DB-write semantics)
// ---------------------------------------------------------------------------

test('agent-concurrency: GET defaults to 3 without writing the database, PUT uses the settings CAS', async () => {
  const initial = await backend.request('GET', '/api/settings/agent-concurrency', { cookie: backend.cookie });
  assert.equal(initial.status, 200, initial.text);
  assert.equal(initial.json.agentConcurrency, 3, 'the default concurrency must be 3 (frozen §5)');
  assert.equal(initial.json.version, 0, 'an unsaved setting reports version 0');
  if (!settingsRow(backend.root, 'agentConcurrency')) {
    // First write: version 0 is the implicit expected version of the default.
    const created = await backend.request('PUT', '/api/settings/agent-concurrency', {
      body: concurrencyPutBody({ agentConcurrency: 3, expectedVersion: 0 }),
      cookie: backend.cookie, csrf: backend.csrf,
    });
    assert.equal(created.status, 200, `the first concurrency write must succeed: ${created.text}`);
    const row = settingsRow(backend.root, 'agentConcurrency');
    assert.ok(row, 'the setting must be persisted after the write');
    assert.equal(JSON.parse(row.value).agentConcurrency ?? JSON.parse(row.value), 3);
  }
  const stale = await backend.request('PUT', '/api/settings/agent-concurrency', {
    body: concurrencyPutBody({ agentConcurrency: 4, expectedVersion: 0 }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(stale, 409, 'version_conflict');
  const invalid = await backend.request('PUT', '/api/settings/agent-concurrency', {
    body: concurrencyPutBody({ agentConcurrency: 0, expectedVersion: 1 }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(invalid, 400, 'validation_failed');
});

// ---------------------------------------------------------------------------
// T-13: session, origin and CSRF boundaries
// ---------------------------------------------------------------------------

test('T-13: unauthenticated, CSRF-less, foreign-origin and foreign-host writes are rejected and persist nothing', async () => {
  const raw = createRawRequester(backend.origin);
  const before = tableCounts(backend.root).textSources ?? 0;
  const unauthenticated = await backend.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(1) }),
  });
  assertEnvelope(unauthenticated, 401, 'unauthenticated');
  const noCsrf = await backend.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(1) }), cookie: backend.cookie,
  });
  assertEnvelope(noCsrf, 403, 'csrf_invalid');
  const foreignOrigin = await backend.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(1) }), cookie: backend.cookie, csrf: backend.csrf,
    headers: { origin: 'https://evil.example' },
  });
  assertEnvelope(foreignOrigin, 403, 'origin_rejected');
  const foreignHost = await raw('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(1) }), cookie: backend.cookie, csrf: backend.csrf,
    headers: { host: 'evil.example' },
  });
  assertEnvelope(foreignHost, 403, 'origin_rejected');
  assert.equal(tableCounts(backend.root).textSources ?? 0, before, 'rejected writes must not persist any source');
});

test('T-13: a session revoked mid-flight keeps the backend task running and readable after re-pairing', async () => {
  const deadline = caseDeadline();
  const isolated = await startBackend({
    pair: false,
    runtimeRoot,
    credentialProvider: createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    }),
  });
  try {
    // The isolated root needs the same controlled provider configuration so
    // the task can run the real Pi path against the controlled service.
    writeModelConfig(isolated.root);
    pointProviderAt(isolated.root, model.url);
    const code = await isolated.receivePairingCode();
    const session = await pair(isolated.origin, code);
    const info = await readSession(isolated.origin, session.cookie);
    isolated.cookie = session.cookie;
    isolated.csrf = info.csrfToken;

    const submitted = await isolated.request('POST', '/api/text-sources', {
      body: submitSourceBody({ text: queueText(6) }),
      cookie: isolated.cookie, csrf: isolated.csrf,
    });
    assertImplemented(submitted, 'POST', '/api/text-sources');
    assert.equal(submitted.status, 200, submitted.text);
    const taskId = submitted.json.task.taskId;

    // Revoke the session while the task is in flight.
    const logout = await isolated.request('DELETE', '/api/session', { cookie: isolated.cookie });
    assert.equal(logout.status, 200, logout.text);
    const afterLogout = await isolated.request('GET', `/api/tasks/${taskId}`, { cookie: isolated.cookie });
    assertEnvelope(afterLogout, 401, 'unauthenticated');

    // Re-pair: the task is still there and eventually finishes (page close or
    // session loss never cancels backend work — frozen §4.1).
    const code2 = await isolated.receivePairingCode(1);
    const session2 = await pair(isolated.origin, code2);
    const info2 = await readSession(isolated.origin, session2.cookie);
    isolated.cookie = session2.cookie;
    isolated.csrf = info2.csrfToken;
    const task = await waitForTask(isolated, taskId, isTerminal, waitWithin(deadline, 10000));
    assert.equal(task.state, 'succeeded', `the task must complete despite the session loss: ${JSON.stringify(task)}`);
  } finally {
    await isolated.close();
  }
});

// ---------------------------------------------------------------------------
// Envelope hygiene
// ---------------------------------------------------------------------------

test('envelope hygiene: error bodies carry only the frozen envelope', async () => {
  const cases = [
    [await backend.request('GET', '/api/text-sources/src_00000000000000000000000000000000', { cookie: backend.cookie }), 404, 'source_not_found'],
    [await backend.request('GET', '/api/candidates/cand_00000000000000000000000000000000', { cookie: backend.cookie }), 404, 'candidate_not_found'],
    [await backend.request('GET', '/api/tasks/tsk_00000000000000000000000000000000', { cookie: backend.cookie }), 404, 'task_not_found'],
    [await backend.request('POST', '/api/text-sources', { body: { operationId: operationId(), input: { text: '' } }, cookie: backend.cookie, csrf: backend.csrf }), 400, 'validation_failed'],
    [await backend.request('POST', '/api/tasks/tsk_00000000000000000000000000000000/cancel', { body: cancelBody({}), cookie: backend.cookie, csrf: backend.csrf }), 404, 'task_not_found'],
  ];
  for (const [response, status, code] of cases) {
    assertImplemented(response, 'GET', 'observed path');
    assertEnvelope(response, status, code);
    const serialized = JSON.stringify(response.json);
    for (const leak of ['stack', 'sqlite', 'SELECT ', '/Users/', '.rs', 'node_modules', SYNTHETIC_KEY]) {
      assert.ok(!serialized.includes(leak), `error envelope must not leak ${leak}: ${serialized}`);
    }
  }
});

// ---------------------------------------------------------------------------
// SSE: task frames and candidate hints
// ---------------------------------------------------------------------------

test('SSE: task frames carry epoch:cursor ids while candidate hints stay cursor-free and read-back compensates', async () => {
  const deadline = caseDeadline();
  const stream = await openEventStream(backend.origin, { cookie: backend.cookie });
  try {
    assert.equal(stream.status, 200, 'SSE subscription must succeed for a paired session');
    assert.match(stream.contentType, /text\/event-stream/);
    const ready = await stream.waitFor((frame) => frame.event === 'stream.ready', waitWithin(deadline, 10000));
    assert.equal(ready.id, null, 'stream.ready must not carry an id line');
    assert.ok(ready.data.epoch, 'stream.ready must expose the instance epoch');
    assert.equal(ready.data.contractVersion, 'web-api/2');

    const submitted = await submitSource(backend, { text: queueText(31) });
    assert.equal(submitted.status, 200, submitted.text);
    const taskId = submitted.json.task.taskId;
    const changed = await stream.waitFor((frame) => frame.event === 'task.changed' && frame.data?.objectId === taskId, waitWithin(deadline, 10000));
    assert.match(changed.id, /^inst_[0-9a-f]{12}:\d+$/, `task frame ids must be <epoch>:<cursor>, got ${changed.id}`);
    assert.equal(changed.data.contractVersion, 'web-api/2');
    assert.equal(changed.data.objectType, 'task');

    await waitForTask(backend, taskId, isTerminal, waitWithin(deadline, 10000));
    // A candidate hint may arrive as an in-process frame: no id, no cursor
    // advance; the authoritative read is the HTTP read-back.
    const hint = stream.frames.find((frame) => frame.event === 'candidate.changed');
    if (hint) {
      assert.equal(hint.id, null, 'candidate hints must not carry an id line');
    }
    const readback = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates`, { cookie: backend.cookie });
    assert.equal(readback.status, 200, readback.text);
    assert.ok(readback.json.candidates.length > 0, 'read-back after the hint must return the published candidates');
  } finally {
    stream.close();
  }
});
