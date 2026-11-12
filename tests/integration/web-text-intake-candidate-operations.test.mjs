// MAYNE-33 (owner authorization D): real HTTP acceptance for the candidate
// direct-edit idempotency ledger (`candidate_operations`, migration 004).
//
// The service-layer proofs live in tests/unit/web-text-intake.test.mjs; this
// suite pins the same behaviours through the real HTTP surface and the real
// Rust storage adapter: an identical retry replays the candidate's CURRENT
// authoritative state without consuming a version, a changed body under the
// same key is 409 `idempotency_conflict`, a rejected guard consumes no key,
// and the ledger survives a same-root backend restart. Business setup goes
// through real HTTP only; database observations are read-only on the same
// synthetic root. The model is the controlled OpenAI-compatible service
// driving the REAL bundled Pi organizer — no real model, no real credential,
// no real user root.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import {
  startBackend,
  pairAdditionalClient,
  createRequester,
  writeEvidence,
  effectiveConfig,
  createControlledCredentialProvider,
  runtimeRootAvailable,
  bundledRuntimeRoot,
  pollUntil,
} from '../fixtures/web-text-intake/backend-process.mjs';
import { schemaVersion, candidateRow, observe } from '../fixtures/web-text-intake/db-observer.mjs';
import { startResponseDropper } from '../fixtures/web-text-intake/candidate-operations-response-dropper.mjs';
import {
  startControlledModelService, writeScript, queueExtractAnswer, reviseAnswer,
} from '../fixtures/web-text-intake/controlled-model.mjs';
import {
  operationId, queueText, submitSourceBody, candidateFields, editBody, discardBody,
  revisionBody, applyPreviewBody,
} from '../fixtures/web-text-intake/synthetic-inputs.mjs';

const SYNTHETIC_KEY = 'synthetic-web-text-intake-key-7f3a9c';
const CREDENTIAL_REF = 'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY';

// Frozen case budget: 20000ms per case (the W1 aggregate value).
const CASE_BUDGET_MS = 20000;
const CASE_MARGIN_MS = 2000;
const caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS;
const waitWithin = (deadline, capMs) => Math.max(250, Math.min(capMs, deadline - Date.now()));

const isTerminal = (task) => ['succeeded', 'failed', 'cancelled'].includes(task.state);

let backend;
let model;
let scriptDir;
let runtimeRoot;
let credentialProvider;
let sourceIndex = 0;
let backendRoot;

function writeModelConfig(root, baseUrl = 'http://127.0.0.1:9/v1') {
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

function pointProviderAt(root, baseUrl) {
  writeModelConfig(root, baseUrl);
}

async function submitSource(handle) {
  sourceIndex += 1;
  return handle.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(sourceIndex) }),
    cookie: handle.cookie,
    csrf: handle.csrf,
  });
}

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

// Create one real candidate through the controlled model and return its wire.
async function createCandidate(handle, deadline) {
  const submitted = await submitSource(handle);
  assert.equal(submitted.status, 200, submitted.text);
  const taskId = submitted.json.task.taskId;
  await waitForTask(handle, taskId, isTerminal, waitWithin(deadline, 10000));
  const listed = await handle.request('GET', `/api/text-sources/${submitted.json.source.sourceId}/candidates`, { cookie: handle.cookie });
  assert.equal(listed.status, 200, listed.text);
  const candidate = listed.json.candidates[0];
  assert.ok(candidate, 'the extract task must produce a candidate');
  return candidate;
}

function assertEnvelope(response, status, code) {
  assert.equal(response.status, status, `expected HTTP ${status}, got ${response.status}: ${response.text}`);
  assert.ok(response.json, `expected a JSON body, got: ${response.text}`);
  assert.equal(response.json.contractVersion, 'web-api/2', 'error envelope must carry contractVersion web-api/1');
  assert.equal(response.json.error?.code, code, `expected error code ${code}, got ${JSON.stringify(response.json.error)}`);
}

// Read-only ledger observation used to prove a write committed while its
// response was dropped by the proxy.
const ledgerCount = (root, operationIdValue) => observe(root, (db) => (
  db.prepare('SELECT count(*) AS n FROM candidate_operations WHERE operation_id=?').get(operationIdValue).n
));

before(async () => {
  runtimeRoot = runtimeRootAvailable() ? bundledRuntimeRoot : undefined;
  credentialProvider = createControlledCredentialProvider({
    [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
  });
  // A caller-supplied root survives `close()`, so the restart case can reopen
  // the SAME root and prove the ledger outlives the process.
  backendRoot = mkdtempSync(join(tmpdir(), 'web-text-intake-candops-'));
  backend = await startBackend({ root: backendRoot, runtimeRoot, credentialProvider });
  writeEvidence('http-effective-config.json', effectiveConfig({
    suite: 'web-text-intake-candidate-operations',
    runtimeRoot: runtimeRoot ?? null,
    credentialRef: CREDENTIAL_REF,
  }));
  scriptDir = join(backend.root, 'model-script');
  const script = writeScript(scriptDir, [
    // Standing (never consumed) revise answer: the suite drives more than one
    // revision, and a one-shot entry would leave later revisions on the
    // extract fallback (which the revise branch refuses).
    { repeat: true, match: { userTextIncludes: '整理合成队列输入' }, kind: 'sse', content: reviseAnswer() },
    { repeat: true, kind: 'sse', content: queueExtractAnswer() },
  ]);
  model = await startControlledModelService({ script, record: join(backend.root, 'model.jsonl') });
  writeModelConfig(backend.root);
  pointProviderAt(backend.root, model.url);
}, { timeout: 90000 });

after(async () => {
  await model?.stop();
  await backend?.close();
  if (backendRoot) rmSync(backendRoot, { recursive: true, force: true });
});

test('schema: the synthetic root carries web-backend schema version 4 with the candidate-operation ledger', async () => {
  assert.equal(schemaVersion(backend.root), 4, 'migrations 003 and 004 must advance schema_meta to 4 in the same transaction');
});

test('HTTP edit: same-key replay keeps the current state, changed body and flipped timeReviewed are 409', async () => {
  const deadline = caseDeadline();
  const candidate = await createCandidate(backend, deadline);
  const operationIdValue = operationId();
  const body = editBody({ operationId: operationIdValue, expectedVersion: candidate.version, fields: candidateFields({ title: 'HTTP 改过的标题' }) });

  const first = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.candidate.version, candidate.version + 1, 'the first edit must advance the version');
  assert.equal(first.json.candidate.fields.title, 'HTTP 改过的标题');

  // Same key + same canonical bytes -> replay from the CURRENT authoritative state.
  const replay = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.candidate.version, candidate.version + 1, 'the replay must not consume a version');
  assert.equal(replay.json.candidate.fields.title, 'HTTP 改过的标题');

  // Same key + changed body -> 409 idempotency_conflict.
  const changed = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body: editBody({ operationId: operationIdValue, expectedVersion: candidate.version, fields: candidateFields({ title: '别的标题' }) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(changed, 409, 'idempotency_conflict');

  // Same key + flipped timeReviewed -> 409 (timeReviewed is behavior-affecting).
  const flipped = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body: editBody({ operationId: operationIdValue, expectedVersion: candidate.version, fields: candidateFields({ title: 'HTTP 改过的标题' }), timeReviewed: true }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(flipped, 409, 'idempotency_conflict');

  const row = candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.version, candidate.version + 1, 'the rejected variants must not move the candidate');
  assert.equal(JSON.parse(row.fields_json).title, 'HTTP 改过的标题', 'the rejected variants must not rewrite the fields');
});

test('HTTP discard: same-key replay answers the current state and a different action conflicts', async () => {
  const deadline = caseDeadline();
  const candidate = await createCandidate(backend, deadline);
  const operationIdValue = operationId();

  const discarded = await backend.request('POST', `/api/candidates/${candidate.candidateId}/discard`, {
    body: discardBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(discarded.status, 200, discarded.text);
  assert.equal(discarded.json.candidate.status, 'discarded');

  const replay = await backend.request('POST', `/api/candidates/${candidate.candidateId}/discard`, {
    body: discardBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.candidate.status, 'discarded', 'the replay answers the current authoritative state');

  // The same key under a different action conflicts, answered before the state
  // guard (the candidate is already discarded).
  const conflicting = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body: editBody({ operationId: operationIdValue, expectedVersion: candidate.version, fields: candidateFields() }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(conflicting, 409, 'idempotency_conflict');
});

test('HTTP apply_preview: same-key replay and a changed preview target conflict', async () => {
  const deadline = caseDeadline();
  const candidate = await createCandidate(backend, deadline);
  const operationIdValue = operationId();

  const revision = await backend.request('POST', `/api/candidates/${candidate.candidateId}/revisions`, {
    body: revisionBody({}), cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(revision.status, 200, revision.text);
  const runId = revision.json.task.taskId;
  await waitForTask(backend, runId, isTerminal, waitWithin(deadline, 10000));

  const applied = await backend.request('POST', `/api/candidates/${candidate.candidateId}/previews/${runId}/apply`, {
    body: applyPreviewBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(applied.status, 200, applied.text);
  assert.equal(applied.json.candidate.version, candidate.version + 1, 'the apply must advance the version');

  const replay = await backend.request('POST', `/api/candidates/${candidate.candidateId}/previews/${runId}/apply`, {
    body: applyPreviewBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.candidate.version, candidate.version + 1, 'the replay must not consume a version');

  // Same key + a different preview target -> 409.
  const conflicting = await backend.request('POST', `/api/candidates/${candidate.candidateId}/previews/run_other/apply`, {
    body: applyPreviewBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(conflicting, 409, 'idempotency_conflict');
});

test('HTTP concurrency: two clients racing one edit key produce exactly one application', async () => {
  const deadline = caseDeadline();
  const candidate = await createCandidate(backend, deadline);
  const clientB = await pairAdditionalClient(backend, 1);
  const operationIdValue = operationId();
  const body = editBody({ operationId: operationIdValue, expectedVersion: candidate.version, fields: candidateFields({ title: '并发标题' }) });

  const [first, second] = await Promise.all([
    backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, { body, cookie: backend.cookie, csrf: backend.csrf }),
    backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, { body, cookie: clientB.cookie, csrf: clientB.csrf }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 200], `both racers must be answered 200 (one applied, one replayed), got ${JSON.stringify([first.status, second.status])}: ${first.text} / ${second.text}`);
  const versions = [first.json.candidate.version, second.json.candidate.version];
  assert.ok(versions.every((version) => version === candidate.version + 1),
    `both answers must report the single applied version, got ${versions}`);
  const row = candidateRow(backend.root, candidate.candidateId);
  assert.equal(row.version, candidate.version + 1, 'the candidate advanced exactly once');
});

test('HTTP restart: the ledger survives a same-root backend restart and still replays', async () => {
  const deadline = caseDeadline();
  const candidate = await createCandidate(backend, deadline);
  const operationIdValue = operationId();
  const body = editBody({ operationId: operationIdValue, expectedVersion: candidate.version, fields: candidateFields({ title: '重启前' }) });

  const first = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(first.status, 200, first.text);
  const appliedVersion = first.json.candidate.version;

  // Close the backend and reopen it on the SAME root: the ledger row and the
  // candidate survive, so the same key still replays from the current state.
  const root = backend.root;
  await backend.close();
  backend = await startBackend({ root, runtimeRoot, credentialProvider });

  const replay = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.candidate.version, appliedVersion, 'the replayed operation survives the restart');
  assert.equal(replay.json.candidate.fields.title, '重启前');

  // An unknown key still applies after the restart.
  const fresh = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body: editBody({ expectedVersion: appliedVersion, fields: candidateFields({ title: '重启后' }) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(fresh.status, 200, fresh.text);
  assert.equal(fresh.json.candidate.version, appliedVersion + 1, 'a fresh key applies after the restart');
});

test('HTTP ledger adjudication: a used key conflicts even when the other target is missing', async () => {
  const deadline = caseDeadline();
  const candidate = await createCandidate(backend, deadline);
  const operationIdValue = operationId();
  const first = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body: editBody({ operationId: operationIdValue, expectedVersion: candidate.version, fields: candidateFields({ title: '已改' }) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(first.status, 200, first.text);

  // The same used key conflicts for a missing candidate across all families.
  const missingEdit = await backend.request('POST', '/api/candidates/cand_missing/edits', {
    body: editBody({ operationId: operationIdValue, expectedVersion: candidate.version, fields: candidateFields() }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(missingEdit, 409, 'idempotency_conflict');
  const missingDiscard = await backend.request('POST', '/api/candidates/cand_missing/discard', {
    body: discardBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(missingDiscard, 409, 'idempotency_conflict');
  const missingApply = await backend.request('POST', '/api/candidates/cand_missing/previews/run_missing/apply', {
    body: applyPreviewBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(missingApply, 409, 'idempotency_conflict');

  // An UNUSED key keeps the natural 404 for a missing candidate.
  const unknownEdit = await backend.request('POST', '/api/candidates/cand_missing/edits', {
    body: editBody({ expectedVersion: 1, fields: candidateFields() }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(unknownEdit, 404, 'candidate_not_found');
  const unknownDiscard = await backend.request('POST', '/api/candidates/cand_missing/discard', {
    body: discardBody({ expectedVersion: 1 }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(unknownDiscard, 404, 'candidate_not_found');
  const unknownApply = await backend.request('POST', '/api/candidates/cand_missing/previews/run_missing/apply', {
    body: applyPreviewBody({ expectedVersion: 1 }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(unknownApply, 404, 'candidate_not_found');
});

test('HTTP discard: a rejected guard consumes no key and the same key still succeeds later', async () => {
  const deadline = caseDeadline();
  const candidate = await createCandidate(backend, deadline);
  const operationIdValue = operationId();
  const stale = await backend.request('POST', `/api/candidates/${candidate.candidateId}/discard`, {
    body: discardBody({ operationId: operationIdValue, expectedVersion: candidate.version + 7 }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(stale, 409, 'version_conflict');
  assert.equal(ledgerCount(backend.root, operationIdValue), 0, 'the rejected guard writes no ledger row');
  const discarded = await backend.request('POST', `/api/candidates/${candidate.candidateId}/discard`, {
    body: discardBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(discarded.status, 200, discarded.text);
  assert.equal(discarded.json.candidate.status, 'discarded');
  assert.equal(ledgerCount(backend.root, operationIdValue), 1);
});

test('HTTP apply_preview: an old key replays the CURRENT state after a later edit', async () => {
  const deadline = caseDeadline();
  const candidate = await createCandidate(backend, deadline);
  const operationIdValue = operationId();
  const revision = await backend.request('POST', `/api/candidates/${candidate.candidateId}/revisions`, {
    body: revisionBody({}), cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(revision.status, 200, revision.text);
  const runId = revision.json.task.taskId;
  await waitForTask(backend, runId, isTerminal, waitWithin(deadline, 10000));
  const applied = await backend.request('POST', `/api/candidates/${candidate.candidateId}/previews/${runId}/apply`, {
    body: applyPreviewBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(applied.status, 200, applied.text);
  const appliedVersion = applied.json.candidate.version;
  const edited = await backend.request('POST', `/api/candidates/${candidate.candidateId}/edits`, {
    body: editBody({ expectedVersion: appliedVersion, fields: candidateFields({ title: '后续编辑' }) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.candidate.version, appliedVersion + 1);
  const replay = await backend.request('POST', `/api/candidates/${candidate.candidateId}/previews/${runId}/apply`, {
    body: applyPreviewBody({ operationId: operationIdValue, expectedVersion: candidate.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.candidate.version, appliedVersion + 1, 'the old apply key replays the current authoritative state');
  assert.equal(replay.json.candidate.fields.title, '后续编辑');
});

test('HTTP restart with an unknown response: all three families replay from the ledger', async () => {
  const deadline = caseDeadline();
  // Normal-response control group: the same write through the same surface
  // returns 200 and a body a healthy client consumes.
  const controlCandidate = await createCandidate(backend, deadline);
  const control = await backend.request('POST', `/api/candidates/${controlCandidate.candidateId}/edits`, {
    body: editBody({ expectedVersion: controlCandidate.version, fields: candidateFields({ title: '正常响应' }) }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(control.status, 200, control.text);
  assert.equal(control.json.candidate.version, controlCandidate.version + 1, 'the control write returns a normal 200');

  const editCandidateRow = await createCandidate(backend, deadline);
  const editOp = operationId();
  const editBodyValue = editBody({ operationId: editOp, expectedVersion: editCandidateRow.version, fields: candidateFields({ title: '重启编辑' }) });

  const discardCandidateRow = await createCandidate(backend, deadline);
  const discardOp = operationId();
  const discardBodyValue = discardBody({ operationId: discardOp, expectedVersion: discardCandidateRow.version });

  const applyCandidateRow = await createCandidate(backend, deadline);
  const applyOp = operationId();
  const revision = await backend.request('POST', `/api/candidates/${applyCandidateRow.candidateId}/revisions`, {
    body: revisionBody({}), cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(revision.status, 200, revision.text);
  const applyRun = revision.json.task.taskId;
  await waitForTask(backend, applyRun, isTerminal, waitWithin(deadline, 10000));
  const applyBodyValue = applyPreviewBody({ operationId: applyOp, expectedVersion: applyCandidateRow.version });

  // Route the three writes through a response-dropping proxy: the request
  // reaches the real backend, the commit is observed read-only, and the
  // response is discarded before the client can read any status or body.
  const dropper = await startResponseDropper(backend.origin);
  try {
    const overDropper = createRequester(dropper.origin);
    const writeOptions = () => ({ cookie: backend.cookie, csrf: backend.csrf });
    const fired = [
      overDropper('POST', `/api/candidates/${editCandidateRow.candidateId}/edits`, { ...writeOptions(), body: editBodyValue })
        .then((response) => ({ status: response.status, text: response.text }))
        .catch((error) => ({ transport: String(error?.message ?? error) })),
      overDropper('POST', `/api/candidates/${discardCandidateRow.candidateId}/discard`, { ...writeOptions(), body: discardBodyValue })
        .then((response) => ({ status: response.status, text: response.text }))
        .catch((error) => ({ transport: String(error?.message ?? error) })),
      overDropper('POST', `/api/candidates/${applyCandidateRow.candidateId}/previews/${applyRun}/apply`, { ...writeOptions(), body: applyBodyValue })
        .then((response) => ({ status: response.status, text: response.text }))
        .catch((error) => ({ transport: String(error?.message ?? error) })),
    ];
    // Every write commits while its response is being dropped.
    for (const [index, op] of [editOp, discardOp, applyOp].entries()) {
      await pollUntil(
        () => ledgerCount(backend.root, op) === 1,
        { timeoutMs: waitWithin(deadline, 8000), intervalMs: 20, message: `the write #${index} to commit` },
      );
    }
    const outcomes = await Promise.all(fired);
    for (const [index, outcome] of outcomes.entries()) {
      assert.equal(outcome?.status, undefined,
        `family #${index} must not receive any response status, got ${JSON.stringify(outcome)}`);
      assert.ok(outcome?.transport,
        `family #${index} must fail at the transport, got ${JSON.stringify(outcome)}`);
    }
  } finally {
    await dropper.close();
  }
  await backend.close();

  // Reopen the SAME root: every key replays the single applied state.
  backend = await startBackend({ root: backendRoot, runtimeRoot, credentialProvider });

  const editReplay = await backend.request('POST', `/api/candidates/${editCandidateRow.candidateId}/edits`, {
    body: editBodyValue, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(editReplay.status, 200, editReplay.text);
  assert.equal(editReplay.json.candidate.version, editCandidateRow.version + 1, 'the edit advanced exactly once');
  assert.equal(editReplay.json.candidate.fields.title, '重启编辑');

  const discardReplay = await backend.request('POST', `/api/candidates/${discardCandidateRow.candidateId}/discard`, {
    body: discardBodyValue, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(discardReplay.status, 200, discardReplay.text);
  assert.equal(discardReplay.json.candidate.status, 'discarded');

  const applyReplay = await backend.request('POST', `/api/candidates/${applyCandidateRow.candidateId}/previews/${applyRun}/apply`, {
    body: applyBodyValue, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(applyReplay.status, 200, applyReplay.text);
  assert.equal(applyReplay.json.candidate.version, applyCandidateRow.version + 1, 'the apply advanced exactly once');

  for (const op of [editOp, discardOp, applyOp]) {
    assert.equal(ledgerCount(backend.root, op), 1, `exactly one ledger row for ${op}`);
  }
});

test('the response dropper closes unfinished connections without external intervention', async () => {
  // A synthetic upstream that accepts but never responds.
  const silentUpstream = createServer(() => { /* never respond */ });
  const upstreamSockets = new Set();
  silentUpstream.on('connection', (socket) => {
    upstreamSockets.add(socket);
    socket.on('close', () => upstreamSockets.delete(socket));
  });
  const upstreamConnected = new Promise((resolve) => silentUpstream.once('connection', resolve));
  await new Promise((resolve) => silentUpstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = silentUpstream.address().port;
  let hanging = null;
  try {
    const dropper = await startResponseDropper(`http://127.0.0.1:${upstreamPort}`);
    // A client that sends only half a request head and then hangs: the
    // upstream never answers, so both sockets stay unfinished.
    hanging = connect(Number(new URL(dropper.origin).port), '127.0.0.1');
    await new Promise((resolve, reject) => {
      hanging.once('connect', resolve);
      hanging.once('error', reject);
    });
    hanging.write('POST /api/candidates/cand_x/edits HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    // Wait until the dropper's own upstream socket is established, so the
    // close below really has live connections to release.
    await upstreamConnected;
    // close() must finish on its own, with nobody destroying the sockets.
    const closed = await Promise.race([
      dropper.close().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    assert.equal(closed, true, 'the dropper close must finish without external socket destruction');
  } finally {
    hanging?.destroy();
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise((resolve) => silentUpstream.close(resolve));
  }
});
