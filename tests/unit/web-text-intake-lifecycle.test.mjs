//! Focused lifecycle counterexamples for the W1 text-intake slice.
//!
//! These exercise the real scheduling/storage path with a controllable worker
//! process: a result frame followed by a still-running worker must leave the
//! outcome staged (durable, invisible, unsignable, slot held) until the tree
//! exit is verified. Static fakes of the service layer are not accepted as
//! evidence for this window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { StorageClient } from '../../server/lib/storage-client.mjs';
import { TaskService } from '../../server/lib/task-service.mjs';
import { TextIntakeService } from '../../server/lib/text-intake-service.mjs';
import { ConfigStore } from '../../server/lib/config-store.mjs';
import { ControlledCredentialProvider } from '../../server/lib/credential-provider.mjs';
import { TaskScheduler } from '../../server/lib/task-scheduler.mjs';
import { WorkerHost, verifyTree } from '../../server/lib/worker-host.mjs';

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
  const root = mkdtempSync(join(tmpdir(), 'w1-lifecycle-'));
  const storage = new StorageClient({ binary: storageBinary, root, initialize: true });
  await storage.start();
  const taskService = new TaskService({ storage, root });
  const credentialProvider = new ControlledCredentialProvider({ secrets: new Map([['controlled:e2e', 'synthetic']]) });
  const configStore = new ConfigStore({ root, credentialProvider });
  const textIntake = new TextIntakeService({ storage, taskService, configStore });
  return {
    root, storage, taskService, textIntake, configStore,
    async stop() { await storage.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

/// A controllable worker process: emits a result frame on request, then either
/// hangs (ignoring cancel) or exits when its stdin sees a cancel frame.
class FakeWorker extends EventEmitter {
  constructor({ hang = true, candidates } = {}) {
    super();
    this.pid = 40000 + Math.floor(Math.random() * 5000);
    this.exitCode = null;
    this.signalCode = null;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.candidates = candidates;
    this.hang = hang;
    let buffer = '';
    this.stdin.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const frame = JSON.parse(line);
      if (frame.type === 'cancel') {
        if (!this.hang) this.exit(0);
        return;
      }
      // Request line: emit a valid-identity result frame immediately, then hang.
      const emitted = `${JSON.stringify({
        type: 'result', runId: frame.runId, hostNonce: frame.hostNonce, data: { candidates: this.candidates },
      })}\n`;
      this.stdout.write(emitted);
    });
  }

  exit(code = 0) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code, null);
  }

  kill() {
    this.killed = true;
    this.exit(1);
    return true;
  }
}

/// The runtime's canonical candidate shape nests the editable fields.
function sampleCandidates(sourceText) {
  return [{
    fields: { title: '整理接入清单', kind: 'action', owner: '我', priority: 'high', tags: [], due: null, followup: null },
    evidence: sourceText.slice(0, 12), dueExpression: null, followupExpression: null,
  }];
}

async function waitFor(label, predicate, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await predicate();
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('result then a still-running worker: staged is durable, invisible, unsignable and the slot is held', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration({
    providers: [{ id: 'controlled', name: 'Controlled', apiFormat: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', auth: { type: 'bearer', apiKeyRef: 'controlled:e2e' }, enabled: true }],
    models: [{ id: 'controlled-model', providerId: 'controlled', apiModelId: 'controlled-model', name: 'Controlled', enabled: true, capabilities: { toolCall: false } }],
    defaultModelId: 'controlled-model',
  }, '');
  const sourceText = '我负责整理接入清单，下周五17点前交付。';
  const submitted = await ctx.textIntake.submitSource('op_live_result', { text: sourceText, timeZone: 'Asia/Shanghai' });
  const taskId = submitted.task.taskId;

  const workers = [];
  const workerHost = new WorkerHost({
    runtimeRoot: join(repositoryRoot, 'build/s0-runtime'),
    root: ctx.root,
    runLimitMs: 30000,
    processFactory: (file, args, options) => {
      const worker = new FakeWorker({ hang: true, candidates: sampleCandidates(sourceText) });
      workers.push(worker);
      return worker;
    },
  });
  const scheduler = new TaskScheduler({
    taskService: ctx.taskService,
    textIntakeService: ctx.textIntake,
    workerHost,
    credentialProvider: new ControlledCredentialProvider({ secrets: new Map([['controlled:e2e', 'synthetic']]) }),
    pollMs: 50,
    epoch: 'inst_live',
  });
  scheduler.start();
  t.after(() => scheduler.stop());

  // The result frame arrives while the worker is still alive: staging happens.
  await new Promise((r) => setTimeout(r, 800));
  await waitFor('staged result persisted', async () => {
    const task = await ctx.taskService.get(taskId);
    return task.resultPendingExit ? task : null;
  });
  const staged = await ctx.taskService.get(taskId);
  assert.equal(staged.state, 'running', 'the task stays running until the tree exit is confirmed');
  assert.equal(staged.attemptExitState, 'active', 'the slot stays occupied');
  assert.equal(await ctx.taskService.runningCount(), 1, 'the slot is held');

  // Staged candidates are invisible and unsignable. The sign-off targets the
  // REAL staged candidate id: a non-pending candidate is rejected by the
  // state guard (frozen §5.1: only pending candidates can be signed off) —
  // not by any batch-size rule, which the frozen contract does not have.
  const pending = await ctx.textIntake.listCandidates(submitted.source.sourceId, { status: 'pending' });
  assert.equal(pending.candidates.length, 0, 'staged candidates must not be listable as pending');
  const stagedRows = await ctx.storage.command('query', {
    sql: 'SELECT candidate_id,status FROM candidates WHERE run_id=?',
    params: [taskId],
  });
  assert.equal(stagedRows.rows[0]?.[1], 'staged');
  await assert.rejects(
    () => ctx.textIntake.signOff('op_live_sign_early', [
      { candidateId: stagedRows.rows[0][0], expectedVersion: 1, fields: sampleCandidates(sourceText)[0].fields, timeReviewed: false, target: null },
    ]),
    (error) => error.code === 'state_conflict',
  );

  // The worker then exits: the staged outcome is committed and published.
  workers[0].exit(0);
  await waitFor('staged outcome committed', async () => {
    const task = await ctx.taskService.get(taskId);
    return task.state === 'succeeded' ? task : null;
  });
  const published = await ctx.textIntake.listCandidates(submitted.source.sourceId, { status: 'pending' });
  assert.equal(published.candidates.length, 1, 'the staged candidate is published after the exit is confirmed');
  assert.equal(await ctx.taskService.runningCount(), 0, 'the slot is released');
});

test('confirmExit never assumes exit from a missing handle or a missing record', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const workerHost = new WorkerHost({
    runtimeRoot: join(repositoryRoot, 'build/s0-runtime'),
    root: ctx.root,
    runLimitMs: 1000,
    processFactory: () => new FakeWorker({ hang: true, candidates: [] }),
  });
  const missing = await workerHost.confirmExit('run_missing');
  assert.equal(missing.exited, false);
  assert.equal(missing.reason, 'unknown_handle');

  // A registered handle whose record has no identity must stay unverified.
  const handle = workerHost.start({
    task: { taskId: 'tsk_guard', inputRef: {} },
    attemptId: 'att_guard',
    snapshot: null,
    credential: '',
  });
  handle.record.pid = null;
  handle.record.pgid = null;
  const unverified = await workerHost.confirmExit(handle.runId);
  assert.equal(unverified.exited, false);
  assert.equal(unverified.reason, 'missing_identity');
});

test('verifyTree treats an unenumerable or surviving member set as unverified', async () => {
  assert.equal(verifyTree(null), false);
  // A process that already exited gives a deterministic dead pgid.
  const dead = spawn('/usr/bin/true');
  const deadPid = dead.pid;
  await new Promise((resolve) => dead.on('exit', resolve));
  // Coverage unknown (no child snapshot) stays unverified even for a dead group.
  assert.equal(verifyTree({ pgid: deadPid, children: null }), false);
  // A surviving recorded child keeps the tree unverified.
  assert.equal(verifyTree({ pgid: deadPid, children: [process.pid] }), false);
  // A dead group whose direct children were enumerated as empty is verified.
  assert.equal(verifyTree({ pgid: deadPid, children: [] }), true);
});

test('receipt facts: tool progress is unattributed, duplicates idempotent, wrong identity records nothing', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration({
    providers: [{ id: 'controlled', name: 'Controlled', apiFormat: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', auth: { type: 'bearer', apiKeyRef: 'controlled:e2e' }, enabled: true }],
    models: [{ id: 'controlled-model', providerId: 'controlled', apiModelId: 'controlled-model', name: 'Controlled', enabled: true, capabilities: { toolCall: true } }],
    defaultModelId: 'controlled-model',
  }, '');
  const submitted = await ctx.textIntake.submitSource('op_receipt', { text: '我负责整理接入清单。', timeZone: 'Asia/Shanghai' });
  const taskId = submitted.task.taskId;
  const claimed = await ctx.taskService.claimNext(3, 'inst_receipt');

  assert.equal(await ctx.taskService.recordReceipt({
    runId: 'run_receipt', taskId, attemptId: claimed.attemptId, epoch: 'inst_receipt',
    kind: 'tool_call_unattributed', callKey: null, externalRef: null, provableReadonly: false,
  }), true);
  assert.equal(await ctx.taskService.hasNonReadonlyReceipts(claimed.attemptId), true, 'an unattributed call is not safe');

  // Duplicate frame: same receiptId, no second row.
  await ctx.taskService.recordReceipt({
    runId: 'run_receipt', taskId, attemptId: claimed.attemptId, epoch: 'inst_receipt',
    kind: 'tool_call_unattributed', callKey: null,
  });
  const count = await ctx.storage.command('query', { sql: 'SELECT count(*) FROM side_effect_receipts WHERE attempt_id=?', params: [claimed.attemptId] });
  assert.equal(count.rows[0][0], 1, 'duplicate frames must not create a second receipt');

  // A foreign epoch records nothing.
  assert.equal(await ctx.taskService.recordReceipt({
    runId: 'run_receipt', taskId, attemptId: claimed.attemptId, epoch: 'inst_other',
    kind: 'tool_call_closed', callKey: [1, 'nonce'],
  }), false);

  // A closed call with a different identity does not overwrite the first.
  await ctx.taskService.recordReceipt({
    runId: 'run_receipt', taskId, attemptId: claimed.attemptId, epoch: 'inst_receipt',
    kind: 'tool_call_closed', callKey: [4242, 'nonce-a'], externalRef: 'nonce-a',
  });
  const rows = await ctx.storage.command('query', { sql: 'SELECT kind,external_ref FROM side_effect_receipts WHERE attempt_id=? ORDER BY recorded_at', params: [claimed.attemptId] });
  assert.equal(rows.rows.length, 2, 'distinct calls are distinct receipts');
  assert.deepEqual(rows.rows[1], ['tool_call_closed', 'nonce-a']);
});

test('MCP closure pairs by exact serverId+callId; a lone closure is unattributed', async (t) => {
  const { receiptFactsFor, pairReceiptFact } = await import('../../server/lib/worker-host.mjs');
  const runId = 'run_pair';
  const hostNonce = 'nonce-pair';
  const openBegins = new Map();
  const closedPairs = new Set();
  const collect = (frame) => {
    for (const fact of receiptFactsFor(frame)) {
      const paired = pairReceiptFact(fact, openBegins, closedPairs);
      if (paired.kind === 'tool_call_begin'
          && !closedPairs.has(`${paired.serverId}\u0000${paired.callId}`)) {
        openBegins.set(`${paired.serverId}\u0000${paired.callId}`, { callKey: paired.callKey });
      }
    }
  };
  collect({ type: 'mcp', action: 'call_response', callId: 'call-x', runId, hostNonce });
  assert.equal(openBegins.size, 0, 'an orphan closure must not open a begin');
  collect({ type: 'mcp', action: 'call_begin', callId: 'call-1', input: { modelCallId: 'mc-1' }, serverId: 'srv', runId, hostNonce });
  assert.equal(openBegins.get('srv\u0000call-1').callKey.join(','), 'call-1,mc-1');
  collect({ type: 'mcp', action: 'call_response', callId: 'call-1', serverId: 'srv', runId, hostNonce });
  assert.equal(openBegins.size, 0, 'the begin must be consumed');
  // Two begins on the SAME server, closed in reverse order: exact identity, not FIFO.
  collect({ type: 'mcp', action: 'call_begin', callId: 'A', input: { modelCallId: 'ma' }, serverId: 'srv', runId, hostNonce });
  collect({ type: 'mcp', action: 'call_begin', callId: 'B', input: { modelCallId: 'mb' }, serverId: 'srv', runId, hostNonce });
  collect({ type: 'mcp', action: 'call_response', callId: 'B', serverId: 'srv', runId, hostNonce });
  assert.equal(openBegins.has('srv\u0000A'), true, 'B must close B, never A');
  collect({ type: 'mcp', action: 'call_response', callId: 'A', serverId: 'srv', runId, hostNonce });
  assert.equal(openBegins.size, 0);
  // A wrong callId does not close the open begin.
  collect({ type: 'mcp', action: 'call_begin', callId: 'C', input: { modelCallId: 'mc' }, serverId: 'srv', runId, hostNonce });
  collect({ type: 'mcp', action: 'call_response', callId: 'Z', serverId: 'srv', runId, hostNonce });
  assert.equal(openBegins.has('srv\u0000C'), true, 'the unmatched begin stays open');
  collect({ type: 'mcp', action: 'call_response', callId: 'C', serverId: 'srv', runId, hostNonce });
  // A duplicate begin must not reopen an already-closed call.
  collect({ type: 'mcp', action: 'call_begin', callId: 'C', input: { modelCallId: 'mc' }, serverId: 'srv', runId, hostNonce });
  assert.equal(openBegins.has('srv\u0000C'), false, 'a duplicate begin must not reopen a closed call');
});

test('R7-M-1: an extract exit with no staged outcome is a failure, never a silent success', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration({
    providers: [{ id: 'controlled', name: 'Controlled', apiFormat: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', auth: { type: 'bearer', apiKeyRef: 'controlled:e2e' }, enabled: true }],
    models: [{ id: 'controlled-model', providerId: 'controlled', apiModelId: 'controlled-model', name: 'Controlled', enabled: true, capabilities: { toolCall: false } }],
    defaultModelId: 'controlled-model',
  }, '');
  const submitted = await ctx.textIntake.submitSource('op_no_staged', { text: '我负责整理接入清单。', timeZone: 'Asia/Shanghai' });
  const taskId = submitted.task.taskId;
  const claimed = await ctx.taskService.claimNext(3, 'inst_r7');
  // No result frame ever arrived: the worker exited without a staged outcome.
  const outcome = await ctx.textIntake.confirmExtractExit(taskId, claimed.attemptId, { exited: true, epoch: 'inst_r7' });
  assert.equal(outcome, 'failed', 'a deadline/lost exit must not become succeeded');
  const task = await ctx.taskService.get(taskId);
  assert.equal(task.state, 'failed');
  assert.ok(task.failure, 'the failure must be recorded');
  assert.ok(task.pendingOutcome === null || task.pendingOutcome === undefined);
  const candidates = await ctx.storage.command('query', { sql: 'SELECT count(*) FROM candidates WHERE run_id=?', params: [taskId] });
  assert.equal(candidates.rows[0][0], 0, 'no staged candidate may be published');
  // The attempt row is closed so a later retry can be claimed again.
  const attempts = await ctx.storage.command('query', { sql: 'SELECT ended_at FROM task_attempts WHERE attempt_id=?', params: [claimed.attemptId] });
  assert.notEqual(attempts.rows[0][0], null, 'R6-M-1: the attempt row must be closed');
});

test('R6-M-1: a re-enqueued auto_backoff task can be claimed a second time', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  let clock = Date.now();
  const timedService = new TaskService({ storage: ctx.storage, root: ctx.root, now: () => clock });
  const submitted = await timedService.submit({ operationId: 'op_requeue', type: 'test', role: 'organizer', input: { configRevision: 'r', snapshot: null } });
  const taskId = submitted.task.taskId;
  const first = await timedService.claimNext(3, 'inst_requeue');
  await timedService.stageResult(taskId, first.attemptId, 'inst_requeue', 'failed', { code: 'model_request_failed', message: 'x', sideEffectSafety: 'proven_safe' });
  await timedService.confirmExit(taskId, first.attemptId, { exited: true });
  const result = await timedService.maybeAutoRetry(taskId);
  assert.equal(result, 'queued', 'model_request_failed must auto-backoff');
  const after = await ctx.taskService.get(taskId);
  assert.equal(after.state, 'queued');
  const budget = await ctx.storage.command('query', { sql: 'SELECT attempt_budget FROM tasks WHERE task_id=?', params: [taskId] });
  assert.ok(budget.rows[0][0] < 3, `the budget must decrement (got ${budget.rows[0][0]})`);
  clock += 61 * 1000; // the bounded backoff window must elapse before a re-claim
  const second = await timedService.claimNext(3, 'inst_requeue');
  assert.ok(second, 'the re-enqueued task must be claimable again');
  assert.notEqual(second.attemptId, first.attemptId);
});

test('R6-M-4: an unproven side effect downgrades to needs_review without a CHECK failure', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  const submitted = await ctx.taskService.submit({ operationId: 'op_downgrade', type: 'test', role: 'organizer', input: { configRevision: 'r', snapshot: null } });
  const taskId = submitted.task.taskId;
  const claimed = await ctx.taskService.claimNext(3, 'inst_downgrade');
  await ctx.taskService.stageResult(taskId, claimed.attemptId, 'inst_downgrade', 'failed', { code: 'model_request_failed', message: 'x', sideEffectSafety: 'unknown' });
  await ctx.taskService.confirmExit(taskId, claimed.attemptId, { exited: true });
  const result = await ctx.taskService.maybeAutoRetry(taskId);
  assert.equal(result, 'needs_review');
  const task = await ctx.taskService.get(taskId);
  assert.equal(task.state, 'needs_review');
  assert.equal(task.attemptExitState, 'exited_confirmed');
});

test('R6-M-3: resolve(resume) commits the original staged outcome and publishes candidates', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration({
    providers: [{ id: 'controlled', name: 'Controlled', apiFormat: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', auth: { type: 'bearer', apiKeyRef: 'controlled:e2e' }, enabled: true }],
    models: [{ id: 'controlled-model', providerId: 'controlled', apiModelId: 'controlled-model', name: 'Controlled', enabled: true, capabilities: { toolCall: false } }],
    defaultModelId: 'controlled-model',
  }, '');
  const submitted = await ctx.textIntake.submitSource('op_resume', { text: '我负责整理接入清单，下周五17点前交付。', timeZone: 'Asia/Shanghai' });
  const taskId = submitted.task.taskId;
  const claimed = await ctx.taskService.claimNext(3, 'inst_resume');
  await ctx.textIntake.stageExtractResult(taskId, claimed.attemptId, sampleCandidates('我负责整理接入清单，下周五17点前交付。'));
  // Force the needs_review state the way recovery would.
  await ctx.taskService.markNeedsReview(taskId, { code: 'model_request_failed', message: 'restart', retryable: 'manual', sideEffectSafety: 'unknown' }, { exited: true });
  const before = await ctx.textIntake.listCandidates(submitted.source.sourceId, { status: 'pending' });
  assert.equal(before.candidates.length, 0, 'staged candidates stay invisible');
  const { HttpServer } = await import('../../server/lib/http-server.mjs');
  const { SessionStore } = await import('../../server/lib/session-store.mjs');
  const { ApplicationSettingsService } = await import('../../server/lib/application-settings-service.mjs');
  const { SseHub } = await import('../../server/lib/sse-hub.mjs');
  const sessions = new SessionStore();
  const pairing = sessions.generatePairingCode();
  const { token, csrfToken } = sessions.pair(pairing);
  const httpServer = new HttpServer({
    service: { getItem: (id) => ctx.service.getItem(id) },
    sessions,
    sse: new SseHub(),
    staticRoot: '.',
    root: ctx.root,
    expectedHost: '127.0.0.1:1',
    applicationSettings: new ApplicationSettingsService(ctx.storage),
    taskService: ctx.taskService,
    textIntake: ctx.textIntake,
    configStore: ctx.configStore,
    scheduler: null,
  });
  const { Readable } = await import('node:stream');
  const req = Readable.from([Buffer.from(JSON.stringify({ expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] }))]);
  req.headers = {
    cookie: `sidekick_session=${token}`,
    'x-csrf-token': csrfToken,
    host: '127.0.0.1:1',
    origin: 'http://127.0.0.1:1',
  };
  let payload = null;
  const res = { writeHead() {}, end(body) { payload = JSON.parse(body); } };
  await httpServer.taskResolve(req, res, taskId);
  assert.equal(payload.task.state, 'succeeded', 'the HTTP resume commits the original staged outcome');
  const after = await ctx.textIntake.listCandidates(submitted.source.sourceId, { status: 'pending' });
  assert.equal(after.candidates.length, 1, 'the staged candidate is published');
});

test('MCP closure reads a previously persisted begin and consumes exactly one', async (t) => {
  const { receiptFactsFor, pairReceiptFact } = await import('../../server/lib/worker-host.mjs');
  const runId = 'run_pair2';
  const hostNonce = 'nonce-pair2';
  const openBegins = new Map();
  const closedPairs = new Set();
  const collect = (frame) => {
    for (const fact of receiptFactsFor(frame)) {
      const paired = pairReceiptFact(fact, openBegins, closedPairs);
      if (paired.kind === 'tool_call_begin'
          && !closedPairs.has(`${paired.serverId}\u0000${paired.callId}`)) {
        openBegins.set(`${paired.serverId}\u0000${paired.callId}`, { callKey: paired.callKey });
      }
    }
  };
  collect({ type: 'mcp', action: 'call_begin', callId: 'call-1', input: { modelCallId: 'mc-1' }, serverId: 'srv', runId, hostNonce });
  collect({ type: 'mcp', action: 'call_response', callId: 'call-1', serverId: 'srv', runId, hostNonce });
  assert.equal(openBegins.size, 0);
  collect({ type: 'mcp', action: 'call_response', callId: 'call-1', serverId: 'srv', runId, hostNonce });
  assert.equal(openBegins.size, 0, 'a duplicate closure must not reopen');
});
