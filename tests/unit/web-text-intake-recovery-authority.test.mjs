//! Recovery-item/receipt AUTHORITY-chain regression for the two resolve
//! entries (MAYNE-24, frozen `web-api/1` §3.3/§3.5/§4.5).
//!
//! The cd08588 baseline treats the client-mirrored `inputRef.recovery` as the
//! sole authority for the recovery-item version and the known receipts — a
//! field no business flow ever writes — so the entry CAS is a constant
//! `1 === 1`, the receipt check is vacuous, the wire never exposes the
//! authority version/receipts, and a resolve never advances the authority
//! item. These faces pin the contract behavior on the AUTHORITY tables:
//!
//!   Wire (§3.5)        A1–A4  `itemVersion` readable for every cause of the
//!                             frozen set in BOTH exit branches, authority
//!                             receipts on the wire, forged inputRef mirror
//!                             ignored.
//!   Plain resolve      B1–B9  correct/stale/disposed versions, missing/full
//!                             ACK, forged mirror, cross-attempt isolation,
//!                             item disposition (version+1 + audit) in the
//!                             SAME transaction as the task transition.
//!   Staged resume      C1–C5  `commitStagedResume` shares the SAME authority
//!                             version/exit/receipt gating and the SAME item
//!                             disposition; a refused resume publishes
//!                             nothing and writes nothing.
//!   Fences preserved   D1–D2  task/attempt fencing intact (D1) and the
//!                             concurrent-race loser rolls back WHOLE (D2 —
//!                             one disposition, no phantom event).
//!   Handler (HTTP)     H1–H9  controlled REAL HTTP on the resolve endpoint:
//!                             stale version -> 409, missing ACK -> 400,
//!                             legal disposition -> 202, exit unconfirmed ->
//!                             409. H6–H9 close the staged-entry ACK wiring:
//!                             the handler forwards `acknowledgedReceipts`
//!                             into `commitStagedResume` exactly like the
//!                             plain entry, so a full ACK over HTTP commits
//!                             the original staged outcome (H6 — RED on an
//!                             unwired handler, the registered gap), while
//!                             wrong (H7) and illegal-shape (H8 staged /
//!                             H9 plain) ACK lists answer the SAME receipt
//!                             gate on both entries. Handler layer only —
//!                             no scheduler, no worker host, no real Pi
//!                             anywhere in this file.
//!   ACK wire shape     G1–G8  `acknowledgedReceipts` is an OMITTED field or
//!                             an array of receipt id strings — nothing else.
//!                             A bare string (even one CONTAINING the real
//!                             receipt id, which the former `includes`
//!                             answering accepted as coverage), a number, an
//!                             object, an explicit `null`, or a mixed array
//!                             answers `validation_failed` at BOTH entries
//!                             with zero writes and zero publication (the
//!                             caff8b2 CC1 finding); legal arrays keep
//!                             passing (G8 control). H10/H11 pin the same
//!                             shapes over real HTTP.
//!   Authority unique   K1–K6  two or more PENDING `recovery_items` rows are
//!                             an AMBIGUOUS authority: both resolve entries
//!                             answer `state_conflict` instead of disposing
//!                             the newest row (the caff8b2 CC2 finding), the
//!                             wire exposes no `itemVersion` there, and
//!                             `markNeedsReview` duplicate/concurrent calls
//!                             stay idempotent — one pending row, one event,
//!                             no version inflation, task/attempt fences
//!                             untouched.
//!   Cross-episode      X1–X9  the C-4 fix round (MAYNE-30, adjudicated
//!                             frozen §12: ONE row per needs_review task,
//!                             `version` monotonic — a per-episode fresh v1
//!                             was the replay window Hermes proved on
//!                             4bf3472): every re-dock REUSES the task's
//!                             disposed authority line (X1 plain extract
//!                             path, X2 staged service path, X3 the restart
//!                             classify path, X4 concurrent scans, X5
//!                             markNeedsReview, X6 stale attempt-attribution
//!                             refusal, X7 refusal
//!                             of a dock onto a live pending authority), the
//!                             stale episode request answers
//!                             `version_conflict` with ZERO side effects
//!                             and the wire-re-read request succeeds — over
//!                             real HTTP too (X8 plain, X9 staged; handler
//!                             layer, no real Pi). B9 is AMENDED to the §12
//!                             reuse semantics (labeled in place): its
//!                             receipt-isolation claim is unchanged. The
//!                             TaskService.confirmExit producer shares the
//!                             same dock op (X7 exercises its refusal
//!                             wiring); its !exited park closes the attempt
//!                             row, so no legal cross-episode chain runs
//!                             through it in this tree — registered, not
//!                             changed this round.
//!   C-4 revision     Y1–Y4  the Codex rejection findings (MAYNE-30
//!                             started_2): the classify producer binds its
//!                             SCAN-TIME state/version and the scanned attempt
//!                             as a commit-time assertion (Y1 late running
//!                             scan, Y2 delayed-transaction ABA + real-HTTP
//!                             replay refusal, Y3 late needs_review scan), and
//!                             the dock re-states its read-time premise at
//!                             commit (conditional INSERT, version-bound
//!                             reuse) and REFUSES several disposed legacy
//!                             lines instead of guessing the newest rowid
//!                             (Y4). Each was RED on the rejected `5623fae`
//!                             bytes on its named symptom.
//!
//! Every face boots ONE fresh real instance (real storage adapter binary, real
//! services; see the fixture header) and reaches every audited state through
//! business transitions; the TWO legal state injections are the labeled
//! authority-seam writes on `recovery_items` (`injectItemVersion`,
//! `injectPendingRecoveryItem` — never `inputRef`). Baseline (cd08588)
//! expectations: the A/B/C/D authority faces run RED with the registered
//! symptoms; the marked control faces (B8/B9/D1/H5) stay green there because
//! they pin behavior the baseline already answered (through a different,
//! non-authority mechanism).
//!
//! Every face boots ONE fresh real instance (real storage adapter binary, real
//! services; see the fixture header) and reaches every audited state through
//! business transitions; the single legal state injection is the labeled
//! authority-seam `UPDATE recovery_items SET version=…` (never `inputRef`).
//! Baseline (cd08588) expectations: the A/B/C/D authority faces run RED with
//! the registered symptoms; the marked control faces (B8/B9/D1/H5) stay green
//! there because they pin behavior the baseline already answered (through a
//! different, non-authority mechanism).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ServiceError } from '../../server/lib/manual-items-service.mjs';
import {
  PrerequisiteGap,
  createInstance,
  parkTask,
  reclaim,
  reparkTask,
  injectItemVersion,
  injectPendingRecoveryItem,
  injectDisposedRecoveryItem,
  pendingRecoveryRowCount,
  recoveryItemRow,
  stagedCandidateRows,
  syntheticExitEvidence,
  taskEventCount,
} from '../fixtures/web-text-intake/recovery-authority-instance.mjs';

const FORGED_MIRROR = {
  cause: 'exit_unconfirmed',
  itemVersion: 999,
  sideEffectKnown: true,
  reason: 'forged-by-submit-body',
  receipts: [{ receiptId: 'forged_receipt_deadbeef', kind: 'forged', externalRef: 'forged', recordedAt: '2026-01-01T00:00:00.000Z', verifiable: false }],
};

async function freshFace(t, options = {}) {
  const ctx = await createInstance(options);
  t.after(() => ctx.close());
  return ctx;
}

/// Park through the production transitions, run the real reclaim (unless the
/// face pins the unconfirmed state), and optionally inject the authority
/// advance. Returns { ctx, taskId, attemptId, operationId, api }.
async function parkedTask(t, { injectVersion = null, withHttp = false, reclaim: doReclaim = true, ...parkOptions } = {}) {
  const ctx = await freshFace(t, { withHttp });
  const parked = await parkTask(ctx, parkOptions);
  if (doReclaim) await reclaim(ctx);
  if (injectVersion !== null) await injectItemVersion(ctx, parked.taskId, injectVersion);
  return { ctx, ...parked, api: ctx.api };
}

// --- Wire: the authority version and receipts are readable (frozen §3.5) ----

test('A1: exited_confirmed wire carries itemVersion AND decisionOptions, from the authority row', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { injectVersion: 2 });
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review');
  assert.equal(wire.attemptExitState, 'exited_confirmed');
  assert.ok(wire.recovery, 'a parked task carries its recovery object');
  assert.equal(wire.recovery.cause, 'exit_unconfirmed');
  assert.equal(wire.recovery.itemVersion, 2, 'the AUTHORITY item version is readable after the confirmed exit');
  assert.deepEqual(wire.recovery.decisionOptions, ['resume', 'cancel']);
});

test('A2: exited_unknown wire carries the authority itemVersion + stagedResult, never decisionOptions', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { stage: 'success', injectVersion: 2, reclaim: false });
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.attemptExitState, 'exited_unknown');
  assert.equal(wire.recovery.itemVersion, 2, 'the authority value, not the inputRef default');
  assert.equal(wire.recovery.stagedResult, true);
  assert.equal('decisionOptions' in wire.recovery, false, 'decisionOptions only appear once the exit is confirmed');
});

test('A3: known verifiable receipts of the recovery attempt reach the wire (frozen sample shape)', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { withReceipt: true });
  const rows = await ctx.taskService.query(
    'SELECT receipt_id FROM side_effect_receipts',
    [],
  );
  assert.equal(rows.length, 1, 'the receipt exists in the authority ledger');
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.recovery.receipts.length, 1, 'the authority receipt is on the wire');
  const receipt = wire.recovery.receipts[0];
  assert.deepEqual(
    Object.keys(receipt).sort(),
    ['externalRef', 'kind', 'receiptId', 'recordedAt', 'verifiable'],
    'the element shape is the frozen sample shape',
  );
  assert.equal(receipt.receiptId, rows[0][0]);
  assert.equal(receipt.kind, 'lark_message_send');
  assert.equal(receipt.verifiable, true, 'provable_readonly=0 maps to the frozen verifiable=true');
  assert.ok(!Number.isNaN(Date.parse(receipt.recordedAt)), 'recordedAt is an ISO instant');
});

test('A4: a forged inputRef recovery mirror cannot override the wire facts', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { recoveryMirror: FORGED_MIRROR, injectVersion: 2 });
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.recovery.itemVersion, 2, 'the mirror value 999 is ignored; the authority row is exposed');
  assert.deepEqual(wire.recovery.receipts, [], 'the forged receipt list is ignored; the attempt ledger is empty');
});

// --- Plain resolve entry (TaskService.resolve) ------------------------------

test('B1: resolve(resume) with the authority version re-queues AND advances the item in one commit (F1r)', async (t) => {
  const { ctx, taskId } = await parkedTask(t);
  const before = await ctx.taskService.get(taskId);
  const task = await ctx.taskService.resolve(taskId, 1, 'resume', []);
  assert.equal(task.state, 'queued', 'the task re-queues for a fresh attempt');
  assert.equal(task.version, before.version + 1, 'the task version advanced');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 2, 'the item version advanced in the SAME commit');
  assert.equal(item.verificationState, 'resumed');
  assert.equal(item.decision, 'resume');
  assert.equal(item.decidedBy, 'user');
  assert.ok(item.decidedAt !== null && item.decidedAt !== undefined, 'the decision audit is stamped');
});

test('B2: resolve(cancel) disposes the item cancelled with the decision audit (F1c)', async (t) => {
  const { ctx, taskId } = await parkedTask(t);
  const task = await ctx.taskService.resolve(taskId, 1, 'cancel');
  assert.equal(task.state, 'cancelled');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 2);
  assert.equal(item.verificationState, 'cancelled');
  assert.equal(item.decision, 'cancel');
  assert.equal(item.decidedBy, 'user');
  assert.ok(item.decidedAt !== null && item.decidedAt !== undefined);
});

test('B3: stale version after an authority advance answers 409 version_conflict with ZERO writes', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { stage: 'success', injectVersion: 2 });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', []),
    (error) => error instanceof ServiceError && error.code === 'version_conflict',
  );
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review', 'the task did not move');
  assert.equal(wire.version, before.version, 'no task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 2, 'the authority item is untouched');
  assert.equal(item.verificationState, 'pending');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'the staged outcome is NOT published');
});

test('B4: the true authority version is accepted after an authority advance', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { injectVersion: 2 });
  const task = await ctx.taskService.resolve(taskId, 2, 'resume', []);
  assert.equal(task.state, 'queued', 'no false conflict against the authority row');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 3, 'the disposition advanced the injected version');
  assert.equal(item.verificationState, 'resumed');
});

test('B5: missing-ACK resume with a pending verifiable receipt answers validation_failed, zero writes', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', []),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
  );
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review', 'the resume did not happen');
  assert.equal(wire.version, before.version);
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.verificationState, 'pending', 'the item stays undisposed');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
});

test('B6: full-ACK resume is accepted and the ACK id is the AUTHORITY receipt id', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { withReceipt: true });
  const wire = await ctx.taskService.get(taskId);
  const receiptId = wire.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId, 'the client can only ACK what the wire exposes');
  const task = await ctx.taskService.resolve(taskId, 1, 'resume', [receiptId]);
  assert.equal(task.state, 'queued');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.verificationState, 'resumed', 'the accepted resume also disposes the item');
  assert.equal(item.version, 2);
});

test('B7: a forged inputRef mirror can neither satisfy the CAS nor the ACK gate', async (t) => {
  // Registered asymmetry: on the cd08588 baseline this face passes FOR THE
  // WRONG REASON — the baseline CAS reads the forged mirror itself, so
  // itemVersion 999 rejects while 1 would have passed (the client value gates
  // the CAS: the defect in its purest form). On the fixed tree it passes for
  // the contract reason: the AUTHORITY row (2) rejects the stale request no
  // matter what the mirror carries.
  const { ctx, taskId } = await parkedTask(t, { recoveryMirror: FORGED_MIRROR, injectVersion: 2 });
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', ['forged_receipt_deadbeef']),
    (error) => error instanceof ServiceError && error.code === 'version_conflict',
    'the forged mirror version 1 does not pass the authority CAS (2)',
  );
});

test('B8 CONTROL: an already-disposed item keeps answering state_conflict', async (t) => {
  const { ctx, taskId } = await parkedTask(t);
  await ctx.taskService.resolve(taskId, 1, 'resume', []);
  const item = await recoveryItemRow(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, item.version, 'resume', []),
    (error) => error instanceof ServiceError && error.code === 'state_conflict',
  );
  const itemAfter = await recoveryItemRow(ctx, taskId);
  assert.equal(itemAfter.version, item.version, 'the disposed item was not touched again');
});

test('B9 CONTROL: cross-attempt receipt isolation — a new attempt parks clean', async (t) => {
  const { ctx, taskId, attemptId } = await parkedTask(t, { withReceipt: true });
  const wire = await ctx.taskService.get(taskId);
  const receiptId = wire.recovery.receipts[0]?.receiptId;
  const item1 = await recoveryItemRow(ctx, taskId);
  await ctx.taskService.resolve(taskId, 1, 'resume', [receiptId]);
  // Second episode: fresh claim, NO receipt this time, park + reclaim again.
  const claimed = await ctx.taskService.claimNext(4, ctx.epoch);
  assert.equal(claimed.row.taskId, taskId, 'the re-queued task claims again');
  assert.notEqual(claimed.attemptId, attemptId, 'a new attempt generation');
  await ctx.textIntake.confirmExtractExit(taskId, claimed.attemptId, { exited: false, epoch: ctx.epoch });
  await reclaim(ctx);
  const secondWire = await ctx.taskService.get(taskId);
  assert.deepEqual(secondWire.recovery.receipts, [], 'the new episode only sees its own attempt ledger');
  // C-4 round (MAYNE-30) amendment, per the adjudicated frozen §12 semantics
  // (web-api-contract.md:389 — ONE row per needs_review task, `version` from 1
  // and +1 per change; the per-episode fresh-v1 reading was the registered
  // replay window, Hermes 01a1c2af): the episode REUSES the task's authority
  // line. The item identity stays traceable across episodes and the version
  // advanced 1 -> 2 (disposed) -> 3 (pending); the ep1-era request version is
  // thereby stale for the new episode. The receipt-isolation claim above is
  // unchanged.
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.itemId, item1.itemId, 'the same authority item identity across episodes');
  assert.equal(item.version, 3, 'the reused line advanced monotonically — no fresh v1');
  assert.equal(item.verificationState, 'pending');
  assert.equal(secondWire.recovery.itemVersion, 3);
  const task = await ctx.taskService.resolve(taskId, secondWire.recovery.itemVersion, 'resume', []);
  assert.equal(task.state, 'queued', 'the old attempt receipt does not gate the new episode');
});

// --- Staged-resume entry (TextIntakeService.commitStagedResume) -------------

test('C1: staged-resume stale version answers version_conflict and publishes NOTHING', async (t) => {
  const { ctx, taskId, attemptId } = await parkedTask(t, { stage: 'success', injectVersion: 2 });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.textIntake.commitStagedResume(taskId, attemptId, 1),
    (error) => error instanceof ServiceError && error.code === 'version_conflict',
  );
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review', 'the staged outcome was NOT committed');
  assert.equal(wire.version, before.version);
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.length >= 1 && candidates.every((row) => row[1] === 'staged'), 'staged candidates stay invisible');
});

test('C2: staged-resume with the true authority version commits the ORIGINAL staged outcome', async (t) => {
  const { ctx, taskId, attemptId } = await parkedTask(t, { stage: 'success', injectVersion: 2 });
  const task = await ctx.textIntake.commitStagedResume(taskId, attemptId, 2);
  assert.equal(task.state, 'succeeded', 'the original staged outcome is committed');
  assert.equal(task.resultPendingExit, false);
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.length >= 1 && candidates.every((row) => row[1] === 'pending'), 'the staged candidates are published');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 3, 'the item advanced with the task in the same commit');
  assert.equal(item.verificationState, 'resumed');
  assert.equal(item.decision, 'resume');
  assert.ok(item.decidedAt !== null && item.decidedAt !== undefined);
});

test('C3: staged-resume missing ACK answers validation_failed and publishes nothing', async (t) => {
  const { ctx, taskId, attemptId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  await assert.rejects(
    () => ctx.textIntake.commitStagedResume(taskId, attemptId, 1),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
    'the same receipt gate as the plain resolve entry',
  );
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
});

test('C4: staged-resume with full ACK commits, publishes and disposes the item', async (t) => {
  const { ctx, taskId, attemptId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  const wire = await ctx.taskService.get(taskId);
  const receiptId = wire.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId);
  const task = await ctx.textIntake.commitStagedResume(taskId, attemptId, 1, [receiptId]);
  assert.equal(task.state, 'succeeded');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'pending'));
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 2);
  assert.equal(item.verificationState, 'resumed');
  assert.equal(item.decision, 'resume');
});

test('C5: cancel of a staged task through the normal entry never publishes the staged outcome', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { stage: 'success' });
  const task = await ctx.taskService.resolve(taskId, 1, 'cancel');
  assert.equal(task.state, 'cancelled');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'a cancel does not publish');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.verificationState, 'cancelled', 'the item records the cancel disposition');
});

// --- Fences preserved -------------------------------------------------------

test('D1 CONTROL: the task-state fences stay intact (resolve on a running task)', async (t) => {
  const ctx = await freshFace(t);
  const submitted = await ctx.taskService.submit({
    operationId: `op_running_${Date.now()}`,
    type: 'extract',
    role: 'organizer',
    input: { text: '第二段文本。', timeZone: 'Asia/Shanghai' },
  });
  await ctx.taskService.claimNext(4, ctx.epoch);
  await assert.rejects(
    () => ctx.taskService.resolve(submitted.task.taskId, submitted.task.version, 'resume', []),
    (error) => error instanceof ServiceError && error.code === 'state_conflict',
  );
});

test('D2: a concurrent resolve race has ONE winner; the loser rolls back whole with zero extra writes', async (t) => {
  const { ctx, taskId } = await parkedTask(t);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const outcomes = await Promise.allSettled([
    ctx.taskService.resolve(taskId, 1, 'resume', []),
    ctx.taskService.resolve(taskId, 1, 'resume', []),
  ]);
  const fulfilled = outcomes.filter((entry) => entry.status === 'fulfilled');
  const rejected = outcomes.filter((entry) => entry.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one disposition wins');
  assert.equal(rejected.length, 1, 'the loser is refused');
  const loserError = rejected[0].reason;
  assert.ok(loserError instanceof ServiceError, 'the loser answers a ServiceError');
  assert.equal(loserError.code, 'state_conflict', 'the lost premise answers the contract code');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 2, 'exactly ONE item disposition (fixed tree; baseline stays 1)');
  assert.equal(item.verificationState, 'resumed');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore + 1, 'no phantom event from the loser');
});

// --- Handler layer: controlled REAL HTTP on the resolve endpoint ------------

test('H1: HTTP resolve with a stale version answers 409 version_conflict and writes nothing', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { stage: 'success', injectVersion: 2, withHttp: true });
  const response = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(response.status, 409, 'the handler maps the authority conflict to the frozen status');
  assert.equal(response.body.error?.code, 'version_conflict');
  const wire = await api.get(`/api/tasks/${taskId}`);
  assert.equal(wire.body.task.state, 'needs_review');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
});

test('H2: HTTP staged-resume missing ACK answers 400 and publishes nothing', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success', withHttp: true });
  const response = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(response.status, 400, 'the frozen §4.5 status for an uncovered receipt set');
  assert.equal(response.body.error?.code, 'validation_failed');
  const wire = await api.get(`/api/tasks/${taskId}`);
  assert.equal(wire.body.task.state, 'needs_review', 'the staged entry refused before any publication');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'));
});

test('H3: HTTP plain-resume missing ACK answers 400', async (t) => {
  const { api, taskId } = await parkedTask(t, { withReceipt: true, withHttp: true });
  const response = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(response.status, 400);
  assert.equal(response.body.error?.code, 'validation_failed');
});

test('H4: HTTP legal disposition with the full ACK answers 202 (plain entry)', async (t) => {
  const { api, taskId } = await parkedTask(t, { withReceipt: true, withHttp: true });
  const wire = await api.get(`/api/tasks/${taskId}`);
  const receiptId = wire.body.task.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId, 'the receipt is readable over HTTP (the client can ACK it)');
  const response = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire.body.task.recovery.itemVersion,
    decision: 'resume',
    acknowledgedReceipts: [receiptId],
  });
  assert.equal(response.status, 202, 'the legal disposition passes the whole handler chain');
  assert.equal(response.body.task.state, 'queued');
});

test('H5 CONTROL: HTTP resolve on an unconfirmed exit answers 409 exit_unconfirmed', async (t) => {
  const { api, taskId } = await parkedTask(t, { stage: 'success', reclaim: false, withHttp: true });
  const wire = await api.get(`/api/tasks/${taskId}`);
  assert.equal(wire.body.task.attemptExitState, 'exited_unknown');
  const response = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(response.status, 409);
  assert.equal(response.body.error?.code, 'exit_unconfirmed');
});

test('H6: HTTP staged-resume with the full forwarded ACK answers 202 and commits the ORIGINAL staged outcome', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success', withHttp: true });
  // The client can construct the legal staged resume PURELY from the wire:
  // the authority item version and the receipt id both come from GET first.
  const wire = await api.get(`/api/tasks/${taskId}`);
  const receiptId = wire.body.task.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId, 'the receipt is readable over HTTP on the staged entry');
  assert.equal(wire.body.task.recovery.itemVersion, 1);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const response = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire.body.task.recovery.itemVersion,
    decision: 'resume',
    acknowledgedReceipts: [receiptId],
  });
  assert.equal(response.status, 202, 'the forwarded ACK passes the whole handler chain');
  assert.equal(response.body.task.state, 'succeeded', 'the ORIGINAL staged outcome is committed');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.length >= 1 && candidates.every((row) => row[1] === 'pending'), 'the staged candidates are published');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 2, 'the item disposition joined the same commit');
  assert.equal(item.verificationState, 'resumed');
  assert.equal(item.decision, 'resume');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore + 1, 'exactly the commit event, no phantom');
});

test('H7: HTTP staged-resume with a WRONG ACK answers 400 and publishes nothing', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success', withHttp: true });
  const wire = await api.get(`/api/tasks/${taskId}`);
  const receiptId = wire.body.task.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId, 'the face knows the real id and deliberately sends a different one');
  const eventsBefore = await taskEventCount(ctx, taskId);
  const response = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire.body.task.recovery.itemVersion,
    decision: 'resume',
    acknowledgedReceipts: [`not_${receiptId}`],
  });
  assert.equal(response.status, 400, 'the forwarded wrong ACK is refused by the same gate');
  assert.equal(response.body.error?.code, 'validation_failed');
  const after = await api.get(`/api/tasks/${taskId}`);
  assert.equal(after.body.task.state, 'needs_review', 'nothing committed');
  assert.equal(after.body.task.version, wire.body.task.version, 'no task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, 1, 'the item stays undisposed');
  assert.equal(item.verificationState, 'pending');
});

test('H8: HTTP staged-resume with an illegal ACK SHAPE answers 400 by the existing gate semantics', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success', withHttp: true });
  const wire = await api.get(`/api/tasks/${taskId}`);
  const eventsBefore = await taskEventCount(ctx, taskId);
  // A bare string is not the contract list shape; the handler adds no
  // pre-validation of its own — the forwarded value meets the SAME receipt
  // gate, which cannot cover the ledger with it and answers validation_failed.
  const response = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire.body.task.recovery.itemVersion,
    decision: 'resume',
    acknowledgedReceipts: 'not-a-receipt-id',
  });
  assert.equal(response.status, 400, 'no crash, no publish: the existing validation semantics answer');
  assert.equal(response.body.error?.code, 'validation_failed');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.verificationState, 'pending');
});

test('H9: the PLAIN entry answers an illegal ACK shape with the SAME gate semantics', async (t) => {
  const { api, taskId } = await parkedTask(t, { withReceipt: true, withHttp: true });
  const wire = await api.get(`/api/tasks/${taskId}`);
  const response = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire.body.task.recovery.itemVersion,
    decision: 'resume',
    acknowledgedReceipts: 'not-a-receipt-id',
  });
  assert.equal(response.status, 400, 'both resolve entries share one receipt-gate semantics');
  assert.equal(response.body.error?.code, 'validation_failed');
});

// --- ACK wire shape: an omitted field or an array of strings, nothing else --
// (the caff8b2 CC1 finding: the former `includes` answering accepted a bare
// string CONTAINING the real receipt id as coverage and answered a
// number/object with a TypeError 500; both entries now answer
// validation_failed with zero writes and zero publication.)

/// The shared zero-side-effect assertion for a refused G face: the task did
/// not move, no phantom event, the authority item stays pending and undisposed.
async function assertRefusalWroteNothing(ctx, taskId, { beforeVersion, eventsBefore }) {
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review', 'the task did not move');
  assert.equal(wire.version, beforeVersion, 'no task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.verificationState, 'pending', 'the item stays undisposed');
  assert.equal(item.version, 1, 'the item version did not advance');
}

test('G1: a string CONTAINING the real receipt id is NOT coverage — plain entry refuses, zero writes', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const receiptId = before.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', `pre_${receiptId}_post`),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
    'substring containment is not acknowledgment',
  );
  await assertRefusalWroteNothing(ctx, taskId, { beforeVersion: before.version, eventsBefore });
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
});

test('G2: a NUMBER ack answers validation_failed at the plain entry, zero writes', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', 5),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
    'a number is a client shape error, never a TypeError 500',
  );
  await assertRefusalWroteNothing(ctx, taskId, { beforeVersion: before.version, eventsBefore });
});

test('G3: an OBJECT ack answers validation_failed at the plain entry, zero writes', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', { receiptId: 'anything' }),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
  );
  await assertRefusalWroteNothing(ctx, taskId, { beforeVersion: before.version, eventsBefore });
});

test('G4: an explicit NULL ack is not the omitted default — plain entry refuses, zero writes', async (t) => {
  // No receipt on the task: the omitted field would vacuously pass here, so
  // the face proves null is refused AS A SHAPE, not by the coverage gate.
  const { ctx, taskId } = await parkedTask(t, { stage: 'success' });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', null),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
    'an explicit null is provided and not an array',
  );
  await assertRefusalWroteNothing(ctx, taskId, { beforeVersion: before.version, eventsBefore });
});

test('G5: a MIXED array [realId, number] answers validation_failed at the plain entry, zero writes', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const receiptId = before.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', [receiptId, 5]),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
    'every member must be a string; coverage of one member does not legalize the rest',
  );
  await assertRefusalWroteNothing(ctx, taskId, { beforeVersion: before.version, eventsBefore });
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
});

test('G6: a NUMBER ack answers validation_failed at the STAGED entry, zero publication', async (t) => {
  const { ctx, taskId, attemptId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.textIntake.commitStagedResume(taskId, attemptId, 1, 5),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
    'the same shape gate as the plain entry',
  );
  await assertRefusalWroteNothing(ctx, taskId, { beforeVersion: before.version, eventsBefore });
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'the staged outcome was NOT published');
});

test('G7: a string containing the real receipt id is refused at the STAGED entry, nothing published', async (t) => {
  const { ctx, taskId, attemptId } = await parkedTask(t, { withReceipt: true, stage: 'success' });
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const receiptId = before.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId);
  await assert.rejects(
    () => ctx.textIntake.commitStagedResume(taskId, attemptId, 1, `x_${receiptId}`),
    (error) => error instanceof ServiceError && error.code === 'validation_failed',
  );
  await assertRefusalWroteNothing(ctx, taskId, { beforeVersion: before.version, eventsBefore });
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
});

test('G8 CONTROL: legal arrays keep passing the shape gate on both entries', async (t) => {
  // Explicit [] with no receipts: accepted (the omitted default and the empty
  // list are the same legal shape). The full-[receiptId] positives are B6/C4/
  // H4/H6; this control pins that the shape gate rejects only shapes, never
  // legal (even empty) arrays.
  const { ctx, taskId } = await parkedTask(t, { stage: 'success' });
  const task = await ctx.taskService.resolve(taskId, 1, 'resume', []);
  assert.equal(task.state, 'queued', 'the empty list is a legal ACK shape');
});

// --- Authority uniqueness and producer idempotency (the caff8b2 CC2 finding) -

test('K1: two pending rows are an AMBIGUOUS authority — the plain entry refuses with zero writes', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { stage: 'success', injectVersion: 2 });
  await injectPendingRecoveryItem(ctx, taskId);
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 2, 'the audited ambiguous state');
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 2, 'resume', []),
    (error) => error instanceof ServiceError && error.code === 'state_conflict',
    'the newest row is never silently disposed',
  );
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review');
  assert.equal(wire.version, before.version, 'no task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 2, 'neither row was touched');
  // The latest row IS the injected one (version 1); the ORIGINAL row keeps its
  // injected authority advance (version 2) equally untouched:
  const original = await ctx.taskService.query(
    'SELECT version,verification_state FROM recovery_items WHERE task_id=? ORDER BY rowid ASC LIMIT 1',
    [taskId],
  );
  assert.equal(original[0][0], 2, 'the injected advance on the original row is untouched');
  assert.equal(original[0][1], 'pending');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.verificationState, 'pending', 'the injected latest row stays undisposed');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
});

test('K2: two pending rows refuse the STAGED entry too — nothing published, zero writes', async (t) => {
  const { ctx, taskId, attemptId } = await parkedTask(t, { stage: 'success', injectVersion: 2 });
  await injectPendingRecoveryItem(ctx, taskId);
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.textIntake.commitStagedResume(taskId, attemptId, 2, []),
    (error) => error instanceof ServiceError && error.code === 'state_conflict',
  );
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review', 'the staged outcome was NOT committed');
  assert.equal(wire.version, before.version);
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 2, 'neither row was touched');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
});

test('K3: the ambiguous wire exposes NO itemVersion — the absent member is the visible signal', async (t) => {
  const { ctx, taskId } = await parkedTask(t, { injectVersion: 2 });
  await injectPendingRecoveryItem(ctx, taskId);
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.recovery.cause, 'exit_unconfirmed');
  assert.equal(
    'itemVersion' in wire.recovery, false,
    'a client must never be handed one row\'s version when no request can lawfully dispose the task',
  );
});

test('K4: a duplicate markNeedsReview(exited:false) inserts NO second pending row and NO phantom event', async (t) => {
  const ctx = await freshFace(t);
  const submitted = await ctx.taskService.submit({
    operationId: `op_dup_${Date.now()}`,
    type: 'extract',
    role: 'organizer',
    input: { text: '第三段文本。', timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.task.taskId;
  await ctx.taskService.claimNext(4, ctx.epoch);
  const failure = { code: 'output_contract_invalid', message: '整理结果暂存失败。', retryable: 'manual', sideEffectSafety: 'unknown' };
  const first = await ctx.taskService.markNeedsReview(taskId, failure, { exited: false });
  assert.equal(first.state, 'needs_review');
  const afterFirst = await ctx.taskService.get(taskId);
  const eventsAfterFirst = await taskEventCount(ctx, taskId);
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1, 'exactly one pending item');
  await assert.rejects(
    () => ctx.taskService.markNeedsReview(taskId, failure, { exited: false }),
    (error) => error instanceof ServiceError,
    'the fenced duplicate is refused, not silently re-written',
  );
  const afterSecond = await ctx.taskService.get(taskId);
  assert.equal(afterSecond.version, afterFirst.version, 'no version inflation');
  assert.equal(afterSecond.attemptExitState, 'exited_unknown', 'the exit state is untouched');
  assert.equal(await taskEventCount(ctx, taskId), eventsAfterFirst, 'no phantom event');
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1, 'still exactly one pending item');
});

test('K5: a duplicate markNeedsReview(exited:true) on a needs_review task changes NOTHING', async (t) => {
  const { ctx, taskId } = await parkedTask(t);
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.markNeedsReview(taskId, { code: 'tool_execution_failed', message: '重复转核对。', retryable: 'manual', sideEffectSafety: 'unknown' }, { exited: true }),
    (error) => error instanceof ServiceError && error.code === 'state_conflict',
    'the exited variant no longer re-enters needs_review ungated',
  );
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.version, before.version, 'no version inflation');
  assert.equal(after.attemptExitState, 'exited_confirmed', 'the confirmed exit is untouched');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1, 'still exactly one pending item');
});

test('K6: two CONCURRENT markNeedsReview calls have ONE winner; the loser writes nothing', async (t) => {
  const ctx = await freshFace(t);
  const submitted = await ctx.taskService.submit({
    operationId: `op_race_${Date.now()}`,
    type: 'extract',
    role: 'organizer',
    input: { text: '第四段文本。', timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.task.taskId;
  const eventsBefore = await taskEventCount(ctx, taskId);
  const before = await ctx.taskService.get(taskId);
  const failure = { code: 'worker_lost', message: '重启时整理进程已退出。', retryable: 'manual', sideEffectSafety: 'unknown' };
  const outcomes = await Promise.allSettled([
    ctx.taskService.markNeedsReview(taskId, failure, { exited: true }),
    ctx.taskService.markNeedsReview(taskId, failure, { exited: true }),
  ]);
  const fulfilled = outcomes.filter((entry) => entry.status === 'fulfilled');
  const rejected = outcomes.filter((entry) => entry.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one producer wins');
  assert.equal(rejected.length, 1, 'the loser is refused');
  assert.ok(rejected[0].reason instanceof ServiceError, 'the loser answers a ServiceError');
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review');
  assert.equal(wire.version, before.version + 1, 'the version advanced exactly once');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore + 1, 'exactly one event, no phantom');
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1, 'exactly one pending item');
});

// --- Handler layer: the ACK wire shape over REAL HTTP ------------------------

test('H10: HTTP plain entry refuses a string CONTAINING the real receipt id with 400 and zero writes', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { withReceipt: true, withHttp: true });
  const wire = await api.get(`/api/tasks/${taskId}`);
  const receiptId = wire.body.task.recovery.receipts[0]?.receiptId;
  assert.ok(receiptId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const response = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire.body.task.recovery.itemVersion,
    decision: 'resume',
    acknowledgedReceipts: `pre_${receiptId}_post`,
  });
  assert.equal(response.status, 400, 'substring containment is not acknowledgment over the wire');
  assert.equal(response.body.error?.code, 'validation_failed');
  const after = await api.get(`/api/tasks/${taskId}`);
  assert.equal(after.body.task.state, 'needs_review', 'nothing committed');
  assert.equal(after.body.task.version, wire.body.task.version, 'no task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.verificationState, 'pending');
  assert.equal(item.version, 1);
});

test('H11: HTTP staged entry answers a NUMBER ack with 400 validation_failed, zero publication', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { withReceipt: true, stage: 'success', withHttp: true });
  const wire = await api.get(`/api/tasks/${taskId}`);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const response = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire.body.task.recovery.itemVersion,
    decision: 'resume',
    acknowledgedReceipts: 5,
  });
  assert.equal(response.status, 400, 'a number is a client shape error, never a 500');
  assert.equal(response.body.error?.code, 'validation_failed');
  const after = await api.get(`/api/tasks/${taskId}`);
  assert.equal(after.body.task.state, 'needs_review', 'the staged outcome was NOT committed');
  assert.equal(after.body.task.version, wire.body.task.version, 'no task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const candidates = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidates.every((row) => row[1] === 'staged'), 'nothing was published');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.verificationState, 'pending');
});

// --- C-4 cross-episode (MAYNE-30 fix round) ----------------------------------
//
// The Hermes probe (parent thread 01a1c2af, run on 4bf3472 original bytes)
// proved the cross-episode replay window with TWO LEGAL business rounds on ONE
// taskId: the re-entering episode INSERTED a fresh v1 pending row, so the
// episode-1 request (itemVersion 1) matched the episode-2 authority again and
// the old decision re-applied. The adjudicated frozen §12 semantics
// (web-api-contract.md:389 — ONE row per needs_review task, `version` from 1
// and +1 per change; a per-episode restart is NOT an exemption) fix this by
// REUSING the task's disposed authority line on every re-dock. These faces pin
// that on every producer of this slice, with zero state injection beyond the
// labeled authority-seam writes the file already defines: same taskId across
// rounds (never two tasks), the stale episode request answers
// `version_conflict` with ZERO side effects, and the request re-read from the
// wire succeeds. X8/X9 are handler-layer faces over REAL HTTP (no scheduler,
// no worker host, no real Pi — the same seam as H1–H11).

test('X1 THE C-4 FACE: the re-entering episode reuses ONE authority row; the stale ep1 request answers version_conflict with zero side effects; the refreshed request succeeds', async (t) => {
  const { ctx, taskId } = await parkedTask(t);
  const item1 = await recoveryItemRow(ctx, taskId);
  const ep1EntryVersion = (await ctx.taskService.get(taskId)).recovery.itemVersion;
  assert.equal(ep1EntryVersion, 1);
  // legal round-1 disposal
  await ctx.taskService.resolve(taskId, ep1EntryVersion, 'resume', []);
  // round 2 on the SAME task (claim -> park -> reclaim, business path only)
  const attempt2 = await reparkTask(ctx, taskId);
  assert.ok(attempt2);
  const wire2 = await ctx.taskService.get(taskId);
  const item2 = await recoveryItemRow(ctx, taskId);
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1, 'ONE authority row — the episode reused it (§12), not a fresh v1');
  assert.equal(item2.itemId, item1.itemId, 'same item identity across episodes');
  assert.equal(item2.verificationState, 'pending');
  assert.equal(item2.decision, null, 'the previous disposition audit is cleared');
  assert.equal(item2.decidedBy, null);
  assert.equal(item2.decidedAt, null);
  assert.equal(wire2.recovery.itemVersion, item1.version + 2, 'itemVersion advanced monotonically (created -> disposed -> reused)');
  assert.equal(wire2.recovery.itemVersion, 3);
  // THE replay: the episode-1 request, byte-for-byte the same expectedVersion
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, ep1EntryVersion, 'resume', []),
    (error) => error instanceof ServiceError && error.code === 'version_conflict',
    'the episode-1 request must be a stale version against the advanced authority',
  );
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.state, 'needs_review', 'zero task side effects');
  assert.equal(after.version, before.version, 'zero task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const itemAfter = await recoveryItemRow(ctx, taskId);
  assert.equal(itemAfter.version, wire2.recovery.itemVersion, 'the reused row untouched by the replay');
  assert.equal(itemAfter.verificationState, 'pending');
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1);
  // the request re-read from the wire succeeds
  const task = await ctx.taskService.resolve(taskId, wire2.recovery.itemVersion, 'resume', []);
  assert.equal(task.state, 'queued', 'the fresh request disposes the new episode');
});

test('X2: a stale episode-1 request never publishes the episode-2 staged candidates; the refreshed request commits once', async (t) => {
  const { ctx, taskId, attemptId: attempt1 } = await parkedTask(t);
  // ep1 exits through the PLAIN entry (resume re-queue)
  await ctx.taskService.resolve(taskId, 1, 'resume', []);
  // ep2: claim, stage a FRESH outcome, park, reclaim — the ep1-era request
  // shape (decision resume, expectedVersion 1, ack []) now routes to the
  // STAGED entry, carrying a stale version: exactly the "old staged decision"
  // the C-4 fix must not let publish the second episode's candidates.
  const attempt2 = await reparkTask(ctx, taskId, { stage: 'success' });
  assert.notEqual(attempt2, attempt1, 'a new attempt generation');
  const wire2 = await ctx.taskService.get(taskId);
  assert.equal(wire2.recovery.itemVersion, 3, 'the ep2 dock reused and advanced the line');
  const candidatesBefore = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidatesBefore.length >= 1 && candidatesBefore.every((row) => row[1] === 'staged'));
  const eventsBefore = await taskEventCount(ctx, taskId);
  // THE replay: the ep1-era staged-shaped request (attempt1, ev 1)
  await assert.rejects(
    () => ctx.textIntake.commitStagedResume(taskId, attempt1, 1, []),
    (error) => error instanceof ServiceError && error.code === 'version_conflict',
    'the old staged decision must not publish the second episode\'s candidates',
  );
  assert.equal((await ctx.taskService.get(taskId)).state, 'needs_review', 'zero task side effects');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const afterReplay = await stagedCandidateRows(ctx, taskId);
  assert.deepEqual(afterReplay, candidatesBefore, 'nothing was published by the stale request');
  assert.equal((await recoveryItemRow(ctx, taskId)).version, wire2.recovery.itemVersion, 'the authority row untouched');
  // the fresh ep2 request commits the ep2 outcome exactly once
  const task = await ctx.textIntake.commitStagedResume(taskId, attempt2, wire2.recovery.itemVersion, []);
  assert.equal(task.state, 'succeeded');
  const published = await stagedCandidateRows(ctx, taskId);
  assert.equal(published.length, candidatesBefore.length, 'published exactly once');
  assert.ok(published.every((row) => row[1] === 'pending'), 'the ep2 candidates are published');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, wire2.recovery.itemVersion + 1);
  assert.equal(item.verificationState, 'resumed');
});

test('X3: the restart-recovery classify path reuses the disposed line too — cross-episode stale replay refused', async (t) => {
  const ctx = await freshFace(t);
  const submitted = await ctx.taskService.submit({
    operationId: `op_c4_x3_${Date.now()}`,
    type: 'extract',
    role: 'organizer',
    input: { configRevision: 'rev-1', payload: { kind: 'synthetic' } },
  });
  const taskId = submitted.task.taskId;
  // ep1: claim (the worker "dies" mid-run: no worker record, dead pid), then
  // the real restart scan classifies it.
  await ctx.taskService.claimNext(4, ctx.epoch);
  const scan1 = await ctx.taskRecovery.recover();
  assert.equal(scan1.recovered, 1);
  const wire1 = await ctx.taskService.get(taskId);
  assert.equal(wire1.state, 'needs_review');
  assert.equal(wire1.recovery.cause, 'restart_unknown_side_effect');
  assert.equal(wire1.recovery.itemVersion, 1);
  const item1 = await recoveryItemRow(ctx, taskId);
  await ctx.taskService.resolve(taskId, 1, 'resume', []);
  // ep2: claim again (running), the restart scan classifies again.
  await ctx.taskService.claimNext(4, ctx.epoch);
  const scan2 = await ctx.taskRecovery.recover();
  assert.equal(scan2.recovered, 1);
  const wire2 = await ctx.taskService.get(taskId);
  assert.equal(wire2.state, 'needs_review');
  assert.equal(wire2.recovery.itemVersion, 3, 'classify reused and advanced the line — no fresh v1');
  const item2 = await recoveryItemRow(ctx, taskId);
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1, 'ONE row after two classify episodes');
  assert.equal(item2.itemId, item1.itemId, 'same item identity across restarts');
  assert.equal(item2.verificationState, 'pending');
  assert.equal(item2.decision, null, 'the previous disposition audit is cleared');
  // the ep1 request replay
  const eventsBefore = await taskEventCount(ctx, taskId);
  const before = await ctx.taskService.get(taskId);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', []),
    (error) => error instanceof ServiceError && error.code === 'version_conflict',
  );
  assert.equal((await ctx.taskService.get(taskId)).version, before.version, 'zero side effects');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  // the fresh request succeeds
  const task = await ctx.taskService.resolve(taskId, wire2.recovery.itemVersion, 'resume', []);
  assert.equal(task.state, 'queued');
});

test('X4: two CONCURRENT restart scans classify the SAME running attempt — ONE winner, exactly one pending item, no phantom event', async (t) => {
  const ctx = await freshFace(t);
  const submitted = await ctx.taskService.submit({
    operationId: `op_c4_x4_${Date.now()}`,
    type: 'extract',
    role: 'organizer',
    input: { configRevision: 'rev-1', payload: { kind: 'synthetic' } },
  });
  const taskId = submitted.task.taskId;
  await ctx.taskService.claimNext(4, ctx.epoch);
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const outcomes = await Promise.allSettled([
    ctx.taskRecovery.recover(),
    ctx.taskRecovery.recover(),
  ]);
  const rejected = outcomes.filter((entry) => entry.status === 'rejected');
  assert.ok(outcomes.some((entry) => entry.status === 'fulfilled'), 'at least one scan completes');
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review');
  assert.equal(wire.version, before.version + 1, 'the task version advanced exactly once');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore + 1, 'exactly one event, no phantom');
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1, 'exactly one pending item — no double dock');
  for (const entry of rejected) {
    assert.ok(entry.reason instanceof ServiceError, 'a losing producer answers a ServiceError');
  }
});

test('X5: markNeedsReview re-dock reuses the disposed line across episodes — stale replay refused, fresh request succeeds', async (t) => {
  const ctx = await freshFace(t);
  const submitted = await ctx.taskService.submit({
    operationId: `op_c4_x5_${Date.now()}`,
    type: 'extract',
    role: 'organizer',
    input: { text: '第五段文本。', timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.task.taskId;
  // The registered cause rides along exactly like the real producers'
  // envelopes do (a needs_review task without a recovery cause is a
  // non-contract state — its recovery object would be null).
  const failure = { code: 'output_contract_invalid', message: '整理结果暂存失败。', retryable: 'manual', sideEffectSafety: 'unknown', cause: 'failure_unknown_side_effect' };
  // ep1: worker-done failure path parks the task
  await ctx.taskService.claimNext(4, ctx.epoch);
  await ctx.taskService.markNeedsReview(taskId, failure, { exited: false });
  await reclaim(ctx);
  const item1 = await recoveryItemRow(ctx, taskId);
  assert.equal(item1.version, 1);
  await ctx.taskService.resolve(taskId, 1, 'resume', []);
  // ep2: the same producer parks the SAME task again
  await ctx.taskService.claimNext(4, ctx.epoch);
  await ctx.taskService.markNeedsReview(taskId, failure, { exited: false });
  await reclaim(ctx);
  const item2 = await recoveryItemRow(ctx, taskId);
  assert.equal(await pendingRecoveryRowCount(ctx, taskId), 1, 'ONE row — the markNeedsReview re-dock reused it');
  assert.equal(item2.itemId, item1.itemId, 'same item identity across episodes');
  assert.equal(item2.version, 3, 'advanced monotonically, no fresh v1');
  assert.equal(item2.verificationState, 'pending');
  assert.equal(item2.decision, null);
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, 1, 'resume', []),
    (error) => error instanceof ServiceError && error.code === 'version_conflict',
    'the ep1 request is stale for the ep2 authority',
  );
  const wire = await ctx.taskService.get(taskId);
  const task = await ctx.taskService.resolve(taskId, wire.recovery.itemVersion, 'resume', []);
  assert.equal(task.state, 'queued');
});

test('X6: a stale attempt attribution cannot dispose the current episode — the staged entry refuses a foreign attemptId with zero writes, same episode and cross-episode', async (t) => {
  const { ctx, taskId, attemptId: attempt1 } = await parkedTask(t);
  // SAME episode: the true item version but a foreign attempt id — the
  // attribution gate refuses before any disposition (R8-M-1 fence, unchanged;
  // the refusal needs no staged window).
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.textIntake.commitStagedResume(taskId, 'att_foreign_stale', 1, []),
    (error) => error instanceof ServiceError && error.code === 'state_conflict',
    'the ep1 attempt attribution refuses a foreign attempt even with the true item version',
  );
  assert.equal((await ctx.taskService.get(taskId)).version, before.version, 'zero task side effects');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  assert.equal((await recoveryItemRow(ctx, taskId)).version, 1, 'the authority row untouched');
  // CROSS-EPISODE: ep1 disposes plain; ep2 parks staged — the ep1 attempt id
  // must never dispose the ep2 episode (attempt attribution does not
  // regress), and the ep2 attribution commits.
  await ctx.taskService.resolve(taskId, 1, 'resume', []);
  const attempt2 = await reparkTask(ctx, taskId, { stage: 'success' });
  const wire2 = await ctx.taskService.get(taskId);
  assert.equal(wire2.recovery.itemVersion, 3, 'the ep2 dock reused and advanced the line');
  const candidates2 = await stagedCandidateRows(ctx, taskId);
  await assert.rejects(
    () => ctx.textIntake.commitStagedResume(taskId, attempt1, wire2.recovery.itemVersion, []),
    (error) => error instanceof ServiceError && error.code === 'state_conflict',
    'the ep1 attempt id cannot dispose the ep2 episode',
  );
  assert.equal((await ctx.taskService.get(taskId)).version, wire2.version, 'zero task side effects');
  assert.deepEqual(await stagedCandidateRows(ctx, taskId), candidates2, 'nothing published');
  const task = await ctx.textIntake.commitStagedResume(taskId, attempt2, wire2.recovery.itemVersion, []);
  assert.equal(task.state, 'succeeded', 'the ep2 attribution commits the ep2 outcome');
});

test('X7: a dock onto a task with a live PENDING row is REFUSED — no second row, no fork of the authority', async (t) => {
  const ctx = await freshFace(t);
  const submitted = await ctx.taskService.submit({
    operationId: `op_c4_x7_${Date.now()}`,
    type: 'extract',
    role: 'organizer',
    input: { text: '第七段文本。', timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.task.taskId;
  const claimed = await ctx.taskService.claimNext(4, ctx.epoch);
  // The labeled authority-seam injection: a pending row while the task is
  // RUNNING is an anomaly no legal flow writes (the previous episode never
  // lawfully ended). The dock must refuse it visibly — the same defense the
  // resolve entries answer an ambiguous authority with.
  await injectPendingRecoveryItem(ctx, taskId);
  const rowsBefore = await ctx.taskService.query(
    'SELECT item_id,version,verification_state FROM recovery_items WHERE task_id=? ORDER BY rowid',
    [taskId],
  );
  const before = await ctx.taskService.get(taskId);
  const eventsBefore = await taskEventCount(ctx, taskId);
  await assert.rejects(
    () => ctx.taskService.confirmExit(taskId, claimed.attemptId, { exited: false }),
    (error) => error instanceof ServiceError && error.code === 'state_conflict',
    'the dock refuses a live pending authority instead of forking it',
  );
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.state, before.state, 'the task was NOT parked by the refused dock');
  assert.equal(after.version, before.version, 'zero task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const rowsAfter = await ctx.taskService.query(
    'SELECT item_id,version,verification_state FROM recovery_items WHERE task_id=? ORDER BY rowid',
    [taskId],
  );
  assert.deepEqual(rowsAfter, rowsBefore, 'the authority rows are untouched');
});

test('X8: HTTP cross-episode — the stale ep1 resolve request answers 409 with zero writes; the refreshed request answers 202', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { withHttp: true });
  const wire1 = await api.get(`/api/tasks/${taskId}`);
  assert.equal(wire1.body.task.recovery.itemVersion, 1);
  const first = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire1.body.task.recovery.itemVersion,
    decision: 'resume',
  });
  assert.equal(first.status, 202, 'the ep1 request was legal in ep1');
  // ep2 on the SAME task
  await reparkTask(ctx, taskId);
  const wire2 = await api.get(`/api/tasks/${taskId}`);
  assert.equal(wire2.body.task.recovery.itemVersion, 3, 'the wire exposes the advanced authority version');
  // THE replay: the ep1 request over the wire again
  const before = await api.get(`/api/tasks/${taskId}`);
  const eventsBefore = await taskEventCount(ctx, taskId);
  const replay = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire1.body.task.recovery.itemVersion,
    decision: 'resume',
  });
  assert.equal(replay.status, 409, 'the cross-episode stale request is a version conflict on the wire');
  assert.equal(replay.body.error?.code, 'version_conflict');
  const after = await api.get(`/api/tasks/${taskId}`);
  assert.equal(after.body.task.state, 'needs_review', 'zero task side effects');
  assert.equal(after.body.task.version, before.body.task.version, 'no task version bump');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  const item = await recoveryItemRow(ctx, taskId);
  assert.equal(item.version, wire2.body.task.recovery.itemVersion, 'the authority row untouched');
  assert.equal(item.verificationState, 'pending');
  // the refreshed request succeeds
  const fresh = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire2.body.task.recovery.itemVersion,
    decision: 'resume',
  });
  assert.equal(fresh.status, 202);
  assert.equal(fresh.body.task.state, 'queued');
});

test('X9: HTTP cross-episode staged entry — the old ep1 request never publishes the ep2 staged candidates; the refreshed request commits them', async (t) => {
  const { ctx, api, taskId } = await parkedTask(t, { withHttp: true });
  // ep1: a plain (unstered) park, disposed legally over HTTP
  const wire1 = await api.get(`/api/tasks/${taskId}`);
  const first = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire1.body.task.recovery.itemVersion,
    decision: 'resume',
  });
  assert.equal(first.status, 202);
  // ep2: claim, stage a FRESH outcome, park, reclaim — the resolve request now
  // routes to the STAGED entry (resultPendingExit), so the ep1-era request
  // (expectedVersion 1, ack []) lands on the staged path carrying a stale
  // version: exactly the "old staged decision" the C-4 fix must not let
  // publish the second episode's candidates.
  await reparkTask(ctx, taskId, { stage: 'success' });
  const wire2 = await api.get(`/api/tasks/${taskId}`);
  assert.equal(wire2.body.task.resultPendingExit, true);
  assert.equal(wire2.body.task.recovery.itemVersion, 3);
  const candidatesBefore = await stagedCandidateRows(ctx, taskId);
  assert.ok(candidatesBefore.length >= 1 && candidatesBefore.every((row) => row[1] === 'staged'));
  const eventsBefore = await taskEventCount(ctx, taskId);
  const replay = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire1.body.task.recovery.itemVersion,
    decision: 'resume',
  });
  assert.equal(replay.status, 409, 'the stale request is refused by the staged entry too');
  assert.equal(replay.body.error?.code, 'version_conflict');
  assert.equal((await api.get(`/api/tasks/${taskId}`)).body.task.state, 'needs_review', 'zero task side effects');
  assert.equal(await taskEventCount(ctx, taskId), eventsBefore, 'no phantom event');
  assert.deepEqual(await stagedCandidateRows(ctx, taskId), candidatesBefore, 'nothing was published by the old decision');
  const fresh = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: wire2.body.task.recovery.itemVersion,
    decision: 'resume',
  });
  assert.equal(fresh.status, 202, 'the refreshed request commits through the same handler');
  assert.equal(fresh.body.task.state, 'succeeded');
  const published = await stagedCandidateRows(ctx, taskId);
  assert.equal(published.length, candidatesBefore.length, 'published exactly once');
  assert.ok(published.every((row) => row[1] === 'pending'), 'the ep2 candidates are published');
});

// --- C-4 revision (Codex findings A/B/C/D, MAYNE-30 started_2) ---------------
// The rejected candidate `5623fae` closed the replay window for the resolve
// entries but left the CLASSIFY producer and the dock's commit-time premises
// open: a stale scan result (a resolve + re-claim between the scan and the
// classify) could still park the new attempt (A/B/C), the fresh INSERT could
// not prove at commit that no line existed, and several disposed legacy lines
// were guessed by rowid DESC instead of refused (D). Y1–Y4 pin the revised
// fences; each was RED on the rejected candidate bytes on its named symptom.

async function capture(fn) {
  try { return await fn(); } catch (error) { return error.code ?? error.message; }
}

async function snapshot(ctx, taskId) {
  const task = await ctx.taskService.get(taskId);
  return {
    state: task.state,
    version: task.version,
    attemptExitState: task.attemptExitState,
    items: await ctx.taskService.query(
      'SELECT item_id,version,verification_state FROM recovery_items WHERE task_id=? ORDER BY rowid',
      [taskId],
    ),
    attempts: await ctx.taskService.query(
      'SELECT attempt_id,ended_at,exit_confirmed_at FROM task_attempts WHERE task_id=? ORDER BY rowid',
      [taskId],
    ),
    events: await ctx.taskService.query(
      'SELECT object_version,payload FROM task_events WHERE object_id=? ORDER BY cursor',
      [taskId],
    ),
    candidates: await ctx.taskService.query(
      'SELECT candidate_id,status FROM candidates WHERE run_id=? ORDER BY rowid',
      [taskId],
    ),
  };
}

test('Y1: a late running classification of attempt A must not confirm/dock the active attempt B', async (t) => {
  const ctx = await freshFace(t);
  const submitted = await ctx.textIntake.submitSource(`review_y1_${crypto.randomUUID()}`, {
    text: '请整理合成审查清单。', timeZone: 'Asia/Shanghai',
  });
  const taskId = submitted.task.taskId;
  const claim = await ctx.taskService.claimNext(4, ctx.epoch);
  assert.equal(claim.row.taskId, taskId);
  const attemptA = claim.attemptId;
  const scanA = (await ctx.taskRecovery.unfinishedAttempts())[0];
  assert.equal(scanA.attemptId, attemptA);
  // Legal round 1: the real scan classifies A, then the user resumes and a
  // fresh attempt B is claimed — the scan result is now stale.
  await ctx.taskRecovery.recover();
  await ctx.taskService.resolve(taskId, 1, 'resume', []);
  const attemptB = (await ctx.taskService.claimNext(4, ctx.epoch)).attemptId;
  assert.notEqual(attemptA, attemptB);
  const before = await snapshot(ctx, taskId);
  const outcome = await capture(() => ctx.taskRecovery.classify(scanA, syntheticExitEvidence()));
  const after = await snapshot(ctx, taskId);
  assert.equal(outcome, 'version_conflict', 'the stale scan is refused by its lost scan-time version premise');
  assert.deepEqual(after, before, 'the obsolete classification leaves task/item/event untouched');
});

test('Y2: a delayed classification transaction must reject running ABA across attempts — no fresh v1, and the real-HTTP replay is refused', async (t) => {
  const ctx = await freshFace(t, { withHttp: true });
  const submitted = await ctx.textIntake.submitSource(`review_y2_${crypto.randomUUID()}`, {
    text: '请整理合成审查清单。', timeZone: 'Asia/Shanghai',
  });
  const taskId = submitted.task.taskId;
  await ctx.taskService.claimNext(4, ctx.epoch);
  const scanA = (await ctx.taskRecovery.unfinishedAttempts())[0];
  // Deterministic interleaving: hold the FIRST classify transaction just
  // before its stdio commit, let a fresh scan + a legal resolve + a new claim
  // run, then release it. All services and the storage are real.
  const original = ctx.storage.command.bind(ctx.storage);
  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  ctx.storage.command = (command, params) => {
    if (!held && command === 'transact'
      && params.ops?.some((op) => op.sql.includes("state='needs_review',attempt_exit_state='exited_confirmed'"))) {
      held = true;
      enter();
      return gate.then(() => original(command, params));
    }
    return original(command, params);
  };
  const pending = capture(() => ctx.taskRecovery.classify(scanA, syntheticExitEvidence()));
  try {
    await entered;
    await ctx.taskRecovery.recover();
    const oldRequest = { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] };
    const firstResponse = await ctx.api.post(`/api/tasks/${taskId}/resolve`, oldRequest);
    assert.equal(firstResponse.status, 202, 'the first-round request is legal in round 1');
    const attemptB = (await ctx.taskService.claimNext(4, ctx.epoch)).attemptId;
    assert.notEqual(scanA.attemptId, attemptB, 'a new attempt generation');
    const before = await snapshot(ctx, taskId);
    release();
    const outcome = await pending;
    const after = await snapshot(ctx, taskId);
    assert.equal(outcome, 'version_conflict', 'the held stale transaction is refused at commit, not applied to attempt B');
    assert.deepEqual(after, before, 'the refused classification wrote no item, event or task change');
    // THE replay over real HTTP: the round-1 request must not dispose round 2.
    const replay = await ctx.api.post(`/api/tasks/${taskId}/resolve`, oldRequest);
    assert.equal(replay.status, 409, 'the stale request is refused on the wire');
    assert.equal(replay.body.error?.code, 'state_conflict');
    assert.deepEqual(await snapshot(ctx, taskId), before, 'the replay wrote nothing');
  } finally {
    release();
    await pending;
    ctx.storage.command = original;
  }
});

test('Y3: a late needs_review classification of A must not mark the current running B exited_confirmed', async (t) => {
  const ctx = await freshFace(t);
  const { taskId, attemptId: attemptA } = await parkTask(ctx);
  const scanA = (await ctx.taskRecovery.unfinishedAttempts())[0];
  assert.equal(scanA.state, 'needs_review');
  await reclaim(ctx);
  await ctx.taskService.resolve(taskId, 1, 'resume', []);
  const attemptB = (await ctx.taskService.claimNext(4, ctx.epoch)).attemptId;
  assert.notEqual(attemptA, attemptB);
  const before = await snapshot(ctx, taskId);
  const outcome = await capture(() => ctx.taskRecovery.classify(scanA, syntheticExitEvidence()));
  const after = await snapshot(ctx, taskId);
  assert.equal(outcome, 'version_conflict', 'the stale needs_review scan is refused by its lost premise');
  assert.deepEqual(after, before, 'the old exit observation may not release the slot or emit an event for B');
});

test('Y4: several lawfully disposed legacy rows must be REFUSED, not guessed by rowid DESC', async (t) => {
  const ctx = await freshFace(t);
  const { taskId } = await parkTask(ctx);
  await reclaim(ctx);
  await ctx.taskService.resolve(taskId, 1, 'resume', []);
  // Reproduce the pre-C4 legacy history at the authority seam: a SECOND
  // disposed line (the former per-episode fresh-v1 dock). No business writer
  // of this tree creates it — the §12 dock reuses the single line.
  await injectDisposedRecoveryItem(ctx, taskId, 2);
  const claim = await ctx.taskService.claimNext(4, ctx.epoch);
  const before = await snapshot(ctx, taskId);
  assert.equal(before.items.length, 2, 'two disposed history rows are present');
  assert.ok(before.items.every((row) => row[2] === 'resumed'));
  const outcome = await capture(() => ctx.textIntake.confirmExtractExit(taskId, claim.attemptId, { exited: false, epoch: ctx.epoch }));
  const after = await snapshot(ctx, taskId);
  assert.equal(outcome, 'state_conflict', 'an ambiguous history requires a visible refusal');
  assert.deepEqual(after, before, 'the dock must not guess which historical row to reuse');
});

test('MISSING OBSERVER counter-control: no host observer means insufficient evidence, never a registry assertion', async (t) => {
  const ctx = await freshFace(t);
  const { taskId } = await parkTask(ctx);
  // A recovery with NO host observer (the crash-window / restored-root shape):
  // the scan must fail closed and leave the slot held and resolve refused.
  const { TaskRecovery } = await import('../../server/lib/task-recovery.mjs');
  const bare = new TaskRecovery({ storage: ctx.storage, taskService: ctx.taskService, root: ctx.root, epoch: ctx.epoch });
  const report = await bare.recover();
  assert.equal(report.recovered, 0, 'no observer => no release');
  assert.ok(report.unverified.some((entry) => entry.reason === 'exit_evidence_unavailable'));
  const wire = await ctx.taskService.get(taskId);
  assert.equal(wire.state, 'needs_review');
  assert.equal(wire.attemptExitState, 'exited_unknown', 'the exit stays unconfirmed');
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, wire.recovery.itemVersion, 'resume', []),
    (error) => /exit_unconfirmed/.test(error?.code ?? ''),
    'a bare resolve must be refused while the exit is unconfirmed',
  );
});
