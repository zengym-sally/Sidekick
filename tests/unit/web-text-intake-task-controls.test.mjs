//! Focused unit regression for the TaskQueue in-page task controls (MAYNE-24
//! W1, r3 plan: docs/reviews/web-text-intake-task-controls-plan-20261110-opencode.md,
//! reviewed composite SHA-256 a67abe96d089a43bc69c31b571f0574c3fc33b0284665dd29c7ac7ff42f7e6ef).
//!
//! Dispatch lineage: coordination comment `01a1c2b2-7a60-73e8-983b-23501f2759b8`
//! (r3 准出派工 UI 实现). The suite drives the REAL compiled TaskQueue.vue
//! through the RECEIVED SSE harness (`../fixtures/web-text-intake/
//! sse-client-harness.mjs`, blob fe2bd6b1, reused READ-ONLY — zero harness
//! bytes changed) inside the real gate composition, and answers only the
//! surfaces the harness does not script (cancel/retry/resolve/result/
//! concurrency) through a TEST-LOCAL fetch wrapper installed ahead of the
//! harness's controlled network. Every response is a legal frozen shape
//! seeded at the transport boundary; no production store is touched and no
//! sync callback is re-implemented.
//!
//! Verification boundary (honest): these faces sign the UI behavior against
//! controlled legal responses. The backend authority/receipt wiring
//! (recovery_items authoritative versions + known receipts) is a separately
//! tracked prerequisite (plan §8.3.4, ZCode recovery-authority line) — a green
//! face here is NOT a real-backend/Pi/end-to-end pass, and the disabled
//! authority-missing state is not a final delivery.
//!
//! a11y/640×900 layout faces are signed with REAL browser DOM + screenshots by
//! tests/fixtures/web-text-intake/task-controls-browser.mjs (task-controls-page
//! fixture) — the minimal renderer cannot sign layout.
//!
//! Case prerequisites (dispatch: 前置单列, each case 20s including cleanup):
//!   - Node >= 24 with the locked dependency tree (vue, pinia, compiler-sfc,
//!     typescript resolved from node_modules) — no browser, no network.
//!   - The real-browser faces additionally need Chrome at the platform
//!     default path (or SIDEKICK_TEST_CHROME) and run OUTSIDE this file.

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

const READY = { contractVersion: 'web-api/2', epoch: 'inst_a', cursor: 0 };
const HINT = { contractVersion: 'web-api/2', epoch: 'inst_a', objectType: 'task', objectId: 'tsk_1' };
const RESET = { contractVersion: 'web-api/2', epoch: 'inst_a', reason: 'cursor_out_of_window' };

const ok = (body, status = 200) => ({ status, body });
const fail = (status, code, message) => ({
  status,
  body: { contractVersion: 'web-api/2', error: { code, message } },
});
const taskReply = (row, status = 200) => ok({ contractVersion: 'web-api/2', task: row }, status);

// --- wire row seeds (legal frozen §3.2/§3.5 forms, transport-boundary only) -

function failedRow({ taskId = 'tsk_f', type = 'revise_candidate', version = 5, attemptCount = 1, code = 'auth_or_config_invalid', retryable = 'manual', message = '模型凭据校验失败，请检查配置。' } = {}) {
  return wireTask({
    taskId, type, state: 'failed', version, attemptCount,
    failure: { code, message, retryable, sideEffectSafety: 'unknown' },
  });
}

function stagedRow({ taskId = 'tsk_sr', version = 3, attemptCount = 1, itemVersion = 2, receipts = [], attemptId } = {}) {
  return {
    ...wireTask({ taskId, type: 'revise_candidate', state: 'needs_review', version, attemptCount }),
    resultPendingExit: true,
    result: { payloadRef: `result://att_${taskId}/payload.json`, kind: 'json' },
    recovery: {
      cause: 'result_exit_unconfirmed',
      itemVersion,
      stagedResult: true,
      sideEffectKnown: false,
      autoResume: false,
      reason: '结果已暂存，worker 退出未确认；恢复扫描确认退出后转人工核对。',
      receipts,
      decisionOptions: ['resume', 'cancel'],
    },
    ...(attemptId !== undefined ? { attemptId } : {}),
  };
}

function plainReviewRow({ taskId = 'tsk_pr', version = 4, itemVersion = 1, receipts = [], options = ['resume', 'cancel'], cause = 'restart_unknown_side_effect' } = {}) {
  return {
    ...wireTask({ taskId, type: 'extract', state: 'needs_review', version, attemptCount: 1 }),
    recovery: {
      cause,
      sideEffectKnown: false,
      autoResume: false,
      reason: '重启时外部副作用结果不明，禁止自动重放。',
      receipts,
      decisionOptions: options,
      ...(itemVersion !== undefined ? { itemVersion } : {}),
    },
  };
}

function exitedUnknownRow({ taskId = 'tsk_eu', version = 2, itemVersion = 1, cancelIntent = false } = {}) {
  return {
    ...wireTask({ taskId, type: 'test', state: 'needs_review', version, attemptCount: 1, queuePosition: null }),
    attemptExitState: 'exited_unknown',
    attemptExitEvidence: JSON.parse(readFileSync(new URL('../fixtures/web-api-v2-client/frozen/task-needs-review-exit-unconfirmed.json', import.meta.url), 'utf8')).attemptExitEvidence,
    cancelIntent,
    recovery: {
      cause: 'exit_unconfirmed',
      itemVersion,
      stagedResult: false,
      sideEffectKnown: false,
      autoResume: false,
      reason: 'worker 退出无法确认，槽位保持占用。',
      receipts: [],
    },
  };
}

const CONCURRENCY_V0 = { contractVersion: 'web-api/2', agentConcurrency: 3, default: 3, version: 0, runningCount: 2, queuedCount: 1 };
const concurrencyPayload = (over = {}) => ({ contractVersion: 'web-api/2', agentConcurrency: 3, default: 3, version: 0, runningCount: 2, queuedCount: 1, ...over });

// --- test-local action layer (the only surfaces the harness leaves open) ----

function installActionLayer(routes) {
  const previous = globalThis.fetch;
  const calls = [];
  const install = async (url, options = {}) => {
    const raw = String(url);
    const q = raw.indexOf('?');
    const path = q === -1 ? raw : raw.slice(0, q);
    const call = {
      seq: calls.length + 1,
      method: options.method ?? 'GET',
      path,
      query: q === -1 ? '' : raw.slice(q + 1),
      body: typeof options.body === 'string' ? JSON.parse(options.body) : null,
    };
    const route = routes.find((route) => route.match(call));
    if (!route) return previous(url, options);
    calls.push(call);
    const answer = await route.reply(call);
    return new Response(JSON.stringify(answer.body ?? null), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  globalThis.fetch = install;
  return {
    calls,
    routes,
    of(suffix) { return calls.filter((call) => call.path.endsWith(suffix)); },
    restore() { if (globalThis.fetch === install) globalThis.fetch = previous; },
  };
}

const POST = (suffix) => (call) => call.method === 'POST' && call.path.endsWith(suffix);
const PUT_CONCURRENCY = (call) => call.method === 'PUT' && call.path.endsWith('/api/settings/agent-concurrency');
const GET_CONCURRENCY = (call) => call.method === 'GET' && call.path.endsWith('/api/settings/agent-concurrency');
const GET_RESULT_EXACT = (taskId) => (call) => call.method === 'GET' && call.path.endsWith(`/api/tasks/${taskId}/result`) && !call.query.includes('offset=');
const GET_RESULT_SEGMENT = (taskId) => (call) => call.method === 'GET' && call.path.endsWith(`/api/tasks/${taskId}/result`) && call.query.includes('offset=');

/// Deferred reply: capture the resolver so a case orders the transport
/// deterministically (a response that has not been released cannot land).
function deferred(answerProvider) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    reply: async () => { await gate; return answerProvider(); },
    release() { release(); },
  };
}

// --- DOM access over the harness's real compiled renderer -------------------

function elsOf(mounted) {
  const out = [];
  const visit = (vnode) => {
    if (!vnode || typeof vnode !== 'object') return;
    if (vnode.component) { visit(vnode.component.subTree); return; }
    if (vnode.el) out.push(vnode.el);
    if (Array.isArray(vnode.children)) for (const child of vnode.children) visit(child);
  };
  visit(mounted.app._instance.subTree);
  return out;
}

const buttonsOf = (mounted) => elsOf(mounted).filter((el) => el.type === 'button');
const byAria = (mounted, label) => buttonsOf(mounted).find((el) => el.props['aria-label'] === label) ?? null;
const inputsOf = (mounted) => elsOf(mounted).filter((el) => el.type === 'input');
const numberInputOf = (mounted) => inputsOf(mounted).find((el) => el.props.type === 'number');
const labelsOf = (mounted, needle) => elsOf(mounted).filter((el) => el.type === 'label').find((el) => textOf(el).includes(needle));
const labelInput = (label) => label.children.find((child) => child.type === 'input');
const textOf = (el) => {
  const parts = [];
  const visit = (node) => {
    if (node.text) parts.push(node.text);
    for (const child of node.children ?? []) visit(child);
  };
  visit(el);
  return parts.join('');
};
const click = (button) => button.props.onClick();
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

/// The persisted '中文abcd' (10 UTF-8 bytes) split at byte boundaries across
/// maxSegmentBytes=4 segments — the split cuts inside both multibyte chars,
/// so a stream decoder is the only correct assembly.
const SEG_TEXT = '中文abcd';
const SEG_TOTAL = Buffer.byteLength(SEG_TEXT);
const SEG_LIMIT = 4;

function segmentAnswer(taskId, offset, limit, total) {
  const bytes = Buffer.from(SEG_TEXT, 'utf8');
  const slice = bytes.subarray(offset, Math.min(offset + limit, bytes.length));
  const done = offset + slice.length >= bytes.length;
  return ok({
    contractVersion: 'web-api/2', taskId, outcome: 'succeeded', failure: null,
    offset, limit, bytesReturned: slice.length, totalBytes: total,
    nextOffset: done ? null : offset + slice.length, done,
    payloadBase64: b64(slice),
  });
}

// --- per-case scaffolding ---------------------------------------------------

async function openControls({ world = defaultWorld(), behavior = {}, routes = [] } = {}) {
  const net = installControlledNetwork(world, behavior);
  const allRoutes = [...routes];
  if (!allRoutes.some((route) => route.match === GET_CONCURRENCY)) {
    // The queue reads the concurrency view on mount and on the seam; the
    // harness leaves this surface open, so the default answer lives here.
    allRoutes.push({ match: GET_CONCURRENCY, reply: async () => ok(concurrencyPayload()) });
  }
  const actions = installActionLayer(allRoutes);
  const kase = { world, behavior, net, actions, routes: allRoutes, mounted: null, finished: false };
  kase.finish = async () => {
    if (kase.finished) return;
    kase.finished = true;
    if (kase.mounted) {
      try { kase.mounted.unmount(); } catch { /* the gate's unmount is primary */ }
      kase.mounted.pairing.dispose();
      kase.mounted = null;
    }
    actions.restore();
    net.restore();
    await settle(25);
  };
  kase.mounted = mountGate();
  kase.paired = async () => {
    await waitFor(() => kase.mounted.pairing.ready && kase.mounted.pairing.paired, 'the gate pairing itself');
    await waitFor(() => net.streams.length > 0 || net.eventSources.length > 0, 'the event subscription opening');
    await settle(20);
    return kase;
  };
  return kase;
}

/// The invalidation seam: a legal task.changed hint dispatches the queue's
/// own fenced re-read (the same pipeline a real frame drives). The cursor
/// must be ABOVE the applied watermark or the pairing store drops the frame.
function invalidate(net, objectId = 'tsk_1', cursor = 1) {
  const baseline = net.lastSeq();
  net.emit('task.changed', { ...HINT, cursor, objectVersion: cursor + 1, taskState: 'running', objectId }, `inst_a:${cursor}`);
  return baseline;
}

/// Wait until the queue's own limit=100 list read has COMPLETED (the fence
/// sweep runs at install time, so counting the read is the deterministic
/// "refresh landed" marker — display text alone can be pre-install).
function listReads(net) {
  return net.callsAfter(0, '/api/tasks').filter((call) => call.path === '/api/tasks' && call.query.includes('limit=100')).length;
}

async function waitForRefetch(net, baseline, what = 'the fence re-read landing', limitMs = 450) {
  await waitFor(() => listReads(net) > baseline, what, limitMs);
  await settle(30);
}

test('U1: failed rows are visible with the manual retry entry; a retry round-trip re-queues and the attempt count moves only via the fenced read-back', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [
    wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 }),
    failedRow({ taskId: 'tsk_f', type: 'revise_candidate' }),
    failedRow({ taskId: 'tsk_ab', type: 'extract', code: 'model_request_failed', retryable: 'auto_backoff', message: '模型请求失败，将自动退避重试。' }),
    failedRow({ taskId: 'tsk_nn', type: 'test', code: 'worker_lost', retryable: 'none', message: 'worker 丢失且不可重试。' }),
  ];
  let retryCalls = 0;
  const kase = await openControls({
    world,
    routes: [{
      match: POST('/api/tasks/tsk_f/retry'),
      reply: async () => {
        retryCalls += 1;
        return taskReply(wireTask({ taskId: 'tsk_f', type: 'revise_candidate', state: 'queued', version: 6, attemptCount: 1, queuePosition: 1 }), 202);
      },
    }],
  });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();

  const text = await waitFor(() => (mounted.renderedText().includes('失败·无法重试') ? mounted.renderedText() : null), 'the failed rows rendering');
  assert.ok(text.includes('失败·将自动重试'), 'the auto_backoff row renders its no-manual-entry note');
  assert.ok(text.includes('auth_or_config_invalid'), 'the failure envelope (code) is visible');
  assert.ok(text.includes('第 1 次尝试'), 'the attempt count is displayed');
  assert.equal((text.match(/失败·无法重试/g) ?? []).length, 1, 'the no-retry note renders ONLY on the none-retryable failed row (never on queued/review/recovery rows)');
  assert.equal((text.match(/失败·将自动重试/g) ?? []).length, 1, 'the auto-backoff note renders ONLY on the auto_backoff row');
  assert.ok(byAria(mounted, '重试失败任务 revise_candidate'), 'the manual row carries the retry entry');
  assert.equal(byAria(mounted, '重试失败任务 extract'), null, 'the auto_backoff row has no retry entry');
  assert.equal(byAria(mounted, '重试失败任务 test'), null, 'the none row has no retry entry');
  const rerun = byAria(mounted, '用新配置重跑整理任务 revise_candidate');
  assert.ok(rerun, 'the config-change row carries the rerun entry');
  assert.equal(rerun.props.disabled, true, 'the rerun entry is disabled while no saved new revision is wired (store-not-ready degradation)');
  assert.equal(byAria(mounted, '用新配置重跑整理任务 extract'), null, 'non-config failure codes carry no rerun entry');

  click(byAria(mounted, '重试失败任务 revise_candidate'));
  const call = await waitFor(() => actions.of('/retry')[0] ?? null, 'the retry POST');
  assert.deepEqual(call.body, { expectedVersion: 5 }, 'retry carries the row task version and NEVER a client-built config revision');
  // The 202 carries no attempt +1; the fenced read-back after the scheduler
  // claim is the only thing that may display it (plan §4.2 timing).
  world.tasks = [wireTask({ taskId: 'tsk_f', type: 'revise_candidate', state: 'queued', version: 6, attemptCount: 2, queuePosition: 1 })];
  await waitFor(() => mounted.renderedText().includes('排队中') && mounted.renderedText().includes('第 2 次尝试'), 'the fenced re-read installing the re-queued row', 450);
  assert.ok(!mounted.renderedText().includes('auth_or_config_invalid'), 'the failure envelope is gone once re-queued');
  assert.equal(retryCalls, 1);
  assert.ok(net.callsAfter(call.seq, '/api/tasks').some((c) => c.path === '/api/tasks'), 'the action success ran the fenced read-back');
});

test('U1 red / 409 discipline: a version_conflict retry re-reads and re-presents, and the decision action is never auto-replayed', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [failedRow({ taskId: 'tsk_f', type: 'revise_candidate' })];
  const kase = await openControls({
    world,
    routes: [{ match: POST('/api/tasks/tsk_f/retry'), reply: async () => fail(409, 'version_conflict', '任务版本已过期。') }],
  });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();

  click(byAria(mounted, '重试失败任务 revise_candidate'));
  await waitFor(() => actions.of('/retry').length > 0, 'the retry POST');
  await waitFor(() => mounted.renderedText().includes('版本已过期'), 'the inline conflict hint rendering', 450);
  assert.equal(actions.of('/retry').length, 1, 'no automatic resend of the decision action');
  assert.ok(net.callsAfter(actions.of('/retry')[0].seq, '/api/tasks').some((call) => call.path === '/api/tasks'), 'the conflict fired the fenced re-read');
  await settle(1100);
  assert.equal(actions.of('/retry').length, 1, 'the poll never replays the decision action');
});

test('U3/U4: staged-result verification with the receipt ACK gate — resume stays disabled until every verifiable receipt is checked, and the ACK list excludes non-verifiable receipts', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [
    wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 }),
    stagedRow({
      taskId: 'tsk_sr', version: 3, itemVersion: 2,
      receipts: [
        { receiptId: 'rc_a', kind: 'lark_message_send', verifiable: true, recordedAt: '2026-11-10T10:00:00.000Z' },
        { receiptId: 'rc_b', kind: 'file_write', verifiable: false, recordedAt: '2026-11-10T10:00:01.000Z' },
      ],
    }),
  ];
  const kase = await openControls({
    world,
    routes: [{
      match: POST('/api/tasks/tsk_sr/resolve'),
      reply: async (call) => {
        assert.deepEqual(call.body, { expectedVersion: 2, decision: 'resume', acknowledgedReceipts: ['rc_a'] });
        return taskReply(wireTask({ taskId: 'tsk_sr', type: 'revise_candidate', state: 'succeeded', version: 4, attemptCount: 1 }), 202);
      },
    }],
  });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();

  const toggle = await waitFor(() => byAria(mounted, '核对整理任务 revise_candidate'), 'the review toggle rendering');
  assert.equal(toggle.props['aria-expanded'], 'false');
  click(toggle);
  await waitFor(() => mounted.renderedText().includes('暂存成功结局'), 'the review area rendering');
  const reviewText = mounted.renderedText();
  assert.ok(reviewText.includes('待核对'), 'the exited_confirmed needs_review label');
  assert.ok(reviewText.includes('确认回执 rc_a'), 'the verifiable receipt is listed');
  assert.ok(reviewText.includes('无需确认'), 'the non-verifiable receipt is marked as not required');

  const submit = byAria(mounted, '提交暂存结果整理任务 revise_candidate');
  assert.ok(submit, 'the staged submit entry renders');
  assert.equal(submit.props.disabled, true, 'resume is disabled before the verifiable receipt is checked');
  const inputA = labelInput(labelsOf(mounted, '确认回执 rc_a'));
  const inputB = labelInput(labelsOf(mounted, 'rc_b'));
  assert.ok(inputA && inputB, 'both receipts render behind explicit labels');
  assert.ok(!inputA.props.disabled, 'the verifiable receipt checkbox is enabled');
  assert.equal(inputB.props.disabled, true, 'the non-verifiable receipt checkbox is disabled (nothing to confirm)');

  inputA.props.onChange({ target: { checked: true } });
  await waitFor(() => byAria(mounted, '提交暂存结果整理任务 revise_candidate').props.disabled === false, 'the ACK gate opening after the verifiable receipt is checked');
  click(byAria(mounted, '提交暂存结果整理任务 revise_candidate'));
  await waitFor(() => actions.of('/resolve').length > 0, 'the resolve POST');
  // Terminal succeeded leaves the display set; the fenced read-back shows the
  // queue without the row and the live region announces the outcome.
  world.tasks = [wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 })];
  await waitFor(() => mounted.renderedText().includes('动作已完成'), 'the row leaving the display via the fenced read-back', 450);
  assert.ok(!mounted.renderedText().includes('暂存成功结局'), 'the staged row left the display');
  assert.equal(actions.of('/resolve').length, 1);
  assert.ok(net.callsAfter(actions.of('/resolve')[0].seq, '/api/tasks').some((c) => c.path === '/api/tasks'), 'the action success ran the fenced read-back');
});

test('U3 cancel decision: 放弃 sends decision=cancel with an empty ACK list and requires no receipt confirmation', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [stagedRow({
    taskId: 'tsk_sc', version: 3, itemVersion: 2,
    receipts: [{ receiptId: 'rc_x', kind: 'lark_message_send', verifiable: true }],
  })];
  const kase = await openControls({
    world,
    routes: [{
      match: POST('/api/tasks/tsk_sc/resolve'),
      reply: async (call) => {
        assert.deepEqual(call.body, { expectedVersion: 2, decision: 'cancel', acknowledgedReceipts: [] });
        return taskReply(wireTask({ taskId: 'tsk_sc', type: 'revise_candidate', state: 'cancelled', version: 4, attemptCount: 1 }));
      },
    }],
  });
  t.after(() => kase.finish());
  const { mounted, actions } = kase;
  await kase.paired();

  click(await waitFor(() => byAria(mounted, '核对整理任务 revise_candidate'), 'the review toggle rendering'));
  await waitFor(() => mounted.renderedText().includes('暂存成功结局'), 'the review area rendering');
  const abandon = byAria(mounted, '放弃暂存结果整理任务 revise_candidate');
  assert.equal(abandon.props.disabled, false, 'cancel does not require receipt confirmation');
  click(abandon);
  await waitFor(() => actions.of('/resolve').length > 0, 'the resolve POST');
  world.tasks = [];
  await waitFor(() => mounted.renderedText().includes('当前没有排队或进行中的整理任务'), 'the cancelled row leaving the display', 450);
});

test('U4 authority prerequisite: missing authoritative itemVersion disables the resolve entries with the inline hint, fires a bounded re-read, and never sends a fallback resolve', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  // Legal-shape rows that mirror the registered backend gap (plan §2.3): the
  // exited_confirmed recovery object WITHOUT the authoritative itemVersion
  // (the key must be truly ABSENT — passing `itemVersion: undefined` would
  // fire the builder's default and defeat the face), and a second row with
  // the itemVersion present but whose receipts member is not an array.
  const degradedRow = plainReviewRow({ taskId: 'tsk_am' });
  delete degradedRow.recovery.itemVersion;
  const nonArrayReceiptsRow = plainReviewRow({ taskId: 'tsk_ar', cause: 'cancel_unknown_side_effect' });
  nonArrayReceiptsRow.recovery.receipts = 'not-an-array';
  world.tasks = [degradedRow, nonArrayReceiptsRow];
  const kase = await openControls({ world });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();
  await settle(200);

  const text = await waitFor(() => (mounted.renderedText().includes('权威核对条目缺失') ? mounted.renderedText() : null), 'the inline authority hint');
  assert.ok(text.includes('权威核对条目缺失，暂不可处置'), 'both degraded rows show the inline hint');
  // Expand BOTH review areas: with the authority missing, no resolve entry
  // may exist anywhere (a fallback-1 / fallback-empty mutant would render it).
  const toggles = buttonsOf(mounted).filter((button) => button.props['aria-label'] === '核对整理任务 extract');
  assert.equal(toggles.length, 2, 'both degraded rows expose their verify toggle');
  for (const toggle of toggles) click(toggle);
  await waitFor(() => mounted.renderedText().includes('重启时外部副作用结果不明'), 'the first review area rendering');
  assert.equal(byAria(mounted, '恢复执行整理任务 extract'), null, 'no resume entry renders without full authority (a ?? 1 fallback mutant renders it here)');
  assert.equal(byAria(mounted, '放弃取消整理任务 extract'), null, 'no cancel-decision entry renders without full authority (a receipts ?? [] fallback mutant renders it here)');
  assert.equal(actions.of('/resolve').length, 0, 'NO resolve request is ever sent for a missing-authority row (a fallback-1 client would send one here)');
  const atRest = listReads(net);
  await settle(1200);
  assert.ok(listReads(net) - atRest <= 1, 'the one-shot re-read does not loop (at most the regular poll ran)');
  assert.equal(actions.of('/resolve').length, 0, 'still zero resolve requests');
});

test('U5: exited_unknown occupies its slot read-only; after the recovery-scan reclaim the verify entries appear and resolve binds the reclaimed item version', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [exitedUnknownRow({ taskId: 'tsk_eu', cancelIntent: true })];
  const kase = await openControls({
    world,
    routes: [{
      match: POST('/api/tasks/tsk_eu/resolve'),
      reply: async (call) => {
        assert.deepEqual(call.body, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
        return taskReply(wireTask({ taskId: 'tsk_eu', type: 'test', state: 'queued', version: 3, attemptCount: 2, queuePosition: 1 }), 202);
      },
    }],
  });
  t.after(() => kase.finish());
  const { mounted, actions } = kase;
  await kase.paired();

  const text = await waitFor(() => (mounted.renderedText().includes('退出未知·待系统核实') ? mounted.renderedText() : null), 'the exited_unknown rendering');
  assert.ok(text.includes('占 1 个执行槽，等待系统核实退出'), 'the slot-occupied marker');
  assert.ok(text.includes('取消意图待核实'), 'the pending cancel intent is surfaced');
  assert.equal(byAria(mounted, '核对整理任务 test'), null, 'no verify entry while the exit is unconfirmed');
  assert.equal(actions.of('/resolve').length, 0, 'no UI path sends resolve before the reclaim');
  await settle(300);
  assert.equal(actions.of('/resolve').length, 0, 'still zero resolve requests before the reclaim');

  // The recovery scan reclaims the attempt: exited_confirmed + decisionOptions.
  const baseline = listReads(kase.net);
  world.tasks = [plainReviewRow({ taskId: 'tsk_eu', version: 3, itemVersion: 1, cause: 'exit_unconfirmed' })];
  invalidate(kase.net, 'tsk_eu');
  await waitForRefetch(kase.net, baseline, 'the reclaimed row installing');
  const toggle = await waitFor(() => byAria(mounted, '核对整理任务 extract'), 'the verify entry after the reclaim', 2000);
  assert.ok(!mounted.renderedText().includes('占 1 个执行槽'), 'the slot marker is gone once the exit is confirmed');
  click(toggle);
  await waitFor(() => mounted.renderedText().includes('退出已确认，无暂存结局'), 'the non-staged review face');
  const resume = byAria(mounted, '恢复执行整理任务 extract');
  assert.equal(resume.props.disabled, false, 'the reclaimed row is resolvable with the authoritative item version');
  click(resume);
  await waitFor(() => actions.of('/resolve').length > 0, 'the resolve POST binding itemVersion 1');
});

test('U6: the concurrency view reads on mount, installs the PUT response locally (version+counts), fires the fenced task refresh, and 409 keeps the draft without replay', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 })];
  const concurrency = { ...CONCURRENCY_V0 };
  const getScript = [];
  const putScript = [];
  const kase = await openControls({
    world,
    routes: [
      { match: GET_CONCURRENCY, reply: async () => (getScript.length ? getScript.shift()() : ok({ ...concurrency })) },
      {
        match: PUT_CONCURRENCY,
        reply: async () => {
          const next = putScript.shift();
          if (!next) throw new Error('unexpected concurrency PUT');
          return next();
        },
      },
    ],
  });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();

  const toggle = await waitFor(() => byAria(mounted, '并发设置'), 'the concurrency entry rendering');
  assert.equal(toggle.props['aria-expanded'], 'false');
  click(toggle);
  await waitFor(() => mounted.renderedText().includes('当前 3 · 缺省 3 · 版本 0'), 'the mounted concurrency view installing');
  assert.ok(mounted.renderedText().includes('运行中 2'), 'the running count renders');
  let input = numberInputOf(mounted);
  assert.ok(input, 'the concurrency number input renders');
  input.props.onInput({ target: { value: '2' } });
  putScript.push(() => {
    Object.assign(concurrency, { agentConcurrency: 2, version: 1, runningCount: 2 });
    return ok(concurrencyPayload({ agentConcurrency: 2, version: 1, runningCount: 2 }));
  });
  click(byAria(mounted, '应用并发设置'));
  const put = await waitFor(() => actions.calls.find((call) => call.method === 'PUT') ?? null, 'the concurrency PUT');
  assert.deepEqual(put.body, { agentConcurrency: 2, expectedVersion: 0 }, 'the PUT carries the settings version (never a task or application-settings version)');
  await waitFor(() => mounted.renderedText().includes('当前 2 · 缺省 3 · 版本 1'), 'the PUT response installing as the local view', 450);
  assert.equal(numberInputOf(mounted).props.value, '', 'the draft clears after a successful install');
  assert.ok(net.callsAfter(put.seq, '/api/tasks').some((call) => call.path === '/api/tasks'), 'the write triggered the fenced task refresh');

  // 409: re-read + keep the draft, never blind replay.
  input = numberInputOf(mounted);
  input.props.onInput({ target: { value: '1' } });
  putScript.push(() => fail(409, 'version_conflict', '设置版本已过期。'));
  getScript.push(() => ok(concurrencyPayload({ agentConcurrency: 1, version: 2 })));
  click(byAria(mounted, '应用并发设置'));
  await waitFor(() => mounted.renderedText().includes('设置已被其他窗口修改'), 'the 409 hint', 450);
  assert.equal(actions.calls.filter((call) => call.method === 'PUT').length, 2, 'no automatic PUT replay');
  assert.equal(numberInputOf(mounted).props.value, '1', 'the user draft survives the 409 re-read');
  await waitFor(() => mounted.renderedText().includes('当前 1 · 缺省 3 · 版本 2'), 'the fenced re-read converging the view', 450);

  // Out-of-range input is corrected in place and never sent.
  input = numberInputOf(mounted);
  input.props.onInput({ target: { value: '33' } });
  click(byAria(mounted, '应用并发设置'));
  await waitFor(() => mounted.renderedText().includes('已就地纠正'), 'the in-place input correction');
  assert.equal(numberInputOf(mounted).props.value, '32', 'the input clamps to the 1..32 bound');
  assert.equal(actions.calls.filter((call) => call.method === 'PUT').length, 2, 'no request leaves the page for an out-of-range value');

  // Downscale semantics: running above the new limit shows the drain hint.
  input = numberInputOf(mounted);
  input.props.onInput({ target: { value: '1' } });
  putScript.push(() => ok(concurrencyPayload({ agentConcurrency: 1, version: 3, runningCount: 3 })));
  click(byAria(mounted, '应用并发设置'));
  await waitFor(() => mounted.renderedText().includes('下调不中断正在执行的任务'), 'the downscale drain hint', 450);
  assert.equal(actions.calls.filter((call) => call.method === 'PUT').length, 3, 'exactly the three scripted PUTs happened');
});

test('§11.2 c1+c3: the concurrency view installs under ONE shared ownership — a superseded PUT (lower version) and an equal-version late PUT cannot overwrite the installed counts', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 })];
  const concurrency = { ...CONCURRENCY_V0 };
  const deferredPut = deferred(() => ok(concurrencyPayload({ agentConcurrency: 2, version: 1, runningCount: 9, queuedCount: 0 })));
  const latePut = deferred(() => ok(concurrencyPayload({ agentConcurrency: 2, version: 2, runningCount: 99, queuedCount: 0 })));
  const putScript = [];
  const kase = await openControls({
    world,
    routes: [
      { match: GET_CONCURRENCY, reply: async () => ok({ ...concurrency }) },
      {
        match: PUT_CONCURRENCY,
        reply: async () => {
          const next = putScript.shift();
          if (!next) throw new Error('unexpected concurrency PUT');
          return next();
        },
      },
    ],
  });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();
  click(await waitFor(() => byAria(mounted, '并发设置'), 'the concurrency entry'));
  await waitFor(() => mounted.renderedText().includes('当前 3 · 缺省 3 · 版本 0'), 'the base view');

  // c1: the PUT (older view ticket) is still in flight when a newer GET
  // installs v2 — the PUT's success response must be discarded and converge
  // through the unified re-read, never overwrite the counts.
  let input = numberInputOf(mounted);
  input.props.onInput({ target: { value: '2' } });
  putScript.push(deferredPut.reply);
  click(byAria(mounted, '应用并发设置'));
  await waitFor(() => actions.calls.some((call) => call.method === 'PUT'), 'the in-flight PUT');
  Object.assign(concurrency, { agentConcurrency: 2, version: 2, runningCount: 5, queuedCount: 3 });
  invalidate(net);
  await waitFor(() => mounted.renderedText().includes('版本 2') && mounted.renderedText().includes('运行中 5'), 'the newer GET installing v2', 450);
  deferredPut.release();
  await waitFor(() => actions.of('/api/settings/agent-concurrency').length >= 3, 'the discarded PUT converging through the unified re-read', 450);
  await settle(120);
  const text1 = mounted.renderedText();
  assert.ok(text1.includes('运行中 5'), 'the superseded PUT response (running 9) never installed');
  assert.ok(text1.includes('版本 2'), 'the view stays at the newer version');

  // c3: an equal-version late PUT (older ticket than the installed GET)
  // cannot overwrite the newer install either — observed on the actual
  // displayed counts.
  input = numberInputOf(mounted);
  input.props.onInput({ target: { value: '2' } });
  putScript.push(latePut.reply);
  click(byAria(mounted, '应用并发设置'));
  const putCount = actions.calls.filter((call) => call.method === 'PUT').length;
  await waitFor(() => actions.calls.filter((call) => call.method === 'PUT').length === putCount, 'the equal-version PUT in flight', 200);
  Object.assign(concurrency, { agentConcurrency: 2, version: 2, runningCount: 7 });
  invalidate(net, 'tsk_1', 5);
  await waitFor(() => mounted.renderedText().includes('运行中 7'), 'the newest GET installing running=7', 450);
  latePut.release();
  await settle(250);
  assert.ok(mounted.renderedText().includes('运行中 7'), 'the equal-version late PUT (running 99) never overwrote the install');
  assert.ok(mounted.renderedText().includes('版本 2'), 'the view stays at the equal newer version');

  // Same epoch, NEWEST ticket, but a LOWER settings version: never installs
  // (§11.2) — a watermark-removal mutant would show running 55 at version 1.
  Object.assign(concurrency, { agentConcurrency: 1, version: 1, runningCount: 55 });
  invalidate(net, 'tsk_1', 7);
  await settle(200);
  const text2 = mounted.renderedText();
  assert.ok(text2.includes('运行中 7'), 'the same-epoch lower-version response never installed');
  assert.ok(text2.includes('版本 2'), 'the watermark kept the newer version displayed');
});

test('§11.2 c2: interleaved GET/PUT under one view ownership — the older PUT cannot beat the newer GET even though the keys differ', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 })];
  const concurrency = { ...CONCURRENCY_V0 };
  const deferredPut = deferred(() => ok(concurrencyPayload({ agentConcurrency: 1, version: 1, runningCount: 9, queuedCount: 0 })));
  const putScript = [];
  const kase = await openControls({
    world,
    routes: [
      { match: GET_CONCURRENCY, reply: async () => ok({ ...concurrency }) },
      {
        match: PUT_CONCURRENCY,
        reply: async () => {
          const next = putScript.shift();
          if (!next) throw new Error('unexpected concurrency PUT');
          return next();
        },
      },
    ],
  });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();
  click(await waitFor(() => byAria(mounted, '并发设置'), 'the concurrency entry'));
  await waitFor(() => mounted.renderedText().includes('当前 3 · 缺省 3 · 版本 0'), 'the base view');
  const input = numberInputOf(mounted);
  input.props.onInput({ target: { value: '1' } });
  putScript.push(deferredPut.reply);
  click(byAria(mounted, '应用并发设置'));
  await waitFor(() => actions.calls.some((call) => call.method === 'PUT'), 'the in-flight PUT');

  // The GET may interleave while the PUT is in flight (separate keys, shared
  // install ownership): a mutual-exclusion mutant would skip this GET and let
  // the PUT response install — the observed counts pin which one landed.
  Object.assign(concurrency, { agentConcurrency: 2, version: 2, runningCount: 6 });
  invalidate(net);
  await waitFor(() => mounted.renderedText().includes('版本 2') && mounted.renderedText().includes('运行中 6'), 'the interleaved GET installing', 450);
  deferredPut.release();
  await settle(200);
  const text = mounted.renderedText();
  assert.ok(text.includes('运行中 6'), 'the newer GET counts survived the older PUT response');
  assert.ok(text.includes('版本 2'), 'the view stays at the newer settings version');
  assert.equal(byAria(mounted, '应用并发设置').props.disabled, false, 'the write pending cleared (only by its own continuation path)');
});

test('§11.2 c4: after the epoch changes the watermark baseline is rebuilt — a legal lower settings version installs again', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 })];
  const concurrency = { ...CONCURRENCY_V0 };
  const kase = await openControls({
    world,
    behavior: {},
    routes: [{ match: GET_CONCURRENCY, reply: async () => ok({ ...concurrency }) }],
  });
  t.after(() => kase.finish());
  const { mounted, net, behavior } = kase;
  await kase.paired();
  click(await waitFor(() => byAria(mounted, '并发设置'), 'the concurrency entry'));
  await waitFor(() => mounted.renderedText().includes('版本 0'), 'the base view');

  // A foreign-epoch crossing resolves through the real snapshot pipeline; the
  // new epoch must re-baseline: the lower legal version installs.
  behavior.snapshot = () => ({ ...snapshotBody(world),
    contractVersion: 'web-api/2', highWatermark: 4, lastEventId: 'inst_b:4', epoch: 'inst_b',
    agentConcurrency: 3,
    tasks: [wireTask({ taskId: 'tsk_b', type: 'test', state: 'running', version: 1 })],
  });
  net.emit('stream.reset', RESET);
  await waitFor(() => mounted.pairing.syncEpoch === 'inst_b', 'the epoch adopting via the snapshot');
  Object.assign(concurrency, { agentConcurrency: 1, version: 1, runningCount: 1 });
  invalidate(net, 'tsk_b', 5);
  await waitFor(() => mounted.renderedText().includes('当前 1 · 缺省 3 · 版本 1'), 'the lower legal version installing in the new epoch', 450);
});

test('U9: duplicate in-flight clicks are ignored, an epoch flip drops the old continuation (no stale error), and a response after unmount writes nothing', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [failedRow({ taskId: 'tsk_f', type: 'revise_candidate' })];
  const deferredRetry = deferred(() => fail(409, 'version_conflict', '任务版本已过期。'));
  const kase = await openControls({
    world,
    routes: [{ match: POST('/api/tasks/tsk_f/retry'), reply: deferredRetry.reply }],
  });
  t.after(() => kase.finish());
  const { mounted, net, behavior, actions } = kase;
  await kase.paired();

  // Duplicate click while in flight: exactly one request, the row shows busy.
  click(byAria(mounted, '重试失败任务 revise_candidate'));
  await waitFor(() => actions.of('/retry').length === 1, 'the first retry POST');
  click(byAria(mounted, '重试失败任务 revise_candidate'));
  await settle(60);
  assert.equal(actions.of('/retry').length, 1, 'the duplicate click never enqueued a second request');
  assert.equal(elsOf(mounted).find((el) => el.type === 'li')?.props['aria-busy'], 'true', 'the row exposes its in-flight state');

  // The epoch flips while the click is in flight: the old continuation is
  // dead — the (conflict) response must NOT render a stale error and the
  // pending clears wholesale with the epoch watch.
  behavior.snapshot = () => ({ ...snapshotBody(world),
    contractVersion: 'web-api/2', highWatermark: 4, lastEventId: 'inst_b:4', epoch: 'inst_b',
    agentConcurrency: 3,
    tasks: [wireTask({ taskId: 'tsk_b', type: 'test', state: 'running', version: 1 })],
  });
  net.emit('stream.reset', RESET);
  await waitFor(() => mounted.pairing.syncEpoch === 'inst_b', 'the epoch adopting');
  assert.equal(elsOf(mounted).find((el) => el.type === 'li')?.props['aria-busy'], undefined, 'pending cleared wholesale on the epoch flip');
  deferredRetry.release();
  await settle(120);
  assert.ok(!mounted.renderedText().includes('版本已过期'), 'the stale continuation never rendered its error');
  assert.equal(actions.of('/retry').length, 1, 'no replay followed the epoch flip');

  // Unmount with a response still unreleased: the continuation writes nothing
  // and no unhandled rejection survives cleanup.
  const deferredRetry2 = deferred(() => taskReply(wireTask({ taskId: 'tsk_f2', type: 'extract', state: 'queued', version: 3 })));
  kase.routes.push({ match: POST('/api/tasks/tsk_f2/retry'), reply: deferredRetry2.reply });
  world.tasks = [failedRow({ taskId: 'tsk_f2', type: 'extract', version: 2 })];
  click(await waitFor(() => byAria(mounted, '重试失败任务 extract'), 'the new-epoch row rendering', 2500));
  await waitFor(() => actions.of('/retry').length === 2, 'the second retry POST');
  kase.mounted.unmount();
  kase.mounted.pairing.dispose();
  kase.mounted = null;
  deferredRetry2.release();
  await settle(120);
  assert.equal(actions.of('/retry').length, 2, 'the unmounted continuation sent nothing further');
});

test('U10: inline staged results render the FULL payload before submission and never substitute a 发布后再读 wording', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [stagedRow({ taskId: 'tsk_sr', version: 3, itemVersion: 2, receipts: [] })];
  const payload = '第一段候选内容。\n第二段候选内容。';
  const kase = await openControls({
    world,
    routes: [
      {
        match: GET_RESULT_EXACT('tsk_sr'),
        reply: async () => ok({
          contractVersion: 'web-api/2', taskId: 'tsk_sr', outcome: 'succeeded', kind: 'json',
          totalBytes: Buffer.byteLength(payload), maxInlineBytes: 65536, maxSegmentBytes: 16384,
          inline: true, payload, failure: null,
        }),
      },
      {
        match: POST('/api/tasks/tsk_sr/resolve'),
        reply: async (call) => {
          assert.deepEqual(call.body, { expectedVersion: 2, decision: 'resume', acknowledgedReceipts: [] });
          return taskReply(wireTask({ taskId: 'tsk_sr', type: 'revise_candidate', state: 'succeeded', version: 4, attemptCount: 1 }), 202);
        },
      },
    ],
  });
  t.after(() => kase.finish());
  const { mounted, actions } = kase;
  await kase.paired();

  click(await waitFor(() => byAria(mounted, '核对整理任务 revise_candidate'), 'the review toggle'));
  await waitFor(() => mounted.renderedText().includes('暂存成功结局'), 'the staged face');
  const submit = byAria(mounted, '提交暂存结果整理任务 revise_candidate');
  assert.equal(submit.props.disabled, false, 'full-content verification is a PROVISION face, not an extra gate');

  click(byAria(mounted, '查看完整内容 整理任务 revise_candidate'));
  await waitFor(() => mounted.renderedText().includes('第二段候选内容。'), 'the full payload rendering');
  const text = mounted.renderedText();
  assert.ok(text.includes('内容完整'), 'the complete marker only after done');
  assert.ok(text.includes(`已载 ${Buffer.byteLength(payload)}／共 ${Buffer.byteLength(payload)} 字节`), 'the loaded/total bytes line');
  assert.ok(!text.includes('发布后再读'), 'the abolished wording never appears');
  click(submit);
  await waitFor(() => actions.of('/resolve').length > 0, 'the resolve POST after verification');
  assert.deepEqual(actions.of('/resolve')[0].body, { expectedVersion: 2, decision: 'resume', acknowledgedReceipts: [] });
});

test('U10: large staged results accumulate segments to done=true with the loaded/total progress — partial accumulation never shows the complete marker', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [stagedRow({ taskId: 'tsk_sg', version: 3, itemVersion: 1, receipts: [] })];
  const kase = await openControls({
    world,
    routes: [
      {
        match: GET_RESULT_EXACT('tsk_sg'),
        reply: async () => ok({
          contractVersion: 'web-api/2', taskId: 'tsk_sg', outcome: 'succeeded', kind: 'json',
          totalBytes: SEG_TOTAL, maxInlineBytes: 65536, maxSegmentBytes: SEG_LIMIT,
          inline: false, payload: null, payloadRef: 'result://att_tsk_sg/payload.json', failure: null,
          nextOffset: 0, done: false,
        }),
      },
      { match: GET_RESULT_SEGMENT('tsk_sg'), reply: async (call) => segmentAnswer('tsk_sg', Number(new URLSearchParams(call.query).get('offset')), SEG_LIMIT, SEG_TOTAL) },
    ],
  });
  t.after(() => kase.finish());
  const { mounted, actions } = kase;
  await kase.paired();

  click(await waitFor(() => byAria(mounted, '核对整理任务 revise_candidate'), 'the review toggle'));
  await waitFor(() => mounted.renderedText().includes('暂存成功结局'), 'the staged face');
  click(byAria(mounted, '查看完整内容 整理任务 revise_candidate'));
  // Mid-flight: partial bytes never claim completeness.
  await waitFor(() => mounted.renderedText().includes('已载'), 'the first segment progress');
  assert.ok(!mounted.renderedText().includes('内容完整') || actions.of('/api/tasks/tsk_sg/result').filter((call) => call.query.includes('offset=')).length >= 3,
    'partial accumulation does not show the complete marker before done');
  await waitFor(() => mounted.renderedText().includes('内容完整'), 'the segment loop reaching done=true');
  const text = mounted.renderedText();
  assert.ok(text.includes('中文abcd'), 'the UTF-8 payload assembled across byte-boundary segments');
  assert.ok(text.includes(`已载 ${SEG_TOTAL}／共 ${SEG_TOTAL} 字节`), 'the accumulated bytes equal totalBytes');
  const segments = actions.of('/api/tasks/tsk_sg/result').filter((call) => call.query.includes('offset='));
  assert.deepEqual(segments.map((call) => new URLSearchParams(call.query).get('offset')), ['0', '4', '8'], 'exactly the three byte-boundary segments were fetched');
});

test('§11.1 c1/c2: content sessions and ACKs bind (epoch, task.version, attemptId, itemVersion[, itemId]) — same itemVersion 1 on a NEW attempt, or a changed itemVersion on the SAME attempt, clears old content and old ACKs and nothing rides to the new binding', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  const receipts = [{ receiptId: 'rc_a', kind: 'lark_message_send', verifiable: true }];
  world.tasks = [stagedRow({ taskId: 'tsk_bd', version: 3, attemptCount: 1, itemVersion: 1, receipts, attemptId: 'att_a' })];
  const payload = '旧绑定上的完整候选内容。';
  const kase = await openControls({
    world,
    routes: [{
      match: GET_RESULT_EXACT('tsk_bd'),
      reply: async () => ok({
        contractVersion: 'web-api/2', taskId: 'tsk_bd', outcome: 'succeeded', kind: 'json',
        totalBytes: Buffer.byteLength(payload), inline: true, payload, failure: null,
      }),
    }],
  });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();
  // Adopt the instance epoch BEFORE any session opens, so the binding
  // counterexamples below isolate the (task.version, attemptId, itemVersion)
  // members — never a mid-test epoch flip carrying the invalidation.
  net.emit('stream.ready', READY);
  await waitFor(() => mounted.pairing.syncEpoch === 'inst_a', 'the ready handshake adopting the instance epoch');

  click(await waitFor(() => byAria(mounted, '核对整理任务 revise_candidate'), 'the review toggle'));
  await waitFor(() => mounted.renderedText().includes('暂存成功结局'), 'the staged face');
  click(byAria(mounted, '查看完整内容 整理任务 revise_candidate'));
  await waitFor(() => mounted.renderedText().includes('旧绑定上的完整候选内容。'), 'the old-binding content loaded');
  labelInput(labelsOf(mounted, '确认回执 rc_a')).props.onChange({ target: { checked: true } });
  await waitFor(() => byAria(mounted, '提交暂存结果整理任务 revise_candidate').props.disabled === false, 'the old-binding ACK gate open');

  // c1: the SAME taskId, SAME epoch, SAME itemVersion 1, but a NEW attempt
  // (task.version 4, attemptId att_b) — a taskId/epoch/itemVersion-only
  // binding mutant would keep the content and the ACK.
  let baseline = listReads(net);
  world.tasks = [stagedRow({ taskId: 'tsk_bd', version: 4, attemptCount: 2, itemVersion: 1, receipts, attemptId: 'att_b' })];
  invalidate(net);
  await waitForRefetch(net, baseline, 'the new-attempt row installing');
  await waitFor(() => mounted.renderedText().includes('第 2 次尝试'), 'the new attempt count displaying');
  await settle(40);
  let text = mounted.renderedText();
  assert.ok(!text.includes('旧绑定上的完整候选内容。'), 'the old content session did not survive the attempt change');
  assert.ok(!text.includes('内容完整'), 'the old complete marker is gone');
  assert.equal(byAria(mounted, '提交暂存结果整理任务 revise_candidate').props.disabled, true, 'the old ACK was dropped — the gate is closed again');
  assert.equal(actions.of('/resolve').length, 0, 'no resolve ever carried the stale ACK state');
  // The new binding re-derives everything: re-check on the NEW row only.
  labelInput(labelsOf(mounted, '确认回执 rc_a')).props.onChange({ target: { checked: true } });
  await waitFor(() => byAria(mounted, '提交暂存结果整理任务 revise_candidate').props.disabled === false, 'the gate re-opened on the NEW binding');

  // c2: same attempt (att_b), itemVersion changed 1 -> 2.
  baseline = listReads(net);
  world.tasks = [stagedRow({ taskId: 'tsk_bd', version: 5, attemptCount: 2, itemVersion: 2, receipts, attemptId: 'att_b' })];
  invalidate(net, 'tsk_1', 5);
  await waitForRefetch(net, baseline, 'the itemVersion-bumped row installing');
  await settle(40);
  assert.equal(byAria(mounted, '提交暂存结果整理任务 revise_candidate').props.disabled, true, 'the itemVersion change alone dropped the ACK too');
  assert.ok(!mounted.renderedText().includes('旧绑定上的完整候选内容。'), 'the content stayed cleared across the itemVersion change');
  assert.equal(actions.of('/resolve').length, 0, 'still zero resolve requests — the stale ACK never rode to the new entry version');
});

test('§11.1 c3: after a binding change the old segment session dies — a late done=true last segment installs nothing, marks nothing complete, and stops the loop', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [stagedRow({ taskId: 'tsk_iv', version: 3, attemptCount: 1, itemVersion: 1, receipts: [] })];
  const indexEnvelope = ok({
    contractVersion: 'web-api/2', taskId: 'tsk_iv', outcome: 'succeeded', kind: 'json',
    totalBytes: 8, maxInlineBytes: 65536, maxSegmentBytes: 4, inline: false, payload: null,
    payloadRef: 'result://att_tsk_iv/payload.json', failure: null, nextOffset: 0, done: false,
  });
  const seg0 = deferred(() => segmentAnswer('tsk_iv', 0, 4, 8));
  const seg1 = deferred(() => segmentAnswer('tsk_iv', 4, 4, 8));
  const segQueue = [seg0, seg1];
  const kase = await openControls({
    world,
    routes: [
      { match: GET_RESULT_EXACT('tsk_iv'), reply: async () => indexEnvelope },
      { match: GET_RESULT_SEGMENT('tsk_iv'), reply: async () => segQueue.shift().reply() },
    ],
  });
  t.after(() => kase.finish());
  const { mounted, actions, net } = kase;
  await kase.paired();
  // Same epoch-stability discipline as the c1/c2 face: the binding change
  // below must be carried by itemVersion alone, never by an epoch flip.
  net.emit('stream.ready', READY);
  await waitFor(() => mounted.pairing.syncEpoch === 'inst_a', 'the ready handshake adopting the instance epoch');

  click(await waitFor(() => byAria(mounted, '核对整理任务 revise_candidate'), 'the review toggle'));
  await waitFor(() => mounted.renderedText().includes('暂存成功结局'), 'the staged face');
  click(byAria(mounted, '查看完整内容 整理任务 revise_candidate'));
  const segmentCalls = () => actions.of('/api/tasks/tsk_iv/result').filter((call) => call.query.includes('offset='));
  await waitFor(() => segmentCalls().length === 1, 'the first segment in flight');
  // The fence refresh brings a NEW binding (itemVersion 2) while the old
  // segment loop is mid-flight.
  const baseline = listReads(net);
  world.tasks = [stagedRow({ taskId: 'tsk_iv', version: 4, attemptCount: 1, itemVersion: 2, receipts: [] })];
  invalidate(net);
  await waitForRefetch(net, baseline, 'the new-binding row installing');
  seg0.release();
  await settle(80);
  assert.equal(segmentCalls().length, 1, 'the invalidated session stopped issuing segments');
  seg1.release();
  await settle(120);
  const text = mounted.renderedText();
  assert.ok(!text.includes('内容完整'), 'the old done=true segment installed nothing and marked nothing complete');
  assert.ok(!text.includes('已载 8'), 'no old-session byte accumulation is displayed');
  assert.equal(actions.of('/resolve').length, 0, 'no disposition request carries the old session state');
});

test('U8 structural a11y: addressable names, aria-expanded wiring, labelled receipt inputs and real type=button entries exist in the compiled DOM (layout/keyboard faces are signed by the REAL browser fixture)', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [
    wireTask({ taskId: 'tsk_q', state: 'queued', version: 1, queuePosition: 1 }),
    stagedRow({
      taskId: 'tsk_sr', version: 3, itemVersion: 2,
      receipts: [{ receiptId: 'rc_a', kind: 'lark_message_send', verifiable: true }],
    }),
  ];
  const kase = await openControls({ world });
  t.after(() => kase.finish());
  const { mounted } = kase;
  await kase.paired();

  const toggle = await waitFor(() => byAria(mounted, '核对整理任务 revise_candidate'), 'the review toggle rendering');
  const cancel = byAria(mounted, '取消整理任务 organize_text');
  const concurrencyEntry = byAria(mounted, '并发设置');
  assert.ok(cancel && toggle && concurrencyEntry, 'the in-page entries carry task-context addressable names');
  for (const button of buttonsOf(mounted)) assert.equal(button.props.type, 'button', 'every entry is a real type=button');
  assert.equal(toggle.props['aria-controls'], 'task-review-tsk_sr', 'the toggle references its region');
  click(toggle);
  await waitFor(() => mounted.renderedText().includes('确认回执 rc_a'), 'the receipt list rendering');
  assert.equal(byAria(mounted, '核对整理任务 revise_candidate').props['aria-expanded'], 'true', 'aria-expanded flips with the region');
  const label = labelsOf(mounted, '确认回执 rc_a');
  assert.ok(label.children.some((child) => child.type === 'input' && child.props.type === 'checkbox'), 'the receipt input sits inside its explicit label');
  assert.ok(elsOf(mounted).find((el) => el.props.id === 'task-review-tsk_sr'), 'the review region carries the aria-controls target id');
});

// --- F1–F5 revision regressions (Codex review 01a1c67e; red on c944e6c) ------

async function readyReview(kase) {
  await kase.paired();
  kase.net.emit('stream.ready', READY);
  await waitFor(() => kase.mounted.pairing.syncEpoch === 'inst_a', 'adopt epoch');
  await settle(60);
}

async function openConcurrency(kase) {
  click(byAria(kase.mounted, '并发设置'));
  await settle(20);
}

function writeLimit(kase) {
  numberInputOf(kase.mounted).props.onInput({ target: { value: '2' } });
  assert.equal(byAria(kase.mounted, '应用并发设置').props.disabled, false);
  click(byAria(kase.mounted, '应用并发设置'));
}

test('F1: a failed segment load that is reopened re-reads from zero — no duplicated prefix, exact full-text equality, and the stale load error is cleared', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [stagedRow({ taskId: 'tsk_sg', version: 3, itemVersion: 1, receipts: [] })];
  let failed = false;
  const payloadText = SEG_TEXT.repeat(7000);
  const payloadBytes = Buffer.from(payloadText, 'utf8');
  const total = payloadBytes.length;
  const limit = 16384;
  const kase = await openControls({
    world,
    routes: [
      {
        match: GET_RESULT_EXACT('tsk_sg'),
        reply: async () => ok({
          contractVersion: 'web-api/2', taskId: 'tsk_sg', outcome: 'succeeded', kind: 'json',
          totalBytes: total, maxInlineBytes: 65536, maxSegmentBytes: limit,
          inline: false, payload: null, payloadRef: 'result://att_tsk_sg/payload.json', failure: null,
          nextOffset: 0, done: false,
        }),
      },
      {
        match: GET_RESULT_SEGMENT('tsk_sg'),
        reply: async (call) => {
          const offset = Number(new URLSearchParams(call.query).get('offset'));
          if (offset === limit && !failed) { failed = true; return fail(503, 'backend_unavailable', 'RESULT TEMPORARY ERROR'); }
          const bytes = payloadBytes.subarray(offset, Math.min(offset + limit, total));
          const done = offset + bytes.length >= total;
          return ok({
            contractVersion: 'web-api/2', taskId: 'tsk_sg', outcome: 'succeeded', failure: null,
            offset, limit, bytesReturned: bytes.length, totalBytes: total,
            nextOffset: done ? null : offset + bytes.length, done, payloadBase64: b64(bytes),
          });
        },
      },
    ],
  });
  t.after(() => kase.finish());
  const { mounted } = kase;
  await readyReview(kase);
  click(await waitFor(() => byAria(mounted, '核对整理任务 revise_candidate'), 'the review toggle'));
  await waitFor(() => mounted.renderedText().includes('暂存成功结局'), 'the staged face');
  click(byAria(mounted, '查看完整内容 整理任务 revise_candidate'));
  await waitFor(() => mounted.renderedText().includes('RESULT TEMPORARY ERROR'), 'the failed segment');
  // Close and reopen: the retry must restart from offset 0 with a fresh decoder.
  click(byAria(mounted, '查看完整内容 整理任务 revise_candidate'));
  await settle(10);
  click(byAria(mounted, '查看完整内容 整理任务 revise_candidate'));
  await waitFor(() => mounted.renderedText().includes('内容完整'), 'the retry reaching done');
  const text = mounted.renderedText();
  assert.ok(text.includes(`已载 ${total}／共 ${total} 字节`), 'the accumulated bytes equal totalBytes exactly');
  assert.ok(!text.includes('RESULT TEMPORARY ERROR'), 'the previous load error is cleared by the retry');
  assert.equal(elsOf(mounted).filter((el) => el.type === 'pre').map(textOf).join(''), payloadText, 'the content body is byte-for-byte the payload (no duplicated prefix)');
});

test('F2: a discarded PUT converges through one authoritative read AFTER an overlapping stale GET', { timeout: 20000 }, async (t) => {
  let state = concurrencyPayload();
  let hold = false;
  const staleGet = deferred(() => ok(concurrencyPayload()));
  const put = deferred(() => {
    state = concurrencyPayload({ agentConcurrency: 2, version: 1 });
    return ok({ ...state });
  });
  const kase = await openControls({
    routes: [
      { match: GET_CONCURRENCY, reply: async () => (hold ? staleGet.reply() : ok({ ...state })) },
      { match: PUT_CONCURRENCY, reply: put.reply },
    ],
  });
  t.after(() => { staleGet.release(); put.release(); return kase.finish(); });
  const { mounted, net, actions } = kase;
  await readyReview(kase);
  await openConcurrency(kase);
  writeLimit(kase);
  await waitFor(() => actions.calls.some((call) => call.method === 'PUT'), 'the PUT in flight');
  hold = true;
  const gets = actions.calls.filter(GET_CONCURRENCY).length;
  invalidate(net);
  await waitFor(() => actions.calls.filter(GET_CONCURRENCY).length > gets, 'the overlapping stale GET in flight');
  put.release();
  await settle(60);
  hold = false;
  staleGet.release();
  await waitFor(() => mounted.renderedText().includes('当前 2 · 缺省 3 · 版本 1'), 'the committed v1 converging after the stale GET', 1500);
});

test('F3: a recovery binding change clears the old resolve pending and a late old-binding error never lands on the new row', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [plainReviewRow({ taskId: 'tsk_pr', version: 4, itemVersion: 1 })];
  const reply = deferred(() => fail(400, 'validation_failed', 'OLD BINDING ERROR'));
  const kase = await openControls({ world, routes: [{ match: POST('/api/tasks/tsk_pr/resolve'), reply: reply.reply }] });
  t.after(() => { reply.release(); return kase.finish(); });
  const { mounted, net, actions } = kase;
  await readyReview(kase);
  click(await waitFor(() => byAria(mounted, '核对整理任务 extract'), 'the review toggle'));
  await waitFor(() => mounted.renderedText().includes('重启时外部副作用结果不明'), 'the review face');
  click(byAria(mounted, '恢复执行整理任务 extract'));
  await waitFor(() => actions.of('/resolve').length === 1, 'the old resolve in flight');
  world.tasks = [plainReviewRow({ taskId: 'tsk_pr', version: 5, itemVersion: 2 })];
  const baseline = listReads(net);
  invalidate(net);
  await waitForRefetch(net, baseline, 'the new binding installing');
  assert.equal(byAria(mounted, '恢复执行整理任务 extract').props.disabled, false, 'the new binding is actionable again');
  reply.release();
  await settle(120);
  assert.ok(!mounted.renderedText().includes('OLD BINDING ERROR'), 'the old binding error never wrote the new row');
});

test('F4: a late PUT failure respects the newer GET ownership and never surfaces over the installed view', { timeout: 20000 }, async (t) => {
  let state = concurrencyPayload();
  const put = deferred(() => fail(500, 'internal_error', 'OLD PUT ERROR'));
  const kase = await openControls({
    routes: [
      { match: GET_CONCURRENCY, reply: async () => ok({ ...state }) },
      { match: PUT_CONCURRENCY, reply: put.reply },
    ],
  });
  t.after(() => { put.release(); return kase.finish(); });
  const { mounted, net, actions } = kase;
  await readyReview(kase);
  await openConcurrency(kase);
  writeLimit(kase);
  await waitFor(() => actions.calls.some((call) => call.method === 'PUT'), 'the PUT in flight');
  state = concurrencyPayload({ agentConcurrency: 4, version: 2, runningCount: 4 });
  invalidate(net);
  await waitFor(() => mounted.renderedText().includes('版本 2'), 'the newer GET v2 installing');
  put.release();
  await settle(150);
  assert.ok(!mounted.renderedText().includes('OLD PUT ERROR'), 'the stale PUT error never rendered over the newer view');
  assert.ok(mounted.renderedText().includes('运行中 4'), 'the newer view counts stayed installed');
});

test('F5: a failed first concurrency read shows the failure and an explicit re-read entry instead of an endless pending state', { timeout: 20000 }, async (t) => {
  let attempts = 0;
  let allowSuccess = false;
  const kase = await openControls({
    routes: [{
      match: GET_CONCURRENCY,
      reply: async () => {
        attempts += 1;
        if (!allowSuccess) return fail(503, 'backend_unavailable', 'CONCURRENCY OFFLINE');
        return ok(concurrencyPayload());
      },
    }],
  });
  t.after(() => kase.finish());
  const { mounted } = kase;
  // No epoch handshake here: the mounted read is the FIRST read, so the empty
  // view is the failed state the panel must surface (not a transient gap).
  await kase.paired();
  await openConcurrency(kase);
  await waitFor(() => mounted.renderedText().includes('CONCURRENCY OFFLINE'), 'the failure surfacing');
  const retry = byAria(mounted, '重试读取并发设置');
  assert.ok(retry, 'the explicit re-read entry renders while the view is empty');
  assert.equal(retry.props.disabled, false, 'the re-read entry is actionable');
  allowSuccess = true;
  click(retry);
  await waitFor(() => mounted.renderedText().includes('当前 3 · 缺省 3 · 版本 0'), 'the manual re-read converging the view', 1500);
  assert.equal(attempts, 2, 'exactly one manual re-read was issued');
});

test('F6: an external settings.changed arriving during an in-flight stale GET is held and converges afterwards', { timeout: 20000 }, async (t) => {
  let state = concurrencyPayload();
  let hold = false;
  const staleGet = deferred(() => ok(concurrencyPayload()));
  const kase = await openControls({
    routes: [{ match: GET_CONCURRENCY, reply: async () => (hold ? staleGet.reply() : ok({ ...state })) }],
  });
  t.after(() => { staleGet.release(); return kase.finish(); });
  const { mounted, net, actions } = kase;
  await readyReview(kase);
  await openConcurrency(kase);
  hold = true;
  const gets = actions.calls.filter(GET_CONCURRENCY).length;
  invalidate(net, 'tsk_1', 1);
  await waitFor(() => actions.calls.filter(GET_CONCURRENCY).length > gets, 'the in-flight GET capturing old v0');
  state = concurrencyPayload({ agentConcurrency: 2, version: 1, runningCount: 1 });
  const listBaseline = listReads(net);
  net.emit('settings.changed', {
    contractVersion: 'web-api/2', epoch: 'inst_a', cursor: 2, objectType: 'setting',
    objectId: 'agentConcurrency', objectVersion: 1,
    setting: { agentConcurrency: 2 }, at: '2026-11-10T10:00:00.000Z',
  }, 'inst_a:2');
  await waitFor(() => listReads(net) > listBaseline, 'the settings hint reaching the real invalidation seam');
  await settle(50);
  hold = false;
  staleGet.release();
  await waitFor(() => mounted.renderedText().includes('当前 2 · 缺省 3 · 版本 1'), 'the newer settings surviving the overlapping read', 1500);
});

test('F7: a successful action awaiting refresh does not announce into a new epoch', { timeout: 20000 }, async (t) => {
  const world = defaultWorld();
  world.tasks = [failedRow({ taskId: 'tsk_old', type: 'revise_candidate' })];
  const kase = await openControls({
    world,
    routes: [{ match: POST('/api/tasks/tsk_old/retry'), reply: async () => taskReply(wireTask({ taskId: 'tsk_old', type: 'revise_candidate', state: 'queued', version: 6 }), 202) }],
  });
  let release = null;
  t.after(() => { release?.([]); return kase.finish(); });
  const { mounted, net, behavior } = kase;
  await readyReview(kase);
  release = net.holdNextTasks();
  click(byAria(mounted, '重试失败任务 revise_candidate'));
  await waitFor(() => kase.actions.of('/retry').length === 1 && behavior.holdNextTasks === false, 'the successful action awaiting the held list read');
  world.tasks = [wireTask({ taskId: 'tsk_new', type: 'extract', state: 'queued', version: 1 })];
  behavior.snapshot = () => ({ ...snapshotBody(world), contractVersion: 'web-api/2', highWatermark: 4, lastEventId: 'inst_b:4', epoch: 'inst_b', agentConcurrency: 3, tasks: world.tasks });
  net.emit('stream.reset', RESET);
  await waitFor(() => mounted.pairing.syncEpoch === 'inst_b', 'the new epoch installing');
  await waitFor(() => mounted.renderedText().includes('extract'), 'the new epoch queue rendering');
  release([]);
  await settle(120);
  assert.ok(!mounted.renderedText().includes('整理任务 revise_candidate 的动作已完成'), 'the old action never wrote the new epoch live region');
});
