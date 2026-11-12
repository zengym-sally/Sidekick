//! MAYNE-38: unit regression for the web-api/2 client layer — version
//! identification (frozen web-api/2 §1), the typed `attemptExitEvidence`
//! validation (§3.1.1), the §6.1 snapshot shape and the concurrency CAS
//! source (§5).
//!
//! Positive controls are BYTE-EXACT copies of the frozen 0c9febc contract
//! samples (`frozen/`); negative controls are derived fixtures that introduce
//! exactly one spec-named defect each (`derived/`, see the fixture README).
//! This file asserts the CLIENT contract only: it never re-derives the
//! server's exit predicate and never treats a truthy object as evidence.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { WebApiClient, WebApiError, CONTRACT_VERSION, parseAttemptExitEvidence } from '../../src/lib/web-api-client.ts';

const FIX = new URL('../fixtures/web-api-v2-client/', import.meta.url);
const frozen = (name) => JSON.parse(readFileSync(new URL(`frozen/${name}`, FIX), 'utf8'));
const derived = (name) => JSON.parse(readFileSync(new URL(`derived/${name}`, FIX), 'utf8'));

const UNRESOLVED_SAMPLES = [
  'task-exit-unconfirmed-stray-pending.json',
  'task-exit-unconfirmed-argv-hit.json',
  'task-exit-unconfirmed-argv-not-performed.json',
  'task-exit-unconfirmed-argv-scan-failed.json',
  'task-exit-unconfirmed-argv-scan-eperm.json',
  'task-exit-unconfirmed-group-eperm.json',
  'task-exit-unconfirmed-group-survivor.json',
];

// --- test seams ------------------------------------------------------------

function withBrowserEnv(run) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  globalThis.window = { location: { host: 'h', origin: 'http://h' } };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else delete globalThis.window;
      if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
      else delete globalThis.fetch;
    });
}

/// A fetch seam answering ONE queued response per call, recording requests.
function fetchSeck(responses) {
  const calls = [];
  const queue = [...responses];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body === undefined ? null : JSON.parse(String(init.body)) });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === 'function' ? next() : next;
  };
  return calls;
}

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

// --- §1: the transport identifies web-api/2 and rejects everything else -----

test('a web-api/2 envelope passes the transport and the payload is returned', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const calls = fetchSeck([jsonResponse(200, frozen('settings-concurrency.json'))]);
    const payload = await client.readConcurrency();
    assert.equal(payload.contractVersion, 'web-api/2');
    assert.equal(payload.version, 5);
    assert.equal(calls[0].url, '/api/settings/agent-concurrency');
  });
});

for (const [name, body] of [
  ['a web-api/1 envelope', { contractVersion: 'web-api/1', version: 5 }],
  ['a missing version', { version: 5 }],
  ['a wrong-version string', { contractVersion: 'web-api/9', version: 5 }],
  ['a bare array', [1, 2, 3]],
  ['an empty body', null],
]) {
  test(`the transport rejects ${name} outright (no default, no V1 shim)`, async () => {
    await withBrowserEnv(async () => {
      const client = new WebApiClient();
      fetchSeck([jsonResponse(200, body)]);
      await assert.rejects(() => client.readConcurrency(), (error) => {
        assert.ok(error instanceof WebApiError);
        assert.equal(error.code, 'contract_version');
        assert.match(error.message, /web-api\/2/);
        return true;
      });
    });
  });
}

test('the frozen 409 exit_unconfirmed error envelope surfaces its code and details', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    fetchSeck([jsonResponse(409, frozen('error-exit-unconfirmed-409.json'))]);
    await assert.rejects(() => client.resolveTask('tsk_3f8a1c5e9b2d4706fa1c3e5b7d9a2f48', 1, 'resume', []), (error) => {
      assert.equal(error.code, 'exit_unconfirmed');
      assert.equal(error.status, 409);
      assert.equal(error.details.attemptExitState, 'exited_unknown');
      assert.match(error.message, /registry-domain|登记|resolve/);
      return true;
    });
  });
});

test('a V1 error envelope is rejected as a version violation, not consumed', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    fetchSeck([jsonResponse(409, { contractVersion: 'web-api/1', status: 409, error: { code: 'exit_unconfirmed', message: '旧版本错误' } })]);
    await assert.rejects(() => client.resolveTask('tsk_x', 1, 'resume', []), (error) => {
      assert.equal(error.code, 'contract_version');
      assert.equal(error.status, 409);
      return true;
    });
  });
});

// --- §3.1.1: the typed evidence validation (frozen positives) ---------------

test('every frozen unresolved veto sample validates as unresolved with its reason intact', () => {
  for (const name of UNRESOLVED_SAMPLES) {
    const task = frozen(name);
    const parsed = parseAttemptExitEvidence(task.attemptExitEvidence, task.attemptExitState);
    assert.equal(parsed.error, null, name);
    assert.equal(parsed.evidence.verdict, 'unresolved', name);
    assert.equal(parsed.evidence.veto.triggered, true, name);
    assert.ok(parsed.evidence.veto.reason, name);
    assert.equal(parsed.evidence.confirmedAt, null, name);
    assert.equal(parsed.evidence.residual.treeExtinctProven, false, name);
  }
});

test('the frozen reclaimed sample validates as registry_extinct with the full confirming face', () => {
  const task = frozen('task-needs-review-exit-reclaimed.json');
  const parsed = parseAttemptExitEvidence(task.attemptExitEvidence, task.attemptExitState);
  assert.equal(parsed.error, null);
  const evidence = parsed.evidence;
  assert.equal(evidence.verdict, 'registry_extinct');
  assert.equal(evidence.workerExited, true);
  assert.equal(evidence.groupAbsent, true);
  assert.deepEqual(evidence.registry, { total: 2, confirmedExtinct: 2, unobservable: 0, survivors: [] });
  assert.deepEqual(evidence.argvScan, { performed: true, hits: 0 });
  assert.equal(evidence.veto.triggered, false);
  assert.equal(evidence.residual.treeExtinctProven, false);
  assert.deepEqual(evidence.residual.strayLedger, { found: 1, swept: 1, pending: 0 });
  assert.equal(evidence.confirmedAt, '2026-11-06T12:50:00.000Z');
});

test('an active task row carries null evidence and no error', () => {
  const task = frozen('task-resource-running.json');
  const parsed = parseAttemptExitEvidence(task.attemptExitEvidence, task.attemptExitState);
  assert.equal(parsed.evidence, null);
  assert.equal(parsed.error, null);
});

// --- §3.1.1: derived negatives fail closed with readable reasons ------------

for (const [name, why] of [
  ['task-evidence-malformed-tree-proven.json', 'treeExtinctProven'],
  ['task-evidence-malformed-identity.json', '自相矛盾|total'],
  ['task-evidence-argv-hit-confirmed.json', '不变式'],
  ['task-evidence-verdict-state-mismatch.json', '自相矛盾'],
]) {
  test(`derived negative ${name} is rejected (${why})`, () => {
    const task = derived(name);
    const parsed = parseAttemptExitEvidence(task.attemptExitEvidence, task.attemptExitState);
    assert.equal(parsed.evidence, null, name);
    assert.match(parsed.error, new RegExp(why), name);
  });
}

test('missing evidence on exited_unknown is rejected, not defaulted', () => {
  const task = derived('task-evidence-null-on-exited-unknown.json');
  const parsed = parseAttemptExitEvidence(task.attemptExitEvidence, task.attemptExitState);
  assert.equal(parsed.evidence, null);
  assert.match(parsed.error, /缺失/);
});

test('evidence on an active row is rejected as an unexpected self-contradiction', () => {
  const task = derived('task-evidence-on-active.json');
  const parsed = parseAttemptExitEvidence(task.attemptExitEvidence, task.attemptExitState);
  assert.equal(parsed.evidence, null);
  assert.match(parsed.error, /不应携带证据/);
});

test('garbage evidence shapes never become truthy objects', () => {
  for (const raw of ['yes', 1, [], {}, { verdict: 'registry_extinct' }]) {
    const parsed = parseAttemptExitEvidence(raw, 'exited_confirmed');
    assert.equal(parsed.evidence, null);
    assert.ok(parsed.error);
  }
});

// --- §3.1.1 invariants 2/3: the blocking face and the argv reason constraint -
//
// A `unresolved` verdict is only meaningful when at least one expressible
// blocking face exists, and the argv observation constrains the veto reason.
// These cross-negatives mutate a frozen VALID unresolved sample in exactly one
// way each; none of them is a "truthy object" check.

for (const [name, mutate, why] of [
  ['argvScan=null with veto.reason=known_survivor', (evidence) => { evidence.argvScan = null; evidence.veto.reason = 'known_survivor'; }, 'insufficient_evidence'],
  ['argvScan.performed=false with veto.reason=identity_mismatch', (evidence) => { evidence.argvScan = { performed: false, hits: 0 }; evidence.veto.reason = 'identity_mismatch'; }, 'insufficient_evidence'],
  ['argvScan.hits>0 with veto.reason=eperm', (evidence) => { evidence.argvScan = { performed: true, hits: 1 }; evidence.veto.reason = 'eperm'; }, 'known_survivor'],
  ['argvScan.performed=false with hits>0', (evidence) => { evidence.argvScan = { performed: false, hits: 1 }; }, 'hits'],
]) {
  test(`invariant 3 rejects ${name}`, () => {
    const task = frozen('task-exit-unconfirmed-group-survivor.json');
    mutate(task.attemptExitEvidence);
    const parsed = parseAttemptExitEvidence(task.attemptExitEvidence, task.attemptExitState);
    assert.equal(parsed.evidence, null);
    assert.match(parsed.error, new RegExp(why));
  });
}

test('invariant 2 rejects an unresolved verdict with no expressible blocking face', () => {
  // Every observation satisfies the confirming conjunction, yet the row
  // claims `unresolved` with a fabricated veto — self-contradictory.
  const task = frozen('task-needs-review-exit-reclaimed.json');
  const evidence = task.attemptExitEvidence;
  evidence.verdict = 'unresolved';
  evidence.confirmedAt = null;
  evidence.veto = { triggered: true, reason: 'known_survivor', detail: null };
  const parsed = parseAttemptExitEvidence(evidence, 'exited_unknown');
  assert.equal(parsed.evidence, null);
  assert.match(parsed.error, /阻塞面/);
});

// --- mapping: evidence + identity ride the store row ------------------------

test('read_model_run maps the confirmed evidence and the attempt identity onto the store row', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const task = frozen('task-needs-review-exit-reclaimed.json');
    fetchSeck([jsonResponse(200, { contractVersion: 'web-api/2', task })]);
    const run = await client.asBackend()('read_model_run', { id: task.taskId });
    assert.equal(run.wireVersion, task.version);
    assert.equal(run.wireAttemptCount, task.attemptCount);
    assert.equal(run.wireAttemptId, task.attemptId);
    assert.equal(run.wireExitState, 'exited_confirmed');
    assert.equal(run.wireExitEvidence?.verdict, 'registry_extinct');
    assert.equal(run.wireExitEvidenceError, null);
  });
});

test('read_model_run maps a malformed evidence row fail-closed with the readable reason', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const task = derived('task-evidence-malformed-tree-proven.json');
    fetchSeck([jsonResponse(200, { contractVersion: 'web-api/2', task })]);
    const run = await client.asBackend()('read_model_run', { id: task.taskId });
    assert.equal(run.wireExitEvidence, null);
    assert.match(run.wireExitEvidenceError, /treeExtinctProven/);
  });
});

// --- §6.1: the snapshot shape ----------------------------------------------

test('the frozen §6.1 snapshot is consumed whole, including nested settings/workspace and evidence rows', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const snapshot = frozen('snapshot-high-watermark.json');
    fetchSeck([jsonResponse(200, snapshot)]);
    const read = await client.readSnapshot();
    assert.equal(read.contractVersion, 'web-api/2');
    assert.equal(read.epoch, snapshot.epoch);
    assert.equal(read.highWatermark, 1042);
    assert.equal(read.generatedAt, snapshot.generatedAt);
    assert.equal(read.lastEventId, snapshot.lastEventId);
    assert.deepEqual(read.settings, { agentConcurrency: 3, version: 5 });
    assert.equal(read.workspace.mode, 'local');
    assert.deepEqual(read.workspace.currentRoot, { id: 'root_a1b2c3d4e5f6', label: snapshot.workspace.currentRoot.label });
    assert.deepEqual(read.workspace.capabilities, snapshot.workspace.capabilities);
    assert.equal(read.workspace.recovery, null);
    assert.equal(read.agentConcurrency, 3);
    assert.equal(read.tasks.length, 2);
    const cancelling = read.tasks.find((row) => row.wireState === 'cancelling');
    assert.equal(cancelling.wireExitState, 'exiting');
    assert.equal(cancelling.wireExitEvidence, null);
  });
});

test('the snapshot is accepted when the server omits the optional top-level agentConcurrency', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const snapshot = frozen('snapshot-high-watermark.json');
    delete snapshot.agentConcurrency;
    fetchSeck([jsonResponse(200, snapshot)]);
    const read = await client.readSnapshot();
    assert.equal(read.agentConcurrency, null);
    assert.deepEqual(read.settings, { agentConcurrency: 3, version: 5 });
  });
});

for (const name of [
  'snapshot-missing-generatedat.json',
  'snapshot-missing-settings.json',
  'snapshot-missing-workspace.json',
  'snapshot-agentconcurrency-mismatch.json',
  'snapshot-lasteventid-mismatch.json',
]) {
  test(`derived snapshot negative ${name} is rejected wholesale`, async () => {
    await withBrowserEnv(async () => {
      const client = new WebApiClient();
      fetchSeck([jsonResponse(200, derived(name))]);
      await assert.rejects(() => client.readSnapshot(), (error) => {
        assert.equal(error.code, 'contract_shape');
        assert.match(error.message, /快照形状不合规/);
        return true;
      });
    });
  });
}

test('a snapshot with a trimmed (non-§3.1) task entry is rejected, not silently mapped', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    fetchSeck([jsonResponse(200, derived('snapshot-trimmed-task.json'))]);
    await assert.rejects(() => client.readSnapshot(), (error) => {
      assert.equal(error.code, 'contract_shape');
      return true;
    });
  });
});

test('a V1 snapshot envelope never reaches the mapping (transport rejection)', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const snapshot = frozen('snapshot-high-watermark.json');
    snapshot.contractVersion = 'web-api/1';
    fetchSeck([jsonResponse(200, snapshot)]);
    await assert.rejects(() => client.readSnapshot(), (error) => error.code === 'contract_version');
  });
});

// --- §1/§3.1: the task resource's OWN version is the identity gate ---------
//
// The outer V2 envelope cannot authorize a nested V1/versionless task: the
// version check is per-resource on the list, the detail AND the snapshot, so
// a V1+V2 field mixture is never consumed as evidence.

test('a V1 nested task in a V2 task list is rejected readably, not consumed', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const task = frozen('task-resource-running.json');
    task.contractVersion = 'web-api/1';
    fetchSeck([jsonResponse(200, { contractVersion: 'web-api/2', tasks: [task], nextCursor: null })]);
    await assert.rejects(() => client.listTasks(), (error) => {
      assert.equal(error.code, 'contract_version');
      assert.match(error.message, /tasks\[0\]/);
      assert.match(error.message, /web-api\/1/);
      return true;
    });
  });
});

test('a versionless nested task in a V2 task detail is rejected readably', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const task = frozen('task-resource-running.json');
    delete task.contractVersion;
    fetchSeck([jsonResponse(200, { contractVersion: 'web-api/2', task })]);
    await assert.rejects(() => client.asBackend()('read_model_run', { id: task.taskId }), (error) => {
      assert.equal(error.code, 'contract_version');
      assert.match(error.message, /缺失版本/);
      return true;
    });
  });
});

test('a V1 nested task in a V2 snapshot is rejected readably', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const snapshot = frozen('snapshot-high-watermark.json');
    snapshot.tasks[0].contractVersion = 'web-api/1';
    fetchSeck([jsonResponse(200, snapshot)]);
    await assert.rejects(() => client.readSnapshot(), (error) => {
      assert.equal(error.code, 'contract_shape');
      assert.match(error.message, /自身契约版本/);
      return true;
    });
  });
});

// --- §5: the concurrency CAS source is the settings version -----------------

test('writeConcurrency sends the settings VERSION as expectedVersion, never the concurrency value', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const calls = fetchSeck([
      jsonResponse(200, frozen('settings-concurrency.json')),
      jsonResponse(200, frozen('settings-concurrency.json')),
    ]);
    // Read (version 5, value 3) then write with THAT version. A value-as-
    // version bug would send 3 instead of 5 — the frozen server's CAS would
    // treat 3 as a stale settings version (409), and this assert pins it.
    await client.readConcurrency();
    await client.writeConcurrency(4, 5);
    assert.deepEqual(calls[1].body, { agentConcurrency: 4, expectedVersion: 5 });
  });
});

test('writeConcurrency 409 version_conflict from the frozen sample surfaces its code', async () => {
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    fetchSeck([jsonResponse(409, frozen('error-version-conflict-409.json'))]);
    await assert.rejects(() => client.writeConcurrency(4, 5), (error) => {
      assert.equal(error.code, 'version_conflict');
      return true;
    });
  });
});

// --- §1: the version constant and the input shapes --------------------------

test('the client contract constant is web-api/2 and request shapes stay versionless', async () => {
  assert.equal(CONTRACT_VERSION, 'web-api/2');
  await withBrowserEnv(async () => {
    const client = new WebApiClient();
    const calls = fetchSeck([
      jsonResponse(200, { contractVersion: 'web-api/2', replayed: false, taskId: 'tsk_1', state: 'queued', version: 1, queuePosition: 1, task: frozen('task-resource-running.json') }),
    ]);
    await client.submitTask('op_1', 'test', 'organizer', { modelId: null });
    // §1/§15: requests that never carried contractVersion keep their exact
    // input shape — the client adds no field.
    assert.deepEqual(calls[0].body, { operationId: 'op_1', type: 'test', role: 'organizer', input: { modelId: null } });
  });
});
