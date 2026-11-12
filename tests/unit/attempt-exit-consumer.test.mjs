//! Consumer-side typed exit evidence (MAYNE-35 bounded delivery 3;
//! web-api/2 §3.1.1/§3.2.1).
//!
//! The task service must discriminate on the typed verdict, fail closed on a
//! missing evidence, persist the evidence beside the attempt, and expose it on
//! the wire resource under `web-api/2`. Expectations come from the frozen
//! contract, not from the implementation's own outputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StorageClient } from '../../server/lib/storage-client.mjs';
import { TaskService } from '../../server/lib/task-service.mjs';
import { buildAttemptExitEvidence } from '../../server/lib/attempt-exit-evidence.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const storageBinary = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');

class PrerequisiteGap extends Error {}
function requireBinary() {
  if (!existsSync(storageBinary)) {
    throw new PrerequisiteGap(`storage adapter binary not found at ${storageBinary}; build it with cargo.`);
  }
}

async function setup() {
  requireBinary();
  const root = mkdtempSync(join(tmpdir(), 'w1-exit-consumer-'));
  const storage = new StorageClient({ binary: storageBinary, root, initialize: true });
  await storage.start();
  const taskService = new TaskService({ storage, root });
  return {
    root, storage, taskService,
    async stop() { await storage.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

function extinctEvidence() {
  return buildAttemptExitEvidence({
    workerExited: true, groupObservation: 'esrch', members: [],
    argvScan: { performed: true, hits: [] }, strayLedger: null,
  });
}

function survivorEvidence() {
  return buildAttemptExitEvidence({
    workerExited: true, groupObservation: 'esrch',
    members: [{
      pid: 424242, identity: { lstart: 'lstart-1', command: 'cmd-1', nonce: null },
      sourceFrame: 'worker_frame', registeredAt: '2026-11-11T00:00:00.000Z',
      observation: 'alive', evidence: 'proof-matched alive',
    }],
    argvScan: { performed: true, hits: [] }, strayLedger: null,
  });
}

async function submitAndClaim(taskService, operationId) {
  const submitted = await taskService.submit({
    operationId, type: 'extract', role: 'organizer',
    input: { text: '消费者证据面：合成整理输入。', timeZone: 'Asia/Shanghai' },
  });
  const claimed = await taskService.claimNext(4, 'inst_consumer_test');
  assert.ok(claimed, 'the fresh task must be claimed');
  return { taskId: submitted.task.taskId, attemptId: claimed.attemptId };
}

/// Seed the attempt's run record (the worker-host writes this at spawn) so the
/// typed evidence has a run directory to bind to.
function seedRunRecord(ctx, attemptId) {
  const runId = 'run_consumer_test';
  const dir = join(ctx.root, 'runs', runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'worker.json'), JSON.stringify({
    runId, attemptId, taskId: 'tsk_consumer', pid: null, pgid: null, children: [],
  }), { mode: 0o600 });
  return runId;
}

test('the wire envelope is web-api/2 and a registry_extinct verdict releases the slot', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const { taskId, attemptId } = await submitAndClaim(ctx.taskService, 'op_consumer_version');

  const active = await ctx.taskService.get(taskId);
  assert.equal(active.contractVersion, 'web-api/2');
  assert.equal(active.attemptExitState, 'active');
  assert.equal(active.attemptExitEvidence, null, 'an active attempt carries no typed evidence');

  await ctx.taskService.stageResult(taskId, attemptId, 'inst_consumer_test', 'succeeded', {
    kind: 'organize_text_result', payloadRef: `result://${attemptId}/payload`,
  });
  const evidence = extinctEvidence();
  seedRunRecord(ctx, attemptId);
  assert.equal(ctx.taskService.persistAttemptExitEvidence(attemptId, evidence), 'run_consumer_test');
  const outcome = await ctx.taskService.confirmExit(taskId, attemptId, { evidence });
  assert.equal(outcome, 'succeeded');

  const after = await ctx.taskService.get(taskId);
  assert.equal(after.attemptExitState, 'exited_confirmed');
  assert.equal(after.attemptExitEvidence.verdict, 'registry_extinct');
  assert.equal(after.attemptExitEvidence.residual.treeExtinctProven, false);
});

test('a known survivor vetoes: needs_review + exited_unknown + resolve 409', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const { taskId, attemptId } = await submitAndClaim(ctx.taskService, 'op_consumer_survivor');

  await ctx.taskService.stageResult(taskId, attemptId, 'inst_consumer_test', 'succeeded', {
    kind: 'organize_text_result', payloadRef: `result://${attemptId}/payload`,
  });
  const evidence = survivorEvidence();
  seedRunRecord(ctx, attemptId);
  ctx.taskService.persistAttemptExitEvidence(attemptId, evidence);
  const outcome = await ctx.taskService.confirmExit(taskId, attemptId, { evidence });
  assert.equal(outcome, 'needs_review');

  const after = await ctx.taskService.get(taskId);
  assert.equal(after.state, 'needs_review');
  assert.equal(after.attemptExitState, 'exited_unknown', 'a known survivor keeps the attempt unconfirmed');
  assert.equal(after.attemptExitEvidence.verdict, 'unresolved');
  assert.equal(after.attemptExitEvidence.veto.reason, 'known_survivor');
  await assert.rejects(
    () => ctx.taskService.resolve(taskId, after.recovery.itemVersion, 'resume', []),
    (error) => /exit_unconfirmed/.test(error?.code ?? '') || /退出尚未确认/.test(error?.message ?? ''),
    'resolve must be refused while the exit is unconfirmed',
  );
});

test('a missing evidence fails closed: the slot is never released', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const { taskId, attemptId } = await submitAndClaim(ctx.taskService, 'op_consumer_missing');

  await ctx.taskService.stageResult(taskId, attemptId, 'inst_consumer_test', 'succeeded', {
    kind: 'organize_text_result', payloadRef: `result://${attemptId}/payload`,
  });
  const outcome = await ctx.taskService.confirmExit(taskId, attemptId, { evidence: null });
  assert.equal(outcome, 'needs_review', 'a missing evidence must not release the slot');

  const after = await ctx.taskService.get(taskId);
  assert.equal(after.attemptExitState, 'exited_unknown');
  assert.equal(after.attemptExitEvidence, null, 'no evidence is invented from the state field');
});

test('a forged (never persisted) evidence fails closed', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const { taskId, attemptId } = await submitAndClaim(ctx.taskService, 'op_consumer_forged');
  await ctx.taskService.stageResult(taskId, attemptId, 'inst_consumer_test', 'succeeded', {
    kind: 'organize_text_result', payloadRef: `result://${attemptId}/payload`,
  });
  const outcome = await ctx.taskService.confirmExit(taskId, attemptId, { evidence: extinctEvidence() });
  assert.equal(outcome, 'needs_review', 'an evidence that was never persisted must not release the slot');
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.attemptExitState, 'exited_unknown');
});

test('a persistence failure (the evidence path is a directory) fails closed', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const { taskId, attemptId } = await submitAndClaim(ctx.taskService, 'op_consumer_eisdir');
  seedRunRecord(ctx, attemptId);
  // Occupy the evidence path with a DIRECTORY so the write fails (EISDIR).
  mkdirSync(join(ctx.root, 'runs', 'run_consumer_test', 'attempt-exit-evidence.json'), { recursive: true });
  const evidence = extinctEvidence();
  assert.equal(ctx.taskService.persistAttemptExitEvidenceStrict(attemptId, evidence), false);
  const outcome = await ctx.taskService.confirmExit(taskId, attemptId, { evidence });
  assert.equal(outcome, 'needs_review', 'a failed persistence must not release the slot');
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.attemptExitState, 'exited_unknown');
});

test('the typed evidence is persisted beside the attempt and read back on the wire', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const { taskId, attemptId } = await submitAndClaim(ctx.taskService, 'op_consumer_persist');

  // Without a run record there is no run directory to bind: the evidence is
  // not persisted and the wire surfaces null rather than inventing one.
  assert.equal(ctx.taskService.readAttemptExitEvidence(attemptId), null);
  assert.equal(ctx.taskService.persistAttemptExitEvidence(attemptId, extinctEvidence()), null);

  // With the worker record present, the evidence persists and the wire reads it.
  seedRunRecord(ctx, attemptId);
  const evidence = extinctEvidence();
  assert.equal(ctx.taskService.persistAttemptExitEvidence(attemptId, evidence), 'run_consumer_test');
  assert.deepEqual(ctx.taskService.readAttemptExitEvidence(attemptId), evidence);

  // A structurally corrupt evidence file is surfaced as null (fail closed).
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    join(ctx.root, 'runs', 'run_consumer_test', 'attempt-exit-evidence.json'),
    '{"verdict":"registry_extinct"}',
  );
  assert.equal(ctx.taskService.readAttemptExitEvidence(attemptId), null, 'a corrupt evidence is never surfaced');
});
