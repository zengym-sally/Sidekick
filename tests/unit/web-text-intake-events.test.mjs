//! Task event compensation and SSE replay regressions for the W1 text-intake
//! slice (MAYNE-24 D1 closure, dispatched on `01a1be9c`).
//!
//! Every case drives the REAL storage binary and the production service layer
//! (no transition logic is replicated here). The replay-boundary cases
//! exercise `SseHub.replayFrom` against the REAL `task_events` high watermark
//! read back from the database, and the snapshot case drives the real HTTP
//! handler; the end-to-end staged-window reconnect itself stays with the
//! recovery regression (`web-text-intake-recovery.test.mjs` D1), which runs
//! the whole production stack as a real child process.
//!
//! Faces:
//!   E-1  the extract success terminal commits its `task.changed` event and
//!        clears the staged-window markers in ONE transaction, keeping the
//!        result bytes (D1 core; R5-M-1 D1(b) residual).
//!   E-2  a no-op retry (a duplicate/concurrent stale `expectedVersion`)
//!        answers the frozen `version_conflict` and leaves NO phantom event.
//!   E-3  a concurrent retry pair: exactly one wins, exactly one event.
//!   E-4  a concurrent cancel pair: exactly one wins, exactly one event.
//!   E-5  a stage whose attempt was superseded persists nothing — no payload
//!        row, no phantom event.
//!   E-6  an internal audit (attempt-budget exhaustion) never fakes a
//!        `task.changed`.
//!   E-7  replay legitimacy uses the real DB high watermark: a token in an
//!        audit-induced cursor gap is not misjudged as a future token.
//!   E-8  replay stays bounded: a token below the real eviction boundary
//!        resets, epoch changes and malformed tokens reset, a gap token
//!        above the boundary stays resumable.
//!   E-9  the snapshot carries the full task set (no silent 200 truncation)
//!        while the normal list pagination is unchanged.
//!   E-10 a broken broadcast never rolls back the committed terminal state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { StorageClient } from '../../server/lib/storage-client.mjs';
import { TaskService } from '../../server/lib/task-service.mjs';
import { TextIntakeService } from '../../server/lib/text-intake-service.mjs';
import { ManualItemsService } from '../../server/lib/manual-items-service.mjs';
import { ApplicationSettingsService } from '../../server/lib/application-settings-service.mjs';
import { SessionStore } from '../../server/lib/session-store.mjs';
import { SseHub } from '../../server/lib/sse-hub.mjs';
import { HttpServer } from '../../server/lib/http-server.mjs';
import { TaskScheduler } from '../../server/lib/task-scheduler.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const storageBinary = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');

class PrerequisiteGap extends Error {}

function requireBinary() {
  if (!existsSync(storageBinary)) {
    throw new PrerequisiteGap(`storage adapter binary not found at ${storageBinary}; build it with cargo.`);
  }
}

/// One assembled backend over the real storage binary: the production task
/// service, SSE hub and HTTP server, with no scheduler and no workers (the
/// faces here are transition/replay properties, not launch properties).
async function setup({ now = () => Date.now() } = {}) {
  requireBinary();
  const root = mkdtempSync(join(tmpdir(), 'w1-events-'));
  const storage = new StorageClient({ binary: storageBinary, root, initialize: true });
  await storage.start();
  const sse = new SseHub();
  const taskService = new TaskService({ storage, root, epoch: sse.epoch, now });
  const httpServer = new HttpServer({
    service: new ManualItemsService(storage),
    sessions: new SessionStore(),
    sse,
    staticRoot: '.',
    root,
    expectedHost: '',
    applicationSettings: new ApplicationSettingsService(storage),
    taskService,
  });
  const port = await httpServer.listen(0);
  httpServer.expectedHost = `127.0.0.1:${port}`;
  const origin = `http://127.0.0.1:${port}`;
  const pairingCode = httpServer.sessions.generatePairingCode();
  const pairResponse = await fetch(`${origin}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ pairingCode }),
  });
  assert.equal(pairResponse.status, 200, 'pairing must succeed');
  const pairBody = await pairResponse.json();
  const cookie = (pairResponse.headers.get('set-cookie') ?? '').split(';')[0];
  return {
    root, storage, sse, taskService, httpServer, port, origin,
    token: cookie.replace('sidekick_session=', ''),
    csrfToken: pairBody.csrfToken,
    async stop() {
      await httpServer.close();
      sse.stop();
      await storage.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function clientFor(origin, session) {
  const headers = () => ({
    cookie: `sidekick_session=${session.token}`,
    'x-csrf-token': session.csrfToken,
    origin,
  });
  return {
    async get(path) {
      const response = await fetch(`${origin}${path}`, { headers: { ...headers() } });
      return { status: response.status, body: await response.json() };
    },
  };
}

async function countEvents(taskService, taskId) {
  const rows = await taskService.query(
    'SELECT COUNT(*) FROM task_events WHERE object_type=? AND object_id=?',
    ['task', taskId],
  );
  return rows[0][0];
}

/// Claim the next queued task and assert it is the expected one.
async function claim(taskService, taskId) {
  const claimed = await taskService.claimNext(3, taskService.epoch);
  assert.ok(claimed, 'a queued task must be claimable');
  assert.equal(claimed.row.taskId, taskId);
  return claimed.attemptId;
}

const MANUAL_FAILURE = {
  code: 'auth_or_config_invalid',
  message: '还没有可用的默认模型，请到模型设置中配置。',
  retryable: 'manual',
  sideEffectSafety: 'unknown',
};

const AUTO_BACKOFF_FAILURE = {
  code: 'model_request_failed',
  message: '整理失败。',
  retryable: 'auto_backoff',
  sideEffectSafety: 'proven_safe',
};

/// Drive a fresh task to `failed` through the production transitions.
async function driveToFailed(taskService, operationId, payload = MANUAL_FAILURE) {
  const submitted = await taskService.submit({
    operationId,
    type: 'test',
    role: 'organizer',
    input: {},
  });
  const taskId = submitted.task.taskId;
  const attemptId = await claim(taskService, taskId);
  await taskService.stageResult(taskId, attemptId, taskService.epoch, 'failed', payload);
  await taskService.confirmExit(taskId, attemptId, { exited: true });
  const failed = await taskService.get(taskId);
  assert.equal(failed.state, 'failed', 'the task must reach the failed terminal state');
  return { taskId, failed };
}

test('E-1: the extract success terminal commits its event and clears the staged window in one transaction', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const textIntake = new TextIntakeService({ storage: ctx.storage, taskService: ctx.taskService });
  // A real source row (the staged candidates reference it through the FK).
  const submitted = await textIntake.submitSource(`op_e1_${Date.now()}`, {
    text: '我负责整理接入清单，下周五17点前交付。',
    timeZone: 'Asia/Shanghai',
  });
  const taskId = submitted.task.taskId;
  const attemptId = await claim(ctx.taskService, taskId);
  const staged = await textIntake.stageExtractResult(taskId, attemptId, [{
    fields: { title: '整理接入清单', kind: 'action', owner: '我', priority: 'high', tags: [], due: null, followup: null },
    evidence: '我负责整理接入清单',
    dueExpression: null,
    followupExpression: null,
  }]);
  assert.equal(staged, true, 'the staged outcome is persisted');
  const stagedTask = await ctx.taskService.get(taskId);
  assert.equal(stagedTask.resultPendingExit, true, 'the staged window holds the slot');
  const stagingCursor = await ctx.taskService.latestEventCursor(taskId);

  const terminal = await textIntake.confirmExtractExit(taskId, attemptId, {
    exited: true,
    cancel: false,
    epoch: ctx.taskService.epoch,
  });
  assert.equal(terminal, 'succeeded', 'the original staged outcome is committed');

  const done = await ctx.taskService.get(taskId);
  assert.equal(done.state, 'succeeded');
  assert.equal(done.resultPendingExit, false, 'the terminal commit clears the pending flag (D1(b) residual)');
  assert.equal(done.result?.kind, 'candidates', 'the result reference is preserved');
  // The terminal event was committed in the SAME transaction: its cursor is
  // strictly above the staging cursor, and the row carries the terminal
  // state — the compensation a staged-window reconnect token replays.
  const terminalCursor = await ctx.taskService.latestEventCursor(taskId);
  assert.ok(terminalCursor > stagingCursor, 'the terminal transition advances the cursor');
  const events = await ctx.taskService.query(
    'SELECT type,payload FROM task_events WHERE object_type=? AND object_id=? ORDER BY cursor',
    ['task', taskId],
  );
  const lastPayload = JSON.parse(events[events.length - 1][1]);
  assert.equal(events[events.length - 1][0], 'task.changed');
  assert.equal(lastPayload.state, 'succeeded', 'the terminal event carries the committed state');
  // The staged candidates are published and the result bytes survive.
  const candidates = await ctx.taskService.query('SELECT status FROM candidates WHERE run_id=?', [taskId]);
  assert.ok(candidates.length >= 1 && candidates.every((row) => row[0] === 'pending'), 'the staged candidates are published');
  const result = await ctx.taskService.readResult(taskId);
  assert.equal(result.outcome, 'succeeded');
  assert.ok(String(result.payload).includes('整理接入清单'), 'the result bytes are preserved');
});

test('E-2: a no-op retry leaves no phantom event — version_conflict and state_conflict both roll back whole', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const { taskId, failed } = await driveToFailed(ctx.taskService, `op_e2_${Date.now()}`);
  const before = await countEvents(ctx.taskService, taskId);

  // An incorrect expectedVersion on a still-failed task answers the frozen
  // `version_conflict`; the re-queue transaction — event included — never
  // ran, so no phantom event survives.
  await assert.rejects(
    ctx.taskService.retry(taskId, failed.version + 5),
    (error) => error?.code === 'version_conflict',
    'a stale expectedVersion must answer the frozen version_conflict',
  );
  assert.equal(await countEvents(ctx.taskService, taskId), before, 'the refused retry left no phantom event');

  const retried = await ctx.taskService.retry(taskId, failed.version);
  assert.equal(retried.state, 'queued', 'the retry re-queues the task');
  assert.equal(await countEvents(ctx.taskService, taskId), before + 1, 'the retry writes its event');

  // The same (now stale) expectedVersion on the re-queued task is refused by
  // the state guard, again without an event.
  await assert.rejects(
    ctx.taskService.retry(taskId, failed.version),
    (error) => error?.code === 'state_conflict',
    'a re-queued task is not retryable',
  );
  assert.equal(await countEvents(ctx.taskService, taskId), before + 1, 'a no-op retry leaves no phantom event');
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.state, 'queued', 'the no-op retry changed nothing');
  assert.equal(after.version, retried.version, 'the no-op retry consumed no version');
});

test('E-3: concurrent retries — exactly one wins and exactly one event is written', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const { taskId, failed } = await driveToFailed(ctx.taskService, `op_e3_${Date.now()}`);
  const before = await countEvents(ctx.taskService, taskId);

  const outcomes = await Promise.allSettled([
    ctx.taskService.retry(taskId, failed.version),
    ctx.taskService.retry(taskId, failed.version),
  ]);
  const fulfilled = outcomes.filter((entry) => entry.status === 'fulfilled');
  const rejected = outcomes.filter((entry) => entry.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one retry wins the row');
  assert.equal(rejected.length, 1, 'the duplicate retry loses');
  assert.equal(rejected[0].reason?.code, 'version_conflict', 'the loser answers the frozen version_conflict');
  assert.equal(await countEvents(ctx.taskService, taskId), before + 1, 'exactly one event — the loser left no phantom event');
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.state, 'queued');
  assert.equal(after.version, failed.version + 1, 'the winner consumed exactly one version');
});

test('E-4: concurrent cancels of a queued task — exactly one wins and exactly one event is written', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.taskService.submit({
    operationId: `op_e4_${Date.now()}`,
    type: 'test',
    role: 'organizer',
    input: {},
  });
  const taskId = submitted.task.taskId;
  const before = await countEvents(ctx.taskService, taskId);

  const outcomes = await Promise.allSettled([
    ctx.taskService.cancel(taskId),
    ctx.taskService.cancel(taskId),
  ]);
  const fulfilled = outcomes.filter((entry) => entry.status === 'fulfilled');
  const rejected = outcomes.filter((entry) => entry.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one cancel wins the row');
  assert.equal(rejected.length, 1, 'the duplicate cancel loses');
  assert.equal(rejected[0].reason?.code, 'state_conflict', 'the loser answers state_conflict');
  assert.equal(await countEvents(ctx.taskService, taskId), before + 1, 'exactly one event — the loser left no phantom event');
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.state, 'cancelled');
});

test('E-5: a stage whose attempt was superseded persists nothing — no payload row, no phantom event', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.taskService.submit({
    operationId: `op_e5_${Date.now()}`,
    type: 'test',
    role: 'organizer',
    input: {},
  });
  const taskId = submitted.task.taskId;
  const attemptId = await claim(ctx.taskService, taskId);
  // An unverifiable exit supersedes the attempt (needs_review / exited_unknown).
  const review = await ctx.taskService.confirmExit(taskId, attemptId, { exited: false });
  assert.equal(review, 'needs_review');
  const before = await countEvents(ctx.taskService, taskId);

  const staged = await ctx.taskService.stageResult(taskId, attemptId, ctx.taskService.epoch, 'succeeded', { ok: true });
  assert.equal(staged, false, 'a superseded attempt stages nothing');
  assert.equal(await countEvents(ctx.taskService, taskId), before, 'no phantom event survives the no-op stage');
  const payload = await ctx.taskService.readResultPayload(attemptId, 'result');
  assert.equal(payload, null, 'no payload row was written');
});

test('E-6: an internal audit never fakes a task.changed — budget exhaustion downgrades without an event', async (t) => {
  let clock = Date.parse('2026-11-09T12:00:00.000Z');
  const ctx = await setup({ now: () => clock });
  t.after(() => ctx.stop());
  const submitted = await ctx.taskService.submit({
    operationId: `op_e6_${Date.now()}`,
    type: 'test',
    role: 'organizer',
    input: {},
  });
  const taskId = submitted.task.taskId;
  let lastOutcome = null;
  for (let cycle = 0; cycle < 4; cycle += 1) {
    // Past the bounded auto-backoff so the re-enqueued task is claimable.
    clock += 61_000;
    const attemptId = await claim(ctx.taskService, taskId);
    await ctx.taskService.stageResult(taskId, attemptId, ctx.taskService.epoch, 'failed', AUTO_BACKOFF_FAILURE);
    await ctx.taskService.confirmExit(taskId, attemptId, { exited: true });
    lastOutcome = await ctx.taskService.maybeAutoRetry(taskId);
  }
  assert.equal(lastOutcome, 'failed', 'an exhausted attempt budget downgrades the task to manual');
  const final = await ctx.taskService.get(taskId);
  assert.equal(final.state, 'failed');
  assert.equal(final.failure.retryable, 'manual', 'the exhausted retryable is downgraded to manual');
  assert.equal(final.failure.code, 'model_request_failed', 'the registered code is kept');
});

test('E-6b: the exhaustion downgrade itself writes no event (the audit never fakes task.changed)', async (t) => {
  let clock = Date.parse('2026-11-09T12:30:00.000Z');
  const ctx = await setup({ now: () => clock });
  t.after(() => ctx.stop());
  const submitted = await ctx.taskService.submit({
    operationId: `op_e6b_${Date.now()}`,
    type: 'test',
    role: 'organizer',
    input: {},
  });
  const taskId = submitted.task.taskId;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    clock += 61_000;
    const attemptId = await claim(ctx.taskService, taskId);
    await ctx.taskService.stageResult(taskId, attemptId, ctx.taskService.epoch, 'failed', AUTO_BACKOFF_FAILURE);
    await ctx.taskService.confirmExit(taskId, attemptId, { exited: true });
    await ctx.taskService.maybeAutoRetry(taskId);
  }
  // The budget is now 0: the next failure exhausts it.
  clock += 61_000;
  const attemptId = await claim(ctx.taskService, taskId);
  await ctx.taskService.stageResult(taskId, attemptId, ctx.taskService.epoch, 'failed', AUTO_BACKOFF_FAILURE);
  await ctx.taskService.confirmExit(taskId, attemptId, { exited: true });
  const before = await countEvents(ctx.taskService, taskId);
  const outcome = await ctx.taskService.maybeAutoRetry(taskId);
  assert.equal(outcome, 'failed', 'the exhausted budget downgrades instead of re-enqueueing');
  assert.equal(await countEvents(ctx.taskService, taskId), before,
    'the exhaustion downgrade is an internal audit — no task.changed is faked for it');
});

test('E-7: replay legitimacy uses the real DB high watermark — an audit gap is not a future token', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  // Two real transitions commit their events (cursors 1 and 2) with NO
  // broadcast: the in-memory counter still lags the database watermark.
  const submitted = await ctx.taskService.submit({
    operationId: `op_e7_${Date.now()}`,
    type: 'test',
    role: 'organizer',
    input: {},
  });
  const taskId = submitted.task.taskId;
  const attemptId = await claim(ctx.taskService, taskId);
  const watermark = await ctx.taskService.readHighWatermark();
  assert.equal(watermark, 2, 'both transitions committed their events');
  assert.equal(ctx.sse.cursor, 0, 'no broadcast happened — the broadcast counter lags the DB');

  // A token at the first committed cursor is resumable even though nothing
  // was ever broadcast: the gap is audit-induced, not an eviction, and the
  // token does not claim events beyond the real watermark.
  const gap = ctx.sse.replayFrom(`${ctx.sse.epoch}:1`, watermark);
  assert.equal(gap.reset, false, 'a token inside the audit gap is resumable');
  assert.deepEqual(gap.frames.map((frame) => frame.cursor), [], 'nothing was broadcast yet');
  const caughtUp = ctx.sse.replayFrom(`${ctx.sse.epoch}:2`, watermark);
  assert.equal(caughtUp.reset, false, 'a token at the real watermark is caught up, not future');

  // Once the second transition is broadcast with its authoritative cursor,
  // the gap token replays it.
  ctx.sse.broadcastTaskChanged({
    taskId,
    taskVersion: 2,
    taskState: 'running',
    cursor: watermark,
  });
  const replayed = ctx.sse.replayFrom(`${ctx.sse.epoch}:1`, watermark);
  assert.equal(replayed.reset, false);
  assert.deepEqual(replayed.frames.map((frame) => frame.cursor), [watermark]);
  assert.equal(attemptId.startsWith('att_'), true, 'the claim attributed a real attempt');
});

test('E-8: replay stays bounded — a lost-window token resets, a gap token above the boundary stays resumable', async (t) => {
  const hub = new SseHub({ maxFrames: 2 });
  for (const cursor of [1, 2, 3, 4]) {
    hub.broadcastTaskChanged({ taskId: 'tsk_e8', taskVersion: cursor, taskState: 'running', cursor });
  }
  assert.equal(hub.evictedThrough, 2, 'the two oldest frames were dropped from the bounded buffer');
  assert.deepEqual(hub.replayFrom(`${hub.epoch}:1`, 4), { reset: true, reason: 'cursor_out_of_window' },
    'a token below the real eviction boundary lost frames');
  const fromBoundary = hub.replayFrom(`${hub.epoch}:2`, 4);
  assert.equal(fromBoundary.reset, false, 'a token at the eviction boundary is resumable');
  assert.deepEqual(fromBoundary.frames.map((frame) => frame.cursor), [3, 4]);
  assert.deepEqual(hub.replayFrom(`${hub.epoch}:4`, 4), { reset: false, frames: [] }, 'a caught-up token replays nothing');

  // Future tokens, malformed tokens and epoch changes keep their resets.
  assert.deepEqual(hub.replayFrom(`${hub.epoch}:5`, 4), { reset: true, reason: 'cursor_out_of_window' },
    'a token beyond the real watermark claims nonexistent events');
  assert.deepEqual(hub.replayFrom('not-a-token', 4), { reset: true, reason: 'malformed_last_event_id' });
  assert.deepEqual(hub.replayFrom('inst_other:1', 4), { reset: true, reason: 'epoch_changed' });
  assert.deepEqual(hub.replayFrom(null, 4), { reset: false, frames: [] }, 'a fresh subscription replays nothing');

  // A gap below the oldest retained frame is not an eviction: with nothing
  // dropped, a token between committed-but-unbroadcast cursors stays
  // resumable and replays what the buffer holds.
  const gapHub = new SseHub({ maxFrames: 2 });
  gapHub.broadcastTaskChanged({ taskId: 'tsk_e8g', taskVersion: 1, taskState: 'running', cursor: 10 });
  gapHub.broadcastTaskChanged({ taskId: 'tsk_e8g', taskVersion: 2, taskState: 'succeeded', cursor: 20 });
  const gap = gapHub.replayFrom(`${gapHub.epoch}:5`, 20);
  assert.equal(gap.reset, false, 'a token in a gap above the eviction boundary stays resumable');
  assert.deepEqual(gap.frames.map((frame) => frame.cursor), [10, 20]);
});

test('E-9: the snapshot carries the full task set — no silent 200 truncation, list pagination unchanged', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const total = 201;
  for (let index = 0; index < total; index += 1) {
    await ctx.taskService.submit({
      operationId: `op_e9_${index}`,
      type: 'test',
      role: 'organizer',
      input: {},
    });
  }
  const api = clientFor(ctx.origin, ctx);
  const snapshot = await api.get('/api/snapshot');
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.tasks.length, total,
    'the full-volume snapshot must not truncate at the list page size (frozen §6)');
  const watermark = await ctx.taskService.readHighWatermark();
  assert.equal(snapshot.body.highWatermark, watermark, 'the snapshot reports the real DB high watermark');
  assert.equal(snapshot.body.lastEventId, `${ctx.sse.epoch}:${watermark}`);

  // The normal list endpoint keeps its pagination.
  const page = await api.get('/api/tasks?limit=200');
  assert.equal(page.status, 200);
  assert.equal(page.body.tasks.length, 200, 'the list page size is unchanged');
  assert.ok(page.body.nextCursor, 'the list still paginates');
  const oversized = await api.get('/api/tasks?limit=201');
  assert.equal(oversized.status, 400, 'the list limit bound is unchanged');
});

test('E-10: a broken broadcast never rolls back the committed terminal state', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  // A hub whose broadcast always fails (a disconnected client).
  const brokenSse = {
    broadcastTaskChanged() { throw new Error('client disconnected'); },
  };
  const scheduler = new TaskScheduler({
    taskService: ctx.taskService,
    textIntakeService: null,
    workerHost: null,
    credentialProvider: null,
    sse: brokenSse,
  });
  const submitted = await ctx.taskService.submit({
    operationId: `op_e10_${Date.now()}`,
    type: 'test',
    role: 'organizer',
    input: {},
  });
  const taskId = submitted.task.taskId;
  const attemptId = await claim(ctx.taskService, taskId);
  await ctx.taskService.stageResult(taskId, attemptId, ctx.taskService.epoch, 'succeeded', { ok: true });
  const terminal = await ctx.taskService.confirmExit(taskId, attemptId, { exited: true });
  assert.equal(terminal, 'succeeded');
  const committed = await ctx.taskService.get(taskId);

  // The post-commit broadcast fails; the committed terminal state survives
  // untouched and the failure does not escape into the exit chain.
  await scheduler.notify(taskId);
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.state, 'succeeded', 'the committed terminal state is not rolled back');
  assert.equal(after.version, committed.version, 'the broken broadcast wrote nothing');
});
