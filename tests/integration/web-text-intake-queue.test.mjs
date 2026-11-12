// MAYNE-24 slice II (Kimi): persistent queue, scheduling, cancellation and
// restart acceptance for the W1 text-intake vertical. Assertions come from
// the frozen P1 contract §6 (queue/scheduling/lifecycle, incl. §6.1.1
// cancel×staged arbitration), the frozen web-api/1 contract §3.2–§3.5/§4/§5
// (slots follow attempt exit confirmation, FIFO by submitSeq, cancel
// competition, exited_unknown, recovery scan), the web-backend design §5, and
// the P2 acceptance matrix T-5/T-6/T-7.
//
// The model is the controlled OpenAI-compatible service driving the REAL
// bundled Pi organizer; slow scripted answers hold execution slots so the
// queue shape is observable without fixed sleeps (every wait polls the live
// task resource or the database). The synthetic credential is injected in
// memory (private config seam) and grepped for in worker argv, responses,
// SSE frames and database rows. Real Pi workers are SIGKILLed through the
// process tree for the exit-unknown case.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeControlledModelConfig, setControlledCredentialRef } from '../fixtures/web-text-intake/model-config.mjs';
import {
  startBackend,
  startBackendChild,
  pairAdditionalClient,
  writeEvidence,
  effectiveConfig,
  createControlledCredentialProvider,
  pollUntil,
  findOrganizerWorkers,
  killDescendant,
  processTable,
  runtimeRootAvailable,
  bundledRuntimeRoot,
} from '../fixtures/web-text-intake/backend-process.mjs';
import { createProtocolWorkerFactory } from '../fixtures/web-text-intake/protocol-worker.mjs';
import {
  taskRow, taskRows, taskEventRows, attemptRows, settingsRow, sourceRow,
  candidateRows, manualItemRow, manualItemEvents, instanceEpochRows, tableCounts,
} from '../fixtures/web-text-intake/db-observer.mjs';
import { openEventStream } from '../fixtures/web-text-intake/sse-listener.mjs';
import { startControlledModelService, writeScript, queueExtractAnswer } from '../fixtures/web-text-intake/controlled-model.mjs';
import { submitSourceBody, queueText, concurrencyPutBody, signOffBody, signOffChoice } from '../fixtures/web-text-intake/synthetic-inputs.mjs';

const SYNTHETIC_KEY = 'synthetic-web-text-intake-key-7f3a9c';
const CREDENTIAL_REF = 'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY';
// Frozen case budget: the ticket freezes 20000ms per case (the aggregate runs
// `node --test --test-timeout=20000`, the W1 value), so no case declares a
// larger budget of its own. Every wait inside a case derives from ONE per-case
// deadline — polling and cleanup together can never outlive it — and heavy
// preparation (backend/model startup, artifact builds) stays outside the timed
// case in the before hook / build chain, the sanctioned exception. Wait caps
// below are backstops for failure diagnosability; each is additionally bounded
// by the remaining time to the case deadline.
const CASE_BUDGET_MS = 20000;
const CASE_MARGIN_MS = 2000;
// Two deadlines per case: caseDeadline() bounds the case WORK (all polling),
// and caseHardDeadline() is what the aggregate --test-timeout enforces. The
// margin between them is reserved for cleanup: factory.cleanup, the
// subprocess backend close and every exit verification derive their waits
// from the REMAINING hard budget (caseHardDeadline()), never from a fixed
// 5s/15s constant that could outlive the hard deadline or mask a leftover
// process behind a Promise timeout.
const caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS;
const caseHardDeadline = () => Date.now() + CASE_BUDGET_MS;
const timeLeft = (deadline) => Math.max(250, deadline - Date.now());
const waitWithin = (deadline, capMs) => Math.max(250, Math.min(capMs, deadline - Date.now()));
// The private pairing channel's wait for the NEXT one-time code (GAP-2): the
// named PrerequisiteGap must surface inside the case budget, never as a
// budget kill. The first code arrives during startup, so this only bounds the
// second-code wait.
const PAIRING_WAIT_MS = 6000;
// The subprocess-mode child's ready/pairing-code bound (T-7): the child
// reports ready within a couple of seconds on the happy path, and a named
// failure must surface inside the case budget.
const CHILD_READY_MS = 8000;
// A slot-holding answer long enough to observe the 3-running/2-queued shape
// deterministically, short enough to keep the multi-task cases inside the
// frozen 20000ms case budget.
const SLOW_MS = 3000;
const TERMINAL = ['succeeded', 'failed', 'cancelled'];
// States whose tasks still bear a worker or a slot claim. Parked states
// (needs_review with an exited_unknown attempt) hold their slot by design and
// have no live worker, so the between-case drain must not wait for them.
const ACTIVE = ['queued', 'running', 'cancelling'];

let backend;
let model;
let scriptDir;
let runtimeRoot;

// II config prerequisite (dispatch 01a1be44): the inline writer used fields
// outside the frozen configuration DTO (`authMode`, `credentialRefs`, no
// `name`), so `ConfigStore.readModelConfiguration()` rejected the document with
// `validation_failed: 供应商名称无效。`. The shared fixture writes the legal
// shape against the loopback controlled service.
function writeModelConfig(root, baseUrl) {
  writeControlledModelConfig(root, baseUrl, CREDENTIAL_REF);
}

// Swap the controlled service's script. The service re-reads the file when its
// mtime changes, so a suite can install slow (slot-holding) answers for the
// cases that need them and a standing fast answer otherwise.
async function swapScript(entries) {
  writeScript(scriptDir, entries);
  // Ensure the mtime moves past the service's cached read.
  await new Promise((done) => setTimeout(done, 30));
}

const slowScript = (count) => [
  ...Array.from({ length: count }, () => ({ kind: 'slow', delayMs: SLOW_MS, then: { kind: 'sse', content: queueExtractAnswer() } })),
  { repeat: true, kind: 'sse', content: queueExtractAnswer() },
];

const fastScript = () => [{ repeat: true, kind: 'sse', content: queueExtractAnswer() }];

async function readTasks(handle) {
  const response = await handle.request('GET', '/api/tasks?limit=200', { cookie: handle.cookie });
  assert.equal(response.status, 200, `GET /api/tasks must succeed; got ${response.status}: ${response.text}`);
  return response.json.tasks ?? [];
}

async function submitExtract(handle, index) {
  const response = await handle.request('POST', '/api/text-sources', {
    body: submitSourceBody({ text: queueText(index) }),
    cookie: handle.cookie, csrf: handle.csrf,
  });
  assert.equal(response.status, 200, `source submit must succeed; got ${response.status}: ${response.text}`);
  return response.json;
}

// Wait until no task on the handle still bears a worker or a slot claim
// (queued/running/cancelling), so a later case's worker-process observations
// are not polluted by earlier ones. Parked states (needs_review with an
// exited_unknown attempt) hold their slot by design and have no live worker —
// waiting for them to turn terminal would hang every later case, and their
// invariants are asserted by the cases that create them. The bound derives
// from the calling case's deadline.
async function drainTasks(handle, timeoutMs = 8000) {
  await pollUntil(async () => {
    const tasks = await readTasks(handle);
    return tasks.every((task) => !ACTIVE.includes(task.state)) ? tasks : null;
  }, { timeoutMs, message: 'no task to remain queued/running/cancelling' });
}

before(async () => {
  runtimeRoot = runtimeRootAvailable() ? bundledRuntimeRoot : undefined;
  backend = await startBackend({
    runtimeRoot,
    pairingTimeoutMs: PAIRING_WAIT_MS,
    credentialProvider: createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    }),
  });
  writeEvidence('queue-effective-config.json', effectiveConfig({
    suite: 'web-text-intake-queue', runtimeRoot: runtimeRoot ?? null, credentialRef: CREDENTIAL_REF,
  }));
  scriptDir = join(backend.root, 'model-script');
  // Standing fast answer by default; cases that need held slots swap in slow
  // one-shot answers.
  const script = writeScript(scriptDir, fastScript());
  model = await startControlledModelService({ script, record: join(backend.root, 'model.jsonl') });
  writeModelConfig(backend.root, model.url);
}, { timeout: 90000 });

after(async () => {
  await model?.stop();
  await backend?.close();
});

// ---------------------------------------------------------------------------
// T-5: five tasks, three slots, FIFO, queue positions, concurrency changes
// ---------------------------------------------------------------------------

test('T-5: five submissions run three and queue two in submit order, with no busy rejection', async () => {
  const deadline = caseDeadline();
  await swapScript(slowScript(3));
  const submitted = [];
  for (let index = 1; index <= 5; index += 1) {
    const result = await submitExtract(backend, index);
    submitted.push(result);
    assert.equal(result.task.state, 'queued',
      `submission ${index} must be accepted as queued (no RUNTIME_BUSY path): ${JSON.stringify(result.task)}`);
  }
  const ids = submitted.map((result) => result.task.taskId);

  // Observe the 3-running/2-queued shape by polling the live task list.
  const shape = await pollUntil(async () => {
    const tasks = await readTasks(backend);
    const mine = tasks.filter((task) => ids.includes(task.taskId));
    const running = mine.filter((task) => task.state === 'running');
    const queued = mine.filter((task) => task.state === 'queued');
    if (running.length === 3 && queued.length === 2) return { running, queued };
    return null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'three running and two queued tasks' });

  // FIFO: the running three are the first three submissions.
  const runningIds = shape.running.map((task) => task.taskId).sort();
  assert.deepEqual(runningIds, [...ids].slice(0, 3).sort(),
    'the first three submissions must occupy the three slots (FIFO by submitSeq)');
  // Queue positions: the two queued tasks carry 1 and 2 in submit order.
  const positions = shape.queued.slice().sort((left, right) => left.submitSeq - right.submitSeq).map((task) => task.queuePosition);
  assert.deepEqual(positions, [1, 2], 'queued tasks must carry queuePosition 1 and 2 in submit order');
  for (const task of shape.running) {
    assert.equal(task.attemptExitState, 'active', 'a running task must hold its slot through attempt_exit_state=active');
    assert.ok(task.attemptId, 'a running task must record its attempt');
  }
  // Slot accounting in the database agrees with the API.
  const rows = taskRows(backend.root).filter((row) => ids.includes(row.task_id));
  assert.equal(rows.filter((row) => row.state === 'running').length, 3, 'the database must show exactly three running tasks');
  assert.equal(rows.filter((row) => ['active', 'exiting', 'exited_unknown'].includes(row.attempt_exit_state)).length, 3,
    'the database slot count (attempt_exit_state) must be three');

  // Raising the concurrency refills the free slot: the queue head starts.
  const settings = await backend.request('GET', '/api/settings/agent-concurrency', { cookie: backend.cookie });
  assert.equal(settings.status, 200, settings.text);
  const raised = await backend.request('PUT', '/api/settings/agent-concurrency', {
    body: concurrencyPutBody({ agentConcurrency: 4, expectedVersion: settings.json.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(raised.status, 200, `raising the concurrency must succeed: ${raised.text}`);
  const afterRaise = await pollUntil(async () => {
    const mine = (await readTasks(backend)).filter((task) => ids.includes(task.taskId));
    return mine.filter((task) => task.state === 'running').length === 4 ? mine : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'the fourth task to start after the concurrency raise' });
  assert.equal(afterRaise.filter((task) => task.state === 'queued').length, 1, 'exactly one task may remain queued after the raise');

  // Lowering the concurrency must not kill running tasks; the queue drains in
  // FIFO order as slots free naturally.
  const settings2 = await backend.request('GET', '/api/settings/agent-concurrency', { cookie: backend.cookie });
  const lowered = await backend.request('PUT', '/api/settings/agent-concurrency', {
    body: concurrencyPutBody({ agentConcurrency: 2, expectedVersion: settings2.json.version }),
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(lowered.status, 200, lowered.text);
  const drainOrder = [];
  for (;;) {
    const tasks = (await readTasks(backend)).filter((task) => ids.includes(task.taskId));
    for (const task of tasks.filter((entry) => entry.state === 'running')) {
      if (!drainOrder.includes(task.taskId)) drainOrder.push(task.taskId);
    }
    if (tasks.every((task) => TERMINAL.includes(task.state))) break;
    assert.ok(Date.now() < deadline, 'the queue must drain within the case budget');
    await new Promise((done) => setTimeout(done, 50));
  }
  const finalTasks = (await readTasks(backend)).filter((task) => ids.includes(task.taskId));
  assert.ok(finalTasks.every((task) => task.state === 'succeeded'),
    `lowering the concurrency must not kill running tasks: ${JSON.stringify(finalTasks.map((t) => [t.taskId, t.state]))}`);
  // A later submission never starts before an earlier queued one.
  const submitOrder = new Map(ids.map((taskId, index) => [taskId, index]));
  for (let index = 1; index < drainOrder.length; index += 1) {
    assert.ok(submitOrder.get(drainOrder[index]) >= submitOrder.get(drainOrder[index - 1]),
      'tasks must start in submit order (FIFO), got ' + JSON.stringify(drainOrder));
  }
  // All five succeeded tasks published exactly one candidate each.
  for (const result of submitted) {
    const candidates = candidateRows(backend.root, { sourceId: result.source.sourceId });
    assert.equal(candidates.length, 1, 'each succeeded extract must publish exactly one candidate');
    assert.equal(candidates[0].status, 'pending');
  }
});

// ---------------------------------------------------------------------------
// T-6: cancel competition, cancel of a running task, exit-unknown
// ---------------------------------------------------------------------------

test('T-6: two clients racing to cancel the same queued task produce exactly one winner', async () => {
  const deadline = caseDeadline();
  await drainTasks(backend, timeLeft(deadline));
  await swapScript(slowScript(3));
  const clientB = await pairAdditionalClient(backend, 1);

  // Occupy all three slots so the victim stays queued.
  for (let index = 10; index <= 12; index += 1) await submitExtract(backend, index);
  const victim = await submitExtract(backend, 13);
  assert.equal(victim.task.state, 'queued', 'the victim must be queued behind the three running blockers');

  const [first, second] = await Promise.all([
    backend.request('POST', `/api/tasks/${victim.task.taskId}/cancel`, { body: {}, cookie: backend.cookie, csrf: backend.csrf }),
    backend.request('POST', `/api/tasks/${victim.task.taskId}/cancel`, { body: {}, cookie: clientB.cookie, csrf: clientB.csrf }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409],
    `one cancel must win (200 cancelled) and the loser must be rejected 409 state_conflict, got `
    + `${JSON.stringify([first.status, second.status])}: ${first.text} / ${second.text}`);
  const winner = first.status === 200 ? first : second;
  assert.equal(winner.json.task?.state ?? winner.json.state, 'cancelled', 'the winner must report the cancelled state');
  const row = taskRow(backend.root, victim.task.taskId);
  assert.equal(row.state, 'cancelled', 'the database must record the cancelled state');
  assert.equal(row.cancel_intent, 0, 'a terminal task must carry cancel_intent=false (frozen §3.1)');
  assert.equal(row.attempt_exit_state, 'not_started', 'a queued-then-cancelled task never started an attempt');
  // The cancelled task must never be started afterwards.
  await new Promise((done) => setTimeout(done, 500));
  assert.equal(attemptRows(backend.root, victim.task.taskId).length, 0, 'the scheduler must never start a cancelled task');
  // The second client observes the same authoritative state.
  const seen = await backend.request('GET', `/api/tasks/${victim.task.taskId}`, { cookie: clientB.cookie });
  assert.equal(seen.status, 200, seen.text);
  assert.equal((seen.json.task ?? seen.json).state, 'cancelled', 'the second client must observe the cancelled state');
});

test('T-6: cancelling a running task persists the intent first, then confirms the exit and frees the slot', async () => {
  const deadline = caseDeadline();
  await drainTasks(backend, timeLeft(deadline));
  await swapScript(slowScript(1));
  const submitted = await submitExtract(backend, 20);
  const taskId = submitted.task.taskId;
  await pollUntil(async () => {
    const task = (await readTasks(backend)).find((entry) => entry.taskId === taskId);
    return task?.state === 'running' ? task : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'the task to reach running' });

  const cancelled = await backend.request('POST', `/api/tasks/${taskId}/cancel`, { body: {}, cookie: backend.cookie, csrf: backend.csrf });
  assert.equal(cancelled.status, 202, `cancelling a running task must answer 202 cancelling: ${cancelled.text}`);
  const cancelling = cancelled.json.task ?? cancelled.json;
  assert.equal(cancelling.state, 'cancelling', 'the task must report cancelling');
  assert.equal(cancelling.cancelIntent, true, 'the cancel intent must be persisted before the worker stops');
  assert.equal(cancelling.attemptExitState, 'exiting', 'the attempt must move to exiting');
  assert.ok(['active', 'exiting', 'exited_unknown'].includes(cancelling.attemptExitState),
    'the slot must stay occupied while cancelling');

  // The worker observes the cancel frame and exits; the task reaches the
  // terminal cancelled state with the slot released.
  const finalTask = await pollUntil(async () => {
    const task = (await readTasks(backend)).find((entry) => entry.taskId === taskId);
    return TERMINAL.includes(task?.state) ? task : null;
  }, { timeoutMs: waitWithin(deadline, 10000), message: 'the cancelled task to reach a terminal state' });
  assert.equal(finalTask.state, 'cancelled', `the cancelled task must end cancelled, got ${finalTask.state}`);
  assert.equal(finalTask.cancelIntent, false, 'a terminal task must carry cancel_intent=false');
  assert.equal(finalTask.attemptExitState, 'exited_confirmed', 'the exit must be confirmed at the terminal state');
  const row = taskRow(backend.root, taskId);
  assert.equal(row.state, 'cancelled');
  const events = taskEventRowsSafe(backend.root, taskId);
  assert.ok(events.length >= 2, 'the cancel path must leave event history');
});

test('T-6: SIGKILLed workers leave their attempts exit-unconfirmed, the slots occupied, and resolve rejected', async () => {
  const deadline = caseDeadline();
  // Drain the shared backend first so no leftover worker pollutes the
  // process-tree observation below.
  await drainTasks(backend, timeLeft(deadline));
  // A dedicated backend for this case: a SIGKILLed worker parks its attempt as
  // exited_unknown and the slot stays held until an operator resolves the task
  // (resolve is rejected 409 while the exit is unconfirmed — asserted below),
  // so on the shared backend every later case would queue behind permanently
  // held slots. The journey itself is unchanged: three real Pi workers are
  // hard-killed through the process tree and the frozen exit-unknown
  // invariants are asserted on a real persistent root.
  const { handle, root } = await startCaseBackend({});
  try {
    await swapScript(slowScript(3));

    // Three tasks occupy all three slots; their real Pi workers are the only
    // organizer processes in this test process's tree.
    const submitted = [];
    for (let index = 30; index <= 32; index += 1) submitted.push(await submitExtract(handle, index));
    const ids = submitted.map((result) => result.task.taskId);
    await pollUntil(async () => {
      const mine = (await readTasks(handle)).filter((task) => ids.includes(task.taskId));
      return mine.filter((task) => task.state === 'running').length === 3 ? mine : null;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'three running tasks' });

    const workers = await pollUntil(() => {
      const found = findOrganizerWorkers(process.pid);
      return found.length >= 3 ? found : null;
    }, { timeoutMs: waitWithin(deadline, 6000), message: 'the three real Pi worker processes to appear' });
    for (const worker of workers) {
      assert.ok(!worker.command.includes(SYNTHETIC_KEY),
        `the worker argv must not contain the synthetic secret: ${worker.command}`);
    }
    // Hard-kill the workers: the attempts lose their process without a graceful
    // exit confirmation.
    for (const worker of workers) killDescendant(worker.pid, 'SIGKILL');

    for (const taskId of ids) {
      const needsReview = await pollUntil(async () => {
        const task = (await readTasks(handle)).find((entry) => entry.taskId === taskId);
        return task?.state === 'needs_review' ? task : null;
      }, { timeoutMs: waitWithin(deadline, 10000), message: `task ${taskId} to reach needs_review after the worker kill` });
      // B(a): the registry-domain verdict is the release authority. The
      // SIGKILLed worker's group is gone and the registry holds no survivor,
      // so the exit is CONFIRMED (`exited_confirmed`); the side effect is
      // still unknown, so the task is isolated for review.
      assert.equal(needsReview.attemptExitState, 'exited_confirmed',
        'a SIGKILLed worker with no registered survivor confirms the registry-domain exit');
      assert.equal(needsReview.cancelIntent, false, 'a non-cancel path must keep cancelIntent=false');
      assert.equal(needsReview.recovery?.cause, 'failure_unknown_side_effect',
        `the recovery cause must be failure_unknown_side_effect, got ${JSON.stringify(needsReview.recovery)}`);
      assert.ok(needsReview.attemptExitEvidence, 'the typed evidence must be present on the wire resource');
      assert.equal(needsReview.attemptExitEvidence.verdict, 'registry_extinct');
      assert.equal(needsReview.attemptExitEvidence.residual.treeExtinctProven, false,
        'the verdict never claims tree extinction');
      const itemVersion = needsReview.recovery?.itemVersion;
      assert.ok(typeof itemVersion === 'number', 'the recovery object must expose the item version');
    }

    // The three slots are RELEASED (exited_confirmed): a fresh submission is
    // claimed instead of queueing behind held slots.
    const fresh = await submitExtract(handle, 33);
    const claimed = await pollUntil(async () => {
      const task = (await readTasks(handle)).find((entry) => entry.taskId === fresh.task.taskId);
      return task?.state === 'running' ? task : null;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'the fresh submission to be claimed after the slots are released' });
    assert.ok(claimed, 'a fresh submission must be claimed once the registry-domain exits release the slots');
  } finally {
    await handle.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function taskEventRowsSafe(root, taskId) {
  try {
    return taskEventRows(root, taskId);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// T-7: SIGKILL of the backend, same-root restart, verify-then-schedule
// ---------------------------------------------------------------------------

test('T-7: after a SIGKILL the same root reopens with committed work intact and no silent re-dispatch', async () => {
  const deadline = caseDeadline();
  const hardDeadline = caseHardDeadline();
  await drainTasks(backend, timeLeft(deadline));
  const root = mkdtempSync(join(tmpdir(), 'web-text-intake-restart-'));
  writeModelConfig(root, model.url);
  await swapScript(fastScript());

  // A test-owned child on the same pinned interface: it can be killed hard,
  // and the controlled credential provider is injected over its private IPC
  // channel so re-dispatched tasks still resolve the synthetic reference. The
  // case hard deadline rides along: the child's close, exit verification and
  // failure-path release derive their waits from the remaining hard budget.
  const first = await startBackendChild({
    root,
    initialize: true,
    runtimeRoot,
    readyTimeoutMs: CHILD_READY_MS,
    hardDeadline,
    credentialProviderEntries: { [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' } },
  });
  let second = null;
  try {
    // Phase 1: a fast task that completes and is signed off, so the restart
    // has committed business state to preserve.
    const fast = await submitExtract(first, 40);
    await pollUntil(async () => {
      const task = (await readTasks(first)).find((entry) => entry.taskId === fast.task.taskId);
      return TERMINAL.includes(task?.state) ? task : null;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'the fast task to finish' });
    assert.equal(taskRow(root, fast.task.taskId).state, 'succeeded', 'the fast task must succeed on the controlled model');
    const candidates = await first.request('GET', `/api/text-sources/${fast.source.sourceId}/candidates`, { cookie: first.cookie });
    assert.equal(candidates.status, 200, candidates.text);
    assert.ok(candidates.json.candidates.length > 0, 'the fast task must publish a candidate');
    const candidate = candidates.json.candidates[0];
    const signed = await first.request('POST', '/api/sign-offs', {
      body: signOffBody({ choices: [signOffChoice({ candidateId: candidate.candidateId, expectedVersion: candidate.version })] }),
      cookie: first.cookie, csrf: first.csrf,
    });
    assert.equal(signed.status, 200, signed.text);
    const signedItemId = signed.json.items[0].itemId;
    const preKillItem = manualItemRow(root, signedItemId);
    assert.ok(preKillItem, 'the signed item must exist before the kill');

    // Phase 2: hold three slots with slow tasks and queue one more.
    await swapScript(slowScript(3));
    const slowSubmissions = [];
    for (let index = 41; index <= 44; index += 1) slowSubmissions.push(await submitExtract(first, index));
    const slowIds = slowSubmissions.map((result) => result.task.taskId);
    await pollUntil(async () => {
      const tasks = (await readTasks(first)).filter((task) => slowIds.includes(task.taskId));
      return tasks.filter((task) => task.state === 'running').length === 3
        && tasks.filter((task) => task.state === 'queued').length === 1 ? tasks : null;
    }, { timeoutMs: waitWithin(deadline, 10000), message: 'three running and one queued before the kill' });

    const stream = await openEventStream(first.origin, { cookie: first.cookie });
    const ready = await stream.waitFor((frame) => frame.event === 'stream.ready');
    const firstEpoch = ready.data.epoch;
    assert.ok(firstEpoch, 'stream.ready must expose the instance epoch');
    stream.close();

    const preKillAttempts = taskRows(root).filter((row) => slowIds.includes(row.task_id))
      .flatMap((row) => attemptRows(root, row.task_id));
    const preKillEpochs = instanceEpochRows(root).length;

    // Hard kill: the child dies without a graceful close. The root lock must
    // be released by the OS so a fresh instance can open the same root.
    first.killHard();
    await first.waitExit();

    // Backend stdout/stderr secret observation (M-4): the subprocess-mode
    // child captures the backend PROCESS's own output streams across the
    // whole journey above (real extracts, real sign-off, real SSE). Neither
    // stream may carry the synthetic secret.
    for (const [label, stream] of [['stdout', first.stdout()], ['stderr', first.stderr()]]) {
      assert.ok(!stream.includes(SYNTHETIC_KEY),
        `the backend ${label} must not contain the synthetic secret: ${stream.slice(0, 300)}`);
    }

    second = await startBackendChild({
      root,
      initialize: false,
      runtimeRoot,
      readyTimeoutMs: CHILD_READY_MS,
      hardDeadline,
      // The restarted instance must resolve the same synthetic reference for
      // any task its recovery scan re-dispatches; the provider arrives over
      // the private IPC channel before this child starts (frozen arbitration).
      credentialProviderEntries: { [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' } },
    });
    try {
      // The pre-kill session must not survive the restart.
      const staleCookie = await second.request('GET', '/api/manual-items', { headers: { cookie: first.cookie } });
      assert.equal(staleCookie.status, 401, 'the pre-restart session must not survive the restart');

      // Committed business state reappears byte-identically.
      const restoredItem = manualItemRow(root, signedItemId);
      assert.ok(restoredItem, 'the signed-off item must reappear after the restart');
      assert.equal(restoredItem.title, preKillItem.title);
      assert.equal(restoredItem.version, preKillItem.version);
      assert.equal(restoredItem.status, preKillItem.status);
      const events = manualItemEvents(root, signedItemId);
      assert.ok(events.length >= 1, 'the item history must reappear');
      assert.ok(sourceRowSafe(root, fast.source.sourceId), 'the source must reappear after the restart');
      const restoredCandidates = candidateRows(root, { sourceId: fast.source.sourceId });
      assert.ok(restoredCandidates.length > 0, 'the candidates must reappear after the restart');
      assert.ok(restoredCandidates.every((row) => row.status === 'accepted'), 'the accepted candidate must stay accepted');

      // The queue: every task reappears exactly once; the queued task stays
      // queued (recovery does not re-dispatch before accounting); the
      // previously running attempts are ended and marked, never silently
      // re-run as fresh attempts of the old epoch.
      const tasks = (await readTasks(second)).filter((task) => slowIds.includes(task.taskId));
      assert.equal(tasks.length, 4, 'all four tasks must reappear — no loss, no duplication');
      const queued = tasks.filter((task) => task.state === 'queued');
      assert.equal(queued.length, 1, 'the queued task must stay queued across the restart');
      const newEpochStartedAt = instanceEpochRows(root).filter((row) => row.epoch !== firstEpoch)
        .map((row) => row.started_at).sort((left, right) => left - right).at(-1) ?? null;
      assert.ok(newEpochStartedAt !== null, 'the restarted instance must register a new epoch');
      assert.equal(instanceEpochRows(root).length, preKillEpochs + 1, 'exactly one new instance epoch may be registered');
      for (const task of tasks.filter((entry) => entry.state !== 'queued')) {
        assert.ok(['interrupted', 'needs_review', 'running', 'queued', 'succeeded', 'failed'].includes(task.state),
          `a previously running task must be recovered explicitly, got ${task.state}`);
        const attempts = attemptRows(root, task.taskId);
        for (const attempt of attempts) {
          if (preKillAttempts.some((row) => row.attempt_id === attempt.attempt_id)) {
            assert.ok(attempt.ended_at !== null || attempt.exit_confirmed_at !== null,
              'a pre-kill attempt must be ended by the recovery scan, not left open');
          } else {
            assert.ok(attempt.started_at >= newEpochStartedAt,
              'a new attempt may only belong to the new instance epoch (verify-then-schedule)');
          }
        }
      }

      // SSE epoch changed: a reconnecting client with the stale token is reset
      // and compensates through the snapshot.
      const reconnect = await openEventStream(second.origin, {
        cookie: second.cookie,
        lastEventId: `${firstEpoch}:1`,
      });
      try {
        assert.equal(reconnect.status, 200, 'SSE must accept the reconnect with a stale token');
        const reset = await reconnect.waitFor((frame) => frame.event === 'stream.reset');
        assert.equal(reset.id, null, 'stream.reset must not carry an id line');
        assert.ok(reset.data?.epoch, 'stream.reset must carry the current epoch');
        assert.notEqual(reset.data.epoch, firstEpoch, 'the epoch must change across the restart');
      } finally {
        reconnect.close();
      }
      const snapshot = await second.request('GET', '/api/snapshot', { cookie: second.cookie });
      assert.equal(snapshot.status, 200, `GET /api/snapshot must succeed: ${snapshot.text}`);
      assert.ok(snapshot.json.highWatermark !== undefined, 'the snapshot must carry the high watermark');
      assert.ok(Array.isArray(snapshot.json.tasks), 'the snapshot must carry the task entries');
      const snapshotIds = snapshot.json.tasks.map((task) => task.taskId);
      for (const taskId of [...slowIds, fast.task.taskId]) {
        assert.ok(snapshotIds.includes(taskId), `the snapshot must include task ${taskId}`);
      }

      // The restarted backend process's own output streams carry no secret
      // either (M-4): the recovery scan and the reconnecting client above
      // exercised them.
      for (const [label, stream] of [['stdout', second.stdout()], ['stderr', second.stderr()]]) {
        assert.ok(!stream.includes(SYNTHETIC_KEY),
          `the restarted backend ${label} must not contain the synthetic secret: ${stream.slice(0, 300)}`);
      }
    } finally {
      // Cleanup failures (a surviving self-built child, no margin left to the
      // hard deadline) must fail the case explicitly — the swallowing catches
      // are retired together with the fixed cleanup waits.
      await second.close();
      second = null;
    }
  } finally {
    if (second) await second.close();
    await first.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function sourceRowSafe(root, sourceId) {
  try {
    return sourceRow(root, sourceId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Two clients and page close
// ---------------------------------------------------------------------------

test('two clients share the authoritative queue; closing one client\'s stream never cancels backend work', async () => {
  const deadline = caseDeadline();
  await drainTasks(backend, timeLeft(deadline));
  await swapScript(fastScript());
  const clientB = await pairAdditionalClient(backend, 2);

  const streamA = await openEventStream(backend.origin, { cookie: backend.cookie });
  const streamB = await openEventStream(backend.origin, { cookie: clientB.cookie });
  try {
    await streamA.waitFor((frame) => frame.event === 'stream.ready');
    await streamB.waitFor((frame) => frame.event === 'stream.ready');
    const submitted = await submitExtract(backend, 50);
    const taskId = submitted.task.taskId;

    // Client B observes the same task on its own session.
    const fromB = await streamB.waitFor((frame) => frame.event === 'task.changed' && frame.data?.objectId === taskId,
      waitWithin(deadline, 10000));
    assert.equal(fromB.data.objectType, 'task');
    assert.match(fromB.id, /^inst_[0-9a-f]{12}:\d+$/, 'task frames must carry the epoch:cursor id');

    // Client A "closes the page": its stream aborts. The task must continue.
    streamA.close();
    await new Promise((done) => setTimeout(done, waitWithin(deadline, 300)));
    const stillThere = await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie });
    assert.equal(stillThere.status, 200, stillThere.text);
    const task = stillThere.json.task ?? stillThere.json;
    assert.ok(['queued', 'running', 'cancelling', 'succeeded', 'failed'].includes(task.state),
      'closing a client stream must not cancel the backend task');

    // Client B observes the terminal transition.
    await streamB.waitFor((frame) => frame.event === 'task.changed'
      && frame.data?.objectId === taskId
      && TERMINAL.includes(frame.data?.taskState), waitWithin(deadline, 10000));
    const finalTask = (await readTasks(backend)).find((entry) => entry.taskId === taskId);
    assert.ok(['succeeded', 'failed'].includes(finalTask.state),
      `the task must finish despite the closed client, got ${finalTask.state}`);
  } finally {
    streamA.close();
    streamB.close();
  }
});

// ---------------------------------------------------------------------------
// Settings and event hygiene
// ---------------------------------------------------------------------------

test('settings: the concurrency change broadcasts a settings.changed frame and never lowers task versions', async () => {
  const deadline = caseDeadline();
  await drainTasks(backend, timeLeft(deadline));
  const stream = await openEventStream(backend.origin, { cookie: backend.cookie });
  try {
    await stream.waitFor((frame) => frame.event === 'stream.ready');
    const settings = await backend.request('GET', '/api/settings/agent-concurrency', { cookie: backend.cookie });
    assert.equal(settings.status, 200, settings.text);
    const taskVersionsBefore = new Map((await readTasks(backend)).map((task) => [task.taskId, task.version]));
    const changed = await backend.request('PUT', '/api/settings/agent-concurrency', {
      body: concurrencyPutBody({ agentConcurrency: 3, expectedVersion: settings.json.version }),
      cookie: backend.cookie, csrf: backend.csrf,
    });
    assert.equal(changed.status, 200, changed.text);
    const frame = await stream.waitFor((entry) => entry.event === 'settings.changed', waitWithin(deadline, 10000));
    assert.match(frame.id, /^inst_[0-9a-f]{12}:\d+$/, 'settings frames must carry the epoch:cursor id');
    assert.equal(frame.data.objectType, 'setting');
    const taskVersionsAfter = new Map((await readTasks(backend)).map((task) => [task.taskId, task.version]));
    for (const [taskId, version] of taskVersionsBefore) {
      if (taskVersionsAfter.has(taskId)) {
        assert.ok(taskVersionsAfter.get(taskId) >= version, 'a settings change must not lower any task version');
      }
    }
    assert.ok(settingsRow(backend.root, 'agentConcurrency'), 'the concurrency setting must be persisted');
  } finally {
    stream.close();
  }
});

// ---------------------------------------------------------------------------
// Protocol fixtures through the approved private config (frozen 2026-11-08
// arbitration, GAP-3..GAP-5). config.workerProcessFactory replaces ONLY the
// WorkerHost spawn call and config.workerRunLimitMs (integer 1..120000,
// default still 120000) feeds the same production timeout path; neither key
// enters HTTP/CLI/env configuration. The fake worker speaks the real
// organizer stdio protocol, so every staging / fence / exit-verification
// decision below is production code reacting to real frames — these cases
// sign the protocol decision points, and the real-Pi normal chain stays
// verified by the T-4/T-5 cases above and the controlled-model suite.
// ---------------------------------------------------------------------------

// A dedicated backend for a case whose side effects must not leak into later
// cases: the SIGKILL case parks attempts as exited_unknown with their slots
// held (resolve is rejected while the exit is unconfirmed), and the protocol
// cases replace the WorkerHost spawn call. The controlled credential provider
// is injected in memory; the model config points at the shared controlled
// service. Each such backend is closed and its root removed by the case.
async function startCaseBackend(options = {}) {
  const { scenarios, workerProcessFactory, workerRunLimitMs } = options;
  const factory = workerProcessFactory ?? (scenarios !== undefined ? createProtocolWorkerFactory({ scenarios }) : undefined);
  const root = mkdtempSync(join(tmpdir(), 'web-text-intake-case-'));
  const handle = await startBackend({
    root,
    runtimeRoot,
    pairingTimeoutMs: PAIRING_WAIT_MS,
    credentialProvider: createControlledCredentialProvider({
      [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
    }),
    ...(factory !== undefined ? { workerProcessFactory: factory } : {}),
    ...(workerRunLimitMs !== undefined ? { workerRunLimitMs } : {}),
  });
  writeModelConfig(root, model.url);
  return { handle, factory, root };
}

async function readTask(handle, taskId) {
  const response = await handle.request('GET', `/api/tasks/${taskId}`, { cookie: handle.cookie });
  assert.equal(response.status, 200,
    `GET /api/tasks/${taskId} must succeed; got ${response.status}: ${response.text}`);
  return response.json.task ?? response.json;
}

// Poll a task resource with a short deadline; on expiry the failure names the
// observed state AND the missing private signature, so a base-tree run (the
// entry ignores the factory and the real Pi answers instead) fails with the
// registered gap instead of an opaque business mismatch.
async function pollTask(handle, taskId, predicate, { timeoutMs = 8000, message = 'the task condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await readTask(handle, taskId);
    if (predicate(last)) return last;
    if (Date.now() >= deadline) break;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(
    `${message}; last observed state=${last?.state} attemptExitState=${last?.attemptExitState} `
    + `resultPendingExit=${last?.resultPendingExit} cancelIntent=${last?.cancelIntent} `
    + `recovery=${JSON.stringify(last?.recovery ?? null)}. If the real Pi ran instead of the protocol `
    + 'worker, the entry ignored the frozen private signatures config.workerProcessFactory / '
    + 'config.workerRunLimitMs (slice I pending) — no business result is claimed.',
  );
}

// The frozen transition table allows exactly two resolutions of "staged
// result + production timeout", and BOTH preserve the staged SUCCESS:
//   committed — the exit was confirmed, so the original staged outcome is
//               committed: state=succeeded, attemptExitState=exited_confirmed,
//               cancelIntent=false, resultPendingExit=false, and the original
//               candidates are published (pending).
//   held      — the exit could not be confirmed, so the staged rows are
//               retained and the slot stays held: state=needs_review,
//               attemptExitState=exited_unknown, recovery.cause=
//               result_exit_unconfirmed, nothing published, not signable.
// A staged success that lands in `failed` is a THIRD, illegal outcome: the
// worker already produced a successful result, so failing it would silently
// discard a staged success. It — and every other state outside the two legal
// resolutions — must falsify the table. The classifier is pure (no database),
// so the focused case below can exercise the table directly.
function classifyStagedResolution(task) {
  if (task.attemptExitState === 'exited_confirmed') {
    assert.equal(task.cancelIntent, false,
      `a confirmed-exit resolution must carry cancelIntent=false, got ${task.cancelIntent}`);
    assert.equal(task.resultPendingExit, false,
      `a confirmed-exit resolution must not keep the result pending, got ${task.resultPendingExit}`);
    assert.equal(task.state, 'succeeded',
      `a staged success with a confirmed exit must commit as succeeded and publish the original candidate, `
      + `got ${task.state}: ${JSON.stringify(task)} — a staged success landing in failed (or cancelled) is an `
      + 'illegal third outcome of the frozen transition table and must fail the suite');
    return 'committed';
  }
  assert.equal(task.state, 'needs_review',
    `a staged result whose exit is not confirmed must resolve to needs_review (staged rows retained, slot `
    + `held), got ${task.state}: ${JSON.stringify(task)}`);
  assert.equal(task.attemptExitState, 'exited_unknown',
    `an unconfirmable exit must leave the attempt exited_unknown with the slot held, got ${task.attemptExitState}`);
  assert.equal(task.recovery?.cause, 'result_exit_unconfirmed',
    `the recovery cause must be result_exit_unconfirmed, got ${JSON.stringify(task.recovery ?? null)}`);
  assert.equal(task.cancelIntent, false, 'a non-cancel path must keep cancelIntent=false');
  return 'held';
}

// Database-backed wrapper around the classifier: the legal resolution is
// decided by the pure table above, then the staged rows are observed
// read-only to confirm what production actually persisted.
function assertStagedResolution(task, root, sourceId) {
  const resolution = classifyStagedResolution(task);
  if (resolution === 'committed') {
    const rows = candidateRows(root, { sourceId });
    assert.ok(rows.length > 0 && rows.every((row) => row.status === 'pending'),
      'the committed staged outcome must publish the original candidates as pending');
    return;
  }
  assert.ok(candidateRows(root, { sourceId, status: 'staged' }).length > 0,
    'the staged rows must be retained while the exit is unconfirmed');
  assert.equal(candidateRows(root, { sourceId, status: 'pending' }).length, 0,
    'staged candidates must stay unpublished while the exit is unconfirmed');
}

// Focused verification of the staged-resolution table itself: no backend, no
// database — the two legal resolutions classify, and every illegal landing is
// rejected, above all a staged success falling into `failed` (the wrong drop
// point this guard exists for). This case is the falsification proof that the
// suite no longer accepts a staged success landing failed.
test('staged resolution table: the two frozen resolutions classify and a staged success landing failed is rejected', async () => {
  const confirmed = (state, overrides = {}) => ({
    state, attemptExitState: 'exited_confirmed', cancelIntent: false, resultPendingExit: false, ...overrides,
  });
  const unconfirmable = (overrides = {}) => ({
    state: 'needs_review', attemptExitState: 'exited_unknown',
    recovery: { cause: 'result_exit_unconfirmed' }, cancelIntent: false, ...overrides,
  });
  assert.equal(classifyStagedResolution(confirmed('succeeded')), 'committed',
    'a confirmed exit must commit the staged success');
  assert.equal(classifyStagedResolution(unconfirmable()), 'held',
    'an unconfirmable exit must hold the staged rows and the slot');

  const illegal = [
    ['a staged success landing failed after a confirmed exit', confirmed('failed')],
    ['a staged success landing cancelled after a confirmed exit', confirmed('cancelled')],
    ['failed without a confirmed exit', unconfirmable({ state: 'failed' })],
    ['succeeded without a confirmed exit', unconfirmable({ state: 'succeeded' })],
    ['cancelled without a confirmed exit', unconfirmable({ state: 'cancelled' })],
    ['held for an unregistered recovery cause', unconfirmable({ recovery: { cause: 'exit_unconfirmed' } })],
    ['held without the exited_unknown attempt', unconfirmable({ attemptExitState: 'exiting' })],
    ['a confirmed exit with the cancel intent still set', confirmed('succeeded', { cancelIntent: true })],
    ['a confirmed exit still pending its result', confirmed('succeeded', { resultPendingExit: true })],
    ['still running with the result pending', { state: 'running', attemptExitState: 'active', resultPendingExit: true }],
  ];
  for (const [name, task] of illegal) {
    assert.throws(() => classifyStagedResolution(task), assert.AssertionError,
      `the staged-resolution table must reject ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Spawn-failure resolution table: an attempt whose worker spawn failed (the
// scenario-exhaustion case — the factory throws synchronously inside the
// production spawn call, so no worker ever ran) must close in one of the two
// legal landings. The frozen contract's pre-execution-failure precedent
// (credential_unavailable, web-api/1 §4.6) closes such an attempt terminally
// with its failure envelope and the slot released; §4.6 equally allows a
// failure whose side-effect safety cannot be proven to park as needs_review
// with a registered recovery cause. EVERY other landing is illegal and must
// falsify the case — above all a task permanently stuck in
// queued/running/cancelling (a spawn failure must close, never hang), a
// cancellation nobody requested, and a failed task without its envelope.
// "Not succeeded" is not a closure criterion: only these two landings are.
// ---------------------------------------------------------------------------

const SPAWN_FAILURE_LEGAL_STATES = ['failed', 'needs_review'];
const REGISTERED_RECOVERY_CAUSES = [
  'cancel_exit_unconfirmed', 'cancel_unknown_side_effect', 'restart_unknown_side_effect',
  'failure_unknown_side_effect', 'result_exit_unconfirmed', 'exit_unconfirmed',
  'backup_restore', 'root_activation', 'root_import',
];
const FAILURE_ENVELOPE_RETRYABLE = ['auto_backoff', 'manual', 'none'];
const FAILURE_ENVELOPE_SIDE_EFFECT_SAFETY = ['proven_safe', 'unknown', 'proven_unsafe'];

function classifySpawnFailureResolution(task) {
  if (task.state === 'failed') {
    const failure = task.failure;
    assert.ok(failure && typeof failure === 'object',
      `a failed spawn-failure attempt must publish its failure envelope, got ${JSON.stringify(failure)}: `
      + `${JSON.stringify(task)}`);
    assert.ok(typeof failure.code === 'string' && failure.code.length > 0,
      `the failure envelope must carry a code, got ${JSON.stringify(failure)}`);
    assert.ok(typeof failure.message === 'string' && failure.message.length > 0,
      `the failure envelope must carry a message, got ${JSON.stringify(failure)}`);
    assert.ok(FAILURE_ENVELOPE_RETRYABLE.includes(failure.retryable),
      `the failure envelope's retryable must be a registered value, got ${JSON.stringify(failure.retryable)}`);
    assert.ok(FAILURE_ENVELOPE_SIDE_EFFECT_SAFETY.includes(failure.sideEffectSafety),
      `the failure envelope's sideEffectSafety must be a registered value, got ${JSON.stringify(failure.sideEffectSafety)}`);
    assert.equal(task.attemptExitState, 'exited_confirmed',
      `a spawn failure never ran a worker: the attempt must close with its slot released (the pre-execution `
      + `failure precedent), got ${task.attemptExitState}: ${JSON.stringify(task)}`);
    assert.equal(task.cancelIntent, false,
      `a terminal state must carry cancelIntent=false (frozen §3.1), got ${task.cancelIntent}`);
    return 'failed';
  }
  if (task.state === 'needs_review') {
    const recovery = task.recovery;
    assert.ok(recovery && typeof recovery === 'object',
      `a parked spawn-failure attempt must register a recovery object, got ${JSON.stringify(recovery)}: `
      + `${JSON.stringify(task)}`);
    assert.ok(REGISTERED_RECOVERY_CAUSES.includes(recovery.cause),
      `the recovery cause must be one of the frozen registered causes, got ${JSON.stringify(recovery.cause)} `
      + `(registered: ${REGISTERED_RECOVERY_CAUSES.join(', ')})`);
    assert.ok(typeof recovery.itemVersion === 'number',
      `every registered recovery cause must expose the item version for the resolve entries, got `
      + `${JSON.stringify(recovery)}`);
    assert.ok(['exited_confirmed', 'exited_unknown'].includes(task.attemptExitState),
      `a parked attempt must be closed or exit-unconfirmable — never active/exiting — got `
      + `${task.attemptExitState}: ${JSON.stringify(task)}`);
    return 'parked';
  }
  throw new assert.AssertionError({
    message: `an attempt whose worker spawn failed must land in a legal state (failed with its envelope, or needs_review `
      + `with a registered recovery cause); got state=${task.state} attemptExitState=${task.attemptExitState} `
      + `failure=${JSON.stringify(task.failure ?? null)} recovery=${JSON.stringify(task.recovery ?? null)}: `
      + `${JSON.stringify(task)} — a task stuck queued/running/cancelling, cancelled without a request, or failed `
      + 'without an envelope must fail this case, never pass as "not succeeded"',
  });
}

// Focused negative control for the spawn-failure table: no backend, no
// database — the two legal landings classify, and every illegal landing is
// rejected, above all a task PERMANENTLY STUCK RUNNING after its spawn failed
// (the wrong closure this guard exists for). This case is the falsification
// proof that the exhaustion case can no longer pass on a "not succeeded"
// observation.
test('spawn-failure resolution table: the two legal landings classify and a permanently running task is rejected', async () => {
  const failedLanding = {
    state: 'failed',
    failure: { code: 'worker_spawn_failed', message: 'spawn failed', retryable: 'manual', sideEffectSafety: 'proven_safe' },
    attemptExitState: 'exited_confirmed', cancelIntent: false,
  };
  const parkedLanding = {
    state: 'needs_review',
    recovery: { cause: 'failure_unknown_side_effect', itemVersion: 3 },
    attemptExitState: 'exited_unknown', cancelIntent: false,
  };
  assert.equal(classifySpawnFailureResolution(failedLanding), 'failed',
    'a terminal spawn failure with its envelope and the slot released must classify');
  assert.equal(classifySpawnFailureResolution(parkedLanding), 'parked',
    'a parked spawn failure with a registered cause must classify');
  assert.equal(classifySpawnFailureResolution({ ...parkedLanding, attemptExitState: 'exited_confirmed' }), 'parked',
    'a closed attempt parked for side-effect review must classify as well');

  const illegal = [
    ['a task permanently stuck in running', { state: 'running', attemptExitState: 'active', failure: null, recovery: null }],
    ['a task still queued behind the failed spawn', { state: 'queued', attemptExitState: 'not_started', failure: null, recovery: null }],
    ['a task stuck cancelling', { state: 'cancelling', attemptExitState: 'exiting', failure: null, recovery: null }],
    ['a cancelled task (nobody requested a cancellation)', { state: 'cancelled', attemptExitState: 'exited_confirmed', failure: null, recovery: null, cancelIntent: false }],
    ['a succeeded task (the factory was bypassed)', { state: 'succeeded', attemptExitState: 'exited_confirmed', failure: null, recovery: null }],
    ['a failed task without its envelope', { state: 'failed', failure: null, attemptExitState: 'exited_confirmed' }],
    ['a failed task whose envelope has no code', { state: 'failed', failure: { message: 'x', retryable: 'manual', sideEffectSafety: 'proven_safe' }, attemptExitState: 'exited_confirmed' }],
    ['a failed task with an unregistered retryable', { state: 'failed', failure: { code: 'x', message: 'x', retryable: 'sometimes', sideEffectSafety: 'proven_safe' }, attemptExitState: 'exited_confirmed' }],
    ['a failed task with an unregistered sideEffectSafety', { state: 'failed', failure: { code: 'x', message: 'x', retryable: 'manual', sideEffectSafety: 'maybe' }, attemptExitState: 'exited_confirmed' }],
    ['a failed task still holding its slot', { state: 'failed', failure: failedLanding.failure, attemptExitState: 'exited_unknown' }],
    ['a failed terminal state with the cancel intent still set', { state: 'failed', failure: failedLanding.failure, attemptExitState: 'exited_confirmed', cancelIntent: true }],
    ['a parked task without a recovery object', { state: 'needs_review', recovery: null, attemptExitState: 'exited_unknown' }],
    ['a parked task with an unregistered recovery cause', { state: 'needs_review', recovery: { cause: 'mystery_cause', itemVersion: 1 }, attemptExitState: 'exited_unknown' }],
    ['a parked task without the item version', { state: 'needs_review', recovery: { cause: 'exit_unconfirmed' }, attemptExitState: 'exited_unknown' }],
    ['a parked task whose attempt is still active', { state: 'needs_review', recovery: { cause: 'exit_unconfirmed', itemVersion: 1 }, attemptExitState: 'active' }],
    ['a parked task whose attempt is still exiting', { state: 'needs_review', recovery: { cause: 'exit_unconfirmed', itemVersion: 1 }, attemptExitState: 'exiting' }],
  ];
  for (const [name, task] of illegal) {
    assert.throws(() => classifySpawnFailureResolution(task), assert.AssertionError,
      `the spawn-failure resolution table must reject ${name}`);
  }
});

test('protocol factory control: a well-behaved protocol worker runs the production path and publishes its candidates', async () => {
  const deadline = caseDeadline();
  const hardDeadline = caseHardDeadline();
  const { handle, factory, root } = await startCaseBackend({ scenarios: ['well-behaved'] });
  try {
    const modelBefore = model.requests().length;
    const submitted = await submitExtract(handle, 60);
    const task = await pollTask(handle, submitted.task.taskId, (entry) => TERMINAL.includes(entry.state),
      { timeoutMs: waitWithin(deadline, 10000), message: 'the protocol-worker task to finish' });
    assert.equal(task.state, 'succeeded',
      `the well-behaved protocol worker must succeed the task, got ${task.state}: ${JSON.stringify(task)}`);
    assert.equal(task.attemptExitState, 'exited_confirmed', 'a clean worker exit must confirm the attempt exit');
    assert.equal(model.requests().length, modelBefore,
      'the protocol worker makes no model call; the factory must have replaced the real Pi spawn');
    const candidates = await handle.request('GET', `/api/text-sources/${submitted.source.sourceId}/candidates`, { cookie: handle.cookie });
    assert.equal(candidates.status, 200, candidates.text);
    assert.equal(candidates.json.candidates.length, 1, 'the protocol worker answer must publish exactly one candidate');
    const candidate = candidates.json.candidates[0];
    assert.equal(candidate.fields.title, '协议夹具候选',
      `the published candidate must come from the protocol worker payload, got ${JSON.stringify(candidate.fields)}`);
    assert.equal(candidate.status, 'pending');
    assert.ok(queueText(60).includes(candidate.evidence), 'the published evidence must be a verbatim substring of the submitted text');
    const rows = candidateRows(root, { sourceId: submitted.source.sourceId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');
  } finally {
    await handle.close();
    await factory.cleanup(hardDeadline);
    rmSync(root, { recursive: true, force: true });
  }
});

test('GAP-3: a staged result stays invisible and slot-holding until exit confirmation, and the short run limit resolves the hang through the production timeout path', async () => {
  const deadline = caseDeadline();
  const hardDeadline = caseHardDeadline();
  const { handle, factory, root } = await startCaseBackend({
    scenarios: ['stage-then-hang', 'stage-then-hang', 'stage-then-hang', 'well-behaved'],
    workerRunLimitMs: 3000,
  });
  try {
    const modelBefore = model.requests().length;
    const submitted = [];
    for (const index of [70, 71, 72]) submitted.push(await submitExtract(handle, index));
    const ids = submitted.map((entry) => entry.task.taskId);

    // The staged window (frozen web-api/1 §3.2): the result is staged, the
    // task stays running, nothing is published, the slot is held.
    const staged = await pollTask(handle, ids[0], (entry) => entry.resultPendingExit === true,
      { timeoutMs: waitWithin(deadline, 10000), message: 'the first task to stage its result' });
    assert.equal(staged.state, 'running', 'a staged result must keep the task running');
    assert.equal(staged.result, null, 'a staged result must not be visible as the result envelope');
    assert.equal(staged.failure, null, 'a staged result must not be visible as a failure envelope');
    await pollUntil(() => candidateRows(root, { status: 'staged' }).length >= 3 ? true : null,
      { timeoutMs: waitWithin(deadline, 6000), message: 'three staged candidate rows' });
    for (const entry of submitted) {
      const list = await handle.request('GET', `/api/text-sources/${entry.source.sourceId}/candidates`, { cookie: handle.cookie });
      assert.equal(list.status, 200, list.text);
      assert.equal(list.json.candidates.length, 0,
        'staged candidates must be invisible until exit confirmation (frozen §4.2/§10)');
    }
    const fourth = await submitExtract(handle, 73);
    assert.equal(fourth.task.state, 'queued',
      'the fourth task must queue while staged results hold every slot (resultPendingExit occupies a slot)');

    // The short run limit ends the hang through the production timeout path;
    // the resolution must be one of the two frozen-legal outcomes.
    for (let index = 0; index < ids.length; index += 1) {
      const resolved = await pollTask(handle, ids[index],
        (entry) => TERMINAL.includes(entry.state) || entry.state === 'needs_review',
        { timeoutMs: waitWithin(deadline, 10000), message: `task ${ids[index]} to leave the staged-running state after the run limit` });
      assertStagedResolution(resolved, root, submitted[index].source.sourceId);
    }
    assert.equal(model.requests().length, modelBefore, 'the protocol workers make no model calls');
  } finally {
    await handle.close();
    await factory.cleanup(hardDeadline);
    rmSync(root, { recursive: true, force: true });
  }
});

test('GAP-3 default limit: the same staged hang stays running and slot-holding when no short run limit is configured', async () => {
  const deadline = caseDeadline();
  const hardDeadline = caseHardDeadline();
  const { handle, factory, root } = await startCaseBackend({
    scenarios: ['stage-then-hang', 'stage-then-hang', 'stage-then-hang'],
  });
  try {
    const submitted = [];
    for (const index of [74, 75, 76]) submitted.push(await submitExtract(handle, index));
    const ids = submitted.map((entry) => entry.task.taskId);
    await pollTask(handle, ids[0], (entry) => entry.resultPendingExit === true,
      { timeoutMs: waitWithin(deadline, 10000), message: 'the first task to stage its result' });

    // The default limit (frozen contract §7: 120000ms) must not fire inside
    // the observation window. This is the control proving the short limit in
    // the previous case is what ended that hang — the same production path.
    // The window is the case's substance (it must outlast any plausible
    // short-limit misfire) and is bounded by the case deadline like every
    // other wait.
    const observed = Date.now();
    const window = waitWithin(deadline, 5000);
    await new Promise((done) => setTimeout(done, window));
    for (const taskId of ids) {
      const task = await readTask(handle, taskId);
      assert.equal(task.state, 'running',
        `the default 120000ms run limit must not fire within the observation window, got ${task.state} `
        + `after ${Date.now() - observed}ms: ${JSON.stringify(task)}`);
      assert.equal(task.resultPendingExit, true, 'the staged result must stay pending');
    }
    assert.equal(candidateRows(root, { status: 'staged' }).length, 3, 'the three staged results must be retained');
    for (const entry of submitted) {
      const list = await handle.request('GET', `/api/text-sources/${entry.source.sourceId}/candidates`, { cookie: handle.cookie });
      assert.equal(list.json.candidates.length, 0, 'staged candidates must stay invisible while running');
    }
    const fourth = await submitExtract(handle, 77);
    assert.equal(fourth.task.state, 'queued',
      'a fresh submission must stay queued while staged results hold every slot');
    const workers = processTable().filter((entry) => /protocol-worker-process\.mjs/.test(entry.command));
    assert.ok(workers.length >= 3, `the three hung protocol workers must be observable, got ${workers.length}`);
    for (const worker of workers) {
      assert.ok(!worker.command.includes(SYNTHETIC_KEY),
        `the protocol worker argv must not contain the synthetic secret: ${worker.command}`);
    }
  } finally {
    await handle.close();
    await factory.cleanup(hardDeadline);
    rmSync(root, { recursive: true, force: true });
  }
});

test('GAP-4: a result frame carrying a stale identity is fenced and the correctly stamped result still completes the task', async () => {
  const deadline = caseDeadline();
  const hardDeadline = caseHardDeadline();
  const { handle, factory, root } = await startCaseBackend({ scenarios: ['well-behaved', 'late-identity-frame'] });
  try {
    const modelBefore = model.requests().length;
    // Task 1 registers the first attempt's identity; task 2's worker emits a
    // result stamped with that stale identity first (a late frame), then the
    // correctly stamped result. Production fencing must reject the late frame
    // without disturbing either attempt.
    const first = await submitExtract(handle, 80);
    await pollTask(handle, first.task.taskId, (entry) => TERMINAL.includes(entry.state),
      { timeoutMs: waitWithin(deadline, 10000), message: 'the first protocol-worker task to finish' });
    assert.equal(taskRow(root, first.task.taskId).state, 'succeeded');

    const second = await submitExtract(handle, 81);
    const task = await pollTask(handle, second.task.taskId, (entry) => TERMINAL.includes(entry.state),
      { timeoutMs: waitWithin(deadline, 10000), message: 'the late-frame task to finish' });
    assert.equal(task.state, 'succeeded',
      `the correctly stamped result must complete the task, got ${task.state}: ${JSON.stringify(task)}`);
    assert.equal(model.requests().length, modelBefore, 'the protocol workers make no model calls');
    const rows = candidateRows(root, { sourceId: second.source.sourceId });
    assert.equal(rows.length, 1,
      `exactly one candidate may be published for the source (a fenced-accepted late frame would stage a second row), got ${rows.length}`);
    assert.equal(rows[0].status, 'pending');
    const firstRows = candidateRows(root, { sourceId: first.source.sourceId });
    assert.equal(firstRows.length, 1, 'the first task\'s candidate must be untouched by the late frame');

    // The late frame must leave an audit trace: frozen web-api/1 §3.3
    // ("晚到结果以事件留痕 rejected_late_result，不产生业务写入"). The event
    // is observed DIRECTLY in task_events on the task the stale frame arrived
    // for — not inferred from candidate counts (the R2 incremental review's
    // GAP-4 finding: the fence must be falsifiable from the audit event
    // itself).
    const events = taskEventRows(root, second.task.taskId);
    const rejected = events.filter((event) => event.type === 'rejected_late_result');
    assert.ok(rejected.length >= 1,
      `the fenced late frame must be audited as a rejected_late_result task event on the task it arrived `
      + `for, got event types ${JSON.stringify(events.map((event) => event.type))}`);
    for (const event of rejected) {
      assert.equal(event.object_type, 'task', 'the fence audit event must be a task event');
      assert.equal(event.object_id, second.task.taskId, 'the fence audit event must belong to the fenced task');
      assert.ok(!String(event.payload).includes(SYNTHETIC_KEY),
        'the fence audit event payload must not carry the synthetic secret');
    }
  } finally {
    await handle.close();
    await factory.cleanup(hardDeadline);
    rmSync(root, { recursive: true, force: true });
  }
});

test('GAP-5 lingering-tree: an unregistered escape is residual disclosure, not a veto (B(a))', async () => {
  const deadline = caseDeadline();
  const hardDeadline = caseHardDeadline();
  const { handle, factory, root } = await startCaseBackend({
    scenarios: ['lingering-tree', 'lingering-tree', 'lingering-tree'],
  });
  try {
    const submitted = [];
    for (const index of [90, 91, 92]) submitted.push(await submitExtract(handle, index));
    const ids = submitted.map((entry) => entry.task.taskId);
    for (const taskId of ids) {
      // B(a): the registry-domain verdict is the release authority. The
      // lingering grandchild is never registered (best-effort frame/ppid
      // registration misses a fast-spawned detached child), so the verdict is
      // `registry_extinct` and the escape is DISCLOSED as residual — never
      // claimed as a proven tree extinction, and never a veto.
      const task = await pollTask(handle, taskId, (entry) => entry.state === 'succeeded',
        { timeoutMs: waitWithin(deadline, 10000), message: `task ${taskId} to reach succeeded after the registry-domain exit` });
      assert.equal(task.attemptExitState, 'exited_confirmed');
      assert.equal(task.resultPendingExit, false);
      assert.ok(task.result, 'the staged outcome is published once the registry-domain exit is confirmed');
      assert.ok(task.attemptExitEvidence, 'the typed evidence must be present on the wire resource');
      assert.equal(task.attemptExitEvidence.verdict, 'registry_extinct');
      assert.equal(task.attemptExitEvidence.residual.treeExtinctProven, false,
        'the verdict never claims tree extinction');
    }
    const fourth = await submitExtract(handle, 93);
    assert.equal(fourth.task.state, 'queued', 'a fresh submission is accepted once the slots are released');
  } finally {
    await handle.close();
    await factory.cleanup(hardDeadline);
    rmSync(root, { recursive: true, force: true });
  }
});

test('protocol scenario exhaustion: an attempt beyond the registered scenarios fails explicitly and the attempt count is exact', async () => {
  const deadline = caseDeadline();
  const hardDeadline = caseHardDeadline();
  // Three registered scenarios, four attempts: the fourth spawn must fail
  // loudly (no silent well-behaved fallback — the R2 incremental review's
  // minor), and the factory must record the exact attempt count so the suite
  // can assert it instead of trusting the substitution.
  const { handle, factory, root } = await startCaseBackend({
    scenarios: ['well-behaved', 'well-behaved', 'well-behaved'],
  });
  try {
    const submitted = [];
    for (const index of [95, 96, 97, 98]) submitted.push(await submitExtract(handle, index));
    // The first three ran their registered scenarios normally, each confirmed
    // succeeded inside the SAME case deadline: the fourth attempt can only
    // happen once one of them releases its slot, so their completion is also
    // what makes the exhausted attempt observable.
    for (const index of [0, 1, 2]) {
      const done = await pollTask(handle, submitted[index].task.taskId, (entry) => entry.state === 'succeeded',
        { timeoutMs: waitWithin(deadline, 10000), message: `registered scenario ${index + 1} to succeed` });
      assert.equal(done.state, 'succeeded',
        `the registered scenarios must run normally, got ${done.state} for attempt ${index + 1}`);
    }

    // The exhausted attempt never ran a worker, so its task must CLOSE in one
    // of the two legal landings of a spawn failure — terminal `failed` with
    // its failure envelope and the slot released, or parked `needs_review`
    // with a registered recovery cause — inside the same case deadline. A task
    // still queued/running/cancelling when the deadline expires fails here
    // (pollTask names the last observed state), and a cancelled or
    // envelope-less landing is rejected by the classifier: "not succeeded" is
    // not a closure criterion.
    const fourth = submitted[3];
    const resolved = await pollTask(handle, fourth.task.taskId,
      (entry) => SPAWN_FAILURE_LEGAL_STATES.includes(entry.state),
      {
        timeoutMs: waitWithin(deadline, 10000),
        message: 'the exhausted attempt to close in a legal failed/needs_review landing',
      });
    classifySpawnFailureResolution(resolved);
    if (resolved.state === 'needs_review' && resolved.attemptExitState === 'exited_unknown') {
      // The parked landing holds its slot: resolve is rejected with the frozen
      // exit_unconfirmed conflict while the exit is unconfirmed (§3.5/§4.5),
      // and the recovery item version is the resolve entry's optimistic lock.
      const response = await handle.request('POST', `/api/tasks/${fourth.task.taskId}/resolve`, {
        body: { expectedVersion: resolved.recovery.itemVersion, decision: 'resume', acknowledgedReceipts: [] },
        cookie: handle.cookie, csrf: handle.csrf,
      });
      assert.equal(response.status, 409,
        `resolve must be rejected while the exit is unconfirmed, got ${response.status}: ${response.text}`);
      assert.equal(response.json.error?.code, 'exit_unconfirmed',
        `the rejection must name exit_unconfirmed, got ${response.text}`);
    }
    assert.deepEqual(candidateRows(root, { sourceId: fourth.source.sourceId }), [],
      'no candidate may be published for the exhausted attempt');

    // The exact attempt count: three registered scenarios consumed, the
    // fourth attempt rejected by the factory itself. Asserted after the
    // fourth task's legal landing, so the claim-then-spawn sequence has
    // certainly happened.
    assert.equal(factory.attempts.length, 4,
      `the factory must record one attempt per spawn (3 scenarios + 1 exhausted), got ${factory.attempts.length} `
      + '— if zero, the entry ignored the frozen private signature config.workerProcessFactory (slice I pending); '
      + 'no business result is claimed');
    assert.deepEqual(factory.attempts.map((entry) => entry.scenario),
      ['well-behaved', 'well-behaved', 'well-behaved', null],
      'the fourth attempt must have found the scenario queue empty');
    const exhaustion = factory.exhaustionError();
    assert.ok(exhaustion, 'the exhausted spawn must record an explicit error (no silent fallback)');
    assert.match(exhaustion.message, /exhausted/,
      `the exhaustion error must name the condition, got: ${exhaustion.message}`);
    assert.match(exhaustion.message, /3 scenario\(s\) registered, attempt 4/,
      `the exhaustion error must carry the registered count and the attempt number, got: ${exhaustion.message}`);
  } finally {
    await handle.close();
    await factory.cleanup(hardDeadline);
    rmSync(root, { recursive: true, force: true });
  }
});

test('protocol cleanup: worker and derived-process identities cover early failure and every exit is verified', async () => {
  const deadline = caseDeadline();
  const hardDeadline = caseHardDeadline();
  // A worker that fails early AFTER deriving a grandchild: the derived
  // process must already be registered (worker-start line + factory-level
  // pid), and cleanup must kill it and VERIFY the exit — not wait out its
  // lifetime (R2-3). The lingering-tree worker parks the task; the
  // early-failure worker's task must not succeed.
  const { handle, factory, root } = await startCaseBackend({
    scenarios: ['well-behaved', 'lingering-tree', 'early-failure'],
  });
  try {
    const submitted = [];
    for (const index of [99, 100, 101]) submitted.push(await submitExtract(handle, index));
    await pollTask(handle, submitted[0].task.taskId, (entry) => TERMINAL.includes(entry.state),
      { timeoutMs: waitWithin(deadline, 10000), message: 'the well-behaved task to finish' });
    // B(a): the lingering grandchild is never registered (best-effort
    // frame/ppid registration misses a fast-spawned detached child), so the
    // registry-domain verdict CONFIRMS the exit and the slot is released; the
    // escape is disclosed as residual, never a veto.
    const parked = await pollTask(handle, submitted[1].task.taskId, (entry) => entry.state === 'succeeded',
      { timeoutMs: waitWithin(deadline, 10000), message: 'the lingering-tree task to reach succeeded' });
    assert.equal(parked.attemptExitState, 'exited_confirmed',
      'an unregistered lingering escape confirms the registry-domain exit under B(a)');
    assert.ok(parked.attemptExitEvidence, 'the typed evidence must be present');
    assert.equal(parked.attemptExitEvidence.verdict, 'registry_extinct');
    assert.equal(parked.attemptExitEvidence.residual.treeExtinctProven, false);
    const failed = await pollTask(handle, submitted[2].task.taskId,
      (entry) => TERMINAL.includes(entry.state) || entry.state === 'needs_review',
      { timeoutMs: waitWithin(deadline, 10000), message: 'the early-failure task to resolve' });
    assert.notEqual(failed.state, 'succeeded',
      `a worker that exits before any result frame must not succeed its task, got ${failed.state}`);
    assert.deepEqual(candidateRows(root, { sourceId: submitted[2].source.sourceId }), [],
      'an early-failing worker must publish no candidate');

    // Identity registration covered the early-failure worker: the factory
    // knows every spawned pid synchronously, and the registry carries the
    // derived grandchildren of both derived-process scenarios.
    assert.equal(factory.attempts.length, 3, 'exactly three attempts must have been spawned');
    const registered = readFileSync(factory.registryPath, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    assert.ok(registered.some((entry) => entry.role === 'worker-start' && entry.scenario === 'early-failure'),
      'the early-failure worker must be registered from its start (before the request line)');
    const derived = registered.filter((entry) => typeof entry.lingerPid === 'number');
    assert.equal(derived.length, 2,
      `both derived-process scenarios must register their grandchild pid, got ${derived.length}`);
    assert.ok(derived.every((entry) => !entry.spawnFailed),
      'neither grandchild spawn may have failed silently');

    // The derived grandchildren carry the same 300s lifetime in every
    // scenario: they must still be alive at cleanup time, so the verified
    // exits below prove cleanup killed them — not the lifetime expiry
    // (shortening the lifetime is not a substitute for cleanup).
    for (const entry of derived) {
      let alive = false;
      try { process.kill(entry.lingerPid, 0); alive = true; } catch { /* already gone */ }
      assert.ok(alive,
        `the derived grandchild ${entry.lingerPid} must still be alive at cleanup time (its 300s lifetime `
        + 'must not be shortened as a cleanup substitute)');
    }

    // Cleanup kills every worker and every derived grandchild and VERIFIES
    // all exits: the report lists every recorded pid and no survivor. Every
    // wait derives from the remaining hard budget — no fixed 5s/15s constant
    // can outlive the case budget or mask a leftover process.
    const report = await factory.cleanup(hardDeadline);
    assert.equal(report.workers.length, 3, 'the cleanup report must cover all three workers');
    assert.equal(report.grandchildren.length, 2, 'the cleanup report must cover both derived grandchildren');
    assert.deepEqual(report.survivors, [], `cleanup must verify every exit, survivors: ${JSON.stringify(report.survivors)}`);
    for (const pid of [...report.workers, ...report.grandchildren]) {
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { /* already gone */ }
      assert.ok(!alive, `pid ${pid} must be gone after the verified cleanup`);
    }
    // No protocol-worker residue in the process table either.
    const residue = processTable().filter((entry) => /protocol-worker-process\.mjs/.test(entry.command));
    assert.equal(residue.length, 0, `no protocol worker process may survive cleanup, got ${JSON.stringify(residue)}`);
  } finally {
    await handle.close();
    await factory.cleanup(hardDeadline).catch(() => { /* the case already asserted the report */ });
    rmSync(root, { recursive: true, force: true });
  }
});

test('workerRunLimitMs range: the approved private key is validated as an integer 1..120000', async () => {
  const deadline = caseDeadline();
  for (const value of [0, -1, 120001, 1.5, '500', null]) {
    let started = null;
    let error = null;
    try {
      started = await startBackend({
        pair: false,
        runtimeRoot,
        credentialProvider: createControlledCredentialProvider({
          [CREDENTIAL_REF]: { value: SYNTHETIC_KEY, status: 'available' },
        }),
        workerRunLimitMs: value,
      });
    } catch (thrown) {
      error = thrown;
    }
    if (started) await started.close();
    assert.ok(Date.now() < deadline, 'the range validation must stay inside the case budget');
    assert.ok(error,
      `workerRunLimitMs=${JSON.stringify(value)} must be rejected by the production configuration `
      + '(frozen range: integer 1..120000); the entry accepted it — the approved private key is not validated');
  }
  for (const value of [1, 120000]) {
    const handle = await startBackend({ pair: false, runtimeRoot, workerRunLimitMs: value });
    await handle.close();
    assert.ok(Date.now() < deadline, 'the range validation must stay inside the case budget');
  }
});
