//! Black-box regression for the W1 task-SSE client sync (MAYNE-24).
//!
//! Dispatch lineage: coordination comment `01a1c15f-071c-7020-bcb8-9d8f123d9320`
//! (original dispatch of this suite), reassigned to ZCode by
//! `01a1c1e3-b46e-7119-9bd7-5741af26aac9`; acceptance faces and judgments come
//! from the frozen `docs/engineering/web-api-contract.md` §6 and
//! `docs/engineering/web-text-intake-contract.md` §6.3.
//!
//! The suite drives the REAL composition of the tree it runs in — the real
//! compiled PairingGate (which registers the event routing under test), the
//! real TaskQueue in its slot, the real stores over the real WebApiClient and
//! the tree's real SSE transport — against legal controlled `web-api/1`
//! responses (fixtures in `../fixtures/web-text-intake/sse-client-harness.mjs`).
//! No production sync callback is re-implemented here; every face observes the
//! read-backs the sync pipeline itself dispatches.
//!
//! Faces (the two anchors must hold on every tree; the nine sync faces hold on
//! the SSE-package tree `170f611` and go RED on the pre-package complete I＋b5
//! composition `fdf89c1`＋pairing `d04b09a9` — each red lands on a synchronous
//! behavior assertion, not on transport plumbing):
//!   A1 pairing over the legal HTTP surface, through the tree's own transport;
//!   A2 unmount closes the live stream;
//!   S1 stream.ready re-reads items AND organizer (never todos-only);
//!   S2 candidate/task hints re-read sources and tasks (intake §6.3);
//!   S3 stream.reset → snapshot fetched, CONSUMED into the organizer baseline,
//!      resubscribe carries the snapshot token as the Last-Event-ID header;
//!   S4 a foreign-epoch frame goes through the snapshot path — never an
//!      in-place epoch adoption (§6 禁止跨 epoch 就地合并);
//!   S5 a legal newer attempt (same task, higher wire version) displays and a
//!      stale response cannot overwrite it;
//!   S6 a same-epoch snapshot at or below the applied watermark is an old
//!      response — never consumed; the committed token is kept;
//!   S7 stream loss with 401 returns to the gate without a reconnect storm;
//!      re-pairing subscribes fresh (no token);
//!   S8 queue authority coverage: page walk, exited-unknown/needs-review
//!      slots stay visible (never posing as 没有任务);
//!   S9 a queue read that started before the epoch flipped can never land.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  defaultWorld,
  snapshotBody,
  installControlledNetwork,
  mountGate,
  settle,
  waitFor,
  wireTask,
} from '../fixtures/web-text-intake/sse-client-harness.mjs';

const EVENT_STREAM = 'text/event-stream';
const READY = { contractVersion: 'web-api/2', epoch: 'inst_a', cursor: 0 };
const HINT = { contractVersion: 'web-api/2', epoch: 'inst_a', objectType: 'task', objectId: 'tsk_1' };
const RESET = { contractVersion: 'web-api/2', epoch: 'inst_a', reason: 'cursor_out_of_window' };

const SESSION_401 = () => ({
  status: 401,
  body: { contractVersion: 'web-api/2', error: { code: 'unauthorized', message: '需要配对。' } },
});

/// Per-case scaffolding: legal world, controlled network, real gate mount and
/// unconditional cleanup (unmount + dispose + globals restored), so a failed
/// assertion can never leave a stream, timer or reconnect loop behind.
async function openCase({ world = defaultWorld(), behavior = {}, preMount } = {}) {
  const net = installControlledNetwork(world, behavior);
  const kase = { world, behavior, net, mounted: null, finished: false };
  kase.finish = async () => {
    if (kase.finished) return;
    kase.finished = true;
    if (kase.mounted) {
      try {
        kase.mounted.unmount();
      } catch {
        // The gate's own unmount is the primary cleanup; a renderer complaint
        // here must not mask the case's real failure.
      }
      kase.mounted.pairing.dispose();
      kase.mounted = null;
    }
    net.restore();
    await settle(25);
  };
  preMount?.(net);
  kase.mounted = mountGate();
  /// Legal session present: the gate pairs itself on start and the event
  /// subscription opens through the tree's real transport.
  kase.paired = async () => {
    await waitFor(() => kase.mounted.pairing.ready && kase.mounted.pairing.paired, 'the gate pairing itself');
    await waitFor(() => net.streams.length > 0 || net.eventSources.length > 0, 'the event subscription opening');
    await settle(20);
    return kase;
  };
  return kase;
}

test('anchor: the real gate pairs over the legal HTTP surface and opens the tree’s own event transport', { timeout: 20000 }, async (t) => {
  const behavior = { session: SESSION_401 };
  const kase = await openCase({ behavior });
  t.after(() => kase.finish());
  const { net, mounted } = kase;

  // Fresh probe 401 → the gate shows the pairing form, not a broken state.
  await waitFor(() => mounted.pairing.ready === true, 'the session probe settling');
  assert.equal(mounted.pairing.paired, false);

  // The real pair() over the frozen HTTP surface.
  mounted.pairing.code = '428151';
  assert.equal(await mounted.pairing.pair(), true);
  assert.equal(mounted.pairing.paired, true);
  const pairCall = net.log.find((call) => call.path === '/api/pair');
  assert.ok(pairCall, 'the pairing code was submitted over POST /api/pair');
  assert.equal(pairCall.headers.Host, '127.0.0.1:4173');

  // The event subscription opens through the tree's OWN transport, observed
  // from the transport boundary: a same-origin fetch stream (Accept + Host
  // headers) where the tree has the §6 transport, the native double otherwise.
  await waitFor(() => net.streams.length > 0 || net.eventSources.length > 0, 'the event subscription opening');
  if (net.streams.length > 0) {
    const open = net.log.find((call) => call.path === '/api/events');
    assert.ok(open, 'the subscription is a same-origin fetch stream');
    assert.equal(open.headers.Accept, EVENT_STREAM);
    assert.equal(open.headers.Host, '127.0.0.1:4173');
    assert.equal(open.headers['Last-Event-ID'], undefined, 'a first subscribe carries no reconnect token');
    assert.equal(net.eventSources.length, 0, 'the native EventSource is never constructed when the §6 transport exists');
  } else {
    assert.equal(net.eventSources.length, 1, 'the legacy transport is a native EventSource on /api/events');
    assert.equal(net.eventSources[0].url, '/api/events');
  }

  // Legal responses parse into the real stores (intake read-back surface).
  net.emit('stream.ready', READY);
  await waitFor(() => mounted.todos.rows.length === 1, 'the manual item read-back parsing');
  assert.equal(mounted.todos.rows[0].id, 'mi_1');
  await settle(150);
  // The queued slot renders through the tree's own label discipline (R2 maps
  // state → Chinese labels; the pre-package queue renders the raw state).
  assert.ok(/(排队中|queued)/.test(mounted.renderedText()), 'the queue renders the authoritative queued slot');
});

test('anchor: unmounting the gate closes the live event stream and stops all reads', { timeout: 20000 }, async () => {
  const kase = await openCase();
  const net = kase.net;
  await kase.paired();

  const quiet = net.lastSeq();
  if (net.streams.length > 0) {
    const open = net.log.find((call) => call.path === '/api/events');
    kase.mounted.unmount();
    kase.mounted.pairing.dispose();
    kase.mounted = null;
    await waitFor(() => open.signal?.aborted === true, 'the stream fetch aborting on unmount');
    assert.equal(open.signal.aborted, true, 'the live fetch stream is aborted when the gate unmounts');
  } else {
    const source = net.eventSources[0];
    kase.mounted.unmount();
    kase.mounted.pairing.dispose();
    kase.mounted = null;
    assert.equal(source.closed, true, 'the live EventSource is closed when the gate unmounts');
  }
  await settle(400);
  assert.equal(net.callsAfter(quiet, '/api/').length, 0, 'no read-back of any surface follows the unmount');
  await kase.finish();
});

test('stream.ready re-reads manual items AND the organizer sources/candidates/tasks (never todos-only)', { timeout: 20000 }, async (t) => {
  const kase = await openCase();
  t.after(() => kase.finish());
  const { net, mounted } = kase;
  await kase.paired();

  const baseline = net.lastSeq();
  net.emit('stream.ready', READY);
  await waitFor(() => net.callsAfter(baseline, '/api/tasks/tsk_1').length > 0, 'the organizer read_model_run after stream.ready');
  assert.ok(net.callsAfter(baseline, '/api/manual-items').length > 0, 'manual items are re-read');
  assert.ok(net.callsAfter(baseline, '/api/text-sources').some((call) => call.path === '/api/text-sources'), 'the source list is re-read');
  assert.ok(net.callsAfter(baseline, '/api/tasks').some((call) => call.path === '/api/tasks'), 'the task list is re-read');
});

test('candidate.changed and task.changed hints re-read sources and tasks through the real gate routing', { timeout: 20000 }, async (t) => {
  const kase = await openCase();
  t.after(() => kase.finish());
  const { net, mounted } = kase;
  await kase.paired();

  net.emit('stream.ready', READY);
  await waitFor(() => net.log.some((call) => call.path === '/api/tasks/tsk_1'), 'the first organizer read-back settling');
  await settle(150);

  // candidate.changed (no id, per intake §6.3) → organizer read-back.
  let baseline = net.lastSeq();
  net.emit('candidate.changed', { ...HINT, objectType: 'candidate' });
  await waitFor(() => net.callsAfter(baseline, '/api/tasks/tsk_1').length > 0, 'the organizer read-back after candidate.changed', 2000);
  assert.ok(net.callsAfter(baseline, '/api/text-sources').some((call) => call.path === '/api/text-sources'), 'the candidate hint also re-reads the source list');

  // task.changed (id inst_a:1) → organizer read-back + queue invalidation.
  await settle(150);
  baseline = net.lastSeq();
  net.emit('task.changed', { ...HINT, cursor: 1, objectVersion: 2, taskState: 'running' }, 'inst_a:1');
  await waitFor(() => net.callsAfter(baseline, '/api/tasks/tsk_1').length > 0, 'the organizer read-back after task.changed', 2000);
  // The queue seam refresh is the TaskQueue's own limit=100 read; the window
  // stays below the 1s poll, so only the invalidation can produce it.
  await waitFor(
    () => net.callsAfter(baseline, '/api/tasks').some((call) => call.path === '/api/tasks' && call.query.includes('limit=100')),
    'the queue invalidation read',
    450,
  );
});

test('stream.reset fetches the snapshot, installs it as the organizer baseline, and resubscribes with the snapshot token as the Last-Event-ID header', { timeout: 20000 }, async (t) => {
  const behavior = {};
  const kase = await openCase({ behavior });
  t.after(() => kase.finish());
  const { net, mounted } = kase;
  await kase.paired();
  net.emit('stream.ready', READY);
  await waitFor(() => net.log.some((call) => call.path === '/api/tasks/tsk_1'), 'the first organizer read-back settling');
  assert.equal(mounted.organizer.run?.wireVersion, 1, 'the ready read-back installed the world task');

  // The reset's snapshot carries what NO read served: v2 running of the same
  // task — only consuming the snapshot can produce this displayed state.
  behavior.snapshot = () => ({ ...snapshotBody(kase.world),
    contractVersion: 'web-api/2',
    highWatermark: 7,
    lastEventId: 'inst_a:7',
    epoch: 'inst_a',
    agentConcurrency: 3,
    tasks: [wireTask({ taskId: 'tsk_1', state: 'running', version: 2, attemptCount: 1 })],
  });
  net.emit('stream.reset', RESET);

  await waitFor(() => net.log.some((call) => call.path === '/api/snapshot'), 'the GET /api/snapshot on stream.reset');
  await waitFor(
    () => mounted.organizer.run?.wireVersion === 2 && mounted.organizer.run?.status === 'running',
    'the snapshot being consumed into the organizer baseline',
  );
  await waitFor(() => net.streams.length >= 2, 'the resubscribe');
  const resub = net.log.filter((call) => call.path === '/api/events').at(-1);
  assert.equal(resub.headers['Last-Event-ID'], 'inst_a:7', 'the resubscribe carries the snapshot token as the request header');
});

test('a foreign-epoch frame goes through the snapshot path and never merges or adopts its epoch in place', { timeout: 20000 }, async (t) => {
  const behavior = {};
  const kase = await openCase({ behavior });
  t.after(() => kase.finish());
  const { net, mounted } = kase;
  await kase.paired();
  net.emit('stream.ready', READY);
  await waitFor(() => mounted.pairing.syncEpoch === 'inst_a', 'the ready handshake adopting the instance epoch');

  behavior.snapshot = () => ({ ...snapshotBody(kase.world),
    contractVersion: 'web-api/2',
    highWatermark: 9,
    lastEventId: 'inst_b:9',
    epoch: 'inst_b',
    agentConcurrency: 3,
    tasks: [wireTask({ taskId: 'tsk_9', type: 'test', state: 'running', version: 1 })],
  });
  net.emit(
    'task.changed',
    { ...HINT, cursor: 9, objectVersion: 1, taskState: 'running', epoch: 'inst_b', objectId: 'tsk_9' },
    'inst_b:9',
  );

  // §6: the crossing is resolved by the snapshot, so the frame's own epoch
  // becomes authoritative only AFTER the snapshot is consumed.
  await waitFor(() => net.log.some((call) => call.path === '/api/snapshot'), 'the GET /api/snapshot for the epoch crossing');
  await waitFor(() => mounted.pairing.syncEpoch === 'inst_b', 'the epoch adopting only via the consumed snapshot');
  assert.equal(mounted.organizer.run?.id, 'tsk_9', 'the cross-epoch baseline replaced wholesale (no in-place merge)');
  await waitFor(() => net.streams.length >= 2, 'the resubscribe');
  const resub = net.log.filter((call) => call.path === '/api/events').at(-1);
  assert.equal(resub.headers['Last-Event-ID'], 'inst_b:9', 'the resubscribe token comes from the snapshot, not from the stray frame');
});

test('a legal newer attempt (same task, higher wire version) is displayed and a stale response cannot overwrite it', { timeout: 20000 }, async (t) => {
  const behavior = {};
  const kase = await openCase({ behavior });
  t.after(() => kase.finish());
  const { net, mounted } = kase;
  await kase.paired();
  net.emit('stream.ready', READY);
  await waitFor(() => net.log.some((call) => call.path === '/api/tasks/tsk_1'), 'the first organizer read-back settling');

  // Baseline: the retry path keeps taskId/createdAt and bumps version/attempt
  // (frozen §3.1), so the snapshot installs v2 succeeded of the SAME task.
  behavior.snapshot = () => ({ ...snapshotBody(kase.world),
    contractVersion: 'web-api/2',
    highWatermark: 7,
    lastEventId: 'inst_a:7',
    epoch: 'inst_a',
    agentConcurrency: 3,
    tasks: [wireTask({ taskId: 'tsk_1', state: 'succeeded', version: 2, attemptCount: 1 })],
  });
  net.emit('stream.reset', RESET);
  await waitFor(() => mounted.organizer.run?.wireVersion === 2 && mounted.organizer.run?.status === 'succeeded', 'the terminal baseline installing');

  // The legal retry: v3 running of the same task arrives on a read-back.
  const retryRow = wireTask({ taskId: 'tsk_1', state: 'running', version: 3, attemptCount: 2 });
  behavior.nextTaskList = [retryRow];
  behavior.nextTaskRow = retryRow;
  net.emit('candidate.changed', { ...HINT, objectType: 'candidate' });
  await waitFor(() => mounted.organizer.run?.wireVersion === 3 && mounted.organizer.run?.status === 'running', 'the legitimate newer attempt being displayed');

  // A late async response still serving v2 must not roll the display back.
  const staleRow = wireTask({ taskId: 'tsk_1', state: 'succeeded', version: 2, attemptCount: 1 });
  behavior.nextTaskList = [staleRow];
  behavior.nextTaskRow = staleRow;
  const baseline = net.lastSeq();
  net.emit('candidate.changed', { ...HINT, objectType: 'candidate' });
  await waitFor(() => net.callsAfter(baseline, '/api/tasks/tsk_1').length > 0, 'the stale read being served', 2000);
  await settle(300);
  assert.equal(mounted.organizer.run?.wireVersion, 3, 'the stale response did not overwrite the newer authority');
  assert.equal(mounted.organizer.run?.status, 'running');
  await settle(300);
  assert.equal(mounted.organizer.run?.wireVersion, 3);
});

test('a same-epoch snapshot at or below the applied watermark is an old response — never consumed; the committed token is kept', { timeout: 20000 }, async (t) => {
  const behavior = {};
  const kase = await openCase({ behavior });
  t.after(() => kase.finish());
  const { net, mounted } = kase;
  await kase.paired();
  net.emit('stream.ready', READY);
  await waitFor(() => net.log.some((call) => call.path === '/api/tasks/tsk_1'), 'the first organizer read-back settling');

  behavior.snapshot = () => ({ ...snapshotBody(kase.world),
    contractVersion: 'web-api/2',
    highWatermark: 7,
    lastEventId: 'inst_a:7',
    epoch: 'inst_a',
    agentConcurrency: 3,
    tasks: [wireTask({ taskId: 'tsk_1', state: 'running', version: 2, attemptCount: 1 })],
  });
  net.emit('stream.reset', RESET);
  await waitFor(() => mounted.organizer.run?.wireVersion === 2, 'the snapshot baseline installing');
  await waitFor(() => net.streams.length >= 2, 'the resubscribe after the first resync');
  const resub = net.log.filter((call) => call.path === '/api/events').at(-1);
  assert.equal(resub.headers['Last-Event-ID'], 'inst_a:7');

  // A second reset whose snapshot is an OLD async response of the same epoch
  // (watermark 5 ≤ applied 7, task rolled back to v2 cancelled): never
  // consumed, and the subscription restores on the COMMITTED token.
  behavior.snapshot = () => ({ ...snapshotBody(kase.world),
    contractVersion: 'web-api/2',
    highWatermark: 5,
    lastEventId: 'inst_a:5',
    epoch: 'inst_a',
    agentConcurrency: 3,
    tasks: [wireTask({ taskId: 'tsk_1', state: 'cancelled', version: 2, attemptCount: 1 })],
  });
  net.emit('stream.reset', RESET);
  await waitFor(() => net.streams.length >= 3, 'the subscription restoring on the committed token');
  const restore = net.log.filter((call) => call.path === '/api/events').at(-1);
  assert.equal(restore.headers['Last-Event-ID'], 'inst_a:7', 'the old snapshot’s token never displaces the committed token');
  assert.equal(mounted.organizer.run?.status, 'running', 'the stale snapshot’s rolled-back task state was never consumed');
  assert.notEqual(mounted.organizer.run?.status, 'cancelled');
});

test('event-stream loss with a 401 returns to the gate without a reconnect storm; re-pairing subscribes fresh without a token', { timeout: 20000 }, async (t) => {
  const behavior = {};
  const kase = await openCase({ behavior });
  t.after(() => kase.finish());
  const { net, mounted } = kase;
  await kase.paired();

  // Natural stream end, then the reconnect attempt answers 401: the session
  // is lost, the gate returns, and no reconnect loop may follow.
  behavior.nextEventsStatus = 401;
  net.loseStream();
  await waitFor(() => mounted.pairing.paired === false, 'the session loss returning the gate');
  const lostSeq = net.lastSeq();
  await settle(700);
  assert.equal(net.callsAfter(lostSeq, '/api/events').length, 0, 'no reconnect attempt follows the session loss');

  // Re-pairing starts a fresh epoch: no Last-Event-ID token, new stream.
  mounted.pairing.code = '428151';
  assert.equal(await mounted.pairing.pair(), true);
  assert.equal(mounted.pairing.paired, true);
  await waitFor(() => net.log.filter((call) => call.path === '/api/events').length >= 2, 'the fresh subscription');
  const fresh = net.log.filter((call) => call.path === '/api/events').at(-1);
  assert.equal(fresh.headers['Last-Event-ID'], undefined, 'a fresh subscribe after re-pairing carries no stale token');
});

test('the queue display keeps full authority coverage: page walk and exited-unknown/needs-review slots stay visible', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  const behavior = {};
  const kase = await openCase({ world, behavior });
  t.after(() => kase.finish());
  const { net, mounted } = kase;

  // Two pages: the occupied-but-exited states ride the second page, so only
  // a full walk can keep them visible (and they must never pose as 没有任务).
  behavior.taskPages = (cursor) => cursor
    ? {
        contractVersion: 'web-api/2',
        tasks: [
          { ...wireTask({
            taskId: 'tsk_ir',
            type: 'test',
            state: 'needs_review',
            version: 2,
            attemptCount: 1,
            queuePosition: 2,
            failure: { code: 'exit_unconfirmed', message: 'worker exit not confirmed', retryable: 'manual', sideEffectSafety: 'unknown', cause: 'exit_unconfirmed' },
          }), attemptExitState: 'exited_unknown', attemptExitEvidence: JSON.parse(readFileSync(new URL('../fixtures/web-api-v2-client/frozen/task-needs-review-exit-unconfirmed.json', import.meta.url), 'utf8')).attemptExitEvidence },
        ],
        nextCursor: null,
      }
    : {
        contractVersion: 'web-api/2',
        tasks: [
          wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 }),
          wireTask({
            taskId: 'tsk_nr',
            type: 'revise_candidate',
            state: 'needs_review',
            version: 3,
            attemptCount: 1,
            queuePosition: null,
            failure: { code: 'result_exit_unconfirmed', message: 'result staged, exit unconfirmed', retryable: 'manual', sideEffectSafety: 'unknown', cause: 'result_exit_unconfirmed' },
          }),
        ],
        nextCursor: 'cur_page_2',
      };

  await kase.paired();
  const text = await waitFor(
    () => (/(排队中|queued)/.test(mounted.renderedText()) ? mounted.renderedText() : null),
    'the queue rendering',
  );
  assert.ok(text.includes('待核对'), 'the needs_review slot stays visible');
  assert.ok(text.includes('退出未知'), 'the exited-unknown slot stays visible');
  assert.ok(text.includes('organize_text'), 'the first page walked');
  assert.ok(text.includes('test'), 'the second page walked');
  assert.ok(!text.includes('当前没有排队或进行中的整理任务'), 'occupied slots never pose as an empty queue');
});

test('a queue read that started before the epoch flipped can never land (sync-epoch fence)', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  // The in-epoch world task is type `test`; the held response's task is type
  // `organize_text` — the held type can only ever render if the stale-epoch
  // response landed.
  world.tasks = [wireTask({ taskId: 'tsk_1', type: 'test', state: 'queued', version: 1, queuePosition: 1 })];
  const behavior = {};
  let release = null;
  const kase = await openCase({
    world,
    behavior,
    preMount: (net) => {
      release = net.holdNextTasks();
    },
  });
  t.after(() => kase.finish());
  const { net, mounted } = kase;
  await kase.paired();

  net.emit('stream.ready', READY);
  await waitFor(() => net.log.some((call) => call.path === '/api/tasks/tsk_1'), 'the ready read-backs settling');

  // The held response is complete and legal — but the epoch moved before it
  // was released, so the fence must keep it out while the in-epoch read
  // renders.
  release({
    contractVersion: 'web-api/2',
    tasks: [wireTask({ taskId: 'tsk_held', type: 'organize_text', state: 'queued', version: 1, queuePosition: 1 })],
  });
  await waitFor(() => /(排队中|queued)/.test(mounted.renderedText()), 'the in-epoch queue read rendering');
  const text = mounted.renderedText();
  assert.ok(!text.includes('organize_text'), 'the pre-epoch response never landed');
  await settle(400);
  assert.ok(!mounted.renderedText().includes('organize_text'), 'the pre-epoch response cannot land late either');
});
