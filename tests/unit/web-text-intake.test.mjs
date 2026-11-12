//! Service-layer tests for the W1 text-intake slice (MAYNE-24 item I).
//!
//! These exercise the transactional behaviour of TextIntakeService and
//! TaskService against the real Rust storage adapter — no HTTP, no browser. The
//! assertions are the ones the frozen contract makes falsifiable: dedup by
//! fingerprint, version guards, staged invisibility, batch atomicity, the
//! deterministic `sign_off:` keys and the agentConcurrency CAS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StorageClient } from '../../server/lib/storage-client.mjs';
import { createInstance } from '../fixtures/web-text-intake/recovery-authority-instance.mjs';
import { TaskService } from '../../server/lib/task-service.mjs';
import { TextIntakeService, deriveSignOffKey } from '../../server/lib/text-intake-service.mjs';
import { ConfigStore } from '../../server/lib/config-store.mjs';
import { ControlledCredentialProvider } from '../../server/lib/credential-provider.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const storageBinary = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');

class PrerequisiteGap extends Error {}

function requireBinary() {
  if (!existsSync(storageBinary)) {
    throw new PrerequisiteGap(
      `storage adapter binary not found at ${storageBinary}; build it with ` +
        '`cargo build --manifest-path src-tauri/Cargo.toml --release --bin web-backend-storage`. ' +
        'No business result is claimed without it.',
    );
  }
}

async function setup() {
  requireBinary();
  const root = mkdtempSync(join(tmpdir(), 'web-text-intake-'));
  const storage = new StorageClient({ binary: storageBinary, root, initialize: true });
  await storage.start();
  const taskService = new TaskService({ storage });
  const credentialProvider = new ControlledCredentialProvider();
  const configStore = new ConfigStore({ root, credentialProvider });
  const textIntake = new TextIntakeService({ storage, taskService, configStore });
  return {
    root,
    storage,
    taskService,
    textIntake,
    async stop() {
      await storage.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function sampleFields(overrides = {}) {
  return {
    title: '整理接入清单',
    kind: 'action',
    owner: '我',
    priority: 'high',
    due: null,
    followup: null,
    tags: [],
    ...overrides,
  };
}

test('submitSource stores the source once and dedups by fingerprint', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const first = await ctx.textIntake.submitSource('op_source_1', {
    text: '我负责整理接入清单，下周五17点前交付。',
    sourceAt: null,
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(first.reused, false);
  assert.match(first.source.sourceId, /^src_[0-9a-f]{32}$/);
  assert.equal(first.task.type, 'extract');
  assert.equal(first.task.state, 'queued');

  const second = await ctx.textIntake.submitSource('op_source_2', {
    text: '我负责整理接入清单，下周五17点前交付。',
    sourceAt: null,
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(second.reused, true);
  assert.equal(second.source.sourceId, first.source.sourceId);
  assert.equal(second.task.taskId, first.task.taskId);

  const { sources } = await ctx.textIntake.listSources({});
  assert.equal(sources.length, 1);
});

test('submitSource rejects an empty document and an invalid time zone', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  await assert.rejects(
    () => ctx.textIntake.submitSource('op_bad_1', { text: '   ', timeZone: 'Asia/Shanghai' }),
    /原文不能为空/,
  );
  await assert.rejects(
    () => ctx.textIntake.submitSource('op_bad_2', { text: '有效原文', timeZone: 'Not/AZone' }),
    /timeZone/,
  );
});

test('editCandidate guards versions and discard is terminal for pending', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_edit_1', {
    text: '原文一',
    timeZone: 'UTC',
  });
  const sourceId = submitted.source.sourceId;
  // A candidate row is written directly here: the result-staging path is
  // covered by the integration suites, while this unit test pins the guards.
  await ctx.storage.command('transact', {
    ops: [{
      sql: `INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms)
        VALUES ('cand_1',?,?,1,'pending',1,?,'原文一',NULL,NULL,'[]',0,NULL,NULL)`,
      params: [sourceId, submitted.task.taskId, JSON.stringify(sampleFields())],
    }],
  });
  const edited = await ctx.textIntake.editCandidate('cand_1', 'op_edit_2', 1, sampleFields({ title: '改过的标题' }), false);
  assert.equal(edited.version, 2);
  assert.equal(edited.fields.title, '改过的标题');
  await assert.rejects(
    () => ctx.textIntake.editCandidate('cand_1', 'op_edit_3', 1, sampleFields(), false),
    (error) => error.code === 'version_conflict',
  );
  const discarded = await ctx.textIntake.discardCandidate('cand_1', 'op_edit_4', 2);
  assert.equal(discarded.status, 'discarded');
  await assert.rejects(
    () => ctx.textIntake.editCandidate('cand_1', 'op_edit_5', 2, sampleFields(), false),
    (error) => error.code === 'state_conflict',
  );
});

test('signOff is atomic, derives stable keys and replays the current objects', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_sign_1', { text: '原文二', timeZone: 'UTC' });
  const sourceId = submitted.source.sourceId;
  await ctx.storage.command('transact', {
    ops: [
      {
        sql: `INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms)
          VALUES ('cand_a',?, ?,1,'pending',1,?,'原文二',NULL,NULL,'[]',0,NULL,NULL)`,
        params: [sourceId, submitted.task.taskId, JSON.stringify(sampleFields({ title: '事项 A' }))],
      },
      {
        sql: `INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms)
          VALUES ('cand_b',?, ?,2,'pending',1,?,'原文二',NULL,NULL,'[]',0,NULL,NULL)`,
        params: [sourceId, submitted.task.taskId, JSON.stringify(sampleFields({ title: '事项 B' }))],
      },
    ],
  });
  const result = await ctx.textIntake.signOff('op_sign_2', [
    { candidateId: 'cand_a', expectedVersion: 1, fields: sampleFields({ title: '事项 A' }), timeReviewed: false, target: null },
    { candidateId: 'cand_b', expectedVersion: 1, fields: sampleFields({ title: '事项 B' }), timeReviewed: false, target: null },
  ]);
  assert.equal(result.replayed, false);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((item) => item.source === 'signed_ai'));

  const events = await ctx.storage.command('query', {
    sql: 'SELECT operation_id,action FROM manual_item_events ORDER BY sequence ASC',
    params: [],
  });
  const keys = events.rows.map((row) => row[0]);
  assert.deepEqual(keys, [
    deriveSignOffKey('op_sign_2', 'cand_a'),
    deriveSignOffKey('op_sign_2', 'cand_b'),
  ]);
  assert.ok(keys.every((key) => key.startsWith('sign_off:') && key.length === 'sign_off:'.length + 64));

  const sources = await ctx.storage.command('query', {
    sql: 'SELECT association FROM manual_item_sources ORDER BY created_at_ms ASC',
    params: [],
  });
  assert.deepEqual(sources.rows.map((row) => row[0]), ['new', 'new']);

  const replay = await ctx.textIntake.signOff('op_sign_2', [
    { candidateId: 'cand_a', expectedVersion: 1, fields: sampleFields({ title: '事项 A' }), timeReviewed: false, target: null },
    { candidateId: 'cand_b', expectedVersion: 1, fields: sampleFields({ title: '事项 B' }), timeReviewed: false, target: null },
  ]);
  assert.equal(replay.replayed, true);
  assert.equal(replay.items.length, 2);
  const itemCount = await ctx.storage.command('query', {
    sql: 'SELECT count(*) FROM manual_items',
    params: [],
  });
  assert.equal(itemCount.rows[0][0], 2, 'replay must not create a second set of items');
});

test('signOff accepts a non-empty single-choice batch and rejects an empty one', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_sign_single', { text: '原文三', timeZone: 'UTC' });
  const sourceId = submitted.source.sourceId;
  await ctx.storage.command('transact', {
    ops: [{
      sql: `INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms)
        VALUES ('cand_s',?,?,1,'pending',1,?,'原文三',NULL,NULL,'[]',0,NULL,NULL)`,
      params: [sourceId, submitted.task.taskId, JSON.stringify(sampleFields({ title: '单选事项' }))],
    }],
  });
  // Frozen §5.1: any non-empty `choices` array is a legal batch — single and
  // multi select share one transaction, ledger and derived-key family.
  const single = await ctx.textIntake.signOff('op_sign_single', [
    { candidateId: 'cand_s', expectedVersion: 1, fields: sampleFields({ title: '单选事项' }), timeReviewed: false, target: null },
  ]);
  assert.equal(single.replayed, false);
  assert.equal(single.items.length, 1);
  assert.ok(single.items.every((item) => item.source === 'signed_ai'));
  const keys = (await ctx.storage.command('query', {
    sql: 'SELECT operation_id FROM manual_item_events ORDER BY sequence ASC',
    params: [],
  })).rows.map((row) => row[0]);
  assert.deepEqual(keys, [deriveSignOffKey('op_sign_single', 'cand_s')]);
  // An empty batch has no contractual basis either.
  await assert.rejects(
    () => ctx.textIntake.signOff('op_sign_empty', []),
    (error) => error.code === 'validation_failed',
  );
});

test('agentConcurrency reads the default without writing and CAS-writes the key', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const initial = await ctx.taskService.readConcurrency();
  assert.equal(initial.agentConcurrency, 3);
  assert.equal(initial.version, 0);
  const written = await ctx.taskService.writeConcurrency(5, 0);
  assert.equal(written.snapshot.agentConcurrency, 5);
  assert.equal(written.snapshot.version, 1);
  assert.ok(Number.isInteger(written.cursor) && written.cursor > 0,
    'the committed settings change must return its authoritative event cursor');
  await assert.rejects(
    () => ctx.taskService.writeConcurrency(7, 0),
    (error) => error.code === 'version_conflict',
  );
  const rows = await ctx.storage.command('query', {
    sql: "SELECT count(*) FROM settings WHERE key='agentConcurrency'",
    params: [],
  });
  assert.equal(rows.rows[0][0], 1);
});

test('a failed model configuration never blocks source intake', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const result = await ctx.textIntake.submitSource('op_no_model', { text: '无模型原文', timeZone: 'UTC' });
  assert.equal(result.reused, false);
  assert.equal(result.task.state, 'queued');
});

test('stageResult persists real payload bytes and readResult resolves the payloadRef', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.taskService.submit({
    operationId: 'op_payload_1', type: 'test', role: 'organizer', input: { configRevision: 'r', snapshot: null },
  });
  const taskId = submitted.task.taskId;
  const claimed = await ctx.taskService.claimNext(3, 'inst_test');
  assert.ok(claimed, 'the task should be claimed');
  // A stale epoch must be fenced out (m-6).
  assert.equal(
    await ctx.taskService.stageResult(taskId, claimed.attemptId, 'inst_stale', 'succeeded', { ok: true }),
    false,
  );
  const staged = await ctx.taskService.stageResult(
    taskId, claimed.attemptId, 'inst_test', 'succeeded',
    { kind: 'json', payload: { ok: true, text: '真实结果字节' } },
  );
  assert.equal(staged, true);
  const confirmed = await ctx.taskService.confirmExit(taskId, claimed.attemptId, { exited: true });
  assert.equal(confirmed, 'succeeded');
  const result = await ctx.taskService.readResult(taskId, {});
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.inline, true);
  assert.equal(result.payload, JSON.stringify({ kind: 'json', payload: { ok: true, text: '真实结果字节' } }));
  const rows = await ctx.storage.command('query', {
    sql: 'SELECT total_bytes FROM task_result_payloads WHERE attempt_id=? AND name=?',
    params: [claimed.attemptId, 'result'],
  });
  assert.equal(rows.rows[0][0] > 0, true, 'real bytes must be persisted in task_result_payloads');
});

test('markNeedsReview releases the slot only on an observed exit', async (t) => {
  const ctx = await createInstance();
  t.after(() => ctx.close());
  const submitted = await ctx.taskService.submit({
    operationId: 'op_nr_1', type: 'test', role: 'organizer', input: { configRevision: 'r', snapshot: null },
  });
  const taskId = submitted.task.taskId;
  await ctx.taskService.claimNext(3, ctx.epoch);
  await ctx.taskService.markNeedsReview(taskId, { code: 'output_contract_invalid', message: 'x', retryable: 'manual', sideEffectSafety: 'unknown' }, { exited: false });
  assert.equal((await ctx.taskService.get(taskId)).attemptExitState, 'exited_unknown');
  await ctx.taskRecovery.recover();
  assert.equal((await ctx.taskService.get(taskId)).attemptExitState, 'exited_confirmed');
});

async function seedCandidates(ctx, operationId, count) {
  const submitted = await ctx.textIntake.submitSource(operationId, { text: `原文-${operationId}`, timeZone: 'UTC' });
  const sourceId = submitted.source.sourceId;
  const ops = [];
  for (let index = 0; index < count; index += 1) {
    ops.push({
      sql: `INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms)
        VALUES (?,?,?,?,'pending',1,?,?,NULL,NULL,'[]',0,NULL,NULL)`,
      params: [`cand_${operationId}_${index}`, sourceId, submitted.task.taskId, index + 1, JSON.stringify(sampleFields({ title: `候选 ${index}` })), `原文-${operationId}`],
    });
  }
  await ctx.storage.command('transact', { ops });
  const listed = await ctx.textIntake.listCandidates(sourceId, { status: 'pending', limit: 50 });
  return listed.candidates;
}

test('racing batches for the same candidate: one wins, the loser rolls back with zero residue', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const candidates = await seedCandidates(ctx, 'race', 3);
  const [a, b, c] = candidates;
  const first = await ctx.textIntake.signOff('op_race_win', [
    { candidateId: a.candidateId, expectedVersion: 1, fields: sampleFields({ title: 'A' }), timeReviewed: false, target: null },
    { candidateId: b.candidateId, expectedVersion: 1, fields: sampleFields({ title: 'B' }), timeReviewed: false, target: null },
  ]);
  assert.equal(first.replayed, false);
  // The loser references the already-accepted candidate; the pre-commit
  // assertion must abort the whole transaction.
  await assert.rejects(
    () => ctx.textIntake.signOff('op_race_lose', [
      { candidateId: a.candidateId, expectedVersion: 1, fields: sampleFields({ title: 'A' }), timeReviewed: false, target: null },
      { candidateId: c.candidateId, expectedVersion: 1, fields: sampleFields({ title: 'C' }), timeReviewed: false, target: null },
    ]),
    // Either guard is legitimate: the pre-check (state_conflict) or the
    // pre-commit CAS assertion (version_conflict). Both roll the batch back.
    (error) => error.code === 'version_conflict' || error.code === 'state_conflict',
  );
  const items = await ctx.storage.command('query', { sql: 'SELECT count(*) FROM manual_items', params: [] });
  assert.equal(items.rows[0][0], 2, 'the losing batch must leave no item behind');
  const ledger = await ctx.storage.command('query', { sql: "SELECT count(*) FROM sign_off_batches WHERE operation_id='op_race_lose'", params: [] });
  assert.equal(ledger.rows[0][0], 0, 'the losing batch must leave no ledger row');
  const links = await ctx.storage.command('query', { sql: 'SELECT count(*) FROM manual_item_sources', params: [] });
  assert.equal(links.rows[0][0], 2, 'the losing batch must leave no association');
});

test('same operationId and identical input concurrently merges to one application', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const candidates = await seedCandidates(ctx, 'merge', 2);
  const [a, b] = candidates;
  const choices = () => [
    { candidateId: a.candidateId, expectedVersion: 1, fields: sampleFields({ title: 'A' }), timeReviewed: false, target: null },
    { candidateId: b.candidateId, expectedVersion: 1, fields: sampleFields({ title: 'B' }), timeReviewed: false, target: null },
  ];
  const [first, second] = await Promise.all([
    ctx.textIntake.signOff('op_merge', choices()),
    ctx.textIntake.signOff('op_merge', choices()),
  ]);
  assert.equal(first.replayed || second.replayed, true, 'one of the two must replay');
  const items = await ctx.storage.command('query', { sql: 'SELECT count(*) FROM manual_items', params: [] });
  assert.equal(items.rows[0][0], 2, 'concurrent same-id submission must not double-apply');
  const ledger = await ctx.storage.command('query', { sql: "SELECT count(*) FROM sign_off_batches WHERE operation_id='op_merge'", params: [] });
  assert.equal(ledger.rows[0][0], 1, 'exactly one ledger row');
});

test('large result: no-range returns the index envelope, explicit ranges return byte segments', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const big = '整理清单内容'.repeat(20000);
  const submitted = await ctx.taskService.submit({
    operationId: 'op_big_result', type: 'test', role: 'organizer', input: { configRevision: 'r', snapshot: null },
  });
  const taskId = submitted.task.taskId;
  const claimed = await ctx.taskService.claimNext(3, 'inst_test');
  const payload = { kind: 'text', text: big };
  await ctx.taskService.stageResult(taskId, claimed.attemptId, 'inst_test', 'succeeded', payload);
  await ctx.taskService.confirmExit(taskId, claimed.attemptId, { exited: true });

  const index = await ctx.taskService.readResult(taskId, {});
  assert.equal(index.inline, false);
  assert.equal(index.payload, null);
  assert.equal(index.payloadRef, `result://${claimed.attemptId}/result`);
  assert.equal(index.nextOffset, 0);
  assert.equal(index.done, false);
  assert.ok(index.totalBytes > 65536, 'the fixture must exceed the inline limit');

  const first = await ctx.taskService.readResult(taskId, { offset: 0, limit: 100 });
  assert.equal(first.bytesReturned, 100);
  assert.equal(first.done, false);
  assert.equal(first.nextOffset, 100);

  // Concatenating segments across UTF-8 boundaries must reproduce the payload.
  const segments = [];
  let offset = 0;
  for (;;) {
    const segment = await ctx.taskService.readResult(taskId, { offset, limit: 4096 });
    segments.push(Buffer.from(segment.payloadBase64, 'base64'));
    if (segment.done) break;
    offset = segment.nextOffset;
  }
  assert.equal(Buffer.concat(segments).toString('utf8'), JSON.stringify(payload));

  await assert.rejects(() => ctx.taskService.readResult(taskId, { offset: -1 }), (error) => error.code === 'result_range_invalid');
  await assert.rejects(
    () => ctx.taskService.readResult(taskId, { offset: index.totalBytes + 1 }),
    (error) => error.code === 'result_range_unsatisfiable',
  );
});

test('confirmExtractExit never drives a terminal or unverified task to succeeded', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_confirm_guard', { text: '确认守卫原文', timeZone: 'UTC' });
  const taskId = submitted.task.taskId;
  const claimed = await ctx.taskService.claimNext(3, 'inst_guard');
  await ctx.textIntake.stageExtractResult(taskId, claimed.attemptId, []);
  await ctx.textIntake.confirmExtractExit(taskId, claimed.attemptId, { exited: true, epoch: 'inst_guard' });
  const terminal = await ctx.taskService.get(taskId);
  assert.equal(terminal.state, 'succeeded');
  // A second confirmation must be a no-op: no state change, no new event.
  const eventsBefore = (await ctx.storage.command('query', { sql: 'SELECT count(*) FROM task_events', params: [] })).rows[0][0];
  await ctx.textIntake.confirmExtractExit(taskId, claimed.attemptId, { exited: true, epoch: 'inst_guard' });
  const eventsAfter = (await ctx.storage.command('query', { sql: 'SELECT count(*) FROM task_events', params: [] })).rows[0][0];
  assert.equal(eventsAfter, eventsBefore, 'a no-op confirmation must not append an event');
  assert.equal((await ctx.taskService.get(taskId)).version, terminal.version);
  // A foreign epoch is fenced out.
  await ctx.textIntake.confirmExtractExit(taskId, claimed.attemptId, { exited: true, epoch: 'inst_other' });
  assert.equal((await ctx.taskService.get(taskId)).version, terminal.version);
});

// ---------------------------------------------------------------------------
// Candidate direct-edit idempotency ledger (owner authorization D)
// ---------------------------------------------------------------------------

async function seedCandidateRow(storage, { candidateId = 'cand_1', sourceId, runId, fields, unresolved = 0 }) {
  await storage.command('transact', {
    ops: [{
      sql: `INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms)
        VALUES (?,?,?,1,'pending',1,?,?,NULL,NULL,'[]',?,NULL,NULL)`,
      params: [candidateId, sourceId, runId, JSON.stringify(fields), '原文', unresolved],
    }],
  });
}

async function ledgerRows(storage, operationId) {
  const rows = await storage.command('query', {
    sql: 'SELECT operation_id,candidate_id,action,request_json,occurred_at_ms FROM candidate_operations WHERE operation_id=?',
    params: [operationId],
  });
  return rows.rows;
}

test('editCandidate: same-key replay, changed-body conflict, key-free guard failure, current-state read-back', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_edit_seed', { text: '原文编辑', timeZone: 'UTC' });
  await seedCandidateRow(ctx.storage, { sourceId: submitted.source.sourceId, runId: submitted.task.taskId, fields: sampleFields() });
  const input = sampleFields({ title: '改过的标题' });

  const first = await ctx.textIntake.editCandidate('cand_1', 'op_edit_a', 1, input, false);
  assert.equal(first.version, 2);
  assert.equal(first.fields.title, '改过的标题');
  assert.equal((await ledgerRows(ctx.storage, 'op_edit_a')).length, 1);

  // Same key + same canonical bytes -> replay from the CURRENT authoritative state.
  const replay = await ctx.textIntake.editCandidate('cand_1', 'op_edit_a', 1, input, false);
  assert.equal(replay.version, 2, 'replay consumes no version');
  assert.equal(replay.fields.title, '改过的标题');
  assert.equal((await ledgerRows(ctx.storage, 'op_edit_a')).length, 1, 'replay appends no ledger row');

  // Same key + changed body -> 409 idempotency_conflict.
  await assert.rejects(
    () => ctx.textIntake.editCandidate('cand_1', 'op_edit_a', 1, sampleFields({ title: '别的标题' }), false),
    (error) => error.code === 'idempotency_conflict',
  );
  // Same key + flipped timeReviewed -> 409 (timeReviewed is behavior-affecting).
  await assert.rejects(
    () => ctx.textIntake.editCandidate('cand_1', 'op_edit_a', 1, input, true),
    (error) => error.code === 'idempotency_conflict',
  );

  // A rejected guard consumes no key: the stale version is refused and the same
  // key still succeeds later.
  await assert.rejects(
    () => ctx.textIntake.editCandidate('cand_1', 'op_edit_b', 1, sampleFields({ title: '过期' }), false),
    (error) => error.code === 'version_conflict',
  );
  assert.equal((await ledgerRows(ctx.storage, 'op_edit_b')).length, 0, 'a rejected guard writes no ledger row');
  const recovered = await ctx.textIntake.editCandidate('cand_1', 'op_edit_b', 2, sampleFields({ title: '过期' }), false);
  assert.equal(recovered.version, 3);
  assert.equal((await ledgerRows(ctx.storage, 'op_edit_b')).length, 1);

  // After a later operation, the old key still replays the CURRENT state.
  const after = await ctx.textIntake.editCandidate('cand_1', 'op_edit_a', 1, input, false);
  assert.equal(after.version, 3);
  assert.equal(after.fields.title, '过期', 'the replay reflects the current authoritative state');
});

test('discardCandidate: same-key replay and cross-action conflict under one key', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_discard_seed', { text: '原文丢弃', timeZone: 'UTC' });
  await seedCandidateRow(ctx.storage, { sourceId: submitted.source.sourceId, runId: submitted.task.taskId, fields: sampleFields() });

  const discarded = await ctx.textIntake.discardCandidate('cand_1', 'op_discard_a', 1);
  assert.equal(discarded.status, 'discarded');
  assert.equal((await ledgerRows(ctx.storage, 'op_discard_a')).length, 1);

  const replay = await ctx.textIntake.discardCandidate('cand_1', 'op_discard_a', 1);
  assert.equal(replay.status, 'discarded', 'replay answers the current authoritative state');
  assert.equal((await ledgerRows(ctx.storage, 'op_discard_a')).length, 1, 'replay appends no ledger row');

  // The same key under a different action conflicts, answered before the state
  // guard (the candidate is already discarded).
  await assert.rejects(
    () => ctx.textIntake.editCandidate('cand_1', 'op_discard_a', 1, sampleFields(), false),
    (error) => error.code === 'idempotency_conflict',
  );
});

test('applyPreview: same-key replay, changed-target conflict and unreleased-preview key-free refusal', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_preview_seed', { text: '原文预览', timeZone: 'UTC' });
  const runId = submitted.task.taskId;
  const sourceId = submitted.source.sourceId;
  await seedCandidateRow(ctx.storage, { sourceId, runId, fields: sampleFields() });
  const draft = { fields: sampleFields({ title: '预览标题' }) };
  const payload = JSON.stringify({ previewId: 'pv_1' });
  // A terminal, exit-confirmed revise task carrying the preview in its result.
  await ctx.storage.command('transact', {
    ops: [
      { sql: `INSERT INTO task_attempts (attempt_id,task_id,epoch,started_at,ended_at,exit_confirmed_at) VALUES ('att_1',?,'inst_1',1,1,1)`, params: [runId] },
      { sql: `INSERT INTO task_result_payloads (attempt_id,name,payload_blob,total_bytes,created_at) VALUES ('att_1','result',?,?,1)`, params: [payload, payload.length] },
      { sql: `UPDATE tasks SET state='succeeded',attempt_exit_state='exited_confirmed',result_pending_exit=0,result_ref=?,terminal_at=1 WHERE task_id=?`, params: [JSON.stringify({ payloadRef: 'result://att_1/result', kind: 'json' }), runId] },
      { sql: `INSERT INTO candidate_previews (preview_id,candidate_id,run_id,candidate_version,draft_json,created_at_ms) VALUES ('pv_1',?,?,1,?,1)`, params: ['cand_1', runId, JSON.stringify(draft)] },
    ],
  });

  const applied = await ctx.textIntake.applyPreview('cand_1', runId, 'op_apply_a', 1);
  assert.equal(applied.version, 2);
  assert.equal(applied.fields.title, '预览标题');
  assert.equal((await ledgerRows(ctx.storage, 'op_apply_a')).length, 1);

  const replay = await ctx.textIntake.applyPreview('cand_1', runId, 'op_apply_a', 1);
  assert.equal(replay.version, 2, 'replay consumes no version');
  assert.equal(replay.fields.title, '预览标题');
  assert.equal((await ledgerRows(ctx.storage, 'op_apply_a')).length, 1, 'replay appends no ledger row');

  // Same key + a different preview target -> 409.
  await assert.rejects(
    () => ctx.textIntake.applyPreview('cand_1', 'run_other', 'op_apply_a', 1),
    (error) => error.code === 'idempotency_conflict',
  );

  // A key whose apply is refused (preview not released) is not consumed.
  await assert.rejects(
    () => ctx.textIntake.applyPreview('cand_1', 'run_missing', 'op_apply_b', 2),
    (error) => error.code === 'candidate_not_found',
  );
  assert.equal((await ledgerRows(ctx.storage, 'op_apply_b')).length, 0, 'a refused apply writes no ledger row');
});

test('candidate operations replay across a same-root restart and unknown keys still apply', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'web-text-intake-restart-'));
  const storage = new StorageClient({ binary: storageBinary, root, initialize: true });
  await storage.start();
  const taskService = new TaskService({ storage });
  const credentialProvider = new ControlledCredentialProvider();
  const configStore = new ConfigStore({ root, credentialProvider });
  const textIntake = new TextIntakeService({ storage, taskService, configStore });
  try {
    const submitted = await textIntake.submitSource('op_restart_seed', { text: '重启原文', timeZone: 'UTC' });
    await seedCandidateRow(storage, { sourceId: submitted.source.sourceId, runId: submitted.task.taskId, fields: sampleFields() });
    const first = await textIntake.editCandidate('cand_1', 'op_restart_a', 1, sampleFields({ title: '重启前' }), false);
    assert.equal(first.version, 2);
    await storage.close();

    // Reopen the SAME root: the ledger and the candidate survive the restart.
    const reopened = new StorageClient({ binary: storageBinary, root, initialize: false });
    await reopened.start();
    const reopenedTaskService = new TaskService({ storage: reopened });
    const reopenedIntake = new TextIntakeService({ storage: reopened, taskService: reopenedTaskService, configStore });
    try {
      const replay = await reopenedIntake.editCandidate('cand_1', 'op_restart_a', 1, sampleFields({ title: '重启前' }), false);
      assert.equal(replay.version, 2, 'the replayed operation survives the restart');
      assert.equal(replay.fields.title, '重启前');
      assert.equal((await ledgerRows(reopened, 'op_restart_a')).length, 1);
      // An unknown key still applies after the restart.
      const fresh = await reopenedIntake.editCandidate('cand_1', 'op_restart_b', 2, sampleFields({ title: '重启后' }), false);
      assert.equal(fresh.version, 3);
      assert.equal((await ledgerRows(reopened, 'op_restart_b')).length, 1);
    } finally {
      await reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent identical edits under one key merge to a single application', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_race_seed', { text: '并发原文', timeZone: 'UTC' });
  await seedCandidateRow(ctx.storage, { sourceId: submitted.source.sourceId, runId: submitted.task.taskId, fields: sampleFields() });
  // Two service clients share the real adapter connection: the requests are
  // genuinely concurrent and the ledger primary key arbitrates the winner.
  const second = new TextIntakeService({ storage: ctx.storage, taskService: ctx.taskService });
  const input = sampleFields({ title: '并发标题' });
  const [first, replay] = await Promise.all([
    ctx.textIntake.editCandidate('cand_1', 'op_race', 1, input, false),
    second.editCandidate('cand_1', 'op_race', 1, input, false),
  ]);
  assert.ok([first.version, replay.version].every((version) => version === 2),
    `both answers must report the single applied version, got ${[first.version, replay.version]}`);
  assert.equal((await ledgerRows(ctx.storage, 'op_race')).length, 1, 'exactly one ledger row');
  const row = await ctx.storage.command('query', { sql: 'SELECT version FROM candidates WHERE candidate_id=?', params: ['cand_1'] });
  assert.equal(row.rows[0][0], 2, 'the candidate advanced exactly once');
});

test('ledger adjudication precedes the target existence check for all three families', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_order_seed', { text: '原文顺序', timeZone: 'UTC' });
  const sourceId = submitted.source.sourceId;
  const runId = submitted.task.taskId;
  await seedCandidateRow(ctx.storage, { candidateId: 'cand_real', sourceId, runId, fields: sampleFields() });
  // Consume the edit and discard keys on the real candidate.
  await ctx.textIntake.editCandidate('cand_real', 'op_order_edit', 1, sampleFields({ title: '已改' }), false);
  await ctx.textIntake.discardCandidate('cand_real', 'op_order_discard', 2);

  // A second candidate with its own released preview consumes the apply key.
  const applySeed = await ctx.textIntake.submitSource('op_order_apply_seed', { text: '原文顺序应用', timeZone: 'UTC' });
  const applyRun = applySeed.task.taskId;
  await seedCandidateRow(ctx.storage, { candidateId: 'cand_apply', sourceId: applySeed.source.sourceId, runId: applyRun, fields: sampleFields() });
  const draft = { fields: sampleFields({ title: '预览标题' }) };
  const payload = JSON.stringify({ previewId: 'pv_order' });
  await ctx.storage.command('transact', {
    ops: [
      { sql: `INSERT INTO task_attempts (attempt_id,task_id,epoch,started_at,ended_at,exit_confirmed_at) VALUES ('att_order',?,'inst_1',1,1,1)`, params: [applyRun] },
      { sql: `INSERT INTO task_result_payloads (attempt_id,name,payload_blob,total_bytes,created_at) VALUES ('att_order','result',?,?,1)`, params: [payload, payload.length] },
      { sql: `UPDATE tasks SET state='succeeded',attempt_exit_state='exited_confirmed',result_pending_exit=0,result_ref=?,terminal_at=1 WHERE task_id=?`, params: [JSON.stringify({ payloadRef: 'result://att_order/result', kind: 'json' }), applyRun] },
      { sql: `INSERT INTO candidate_previews (preview_id,candidate_id,run_id,candidate_version,draft_json,created_at_ms) VALUES ('pv_order','cand_apply',?,1,?,1)`, params: [applyRun, JSON.stringify(draft)] },
    ],
  });
  await ctx.textIntake.applyPreview('cand_apply', applyRun, 'op_order_apply', 1);

  // A USED key conflicts even when the other target does not exist.
  await assert.rejects(
    () => ctx.textIntake.editCandidate('cand_missing', 'op_order_edit', 1, sampleFields(), false),
    (error) => error.code === 'idempotency_conflict',
  );
  await assert.rejects(
    () => ctx.textIntake.discardCandidate('cand_missing', 'op_order_discard', 2),
    (error) => error.code === 'idempotency_conflict',
  );
  await assert.rejects(
    () => ctx.textIntake.applyPreview('cand_missing', applyRun, 'op_order_apply', 1),
    (error) => error.code === 'idempotency_conflict',
  );

  // An UNUSED key keeps the natural 404 for a missing candidate.
  await assert.rejects(
    () => ctx.textIntake.editCandidate('cand_missing', 'op_order_unknown_edit', 1, sampleFields(), false),
    (error) => error.code === 'candidate_not_found',
  );
  await assert.rejects(
    () => ctx.textIntake.discardCandidate('cand_missing', 'op_order_unknown_discard', 1),
    (error) => error.code === 'candidate_not_found',
  );
  await assert.rejects(
    () => ctx.textIntake.applyPreview('cand_missing', applyRun, 'op_order_unknown_apply', 1),
    (error) => error.code === 'candidate_not_found',
  );
});

test('discardCandidate: a rejected guard consumes no key and the same key still succeeds later', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_discard_key_seed', { text: '原文丢弃键', timeZone: 'UTC' });
  await seedCandidateRow(ctx.storage, { sourceId: submitted.source.sourceId, runId: submitted.task.taskId, fields: sampleFields() });
  await assert.rejects(
    () => ctx.textIntake.discardCandidate('cand_1', 'op_discard_key', 99),
    (error) => error.code === 'version_conflict',
  );
  assert.equal((await ledgerRows(ctx.storage, 'op_discard_key')).length, 0, 'a rejected guard writes no ledger row');
  const discarded = await ctx.textIntake.discardCandidate('cand_1', 'op_discard_key', 1);
  assert.equal(discarded.status, 'discarded');
  assert.equal((await ledgerRows(ctx.storage, 'op_discard_key')).length, 1);
});

test('applyPreview: an old key still replays the CURRENT state after a later edit', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.textIntake.submitSource('op_apply_cur_seed', { text: '原文应用当前态', timeZone: 'UTC' });
  const runId = submitted.task.taskId;
  await seedCandidateRow(ctx.storage, { sourceId: submitted.source.sourceId, runId, fields: sampleFields() });
  const draft = { fields: sampleFields({ title: '预览标题' }) };
  const payload = JSON.stringify({ previewId: 'pv_cur' });
  await ctx.storage.command('transact', {
    ops: [
      { sql: `INSERT INTO task_attempts (attempt_id,task_id,epoch,started_at,ended_at,exit_confirmed_at) VALUES ('att_cur',?,'inst_1',1,1,1)`, params: [runId] },
      { sql: `INSERT INTO task_result_payloads (attempt_id,name,payload_blob,total_bytes,created_at) VALUES ('att_cur','result',?,?,1)`, params: [payload, payload.length] },
      { sql: `UPDATE tasks SET state='succeeded',attempt_exit_state='exited_confirmed',result_pending_exit=0,result_ref=?,terminal_at=1 WHERE task_id=?`, params: [JSON.stringify({ payloadRef: 'result://att_cur/result', kind: 'json' }), runId] },
      { sql: `INSERT INTO candidate_previews (preview_id,candidate_id,run_id,candidate_version,draft_json,created_at_ms) VALUES ('pv_cur','cand_1',?,1,?,1)`, params: [runId, JSON.stringify(draft)] },
    ],
  });
  const applied = await ctx.textIntake.applyPreview('cand_1', runId, 'op_apply_cur', 1);
  assert.equal(applied.version, 2);
  assert.equal(applied.fields.title, '预览标题');
  const edited = await ctx.textIntake.editCandidate('cand_1', 'op_apply_cur_edit', 2, sampleFields({ title: '后续编辑' }), false);
  assert.equal(edited.version, 3);
  const replay = await ctx.textIntake.applyPreview('cand_1', runId, 'op_apply_cur', 1);
  assert.equal(replay.version, 3, 'the old apply key replays the current authoritative state');
  assert.equal(replay.fields.title, '后续编辑');
});

test('candidate operations replay across a same-root restart for all three families', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'web-text-intake-restart-all-'));
  const storage = new StorageClient({ binary: storageBinary, root, initialize: true });
  await storage.start();
  const taskService = new TaskService({ storage });
  const configStore = new ConfigStore({ root, credentialProvider: new ControlledCredentialProvider() });
  const textIntake = new TextIntakeService({ storage, taskService, configStore });
  try {
    const editSeed = await textIntake.submitSource('op_all_edit_seed', { text: '原文全部-编辑', timeZone: 'UTC' });
    await seedCandidateRow(storage, { candidateId: 'cand_edit', sourceId: editSeed.source.sourceId, runId: editSeed.task.taskId, fields: sampleFields() });
    const editOp = 'op_all_edit';
    await textIntake.editCandidate('cand_edit', editOp, 1, sampleFields({ title: '编辑后' }), false);

    const discardSeed = await textIntake.submitSource('op_all_discard_seed', { text: '原文全部-丢弃', timeZone: 'UTC' });
    await seedCandidateRow(storage, { candidateId: 'cand_discard', sourceId: discardSeed.source.sourceId, runId: discardSeed.task.taskId, fields: sampleFields() });
    const discardOp = 'op_all_discard';
    await textIntake.discardCandidate('cand_discard', discardOp, 1);

    const applySeed = await textIntake.submitSource('op_all_apply_seed', { text: '原文全部-应用', timeZone: 'UTC' });
    const applyRun = applySeed.task.taskId;
    await seedCandidateRow(storage, { candidateId: 'cand_apply', sourceId: applySeed.source.sourceId, runId: applyRun, fields: sampleFields() });
    const applyPayload = JSON.stringify({ previewId: 'pv_all' });
    await storage.command('transact', {
      ops: [
        { sql: `INSERT INTO task_attempts (attempt_id,task_id,epoch,started_at,ended_at,exit_confirmed_at) VALUES ('att_all',?,'inst_1',1,1,1)`, params: [applyRun] },
        { sql: `INSERT INTO task_result_payloads (attempt_id,name,payload_blob,total_bytes,created_at) VALUES ('att_all','result',?,?,1)`, params: [applyPayload, applyPayload.length] },
        { sql: `UPDATE tasks SET state='succeeded',attempt_exit_state='exited_confirmed',result_pending_exit=0,result_ref=?,terminal_at=1 WHERE task_id=?`, params: [JSON.stringify({ payloadRef: 'result://att_all/result', kind: 'json' }), applyRun] },
        { sql: `INSERT INTO candidate_previews (preview_id,candidate_id,run_id,candidate_version,draft_json,created_at_ms) VALUES ('pv_all','cand_apply',?,1,?,1)`, params: [applyRun, JSON.stringify({ fields: sampleFields({ title: '应用预览' }) })] },
      ],
    });
    const applyOp = 'op_all_apply';
    await textIntake.applyPreview('cand_apply', applyRun, applyOp, 1);

    await storage.close();

    const reopened = new StorageClient({ binary: storageBinary, root, initialize: false });
    await reopened.start();
    const reopenedTaskService = new TaskService({ storage: reopened });
    const reopenedIntake = new TextIntakeService({ storage: reopened, taskService: reopenedTaskService, configStore });
    try {
      const editReplay = await reopenedIntake.editCandidate('cand_edit', editOp, 1, sampleFields({ title: '编辑后' }), false);
      assert.equal(editReplay.version, 2, 'the edit replay survives the restart');
      assert.equal(editReplay.fields.title, '编辑后');
      const discardReplay = await reopenedIntake.discardCandidate('cand_discard', discardOp, 1);
      assert.equal(discardReplay.status, 'discarded', 'the discard replay survives the restart');
      const applyReplay = await reopenedIntake.applyPreview('cand_apply', applyRun, applyOp, 1);
      assert.equal(applyReplay.version, 2, 'the apply replay survives the restart');
      assert.equal(applyReplay.fields.title, '应用预览');
      for (const op of [editOp, discardOp, applyOp]) {
        assert.equal((await ledgerRows(reopened, op)).length, 1, `exactly one ledger row for ${op}`);
      }
    } finally {
      await reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
