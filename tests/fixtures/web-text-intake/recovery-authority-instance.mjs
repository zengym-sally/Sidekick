//! Boot machinery for the recovery-authority regression (MAYNE-24).
//!
//! One REAL backend instance per face: the real storage adapter binary over a
//! fresh synthetic root, and the real TaskService / TextIntakeService /
//! TaskRecovery (+ opt-in real HttpServer on an ephemeral loopback port) of the
//! tree under test. No scheduler, no worker host and no model service: the
//! faces under test are the two resolve entries and the recovery wire, which
//! sit entirely below the execution layer — the HTTP faces exercise the REAL
//! handler (pairing/session/CSRF/status mapping) with real services, and
//! nothing upstream of it (no real Pi) is involved anywhere.
//!
//! Every audited state is reached by BUSINESS transitions only
//! (submit -> claimNext -> recordReceipt -> stageResult ->
//! confirmExtractExit(exited:false) -> TaskRecovery.recover()). The ONE legal
//! state injection is the authority-seam `UPDATE recovery_items SET version=…`
//! (`injectItemVersion`): no business writer advances `recovery_items` on the
//! audited baseline (registered finding F1), so an authority advance is
//! simulated directly on the authority table — never through `inputRef`,
//! never through a service write path.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { StorageClient } from '../../../server/lib/storage-client.mjs';
import { TaskService } from '../../../server/lib/task-service.mjs';
import { TextIntakeService } from '../../../server/lib/text-intake-service.mjs';
import { TaskRecovery } from '../../../server/lib/task-recovery.mjs';
import { ManualItemsService } from '../../../server/lib/manual-items-service.mjs';
import { ApplicationSettingsService } from '../../../server/lib/application-settings-service.mjs';
import { SessionStore } from '../../../server/lib/session-store.mjs';
import { SseHub } from '../../../server/lib/sse-hub.mjs';
import { HttpServer } from '../../../server/lib/http-server.mjs';
import { ConfigStore } from '../../../server/lib/config-store.mjs';
import { ControlledCredentialProvider } from '../../../server/lib/credential-provider.mjs';

export class PrerequisiteGap extends Error {}

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');
const storageBinary = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');

export function requireStorageBinary() {
  if (!existsSync(storageBinary)) {
    throw new PrerequisiteGap(
      `storage adapter binary not found at ${storageBinary}; `
      + 'build it first: (cd src-tauri && cargo build --release --bin web-backend-storage)',
    );
  }
  return storageBinary;
}

const SOURCE_TEXT = '我负责整理接入清单，下周五17点前交付。';
let instanceSeq = 0;

/// A synthetic registry-domain observer for the recovery faces: the fixture's
/// parked attempts never spawn a real worker, so the observer reports the
/// degenerate `registry_extinct` evidence (no process was ever spawned). This
/// is the explicitly-authorised synthetic legal observation; the
/// missing-observer counter-control lives in the test.
export function syntheticExitEvidence() {
  return {
    verdict: 'registry_extinct',
    workerExited: true,
    groupAbsent: true,
    registry: { total: 0, confirmedExtinct: 0, unobservable: 0, survivors: [] },
    argvScan: { performed: true, hits: 0 },
    veto: { triggered: false, reason: null, detail: null },
    residual: { treeExtinctProven: false, scope: 'registry_domain', strayLedger: null },
    confirmedAt: new Date().toISOString(),
  };
}

function syntheticExitObserver() {
  return {
    async observeAttemptExit() {
      return { attemptExitEvidence: syntheticExitEvidence() };
    },
    async runStraySweep() {
      return { disclosure: { found: 0, swept: 0, pending: 0 } };
    },
  };
}

/// Seed the attempt's run record so the recovery scan can bind the typed
/// evidence. The production worker-host writes this at spawn; the fixture has
/// no worker, so the synthetic observation is registered explicitly.
function seedAttemptRun(root, attemptId) {
  const runId = `run_${attemptId}`;
  const dir = join(root, 'runs', runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'worker.json'), JSON.stringify({
    runId, attemptId, pid: null, pgid: null, children: [], synthetic: true,
  }, null, 2), { mode: 0o600 });
  return runId;
}

/// One fresh backend instance (fresh synthetic root, fresh storage adapter
/// process). `withHttp` additionally boots the REAL HttpServer on an ephemeral
/// loopback port and pairs a write-capable session through the real /api/pair.
export async function createInstance({ withHttp = false } = {}) {
  const binary = requireStorageBinary();
  const root = mkdtempSync(join(tmpdir(), `w1-recovery-authority-${++instanceSeq}-`));
  const storage = new StorageClient({ binary, root, initialize: true });
  await storage.start();
  const sse = new SseHub();
  sse.start();
  const taskService = new TaskService({ storage, root, epoch: sse.epoch });
  const credentialProvider = new ControlledCredentialProvider({ secrets: new Map([['controlled:e2e', 'synthetic']]) });
  const configStore = new ConfigStore({ root, credentialProvider });
  const textIntake = new TextIntakeService({ storage, taskService, configStore });
  const taskRecovery = new TaskRecovery({ storage, taskService, root, workerHost: syntheticExitObserver(), epoch: sse.epoch });
  // Seed the run record for every claim so the recovery scan has an observer
  // binding (the production host writes it at spawn).
  const originalClaimNext = taskService.claimNext.bind(taskService);
  taskService.claimNext = async (...args) => {
    const claimed = await originalClaimNext(...args);
    if (claimed) seedAttemptRun(root, claimed.attemptId);
    return claimed;
  };
  const ctx = { root, storage, sse, epoch: sse.epoch, taskService, textIntake, taskRecovery, configStore };
  if (withHttp) {
    const httpServer = new HttpServer({
      service: new ManualItemsService(storage),
      sessions: new SessionStore(),
      sse,
      staticRoot: '.',
      root,
      expectedHost: '',
      applicationSettings: new ApplicationSettingsService(storage),
      taskService,
      textIntake,
      configStore,
    });
    const port = await httpServer.listen(0);
    httpServer.expectedHost = `127.0.0.1:${port}`;
    const origin = `http://127.0.0.1:${port}`;
    const session = await pairSession(origin, httpServer);
    ctx.httpServer = httpServer;
    ctx.port = port;
    ctx.origin = origin;
    ctx.session = session;
    ctx.api = clientFor(origin, session);
  }
  ctx.close = async () => {
    if (ctx.httpServer) await ctx.httpServer.close();
    sse.stop();
    await storage.close();
    rmSync(root, { recursive: true, force: true });
  };
  return ctx;
}

/// Drive one task to the parked needs_review state through the production
/// transitions only. `withReceipt` records one real verifiable side-effect
/// receipt (`provable_readonly=0`) on the claim; `stage` ('none'|'success')
/// stages the outcome before the unconfirmed-exit park.
export async function parkTask(ctx, { withReceipt = false, stage = 'none', recoveryMirror = null } = {}) {
  const operationId = `op_authority_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const input = { text: SOURCE_TEXT, timeZone: 'Asia/Shanghai' };
  let taskId;
  if (recoveryMirror === null) {
    // The REAL intake path: the text source, the first task and their link
    // commit together — required wherever candidates get staged (the
    // `candidates.source_id` FK) and used for every non-forged face.
    const submitted = await ctx.textIntake.submitSource(operationId, input);
    if (submitted.reused) throw new Error('the synthetic source must be fresh');
    taskId = submitted.task.taskId;
  } else {
    // Forged-mirror faces only: the raw task entry accepts arbitrary input
    // fields, which is exactly the client-controlled channel a forged
    // `inputRef.recovery` travels in — the face proves the authority chain
    // ignores it end to end.
    const submitted = await ctx.taskService.submit({
      operationId,
      type: 'extract',
      role: 'organizer',
      input: { ...input, recovery: recoveryMirror },
    });
    taskId = submitted.task.taskId;
  }
  const claimed = await ctx.taskService.claimNext(4, ctx.epoch);
  if (!claimed || claimed.row.taskId !== taskId) {
    throw new Error('expected the only fresh task to be claimed first');
  }
  const attemptId = claimed.attemptId;
  if (withReceipt) {
    const recorded = await ctx.taskService.recordReceipt({
      runId: `run_${operationId}`,
      taskId,
      attemptId,
      epoch: ctx.epoch,
      kind: 'lark_message_send',
      callKey: 'call:1',
      externalRef: 'om_synthetic_authority_receipt',
      provableReadonly: false,
    });
    if (!recorded) throw new Error('the verifiable receipt must record on the active attempt');
  }
  if (stage === 'success') {
    // The REAL text-intake staging path: it writes the task's staged window
    // AND the `staged` candidate rows that a staged resume later publishes.
    const staged = await ctx.textIntake.stageExtractResult(taskId, attemptId, [
      {
        fields: { title: '整理接入清单', kind: 'action', owner: '我', priority: 'medium' },
        evidence: 'synthetic-authority-evidence',
      },
    ]);
    if (!staged) throw new Error('staging must succeed on the active attempt');
  }
  const parked = await ctx.textIntake.confirmExtractExit(taskId, attemptId, { exited: false, epoch: ctx.epoch });
  if (parked !== 'needs_review') throw new Error(`expected the park transition, got ${parked}`);
  return { taskId, attemptId, operationId };
}

/// The real reclaim: the parked attempt row is still open, so the production
/// recovery scan verifies the (nonexistent) worker tree is gone and flips
/// exited_unknown -> exited_confirmed.
export async function reclaim(ctx) {
  return ctx.taskRecovery.recover();
}

/// Drive ONE MORE needs_review round on an ALREADY-resolved task through the
/// production transitions only — the C-4 cross-episode machinery (MAYNE-30):
/// claim a new attempt, optionally stage a fresh extract result, park it
/// through the real unconfirmed-exit path and run the real reclaim. Returns
/// the new attempt id. `stage` mirrors `parkTask` ('none' | 'success').
export async function reparkTask(ctx, taskId, { stage = 'none' } = {}) {
  const claimed = await ctx.taskService.claimNext(4, ctx.epoch);
  if (!claimed || claimed.row.taskId !== taskId) {
    throw new Error('expected the re-queued task to claim again');
  }
  if (stage === 'success') {
    const staged = await ctx.textIntake.stageExtractResult(taskId, claimed.attemptId, [
      {
        fields: { title: '整理接入清单', kind: 'action', owner: '我', priority: 'medium' },
        evidence: 'synthetic-authority-evidence-repark',
      },
    ]);
    if (!staged) throw new Error('staging must succeed on the active attempt');
  }
  const parked = await ctx.textIntake.confirmExtractExit(taskId, claimed.attemptId, { exited: false, epoch: ctx.epoch });
  if (parked !== 'needs_review') throw new Error(`expected the re-park transition, got ${parked}`);
  await reclaim(ctx);
  return claimed.attemptId;
}

/// THE one legal state injection, at the authority seam and labeled: advance
/// the task's authority recovery item directly on the authority table. It
/// never touches `inputRef` and never runs through a service write path.
export async function injectItemVersion(ctx, taskId, version) {
  await ctx.taskService.transact({
    ops: [{ sql: 'UPDATE recovery_items SET version=? WHERE task_id=?', params: [version, taskId] }],
  });
}

/// The SECOND legal state injection, same authority seam and labeled: insert
/// an extra PENDING recovery item so the task carries two or more pending
/// rows. No business writer creates that ambiguous state — reproducing it is
/// exactly the caff8b2 CC2 condition (an authority anomaly that must be
/// REFUSED by both resolve entries, never disposed by picking a row).
export async function injectPendingRecoveryItem(ctx, taskId) {
  await ctx.taskService.transact({
    ops: [{
      sql: `INSERT INTO recovery_items (item_id,hold_id,task_id,version,verification_state,decision,decided_by,decided_at)
        VALUES (?,NULL,?,1,'pending',NULL,NULL,NULL)`,
      params: [`rec_injected_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, taskId],
    }],
  });
}

/// The THIRD legal state injection, same authority seam and labeled: insert
/// an extra DISPOSED (`resumed`) recovery item, reproducing the pre-C4 legacy
/// history (the former per-episode fresh-v1 dock) — a task with SEVERAL
/// disposed lines whose unique correspondence cannot be proven. No business
/// writer of this tree creates that state (the §12 dock REUSES the single
/// line); the Codex revision (finding D) requires the dock to REFUSE it
/// visibly instead of guessing the newest rowid.
export async function injectDisposedRecoveryItem(ctx, taskId, version = 2) {
  await ctx.taskService.transact({
    ops: [{
      sql: `INSERT INTO recovery_items (item_id,hold_id,task_id,version,verification_state,decision,decided_by,decided_at)
        VALUES (?,NULL,?,?,'resumed','resume','user',?)`,
      params: [`rec_injected_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, taskId, version, Date.now()],
    }],
  });
}

/// How many PENDING recovery items the task currently carries (the ambiguity
/// counter the K faces assert on).
export async function pendingRecoveryRowCount(ctx, taskId) {
  const rows = await ctx.taskService.query(
    `SELECT COUNT(*) FROM recovery_items WHERE task_id=? AND verification_state='pending'`,
    [taskId],
  );
  return rows[0][0];
}

export async function recoveryItemRow(ctx, taskId) {
  const rows = await ctx.taskService.query(
    `SELECT item_id,version,verification_state,decision,decided_by,decided_at
      FROM recovery_items WHERE task_id=? ORDER BY rowid DESC LIMIT 1`,
    [taskId],
  );
  const row = rows[0];
  return row ? {
    itemId: row[0],
    version: row[1],
    verificationState: row[2],
    decision: row[3],
    decidedBy: row[4],
    decidedAt: row[5],
  } : null;
}

export async function stagedCandidateRows(ctx, taskId) {
  return ctx.taskService.query('SELECT candidate_id,status FROM candidates WHERE run_id=?', [taskId]);
}

export async function taskEventCount(ctx, taskId) {
  const rows = await ctx.taskService.query(
    'SELECT COUNT(*) FROM task_events WHERE object_type=? AND object_id=?',
    ['task', taskId],
  );
  return rows[0][0];
}

async function pairSession(origin, httpServer) {
  const pairingCode = httpServer.sessions.generatePairingCode();
  const response = await fetch(`${origin}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ pairingCode }),
  });
  if (response.status !== 200) throw new Error('pairing must succeed');
  const body = await response.json();
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie.startsWith('sidekick_session=')) throw new Error('the session cookie must be issued');
  return { token: cookie.replace('sidekick_session=', ''), csrfToken: body.csrfToken };
}

/// Real HTTP calls against the real handler (cookie + CSRF + Origin rules).
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
