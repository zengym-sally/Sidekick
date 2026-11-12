//! Real-chain safety regression for the W1 text-intake slice (MAYNE-24).
//!
//! Dispatch: MAYNE-24 coordination comment `01a1bed7-34ff-76c2-80b4-9099ac72bee9`
//! (Codex, 2026-11-09). Locked production input: Kimi I-branch tip
//! `681c2825bb053b740cc7fdfd7133e75384389139` (tree
//! `754b790811d8c09732463cafdf6e93d4feff0284`), imported from the source entry
//! `server/entries/web-backend-entry.mjs`.
//!
//! Every case runs the REAL chain: HTTP -> TaskScheduler -> WorkerHost ->
//! default bundled Pi organizer (build/s0-runtime) -> loopback controlled
//! model service -> real Rust storage adapter. No scripted worker, no
//! rewritten scheduling logic and no injected `proven_safe`. The only clock
//! control is the EXISTING `TaskService.now` property (a constructor option
//! the production entry does NOT pass — it relies on the default); it is
//! declared here and never extended with a production switch.
//!
//! Positive control: a real `test` task whose first attempt fails the runtime
//! output contract must auto-backoff under a backend trusted safety proof.
//! Before the backoff window elapses the deferred task must not be claimed;
//! after the window a new attempt must succeed and the attempt budget must
//! decrement. The current tree has NO real safety positive control: a
//! zero-receipt failure is never promoted to `proven_safe`, so
//! `maybeAutoRetry` routes it to `needs_review`. The target assertions are
//! therefore falsifiable RED and name the gap; they go green only when slice I
//! lands the trusted safety proof (a later, separately reviewed increment).
//!
//! Negative controls: (1) a real `extract` failure with zero receipts must
//! stay `unknown`/`needs_review`, and a client-carried proof field must not
//! change that judgment; (2) a `test` task run by a PRIVATE REPLACEMENT worker
//! factory (an execution source that is NOT credibly confirmed) must stay
//! `unknown`/`needs_review` even though it emits a legal-identity error frame
//! and zero receipts — the falsifiable guard against the shortcut
//! "test type + zero receipts => proven_safe"; (3) a `test` task run by the
//! DEFAULT factory through a temporary NON-audited runtime entry (a test-only
//! `organizer.mjs` with a marker bound to the current run, spawned because no
//! `workerProcessFactory` was supplied) must also stay `unknown`/`needs_review`
//! — the falsifiable guard against the shortcut "no replacement factory => the
//! real bundled Pi". The server-derived snapshot and the fixed no-tools `test`
//! path are asserted as the proof prerequisites.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, symlinkSync, copyFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { startWebBackend } from '../../server/entries/web-backend-entry.mjs';
import {
  resolveArtifacts,
  runtimeRootAvailable,
  bundledRuntimeRoot,
  createControlledCredentialProvider,
  pair,
  readSession,
  createRequester,
  pollUntil,
  writeEvidence,
  effectiveConfig,
} from '../fixtures/web-text-intake/backend-process.mjs';
import {
  startControlledModelService,
  writeScript,
  testAnswer,
  invalidAnswers,
  queueExtractAnswer,
} from '../fixtures/web-text-intake/controlled-model.mjs';
import {
  taskRow,
  attemptRows,
  candidateRows,
  observe,
} from '../fixtures/web-text-intake/db-observer.mjs';
import {
  submitSourceBody,
  queueText,
  SOURCE_TEXT,
  operationId as syntheticOperationId,
  ID_PATTERNS,
} from '../fixtures/web-text-intake/synthetic-inputs.mjs';

const SYNTHETIC_KEY = 'synthetic-web-text-intake-key-7f3a9c';
const CREDENTIAL_REF = 'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY';
const MODEL_ID = 'controlled-organizer-model';
const PROVIDER_ID = 'controlled-openai';
// Frozen case budget: the ticket freezes 20000ms per case (the aggregate runs
// `node --test --test-timeout=20000`, the W1 value). No case declares a larger
// budget; every wait derives from ONE per-case deadline. Heavy preparation
// (backend/model startup) stays in the before hook, the sanctioned exception.
const CASE_BUDGET_MS = 20000;
const CASE_MARGIN_MS = 2000;
const caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS;
const waitWithin = (deadline, capMs) => Math.max(250, Math.min(capMs, deadline - Date.now()));
// The bounded auto-backoff window is a production constant
// (server/lib/task-service.mjs AUTO_BACKOFF_MS = 60 * 1000). It is restated
// here only to advance the clock past it; no production switch is added.
const AUTO_BACKOFF_MS = 60 * 1000;
const repositoryRoot = resolve(import.meta.dirname, '..', '..');
let root;
let handle;
let taskService;
let request;
let cookie;
let csrf;
let model;
let scriptDir;
// The controlled clock. `TaskService.now` is the ONLY clock knob used.
let clock = Date.now();

async function swapScript(entries) {
  writeScript(scriptDir, entries);
  // The service re-reads the script when the file mtime changes; a short
  // bounded wait lets that land before the next request.
  await new Promise((done) => setTimeout(done, 30));
}

function writeModelConfig(baseUrl, configRoot = root) {
  // The frozen configuration DTO (server/lib/config-store.mjs): PROVIDER_FIELDS
  // = id, name, apiFormat, baseUrl, auth, enabled, ...; auth = { type,
  // apiKeyEnv?, apiKeyRef? }. `authMode`/`credentialRefs` are capability-view
  // output fields, never persisted input fields, and a provider without a
  // `name` is rejected before any task can run.
  const configDir = join(configRoot, 'config');
  mkdirSync(join(configDir, 'agents'), { recursive: true });
  writeFileSync(join(configDir, 'providers.json'), JSON.stringify({
    providers: [{
      id: PROVIDER_ID,
      name: 'Controlled OpenAI',
      apiFormat: 'openai-compatible',
      baseUrl,
      auth: { type: 'bearer', apiKeyRef: CREDENTIAL_REF },
      enabled: true,
    }],
  }, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(configDir, 'models.json'), JSON.stringify({
    models: [{
      id: MODEL_ID,
      providerId: PROVIDER_ID,
      apiModelId: MODEL_ID,
      name: 'Controlled organizer model',
      enabled: true,
      capabilities: { toolCall: true },
    }],
    sidekick: { version: 1, defaultModelId: MODEL_ID, revision: 'r1' },
  }, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(configDir, 'agents', 'organizer.json'), JSON.stringify({
    agentId: 'organizer',
    revision: 'r1',
    preferences: { detail: 'concise', focus: 'followups' },
    supplementalInstructions: '保留核对依据。',
  }, null, 2) + '\n', { mode: 0o600 });
}

/// A `test`-kind output-contract failure: the runtime contract requires exactly
/// `{ok:true}`, so `{ok:false}` is rejected as MODEL_INVALID_OUTPUT without any
/// candidate or tool path being involved.
const invalidTestAnswer = () => JSON.stringify({ ok: false });

/// Read-only receipt count for a set of attempts (the real storage adapter).
async function receiptCount(attempts) {
  if (attempts.length === 0) return 0;
  const ids = attempts.map((entry) => entry.attempt_id);
  const placeholders = ids.map(() => '?').join(',');
  return observe(root, (db) => db.prepare(
    `SELECT count(*) AS n FROM side_effect_receipts WHERE attempt_id IN (${placeholders})`,
  ).get(...ids).n);
}

/// Settle after the FIRST attempt has closed. The transient `failed` state is
/// deliberately excluded: the current backend moves `failed` -> `needs_review`
/// in a separate transaction, and the target backend moves `failed` -> `queued`;
/// both are observable stable states, while `failed` itself can be a sub-millisecond
/// window. A re-enqueued task (`queued`) is a valid settle state for the positive
/// control's target path.
async function settleAfterFirstAttempt(taskId, deadline, message) {
  return pollUntil(async () => {
    const response = await request('GET', `/api/tasks/${taskId}`, { cookie });
    assert.equal(response.status, 200, response.text);
    const resource = response.json.task ?? response.json;
    if (!['needs_review', 'queued', 'succeeded', 'cancelled'].includes(resource.state)) return null;
    return attemptRows(root, taskId).length >= 1 ? resource : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message });
}

/// The real storage adapter: the packaged build binary when present, else the
/// source-tree cargo artifact. An explicit WEB_TEXT_INTAKE_STORAGE_BIN wins.
function resolveStorageBinary() {
  const artifacts = resolveArtifacts();
  if (existsSync(artifacts.storageBin)) return artifacts.storageBin;
  const sourceTree = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');
  if (existsSync(sourceTree)) return sourceTree;
  throw new Error(
    `web-backend-storage binary not found at ${artifacts.storageBin} or ${sourceTree}; `
    + 'build it with cargo (slice I registers the [[bin]]) or point WEB_TEXT_INTAKE_STORAGE_BIN at it',
  );
}

before(async () => {
  assert.ok(runtimeRootAvailable(),
    'build/s0-runtime must contain the bundled organizer and node (npm run probe:bundle); '
    + 'the safety regression cannot run without the real Pi runtime');
  const storageBin = resolveStorageBinary();
  root = mkdtempSync(join(tmpdir(), 'web-text-intake-test-safety-'));
  const credentialProvider = createControlledCredentialProvider({
    [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
  });
  handle = await startWebBackend({
    root,
    port: 0,
    staticRoot: root,
    storageBin,
    runtimeRoot: bundledRuntimeRoot,
    initialize: true,
    credentialProvider,
  });
  // The production entry constructs TaskService WITHOUT passing `now` (it
  // relies on the default). Assigning that SAME existing instance property is
  // the only clock knob this regression uses; no production switch is added.
  taskService = handle.scheduler.taskService;
  // Start the controlled clock at the real clock so the un-patched
  // TextIntakeService/WorkerHost clocks and the TaskService clock agree
  // before any case advances it.
  clock = Date.now();
  taskService.now = () => clock;
  assert.equal(taskService.now(), clock, 'the existing TaskService.now property must control the clock');

  const session = await pair(handle.origin, handle.pairingCode);
  const info = await readSession(handle.origin, session.cookie);
  cookie = session.cookie;
  csrf = info.csrfToken;
  request = createRequester(handle.origin);

  scriptDir = join(root, 'model-script');
  const script = writeScript(scriptDir, [{ repeat: true, kind: 'sse', content: testAnswer() }]);
  model = await startControlledModelService({ script, record: join(root, 'model.jsonl') });
  writeModelConfig(model.url);
  writeEvidence('web-text-intake-test-safety-effective-config.json', effectiveConfig({
    suite: 'web-text-intake-test-safety',
    runtimeRoot: bundledRuntimeRoot,
    credentialRef: CREDENTIAL_REF,
    clockControl: 'TaskService.now (existing property)',
    lockedInput: '681c2825bb053b740cc7fdfd7133e75384389139',
  }));
}, { timeout: 90000 });

after(async () => {
  await model?.stop();
  await handle?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Negative control: zero receipts stay unknown/needs_review; a client proof
// field cannot change the judgment.
//
// Order matters: this case runs BEFORE the positive control because the
// positive control advances the TaskService clock past the auto-backoff
// window. The extract close-out stamps `ended_at` from the un-patched
// TextIntakeService clock, so a clock already advanced past the real clock
// would make `ended_at < started_at` and trip the task_attempts CHECK. Running
// the un-advanced case first keeps the two controls independent.
// ---------------------------------------------------------------------------

test('negative control: a real extract failure with zero receipts stays unknown/needs_review and a client proof field cannot change it', async (t) => {
  const deadline = caseDeadline();
  await swapScript([
    { kind: 'sse', content: invalidAnswers.evidenceNotSubstring() },
    { repeat: true, kind: 'sse', content: queueExtractAnswer() },
  ]);
  const before = model.requests().length;
  const submitted = await request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: SOURCE_TEXT }),
    cookie, csrf,
  });
  assert.equal(submitted.status, 200, `the source submit must succeed: ${submitted.text}`);
  const taskId = submitted.json.task?.taskId ?? submitted.json.taskId;
  assert.ok(taskId, `the submit response must carry the task: ${submitted.text}`);
  const task = await settleAfterFirstAttempt(taskId, deadline, 'the extract task to settle after its first attempt');
  const row = taskRow(root, taskId);
  const failure = row.failure ? JSON.parse(row.failure) : null;
  const attempts = attemptRows(root, taskId);
  const receipts = await receiptCount(attempts);
  const modelRequests = model.requests().slice(before);

  assert.equal(modelRequests.length, 1, 'the extract attempt must make exactly one model request');
  assert.equal(receipts, 0, 'the extract attempt must record zero side-effect receipts');
  assert.equal(task.state, 'needs_review',
    `a zero-receipt extract failure must isolate for review, got ${task.state}: ${JSON.stringify(task)}`);
  // The extract close-out currently maps every no-staging failure to the
  // registered `worker_lost` code (the scheduler drops the worker payload and
  // `confirmExtractExit` hardcodes the code). That mapping gap is registered
  // separately (Pi forensics `web-text-intake-fault-401-hang-20261109-pi-forensics.md`);
  // this regression pins the SAFETY judgment, not the code mapping.
  assert.equal(failure?.sideEffectSafety, 'unknown',
    'zero receipts must never be promoted to safe');
  assert.equal(failure?.cause, 'failure_unknown_side_effect',
    'the safety route must name the unknown-side-effect cause');
  assert.equal(await taskService.hasNonReadonlyReceipts(attempts[0].attempt_id), false,
    'the attempt must have no non-readonly receipt');
  assert.deepEqual(candidateRows(root, { sourceId: submitted.json.source.sourceId }), [],
    'no candidate may be persisted for the failed extract');

  // A client-carried proof field and a forged snapshot cannot change the
  // judgment: submit the same extract with a client `sideEffectSafety` and a
  // forged snapshot. The extract close-out derives the failure from the real
  // worker facts, so the judgment stays unknown/needs_review and the snapshot
  // stays server-derived. This negative control is stable across the current
  // and the target backend: the client field is never read as a proof.
  await swapScript([
    { kind: 'sse', content: invalidAnswers.evidenceNotSubstring() },
    { repeat: true, kind: 'sse', content: queueExtractAnswer() },
  ]);
  const forged = await request('POST', '/api/text-sources', {
    body: {
      operationId: syntheticOperationId(),
      input: {
        text: queueText(9),
        sideEffectSafety: 'proven_safe',
        snapshot: {
          provider: { id: 'rogue-provider' },
          model: { id: 'rogue-model' },
          agent: { agentId: 'organizer' },
        },
      },
    },
    cookie, csrf,
  });
  assert.equal(forged.status, 200, `the forged-proof submit must be accepted: ${forged.text}`);
  const forgedTaskId = forged.json.task?.taskId ?? forged.json.taskId;
  const forgedTask = await settleAfterFirstAttempt(forgedTaskId, deadline, 'the forged-proof extract to settle after its first attempt');
  assert.equal(forgedTask.state, 'needs_review',
    'a client proof field must not change the safety routing');
  const forgedRow = taskRow(root, forgedTaskId);
  const forgedFailure = JSON.parse(forgedRow.failure);
  assert.equal(forgedFailure?.sideEffectSafety, 'unknown',
    'a client-carried sideEffectSafety field must not reach the failure envelope');
  assert.equal(forgedFailure?.cause, 'failure_unknown_side_effect',
    'the client proof field must not change the safety cause');
  const forgedInputRef = JSON.parse(forgedRow.input_ref);
  assert.equal(forgedInputRef.snapshot?.provider?.id, PROVIDER_ID,
    'the client-carried snapshot must be ignored; the server-derived snapshot is the proof prerequisite');
  assert.equal(forgedInputRef.snapshot?.model?.id, MODEL_ID,
    'the server-derived snapshot must name the configured model');
});
// ---------------------------------------------------------------------------
// Positive control: real test-task output-contract failure -> auto-backoff
// ---------------------------------------------------------------------------

test('positive control: a real test-task output-contract failure auto-backoffs under a backend trusted safety proof', async (t) => {
  const deadline = caseDeadline();
  // The first model answer fails the runtime contract; every later answer is
  // the valid `{ok:true}`, so a second attempt can genuinely succeed.
  await swapScript([
    { kind: 'sse', content: invalidTestAnswer() },
    { repeat: true, kind: 'sse', content: testAnswer() },
  ]);
  const before = model.requests().length;
  const submitted = await request('POST', '/api/tasks', {
    body: {
      operationId: syntheticOperationId(),
      type: 'test',
      role: 'organizer',
      input: { modelId: MODEL_ID },
    },
    cookie, csrf,
  });
  assert.equal(submitted.status, 202, `the test task submit must be accepted: ${submitted.text}`);
  const taskId = submitted.json.taskId;
  assert.match(taskId, ID_PATTERNS.task);
  const task = await settleAfterFirstAttempt(taskId, deadline, 'the test task to settle after its first attempt');
  const row = taskRow(root, taskId);
  const failure = row.failure ? JSON.parse(row.failure) : null;
  const attempts = attemptRows(root, taskId);
  const receipts = await receiptCount(attempts);
  const modelRequests = model.requests().slice(before);

  // --- Observed facts: the real chain really ran the fixed no-tools path ---
  assert.equal(modelRequests.length, 1, 'the first attempt must make exactly one model request');
  assert.equal(modelRequests[0].hasTools, false,
    'the fixed test-kind path must not carry tools (the no-tools proof prerequisite)');
  assert.equal(receipts, 0, 'a no-tools test attempt must record zero side-effect receipts');
  assert.equal(attempts.length, 1, 'the first attempt must be recorded');
  assert.equal(attempts[0].exit_reason, 'confirmed', 'the worker tree exit must be confirmed');
  const inputRef = JSON.parse(row.input_ref);
  assert.equal(inputRef.snapshot?.provider?.id, PROVIDER_ID,
    'the snapshot must be server-derived from the configuration, not client-carried');
  assert.equal(inputRef.snapshot?.model?.id, MODEL_ID,
    'the snapshot must name the configured model');
  assert.equal(failure?.code, 'output_contract_invalid',
    'a runtime output-contract failure must map to the frozen output_contract_invalid code');
  assert.equal(failure?.retryable, 'auto_backoff',
    'the frozen registry must mark output_contract_invalid as auto_backoff');

  // --- Target: the backend trusted safety proof and the auto-backoff path ---
  // GAP-TEST-SAFETY-1: the current backend has no trusted safety proof for a
  // zero-receipt test failure, so maybeAutoRetry routes it to needs_review
  // instead of auto-backoff. This assertion is falsifiable RED until slice I
  // lands the safety proof; the observed facts above are the harness evidence.
  assert.equal(failure?.sideEffectSafety, 'proven_safe',
    'GAP-TEST-SAFETY-1: the backend has no trusted safety proof for a zero-receipt test failure, '
    + 'so maybeAutoRetry routes it to needs_review instead of auto-backoff; '
    + `observed state=${task.state} failure=${JSON.stringify(failure)}`);
  assert.equal(task.state, 'queued',
    'GAP-TEST-SAFETY-1: a proven-safe auto_backoff failure must re-enqueue, '
    + `observed state=${task.state}`);
  assert.ok(row.next_attempt_at > clock,
    'the re-enqueued task must carry a next_attempt_at past the current clock');

  // Before the backoff window elapses the deferred task must not be claimed.
  const attemptsBefore = attemptRows(root, taskId).length;
  await new Promise((done) => setTimeout(done, waitWithin(deadline, 600)));
  assert.equal(attemptRows(root, taskId).length, attemptsBefore,
    'the deferred task must not be claimed before the backoff window elapses');

  // Advance the clock past the window with the SAME TaskService.now knob; the
  // scheduler then claims the task and the second attempt succeeds against the
  // standing valid answer.
  clock += AUTO_BACKOFF_MS + 1000;
  const retried = await pollUntil(async () => {
    const response = await request('GET', `/api/tasks/${taskId}`, { cookie });
    assert.equal(response.status, 200, response.text);
    const resource = response.json.task ?? response.json;
    return resource.state === 'succeeded' ? resource : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'the retried test task to succeed' });
  assert.equal(retried.state, 'succeeded',
    'the post-backoff attempt must succeed against the standing valid answer');
  const afterRow = taskRow(root, taskId);
  assert.ok(afterRow.attempt_budget < 3,
    `the attempt budget must decrement and stay within budget (got ${afterRow.attempt_budget})`);
  assert.equal(attemptRows(root, taskId).length, 2,
    'the retry must create exactly one new attempt');
  assert.equal(await receiptCount(attemptRows(root, taskId)), 0,
    'the no-tools retry must still record zero receipts');
});

// ---------------------------------------------------------------------------
// Negative control: a `test` task run by a PRIVATE REPLACEMENT worker factory
// (an execution source that is NOT credibly confirmed) must stay
// unknown/needs_review.
//
// This is the falsifiable guard against the shortcut "test type + zero
// receipts => proven_safe". The stub emits ONE legal-identity error frame
// (runId + hostNonce echoed, a registered model error code) and zero tool/MCP
// receipts — exactly the shape a type-only shortcut would promote — but the
// execution source is a test double, not the bundled Pi. The real-Pi positive
// control above keeps the default factory and is never signed off by this stub.
// ---------------------------------------------------------------------------

test('negative control: a test task run by a private replacement worker factory (untrusted execution source) stays unknown/needs_review', async (t) => {
  const deadline = caseDeadline();
  const stubRoot = mkdtempSync(join(tmpdir(), 'web-text-intake-test-safety-untrusted-'));
  const stubWorkerPath = join(import.meta.dirname, '..', 'fixtures', 'web-text-intake', 'test-safety-stub-worker.mjs');
  let stubBackend = null;
  let stubInvocations = 0;
  try {
    // A valid model configuration is required so the scheduler launches a
    // worker instead of failing with a configuration-class code (which carries
    // proven_safe and would make this control vacuous). The stub never calls
    // the model, so the baseUrl is a dead loopback port.
    writeModelConfig('http://127.0.0.1:9/v1', stubRoot);
    const credentialProvider = createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    });
    stubBackend = await startWebBackend({
      root: stubRoot,
      port: 0,
      staticRoot: stubRoot,
      storageBin: resolveStorageBinary(),
      runtimeRoot: bundledRuntimeRoot,
      initialize: true,
      credentialProvider,
      workerProcessFactory: (file, args, options) => {
        stubInvocations += 1;
        // Same argv shape as the real runtime (the `--run` marker survives for
        // exit verification); only the payload binary is the test double.
        return spawn(process.execPath, [stubWorkerPath, ...args.slice(1)], options);
      },
    });
    const session = await pair(stubBackend.origin, stubBackend.pairingCode);
    const info = await readSession(stubBackend.origin, session.cookie);
    const stubRequest = createRequester(stubBackend.origin);

    const submitted = await stubRequest('POST', '/api/tasks', {
      body: {
        operationId: syntheticOperationId(),
        type: 'test',
        role: 'organizer',
        input: { modelId: MODEL_ID },
      },
      cookie: session.cookie, csrf: info.csrfToken,
    });
    assert.equal(submitted.status, 202, `the test task submit must be accepted: ${submitted.text}`);
    const taskId = submitted.json.taskId;
    assert.match(taskId, ID_PATTERNS.task);

    // `failed` is a TRANSIENT state here: `confirmExit` commits it and
    // `maybeAutoRetry` then moves the task to `needs_review` (or `queued` under
    // a shortcut). Polling must wait for that final state, never settle on the
    // transient `failed`, or the control would race the safety route.
    const task = await pollUntil(async () => {
      const response = await stubRequest('GET', `/api/tasks/${taskId}`, { cookie: session.cookie });
      assert.equal(response.status, 200, response.text);
      const resource = response.json.task ?? response.json;
      if (!['needs_review', 'queued', 'succeeded', 'cancelled'].includes(resource.state)) return null;
      return attemptRows(stubRoot, taskId).length >= 1 ? resource : null;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'the untrusted-source test task to settle' });

    const row = taskRow(stubRoot, taskId);
    const failure = JSON.parse(row.failure);
    const attempts = attemptRows(stubRoot, taskId);
    const receipts = await receiptCount(attempts);

    // The private replacement factory really ran the worker; the real Pi was
    // never spawned for this backend.
    assert.equal(stubInvocations, 1, 'the private replacement factory must have run the worker (not the real Pi)');
    assert.equal(attempts.length, 1, 'the first attempt must be recorded');
    assert.equal(attempts[0].exit_reason, 'confirmed', 'the stub worker tree exit must be confirmed');
    assert.equal(receipts, 0, 'the stub attempt must record zero side-effect receipts');
    // The legal-identity error frame was really received and mapped to the
    // frozen code; the registry marks it auto_backoff, so a type-only shortcut
    // would auto-requeue it.
    assert.equal(failure.code, 'output_contract_invalid',
      'the legal-identity error frame must map to the frozen output_contract_invalid code');
    assert.equal(failure.retryable, 'auto_backoff',
      'the frozen registry must mark output_contract_invalid as auto_backoff');
    // The untrusted execution source must never be promoted to safe: the task
    // isolates for review instead of auto-requeueing.
    assert.equal(failure.sideEffectSafety, 'unknown',
      'an untrusted execution source must never be promoted to proven_safe');
    assert.equal(task.state, 'needs_review',
      `an untrusted execution source must isolate for review, not auto-requeue, got ${task.state}: ${JSON.stringify(task)}`);
    assert.equal(failure.cause, 'failure_unknown_side_effect',
      'the safety route must name the unknown-side-effect cause');
    assert.deepEqual(candidateRows(stubRoot, {}), [],
      'no candidate may be persisted for a test task');
  } finally {
    await stubBackend?.close();
    rmSync(stubRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Negative control: a `test` task run by the DEFAULT factory through a
// temporary NON-audited runtime entry must stay unknown/needs_review.
//
// This is the falsifiable guard against the shortcut "no replacement factory =>
// the real bundled Pi". The case starts a SECOND backend on its own temporary
// root with NO `workerProcessFactory` and a temporary runtimeRoot whose `node`
// is a symlink to the system node and whose `organizer.mjs` is the test-only
// entry (the reviewed stub worker plus a marker write). The default factory
// derives and spawns that entry; the marker — bound to the runId/hostNonce of
// the frozen stdio request line and cross-checked against the backend's own
// worker record — proves the default factory really executed the non-audited
// entry for THIS run. The entry emits ONE legal-identity error frame and zero
// receipts, and the tree exit is confirmed: exactly the shape a type-only
// shortcut would promote. The execution source is not credibly confirmed, so
// the task must isolate for review instead of auto-requeueing.
//
// GAP-TEST-SAFETY-2: the current backend checks only `replacementFactory`, so
// the default factory's non-audited entry is granted `proven_safe` and the task
// auto-requeues. This assertion is falsifiable RED until slice I binds the
// actual node/entry product identity before granting the proof.
// ---------------------------------------------------------------------------

test('negative control: a test task run by the default factory through a temporary non-audited runtime entry stays unknown/needs_review', async (t) => {
  const deadline = caseDeadline();
  const caseRoot = mkdtempSync(join(tmpdir(), 'web-text-intake-test-safety-default-factory-'));
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'web-text-intake-test-safety-runtime-'));
  const entryPath = join(import.meta.dirname, '..', 'fixtures', 'web-text-intake', 'test-safety-runtime-entry.mjs');
  const markerPath = join(caseRoot, 'test-safety-runtime-entry.marker.json');
  let caseBackend = null;
  try {
    // The temporary runtime layout the DEFAULT factory will derive: `node` is
    // the system node (a symlink), `organizer.mjs` is the test-only entry.
    // No `workerProcessFactory` is supplied, so WorkerHost uses `spawn`.
    symlinkSync(process.execPath, join(runtimeRoot, 'node'));
    copyFileSync(entryPath, join(runtimeRoot, 'organizer.mjs'));
    // A valid model configuration is required so the scheduler launches a
    // worker instead of failing with a configuration-class code (which carries
    // proven_safe and would make this control vacuous). The entry never calls
    // the model, so the baseUrl is a dead loopback port.
    writeModelConfig('http://127.0.0.1:9/v1', caseRoot);
    const credentialProvider = createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    });
    caseBackend = await startWebBackend({
      root: caseRoot,
      port: 0,
      staticRoot: caseRoot,
      storageBin: resolveStorageBinary(),
      runtimeRoot,
      initialize: true,
      credentialProvider,
    });
    const session = await pair(caseBackend.origin, caseBackend.pairingCode);
    const info = await readSession(caseBackend.origin, session.cookie);
    const caseRequest = createRequester(caseBackend.origin);

    const submitted = await caseRequest('POST', '/api/tasks', {
      body: {
        operationId: syntheticOperationId(),
        type: 'test',
        role: 'organizer',
        input: { modelId: MODEL_ID },
      },
      cookie: session.cookie, csrf: info.csrfToken,
    });
    assert.equal(submitted.status, 202, `the test task submit must be accepted: ${submitted.text}`);
    const taskId = submitted.json.taskId;
    assert.match(taskId, ID_PATTERNS.task);

    // `failed` is a TRANSIENT state: `confirmExit` commits it and
    // `maybeAutoRetry` then moves the task to `needs_review` (or `queued` under
    // a shortcut). Polling must wait for that final state, never settle on the
    // transient `failed`, or the control would race the safety route.
    const task = await pollUntil(async () => {
      const response = await caseRequest('GET', `/api/tasks/${taskId}`, { cookie: session.cookie });
      assert.equal(response.status, 200, response.text);
      const resource = response.json.task ?? response.json;
      if (!['needs_review', 'queued', 'succeeded', 'cancelled'].includes(resource.state)) return null;
      return attemptRows(caseRoot, taskId).length >= 1 ? resource : null;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'the default-factory non-audited-entry test task to settle' });

    // The marker proves the DEFAULT factory really executed the non-audited
    // entry for THIS run. It is cross-checked against the backend's own worker
    // record (runId/hostNonce/pid), so a pre-existing marker or a path-only
    // check cannot stand in for the execution fact.
    const marker = await pollUntil(async () => {
      if (!existsSync(markerPath)) return null;
      try { return JSON.parse(readFileSync(markerPath, 'utf8')); } catch { return null; }
    }, { timeoutMs: waitWithin(deadline, 5000), message: 'the temporary runtime entry marker' });
    assert.equal(marker.marker, 'test-safety-runtime-entry',
      'the marker must come from the test-only runtime entry');
    const workerRecord = JSON.parse(readFileSync(join(caseRoot, 'runs', marker.runId, 'worker.json'), 'utf8'));
    assert.equal(marker.runId, workerRecord.runId,
      'the marker must be bound to the run the backend spawned');
    assert.equal(marker.hostNonce, workerRecord.hostNonce,
      'the marker must be bound to the host nonce of the run the backend spawned');
    assert.equal(marker.pid, workerRecord.pid,
      'the marker must be written by the process the backend spawned');
    assert.equal(marker.argv[1], '--run',
      'the default factory must pass the frozen --run marker in argv');
    assert.equal(marker.argv[2], marker.runId,
      'the --run marker must name the run the marker is bound to');

    const row = taskRow(caseRoot, taskId);
    const failure = JSON.parse(row.failure);
    const attempts = attemptRows(caseRoot, taskId);
    const receipts = await receiptCount(attempts);

    assert.equal(attempts.length, 1, 'the first attempt must be recorded');
    assert.equal(attempts[0].exit_reason, 'confirmed', 'the temporary entry tree exit must be confirmed');
    assert.equal(receipts, 0, 'the temporary entry attempt must record zero side-effect receipts');
    assert.equal(failure.code, 'output_contract_invalid',
      'the legal-identity error frame must map to the frozen output_contract_invalid code');
    assert.equal(failure.retryable, 'auto_backoff',
      'the frozen registry must mark output_contract_invalid as auto_backoff');
    // The non-audited execution source must never be promoted to safe: the
    // task isolates for review instead of auto-requeueing.
    assert.equal(failure.sideEffectSafety, 'unknown',
      'GAP-TEST-SAFETY-2: the default factory derived a non-audited runtime entry, so the execution source '
      + 'is not credibly confirmed and must stay unknown; observed '
      + `sideEffectSafety=${failure.sideEffectSafety} state=${task.state}`);
    assert.equal(task.state, 'needs_review',
      `GAP-TEST-SAFETY-2: a non-audited runtime entry must isolate for review, not auto-requeue, got ${task.state}: ${JSON.stringify(task)}`);
    assert.equal(failure.cause, 'failure_unknown_side_effect',
      'the safety route must name the unknown-side-effect cause');
    assert.deepEqual(candidateRows(caseRoot, {}), [],
      'no candidate may be persisted for a test task');
  } finally {
    await caseBackend?.close();
    rmSync(caseRoot, { recursive: true, force: true });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Negative control: warm-host borrowing — a `test` task run by the DEFAULT
// factory after the SAME host's private runtimeRoot alias was re-pointed from
// the audited root to a synthetic entry must stay unknown/needs_review.
//
// This is the falsifiable guard against the shortcut "the host was warmed with
// the audited runtime, so a later start may inherit that verdict". The case
// starts ONE backend with the DEFAULT factory (no `workerProcessFactory`) and
// ONE private runtimeRoot alias. The alias first points at the audited bundled
// root; a real Pi `test` task completes against it (the warm-up). The alias is
// then re-pointed at a temporary synthetic root (system node symlink + the
// reviewed test-only entry) and a SECOND `test` task is submitted to the SAME
// host. The marker — bound to the runId/hostNonce of the frozen stdio request
// line and cross-checked against the backend's own worker record — proves the
// default factory really executed the synthetic entry for the second run. The
// execution source is not credibly confirmed, so the task must isolate for
// review instead of auto-requeueing.
//
// GAP-TEST-SAFETY-3: the pre-fix backend caches the per-host execution-source
// verdict, so the second start inherits the warm-up's `proven_safe` and the
// task auto-requeues. This assertion is falsifiable RED on those bytes and
// goes green only when the verdict is re-verified per run and the spawn uses
// the verified real paths.
// ---------------------------------------------------------------------------

test('negative control: a test task on a warm default-factory host whose private runtimeRoot alias was re-pointed to a synthetic entry stays unknown/needs_review', async (t) => {
  const deadline = caseDeadline();
  const caseRoot = mkdtempSync(join(tmpdir(), 'web-text-intake-test-safety-warm-host-'));
  const alias = join(caseRoot, 'runtime-alias');
  const syntheticRoot = mkdtempSync(join(tmpdir(), 'web-text-intake-test-safety-warm-synthetic-'));
  const entryPath = join(import.meta.dirname, '..', 'fixtures', 'web-text-intake', 'test-safety-runtime-entry.mjs');
  const markerPath = join(caseRoot, 'test-safety-runtime-entry.marker.json');
  let caseBackend = null;
  try {
    // The synthetic root the alias will be re-pointed at: `node` is the system
    // node (a symlink), `organizer.mjs` is the reviewed test-only entry.
    symlinkSync(process.execPath, join(syntheticRoot, 'node'));
    copyFileSync(entryPath, join(syntheticRoot, 'organizer.mjs'));
    // The private runtimeRoot alias first points at the audited bundled root.
    symlinkSync(bundledRuntimeRoot, alias);
    // A valid model configuration is required so the scheduler launches a
    // worker instead of failing with a configuration-class code (which carries
    // proven_safe and would make this control vacuous). The warm-up really
    // calls the model; the synthetic entry never does.
    writeModelConfig(model.url, caseRoot);
    const credentialProvider = createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    });
    caseBackend = await startWebBackend({
      root: caseRoot,
      port: 0,
      staticRoot: caseRoot,
      storageBin: resolveStorageBinary(),
      runtimeRoot: alias,
      initialize: true,
      credentialProvider,
    });
    const session = await pair(caseBackend.origin, caseBackend.pairingCode);
    const info = await readSession(caseBackend.origin, session.cookie);
    const caseRequest = createRequester(caseBackend.origin);

    // --- Warm-up: the SAME host runs a real Pi `test` task against the alias
    // still pointing at the audited root. The standing valid answer makes the
    // task succeed, proving the real bundled Pi really ran.
    await swapScript([{ repeat: true, kind: 'sse', content: testAnswer() }]);
    const warmupSubmitted = await caseRequest('POST', '/api/tasks', {
      body: {
        operationId: syntheticOperationId(),
        type: 'test',
        role: 'organizer',
        input: { modelId: MODEL_ID },
      },
      cookie: session.cookie, csrf: info.csrfToken,
    });
    assert.equal(warmupSubmitted.status, 202, `the warm-up test task submit must be accepted: ${warmupSubmitted.text}`);
    const warmupTaskId = warmupSubmitted.json.taskId;
    assert.match(warmupTaskId, ID_PATTERNS.task);
    const warmupTask = await pollUntil(async () => {
      const response = await caseRequest('GET', `/api/tasks/${warmupTaskId}`, { cookie: session.cookie });
      assert.equal(response.status, 200, response.text);
      const resource = response.json.task ?? response.json;
      if (!['succeeded', 'needs_review', 'cancelled'].includes(resource.state)) return null;
      return resource;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'the warm-up test task to reach a terminal state' });
    assert.equal(warmupTask.state, 'succeeded',
      'the warm-up must succeed with the real bundled Pi while the alias points at the audited root');
    // The warm-up's own worker record must bind the audited deployment runtime:
    // the alias really resolved to the audited root for this start.
    const warmupRuns = readdirSync(join(caseRoot, 'runs'));
    assert.equal(warmupRuns.length, 1, 'the warm-up must be the only run so far');
    const warmupRecord = JSON.parse(readFileSync(join(caseRoot, 'runs', warmupRuns[0], 'worker.json'), 'utf8'));
    assert.equal(warmupRecord.executionSource?.trusted, true,
      'the warm-up must be bound to the audited deployment runtime');
    assert.equal(warmupRecord.executionSource?.reason, 'audited_deployment_runtime',
      'the warm-up must name the audited deployment runtime reason');

    // --- Re-point the SAME private alias at the synthetic root. Only the link
    // changes; the backend, its WorkerHost and the configuration alias stay.
    rmSync(alias);
    symlinkSync(syntheticRoot, alias);

    // --- Second `test` task on the SAME warm host. The default factory really
    // executes the synthetic entry (the marker proves it), but the execution
    // source is not credibly confirmed, so the task must isolate for review.
    const submitted = await caseRequest('POST', '/api/tasks', {
      body: {
        operationId: syntheticOperationId(),
        type: 'test',
        role: 'organizer',
        input: { modelId: MODEL_ID },
      },
      cookie: session.cookie, csrf: info.csrfToken,
    });
    assert.equal(submitted.status, 202, `the second test task submit must be accepted: ${submitted.text}`);
    const taskId = submitted.json.taskId;
    assert.match(taskId, ID_PATTERNS.task);

    // `failed` is a TRANSIENT state: `confirmExit` commits it and
    // `maybeAutoRetry` then moves the task to `needs_review` (or `queued` under
    // a shortcut). Polling must wait for that final state, never settle on the
    // transient `failed`, or the control would race the safety route.
    const task = await pollUntil(async () => {
      const response = await caseRequest('GET', `/api/tasks/${taskId}`, { cookie: session.cookie });
      assert.equal(response.status, 200, response.text);
      const resource = response.json.task ?? response.json;
      if (!['needs_review', 'queued', 'succeeded', 'cancelled'].includes(resource.state)) return null;
      return attemptRows(caseRoot, taskId).length >= 1 ? resource : null;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'the warm-host redirected test task to settle' });

    // The marker proves the DEFAULT factory really executed the synthetic entry
    // for THIS run. It is cross-checked against the backend's own worker record
    // (runId/hostNonce/pid), so a pre-existing marker or a path-only check
    // cannot stand in for the execution fact.
    const marker = await pollUntil(async () => {
      if (!existsSync(markerPath)) return null;
      try { return JSON.parse(readFileSync(markerPath, 'utf8')); } catch { return null; }
    }, { timeoutMs: waitWithin(deadline, 5000), message: 'the synthetic runtime entry marker' });
    assert.equal(marker.marker, 'test-safety-runtime-entry',
      'the marker must come from the test-only runtime entry');
    const workerRecord = JSON.parse(readFileSync(join(caseRoot, 'runs', marker.runId, 'worker.json'), 'utf8'));
    assert.equal(marker.runId, workerRecord.runId,
      'the marker must be bound to the run the backend spawned');
    assert.equal(marker.hostNonce, workerRecord.hostNonce,
      'the marker must be bound to the host nonce of the run the backend spawned');
    assert.equal(marker.pid, workerRecord.pid,
      'the marker must be written by the process the backend spawned');
    assert.equal(marker.argv[1], '--run',
      'the default factory must pass the frozen --run marker in argv');
    assert.equal(marker.argv[2], marker.runId,
      'the --run marker must name the run the marker is bound to');

    const row = taskRow(caseRoot, taskId);
    const failure = JSON.parse(row.failure);
    const attempts = attemptRows(caseRoot, taskId);
    const receipts = await receiptCount(attempts);

    assert.equal(attempts.length, 1, 'the first attempt must be recorded');
    assert.equal(attempts[0].exit_reason, 'confirmed', 'the synthetic entry tree exit must be confirmed');
    assert.equal(receipts, 0, 'the synthetic entry attempt must record zero side-effect receipts');
    assert.equal(failure.code, 'output_contract_invalid',
      'the legal-identity error frame must map to the frozen output_contract_invalid code');
    assert.equal(failure.retryable, 'auto_backoff',
      'the frozen registry must mark output_contract_invalid as auto_backoff');
    // The redirected execution source must never be promoted to safe: the task
    // isolates for review instead of auto-requeueing.
    assert.equal(failure.sideEffectSafety, 'unknown',
      'GAP-TEST-SAFETY-3: the warm host re-pointed its private runtimeRoot alias at a synthetic entry, so the '
      + 'execution source is not credibly confirmed and must stay unknown; observed '
      + `sideEffectSafety=${failure.sideEffectSafety} state=${task.state}`);
    assert.equal(task.state, 'needs_review',
      `GAP-TEST-SAFETY-3: a redirected runtime entry must isolate for review, not auto-requeue, got ${task.state}: ${JSON.stringify(task)}`);
    assert.equal(failure.cause, 'failure_unknown_side_effect',
      'the safety route must name the unknown-side-effect cause');
    // The worker record must describe the artifacts that ACTUALLY executed: the
    // synthetic root, not the audited root the warm-up used.
    assert.equal(workerRecord.executionSource?.trusted, false,
      'the redirected run must not inherit the warm-up\'s trusted verdict');
    assert.equal(workerRecord.executionSource?.reason, 'artifact_identity_mismatch',
      'the redirected run must name the artifact-identity mismatch');
    assert.equal(workerRecord.executionSource?.runtimeRoot, realpathSync(syntheticRoot),
      'the worker record must bind the synthetic root that actually executed');
    assert.deepEqual(candidateRows(caseRoot, {}), [],
      'no candidate may be persisted for a test task');
  } finally {
    await caseBackend?.close();
    rmSync(caseRoot, { recursive: true, force: true });
    rmSync(syntheticRoot, { recursive: true, force: true });
  }
});
