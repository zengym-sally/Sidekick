// MAYNE-24 slice II (Kimi): controlled-model acceptance for the W1
// text-intake vertical (P2 matrix T-4, readiness §7 fault matrix). Two
// evidence layers, both against the REAL bundled Pi organizer
// (build/s0-runtime/organizer.mjs produced by the sanctioned
// `npm run probe:bundle`):
//
//   1. Fixture mechanics (direct drive): the controlled service drives the
//      real organizer over its stdio protocol exactly like the production
//      worker-host will — this proves the fixture's scripted answers are
//      contract-valid for the real runtime, that the tool-call sequence
//      drives the real ManagedBash path, and that invalid outputs are
//      rejected by the runtime itself. It signs fixture mechanics only, not
//      backend business behavior.
//   2. Business path (through the backend): a real source submit runs the
//      production path (config -> scheduler -> worker-host -> real Pi ->
//      controlled service) and the task's outcome, candidates, request
//      record and secret boundaries are asserted over HTTP and read-only
//      database observation.
//
// Secret boundary (dispatch §2/§7): the synthetic key exists only inside the
// in-memory controlled credential provider and the worker's private stdin.
// The suite asserts the Authorization header EXISTS on every model request
// while its value is never recorded, and greps stdout, stderr, argv, SSE
// frames, database rows and the request record for the secret.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeControlledModelConfig, setControlledCredentialRef } from '../fixtures/web-text-intake/model-config.mjs';
import { spawn } from 'node:child_process';
import {
  startBackend,
  writeEvidence,
  effectiveConfig,
  createControlledCredentialProvider,
  pollUntil,
  findOrganizerWorkers,
  descendantPids,
  processTable,
  runtimeRootAvailable,
  bundledRuntimeRoot,
} from '../fixtures/web-text-intake/backend-process.mjs';
import { taskRow, candidateRows, sourceRow } from '../fixtures/web-text-intake/db-observer.mjs';
import {
  startControlledModelService, writeScript,
  primaryExtractAnswer, queueExtractAnswer, testAnswer, invalidAnswers,
} from '../fixtures/web-text-intake/controlled-model.mjs';
import { submitSourceBody, SOURCE_TEXT, queueText } from '../fixtures/web-text-intake/synthetic-inputs.mjs';

const SYNTHETIC_KEY = 'synthetic-web-text-intake-key-7f3a9c';
const CREDENTIAL_REF = 'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY';
const TERMINAL = ['succeeded', 'failed', 'cancelled'];
// Frozen case budget: the ticket freezes 20000ms per case (the aggregate runs
// `node --test --test-timeout=20000`, the W1 value), so no case declares a
// larger budget of its own. Every wait inside a case derives from ONE
// per-case deadline — polling together can never outlive it — and heavy
// preparation (backend/model startup, artifact builds) stays outside the
// timed case in the before hook / build chain, the sanctioned exception.
// Wait caps are backstops for failure diagnosability; each is additionally
// bounded by the remaining time to the case deadline (M-3: the former
// 40000/30000ms backstops exceeded the case budget).
const CASE_BUDGET_MS = 20000;
const CASE_MARGIN_MS = 2000;
const caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS;
const waitWithin = (deadline, capMs) => Math.max(250, Math.min(capMs, deadline - Date.now()));
// The tool-path marker: a scripted bash command echoes it, and the joint
// "real Pi" proof observes it relayed back to the model service in a tool
// message (script output relay). The command holds the tool subprocess alive
// for a deterministic observation window.
const TOOL_MARKER = 'controlled-tool-proof';
const TOOL_COMMAND = `sleep 3; echo ${TOOL_MARKER}`;
const FROZEN_FAILURE_CODES = new Set([
  'model_request_failed', 'auth_or_config_invalid', 'credential_unavailable',
  'tool_execution_failed', 'worker_lost', 'output_contract_invalid',
]);

let backend;
let model;
let scriptDir;
let runtimeRoot;
let runtimeNode;
let organizerEntry;

async function swapScript(entries) {
  writeScript(scriptDir, entries);
  await new Promise((done) => setTimeout(done, 30));
}

// II config prerequisite (dispatch 01a1be44): the inline writer used fields
// outside the frozen configuration DTO (`authMode`, `credentialRefs`, no
// `name`), so `ConfigStore.readModelConfiguration()` rejected the document with
// `validation_failed: 供应商名称无效。`. The shared fixture writes the legal
// shape against the loopback controlled service.
function writeModelConfig(root, baseUrl) {
  writeControlledModelConfig(root, baseUrl, CREDENTIAL_REF);
}

// Direct-drive the real organizer over its stdio protocol (the s31/s32
// pattern): one JSON request line on stdin, JSON event lines on stdout. The
// timeout is a failure-path backstop bounded well under the frozen 20000ms
// case budget (M-3); callers pass a deadline-derived value.
async function driveOrganizer(request, { timeoutMs = 10000 } = {}) {
  const child = spawn(runtimeNode, [organizerEntry, '--run', request.runId], {
    env: { PATH: '/usr/bin:/bin', TMPDIR: tmpdir() },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const finished = new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  child.stdin.write(`${JSON.stringify({ ...request, cwd: request.cwd ?? tmpdir() })}\n`);
  const result = await Promise.race([
    finished,
    new Promise((resolve) => setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs).unref()),
  ]);
  const events = result.stdout.trim().split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'unparseable', line }; }
  });
  return { ...result, events };
}

const extractRequest = (overrides = {}) => ({
  runId: `controlled-${Math.random().toString(36).slice(2, 10)}`,
  kind: 'extract',
  anchorAtMs: Date.parse('2026-11-13T10:00:00.000Z'),
  source: { rawText: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  snapshot: {
    provider: { id: 'controlled-openai', baseUrl: model.url, network: { timeoutMs: 8000, retry: { maxRetries: 0 } } },
    model: { id: 'controlled-organizer-model', apiModelId: 'controlled-organizer-model', capabilities: { toolCall: true } },
    agent: { agentId: 'organizer', preferences: { detail: 'concise', focus: 'followups' }, supplementalInstructions: '保留核对依据。' },
  },
  apiKey: SYNTHETIC_KEY,
  ...overrides,
});

before(async () => {
  assert.ok(runtimeRootAvailable(),
    'build/s0-runtime must contain the bundled organizer and node (npm run probe:bundle); '
    + 'the controlled-model suites cannot run without the real Pi runtime');
  runtimeRoot = bundledRuntimeRoot;
  runtimeNode = join(runtimeRoot, 'node');
  organizerEntry = join(runtimeRoot, 'organizer.mjs');
  backend = await startBackend({
    runtimeRoot,
    credentialProvider: createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    }),
  });
  writeEvidence('controlled-model-effective-config.json', effectiveConfig({
    suite: 'web-text-intake-controlled-model', runtimeRoot, credentialRef: CREDENTIAL_REF,
  }));
  scriptDir = join(backend.root, 'model-script');
  const script = writeScript(scriptDir, [{ repeat: true, kind: 'sse', content: queueExtractAnswer() }]);
  model = await startControlledModelService({ script, record: join(backend.root, 'model.jsonl') });
  writeModelConfig(backend.root, model.url);
}, { timeout: 90000 });

after(async () => {
  await model?.stop();
  await backend?.close();
});

// ---------------------------------------------------------------------------
// Fixture mechanics: the real Pi against the controlled service
// ---------------------------------------------------------------------------

test('fixture mechanics: the real organizer extracts candidates from the controlled service and the auth header exists unrecorded', async () => {
  const deadline = caseDeadline();
  await swapScript([
    { match: { userTextIncludes: '林川下周五之前提交SDK鉴权修复' }, kind: 'sse', content: primaryExtractAnswer() },
    { repeat: true, kind: 'sse', content: queueExtractAnswer() },
  ]);
  const before = model.requests().length;
  const result = await driveOrganizer(extractRequest());
  assert.equal(result.code, 0, `the real organizer must succeed; events: ${JSON.stringify(result.events)} stderr: ${result.stderr}`);
  const last = result.events.at(-1);
  assert.equal(last.type, 'result', `the last event must be a result, got ${JSON.stringify(last)}`);
  assert.equal(last.data.candidates.length, 2, 'the controlled extract answer must yield two candidates');
  for (const candidate of last.data.candidates) {
    assert.ok(SOURCE_TEXT.includes(candidate.evidence), 'the runtime must enforce the evidence substring rule');
    assert.equal(candidate.fields.kind === 'action' && candidate.followupExpression != null, false,
      'an action candidate must not carry a followup expression');
  }
  const requests = model.requests().slice(before);
  assert.equal(requests.length, 1, 'the controlled service must have observed exactly one model request');
  assert.equal(requests[0].hasAuthorization, true, 'the real Pi request must carry an Authorization header');
  assert.ok(requests[0].authorizationLength > 0, 'the Authorization header must be non-empty');
  assert.ok(!result.stdout.includes(SYNTHETIC_KEY), 'the organizer stdout must never contain the secret');
  assert.ok(!result.stderr.includes(SYNTHETIC_KEY), 'the organizer stderr must never contain the secret');
  assert.ok(!JSON.stringify(requests[0]).includes(SYNTHETIC_KEY), 'the request record must never contain the secret value');
});

test('fixture mechanics: the tool-call sequence drives the real ManagedBash path and the final candidates still validate', async () => {
  const deadline = caseDeadline();
  // A synthetic workspace for the run: the controlled service asks the real
  // organizer to read a reference file and run a script, then answer.
  const workspace = mkdtempSync(join(tmpdir(), 'web-text-intake-tools-'));
  try {
    mkdirSync(join(workspace, 'references'), { recursive: true });
    mkdirSync(join(workspace, 'scripts'), { recursive: true });
    writeFileSync(join(workspace, 'references', 'context.md'), 'Synthetic reference for the controlled tool path.\n');
    writeFileSync(join(workspace, 'scripts', 'echo.sh'), '#!/bin/bash\necho "controlled-tool-proof"\n');
    const command = `/bin/bash '${join(workspace, 'scripts', 'echo.sh')}'`;
    await swapScript([
      { match: { toolResults: 0 }, kind: 'toolCalls', call: { name: 'read', args: { path: 'references/context.md' } } },
      { match: { toolResults: 1 }, kind: 'toolCalls', call: { name: 'bash', args: { command, timeout: 5 } } },
      { repeat: true, kind: 'sse', content: primaryExtractAnswer() },
    ]);
    const before = model.requests().length;
    const result = await driveOrganizer(extractRequest({ cwd: workspace }), { timeoutMs: waitWithin(deadline, 10000) });
    assert.equal(result.code, 0, `the tool-path run must succeed; events: ${JSON.stringify(result.events)} stderr: ${result.stderr}`);
    const requests = model.requests().slice(before);
    assert.equal(requests.length, 3, 'the controlled service must observe the read, bash and final requests');
    assert.equal(requests[0].hasTools, true, 'the first request must declare the real tools');
    assert.equal(requests[1].toolMessageCount, 1, 'the second request must carry the read tool result');
    assert.equal(requests[2].toolMessageCount, 2, 'the final request must carry both tool results');
    assert.ok(requests.every((entry) => entry.hasAuthorization), 'every request must carry the auth header');
    // Script output relay (M-11): the echo script's marker must come back to
    // the model service inside a tool message — the relay is observed
    // directly, not inferred from the message counts.
    const relayed = requests.filter((entry) => (entry.toolContents ?? []).some((content) => content.includes('controlled-tool-proof')));
    assert.ok(relayed.length >= 1,
      `the scripted command output must be relayed back to the model service in a tool message, got tool contents: `
      + JSON.stringify(requests.map((entry) => entry.toolContents ?? null)));
    const last = result.events.at(-1);
    assert.equal(last.type, 'result');
    assert.equal(last.data.candidates.length, 2, 'the final answer must parse into candidates');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('fixture mechanics: invalid model outputs are rejected by the real runtime with no result event', async () => {
  const deadline = caseDeadline();
  const cases = [
    ['non-JSON output', invalidAnswers.nonJson(), 'MODEL_INVALID_OUTPUT'],
    ['evidence not a substring', invalidAnswers.evidenceNotSubstring(), 'MODEL_INVALID_OUTPUT'],
    ['date expression without source evidence', invalidAnswers.dateEvidenceNotSubstring(), 'MODEL_INVALID_OUTPUT'],
    ['action carrying a followup expression', invalidAnswers.actionWithFollowup(), 'MODEL_INVALID_OUTPUT'],
    ['oversize tags', invalidAnswers.oversizeTags(), 'MODEL_INVALID_OUTPUT'],
    ['unknown output key', invalidAnswers.unknownKey(), 'MODEL_INVALID_OUTPUT'],
    ['too many candidates', invalidAnswers.tooManyCandidates(), 'MODEL_INVALID_OUTPUT'],
  ];
  for (const [label, content, expectedCode] of cases) {
    // The common-evidence answers need a text that carries the common
    // substrings; the primary-text answers need SOURCE_TEXT.
    const text = ['evidence not a substring', 'date expression without source evidence'].includes(label) ? SOURCE_TEXT : queueText(1);
    await swapScript([{ repeat: true, kind: 'sse', content }]);
    const result = await driveOrganizer(extractRequest({ source: { rawText: text, timeZone: 'Asia/Shanghai' } }));
    assert.equal(result.code, 1, `${label}: the organizer must exit non-zero`);
    const last = result.events.at(-1);
    assert.equal(last.type, 'error', `${label}: the last event must be an error, got ${JSON.stringify(last)}`);
    assert.equal(last.code, expectedCode, `${label}: expected ${expectedCode}, got ${last.code}`);
    assert.ok(!result.events.some((event) => event.type === 'result'), `${label}: no result event may be emitted`);
  }
});

test('fixture mechanics: an empty candidate list is a valid success and the worker argv never carries the secret', async () => {
  const deadline = caseDeadline();
  // A slow first answer keeps the real worker alive long enough to observe
  // its process table entry (argv must not contain the synthetic secret).
  await swapScript([
    { kind: 'slow', delayMs: 3000, then: { kind: 'sse', content: invalidAnswers.emptyCandidates() } },
    { repeat: true, kind: 'sse', content: queueExtractAnswer() },
  ]);
  const driving = driveOrganizer(extractRequest());
  const worker = await pollUntil(() => {
    const found = findOrganizerWorkers(process.pid);
    return found.length > 0 ? found[0] : null;
  }, { timeoutMs: waitWithin(deadline, 8000), message: 'the real organizer worker process to appear' });
  assert.ok(!worker.command.includes(SYNTHETIC_KEY),
    `the worker argv must not contain the synthetic secret: ${worker.command}`);
  assert.match(worker.command, /organizer\.mjs/, 'the observed process must be the bundled organizer');
  const result = await driving;
  assert.equal(result.code, 0, `the empty-candidate run must succeed: ${JSON.stringify(result.events)}`);
  const last = result.events.at(-1);
  assert.equal(last.type, 'result');
  assert.deepEqual(last.data.candidates, [], 'an empty candidate list is contract-valid');
});

test('fixture mechanics: a test-kind run reports ok against the controlled service', async () => {
  const deadline = caseDeadline();
  await swapScript([{ repeat: true, kind: 'sse', content: testAnswer() }]);
  const result = await driveOrganizer(extractRequest({ kind: 'test' }));
  assert.equal(result.code, 0, JSON.stringify(result.events));
  assert.equal(result.events.at(-1).type, 'result');
  assert.deepEqual(result.events.at(-1).data, { ok: true });
});

// ---------------------------------------------------------------------------
// T-4: the business path through the backend
// ---------------------------------------------------------------------------

test('T-4: a source submitted through the backend runs the real Pi on the controlled service and publishes the model candidates', async () => {
  const deadline = caseDeadline();
  await swapScript([
    { match: { userTextIncludes: '林川下周五之前提交SDK鉴权修复' }, kind: 'sse', content: primaryExtractAnswer() },
    { repeat: true, kind: 'sse', content: queueExtractAnswer() },
  ]);
  const before = model.requests().length;
  const submitted = await backend.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: SOURCE_TEXT }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(submitted.status, 200, `the source submit must succeed: ${submitted.text}`);
  const taskId = submitted.json.task?.taskId ?? submitted.json.taskId;
  assert.ok(taskId, `the submit response must carry the task: ${submitted.text}`);
  const task = await pollUntil(async () => {
    const response = await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie });
    assert.equal(response.status, 200, response.text);
    const resource = response.json.task ?? response.json;
    return TERMINAL.includes(resource.state) ? resource : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'the extract task to finish' });
  assert.equal(task.state, 'succeeded', `the controlled extract must succeed: ${JSON.stringify(task)}`);

  // The real Pi made the model call through the production path.
  const requests = model.requests().slice(before);
  assert.equal(requests.length, 1, 'the controlled service must observe exactly one model request for the task');
  assert.equal(requests[0].hasAuthorization, true, 'the production worker request must carry the auth header');
  assert.ok(!JSON.stringify(requests[0]).includes(SYNTHETIC_KEY), 'the record must not contain the secret value');

  // The candidates come from the model output (not from any hardcoded UI
  // path): the published candidates match the controlled answer.
  const candidates = await backend.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates`, { cookie: backend.cookie });
  assert.equal(candidates.status, 200, candidates.text);
  assert.equal(candidates.json.candidates.length, 2, 'both controlled candidates must be published');
  const titles = candidates.json.candidates.map((entry) => entry.fields.title).sort();
  assert.deepEqual(titles, ['提交SDK鉴权修复并请我验收', '整理供应商报价对比'].sort());
  for (const candidate of candidates.json.candidates) {
    assert.ok(SOURCE_TEXT.includes(candidate.evidence), 'the published evidence must be a verbatim substring of the source');
    assert.equal(candidate.status, 'pending');
  }
  const rows = candidateRows(backend.root, { sourceId: submitted.json.source.sourceId });
  assert.equal(rows.length, 2, 'the database must carry exactly the two published candidates');
  assert.ok(!JSON.stringify(rows).includes(SYNTHETIC_KEY), 'no candidate row may carry the secret');
  assert.ok(sourceRow(backend.root, submitted.json.source.sourceId), 'the source must be retained');
});

// ---------------------------------------------------------------------------
// T-4 joint proof: the real Pi, proven jointly (M-11)
// ---------------------------------------------------------------------------

test('T-4 joint proof: the real Pi build identity, the tool subprocess and the scripted output relay are observed together on the production path', async () => {
  const deadline = caseDeadline();
  // A tool-call script whose bash command holds the real ManagedBash
  // subprocess alive for a deterministic observation window and echoes a
  // distinctive marker. The three proofs are observed TOGETHER on one real
  // production run (submit -> scheduler -> worker-host -> real Pi ->
  // controlled service):
  //   (1) real build identity — the spawned worker's command line resolves
  //       to THIS tree's bundled organizer path (not merely any file named
  //       organizer.mjs), and the runtime provenance is recorded;
  //   (2) tool subprocess existence — runtime/workers/bash-worker.mjs is
  //       observable as a descendant while the scripted command runs;
  //   (3) script output relay — the marker comes back to the model service
  //       in a tool message.
  await swapScript([
    { match: { toolResults: 0 }, kind: 'toolCalls', call: { name: 'bash', args: { command: TOOL_COMMAND, timeout: 10 } } },
    { repeat: true, kind: 'sse', content: queueExtractAnswer() },
  ]);
  const before = model.requests().length;
  const submitted = await backend.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(4) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(submitted.status, 200, `the source submit must succeed: ${submitted.text}`);
  const taskId = submitted.json.task?.taskId ?? submitted.json.taskId;
  assert.ok(taskId, `the submit response must carry the task: ${submitted.text}`);

  // (1) Real build identity: the production-spawned worker's command line
  // must reference the bundled organizer of THIS tree.
  const worker = await pollUntil(() => {
    const found = findOrganizerWorkers(process.pid);
    return found.length > 0 ? found[0] : null;
  }, { timeoutMs: waitWithin(deadline, 8000), message: 'the real organizer worker process to appear' });
  assert.ok(worker.command.includes(organizerEntry),
    `the production worker command line must reference the bundled organizer at ${organizerEntry}, got ${worker.command}`);
  assert.ok(!worker.command.includes(SYNTHETIC_KEY),
    `the worker argv must not contain the synthetic secret: ${worker.command}`);
  const provenancePath = join(runtimeRoot, 'source.json');
  const provenance = existsSync(provenancePath) ? JSON.parse(readFileSync(provenancePath, 'utf8')) : null;
  writeEvidence('controlled-model-runtime-provenance.json', {
    runtimeRoot, organizerEntry, provenance,
  });

  // (2) Tool subprocess existence: the real ManagedBash path spawns
  // runtime/workers/bash-worker.mjs as a descendant of the organizer worker.
  const tree = new Set(descendantPids(process.pid));
  const toolWorker = await pollUntil(() => processTable().find((entry) => tree.has(entry.pid) && /bash-worker\.mjs/.test(entry.command)) ?? null,
    { timeoutMs: waitWithin(deadline, 8000), message: 'the real bash tool subprocess to appear' });
  assert.ok(toolWorker, 'the bash tool subprocess must exist while the scripted command runs');

  // Full process-tree secret boundary (M-10): every descendant of this
  // process — organizer worker, bash tool subprocess and the bash command
  // itself — must be free of the synthetic secret in its command line.
  const treeProcesses = processTable().filter((entry) => tree.has(entry.pid));
  assert.ok(treeProcesses.length >= 2,
    `the process tree must carry at least the worker and the tool subprocess, got ${treeProcesses.length}`);
  for (const entry of treeProcesses) {
    assert.ok(!entry.command.includes(SYNTHETIC_KEY),
      `no process in the worker tree may carry the synthetic secret in its command line: ${entry.command}`);
  }

  const task = await pollUntil(async () => {
    const response = await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie });
    assert.equal(response.status, 200, response.text);
    const resource = response.json.task ?? response.json;
    return TERMINAL.includes(resource.state) ? resource : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'the tool-path task to finish' });
  assert.equal(task.state, 'succeeded', `the tool-path extract must succeed, got ${task.state}: ${JSON.stringify(task)}`);

  // (3) Script output relay: the marker the scripted command echoed must
  // come back to the model service in a tool message of a later request.
  const requests = model.requests().slice(before);
  assert.ok(requests.length >= 2, `the tool path must make at least two model requests, got ${requests.length}`);
  const relayed = requests.filter((entry) => (entry.toolContents ?? []).some((content) => content.includes(TOOL_MARKER)));
  assert.ok(relayed.length >= 1,
    `the scripted command output (${TOOL_MARKER}) must be relayed back to the model service in a tool message, `
    + `got tool contents: ${JSON.stringify(requests.map((entry) => entry.toolContents ?? null))}`);
  assert.ok(!JSON.stringify(requests).includes(SYNTHETIC_KEY), 'the request record must not contain the secret value');
});

// ---------------------------------------------------------------------------
// Fault matrix (P2 §7): each case fails the task without persisting candidates
// ---------------------------------------------------------------------------

let faultSourceIndex = 100;

async function runFaultCase(label, entries, expectations) {
  const deadline = caseDeadline();
  await swapScript([...entries, { repeat: true, kind: 'sse', content: queueExtractAnswer() }]);
  const before = model.requests().length;
  const submitted = await backend.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(++faultSourceIndex) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(submitted.status, 200, `${label}: the submit must be accepted: ${submitted.text}`);
  const taskId = submitted.json.task?.taskId ?? submitted.json.taskId;
  const task = await pollUntil(async () => {
    const response = await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie });
    assert.equal(response.status, 200, response.text);
    const resource = response.json.task ?? response.json;
    return resource.state === 'needs_review' ? resource : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: `${label}: the task to finish` });
  assert.equal(task.state, 'needs_review', `${label}: an unproven side-effect state must require review`);
  assert.equal(task.attemptExitState, 'exited_confirmed');
  assert.equal(task.recovery.cause, 'failure_unknown_side_effect');
  assert.equal(task.recovery.autoResume, false);
  const row = taskRow(backend.root, taskId);
  assert.ok(row, `${label}: the task row must exist`);
  const failure = row.failure ? JSON.parse(row.failure) : null;
  assert.ok(failure, `${label}: the authority row must retain its failure envelope`);
  assert.equal(failure.sideEffectSafety, 'unknown');
  assert.ok(FROZEN_FAILURE_CODES.has(failure.code),
    `${label}: the failure code must come from the frozen registry (web-api/1 §4.6), got ${failure.code}`);
  assert.ok(typeof failure.retryable === 'string', `${label}: the failure envelope must declare retryability`);
  expectations?.(task, failure, row, before);
  // No candidate may be persisted for any fault case, and the source stays.
  assert.deepEqual(candidateRows(backend.root, { sourceId: submitted.json.source.sourceId }), [],
    `${label}: no candidate may be persisted`);
  assert.ok(sourceRow(backend.root, submitted.json.source.sourceId), `${label}: the source must be retained`);
  assert.equal(row.attempt_exit_state, 'exited_confirmed',
    `${label}: a failed task must not hold a slot (attempt exit confirmed)`);
}

test('fault: an authentication failure from the model service fails the task as auth_or_config_invalid', async () => {
  await runFaultCase('model 401', [{ kind: 'status', status: 401 }], (task, failure) => {
    assert.equal(failure.code, 'auth_or_config_invalid',
      'a 401 from the model service must map to the frozen auth_or_config_invalid');
    assert.equal(failure.retryable, 'manual', 'an auth failure must not auto-retry');
  });
});

test('fault: a rate-limit failure from the model service fails the task with a frozen-registry code', async () => {
  await runFaultCase('model 429', [{ kind: 'status', status: 429 }], (task, failure) => {
    assert.ok(['model_request_failed', 'auth_or_config_invalid'].includes(failure.code),
      `a 429 must map to a frozen-registry code, got ${failure.code}`);
  });
});

test('fault: a service-side 5xx fails the task with a frozen-registry code', async () => {
  await runFaultCase('model 500', [{ kind: 'status', status: 500 }]);
});

test('fault: a truncated stream fails the task without persisting a half candidate', async () => {
  await runFaultCase('stream break', [{ kind: 'break' }]);
});

test('fault: a model service that dies mid-request fails the task', async () => {
  const deadline = caseDeadline();
  await swapScript([{ kind: 'exit' }, { repeat: true, kind: 'sse', content: queueExtractAnswer() }]);
  const before = model.requests().length;
  const submitted = await backend.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(++faultSourceIndex) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(submitted.status, 200, submitted.text);
  const taskId = submitted.json.task?.taskId ?? submitted.json.taskId;
  const task = await pollUntil(async () => {
    const response = await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie });
    assert.equal(response.status, 200, response.text);
    const resource = response.json.task ?? response.json;
    return TERMINAL.includes(resource.state) ? resource : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'the task to finish after the service died' });
  assert.equal(task.state, 'failed', `the task must fail when the model service dies, got ${task.state}`);
  const row = taskRow(backend.root, taskId);
  const failure = row.failure ? JSON.parse(row.failure) : null;
  assert.ok(failure && FROZEN_FAILURE_CODES.has(failure.code), `a frozen-registry failure code is required, got ${failure?.code}`);
  assert.deepEqual(candidateRows(backend.root, { sourceId: submitted.json.source.sourceId }), [],
    'no candidate may be persisted when the model service dies');
  assert.equal(model.requests().length, before + 1, 'the dying service must have observed the one request it died on');
  // The service process is gone; the suite restarts nothing — later cases
  // swap the script and the next request fails to connect, which is itself
  // the network-class fault the next case covers.
});

test('fault: an unreachable model service fails the task as a model request failure', async () => {
  // The self-exit case above killed the service process; point the provider
  // config at a closed loopback port to make the unreachable case explicit
  // and deterministic.
  await swapScript([{ repeat: true, kind: 'sse', content: queueExtractAnswer() }]);
  const providersPath = join(backend.root, 'config', 'providers.json');
  const parsed = JSON.parse(readFileSync(providersPath, 'utf8'));
  parsed.providers[0].baseUrl = 'http://127.0.0.1:1/v1';
  writeFileSync(providersPath, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
  await runFaultCase('unreachable service', [], (task, failure) => {
    assert.equal(failure.code, 'model_request_failed',
      'an unreachable model service must map to model_request_failed');
  });
});

test('fault: an invalid model output fails the task as output_contract_invalid without persisting candidates', async () => {
  const script = writeScript(scriptDir, [{ repeat: true, kind: 'sse', content: queueExtractAnswer() }]);
  model = await startControlledModelService({ script, record: join(backend.root, 'model.jsonl') });
  writeModelConfig(backend.root, model.url);
  // The unreachable case left the provider pointed at a dead port; restore
  // the live controlled service for the output-contract cases.
  const providersPath = join(backend.root, 'config', 'providers.json');
  const parsed = JSON.parse(readFileSync(providersPath, 'utf8'));
  parsed.providers[0].baseUrl = model.url;
  writeFileSync(providersPath, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
  await runFaultCase('invalid output', [{ kind: 'sse', content: invalidAnswers.evidenceNotSubstring() }], (task, failure) => {
    assert.equal(failure.code, 'output_contract_invalid',
      'a model output violating the runtime contract must map to output_contract_invalid');
  });
});

test('fault: an action candidate carrying a followup expression is rejected by the output contract', async () => {
  await runFaultCase('action with followup', [{ kind: 'sse', content: invalidAnswers.actionWithFollowup() }], (task, failure) => {
    assert.equal(failure.code, 'output_contract_invalid');
  });
});

test('boundary: an empty candidate list is a task success with zero published candidates', async () => {
  const deadline = caseDeadline();
  await swapScript([{ repeat: true, kind: 'sse', content: invalidAnswers.emptyCandidates() }]);
  const submitted = await backend.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(++faultSourceIndex) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(submitted.status, 200, submitted.text);
  const taskId = submitted.json.task?.taskId ?? submitted.json.taskId;
  const task = await pollUntil(async () => {
    const response = await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie });
    assert.equal(response.status, 200, response.text);
    const resource = response.json.task ?? response.json;
    return TERMINAL.includes(resource.state) ? resource : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'the empty-candidate task to finish' });
  assert.equal(task.state, 'succeeded', `an empty candidate list must be a success: ${JSON.stringify(task)}`);
  assert.deepEqual(candidateRows(backend.root, { sourceId: submitted.json.source.sourceId }), [],
    'no candidate may be published for an empty model answer');
});
