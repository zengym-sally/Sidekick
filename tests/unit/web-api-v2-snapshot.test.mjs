//! MAYNE-38: unit regression for the V2 snapshot consumption and the store
//! generation fences around exit evidence (frozen web-api/2 §6.1, §3.1.1,
//! with the R2 sync discipline carried over verbatim).
//!
//! The client-level snapshot SHAPE is covered by web-api-v2-client.test.mjs;
//! this file covers what the STORE does with a consumed V2 snapshot: the
//! same-epoch merge under per-task generation authority, the low-watermark
//! fence, the cross-epoch wholesale replacement, the attempt-identity and
//! verdict-direction fences, and the pairing pipeline's V2 frame discipline
//! (a V1 or versionless frame drives nothing).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createPinia, setActivePinia } from 'pinia';
import { WebApiClient } from '../../src/lib/web-api-client.ts';
import { createOrganizerModel } from '../../src/stores/organizer.ts';
import { createPairing } from '../../src/stores/pairing.ts';

const FIX = new URL('../fixtures/web-api-v2-client/', import.meta.url);
const frozen = (name) => JSON.parse(readFileSync(new URL(`frozen/${name}`, FIX), 'utf8'));

const EPOCH = 'inst_9f27c1aa40b2';

// --- fixtures ---------------------------------------------------------------

/// A domain-shaped run row (what the client mapper produces for a wire task).
function runRow({ id = 'tsk_a', version = 1, attemptId = 'att_a', attemptCount = 1, state = 'running', exitState = 'active', evidence = null, evidenceError = null, createdAtMs = 1, status = 'running' } = {}) {
  return {
    id, sourceId: null, kind: 'extract', status,
    snapshot: {}, input: {}, candidateId: null, candidateVersion: null,
    preview: null, errorCode: null, createdAtMs, finishedAtMs: null,
    wireVersion: version, wireAttemptCount: attemptCount, wireState: state,
    wireAttemptId: attemptId, wireExitState: exitState,
    wireExitEvidence: evidence, wireExitEvidenceError: evidenceError,
  };
}

const CONFIRMED_EVIDENCE = () => ({
  verdict: 'registry_extinct', workerExited: true, groupAbsent: true,
  registry: { total: 2, confirmedExtinct: 2, unobservable: 0, survivors: [] },
  argvScan: { performed: true, hits: 0 },
  veto: { triggered: false, reason: null, detail: null },
  residual: { treeExtinctProven: false, scope: 'registry_domain', strayLedger: { found: 1, swept: 1, pending: 0 } },
  confirmedAt: '2026-11-06T12:50:00.000Z',
});

const UNRESOLVED_EVIDENCE = () => ({
  verdict: 'unresolved', workerExited: true, groupAbsent: false,
  registry: { total: 1, confirmedExtinct: 0, unobservable: 1, survivors: [] },
  argvScan: null,
  veto: { triggered: true, reason: 'insufficient_evidence', detail: null },
  residual: { treeExtinctProven: false, scope: 'registry_domain', strayLedger: null },
  confirmedAt: null,
});

/// A minimal §6.1-shaped snapshot envelope carrying the given store rows.
function snapshotEnvelope({ epoch = EPOCH, highWatermark = 100, tasks = [], topLevelConcurrency = 3 } = {}) {
  return {
    contractVersion: 'web-api/2',
    epoch,
    highWatermark,
    generatedAt: '2026-11-06T12:32:00.000Z',
    lastEventId: `${epoch}:${highWatermark}`,
    settings: { agentConcurrency: 3, version: 5 },
    agentConcurrency: topLevelConcurrency,
    workspace: { mode: 'local', currentRoot: { id: 'root_a1b2c3d4e5f6', label: '默认工作根（合成示例）' }, capabilities: ['workspace.manage'], recovery: null },
    tasks,
  };
}

/// An organizer model over a scripted fake backend (no HTTP), so the fences
/// are exercised exactly where they live.
function fakeBackend(overrides = {}) {
  const scripted = {
    list_import_batches: () => [],
    active_model_run: () => null,
    read_model_run: () => null,
    read_import_batch: () => null,
    organize_text: () => { throw new Error('not scripted'); },
    ...overrides,
  };
  return async (command) => {
    const handler = scripted[command];
    if (!handler) throw new Error(`unexpected command ${command}`);
    return handler();
  };
}

// --- snapshot consumption ---------------------------------------------------

test('a consumed §6.1 snapshot installs the full-field rows with their evidence and identity', async () => {
  const model = createOrganizerModel(fakeBackend());
  const client = new WebApiClient();
  const calls = [];
  globalThis.window = { location: { host: 'h', origin: 'http://h' } };
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      const body = frozen('snapshot-high-watermark.json');
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const snapshot = await client.readSnapshot();
    model.applySnapshot(snapshot, null);
    // The snapshot carries a cancelling row and a queued row; the display
    // falls back to the newest running-ish snapshot row (the queued one).
    assert.equal(model.run.value?.id, 'tsk_8e4f2a6b0c9d3e71f5a8b2c4d6e0f913');
    assert.equal(model.run.value?.wireExitState, 'not_started');
    assert.equal(model.error.value, '');
    assert.ok(calls.every((url) => url === '/api/snapshot'));
  } finally {
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
    else delete globalThis.fetch;
    delete globalThis.window;
  }
});

test('the snapshot rows keep their exit evidence and attempt identity in the store baseline', () => {
  const confirmed = runRow({ id: 'tsk_conf', version: 5, attemptId: 'att_2b9e', state: 'needs_review', exitState: 'exited_confirmed', evidence: CONFIRMED_EVIDENCE(), status: 'interrupted', createdAtMs: 2 });
  const active = runRow({ id: 'tsk_run', version: 2, state: 'running', exitState: 'active', status: 'running', createdAtMs: 5 });
  const model = createOrganizerModel(fakeBackend());
  model.applySnapshot(snapshotEnvelope({ tasks: [confirmed, active] }), null);
  // The display follows the running row; its identity rides the baseline row.
  assert.equal(model.run.value?.id, 'tsk_run');
  assert.equal(model.run.value?.wireAttemptId, 'att_a');
  assert.equal(model.run.value?.wireExitState, 'active');
});

// --- generation fences over the read path (acceptRun) -----------------------

test('a same-epoch snapshot row older than a newer read-back never erases its evidence', async () => {
  const newer = runRow({ id: 'tsk_a', version: 4, state: 'needs_review', exitState: 'exited_unknown', evidence: UNRESOLVED_EVIDENCE(), status: 'interrupted' });
  const olderSnapshotRow = runRow({ id: 'tsk_a', version: 3, state: 'running', exitState: 'active', status: 'running' });
  const model = createOrganizerModel(fakeBackend({
    test_model: async () => newer,
    active_model_run: async () => 'tsk_a',
    read_model_run: async () => newer,
  }));
  // The newer authoritative read-back lands first (the regular read path).
  await model.testModel();
  assert.equal(model.run.value?.wireVersion, 4);
  // The snapshot that was in flight while that read-back landed arrives now:
  // same epoch, strictly newer watermark, but its row is the OLDER generation.
  model.applySnapshot(snapshotEnvelope({ highWatermark: 100, tasks: [olderSnapshotRow] }), EPOCH);
  assert.equal(model.run.value?.wireVersion, 4, 'the newer generation stays installed');
  assert.equal(model.run.value?.wireExitEvidence?.verdict, 'unresolved', 'the newer evidence stays installed');
});

test('a same-version row with a different attempt id is refused — evidence keeps its attempt identity', async () => {
  const installed = runRow({ id: 'tsk_a', version: 4, attemptId: 'att_1', state: 'needs_review', exitState: 'exited_unknown', evidence: UNRESOLVED_EVIDENCE(), status: 'interrupted', createdAtMs: 2 });
  const forged = runRow({ id: 'tsk_a', version: 4, attemptId: 'att_2', state: 'needs_review', exitState: 'exited_confirmed', evidence: CONFIRMED_EVIDENCE(), status: 'interrupted', createdAtMs: 2 });
  let current = installed;
  const model = createOrganizerModel(fakeBackend({
    active_model_run: async () => 'tsk_a',
    read_model_run: async () => current,
  }));
  await model.refresh();
  assert.equal(model.run.value?.wireAttemptId, 'att_1');
  // Same task version, DIFFERENT attempt id carrying a confirmed-looking
  // evidence object: per §3.1 the version is the migration authority, so this
  // stale/self-contradictory row must not overwrite the installed attempt.
  current = forged;
  await model.refresh();
  assert.equal(model.run.value?.wireAttemptId, 'att_1');
  assert.equal(model.run.value?.wireExitEvidence?.verdict, 'unresolved');
});

test('a confirmed verdict never regresses to unresolved at the same version (invariant 6)', async () => {
  const confirmed = runRow({ id: 'tsk_a', version: 5, attemptId: 'att_1', state: 'needs_review', exitState: 'exited_confirmed', evidence: CONFIRMED_EVIDENCE(), status: 'interrupted', createdAtMs: 2 });
  const regression = runRow({ id: 'tsk_a', version: 5, attemptId: 'att_1', state: 'needs_review', exitState: 'exited_unknown', evidence: UNRESOLVED_EVIDENCE(), status: 'interrupted', createdAtMs: 2 });
  let current = confirmed;
  const model = createOrganizerModel(fakeBackend({
    active_model_run: async () => 'tsk_a',
    read_model_run: async () => current,
  }));
  await model.refresh();
  assert.equal(model.run.value?.wireExitEvidence?.verdict, 'registry_extinct');
  current = regression;
  await model.refresh();
  assert.equal(model.run.value?.wireExitEvidence?.verdict, 'registry_extinct', 'confirmed evidence stays installed');
});

test('a strictly newer generation legitimately updates state and evidence', async () => {
  const unresolved = runRow({ id: 'tsk_a', version: 4, attemptId: 'att_1', state: 'needs_review', exitState: 'exited_unknown', evidence: UNRESOLVED_EVIDENCE(), status: 'interrupted', createdAtMs: 2 });
  const reVerified = runRow({ id: 'tsk_a', version: 5, attemptId: 'att_1', state: 'needs_review', exitState: 'exited_confirmed', evidence: CONFIRMED_EVIDENCE(), status: 'interrupted', createdAtMs: 2 });
  let current = unresolved;
  const model = createOrganizerModel(fakeBackend({
    active_model_run: async () => 'tsk_a',
    read_model_run: async () => current,
  }));
  await model.refresh();
  assert.equal(model.run.value?.wireVersion, 4);
  // The recovery scan re-verified the predicate: version bump + confirmed.
  current = reVerified;
  await model.refresh();
  assert.equal(model.run.value?.wireVersion, 5);
  assert.equal(model.run.value?.wireExitEvidence?.verdict, 'registry_extinct');
});

// --- watermark and epoch fences ---------------------------------------------

test('a same-epoch snapshot at or below the applied watermark is dropped, never reinstalled', () => {
  const original = runRow({ id: 'tsk_a', version: 4 });
  const model = createOrganizerModel(fakeBackend());
  model.applySnapshot(snapshotEnvelope({ highWatermark: 10, tasks: [original] }), null);
  const stale = runRow({ id: 'tsk_a', version: 1, state: 'queued', exitState: 'not_started', status: 'queued' });
  model.applySnapshot(snapshotEnvelope({ highWatermark: 5, tasks: [stale] }), EPOCH);
  assert.equal(model.run.value?.wireVersion, 4, 'the stale snapshot never landed');
});

test('a cross-epoch snapshot is the explicit whole-generation replacement', () => {
  const old = runRow({ id: 'tsk_old', version: 4 });
  const model = createOrganizerModel(fakeBackend());
  model.applySnapshot(snapshotEnvelope({ epoch: EPOCH, highWatermark: 10, tasks: [old] }), null);
  const fresh = runRow({ id: 'tsk_fresh', version: 1, createdAtMs: 5 });
  model.applySnapshot(snapshotEnvelope({ epoch: 'inst_c4018ee7b5a9', highWatermark: 3, tasks: [fresh] }), EPOCH);
  assert.equal(model.run.value?.id, 'tsk_fresh');
  assert.equal(model.run.value?.wireVersion, 1);
});

// --- pairing pipeline: V2 frame discipline ----------------------------------

test('a V1 or versionless frame drives nothing; a web-api/2 frame dispatches its read-back', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  setActivePinia(createPinia());
  const connections = [];
  const snapshotFetches = [];
  const encoder = new TextEncoder();
  const hints = [];
  globalThis.window = { location: { host: 'h', origin: 'http://h' } };
  globalThis.fetch = async (url) => {
    if (String(url) === '/api/snapshot') {
      snapshotFetches.push(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify(frozen('snapshot-high-watermark.json')) };
    }
    const stream = new ReadableStream({ start(c) { connections.push(c); } });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const emit = (controller, event, data, id) => controller.enqueue(encoder.encode(`event: ${event}\n${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`));
  const waitFor = async (predicate, what) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > 3000) throw new Error(`timeout waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const client = {
    onSessionLost() {},
    readSession: async () => null,
    pair: async () => ({}),
    readSnapshot: async () => {
      // The REAL client path — the frozen sample must pass §6.1 validation.
      const real = new WebApiClient();
      return real.readSnapshot();
    },
  };
  const pairing = createPairing(client);
  let disposed = false;
  try {
    pairing.setOnItemChanged((event) => { hints.push(event); });
    await pairing.start();
    await pairing.pair();
    await waitFor(() => connections.length >= 1, 'the subscription');
    // V1-shaped and versionless frames: rejected outright — no hint, no token
    // commit, and a V1 stream.reset never drives a snapshot resync.
    emit(connections[0], 'task.changed', { contractVersion: 'web-api/1', cursor: 2, objectType: 'task', objectId: 'tsk_x', objectVersion: 2, taskState: 'running', attemptExitState: 'active', at: '2026-11-06T12:30:41.000Z' }, `${EPOCH}:2`);
    emit(connections[0], 'task.changed', { cursor: 3, objectType: 'task', objectId: 'tsk_x', objectVersion: 3, taskState: 'running', attemptExitState: 'active', at: '2026-11-06T12:30:42.000Z' }, `${EPOCH}:3`);
    emit(connections[0], 'stream.reset', { contractVersion: 'web-api/1', epoch: 'inst_other', reason: 'epoch_changed' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(hints.length, 0, 'no V1/versionless frame was applied');
    assert.equal(snapshotFetches.length, 0, 'a V1 reset never triggers a snapshot');
    // The V2 frame with a NEWER cursor dispatches the read-back hint.
    emit(connections[0], 'task.changed', { contractVersion: 'web-api/2', cursor: 4, epoch: EPOCH, objectType: 'task', objectId: 'tsk_x', objectVersion: 4, taskState: 'running', attemptExitState: 'exiting', at: '2026-11-06T12:31:20.000Z' }, `${EPOCH}:4`);
    await waitFor(() => hints.length >= 1, 'the V2 hint');
    assert.deepEqual(hints, ['task.changed']);
    pairing.dispose();
    disposed = true;
  } finally {
    if (!disposed) pairing.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
    else delete globalThis.fetch;
  }
});

// --- late low-version responses never overwrite -----------------------------

test('a late web-api/1 read-back is rejected by the transport and cannot overwrite the installed run', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  globalThis.window = { location: { host: 'h', origin: 'http://h' } };
  try {
    const confirmed = runRow({ id: 'tsk_conf', version: 5, attemptId: 'att_1', state: 'needs_review', exitState: 'exited_confirmed', evidence: CONFIRMED_EVIDENCE(), status: 'interrupted', createdAtMs: 2 });
    const active = runRow({ id: 'tsk_run', version: 2, state: 'running', exitState: 'active', status: 'running', createdAtMs: 5 });
    const client = new WebApiClient();
    const model = createOrganizerModel(client.asBackend());
    model.applySnapshot(snapshotEnvelope({ tasks: [confirmed, active] }), null);
    const staleWire = {
      contractVersion: 'web-api/1', taskId: 'tsk_run', operationId: 'op_1', type: 'extract', role: 'organizer',
      state: 'running', version: 1, createdAt: '1970-01-01T00:00:00.001Z', updatedAt: '1970-01-01T00:00:00.002Z',
      terminalAt: null, submitSeq: 1, queuePosition: null, attemptCount: 1, attemptId: 'att_0',
      attemptExitState: 'active', attemptExitEvidence: null, cancelIntent: false,
      configRevision: 'r1', originalConfigRevision: 'r1', inputRef: {},
      progress: null, result: null, resultPendingExit: false, failure: null, recovery: null,
    };
    // Any JSON read on this pipeline now answers web-api/1: the transport
    // rejects it before the store can see a single byte of the payload.
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ contractVersion: 'web-api/1', task: staleWire }) });
    await assert.rejects(() => model.refresh(), (error) => error.code === 'contract_version');
    assert.equal(model.run.value?.wireVersion, 2, 'the installed newer run is untouched');
    assert.ok(model.error.value !== '', 'the rejection is surfaced readably');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
    else delete globalThis.fetch;
  }
});
