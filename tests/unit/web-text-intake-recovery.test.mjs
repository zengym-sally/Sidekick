//! Restart/recovery and resume-gate regression for the W1 text-intake slice.
//!
//! Every test drives the REAL storage binary, the REAL scheduler/HTTP/SSE stack
//! and a REAL controlled stub worker process (frozen stdio protocol, `--run`
//! marker intact) — no transition logic is replicated here. Static fakes and
//! direct handler calls are not accepted as evidence for these windows.
//!
//! Faces (frozen `web-api/1` §3.2/§3.4/§4.6/§6.1.1; review ids from
//! `docs/reviews/web-text-intake-implementation-20261108-zcode-review.md` §14):
//!   PC1/PC2   a staged outcome survives a genuine crash+restart and
//!             resolve(resume) publishes the ORIGINAL result — with the attempt
//!             still open (PC1) and with the attempt already closed by
//!             recovery (PC2: the recovery item version/task CAS guards it,
//!             never the attempt row). PC1 passes on `5926cbc`; PC2 fails
//!             there by construction (R8-M-1 force-gate hole / 判据 2).
//!   M1a/M1b   resolve(resume) may never publish while the exit is unverified:
//!             a live worker inside the staged window (M1a, R8-M-1 C2) and a
//!             cancelling task whose staged outcome lets one POST defeat the
//!             cancel intent (M1b). Both fail on `5926cbc` (202+succeeded).
//!   M1c       an exited_unknown attempt answers the contract 409
//!             `exit_unconfirmed`, never a 202 no-op (R8-M-1/B3). Fails on
//!             `5926cbc`.
//!   F1        after a restart recovery, the re-queued task is claimed a
//!             second time and a younger queued task is not starved
//!             (R8-M-2/F1). Fails on `5926cbc` (UNIQUE(task_attempts_current)
//!             on every tick, swallowed by the tick catch).
//!             F1 fixture correction (coordinator 01a1be0b, 2026-11-09; the
//!             pre-correction draft stays in `b232828`/`adc31d8`): the restart
//!             instance previously ran the result-emitting stub for the
//!             second attempt, so on a fixed tree the final `candidates === 0`
//!             assertion would demand suppression of a legitimate post-fix
//!             candidate instead of proving the no-staged face. The restart
//!             stub is now a per-test parameter (`restartStubMode`, default
//!             `result-hang` — PC1/PC2 unchanged) and F1 pins the ORIGINAL
//!             no-result scenario explicitly: the second attempt emits no
//!             frames, so nothing is publishable on either tree. The candidate
//!             assertion is kept, not deleted.
//!   E1/E2     a launch failure keeps its registered code in the public
//!             failure envelope (no `internalCode`) and a configRevision
//!             change on `auth_or_config_invalid` stays retryable (frozen
//!             §4.6 retry rule; R8-M-3 E1/E2). Both fail on `5926cbc`.
//!   W         split per the coordinator correction (2026-11-09, thread
//!             01a1bdda; the original single-W draft stays in `adc31d8`):
//!             W(deadline)  the backend-deadline close-out is a TIMEOUT, not a
//!                          lost worker — the established mapping (internal
//!                          `model_timeout` → public `model_request_failed`,
//!                          `auto_backoff` default) holds and the §4.6 safety
//!                          route ("无法证明即 unknown，转 needs_review")
//!                          lands `needs_review` independent of `retryable`.
//!                          Passes on `5926cbc` (a positive face; must stay
//!                          green after the fix). The original draft's
//!                          `worker_lost/manual/failed` expectation here was
//!                          WRONG and its failure is NOT evidence that the
//!                          product must change to that landing.
//!             W(loss)      an unexpected worker death with NO deadline
//!                          configured keeps its registry code `worker_lost`
//!                          and its `manual` default (§4.6; R8-M-3 mapping
//!                          deviation). Fails on `5926cbc`.
//!   D1        the success terminal transition carries its own event/cursor so
//!             a staged-window reconnect token replays it, and the terminal
//!             commit clears `result_pending_exit` (R5-M-1 D1(b) residual +
//!             判据 4 cleanup). Fails on `5926cbc`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { StorageClient } from '../../server/lib/storage-client.mjs';
import { TaskService } from '../../server/lib/task-service.mjs';
import { TextIntakeService } from '../../server/lib/text-intake-service.mjs';
import { ManualItemsService } from '../../server/lib/manual-items-service.mjs';
import { ApplicationSettingsService } from '../../server/lib/application-settings-service.mjs';
import { SessionStore } from '../../server/lib/session-store.mjs';
import { SseHub } from '../../server/lib/sse-hub.mjs';
import { HttpServer } from '../../server/lib/http-server.mjs';
import { ConfigStore } from '../../server/lib/config-store.mjs';
import { ControlledCredentialProvider } from '../../server/lib/credential-provider.mjs';
import { TaskScheduler } from '../../server/lib/task-scheduler.mjs';
import { WorkerHost } from '../../server/lib/worker-host.mjs';
import { startWebBackend } from '../../server/entries/web-backend-entry.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const storageBinary = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');
const runtimeRoot = join(repositoryRoot, 'build/s0-runtime');
const stubWorker = join(repositoryRoot, 'tests/fixtures/web-text-intake/recovery-stub-worker.mjs');
const instanceRunner = join(repositoryRoot, 'tests/fixtures/web-text-intake/recovery-instance.mjs');
const SOURCE_TEXT = '我负责整理接入清单，下周五17点前交付。';

class PrerequisiteGap extends Error {}

function requireBinary() {
  if (!existsSync(storageBinary)) {
    throw new PrerequisiteGap(`storage adapter binary not found at ${storageBinary}; build it with cargo.`);
  }
}

async function waitFor(label, predicate, timeoutMs = 6000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await predicate();
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/// One assembled backend instance over the real storage binary. `workerStub`
/// selects the controlled real stub process mode (see the fixture header).
async function setup({ stubMode = 'result-hang', stubLifetimeMs = 0, runLimitMs = 30000 } = {}) {
  requireBinary();
  const root = mkdtempSync(join(tmpdir(), 'w1-recovery-'));
  const storage = new StorageClient({ binary: storageBinary, root, initialize: true });
  await storage.start();
  const credentialProvider = new ControlledCredentialProvider({ secrets: new Map([['controlled:e2e', 'synthetic']]) });
  const configStore = new ConfigStore({ root, credentialProvider });
  // One instance epoch shared by the event stream and the task_events rows,
  // exactly as the production entry wires it.
  const sse = new SseHub();
  sse.start();
  const taskService = new TaskService({ storage, root, epoch: sse.epoch });
  const textIntake = new TextIntakeService({ storage, taskService, configStore });
  const workers = [];
  const workerHost = new WorkerHost({
    runtimeRoot,
    root,
    runLimitMs,
    processFactory: (file, args, options) => {
      const child = spawn(process.execPath, [stubWorker, ...args.slice(1)], {
        ...options,
        env: {
          ...options.env,
          SIDEKICK_RECOVERY_STUB: stubMode,
          SIDEKICK_RECOVERY_STUB_LIFETIME_MS: String(stubLifetimeMs),
        },
      });
      workers.push(child);
      return child;
    },
  });
  const scheduler = new TaskScheduler({
    taskService,
    textIntakeService: textIntake,
    workerHost,
    credentialProvider,
    sse,
    pollMs: 50,
    epoch: sse.epoch,
  });
  scheduler.start();
  const applicationSettings = new ApplicationSettingsService(storage);
  const httpServer = new HttpServer({
    service: new ManualItemsService(storage),
    sessions: new SessionStore(),
    sse,
    staticRoot: '.',
    root,
    expectedHost: '',
    applicationSettings,
    taskService,
    textIntake,
    configStore,
    scheduler,
  });
  const port = await httpServer.listen(0);
  httpServer.expectedHost = `127.0.0.1:${port}`;
  const session = await pairSession(httpServer, port);
  const activeWorker = () => {
    for (const entry of workerHost.active.values()) return entry.record;
    return null;
  };
  return {
    root, storage, taskService, textIntake, configStore, scheduler, workerHost, httpServer,
    port, origin: `http://127.0.0.1:${port}`, ...session, activeWorker,
    async stop() {
      for (const worker of workers) {
        try { if (worker.pid) process.kill(-worker.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      await scheduler.stop();
      await httpServer.close();
      sse.stop();
      await storage.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function pairSession(httpServer, port) {
  const origin = `http://127.0.0.1:${port}`;
  const pairingCode = httpServer.sessions.generatePairingCode();
  const response = await fetch(`${origin}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ pairingCode }),
  });
  assert.equal(response.status, 200, 'pairing must succeed');
  const body = await response.json();
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  assert.ok(cookie.startsWith('sidekick_session='), 'the session cookie must be issued');
  return { token: cookie.replace('sidekick_session=', ''), csrfToken: body.csrfToken };
}

/// Real HTTP calls against a backend instance (cookie + CSRF + Origin rules).
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
    async post(path, payload) {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() };
    },
    async put(path, payload) {
      const response = await fetch(`${origin}${path}`, {
        method: 'PUT',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

/// Subscribe to the real SSE stream and collect frames until `stream.ready`.
async function collectStream(origin, session, { lastEventId = null, settleMs = 400 } = {}) {
  const controller = new AbortController();
  const headers = { cookie: `sidekick_session=${session.token}` };
  if (lastEventId !== null) headers['last-event-id'] = lastEventId;
  const response = await fetch(`${origin}/api/events`, { headers, signal: controller.signal });
  assert.equal(response.status, 200, 'the event stream must open');
  const frames = [];
  let reset = null;
  let ready = false;
  const streamTimeout = setTimeout(() => controller.abort(), 5000);
  try {
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = {};
        for (const line of block.split('\n')) {
          const separator = line.indexOf(':');
          if (separator < 0) continue;
          const field = line.slice(0, separator).trim();
          const value = line.slice(separator + 1).trim();
          if (field === 'id') frame.id = value;
          else if (field === 'event') frame.event = value;
          else if (field === 'data') frame.data = JSON.parse(value);
        }
        if (frame.event === 'stream.reset') reset = frame.data;
        if (frame.event === 'stream.ready') ready = true;
        if (frame.event) frames.push(frame);
      }
      if (ready) {
        await sleep(settleMs);
        break;
      }
    }
  } catch (error) {
    if (error?.name !== 'AbortError') throw error;
  } finally {
    clearTimeout(streamTimeout);
    controller.abort();
  }
  return { frames, reset, ready };
}

/// The worker record a real spawned worker left behind (production artifact).
function workerRecordFor(root, taskId) {
  const runs = join(root, 'runs');
  if (!existsSync(runs)) return null;
  for (const entry of readdirSync(runs)) {
    const path = join(runs, entry, 'worker.json');
    if (!existsSync(path)) continue;
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (record.taskId === taskId) return record;
    } catch {
      // A partially written record cannot prove ownership.
    }
  }
  return null;
}

function assertAlive(pid, label) {
  assert.doesNotThrow(() => process.kill(pid, 0), `${label} must still be alive`);
}

/// Boot the first backend instance as a REAL child process through the
/// production entry, wait for readiness and return its status lines.
async function startFirstInstance(root, stubMode) {
  const statusFile = join(root, 'instance-status.jsonl');
  const child = spawn(process.execPath, [instanceRunner, root, statusFile, stubWorker], {
    env: { ...process.env, SIDEKICK_RECOVERY_STUB: stubMode },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const lines = () => readFileSync(statusFile, 'utf8').split('\n').filter(Boolean);
  const ready = await waitFor('first instance ready', () => {
    if (!existsSync(statusFile)) return null;
    let readyLine = null;
    for (const line of lines()) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // a partially flushed line cannot prove anything yet
      }
      if (parsed.event === 'fatal') {
        throw new Error(`first instance failed to boot: ${parsed.message}\n${stderr}`);
      }
      if (parsed.event === 'ready') readyLine = parsed;
    }
    return readyLine ?? null;
  }, 8000);
  if (!ready && child.exitCode !== null && child.exitCode !== 0) {
    throw new Error(`first instance exited (${child.exitCode}) before readiness\n${stderr}`);
  }
  return { child, ready, stderr: () => stderr };
}

/// SIGKILL the first instance, then SIGKILL any surviving worker tree (the
/// genuine crash/restart face). The crashed instance's storage adapter
/// releases the root lock when its stdin closes with its parent.
async function crashFirstInstance(child, root, taskId) {
  child.kill('SIGKILL');
  const record = await waitFor('worker record on disk', () => workerRecordFor(root, taskId), 3000);
  try { if (record?.pgid) process.kill(-record.pgid, 'SIGKILL'); } catch { /* already gone */ }
  if (record?.pid) {
    await waitFor('worker tree gone', () => {
      try { process.kill(record.pid, 0); return null; } catch { return true; }
    }, 3000);
  }
  await sleep(400);
}

/// Boot the restarted instance through the production entry (recovery scan +
/// scheduler start are the production boot order). Retries until the crashed
/// instance's storage adapter has released the root lock. The stub factory is
/// passed through so a re-claimed attempt runs the controlled real stub with
/// the given bounded lifetime instead of a live model.
async function startRestartedInstance(root, { stubMode = 'result-hang', stubLifetimeMs = 0 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      return await startWebBackend({
        root,
        port: 0,
        storageBin: storageBinary,
        credentialProvider: new ControlledCredentialProvider({ secrets: new Map([['controlled:e2e', 'synthetic']]) }),
        workerProcessFactory: (file, args, options) =>
          spawn(process.execPath, [stubWorker, ...args.slice(1)], {
            ...options,
            env: {
              ...options.env,
              SIDEKICK_RECOVERY_STUB: stubMode,
              SIDEKICK_RECOVERY_STUB_LIFETIME_MS: String(stubLifetimeMs),
            },
          }),
      });
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`restarted instance failed to boot: ${lastError?.message ?? lastError}`);
}

function controlledModelConfig() {
  return {
    providers: [{ id: 'controlled', name: 'Controlled', apiFormat: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', auth: { type: 'bearer', apiKeyRef: 'controlled:e2e' }, enabled: true }],
    models: [{ id: 'controlled-model', providerId: 'controlled', apiModelId: 'controlled-model', name: 'Controlled', enabled: true, capabilities: { toolCall: false } }],
    defaultModelId: 'controlled-model',
  };
}

/// Crash → restart → recovery, driven entirely through the two real instances.
/// Returns the restarted backend, its HTTP client and the submitted source.
/// Crash → restart → recovery, driven entirely through the two real backend
/// processes: the first instance boots through the production entry as a real
/// child process; the restarted instance boots through the same entry in this
/// process (production recovery-then-scheduler order). `result-hang` produces
/// the staged window before the crash; `bare` produces the lost worker face.
async function restartWithStagedOutcome(t, { stubMode, restartStubMode = 'result-hang', withConcurrencyOne = false, restartLifetimeMs = 0 }) {
  requireBinary();
  const root = mkdtempSync(join(tmpdir(), 'w1-restart-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = await startFirstInstance(root, stubMode);
  t.after(() => { try { first.child.kill('SIGKILL'); } catch { /* already gone */ } });
  const api1 = clientFor(first.ready.origin, { token: first.ready.token, csrfToken: first.ready.csrfToken });
  if (withConcurrencyOne) {
    const written = await api1.put('/api/settings/agent-concurrency', { agentConcurrency: 1, expectedVersion: 0 });
    assert.equal(written.status, 200, 'agent concurrency must be writable through the real endpoint');
  }
  const submitted = await api1.post('/api/text-sources', {
    operationId: `op_restart_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  assert.equal(submitted.status, 200, 'the source must be submitted to the first instance');
  const taskId = submitted.body.task.taskId;
  const sourceId = submitted.body.source.sourceId;
  await waitFor('task running on the first instance', async () => {
    const task = await api1.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'running' ? task.body.task : null;
  }, 5000);
  if (stubMode === 'result-hang') {
    // The result frame must be durably staged BEFORE the crash, or the restart
    // face would not carry a staged outcome at all.
    await waitFor('staged outcome before the crash', async () => {
      const task = await api1.get(`/api/tasks/${taskId}`);
      return task.body.task.resultPendingExit === true ? task.body.task : null;
    }, 5000);
  }
  await crashFirstInstance(first.child, root, taskId);

  const backend = await startRestartedInstance(root, { stubMode: restartStubMode, stubLifetimeMs: restartLifetimeMs });
  t.after(() => backend.close());
  const pairResponse = await fetch(`${backend.origin}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: backend.origin },
    body: JSON.stringify({ pairingCode: backend.pairingCode }),
  });
  const pairBody = await pairResponse.json();
  const cookie = (pairResponse.headers.get('set-cookie') ?? '').split(';')[0];
  const api = clientFor(backend.origin, { token: cookie.replace('sidekick_session=', ''), csrfToken: pairBody.csrfToken });
  const recovered = await api.get(`/api/tasks/${taskId}`);
  assert.equal(recovered.body.task.state, 'needs_review', 'recovery must isolate the crashed task');
  assert.equal(recovered.body.task.attemptExitState, 'exited_confirmed', 'recovery must verify the exit before a resume');
  assert.equal(recovered.body.task.resultPendingExit, stubMode === 'result-hang', 'the staged outcome must survive the restart');
  return { root, taskId, sourceId, api, backend, first };
}

test('PC1: a staged outcome survives a real crash+restart and resolve(resume) publishes the original result', async (t) => {
  const world = await restartWithStagedOutcome(t, { stubMode: 'result-hang' });
  const { api, taskId, sourceId } = world;

  const staged = await api.get(`/api/tasks/${taskId}`);
  assert.ok(staged.body.task.attemptId, 'the current attempt is still recorded');
  const before = await api.get(`/api/text-sources/${sourceId}/candidates?status=pending`);
  assert.equal(before.body.candidates.length, 0, 'staged candidates stay invisible before the resume');

  const resolved = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(resolved.status, 202, 'the resume must be accepted');
  assert.equal(resolved.body.task.state, 'succeeded', 'the ORIGINAL staged outcome is committed, not a rerun');

  const result = await api.get(`/api/tasks/${taskId}/result`);
  assert.equal(result.status, 200, 'the committed outcome must be readable');
  assert.equal(result.body.outcome, 'succeeded');
  const payload = JSON.parse(result.body.payload);
  assert.equal(payload.candidates.length, 1, 'the original staged candidate is preserved');
  assert.equal(payload.candidates[0].fields.title, '整理接入清单');

  const after = await api.get(`/api/text-sources/${sourceId}/candidates?status=pending`);
  assert.equal(after.body.candidates.length, 1, 'the staged candidate is published by the resume');
});

test('PC2: resolve(resume) still publishes the original staged outcome after recovery closed the attempt', async (t) => {
  const world = await restartWithStagedOutcome(t, { stubMode: 'result-hang' });
  const { api, backend, taskId, sourceId } = world;

  // The fixed tree reaches this shape by itself (recovery closes the attempt
  // once the exit is verified); arranging it here with the production
  // primitive keeps the face pinned on both trees. The attempt row is closed,
  // never force-reopened, and the staged path must still commit via the
  // recovery item version/task CAS (判据 2), never via the attempt row.
  const attemptId = await backend.recovery.taskService.currentAttemptId(taskId);
  assert.ok(attemptId, 'the current attempt is recorded before it is closed');
  await backend.recovery.taskService.closeAttempt(attemptId, Date.now());
  assert.equal(await backend.recovery.taskService.currentAttemptId(taskId), null, 'the attempt row is now closed');

  const resolved = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(resolved.status, 202, 'the resume must be accepted even with the attempt closed');
  assert.equal(resolved.body.task.state, 'succeeded', 'a closed attempt must not discard the staged outcome');
  assert.equal(resolved.body.task.resultPendingExit, false, 'the staged window is closed by the same commit');

  const after = await api.get(`/api/text-sources/${sourceId}/candidates?status=pending`);
  assert.equal(after.body.candidates.length, 1, 'the staged candidate is published');
});

test('M1a: a live worker inside the staged window is never published by resolve(resume)', async (t) => {
  const ctx = await setup({ stubMode: 'result-hang' });
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration(controlledModelConfig(), '');
  const api = clientFor(ctx.origin, ctx);
  const submitted = await api.post('/api/text-sources', {
    operationId: `op_live_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.body.task.taskId;
  const sourceId = submitted.body.source.sourceId;
  await waitFor('staged window', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'running' && task.body.task.resultPendingExit ? task.body.task : null;
  }, 6000);
  const record = ctx.activeWorker();
  assert.ok(record?.pid, 'a real worker process holds the attempt');
  assertAlive(record.pid, 'the worker');

  const resolved = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(resolved.status, 409, 'an unverified exit must never be published (R8-M-1/C2)');
  const after = await api.get(`/api/tasks/${taskId}`);
  assert.notEqual(after.body.task.state, 'succeeded', 'no outcome may be committed while the worker is alive');
  assertAlive(record.pid, 'the worker must not be disposed by the resume');
  const candidates = await api.get(`/api/text-sources/${sourceId}/candidates?status=pending`);
  assert.equal(candidates.body.candidates.length, 0, 'staged candidates stay unpublished');
});

test('M1b: one resolve(resume) POST must not defeat a cancelling task with a staged outcome', async (t) => {
  const ctx = await setup({ stubMode: 'ignore-cancel-hang' });
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration(controlledModelConfig(), '');
  const api = clientFor(ctx.origin, ctx);
  const submitted = await api.post('/api/text-sources', {
    operationId: `op_cancel_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.body.task.taskId;
  const sourceId = submitted.body.source.sourceId;
  const staged = await waitFor('staged window', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'running' && task.body.task.resultPendingExit ? task.body.task : null;
  }, 6000);
  const record = ctx.activeWorker();
  assert.ok(record?.pid, 'a real worker process holds the attempt');

  const cancelled = await api.post(`/api/tasks/${taskId}/cancel`, { expectedVersion: staged.version });
  assert.equal(cancelled.status, 202, 'the cancel intent must be accepted');
  await waitFor('cancelling state', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'cancelling' ? task.body.task : null;
  }, 3000);
  assertAlive(record.pid, 'the worker ignores the cancel frame and stays alive');

  const resolved = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(resolved.status, 409, 'a cancelling task must not be force-published (R8-M-1)');
  const after = await api.get(`/api/tasks/${taskId}`);
  assert.notEqual(after.body.task.state, 'succeeded', 'the cancel intent must not be silently defeated');
  const candidates = await api.get(`/api/text-sources/${sourceId}/candidates?status=pending`);
  assert.equal(candidates.body.candidates.length, 0, 'staged candidates stay unpublished');
});

test('M1c: an exited_unknown attempt answers 409 exit_unconfirmed, not a 202 no-op', async (t) => {
  const ctx = await setup({ stubMode: 'result-hang' });
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration(controlledModelConfig(), '');
  const api = clientFor(ctx.origin, ctx);
  const submitted = await api.post('/api/text-sources', {
    operationId: `op_unknown_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.body.task.taskId;
  const staged = await waitFor('staged window', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'running' && task.body.task.resultPendingExit ? task.body.task : null;
  }, 6000);
  // The production transition the scheduler itself invokes for an unverified
  // tree (worker-host confirmExit → tree_unverified): the attempt becomes
  // exited_unknown with the outcome staged. Arrangement only — the face under
  // test is the HTTP resolve contract on that state.
  await ctx.textIntake.confirmExtractExit(taskId, staged.attemptId, { exited: false });
  const unknown = await api.get(`/api/tasks/${taskId}`);
  assert.equal(unknown.body.task.attemptExitState, 'exited_unknown', 'the exit is unconfirmed');

  const resolved = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(resolved.status, 409, 'the contract resolve status for an unconfirmed exit');
  assert.equal(resolved.body.error?.code, 'exit_unconfirmed', 'the frozen exit_unconfirmed code is required');
  const after = await api.get(`/api/tasks/${taskId}`);
  assert.equal(after.body.task.state, 'needs_review', 'the task stays isolated');
  assert.equal(after.body.task.attemptExitState, 'exited_unknown', 'the exit stays unconfirmed');
});

test('F1: after a restart recovery the re-queued task is claimed again and a younger task is not starved', async (t) => {
  const world = await restartWithStagedOutcome(t, {
    stubMode: 'bare',
    withConcurrencyOne: true,
    // The ORIGINAL no-result scenario, pinned explicitly (coordinator
    // 01a1be0b): the first attempt runs bare and dies in the crash with
    // nothing staged, and the restart instance runs bare too — the second
    // attempt emits no frames, so `candidates === 0` below holds on both the
    // broken and a fixed tree (a fixed tree must publish the LEGITIMATE
    // results of later attempts, and this face must not ask it to suppress
    // any). The bounded lifetime frees the slot for the younger task.
    restartStubMode: 'bare',
    restartLifetimeMs: 3000,
  });
  const { api, taskId, sourceId } = world;
  // A younger task must never be starved by a stuck queue head (R8-M-2/F1).
  const younger = await api.post('/api/text-sources', {
    operationId: `op_younger_${Date.now()}`,
    input: { text: '请把上一次的清单再整理一遍。', timeZone: 'Asia/Shanghai' },
  });
  const youngerTaskId = younger.body.task.taskId;
  const queued = await api.get(`/api/tasks/${youngerTaskId}`);
  assert.equal(queued.body.task.state, 'queued', 'the younger task waits in the queue');

  const resumed = await api.post(`/api/tasks/${taskId}/resolve`, { expectedVersion: 1, decision: 'resume', acknowledgedReceipts: [] });
  assert.equal(resumed.status, 202, 'the resume re-enqueues the recovered task');
  assert.equal(resumed.body.task.state, 'queued', 'a task with no staged outcome is re-queued for a fresh attempt');

  await waitFor('second claim and younger progress', async () => {
    const first = await api.get(`/api/tasks/${taskId}`);
    const second = await api.get(`/api/tasks/${youngerTaskId}`);
    const claims = {
      firstAttemptCount: first.body.task.attemptCount,
      youngerAttemptCount: second.body.task.attemptCount,
      youngerState: second.body.task.state,
    };
    return claims.firstAttemptCount >= 2 && claims.youngerAttemptCount >= 1 && claims.youngerState !== 'queued'
      ? claims
      : null;
  }, 9000, 100);
  const empty = await api.get(`/api/text-sources/${sourceId}/candidates?status=pending`);
  assert.equal(empty.body.candidates.length, 0, 'the lost first attempt staged nothing and the second no-frame attempt could not publish either');
});

test('E1: a launch failure keeps its registered code in the public failure envelope', async (t) => {
  const ctx = await setup({ stubMode: 'bare' });
  t.after(() => ctx.stop());
  // No model configuration: the launch fails before any worker starts, with
  // the registered `auth_or_config_invalid` code (frozen §4.6).
  const api = clientFor(ctx.origin, ctx);
  const submitted = await api.post('/api/text-sources', {
    operationId: `op_no_model_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.body.task.taskId;
  const failed = await waitFor('launch failure terminal', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'failed' ? task.body.task : null;
  }, 6000);
  assert.ok(failed.failure, 'the failure envelope must be visible');
  assert.equal(failed.failure.code, 'auth_or_config_invalid', 'the registered code must stay in failure.code (R8-M-3/E1)');
  assert.equal(failed.failure.retryable, 'manual', 'configuration-class failures default to manual');
  assert.equal('internalCode' in failed.failure, false, 'the public envelope must not carry internalCode');
  assert.equal(typeof failed.failure.message, 'string', 'the failure keeps a message');
});

test('E2: retry with a changed configRevision stays allowed for auth_or_config_invalid', async (t) => {
  const ctx = await setup({ stubMode: 'bare' });
  t.after(() => ctx.stop());
  const api = clientFor(ctx.origin, ctx);
  const submitted = await api.post('/api/text-sources', {
    operationId: `op_retry_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.body.task.taskId;
  const failed = await waitFor('launch failure terminal', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'failed' ? task.body.task : null;
  }, 6000);
  const retried = await api.post(`/api/tasks/${taskId}/retry`, {
    expectedVersion: failed.version,
    configRevision: 'rev-after-fix',
  });
  assert.equal(retried.status, 202, 'the contract-allowed configRevision change must retry (R8-M-3/E2)');
  assert.notEqual(retried.body.error?.code, 'config_revision_change_not_allowed', 'the registered retry flow must not break');
  await waitFor('second claim after the retry', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.attemptCount >= 2 ? task.body.task : null;
  }, 6000);
});

test('W (deadline): the backend deadline close-out maps the timeout per the registered mapping and keeps the §4.6 safety route', async (t) => {
  const ctx = await setup({ stubMode: 'bare', runLimitMs: 1200 });
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration(controlledModelConfig(), '');
  const api = clientFor(ctx.origin, ctx);
  const submitted = await api.post('/api/text-sources', {
    operationId: `op_deadline_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.body.task.taskId;
  // Correction (coordinator thread 01a1bdda, 2026-11-09): the original draft
  // (adc31d8) asserted `worker_lost/manual/failed` on this path, but a
  // backend-deadline kill is a TIMEOUT — the established mapping is internal
  // `model_timeout` → public `model_request_failed`, and the §4.6 safety route
  // (无法证明即 unknown，转 needs_review) is independent of `retryable`. The
  // original W failure is not evidence that the product must change here.
  // The failed write and the safety-route downgrade are separate transactions,
  // so the settle window requires the state to hold across a re-sample.
  const settled = await waitFor('deadline close-out settled', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    if (task.body.task.state !== 'needs_review' && task.body.task.state !== 'failed') return null;
    await sleep(400);
    const stable = await api.get(`/api/tasks/${taskId}`);
    return stable.body.task.state === task.body.task.state ? stable.body.task : null;
  }, 9000, 100);
  assert.equal(settled.state, 'needs_review', 'the §4.6 safety route (unknown → needs_review) is the correct landing, never a forced failed');
  const rows = await ctx.taskService.query('SELECT failure FROM tasks WHERE task_id=?', [taskId]);
  const failure = JSON.parse(rows[0][0]);
  assert.equal(failure.code, 'model_request_failed', 'the registered timeout mapping keeps model_request_failed as the failure code (R8-M-3 mapping, deadline face)');
  assert.equal(failure.retryable, 'auto_backoff', 'the registered timeout mapping keeps the auto_backoff default');
  const attempts = await ctx.taskService.query(
    'SELECT ended_at, exit_reason FROM task_attempts WHERE task_id=? ORDER BY started_at DESC LIMIT 1',
    [taskId],
  );
  assert.notEqual(attempts[0]?.[0] ?? null, null, 'the reaper-verified exit closes the attempt row');
  assert.equal(attempts[0][1], 'confirmed', 'the deadline kill is a confirmed exit');
});

test('W (worker loss): an unexpected worker death keeps its registry code worker_lost and its manual default', async (t) => {
  // No deadline configured (default runLimitMs=30000): the controlled stub
  // self-exits (exit code 1, no frames) after 500ms — an unexpected worker
  // death, not a timeout. The frozen §4.6 registry pins `worker_lost` to the
  // `manual` default; the safety route stays independent of `retryable`
  // (unknown → needs_review), so the landing state is not forced to failed.
  const ctx = await setup({ stubMode: 'lifetime', stubLifetimeMs: 500 });
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration(controlledModelConfig(), '');
  const api = clientFor(ctx.origin, ctx);
  const submitted = await api.post('/api/text-sources', {
    operationId: `op_worker_lost_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.body.task.taskId;
  // Same two-transaction shape as the deadline face: the failed write and the
  // safety-route downgrade are separate transactions, so the settle window
  // requires the state to hold across a re-sample.
  const settled = await waitFor('worker-loss close-out settled', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    if (task.body.task.state !== 'needs_review' && task.body.task.state !== 'failed') return null;
    await sleep(400);
    const stable = await api.get(`/api/tasks/${taskId}`);
    return stable.body.task.state === task.body.task.state ? stable.body.task : null;
  }, 9000, 100);
  assert.equal(settled.state, 'needs_review', 'the §4.6 safety route (unknown → needs_review) is independent of retryable');
  const rows = await ctx.taskService.query('SELECT failure FROM tasks WHERE task_id=?', [taskId]);
  const failure = JSON.parse(rows[0][0]);
  assert.equal(failure.code, 'worker_lost', 'the registry code stays in failure.code (R8-M-3 worker_lost face)');
  assert.equal(failure.retryable, 'manual', 'worker_lost defaults to manual (R8-M-3 worker_lost face)');
  const attempts = await ctx.taskService.query(
    'SELECT ended_at FROM task_attempts WHERE task_id=? ORDER BY started_at DESC LIMIT 1',
    [taskId],
  );
  assert.notEqual(attempts[0]?.[0] ?? null, null, 'the verified exit closes the attempt row');
});

test('D1: the success terminal transition is replayable from a staged-window reconnect token', async (t) => {
  const ctx = await setup({ stubMode: 'result-hang' });
  t.after(() => ctx.stop());
  await ctx.configStore.writeModelConfiguration(controlledModelConfig(), '');
  const api = clientFor(ctx.origin, ctx);
  const submitted = await api.post('/api/text-sources', {
    operationId: `op_replay_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  const taskId = submitted.body.task.taskId;

  // A client holding the documented mid-staged-window snapshot token freezes.
  const live = await collectStream(ctx.origin, ctx);
  assert.ok(live.ready, 'the live stream opens');
  const staged = await waitFor('staged window', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'running' && task.body.task.resultPendingExit ? task.body.task : null;
  }, 6000);
  const snapshot = await api.get('/api/snapshot');
  const token = snapshot.body.lastEventId;
  const stagingCursor = Number(token.split(':')[1]);

  // The staged outcome beats the cancel intent (frozen §6.1.1): the exit
  // commits succeeded and must leave its own event/cursor behind.
  const cancelled = await api.post(`/api/tasks/${taskId}/cancel`, { expectedVersion: staged.version });
  assert.equal(cancelled.status, 202, 'the cancel intent is accepted');
  await waitFor('success terminal', async () => {
    const task = await api.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'succeeded' ? task.body.task : null;
  }, 6000);

  // The terminal broadcast is asynchronous with the commit; a client retries
  // the documented token until the instance answers it (frozen §6). On the
  // candidate tree the staged-window token is rejected outright, because the
  // staging transition is never broadcast and the retention window starts
  // above it — the reconnect below keeps retrying so a fixed tree gets a fair
  // reading while a broken tree fails with the real reset reason.
  let lastReset = null;
  let replay;
  try {
    replay = await waitFor('resumable reconnect for the staged-window token', async () => {
      const attempt = await collectStream(ctx.origin, ctx, { lastEventId: token });
      lastReset = attempt.reset;
      return attempt.reset === null ? attempt : null;
    }, 4000, 150);
  } catch {
    throw new Error(`the staged-window snapshot token was never resumable (frozen §6): last reset ${JSON.stringify(lastReset)}`);
  }
  assert.equal(replay.reset, null, 'a mid-staged-window token stays resumable (frozen §6)');
  const terminal = replay.frames.filter((frame) => frame.event === 'task.changed'
    && frame.data?.objectId === taskId
    && frame.data?.taskState === 'succeeded');
  assert.ok(terminal.length >= 1, 'the success terminal transition must be replayed (R5-M-1/D1(b))');
  assert.ok(terminal.every((frame) => frame.data.cursor > stagingCursor), 'the terminal carries its own advanced cursor');

  const task = await api.get(`/api/tasks/${taskId}`);
  assert.equal(task.body.task.resultPendingExit, false, 'the terminal commit clears the pending flag');
});
