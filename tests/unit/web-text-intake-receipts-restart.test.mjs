//! MCP side-effect receipt cross-restart readability regression (W1 text-intake).
//!
//! Previously unverified area: whether the `side_effect_receipts` facts a
//! worker produced before a crash stay readable through a production restart,
//! and whether the receipt write path keeps rejecting identities that died
//! with the old instance. Every face drives the REAL production chain: two
//! real backend instances booted through the production entry (`startWebBackend`
//! — storage adapter, registerEpoch + recovery scan, scheduler, HTTP/SSE), the
//! real WorkerHost/scheduler receipt pipeline (frozen P-3) and the real Rust
//! storage binary. The only substitution is the worker binary (a controlled
//! real stub process carrying the reviewed frame builders). No transition
//! logic is replicated here; static fakes and direct handler calls are not
//! accepted as evidence for these windows.
//!
//! Reused reviewed inputs (nothing re-invented):
//!   * frame shapes — the builders of
//!     `tests/fixtures/web-text-intake/mcp-pairing-frames.mjs`, byte-identical
//!     on the locked chain (reviewed in
//!     `docs/reviews/web-text-intake-mcp-pairing-test-20261109-zcode-review.md`);
//!     a `call_response` never repeats the begin's `modelCallId`.
//!   * receipt id — frozen P-3 formula, restated from production
//!     `server/lib/task-service.mjs` (`receiptId`): SHA-256 of compact
//!     `JSON.stringify([runId, attemptId, kind, callKey])`, first 32 hex
//!     chars. The test recomputes it ONLY to classify production-written rows,
//!     never to produce one.
//!   * write guards — production `recordReceipt`: a write lands only while the
//!     task's `attemptExitState` is `active` and the given epoch equals the
//!     target attempt row's epoch; duplicates are idempotent by `receipt_id`.
//!   * pairing — persistence-gated per attempt (`pairReceiptFact` +
//!     scheduler `onWorkerFrame`): a closure pairs only with a begin persisted
//!     earlier in the SAME attempt; a closure without one lands
//!     `tool_call_unattributed` and never fabricates a pairing.
//!   * read-only observation — the reviewed `db-observer.mjs` fixture
//!     (`node:sqlite`, `readOnly: true`, SELECT-only): the bare-begin crash
//!     gate polls the REAL database file for the committed begin row bound to
//!     the task's attempt, so the crash lands only after the fact is visibly
//!     persisted (no settle window, no timing race).
//!
//! Faces (each case within the 20s W1 budget including cleanup):
//!   RA1  begin/closed correlation + open/non-readonly preservation across a
//!        genuine SIGKILL crash and a production restart: begin(A) +
//!        response(A) + begin(B) + a staged result land before the crash; the
//!        restart must still read exactly those three facts — the closed row's
//!        receipt_id proves it inherited the BEGIN's callKey (real pairing,
//!        not `tool_call_unattributed`), the open begin(B) survives with no
//!        closure behind it (nothing fabricates pairing across a restart),
//!        every row is `provable_readonly=0`, `hasNonReadonlyReceipts` is
//!        true, and the recovery envelope keeps `sideEffectSafety: 'unknown'`.
//!        Assertions bind positive rows; a zero or all-closed ledger is never
//!        read as safety here.
//!   RA2  dead-attempt and old-epoch writes stay rejected, and a new attempt
//!        reusing the SAME callId is identity-isolated: after a crash (one
//!        open begin, nothing staged) + restart + resume re-queue, the new
//!        attempt's same-callId closure records `tool_call_unattributed`
//!        under the NEW attempt (no continuation of the old attempt's begin),
//!        its receipt_id differs from the old attempt's row exactly because
//!        the frozen formula hashes the attemptId, `recordReceipt` rejects a
//!        write to the dead needs_review attempt and an old-epoch write
//!        against the live new attempt — while a correctly-identified
//!        production write still lands (the guards discriminate, they do not
//!        blanket-refuse). The control write is clearly synthetic and proves
//!        nothing about safety.
//!
//! Candidate status (dispatch thread 01a1bf42, 2026-11-09): independent
//! to-be-reviewed test candidate. Registered runs are on the locked production
//! chain `681c282` with the storage binary compiled from that tree's Rust
//! sources; green/red facts belong to the registration record, not this file.
//!
//! Cleanup error propagation (dispatch reply 01a1bff1, 2026-11-09): teardown
//! never swallows a failing cleanup step into a pass. Every registered step
//! (kill → graceful close → root removal LAST) is still attempted in order,
//! each failure is collected and reported as sanitized diagnostics, and a
//! kill/close failure turns an otherwise green case red. When the case body
//! already failed on its own, the original assertion failure stays the case's
//! failure and the diagnostics keep the cleanup face visible next to it —
//! a cleanup error is never a silent success.
//!
//! Real kill layer + storage exit gate (dispatch replies 01a1c093 and
//! 01a1c0b8, 2026-11-09): every real kill site exempts ONLY a proven-gone
//! target — ESRCH is the OS confirming the process/group no longer exists,
//! and any other kill failure (EPERM, ...) reaches the teardown collector
//! instead of passing silently. Failures are COLLECTED per owned target: a
//! failing first-instance kill never skips the surviving worker trees, and a
//! failing tree inside the loop never skips the remaining ones — every owned
//! cleanup target is attempted first, and only then does the first collected
//! error (its original syscall stack) propagate to the collector. The root
//! removal stays last. The restarted backend's own storage subprocess must be
//! PROVEN exited after the graceful close: production `close()` is
//! best-effort by contract (its storage adapter resolves on a bounded timer
//! without waiting for the child), so close resolving alone is never read as
//! success. The proof runs on the REAL production ChildProcess handle —
//! `backend.recovery.storage.child`, the handle the locked-chain
//! `StorageClient` spawned and kept as a field, captured at acquisition time
//! BEFORE close is ever invoked — through its own `exit` event / exit state
//! within a bounded window. A pid number is not a handle: after a wait, a
//! bare pid's identity is unprovable, so there is no process-table scan and
//! no bare-pid signaling anywhere in the gate; the enforced cleanup of a
//! survivor (SIGKILL + bounded exit wait) also operates ONLY on that handle,
//! and the step fails loudly afterwards — neither a fake green nor a silent
//! hang is reachable. The close teardown joins at acquisition BEFORE the
//! capture and exit-listener steps, so even a failed capture or listener
//! registration still runs the graceful close (and the root removal after
//! it) — a capture failure never leaks cleanup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { ControlledCredentialProvider } from '../../server/lib/credential-provider.mjs';
import { startWebBackend } from '../../server/entries/web-backend-entry.mjs';
import { observe } from '../fixtures/web-text-intake/db-observer.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const storageBinary = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');
const stubWorker = join(repositoryRoot, 'tests/fixtures/web-text-intake/receipts-restart-worker.mjs');
const instanceRunner = join(repositoryRoot, 'tests/fixtures/web-text-intake/receipts-restart-instance.mjs');
const SOURCE_TEXT = '我负责整理接入清单，下周五17点前交付。';

/// The single receipt identity both this test and the stub fixture read
/// (env `SIDEKICK_RECEIPTS_IDENTITY`), so no identity can drift between the
/// frames the stub emits and the ids the test recomputes.
const IDENTITY = {
  serverId: 'fs',
  callA: 'call-receipts-a',
  callB: 'call-receipts-b',
  modelCallA: 'mcall-receipts-a',
  modelCallB: 'mcall-receipts-b',
  modelName: 'mcp_fs_read',
};

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

/// Frozen P-3 (production `receiptId`): recompute-only classifier for rows the
/// production write path already persisted.
function receiptId(runId, attemptId, kind, callKey) {
  return createHash('sha256')
    .update(JSON.stringify([runId, attemptId, kind, callKey]), 'utf8')
    .digest('hex')
    .slice(0, 32);
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
  };
}

/// The worker record a real spawned worker left behind (production artifact),
/// selected by attempt so a re-claimed task's two records stay distinguishable.
function workerRecordForAttempt(root, attemptId) {
  const runs = join(root, 'runs');
  if (!existsSync(runs)) return null;
  for (const entry of readdirSync(runs)) {
    const path = join(runs, entry, 'worker.json');
    if (!existsSync(path)) continue;
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (record.attemptId === attemptId && record.taskId != null) return record;
    } catch {
      // A partially written record cannot prove ownership.
    }
  }
  return null;
}

/// Kill every surviving worker tree recorded under this root (production
/// `worker.json` artifacts carry the detached process group). Used by the
/// teardown so an early exit — a failed startup, a failed submission, a gate
/// timeout — can never leave a live stub worker behind; on the success path
/// the trees are already gone and the kills are no-ops. Every recorded tree
/// is attempted — a failing tree never skips the remaining ones — and only
/// after the loop has visited every target does the first collected error
/// (its original syscall stack) propagate, with all collected failures
/// riding along as `.errors`.
async function killWorkerTrees(root) {
  const runs = join(root, 'runs');
  if (!existsSync(runs)) return;
  const failures = [];
  for (const entry of readdirSync(runs)) {
    const path = join(runs, entry, 'worker.json');
    if (!existsSync(path)) continue;
    let record = null;
    try {
      record = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue; // a partially written record cannot prove ownership
    }
    if (!Number.isInteger(record?.pgid) || record.pgid <= 0) continue;
    try { process.kill(-record.pgid, 'SIGKILL'); } catch (error) {
      // Only a proven-gone tree (ESRCH) is exempt — any other kill failure
      // is collected and the loop CONTINUES with the remaining targets; a
      // failure is never read as "already gone" and never cancels the rest.
      if (error?.code !== 'ESRCH') failures.push(error);
    }
  }
  // Give the killed groups a moment to be reaped before the root is removed.
  await sleep(200);
  if (failures.length > 0) {
    failures[0].errors = failures;
    throw failures[0];
  }
}

/// Sanitized, bounded cleanup diagnostics: the world root, the repo, the node
/// binary and the home directory never reach a log, and the detail is capped
/// so a stack cannot flood the output. Text only — no private paths leave.
function sanitizeCleanupDiagnostic(root, error) {
  const lines = (error?.stack ?? error?.message ?? String(error)).toString().split('\n');
  return lines
    .map((line) => line
      .replaceAll(root, '<root>')
      .replaceAll(repositoryRoot, '<repo>')
      .replaceAll(process.execPath, '<node>')
      .replaceAll(homedir(), '~')
      .trim())
    .filter((line) => line.length > 0)
    .slice(0, 6)
    .map((line) => line.slice(0, 200))
    .join(' | ');
}

/// Report collected teardown failures for one case, into BOTH the TAP stream
/// (`t.diagnostic`, visible in the runner output whether or not the case body
/// already failed) and stderr — the diagnostics must not depend on the case's
/// own outcome to be seen.
function reportCleanupFailures(t, failures) {
  const lines = [
    `[cleanup] ${t.name}: ${failures.length} teardown step(s) FAILED; every remaining registered step was still attempted`,
    ...failures.map(([label, detail]) => `[cleanup]   ${label}: ${detail}`),
  ];
  for (const line of lines) {
    t.diagnostic(line);
    console.error(line);
  }
}

/// Boot the first backend instance as a REAL child process through the
/// production entry, wait for readiness and return its status lines. The
/// instance's kill step (child process + any surviving worker tree) is
/// registered into `teardown` the moment the child exists, so a failed
/// startup cannot leak either.
async function startFirstInstance(root, stubMode, teardown) {
  const statusFile = join(root, 'instance-status.jsonl');
  const child = spawn(process.execPath, [instanceRunner, root, statusFile, stubWorker], {
    env: {
      ...process.env,
      SIDEKICK_RECEIPTS_STUB: stubMode,
      SIDEKICK_RECEIPTS_IDENTITY: JSON.stringify(IDENTITY),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const killFirstInstance = async () => {
    // Every owned cleanup target is attempted and every failure is collected:
    // a failing first-instance kill must never skip the surviving worker
    // trees, and a failing tree must never skip the remaining ones (see
    // killWorkerTrees). Only after ALL targets were attempted does the first
    // collected error (original syscall stack) propagate.
    const failures = [];
    try { child.kill('SIGKILL'); } catch (error) {
      // ESRCH-only exemption — see killWorkerTrees; other failures are
      // collected here and the worker trees are still attempted below.
      if (error?.code !== 'ESRCH') failures.push(error);
    }
    try { await killWorkerTrees(root); } catch (error) {
      failures.push(...(Array.isArray(error?.errors) ? error.errors : [error]));
    }
    if (failures.length > 0) {
      failures[0].errors = failures;
      throw failures[0];
    }
  };
  teardown.push({ label: 'kill first instance + surviving worker trees', run: killFirstInstance });
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
  const record = await waitFor('worker record on disk', () => {
    const runs = join(root, 'runs');
    if (!existsSync(runs)) return null;
    for (const entry of readdirSync(runs)) {
      const path = join(runs, entry, 'worker.json');
      if (!existsSync(path)) continue;
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed.taskId === taskId) return parsed;
      } catch { /* a partially written record cannot prove ownership yet */ }
    }
    return null;
  }, 3000);
  try { if (record?.pgid) process.kill(-record.pgid, 'SIGKILL'); } catch (error) {
    // Same real-kill-layer discipline: only ESRCH reads as "tree already
    // gone"; a non-ESRCH failure here is a real crash-face failure.
    if (error?.code !== 'ESRCH') throw error;
  }
  if (record?.pid) {
    await waitFor('worker tree gone', () => {
      try { process.kill(record.pid, 0); return null; } catch { return true; }
    }, 3000);
  }
  await sleep(400);
}

/// Boot the restarted instance through the production entry in this process
/// (registerEpoch + recovery scan + scheduler start are the production boot
/// order). Retries until the crashed instance's storage adapter has released
/// the root lock. The controlled stub factory is passed through so a
/// re-claimed attempt runs the reviewed frame builders, never a live model.
/// The graceful-close step is registered into `teardown` the moment the
/// backend handle exists, so a later failure still shuts it down in order.
async function startRestartedInstance(root, { stubMode = 'receipts-bare' } = {}, teardown) {
  let lastError = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const backend = await startWebBackend({
        root,
        port: 0,
        storageBin: storageBinary,
        credentialProvider: new ControlledCredentialProvider({ secrets: new Map([['controlled:e2e', 'synthetic']]) }),
        workerProcessFactory: (file, args, options) =>
          spawn(process.execPath, [stubWorker, ...args.slice(1)], {
            ...options,
            env: {
              ...options.env,
              SIDEKICK_RECEIPTS_STUB: stubMode,
              SIDEKICK_RECEIPTS_IDENTITY: JSON.stringify(IDENTITY),
            },
          }),
      });
      // The exit gate's handle is the REAL production ChildProcess — the
      // locked-chain entry returns `recovery` (TaskRecovery keeps
      // storage/taskService) and `StorageClient.child` is the spawned child —
      // so `backend.recovery.storage.child` is the subprocess handle itself,
      // captured at acquisition time BEFORE close is ever invoked. The close
      // teardown step is REGISTERED FIRST, before any capture or listener
      // step can throw: a failed capture or listener registration (a missing
      // recovery envelope, null, undefined or a non-handle alike) is stored
      // and rethrown by the gate step AFTER close has run — cleanup is never
      // skipped, and the gate can never pass vacuously.
      let storageChild = null;
      let storageCaptureError = null;
      let storageExitSeen = null;
      teardown.push({ label: 'graceful close of the restarted backend', run: () => backend.close() });
      try {
        storageChild = backend.recovery?.storage?.child ?? null;
        if (!storageChild || typeof storageChild.once !== 'function' || typeof storageChild.kill !== 'function') {
          throw new Error('own storage subprocess handle is not a real ChildProcess (backend.recovery.storage.child)');
        }
        storageChild.once('exit', (code, signal) => { storageExitSeen = { code, signal }; });
      } catch (error) { storageCaptureError = error; }
      teardown.push({
        label: 'verify own storage subprocess exited after close',
        run: async () => {
          if (storageCaptureError !== null) throw storageCaptureError;
          // Production close() is best-effort by contract: its storage
          // adapter resolves on a bounded timer without waiting for the
          // child, so close resolving proves nothing about the subprocess.
          // The exit is proven on the production handle itself — its own
          // `exit` event / exit state — within a bounded window. A pid number
          // is not a handle: after a wait, a bare pid's identity is
          // unprovable, so the gate never scans the process table and never
          // signals a bare pid.
          const exited = () =>
            storageExitSeen !== null || storageChild.exitCode !== null || storageChild.signalCode !== null;
          const deadline = Date.now() + 5000;
          for (;;) {
            if (exited()) return;
            if (Date.now() > deadline) {
              // A survivor is enforced away ON THE HANDLE (SIGKILL + bounded
              // exit wait) so its pipes cannot keep this process alive, then
              // the gate fails loudly — the enforcement never masks the
              // failure.
              let enforcement = '';
              try {
                try { storageChild.kill('SIGKILL'); } catch (error) {
                  if (error?.code !== 'ESRCH') throw error;
                }
                await waitFor('enforced storage subprocess exit', () => (exited() ? true : null), 2000, 50);
              } catch (error) {
                enforcement = `; enforced SIGKILL did not complete: ${error?.message ?? error}`;
              }
              throw new Error(`own storage subprocess (handle pid ${storageChild.pid}) was still alive 5000ms after close() resolved — close() is best-effort by production contract, the exit must be proven on the handle captured before close${enforcement}`);
            }
            await sleep(100);
          }
        },
      });
      return backend;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`restarted instance failed to boot: ${lastError?.message ?? lastError}`);
}

/// Receipt rows of one attempt, read back through the production query path
/// (the same `storage.command('query')` the reviewed pairing regression used).
function receiptRows(taskService, attemptId) {
  return taskService.query(
    `SELECT receipt_id, kind, external_ref, recorded_at, provable_readonly
       FROM side_effect_receipts WHERE attempt_id=? ORDER BY receipt_id`,
    [attemptId],
  );
}

/// Crash → restart → recovery, driven entirely through two real backend
/// instances: the first boots through the production entry as a real child
/// process and is SIGKILLed; the restarted instance boots through the same
/// entry in this process. `gateStaged` selects the pre-crash durability gate:
/// the staged window (wire-visible, deterministic) or the read-only SQLite
/// observation of the persisted begin row (the bare-begin face). The
/// teardown is registered AT ACQUISITION time: the single after hook exists
/// from the moment the root is created, kill steps join it when the instance
/// child exists, the graceful close and the storage exit gate join it when
/// the restarted backend handle exists, and the root removal is ALWAYS the
/// last step — so a failed startup, a failed submission or a gate timeout
/// still tears the whole world down (kill → close → exit gate → root removal
/// last), never leaking a live worker, a backend, a storage subprocess or a
/// root. A failing cleanup step is never swallowed into a pass: every
/// registered step is still attempted in order, each failure is reported as
/// sanitized diagnostics, and a failure of the key kill/close/gate steps
/// turns an otherwise green case red. When the case body already failed, the
/// original assertion failure stays the case's failure and the diagnostics
/// keep the cleanup face visible next to it.
async function restartWorld(t, { stubMode, restartStubMode = 'receipts-bare', gateStaged = true }) {
  requireBinary();
  const root = mkdtempSync(join(tmpdir(), 'w1-receipts-'));
  const teardown = [];
  t.after(async () => {
    // Every registered step is attempted in order even after an earlier one
    // failed — a failing step never cancels the remaining cleanup.
    const failures = [];
    for (const step of teardown) {
      try { await step.run(); } catch (error) {
        failures.push([step.label, sanitizeCleanupDiagnostic(root, error)]);
      }
    }
    // The root is removed LAST, after the graceful shutdown — a live worker's
    // exit path re-writes its worker record (WorkerHost.state.finish), so
    // removing the root earlier would leave a recreated `runs/<runId>` stub
    // behind. The removal is attempted even when earlier steps failed, and
    // its own failure is reported the same way.
    try { rmSync(root, { recursive: true, force: true }); } catch (error) {
      failures.push(['remove root last', sanitizeCleanupDiagnostic(root, error)]);
    }
    if (failures.length > 0) {
      reportCleanupFailures(t, failures);
      // Cleanup errors are never swallowed into success: an otherwise green
      // case must turn red (node:test marks a throwing after hook
      // `hookFailed` and the run exits non-zero). When the body already
      // failed, throwing here would REPLACE the visible failure with the
      // hook error, so the case stays red through its own assertion failure
      // and the [cleanup] diagnostics above keep this face visible — either
      // way the run can never exit 0 with an incomplete cleanup.
      if (t.passed) {
        throw new Error(`cleanup did not complete (${failures.map(([label]) => label).join('; ')}) — teardown failures must not pass silently`);
      }
    }
  });
  const first = await startFirstInstance(root, stubMode, teardown);
  const api1 = clientFor(first.ready.origin, { token: first.ready.token, csrfToken: first.ready.csrfToken });

  const submitted = await api1.post('/api/text-sources', {
    operationId: `op_receipts_${Date.now()}`,
    input: { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' },
  });
  assert.equal(submitted.status, 200, 'the source must be submitted to the first instance');
  const taskId = submitted.body.task.taskId;

  await waitFor('task running on the first instance', async () => {
    const task = await api1.get(`/api/tasks/${taskId}`);
    return task.body.task.state === 'running' ? task.body.task : null;
  }, 5000);
  if (gateStaged) {
    // The staged window is the durability gate: the scheduler persists the
    // receipt facts of this attempt BEFORE it stages the result frame, so a
    // visible staged window proves all facts of this attempt are durable.
    await waitFor('staged window before the crash', async () => {
      const task = await api1.get(`/api/tasks/${taskId}`);
      return task.body.task.resultPendingExit === true ? task.body.task : null;
    }, 6000);
  } else {
    // The persisted-begin durability gate: a bare begin row has no
    // wire-visible gate, but the FACT ITSELF is the durability proof. The
    // read-only SQLite observation polls the real database file for the
    // committed begin row bound to this task's attempt, and the crash lands
    // only after that row is visibly persisted — no settle window, no timing
    // race. A row that never lands fails the gate loudly (timeout), never
    // silently.
    await waitFor('persisted begin row before the crash', () => {
      const rows = observe(root, (db) => db.prepare(
        `SELECT r.receipt_id, r.attempt_id, r.external_ref
           FROM side_effect_receipts r
           JOIN task_attempts a ON a.attempt_id = r.attempt_id
          WHERE a.task_id = ? AND r.kind = 'tool_call_begin'`,
      ).all(taskId));
      return rows.length === 1 ? rows : null;
    }, 6000);
  }

  await crashFirstInstance(first.child, root, taskId);

  const backend = await startRestartedInstance(root, { stubMode: restartStubMode }, teardown);
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
  assert.equal(recovered.body.task.attemptExitState, 'exited_confirmed', 'recovery must verify the exit before a resolve');
  assert.equal(recovered.body.task.resultPendingExit, gateStaged, 'the staged outcome must survive the restart exactly when it was staged');
  return { root, taskId, api, backend, taskService: backend.recovery.taskService };
}

test('RA1: begin/closed correlation and open non-readonly facts survive a real crash+restart', async (t) => {
  const world = await restartWorld(t, { stubMode: 'receipts-pair-result-hang', restartStubMode: 'receipts-bare' });
  const { root, taskId, api, backend, taskService } = world;
  const task = (await api.get(`/api/tasks/${taskId}`)).body.task;
  const attempt1 = task.attemptId;
  assert.ok(attempt1, 'the crashed attempt is still recorded on the wire');

  // The recovery landing keeps the side-effect safety unknown — three real
  // non-readonly receipts exist, so nothing may read this attempt as safe.
  // The recovery failure envelope lives in the production task row (the wire
  // only surfaces failure for staged outcomes), so it is read back through
  // the same production query path.
  const [failureJson] = await taskService.query('SELECT failure FROM tasks WHERE task_id=?', [taskId]);
  const failure = JSON.parse(failureJson[0]);
  assert.equal(failure.cause, 'restart_unknown_side_effect', 'the recovery failure carries the restart cause');
  assert.equal(failure.sideEffectSafety, 'unknown', 'real non-readonly receipts can never read as proven_safe');

  const attemptRows = await taskService.query(
    'SELECT attempt_id, epoch, ended_at FROM task_attempts WHERE task_id=?',
    [taskId],
  );
  assert.equal(attemptRows.length, 1, 'the crashed attempt stays the only attempt of this task');
  const [attemptId, epoch1, endedAt] = attemptRows[0];
  assert.equal(attemptId, attempt1, 'the wire attempt id is the persisted attempt row');
  assert.equal(endedAt, null, 'the attempt row stays open until the review resolves');
  assert.notEqual(epoch1, taskService.epoch, 'the restarted instance got a fresh epoch (the write fence exists)');

  const record1 = workerRecordForAttempt(root, attempt1);
  assert.ok(record1?.runId, 'the production worker record carries the run id');
  const runId1 = record1.runId;

  const rows = await receiptRows(taskService, attempt1);
  assert.equal(rows.length, 3, 'exactly the three pre-crash facts are readable after the restart');
  const kinds = rows.map((row) => row[1]);
  assert.deepEqual(kinds.slice().sort(), [
    'tool_call_begin',
    'tool_call_begin',
    'tool_call_closed',
  ], 'two begins and exactly one closure are preserved — no unattributed drift');
  const byExternalRef = Object.fromEntries(rows.map((row) => [row[1], row[2]]));
  assert.equal(byExternalRef.tool_call_closed, IDENTITY.callA, 'the closure carries call A');
  const beginRefs = rows.filter((row) => row[1] === 'tool_call_begin').map((row) => row[2]).sort();
  assert.deepEqual(beginRefs, [IDENTITY.callA, IDENTITY.callB].sort(), 'both begins carry their own call ids');
  for (const row of rows) {
    assert.equal(row[4], 0, `every preserved fact stays non-readonly (${row[1]})`);
    assert.equal(Number.isInteger(row[3]) && row[3] > 0, true, 'recorded_at is a real production timestamp');
  }

  // Frozen P-3, recomputed against production-written rows: the closure id
  // proves it inherited the BEGIN's callKey [callId, modelCallId] (real
  // pairing); a fabricated or FIFO closure would hash differently.
  assert.equal(rows.find((row) => row[1] === 'tool_call_begin' && row[2] === IDENTITY.callA)[0],
    receiptId(runId1, attempt1, 'tool_call_begin', [IDENTITY.callA, IDENTITY.modelCallA]),
    'begin(A) id follows the frozen formula');
  assert.equal(rows.find((row) => row[1] === 'tool_call_closed')[0],
    receiptId(runId1, attempt1, 'tool_call_closed', [IDENTITY.callA, IDENTITY.modelCallA]),
    'closed(A) id proves the persisted-begin pairing (inherits the begin callKey)');
  assert.equal(rows.find((row) => row[1] === 'tool_call_begin' && row[2] === IDENTITY.callB)[0],
    receiptId(runId1, attempt1, 'tool_call_begin', [IDENTITY.callB, IDENTITY.modelCallB]),
    'begin(B) id follows the frozen formula');

  // The open begin survived with NOTHING behind it: no closure, no
  // unattributed drift — a restart must not fabricate the missing half.
  assert.equal(rows.filter((row) => row[2] === IDENTITY.callB && row[1] !== 'tool_call_begin').length, 0,
    'the open begin(B) has no closure after the restart');

  assert.equal(await taskService.hasNonReadonlyReceipts(attempt1), true,
    'the production non-readonly check reads the preserved facts');
});

test('RA2: dead-attempt and old-epoch writes stay rejected; a new attempt with the same callId is identity-isolated', async (t) => {
  const world = await restartWorld(t, {
    stubMode: 'receipts-begin-hang',
    restartStubMode: 'receipts-response-result-hang',
    gateStaged: false,
  });
  const { root, taskId, api, backend, taskService } = world;
  const task = (await api.get(`/api/tasks/${taskId}`)).body.task;
  const attempt1 = task.attemptId;
  assert.equal(task.resultPendingExit, false, 'nothing was staged on the crashed attempt');
  const [failureJson] = await taskService.query('SELECT failure FROM tasks WHERE task_id=?', [taskId]);
  const failure = JSON.parse(failureJson[0]);
  assert.equal(failure.cause, 'restart_unknown_side_effect', 'the recovery failure carries the restart cause');
  assert.equal(failure.sideEffectSafety, 'unknown', 'a real open begin can never read as proven_safe');

  const attemptRows = await taskService.query(
    'SELECT attempt_id, epoch FROM task_attempts WHERE task_id=? ORDER BY started_at',
    [taskId],
  );
  assert.equal(attemptRows.length, 1, 'only the crashed attempt exists before the resume');
  const attempt1Epoch = attemptRows[0][1];
  const record1 = workerRecordForAttempt(root, attempt1);
  const runId1 = record1.runId;

  // The single open begin survived the crash — readable before anything else
  // touches the ledger.
  let rows1 = await receiptRows(taskService, attempt1);
  assert.equal(rows1.length, 1, 'exactly the one pre-crash begin is readable after the restart');
  assert.equal(rows1[0][1], 'tool_call_begin', 'the preserved row is the open begin');
  assert.equal(rows1[0][2], IDENTITY.callA, 'the begin carries call A');
  assert.equal(rows1[0][4], 0, 'the preserved begin stays non-readonly');
  assert.equal(rows1[0][0], receiptId(runId1, attempt1, 'tool_call_begin', [IDENTITY.callA, IDENTITY.modelCallA]),
    'the begin id follows the frozen formula');

  // Dead-attempt rejection: the task sits in needs_review, so no write may
  // land on its attempt — not even with a plausible identity.
  const deadWrite = await taskService.recordReceipt({
    runId: runId1,
    taskId,
    attemptId: attempt1,
    epoch: attempt1Epoch,
    kind: 'tool_call_begin',
    callKey: [IDENTITY.callA, 'mcall-dead-attempt'],
    externalRef: IDENTITY.callA,
    provableReadonly: false,
  });
  assert.equal(deadWrite, false, 'a write to the dead needs_review attempt must be rejected');
  rows1 = await receiptRows(taskService, attempt1);
  assert.equal(rows1.length, 1, 'the rejected write left the ledger untouched');

  // Resume re-queues the task for a fresh attempt (no staged outcome). The
  // resolve itemVersion is 1 on this chain (inputRef.recovery is not stamped).
  const resolved = await api.post(`/api/tasks/${taskId}/resolve`, {
    expectedVersion: task.recovery.itemVersion,
    decision: 'resume',
    acknowledgedReceipts: task.recovery.receipts.filter((receipt) => receipt.verifiable).map((receipt) => receipt.receiptId),
  });
  assert.equal(resolved.status, 202, 'the resume must be accepted');
  assert.equal(resolved.body.task.state, 'queued', 'a task with no staged outcome is re-queued for a fresh attempt');

  const claimed = await waitFor('second claim on the restarted instance', async () => {
    const current = await api.get(`/api/tasks/${taskId}`);
    return current.body.task.state === 'running' && current.body.task.attemptCount >= 2
      ? current.body.task
      : null;
  }, 8000);
  const attempt2 = claimed.attemptId;
  assert.ok(attempt2 && attempt2 !== attempt1, 'the fresh attempt is a different attempt row');

  // The staged window of the second attempt is the durability gate for its
  // receipt facts (persisted before the result frame is staged).
  await waitFor('staged window on the new attempt', async () => {
    const current = await api.get(`/api/tasks/${taskId}`);
    return current.body.task.resultPendingExit === true ? current.body.task : null;
  }, 6000);

  const attempt2Rows = await taskService.query(
    'SELECT attempt_id, epoch FROM task_attempts WHERE task_id=? ORDER BY started_at',
    [taskId],
  );
  assert.equal(attempt2Rows.length, 2, 'the fresh attempt is a second row');
  const attempt2Epoch = attempt2Rows.find((row) => row[0] === attempt2)?.[1];
  assert.ok(attempt2Epoch && attempt2Epoch !== attempt1Epoch, 'the fresh attempt runs under the new epoch');
  assert.equal(attempt2Epoch, taskService.epoch, 'the fresh attempt epoch is the restarted instance epoch');

  const record2 = workerRecordForAttempt(root, attempt2);
  assert.ok(record2?.runId && record2.runId !== runId1, 'the fresh attempt ran its own worker run');
  const runId2 = record2.runId;

  // Same callId, fresh attempt: the closure had NO persisted begin in THIS
  // attempt (fresh pairing state), so it must land unattributed under the NEW
  // attempt — never as a continuation of the old attempt's begin.
  const rows2 = await receiptRows(taskService, attempt2);
  assert.equal(rows2.length, 1, 'the fresh attempt holds exactly its own fact');
  assert.equal(rows2[0][1], 'tool_call_unattributed', 'a same-callId closure without an in-attempt begin stays unattributed');
  assert.equal(rows2[0][2], IDENTITY.callA, 'the unattributed fact still names call A');
  assert.equal(rows2[0][4], 0, 'the fresh fact stays non-readonly');
  assert.equal(rows2[0][0], receiptId(runId2, attempt2, 'tool_call_unattributed', null),
    'the fresh attempt id follows the frozen formula (attemptId is hashed in)');
  assert.notEqual(rows2[0][0], rows1[0][0], 'same callId across attempts can never collide into one row');

  // The old attempt's ledger is untouched: its begin stays a begin, and the
  // new attempt fabricated no closure for it.
  rows1 = await receiptRows(taskService, attempt1);
  assert.equal(rows1.length, 1, 'the old attempt ledger is unchanged after the new attempt');
  assert.equal(rows1[0][1], 'tool_call_begin', 'the old begin was not closed by the new attempt');
  assert.equal(rows2.filter((row) => row[1] === 'tool_call_closed').length, 0,
    'no fabricated closure exists on the new attempt');

  // Old-epoch rejection: the live new attempt only accepts writes under ITS
  // epoch — a stale pre-crash epoch is fenced out.
  const staleWrite = await taskService.recordReceipt({
    runId: runId2,
    taskId,
    attemptId: attempt2,
    epoch: attempt1Epoch,
    kind: 'tool_call_begin',
    callKey: [IDENTITY.callA, 'mcall-stale-epoch'],
    externalRef: IDENTITY.callA,
    provableReadonly: false,
  });
  assert.equal(staleWrite, false, 'an old-epoch write against the live new attempt must be rejected');
  assert.equal((await receiptRows(taskService, attempt2)).length, 1, 'the rejected write left the new ledger untouched');

  // Discrimination control (production write path, clearly synthetic
  // identity): a correctly-identified write still lands, and a duplicate is
  // idempotent — the guards discriminate by identity, they do not blanket-
  // refuse. This synthetic row proves nothing about safety by itself.
  const liveWrite = await taskService.recordReceipt({
    runId: runId2,
    taskId,
    attemptId: attempt2,
    epoch: attempt2Epoch,
    kind: 'tool_call_begin',
    callKey: [IDENTITY.callA, 'mcall-synthetic-control'],
    externalRef: IDENTITY.callA,
    provableReadonly: false,
  });
  assert.equal(liveWrite, true, 'a correctly-identified production write lands on the live attempt');
  const rowsAfterControl = await receiptRows(taskService, attempt2);
  assert.equal(rowsAfterControl.length, 2, 'the control write added exactly its own row');
  assert.ok(rowsAfterControl.some((row) => row[0] === receiptId(runId2, attempt2, 'tool_call_begin', [IDENTITY.callA, 'mcall-synthetic-control'])),
    'the control row follows the frozen formula');
  const duplicateWrite = await taskService.recordReceipt({
    runId: runId2,
    taskId,
    attemptId: attempt2,
    epoch: attempt2Epoch,
    kind: 'tool_call_begin',
    callKey: [IDENTITY.callA, 'mcall-synthetic-control'],
    externalRef: IDENTITY.callA,
    provableReadonly: false,
  });
  assert.equal(duplicateWrite, true, 'a duplicate write is idempotent');
  assert.equal((await receiptRows(taskService, attempt2)).length, 2, 'the duplicate added no row');

  assert.equal(await taskService.hasNonReadonlyReceipts(attempt2), true,
    'the new attempt ledger reads as non-readonly through the production check');
});
