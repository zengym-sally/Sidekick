import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInstance,
  syntheticExitEvidence,
  taskEventCount,
} from '../fixtures/web-text-intake/recovery-authority-instance.mjs';

async function parked(ctx, { closed = true, cancel = false, outcome = null } = {}) {
  const submitted = await ctx.taskService.submit({
    operationId: crypto.randomUUID(), type: 'extract', role: 'organizer',
    input: { text: '合成恢复测试输入', timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.task.taskId;
  const { attemptId } = await ctx.taskService.claimNext(4, ctx.epoch);
  await ctx.taskService.recordReceipt({
    runId: `run_${attemptId}`, taskId, attemptId, epoch: ctx.epoch,
    kind: 'lark_message_send', callKey: 'synthetic-call',
    externalRef: 'synthetic-receipt', provableReadonly: false,
  });
  if (outcome) {
    assert.equal(await ctx.taskService.stageResult(taskId, attemptId, ctx.epoch, outcome,
      outcome === 'succeeded' ? { kind: 'synthetic', value: 1 } : { code: 'model_error', message: 'Synthetic failure' }), true);
  }
  if (cancel) await ctx.taskService.cancel(taskId);
  if (closed) {
    assert.equal(await ctx.taskService.confirmExit(taskId, attemptId, { exited: false }), 'needs_review');
  } else {
    await ctx.taskService.markNeedsReview(taskId, {
      code: 'worker_lost', message: 'Synthetic unknown exit',
      cause: outcome ? 'result_exit_unconfirmed' : 'exit_unconfirmed',
    });
  }
  return { taskId, attemptId };
}

for (const closed of [false, true]) {
  for (const cancel of [false, true]) {
    for (const outcome of [null, 'succeeded', 'failed']) {
      test(`reclaim ${closed ? 'closed' : 'open'} unknown attempt: cancel=${cancel}, staged=${outcome}`, async (t) => {
        const ctx = await createInstance();
        t.after(() => ctx.close());
        const { taskId, attemptId } = await parked(ctx, { closed, cancel, outcome });
        const before = ctx.taskService.rowToInternal(await ctx.taskService.getTaskRow(taskId));
        const events = await taskEventCount(ctx, taskId);
        const result = await ctx.taskRecovery.recover();
        assert.equal(result.recovered, 1);
        assert.equal(result.unverified.length, 0);
        const after = ctx.taskService.rowToInternal(await ctx.taskService.getTaskRow(taskId));
        assert.equal(after.state, 'needs_review');
        assert.equal(after.attemptExitState, 'exited_confirmed');
        assert.equal(after.version, before.version + 1);
        assert.equal(after.cancelIntent, before.cancelIntent);
        assert.equal(after.resultPendingExit, before.resultPendingExit);
        assert.equal(after.pendingOutcome, before.pendingOutcome);
        assert.deepEqual(after.resultRef, before.resultRef);
        assert.equal(await taskEventCount(ctx, taskId), events + 1);
        if (cancel) assert.equal((await ctx.taskService.get(taskId)).recovery.cause, 'cancel_unknown_side_effect');
        const rows = await ctx.taskService.query('SELECT exit_confirmed_at FROM task_attempts WHERE attempt_id=?', [attemptId]);
        assert.equal(typeof rows[0][0], 'number');
        const repeated = await ctx.taskRecovery.recover();
        assert.equal(repeated.recovered, 0);
        assert.equal((await ctx.taskService.get(taskId)).version, after.version);
        assert.equal(await taskEventCount(ctx, taskId), events + 1);
      });
    }
  }
}

test('concurrent reclaim counts one transition and emits one event', async (t) => {
  const ctx = await createInstance();
  t.after(() => ctx.close());
  const { taskId } = await parked(ctx);
  const events = await taskEventCount(ctx, taskId);
  const results = await Promise.all([ctx.taskRecovery.recover(), ctx.taskRecovery.recover()]);
  assert.equal(results.reduce((sum, result) => sum + result.recovered, 0), 1);
  assert.equal(await taskEventCount(ctx, taskId), events + 1);
});

test('a stale reclaim cannot confirm a newly claimed attempt after resolve', async (t) => {
  const ctx = await createInstance();
  t.after(() => ctx.close());
  const { taskId, attemptId } = await parked(ctx);
  const [scan] = await ctx.taskRecovery.unfinishedAttempts();
  await ctx.taskRecovery.recover();
  const wire = await ctx.taskService.get(taskId);
  await ctx.taskService.resolve(taskId, wire.recovery.itemVersion, 'resume',
    wire.recovery.receipts.map((receipt) => receipt.receiptId));
  const claimed = await ctx.taskService.claimNext(4, ctx.epoch);
  assert.notEqual(claimed.attemptId, attemptId);
  const events = await taskEventCount(ctx, taskId);
  await assert.rejects(() => ctx.taskRecovery.classify(scan, syntheticExitEvidence()), { code: 'version_conflict' });
  assert.equal((await ctx.taskService.get(taskId)).attemptExitState, 'active');
  assert.equal(await taskEventCount(ctx, taskId), events);
});

test('a refused classification is reported as unverified rather than recovered', async (t) => {
  const ctx = await createInstance();
  t.after(() => ctx.close());
  await parked(ctx);
  ctx.taskRecovery.classify = async () => false;
  const result = await ctx.taskRecovery.recover();
  assert.equal(result.recovered, 0);
  assert.equal(result.unverified.length, 1);
});
