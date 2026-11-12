//! MCP begin/closed pairing regression (MAYNE-24).
//!
//! Drives REAL runtime-shaped frames through the REAL production chain:
//! WorkerHost.start (stdio fencing by runId + hostNonce) -> receiptFactsFor
//! -> TaskScheduler.onWorkerFrame (ordered, awaited) -> TaskService.recordReceipt
//! (independent small transactions) -> the REAL Rust storage adapter (sqlite),
//! then reads `side_effect_receipts` back and evaluates the pairing on the
//! persisted rows. There is no pure-mapping shortcut and the production
//! registration loop is never re-implemented here: every assertion is on rows
//! that survived the real persistence chain, which is exactly the gap the
//! reviewed candidates' own unit tests left open.
//!
//! Coverage: successful closure (golden control + duplicate begin), same-server
//! reverse order, unknown callId, duplicate response, persistence commit
//! failure (throw and silent false), cross-server and cross-attempt isolation
//! of the same callId, and no reopening after closure.
//!
//! Prerequisites (named, never faked): the candidate-I `server/lib` modules
//! and a `web-backend-storage` binary built from a tree carrying the
//! text-intake migrations. While candidate I is not integrated, every test
//! fails with that prerequisite gap instead of claiming a result.
//!
//! Focused command:
//!   node --test --test-timeout=20000 tests/unit/web-text-intake-mcp-pairing.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createScriptedWorkerFactory } from '../fixtures/web-text-intake/mcp-pairing-worker.mjs';
import { mcpBegin, mcpResponse, extractResultFrame, loadGoldenFrames } from '../fixtures/web-text-intake/mcp-pairing-frames.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const storageBinary = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');

const MODEL_CONFIG = {
  providers: [{ id: 'controlled', name: 'Controlled', apiFormat: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', auth: { type: 'bearer', apiKeyRef: 'controlled:e2e' }, enabled: true }],
  models: [{ id: 'controlled-model', providerId: 'controlled', apiModelId: 'controlled-model', name: 'Controlled', enabled: true, capabilities: { toolCall: true } }],
  defaultModelId: 'controlled-model',
};
const SOURCE_TEXT = '我负责整理接入清单，下周五17点前交付。';

class PrerequisiteGap extends Error {}

let productionModules = null;
async function loadProduction() {
  if (productionModules) return productionModules;
  const specs = {
    StorageClient: '../../server/lib/storage-client.mjs',
    TaskService: '../../server/lib/task-service.mjs',
    TextIntakeService: '../../server/lib/text-intake-service.mjs',
    ConfigStore: '../../server/lib/config-store.mjs',
    ControlledCredentialProvider: '../../server/lib/credential-provider.mjs',
    TaskScheduler: '../../server/lib/task-scheduler.mjs',
    WorkerHost: '../../server/lib/worker-host.mjs',
  };
  const loaded = {};
  for (const [name, spec] of Object.entries(specs)) {
    try {
      loaded[name] = (await import(spec))[name];
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') {
        throw new PrerequisiteGap(`${spec} is not present in this tree: the MCP pairing production chain (candidate I) has not been integrated here, so this regression cannot run. Build the pairing chain first; no result is claimed until then.`);
      }
      throw error;
    }
  }
  productionModules = loaded;
  return loaded;
}

function requireStorageBinary() {
  if (!existsSync(storageBinary)) {
    throw new PrerequisiteGap(`storage adapter binary not found at ${storageBinary}; build it with cargo (npm run build:backend). The pairing receipts are asserted against real sqlite rows, so a placeholder is never substituted.`);
  }
}

/// The frozen receipt identity: sha256 of the compact JSON
/// [runId, attemptId, kind, callKey], first 32 hex. Used only to classify the
/// rows read back from storage, never to decide the pairing itself.
const receiptIdFor = (runId, attemptId, kind, callKey) => createHash('sha256')
  .update(JSON.stringify([runId, attemptId, kind, callKey]), 'utf8')
  .digest('hex').slice(0, 32);

async function waitFor(label, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

/// Run one scenario end to end through the real chain and return the persisted
/// receipt rows per claimed attempt, classified against the callKeys the
/// scenario could possibly have produced.
async function runScenario({ name, frames, tasks = 1, failBegin = null, silentFailBegin = false, frameDelayMs = 60 }) {
  const { StorageClient, TaskService, TextIntakeService, ConfigStore, ControlledCredentialProvider, TaskScheduler, WorkerHost } = await loadProduction();
  requireStorageBinary();
  const root = mkdtempSync(join(tmpdir(), 'mcp-pairing-'));
  const storage = new StorageClient({ binary: storageBinary, root, initialize: true });
  await storage.start();
  let scheduler = null;
  try {
    const credentialProvider = new ControlledCredentialProvider({ secrets: new Map([['controlled:e2e', 'synthetic']]) });
    const taskService = new TaskService({ storage });
    const configStore = new ConfigStore({ root, credentialProvider });
    const textIntake = new TextIntakeService({ storage, taskService, configStore });
    await configStore.writeModelConfiguration(MODEL_CONFIG, '');

    const submissions = [];
    for (let i = 0; i < tasks; i += 1) {
      // Distinct texts: identical submissions dedupe into one task.
      submissions.push(await textIntake.submitSource(`op_${name}_${i}`, { text: `${SOURCE_TEXT}（任务 ${i}）`, timeZone: 'Asia/Shanghai' }));
    }
    const taskIds = submissions.map((submission) => submission.task.taskId);

    const { factory, workers } = createScriptedWorkerFactory({ frames, delayMs: frameDelayMs });
    const workerHost = new WorkerHost({
      runtimeRoot: join(repositoryRoot, 'build/s0-runtime'),
      root,
      runLimitMs: 30000,
      processFactory: factory,
    });

    // Fault injection at the service seam only: make one begin's persistence
    // fail (throw = storage commit failure; return false = silently rejected,
    // e.g. a foreign epoch / non-active attempt). Everything else delegates to
    // the real recordReceipt.
    if (failBegin) {
      const original = taskService.recordReceipt.bind(taskService);
      let failedOnce = false;
      taskService.recordReceipt = async (args) => {
        if (!failedOnce && args.kind === 'tool_call_begin' && JSON.stringify(args.callKey) === JSON.stringify(failBegin)) {
          failedOnce = true;
          if (silentFailBegin) return false;
          throw new Error('simulated storage commit failure');
        }
        return original(args);
      };
    }

    scheduler = new TaskScheduler({
      taskService, textIntakeService: textIntake, workerHost, credentialProvider, pollMs: 30, epoch: 'inst_probe',
    });
    scheduler.start();

    const handles = [];
    for (const taskId of taskIds) {
      handles.push(await waitFor(`claim ${taskId}`, () => scheduler.active.get(taskId) ?? null));
    }
    // Let every scripted frame land, then let the workers exit.
    await Promise.race([
      Promise.all(workers.map((worker) => worker.doneEmitting)),
      new Promise((resolve) => setTimeout(resolve, 12000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (const worker of workers) worker.exit(0);
    for (const taskId of taskIds) {
      await waitFor(`terminal ${taskId}`, async () => {
        const task = await taskService.get(taskId);
        return ['succeeded', 'failed', 'needs_review', 'cancelled'].includes(task.state) ? task : null;
      });
    }
    const perAttempt = [];
    for (const handle of handles) {
      const rows = await storage.command('query', {
        sql: 'SELECT receipt_id,kind,external_ref FROM side_effect_receipts WHERE attempt_id=? ORDER BY recorded_at,rowid',
        params: [handle.attemptId],
      });
      perAttempt.push({ runId: handle.runId, attemptId: handle.attemptId, rows: rows.rows });
    }
    return { name, perAttempt };
  } finally {
    // Full cleanup, each step independent so one failure never skips the rest.
    if (scheduler) {
      try { await scheduler.stop(); } catch { /* the stop path is best-effort; the temp root removal below still runs */ }
    }
    try { await storage.close(); } catch { /* the child may already be gone */ }
    rmSync(root, { recursive: true, force: true });
  }
}

/// Classify every persisted row against the callKeys the scenario could
/// possibly have produced (MCP [callId, modelCallId], bash [pid, nonce],
/// unattributed callKey null).
function classify(perAttempt, calls, bashCalls = []) {
  const candidates = [];
  for (const kind of ['tool_call_begin', 'tool_call_closed', 'tool_call_unattributed']) {
    for (const call of calls) candidates.push({ kind, callKey: [call.callId, call.modelCallId], call });
    for (const bash of bashCalls) candidates.push({ kind, callKey: [bash.pid, bash.nonce], bash });
    candidates.push({ kind, callKey: null, call: null });
  }
  return perAttempt.map((attempt) => ({
    ...attempt,
    facts: attempt.rows.map(([receiptId, kind, externalRef]) => {
      const hit = candidates.find((candidate) => candidate.kind === kind
        && receiptIdFor(attempt.runId, attempt.attemptId, kind, candidate.callKey) === receiptId);
      return { receiptId, kind, externalRef, callKey: hit ? hit.callKey : 'UNKNOWN', call: hit?.call ?? null };
    }),
  }));
}

const factsOf = (classified) => classified[0].facts;
const closedOf = (facts) => facts.filter((fact) => fact.kind === 'tool_call_closed');
const beginsOf = (facts) => facts.filter((fact) => fact.kind === 'tool_call_begin');
const unattributedOf = (facts) => facts.filter((fact) => fact.kind === 'tool_call_unattributed');
const closedKey = (fact) => JSON.stringify(fact.callKey);

/// The pairing invariant: every MCP closure must point at a begin that
/// actually persisted in the same attempt, with the response's own callId as
/// external_ref — a closure can never carry another call's callKey.
function assertClosureInvariant(facts, calls) {
  const mcpCallKeys = new Set(calls.map((call) => JSON.stringify([call.callId, call.modelCallId])));
  const beginKeys = new Set(beginsOf(facts).map((fact) => JSON.stringify(fact.callKey)));
  for (const fact of closedOf(facts)) {
    if (!mcpCallKeys.has(JSON.stringify(fact.callKey))) continue; // a bash closure, not an MCP pairing
    assert.ok(beginKeys.has(JSON.stringify(fact.callKey)),
      `closed receipt ${JSON.stringify(fact.callKey)} has no persisted begin in the same attempt`);
    assert.equal(fact.externalRef, fact.callKey[0],
      `closed receipt callKey ${JSON.stringify(fact.callKey)} was closed by a different call (external_ref ${fact.externalRef})`);
  }
}

const assertClosedSet = (facts, expected, detail) => {
  const actual = closedOf(facts).map((fact) => `${closedKey(fact)}=${fact.externalRef}`).sort();
  assert.deepEqual(actual, [...expected].sort(), detail ?? `closed receipts: ${actual.join(' ; ') || 'none'}`);
};

// ---------------------------------------------------------------------------
// Golden control: real captured frames replayed through the real chain. The
// exact receipt set (including the bash closures and the foreign-identity
// frames recording nothing) is the positive control for correct closure.
// ---------------------------------------------------------------------------
test('golden replay: the exact receipt set is persisted and foreign-identity frames record nothing', async () => {
  const frames = [...loadGoldenFrames(), extractResultFrame()];
  const run = await runScenario({ name: 's1-golden', frames });
  const calls = [
    { callId: 'c-001', modelCallId: 'mc-001' },
    { callId: 'c-002', modelCallId: 'mc-002' },
    { callId: 'c-003', modelCallId: 'mc-003' },
  ];
  const bashCalls = [{ pid: 1001, nonce: 'nonce-bash-1' }, { pid: 1002, nonce: 'nonce-bash-2' }];
  const facts = factsOf(classify(run.perAttempt, calls, bashCalls));
  // The duplicated worker-end frame and the duplicated progress-tool frame are
  // idempotent (same receiptId); the two stale-run frames and the forged-nonce
  // begin are dropped by the production fence.
  const kinds = facts.map((fact) => `${fact.kind}${fact.callKey === 'UNKNOWN' ? '(UNKNOWN)' : `(${JSON.stringify(fact.callKey)})`}`);
  assert.deepEqual(kinds, [
    'tool_call_unattributed(null)',
    'tool_call_closed([1001,"nonce-bash-1"])',
    'tool_call_begin(["c-001","mc-001"])',
    'tool_call_closed(["c-001","mc-001"])',
    'tool_call_begin(["c-002","mc-002"])',
    'tool_call_closed([1002,"nonce-bash-2"])',
    'tool_call_begin(["c-003","mc-003"])',
  ], `persisted receipt sequence: ${facts.map((fact) => `${fact.kind}${JSON.stringify(fact.callKey)}=${fact.externalRef}`).join(' | ')}`);
  const foreignRefs = ['c-004', 'c-005', 'nonce-stale', 2001];
  const stale = facts.filter((fact) => foreignRefs.some((ref) => JSON.stringify(fact.callKey).includes(JSON.stringify(ref)) || fact.externalRef === ref));
  assert.equal(stale.length, 0, `foreign-identity frames recorded rows: ${stale.map((fact) => `${fact.kind}=${fact.externalRef}`).join(',')}`);
  assertClosureInvariant(facts, calls);
});

// ---------------------------------------------------------------------------
// Same server, two concurrent calls, responses in REVERSE order: each response
// must close the begin with the same callId — never the oldest open begin.
// ---------------------------------------------------------------------------
test('same-server reverse order: each response closes the begin with its own callId', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpBegin({ requestId: 'mcp-2', serverId: 'srv-search', callId: 'c-B', modelCallId: 'mc-B' }),
    mcpResponse({ requestId: 'mcp-2', serverId: 'srv-search', callId: 'c-B' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's2-reverse', frames });
  const calls = [{ callId: 'c-A', modelCallId: 'mc-A' }, { callId: 'c-B', modelCallId: 'mc-B' }];
  const facts = factsOf(classify(run.perAttempt, calls));
  assertClosedSet(facts, ['["c-A","mc-A"]=c-A', '["c-B","mc-B"]=c-B']);
  assert.equal(unattributedOf(facts).length, 0, `unexpected unattributed rows: ${unattributedOf(facts).map((fact) => fact.externalRef).join(',')}`);
  assertClosureInvariant(facts, calls);
});

// ---------------------------------------------------------------------------
// A response whose callId matches no begin (wrong callId): it closes nothing
// and is itself unattributed.
// ---------------------------------------------------------------------------
test('unknown callId: a response without a matching begin closes nothing', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpResponse({ requestId: 'mcp-9', serverId: 'srv-search', callId: 'c-ZZZ' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's3-wrong-callid', frames });
  const calls = [{ callId: 'c-A', modelCallId: 'mc-A' }];
  const facts = factsOf(classify(run.perAttempt, calls));
  assert.equal(closedOf(facts).length, 0, `an unknown callId closed: ${closedOf(facts).map((fact) => `${closedKey(fact)}=${fact.externalRef}`).join(' ; ')}`);
  assert.equal(beginsOf(facts).length, 1, 'the open begin must stay recorded');
  assert.ok(unattributedOf(facts).some((fact) => fact.externalRef === 'c-ZZZ'),
    `the wrong-callId response must be unattributed, got: ${unattributedOf(facts).map((fact) => fact.externalRef).join(',') || 'none'}`);
  assertClosureInvariant(facts, calls);
});

// ---------------------------------------------------------------------------
// A duplicate response frame while another begin of the same server is open:
// the duplicate closes nothing new and must not consume the other call's
// begin — the trailing response for that call still closes it.
// ---------------------------------------------------------------------------
test('duplicate response: closes nothing new and never consumes another begin', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpBegin({ requestId: 'mcp-2', serverId: 'srv-search', callId: 'c-B', modelCallId: 'mc-B' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A' }),
    mcpResponse({ requestId: 'mcp-2', serverId: 'srv-search', callId: 'c-B' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's4-duplicate-response', frames });
  const calls = [{ callId: 'c-A', modelCallId: 'mc-A' }, { callId: 'c-B', modelCallId: 'mc-B' }];
  const facts = factsOf(classify(run.perAttempt, calls));
  assertClosedSet(facts, ['["c-A","mc-A"]=c-A', '["c-B","mc-B"]=c-B']);
  const unattributed = unattributedOf(facts);
  assert.equal(unattributed.length, 1, `the duplicated response is the only unattributed row, got: ${unattributed.map((fact) => fact.externalRef).join(',') || 'none'}`);
  assert.equal(unattributed[0].externalRef, 'c-A');
  assertClosureInvariant(facts, calls);
});

// ---------------------------------------------------------------------------
// The begin's storage commit FAILS (throw). The response must not be able to
// close a begin that never persisted — no orphan closed receipt.
// ---------------------------------------------------------------------------
test('begin commit failure (throw): a begin that failed to persist is not closeable', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's5-begin-storage-failure', frames, failBegin: ['c-A', 'mc-A'] });
  const calls = [{ callId: 'c-A', modelCallId: 'mc-A' }];
  const facts = factsOf(classify(run.perAttempt, calls));
  assert.equal(beginsOf(facts).length, 0, 'the failed begin must not persist');
  assert.equal(closedOf(facts).length, 0, `a failed begin produced a closed receipt: ${closedOf(facts).map((fact) => `${closedKey(fact)}=${fact.externalRef}`).join(' ; ')}`);
  const unattributed = unattributedOf(facts);
  assert.equal(unattributed.length, 1, 'the response must be recorded unattributed');
  assert.equal(unattributed[0].externalRef, 'c-A');
});

// ---------------------------------------------------------------------------
// The begin is silently rejected (recordReceipt returns false, e.g. a foreign
// epoch / non-active attempt). Same requirement.
// ---------------------------------------------------------------------------
test('begin silently rejected (false): a rejected begin is not closeable', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's5b-begin-silent-reject', frames, failBegin: ['c-A', 'mc-A'], silentFailBegin: true });
  const calls = [{ callId: 'c-A', modelCallId: 'mc-A' }];
  const facts = factsOf(classify(run.perAttempt, calls));
  assert.equal(beginsOf(facts).length, 0, 'the rejected begin must not persist');
  assert.equal(closedOf(facts).length, 0, `a rejected begin produced a closed receipt: ${closedOf(facts).map((fact) => `${closedKey(fact)}=${fact.externalRef}`).join(' ; ')}`);
  const unattributed = unattributedOf(facts);
  assert.equal(unattributed.length, 1, 'the response must be recorded unattributed');
  assert.equal(unattributed[0].externalRef, 'c-A');
});

// ---------------------------------------------------------------------------
// Attempt isolation: the same callId under two concurrent attempts of two
// tasks. The open/closed pairing state must be isolated per attempt — a
// global serverId+callId map lets one attempt's closure consume or block the
// other's begin.
// ---------------------------------------------------------------------------
test('attempt isolation: the same callId in two concurrent attempts closes independently', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A' }),
    extractResultFrame(),
  ];
  // A wider frame gap keeps both begins persisted before either response
  // arrives, so the overlap is deterministic rather than timing-dependent.
  const run = await runScenario({ name: 's6-attempt-isolation', frames, tasks: 2, frameDelayMs: 200 });
  const calls = [{ callId: 'c-A', modelCallId: 'mc-A' }];
  const classified = classify(run.perAttempt, calls);
  assert.equal(classified.length, 2, 'both attempts must have been claimed');
  const closedIds = [];
  for (const attempt of classified) {
    const facts = attempt.facts;
    assert.equal(beginsOf(facts).length, 1, `attempt ${attempt.attemptId} begin rows: ${beginsOf(facts).length}`);
    assertClosedSet(facts, ['["c-A","mc-A"]=c-A'], `attempt ${attempt.attemptId} closures`);
    assert.equal(unattributedOf(facts).length, 0, `attempt ${attempt.attemptId} lost its closure to the other attempt`);
    assertClosureInvariant(facts, calls);
    closedIds.push(closedOf(facts)[0].receiptId);
  }
  assert.notEqual(closedIds[0], closedIds[1], 'the two attempts must produce distinct receipts');
});

// ---------------------------------------------------------------------------
// Orphan response (no begin at all): unattributed, nothing closed.
// ---------------------------------------------------------------------------
test('orphan response: a response with no begin at all is unattributed', async () => {
  const frames = [
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-ORPHAN' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's7-orphan-response', frames });
  const facts = factsOf(classify(run.perAttempt, [], []));
  assert.equal(facts.length, 1, `expected exactly one row, got: ${facts.map((fact) => `${fact.kind}=${fact.externalRef}`).join(' | ') || 'none'}`);
  assert.equal(facts[0].kind, 'tool_call_unattributed');
  assert.equal(facts[0].externalRef, 'c-ORPHAN');
});

// ---------------------------------------------------------------------------
// A duplicated begin frame: idempotent (one begin row) and the single
// response closes it once.
// ---------------------------------------------------------------------------
test('duplicate begin: idempotent, and the single response closes it once', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's8-duplicate-begin', frames });
  const calls = [{ callId: 'c-A', modelCallId: 'mc-A' }];
  const facts = factsOf(classify(run.perAttempt, calls));
  assert.equal(beginsOf(facts).length, 1, `duplicated begin rows: ${beginsOf(facts).length}`);
  assertClosedSet(facts, ['["c-A","mc-A"]=c-A']);
  assertClosureInvariant(facts, calls);
});

// ---------------------------------------------------------------------------
// The SAME callId on TWO DIFFERENT servers (distinct begins, so distinct
// receipts): each server's response closes only its own begin; the other
// server's begin stays open and is closed by its own response later.
// ---------------------------------------------------------------------------
test('cross-server: the same callId on two servers closes only its own begin', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-a', callId: 'c-X', modelCallId: 'mc-X' }),
    mcpBegin({ requestId: 'mcp-2', serverId: 'srv-b', callId: 'c-X', modelCallId: 'mc-Y' }),
    mcpResponse({ requestId: 'mcp-2', serverId: 'srv-b', callId: 'c-X' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-a', callId: 'c-X' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's9-cross-server', frames });
  const calls = [{ callId: 'c-X', modelCallId: 'mc-X' }, { callId: 'c-X', modelCallId: 'mc-Y' }];
  const facts = factsOf(classify(run.perAttempt, calls));
  assert.equal(beginsOf(facts).length, 2, 'the two servers carry distinct begins');
  assertClosedSet(facts, ['["c-X","mc-X"]=c-X', '["c-X","mc-Y"]=c-X']);
  assert.equal(unattributedOf(facts).length, 0, `a server lost its own begin: ${unattributedOf(facts).map((fact) => fact.externalRef).join(',')}`);
  assertClosureInvariant(facts, calls);
});

// ---------------------------------------------------------------------------
// A begin REPEATED after its closure must not reopen the call, and the second
// response must not close anything new.
// ---------------------------------------------------------------------------
test('reopen after closure: a closed call is not reopened', async () => {
  const frames = [
    mcpBegin({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpResponse({ requestId: 'mcp-1', serverId: 'srv-search', callId: 'c-A' }),
    mcpBegin({ requestId: 'mcp-3', serverId: 'srv-search', callId: 'c-A', modelCallId: 'mc-A' }),
    mcpResponse({ requestId: 'mcp-3', serverId: 'srv-search', callId: 'c-A' }),
    extractResultFrame(),
  ];
  const run = await runScenario({ name: 's10-reopen-after-closure', frames });
  const calls = [{ callId: 'c-A', modelCallId: 'mc-A' }];
  const facts = factsOf(classify(run.perAttempt, calls));
  assert.equal(beginsOf(facts).length, 1, `the repeated begin reopened the call: ${beginsOf(facts).length} begin rows`);
  assertClosedSet(facts, ['["c-A","mc-A"]=c-A']);
  const unattributed = unattributedOf(facts);
  assert.equal(unattributed.length, 1, 'the second response closes nothing and is unattributed');
  assert.equal(unattributed[0].externalRef, 'c-A');
  assertClosureInvariant(facts, calls);
});
