//! Task submission, query, cancellation, retry, resolve and concurrency.
//!
//! Every state transition is a single conditional transaction on the frozen 001
//! `tasks` table. Slots follow `attempt_exit_state` (frozen `web-api/1` §3.2), so
//! a queued task occupies nothing and a result staged before exit confirmation
//! still occupies its slot.
//!
//! The scheduler (not this module) claims queued tasks and spawns workers; the
//! transaction primitives it needs are exposed as `claimNext`, `stageResult`
//! and `confirmExit` so they stay testable and single-writer.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ServiceError, canonicalize, CONTRACT_VERSION } from './manual-items-service.mjs';
import { validateAttemptExitEvidence } from './attempt-exit-evidence.mjs';

const TASK_TYPES = ['extract', 'revise', 'test'];
const TASK_ROLES = ['organizer'];
const TERMINAL_STATES = ['succeeded', 'failed', 'cancelled'];
const ACTIVE_EXIT_STATES = ['active', 'exiting', 'exited_unknown'];
const DEFAULT_ATTEMPT_BUDGET = 3;
const AUTO_BACKOFF_MS = 60 * 1000;
/// The one settings row this slice owns. Its `settings.changed` event carries
/// this key as `objectId` (frozen web-api/1 §6 `objectType: 'setting'`).
const SETTINGS_KEY = 'agentConcurrency';

/// Frozen web-api/1 §3.5: every cause in this set carries `itemVersion` — the
/// authority `recovery_items.version` both resolve entries CAS on. A cause
/// outside the set (only `backend_restart` in the frozen table) declares no
/// item version.
const RECOVERY_ITEM_CAUSES = new Set([
  'cancel_exit_unconfirmed', 'cancel_unknown_side_effect', 'restart_unknown_side_effect',
  'failure_unknown_side_effect', 'result_exit_unconfirmed', 'exit_unconfirmed',
  'backup_restore', 'root_activation', 'root_import',
]);
/// The disposition auditor recorded on the item when a resolve lands. This
/// slice has no finer driver identity than "the user decided"; the hold entry
/// may name its own actor when it is implemented.
const RESOLVE_DECIDED_BY = 'user';

/// The authoritative `task_events` cursor a committed transaction's LAST op
/// returned (`INSERT ... RETURNING cursor`); 0 when the op returned no row.
function eventCursor(result) {
  const rows = result?.results?.[result.results.length - 1]?.rows;
  const cursor = rows?.[0]?.[0];
  return Number.isInteger(cursor) ? cursor : 0;
}
/// Frozen §4.6 task-level failure registry. Each registered code carries its
/// `retryable` default (who initiates a retry). The safety routing is NOT a
/// per-code property: frozen §4.6 routes an unproven side effect to
/// `needs_review` for EVERY code — the code itself is never a safety proof,
/// and no code (`worker_lost` included) is exempt from
/// unknown → needs_review. `retryable` only decides who may retry; it never
/// gates the safety route.
const FAILURE_REGISTRY = {
  model_request_failed: { retryable: 'auto_backoff' },
  output_contract_invalid: { retryable: 'auto_backoff' },
  auth_or_config_invalid: { retryable: 'manual' },
  credential_unavailable: { retryable: 'manual' },
  tool_execution_failed: { retryable: 'manual' },
  worker_lost: { retryable: 'manual' },
};
/// Internal and runtime codes that are not public failure codes. Each maps to
/// the registered code that carries its meaning. The internal `model_timeout`
/// (backend deadline) and the runtime's own `MODEL_TIMEOUT` map to the
/// registered timeout code `model_request_failed`; a worker process that never
/// started, exited without a result or broke the host protocol is
/// `worker_lost` — never an automatic retry; MCP tool failures are
/// `tool_execution_failed`; configuration-class runtime errors keep the
/// configuration code. The model-transport classes the runtime reports for a
/// real request failure (`MODEL_AUTH` for a rejected credential, and
/// `MODEL_RATE_LIMIT`/`MODEL_NETWORK`/`MODEL_SERVICE` for a request the model
/// service did not serve) keep their meaning too — a rejected credential is a
/// configuration-class failure the user must fix by hand, while a throttled,
/// unreachable or erroring service is a request failure the backend may retry
/// with backoff. An unrecognized code is treated as a lost worker run rather
/// than inventing a classification.
const FAILURE_CODE_ALIASES = {
  model_timeout: 'model_request_failed',
  MODEL_TIMEOUT: 'model_request_failed',
  MODEL_INVALID_OUTPUT: 'output_contract_invalid',
  MODEL_AUTH: 'auth_or_config_invalid',
  MODEL_RATE_LIMIT: 'model_request_failed',
  MODEL_NETWORK: 'model_request_failed',
  MODEL_SERVICE: 'model_request_failed',
  runtime_start: 'worker_lost',
  runtime_exit: 'worker_lost',
  RUNTIME_PROTOCOL: 'worker_lost',
  CANCELLED: 'worker_lost',
  INVALID_TIMEZONE: 'auth_or_config_invalid',
  UNSUPPORTED_MODEL_PARAMETERS: 'auth_or_config_invalid',
  MCP_PROTOCOL: 'tool_execution_failed',
  MCP_TIMEOUT: 'tool_execution_failed',
  MCP_CATALOG_INVALID: 'tool_execution_failed',
  MCP_PRIVATE_OUTPUT: 'tool_execution_failed',
  MCP_CLEANUP: 'tool_execution_failed',
  MCP_RESULT_INVALID: 'tool_execution_failed',
  MCP_HTTP_AUTH: 'tool_execution_failed',
  MCP_HTTP_HEADER: 'tool_execution_failed',
  MCP_HTTP_REDIRECT: 'tool_execution_failed',
  MCP_HTTP_SESSION: 'tool_execution_failed',
  MCP_HTTP_STATUS: 'tool_execution_failed',
  MCP_HTTP_LIMIT: 'tool_execution_failed',
};
const DEFAULT_PUBLIC_FAILURE_CODE = 'worker_lost';

/// Normalize a backend failure payload into the public envelope
/// `{code, message, retryable, sideEffectSafety}` (frozen §3.1/§4.6). The
/// public `code` is always a registered code — internal diagnostics and
/// runtime codes are mapped, never exposed, and the envelope never carries an
/// `internalCode`. `retryable` comes from the registry, never from the model
/// or the worker payload.
function normalizeFailure(payload) {
  const raw = typeof payload?.code === 'string' ? payload.code : '';
  const code = FAILURE_REGISTRY[raw]
    ? raw
    : (FAILURE_CODE_ALIASES[raw] ?? DEFAULT_PUBLIC_FAILURE_CODE);
  const registered = FAILURE_REGISTRY[code];
  return {
    code,
    message: typeof payload?.message === 'string' && payload.message ? payload.message : '任务失败。',
    retryable: registered.retryable,
    // Never claim a side effect is safe without a receipt.
    sideEffectSafety: payload?.sideEffectSafety ?? 'unknown',
  };
}
const MAX_RESULT_INLINE_BYTES = 64 * 1024;
const MAX_RESULT_SEGMENT_BYTES = 16 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const SELECT_TASK = `SELECT task_id,operation_id,type,role,state,version,submit_seq,
  attempt_exit_state,result_pending_exit,pending_outcome,config_revision,original_config_revision,
  input_ref,cancel_intent,next_attempt_at,attempt_budget,result_ref,failure,created_at,updated_at,terminal_at
  FROM tasks`;

function validation(message) {
  return new ServiceError('validation_failed', message);
}

function notFound(message = '任务不存在。') {
  return new ServiceError('task_not_found', message);
}

function stateConflict(message) {
  return new ServiceError('state_conflict', message);
}

/// Frozen §4.5 wire shape for `acknowledgedReceipts`: the field is either
/// OMITTED (both resolve entries share the empty-list default) or an ARRAY OF
/// receipt id strings exactly as the wire exposed them. An explicitly provided
/// non-array — a bare string (even one CONTAINING a real receipt id, which the
/// former `includes` answering accepted as coverage), a number, an object,
/// `null` — or an array carrying any non-string member is a client shape
/// error: `validation_failed` (HTTP 400) at both resolve entries, never a
/// substring confirmation and never a TypeError 500. No receipt-id FORMAT
/// rule lives here; a string member carries no further shape.
function acknowledgedReceiptsOrRefuse(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((member) => typeof member !== 'string')) {
    throw validation('acknowledgedReceipts 必须是回执 id 字符串数组。');
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !value || value.length > 200) throw validation(`${label}无效。`);
  return value;
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw validation('cursor 无效。');
  }
  if (typeof decoded !== 'number' || !Number.isInteger(decoded)) throw validation('cursor 无效。');
  return decoded;
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_LIMIT) {
    throw validation(`limit 必须是 1–${MAX_LIMIT} 的整数。`);
  }
  return numeric;
}

export class TaskService {
  constructor({ storage, now = () => Date.now(), epoch = `inst_${randomBytes(6).toString('hex')}`, root = null } = {}) {
    this.storage = storage;
    this.now = now;
    // The instance epoch is the single identity every task_event row carries; a
    // restarted backend gets a fresh one, so stale writers are fenced out.
    this.epoch = epoch;
    // Run-directory root. The typed exit evidence is persisted beside the
    // attempt's worker record (`runs/<runId>/attempt-exit-evidence.json`) —
    // no schema change, no client mirror as authority.
    this.root = root;
  }

  /// The attempt's run directory, found from the worker record that owns the
  /// attemptId (the runId is never-reused and is not stored on the task row).
  findRunIdForAttempt(attemptId) {
    if (!this.root || !attemptId) return null;
    const runs = join(this.root, 'runs');
    if (!existsSync(runs)) return null;
    for (const entry of readdirSync(runs)) {
      const recordPath = join(runs, entry, 'worker.json');
      if (!existsSync(recordPath)) continue;
      try {
        const record = JSON.parse(readFileSync(recordPath, 'utf8'));
        if (record.attemptId === attemptId) return entry;
      } catch {
        // A partially written record cannot prove ownership.
      }
    }
    return null;
  }

  attemptExitEvidencePath(runId) {
    return join(this.root, 'runs', runId, 'attempt-exit-evidence.json');
  }

  /// Persist the typed evidence for an attempt. Returns the runId it was
  /// written to, or null when the attempt's run directory cannot be found.
  persistAttemptExitEvidence(attemptId, evidence) {
    if (!this.root || !attemptId || evidence === null || evidence === undefined) return null;
    const runId = this.findRunIdForAttempt(attemptId);
    if (!runId) return null;
    const path = this.attemptExitEvidencePath(runId);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    return runId;
  }

  /// Read the typed evidence for an attempt. Returns null when absent or
  /// invalid — a missing/corrupt evidence never confirms an exit (fail closed).
  readAttemptExitEvidence(attemptId) {
    if (!this.root || !attemptId) return null;
    const runId = this.findRunIdForAttempt(attemptId);
    if (!runId) return null;
    const path = this.attemptExitEvidencePath(runId);
    if (!existsSync(path)) return null;
    try {
      const evidence = JSON.parse(readFileSync(path, 'utf8'));
      return validateAttemptExitEvidence(evidence).length === 0 ? evidence : null;
    } catch {
      return null;
    }
  }

  async query(sql, params = []) {
    const result = await this.storage.command('query', { sql, params });
    return result.rows;
  }

  /// Run a transaction, mapping the adapter's pre-commit assertion failure to
  /// the caller's public conflict code. The default stays `version_conflict`
  /// (the global mapping is unchanged); a caller whose read-time state premise
  /// was lost passes its own code — `resolve` answers the contract's
  /// `state_conflict` for a concurrent state change, while an explicit
  /// recovery-item version mismatch keeps `version_conflict`.
  async transact(opsOrWrapper) {
    const ops = Array.isArray(opsOrWrapper) ? opsOrWrapper : opsOrWrapper?.ops;
    const conflictCode = Array.isArray(opsOrWrapper)
      ? 'version_conflict'
      : (opsOrWrapper?.conflictCode ?? 'version_conflict');
    try {
      return await this.storage.command('transact', { ops });
    } catch (error) {
      if (error.code === 'WEB_BACKEND_CONDITION_FAILED') {
        throw new ServiceError(conflictCode, '条件更新未匹配，请刷新后重试。');
      }
      throw error;
    }
  }

  async findTaskByOperation(operationId) {
    const rows = await this.query(`${SELECT_TASK} WHERE operation_id=?`, [operationId]);
    return rows[0] ?? null;
  }

  async getTaskRow(taskId) {
    const rows = await this.query(`${SELECT_TASK} WHERE task_id=?`, [taskId]);
    return rows[0] ?? null;
  }

  rowToInternal(row) {
    return {
      taskId: row[0],
      operationId: row[1],
      type: row[2],
      role: row[3],
      state: row[4],
      version: row[5],
      submitSeq: row[6],
      attemptExitState: row[7],
      resultPendingExit: row[8],
      pendingOutcome: row[9],
      configRevision: row[10],
      originalConfigRevision: row[11],
      inputRef: parseJsonField(row[12], {}),
      cancelIntent: row[13],
      nextAttemptAt: row[14],
      attemptBudget: row[15],
      resultRef: parseJsonField(row[16], null),
      failure: parseJsonField(row[17], null),
      createdAt: row[18],
      updatedAt: row[19],
      terminalAt: row[20],
    };
  }

  async attemptCount(taskId) {
    const rows = await this.query('SELECT count(*) FROM task_attempts WHERE task_id=?', [taskId]);
    return rows[0][0];
  }

  async currentAttemptId(taskId) {
    const rows = await this.query(
      'SELECT attempt_id FROM task_attempts WHERE task_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      [taskId],
    );
    return rows[0]?.[0] ?? null;
  }

  /// The most recent attempt even after it ended. The typed exit evidence is
  /// retained for the task's whole lifecycle (frozen §3.1: a terminal state
  /// never clears it), so the wire must look it up on the LAST attempt, not the
  /// current one (which is null once the attempt ended).
  async lastAttemptId(taskId) {
    const rows = await this.query(
      'SELECT attempt_id FROM task_attempts WHERE task_id=? ORDER BY started_at DESC LIMIT 1',
      [taskId],
    );
    return rows[0]?.[0] ?? null;
  }

  async queuePosition(taskId) {
    const row = await this.getTaskRow(taskId);
    if (!row) throw notFound();
    const internal = this.rowToInternal(row);
    if (internal.state !== 'queued') return null;
    const rows = await this.query('SELECT count(*) FROM tasks WHERE state=? AND submit_seq<?', [
      'queued',
      internal.submitSeq,
    ]);
    return rows[0][0] + 1;
  }

  async toWire(taskId) {
    const row = await this.getTaskRow(taskId);
    if (!row) throw notFound();
    const internal = this.rowToInternal(row);
    const [attemptCount, attemptId, queuePosition] = await Promise.all([
      this.attemptCount(taskId),
      this.currentAttemptId(taskId),
      this.queuePosition(taskId),
    ]);
    return this.wireFrom(internal, { attemptCount, attemptId, queuePosition });
  }

  async wireFrom(internal, { attemptCount = 0, attemptId = null, queuePosition = null }) {
    const recovery = await this.recoveryFor(internal);
    // Frozen §3.1: the typed evidence is null unless the attempt reached an
    // exited_* state; a missing/corrupt evidence is surfaced as null (fail
    // closed) rather than invented from the state field.
    const attemptExitEvidence = (internal.attemptExitState === 'exited_unknown'
      || internal.attemptExitState === 'exited_confirmed')
      ? this.readAttemptExitEvidence(attemptId ?? (await this.lastAttemptId(internal.taskId)))
      : null;
    return {
      contractVersion: CONTRACT_VERSION,
      taskId: internal.taskId,
      operationId: internal.operationId,
      type: internal.type,
      role: internal.role,
      state: internal.state,
      version: internal.version,
      createdAt: new Date(internal.createdAt).toISOString(),
      updatedAt: new Date(internal.updatedAt).toISOString(),
      terminalAt: internal.terminalAt === null ? null : new Date(internal.terminalAt).toISOString(),
      submitSeq: internal.submitSeq,
      queuePosition,
      attemptCount,
      attemptId,
      attemptExitState: internal.attemptExitState,
      attemptExitEvidence,
      cancelIntent: internal.cancelIntent === 1 && !TERMINAL_STATES.includes(internal.state),
      configRevision: internal.configRevision,
      originalConfigRevision: internal.originalConfigRevision,
      inputRef: internal.inputRef,
      progress: null,
      result: this.visibleResult(internal),
      resultPendingExit: internal.resultPendingExit === 1,
      failure: this.visibleFailure(internal),
      recovery,
    };
  }

  visibleResult(internal) {
    if (internal.state === 'succeeded' && internal.resultRef) return internal.resultRef;
    if (
      internal.state === 'needs_review' &&
      internal.resultPendingExit === 1 &&
      internal.pendingOutcome === 'succeeded' &&
      internal.attemptExitState === 'exited_confirmed'
    ) {
      return internal.resultRef;
    }
    return null;
  }

  visibleFailure(internal) {
    if (internal.state === 'failed' && internal.failure) return internal.failure;
    if (
      internal.state === 'needs_review' &&
      internal.resultPendingExit === 1 &&
      internal.pendingOutcome === 'failed' &&
      internal.attemptExitState === 'exited_confirmed'
    ) {
      return internal.failure;
    }
    return null;
  }

  async recoveryFor(internal) {
    if (internal.state !== 'interrupted' && internal.state !== 'needs_review') return null;
    const cause = internal.failure?.cause ?? internal.inputRef?.recovery?.cause ?? null;
    if (!cause) return null;
    // The version and the receipts are AUTHORITY facts — the task's current
    // `recovery_items` row and the isolated attempt's `side_effect_receipts`
    // rows — never the client-mirrored `inputRef.recovery`, which no business
    // flow ever writes (the cd08588 recovery-authority finding: that field
    // made the CAS a constant and the receipt check vacuous). A missing item
    // row is never fabricated: the absent `itemVersion` member is the visible
    // signal (frozen §3.5 clients must not invent values), and `resolve`
    // refuses such a task outright.
    const [item, receipts] = await Promise.all([
      this.currentRecoveryItem(internal.taskId),
      this.recoveryReceipts(internal.taskId),
    ]);
    const recovery = {
      cause,
      sideEffectKnown: internal.inputRef?.recovery?.sideEffectKnown ?? false,
      autoResume: false,
      reason: internal.inputRef?.recovery?.reason ?? null,
      receipts,
    };
    // An ambiguous authority (two or more pending rows) exposes NO itemVersion
    // either: a client must never be handed one row's version when no request
    // binding that version can lawfully dispose the task (both entries refuse
    // the ambiguous state). The absent member is the visible signal, exactly
    // like the missing-row case above.
    if (RECOVERY_ITEM_CAUSES.has(cause) && item && !item.ambiguous) recovery.itemVersion = item.version;
    if (internal.attemptExitState === 'exited_confirmed') {
      return { ...recovery, decisionOptions: ['resume', 'cancel'] };
    }
    return { ...recovery, stagedResult: internal.resultPendingExit === 1 };
  }

  /// The task's CURRENT authority recovery item (§12: ONE row per needs_review
  /// task, version monotonic across episodes — the re-entering episode REUSES
  /// and advances the same row, see `recoveryItemDockOp`; the PENDING row is
  /// the live one — an older row survives only in the pre-C4 legacy history).
  /// Exactly one pending row is the
  /// authority both resolve entries CAS on. ZERO pending rows fall back to the
  /// latest row of any state, so an already-disposed episode keeps answering
  /// the disposed refusal unchanged. TWO OR MORE pending rows are an AMBIGUOUS
  /// authority: the visible `{ ambiguous: true }` marker comes back instead of
  /// silently binding the newest row (the caff8b2 CC2 finding — the rowid pick
  /// disposed the latest row and left the older one hanging); the callers
  /// refuse such a task instead of disposing it. `rowid` order is the insert
  /// order; `recovery_items` carries no timestamp of its own.
  async currentRecoveryItem(taskId) {
    const pending = await this.query(
      `SELECT item_id,version,verification_state,decision,decided_by,decided_at
        FROM recovery_items WHERE task_id=? AND verification_state='pending' ORDER BY rowid DESC`,
      [taskId],
    );
    if (pending.length > 1) return { ambiguous: true, pendingCount: pending.length };
    const rows = pending.length === 1 ? pending : await this.query(
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

  /// The recovery-item write op for a needs_review docking (frozen §12: ONE
  /// row per needs_review task, `version` monotonic — the adjudicated C-4
  /// cross-episode reading). The task's FIRST episode creates the row at
  /// version 1; a RE-entering episode reuses the task's provable authority
  /// line — the SINGLE latest row — advancing its version back to `pending`
  /// with the disposition audit cleared and the `item_id` identity kept, so
  /// the previous episode's already-disposed request carries a version that
  /// can never match the new authority (409 `version_conflict`) and the item
  /// stays traceable across rounds.
  ///
  /// AMBIGUITY (the Codex C-4 revision, finding D): the legitimate flow ever
  /// carries EXACTLY ONE line per task. TWO OR MORE lines — a live pending
  /// line, or several disposed lines whose unique correspondence cannot be
  /// proven (the pre-C4 legacy history) — are an ambiguous authority: the
  /// dock refuses visibly (`state_conflict`) instead of guessing the newest
  /// rowid (caff8b2 CC2). No history is deleted and no unique constraint is
  /// added.
  ///
  /// COMMIT-TIME PREMISES (finding P1): the read happens before the caller's
  /// transaction, so the op re-states that premise inside it. The fresh
  /// INSERT is conditional (`INSERT ... SELECT ... WHERE NOT EXISTS`) and the
  /// reuse UPDATE binds the read-time `version` and asserts no live pending
  /// line — both carry `expectChanges: 1`, so a premise lost between the read
  /// and the commit rolls the WHOLE caller transaction back (a concurrent
  /// producer's insert is never forked into a second authority line, and a
  /// reused line is never advanced past a concurrent disposition).
  async recoveryItemDockOp(taskId) {
    const rows = await this.query(
      `SELECT item_id,version,verification_state FROM recovery_items WHERE task_id=? ORDER BY rowid DESC`,
      [taskId],
    );
    if (rows.length > 1) {
      throw stateConflict('恢复条目历史存在多条记录，无法唯一归属。');
    }
    if (rows.length === 1 && rows[0][2] === 'pending') {
      throw stateConflict('恢复条目仍待核对，不能重复停靠。');
    }
    if (rows.length === 0) {
      return {
        sql: `INSERT INTO recovery_items (item_id,hold_id,task_id,version,verification_state,decision,decided_by,decided_at)
          SELECT ?,NULL,?,1,'pending',NULL,NULL,NULL
          WHERE NOT EXISTS (SELECT 1 FROM recovery_items WHERE task_id=?)`,
        params: [`rec_${randomBytes(12).toString('hex')}`, taskId, taskId],
        expectChanges: 1,
      };
    }
    return {
      sql: `UPDATE recovery_items SET version=version+1,verification_state='pending',decision=NULL,decided_by=NULL,decided_at=NULL
        WHERE item_id=? AND version=? AND verification_state<>'pending'
          AND (SELECT COUNT(*) FROM recovery_items WHERE task_id=? AND verification_state='pending')=0`,
      params: [rows[0][0], rows[0][1], taskId],
      expectChanges: 1,
    };
  }

  /// The known external receipts of the task's recovery attempt (the latest
  /// attempt — the one whose exit the review covers), shaped per the frozen
  /// §3.5 sample. `verifiable` is the frozen §4.5 ACK-scope flag mapped onto
  /// the §12 field semantics: a receipt is verifiable exactly when its call is
  /// NOT proven read-only (`provable_readonly=0`). Another attempt's ledger
  /// never enters this answer, so cross-attempt isolation is structural, not
  /// a filter.
  async recoveryReceipts(taskId) {
    const rows = await this.query(
      `SELECT r.receipt_id,r.kind,r.external_ref,r.recorded_at,r.provable_readonly
        FROM side_effect_receipts r
        WHERE r.attempt_id=(
          SELECT a.attempt_id FROM task_attempts a WHERE a.task_id=?
            ORDER BY a.started_at DESC, a.rowid DESC LIMIT 1)
        ORDER BY r.recorded_at, r.receipt_id`,
      [taskId],
    );
    return rows.map((row) => ({
      receiptId: row[0],
      kind: row[1],
      externalRef: row[2],
      recordedAt: new Date(row[3]).toISOString(),
      verifiable: row[4] === 0,
    }));
  }

  /// Build a task_event op to append to an existing transition transaction, so
  /// the state change and its audit event commit together.
  eventOp({ objectType, objectId, type, payload, objectVersion }) {
    return {
      sql: `INSERT INTO task_events (object_type,object_id,type,payload,object_version,epoch,created_at)
        VALUES (?,?,?,?,?,?,?) RETURNING cursor`,
      params: [objectType, objectId, type, JSON.stringify(payload), objectVersion, this.epoch, this.now()],
    };
  }

  /// The latest cursor recorded for a task (0 when it has no events yet).
  async latestEventCursor(taskId) {
    const rows = await this.query(
      'SELECT COALESCE(MAX(cursor),0) FROM task_events WHERE object_type=? AND object_id=?',
      ['task', taskId],
    );
    return rows[0][0];
  }

  /// Audit a late result the fences rejected (frozen web-api/1 §3.3: a late
  /// result leaves a `rejected_late_result` trace and produces no business
  /// write). The audit is INDEPENDENT of the task's lifecycle:
  ///   * no business row and no task version changes — the event carries the
  ///     CURRENT version, never `version + 1`;
  ///   * the event type is `rejected_late_result`, never `task.changed`, so
  ///     no state-change frame is fabricated for a client;
  ///   * nothing is broadcast: the committed cursor advances the instance
  ///     high-watermark (the SSE reconnect/eviction discipline already
  ///     tolerates such unbroadcast gaps), while no frame claims a
  ///     transition that did not happen;
  ///   * the payload carries only the fence reason and the attempt identity —
  ///     never the raw frame, the worker nonce or any secret.
  /// `reason` names the fence: `attempt_identity` (the frame's worker
  /// identity did not match this attempt), `attempt_state` (the attempt no
  /// longer accepts results) or `attempt_or_epoch` (the result could not be
  /// attributed to the current attempt/epoch).
  async recordRejectedLateResult(taskId, attemptId, reason) {
    const row = await this.getTaskRow(taskId);
    if (!row) return false;
    const internal = this.rowToInternal(row);
    await this.transact({
      ops: [this.eventOp({
        objectType: 'task',
        objectId: taskId,
        type: 'rejected_late_result',
        payload: { attemptId, reason },
        // No state changed: the audit keeps the CURRENT object version.
        objectVersion: internal.version,
      })],
    });
    return true;
  }

  /// The instance-wide event high-watermark used by `/api/snapshot`.
  async readHighWatermark() {
    const rows = await this.query('SELECT COALESCE(MAX(cursor),0) FROM task_events');
    return rows[0][0];
  }

  async submit({ operationId, type, role, input, companionOps = null }) {
    identifier(operationId, 'operationId');
    if (!TASK_TYPES.includes(type)) throw new ServiceError('unknown_task_type', '任务类型无效。');
    if (!TASK_ROLES.includes(role)) throw new ServiceError('unknown_role', '任务角色无效。');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw validation('input 无效。');
    const existing = await this.findTaskByOperation(operationId);
    const canonical = canonicalize({ type, role, input });
    if (existing) {
      const internal = this.rowToInternal(existing);
      if (internal.inputRef?.canonical === canonical) {
        const wire = await this.toWire(internal.taskId);
        return { replayed: true, task: wire, status: 200 };
      }
      throw new ServiceError('idempotency_conflict', '同一 operationId 已用于不同请求。');
    }
    const taskId = `tsk_${randomBytes(16).toString('hex')}`;
    const now = this.now();
    const inputRef = { ...input, canonical };
    const ops = [
      {
        // submit_seq is derived inside the same transaction so concurrent
        // submissions cannot collide on the UNIQUE column.
        sql: `INSERT INTO tasks (${[
          'task_id', 'operation_id', 'type', 'role', 'state', 'version', 'submit_seq',
          'attempt_exit_state', 'result_pending_exit', 'pending_outcome', 'config_revision',
          'original_config_revision', 'input_ref', 'cancel_intent', 'next_attempt_at',
          'attempt_budget', 'result_ref', 'failure', 'created_at', 'updated_at', 'terminal_at',
        ].join(',')})
          SELECT ?,?,?,?,?,?,(SELECT COALESCE(MAX(submit_seq),0)+1 FROM tasks),?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,NULL`,
        params: [
          taskId, operationId, type, role, 'queued', 1, 'not_started', 0, null,
          input.configRevision ?? '', input.configRevision ?? '', JSON.stringify(inputRef), 0, null,
          DEFAULT_ATTEMPT_BUDGET, now, now,
        ],
      },
      {
        sql: `INSERT INTO task_events (object_type,object_id,type,payload,object_version,epoch,created_at)
          VALUES ('task',?,'task.changed',?,1,?,?) RETURNING cursor`,
        params: [taskId, JSON.stringify({ state: 'queued' }), this.epoch, now],
      },
    ];
    // Companion ops (W1 C4: the immutable text source and its first-task link)
    // commit inside the SAME transaction as the task row, so a source can
    // never exist without its first canonical input — and a failed submit
    // leaves neither behind. They run after the task insert because the
    // companion rows reference `task_id`.
    if (typeof companionOps === 'function') ops.push(...companionOps(taskId));
    await this.transact({ ops });
    const wire = await this.toWire(taskId);
    return { replayed: false, task: wire, status: 202 };
  }

  async get(taskId) {
    return this.toWire(taskId);
  }

  async getByOperation(operationId) {
    const row = await this.findTaskByOperation(operationId);
    if (!row) throw notFound();
    return this.toWire(row[0]);
  }

  async list({ state, cursor, limit } = {}) {
    const clauses = [];
    const params = [];
    if (state !== undefined && state !== null) {
      clauses.push('state=?');
      params.push(state);
    }
    const watermark = decodeCursor(cursor);
    if (watermark !== null) {
      clauses.push('submit_seq>?');
      params.push(watermark);
    }
    const pageSize = parseLimit(limit);
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = await this.query(
      `${SELECT_TASK}${where} ORDER BY submit_seq ASC LIMIT ?`,
      [...params, pageSize + 1],
    );
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const tasks = [];
    for (const row of page) {
      const internal = this.rowToInternal(row);
      const [attemptCount, attemptId, queuePosition] = await Promise.all([
        this.attemptCount(internal.taskId),
        this.currentAttemptId(internal.taskId),
        this.queuePosition(internal.taskId),
      ]);
      tasks.push(await this.wireFrom(internal, { attemptCount, attemptId, queuePosition }));
    }
    const nextCursor = hasMore && page.length ? encodeCursor(this.rowToInternal(page[page.length - 1]).submitSeq) : null;
    return { tasks, nextCursor };
  }

  async cancel(taskId, expectedVersion) {
    const row = await this.getTaskRow(taskId);
    if (!row) throw notFound();
    const internal = this.rowToInternal(row);
    if (expectedVersion !== undefined && expectedVersion !== null && internal.version !== expectedVersion) {
      throw new ServiceError('version_conflict', '任务已有更新，请刷新后重试。');
    }
    const now = this.now();
    if (internal.state === 'queued') {
      // The event joins the transition in ONE transaction with a pre-commit
      // `expectChanges: 1`: a cancel that lost the row (a concurrent claim or
      // cancel) rolls back whole — state AND event — and answers
      // `state_conflict`, so a no-op cancel leaves no phantom event. A stale
      // `expectedVersion` was already answered `version_conflict` above.
      await this.transact({
        ops: [{
          sql: `UPDATE tasks SET state='cancelled',cancel_intent=0,attempt_exit_state='not_started',
            version=version+1,updated_at=?,terminal_at=? WHERE task_id=? AND state='queued'`,
          params: [now, now, taskId],
          expectChanges: 1,
        },
        this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'cancelled' }, objectVersion: internal.version + 1 })],
        conflictCode: 'state_conflict',
      });
      return { task: await this.toWire(taskId), status: 200 };
    }
    if (internal.state === 'running') {
      await this.transact({
        ops: [{
          sql: `UPDATE tasks SET state='cancelling',cancel_intent=1,attempt_exit_state='exiting',
            version=version+1,updated_at=? WHERE task_id=? AND state='running'`,
          params: [now, taskId],
          expectChanges: 1,
        },
        this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'cancelling' }, objectVersion: internal.version + 1 })],
        conflictCode: 'state_conflict',
      });
      return { task: await this.toWire(taskId), status: 202 };
    }
    throw stateConflict('当前状态不允许取消。');
  }

  /// User retry (frozen §4.5): only a `manual` failure may be retried, and a
  /// changed `configRevision` is allowed only for the configuration-class
  /// codes. When the caller supplies a re-resolved `snapshot` (the explicit
  /// "run with the fixed configuration" signal), the immutable run snapshot is
  /// replaced in the SAME transaction so the next attempt actually uses the
  /// new configuration; `originalConfigRevision` keeps the first-queued value.
  async retry(taskId, expectedVersion, configRevision, { snapshot } = {}) {
    const row = await this.getTaskRow(taskId);
    if (!row) throw notFound();
    const internal = this.rowToInternal(row);
    if (internal.state !== 'failed') throw stateConflict('仅失败任务可重试。');
    const failure = internal.failure ?? {};
    if (failure.retryable !== 'manual') throw stateConflict('该任务不支持手动重试。');
    if (internal.version !== expectedVersion) {
      throw new ServiceError('version_conflict', '任务已有更新，请刷新后重试。');
    }
    if (configRevision !== undefined && configRevision !== null && configRevision !== internal.configRevision) {
      if (!['auth_or_config_invalid', 'config_revision_unknown'].includes(failure.code)) {
        throw new ServiceError('config_revision_change_not_allowed', '该失败码不允许变更配置修订。');
      }
    }
    const now = this.now();
    const inputRef = snapshot === undefined
      ? internal.inputRef
      : { ...internal.inputRef, snapshot: snapshot ?? null };
    // The event joins the transition in ONE transaction with a pre-commit
    // `expectChanges: 1`: a duplicate/concurrent retry carrying a stale
    // `expectedVersion` rolls the whole transaction back — the re-queue AND
    // its `task.changed` — and answers the frozen `version_conflict` (the
    // global conflict mapping is unchanged), so a no-op retry can never
    // leave a phantom event behind (the 9b305d9 finding).
    await this.transact({
      ops: [{
        sql: `UPDATE tasks SET state='queued',attempt_exit_state='not_started',result_pending_exit=0,
          pending_outcome=NULL,cancel_intent=0,next_attempt_at=NULL,attempt_budget=?,
          config_revision=?,failure=NULL,terminal_at=NULL,input_ref=?,version=version+1,updated_at=?
          WHERE task_id=? AND version=?`,
        params: [
          DEFAULT_ATTEMPT_BUDGET, configRevision ?? internal.configRevision,
          JSON.stringify(inputRef ?? {}), now, taskId, expectedVersion,
        ],
        expectChanges: 1,
      },
      this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'queued' }, objectVersion: internal.version + 1 })],
    });
    return this.toWire(taskId);
  }

  /// User disposition of a needs_review task (frozen §3.5/§4.5). The CAS is
  /// the AUTHORITY recovery item's version — the `recovery_items` row for this
  /// task (§12), shared with the staged-resume entry — never the client input
  /// mirror in `inputRef.recovery`, which no business flow writes and which a
  /// forged submit value can neither pass nor override. A missing item is a
  /// visible refusal; an AMBIGUOUS authority (two or more pending rows) is
  /// refused as well — the newest row is never silently disposed (caff8b2
  /// CC2); an already-disposed item (`resumed`/`cancelled`) keeps
  /// answering `state_conflict`; a stale `expectedVersion` answers
  /// `version_conflict` from the authority row. The receipt gate covers the
  /// attempt ledger's `verifiable` receipts (§4.5, `provable_readonly=0`) and
  /// shares the frozen ACK wire shape with the staged entry: an explicitly
  /// provided non-array or non-string-member list is a `validation_failed`
  /// client error, never a substring confirmation or a TypeError.
  /// The item disposition itself — version +1, `verification_state`,
  /// `decision`/`decided_by`/`decided_at` — commits in the SAME transaction as
  /// the task transition and its event, so a lost premise rolls back whole
  /// (zero side effects) and the task and item versions advance together.
  async resolve(taskId, expectedVersion, decision, acknowledgedReceipts = []) {
    const row = await this.getTaskRow(taskId);
    if (!row) throw notFound();
    const internal = this.rowToInternal(row);
    if (internal.state !== 'needs_review') throw stateConflict('仅待核对任务可处置。');
    if (internal.attemptExitState === 'exited_unknown') {
      throw new ServiceError('exit_unconfirmed', '进程退出尚未确认，请等待恢复扫描。');
    }
    const item = await this.currentRecoveryItem(taskId);
    if (!item) throw stateConflict('恢复条目缺失，无法处置。');
    if (item.ambiguous) throw stateConflict('恢复条目存在多条待核对记录，请先消解歧义。');
    if (item.verificationState !== 'pending') {
      throw stateConflict('核对条目已处置，请刷新后重试。');
    }
    if (item.version !== expectedVersion) {
      throw new ServiceError('version_conflict', '核对条目已有更新，请刷新后重试。');
    }
    if (decision === 'resume') {
      const acknowledged = acknowledgedReceiptsOrRefuse(acknowledgedReceipts);
      const receipts = await this.recoveryReceipts(taskId);
      const unacknowledged = receipts.find(
        (receipt) => receipt.verifiable && !acknowledged.includes(receipt.receiptId),
      );
      if (unacknowledged) throw validation('请先确认全部可核对回执。');
    }
    const now = this.now();
    // R8-M-2: finalize the attempt row this review was read against in the
    // SAME transaction (the exit was verified before a resolve may run, so the
    // row is closed here and never reopened). Leaving the row open would make
    // the next claim hit the partial unique index `task_attempts_current`,
    // fail on every scheduler tick and starve younger tasks.
    //
    // F-R8-2: the task UPDATE is bound to the read-time facts — version,
    // `needs_review` state and the verified exit — and carries a pre-commit
    // `expectChanges: 1`, so a concurrent writer that claimed a fresh attempt
    // (version bump + state change) between this read and the COMMIT aborts
    // the WHOLE transaction: the adapter rolls back the attempt finalization
    // and the event instead of committing `changes [0,1]` and throwing after
    // the fact. A late read can therefore never close a new-generation
    // attempt, and the lost premise answers the contract `state_conflict`
    // (an explicit recovery-item version mismatch stays `version_conflict`).
    const openAttemptId = await this.currentAttemptId(taskId);
    const closeAttemptOp = openAttemptId === null ? null : {
      sql: `UPDATE task_attempts SET ended_at=?, exit_confirmed_at=?, exit_reason='confirmed'
        WHERE attempt_id=? AND ended_at IS NULL`,
      params: [now, now, openAttemptId],
    };
    // The item disposition joins the task transition in ONE transaction
    // (§3.5: task and item versions advance together; §12: the decision audit
    // lands on the item row). The conditional UPDATE keeps `pending` as a
    // pre-commit assertion: a concurrent disposition aborts this whole batch.
    const dispositionOp = {
      sql: `UPDATE recovery_items SET version=version+1,verification_state=?,decision=?,decided_by=?,decided_at=?
        WHERE item_id=? AND version=? AND verification_state='pending'`,
      params: [decision === 'resume' ? 'resumed' : 'cancelled', decision, RESOLVE_DECIDED_BY, now, item.itemId, item.version],
      expectChanges: 1,
    };
    if (decision === 'cancel') {
      const ops = [{
        sql: `UPDATE tasks SET state='cancelled',cancel_intent=0,attempt_exit_state='exited_confirmed',
          terminal_at=?,version=version+1,updated_at=?
          WHERE task_id=? AND state='needs_review' AND version=? AND attempt_exit_state='exited_confirmed'`,
        params: [now, now, taskId, internal.version],
        expectChanges: 1,
      }, dispositionOp];
      if (closeAttemptOp) ops.push(closeAttemptOp);
      ops.push(this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'cancelled' }, objectVersion: internal.version + 1 }));
      await this.transact({ ops, conflictCode: 'state_conflict' });
      return this.toWire(taskId);
    }
    if (decision === 'resume') {
      // Resume re-queues the task for a fresh attempt; the staged outcome (if
      // any) is discarded because the user asked for a rerun.
      const ops = [{
        sql: `UPDATE tasks SET state='queued',attempt_exit_state='not_started',result_pending_exit=0,
          pending_outcome=NULL,cancel_intent=0,next_attempt_at=NULL,attempt_budget=?,
          failure=NULL,terminal_at=NULL,version=version+1,updated_at=?
          WHERE task_id=? AND state='needs_review' AND version=? AND attempt_exit_state='exited_confirmed'`,
        params: [DEFAULT_ATTEMPT_BUDGET, now, taskId, internal.version],
        expectChanges: 1,
      }, dispositionOp];
      if (closeAttemptOp) ops.push(closeAttemptOp);
      ops.push(this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'queued' }, objectVersion: internal.version + 1 }));
      await this.transact({ ops, conflictCode: 'state_conflict' });
      return this.toWire(taskId);
    }
    throw validation('decision 无效。');
  }

  async readResult(taskId, { offset, limit } = {}) {
    const row = await this.getTaskRow(taskId);
    if (!row) throw notFound();
    const internal = this.rowToInternal(row);
    const readable =
      internal.state === 'succeeded' ||
      (internal.state === 'needs_review' &&
        internal.resultPendingExit === 1 &&
        internal.attemptExitState === 'exited_confirmed' &&
        (internal.failure?.cause ?? internal.inputRef?.recovery?.cause) === 'result_exit_unconfirmed');
    if (!readable) throw stateConflict('当前状态不可读取结果。');
    if (internal.pendingOutcome === 'failed' || internal.state === 'failed') {
      if (offset !== undefined || limit !== undefined) throw new ServiceError('result_range_invalid', '失败结局不支持分段读取。');
      return {
        contractVersion: CONTRACT_VERSION,
        taskId,
        outcome: 'failed',
        kind: null,
        payload: null,
        failure: internal.failure ?? { code: 'model_request_failed', message: '任务失败。', retryable: 'none', sideEffectSafety: 'unknown' },
        acceptedByAttempt: await this.currentAttemptId(taskId),
        completedAt: internal.terminalAt === null ? null : new Date(internal.terminalAt).toISOString(),
      };
    }
    // The task row carries a frozen `result://<attemptId>/<name>` reference;
    // the bytes live in `task_result_payloads`.
    const reference = this.resolvePayloadRef(internal.resultRef?.payloadRef);
    if (!reference) throw new ServiceError('result_not_found', '结果不存在或已过期。');
    const buffer = await this.readResultPayload(reference.attemptId, reference.name);
    if (!buffer) throw new ServiceError('result_not_found', '结果不存在或已过期。');
    const totalBytes = buffer.length;
    const kind = internal.resultRef?.kind ?? 'json';
    if (totalBytes <= MAX_RESULT_INLINE_BYTES) {
      return {
        contractVersion: CONTRACT_VERSION,
        taskId,
        outcome: 'succeeded',
        kind,
        totalBytes,
        maxInlineBytes: MAX_RESULT_INLINE_BYTES,
        maxSegmentBytes: MAX_RESULT_SEGMENT_BYTES,
        inline: true,
        payload: buffer.toString('utf8'),
        failure: null,
        acceptedByAttempt: await this.currentAttemptId(taskId),
        completedAt: internal.terminalAt === null ? null : new Date(internal.terminalAt).toISOString(),
      };
    }
    // Frozen §4.3: a large result with no explicit range returns the INDEX
    // envelope (not the first segment); only an explicit `offset` returns bytes.
    if (offset === undefined || offset === null) {
      return {
        contractVersion: CONTRACT_VERSION,
        taskId,
        outcome: 'succeeded',
        kind,
        totalBytes,
        maxInlineBytes: MAX_RESULT_INLINE_BYTES,
        maxSegmentBytes: MAX_RESULT_SEGMENT_BYTES,
        inline: false,
        payload: null,
        payloadRef: internal.resultRef?.payloadRef ?? null,
        failure: null,
        nextOffset: 0,
        done: false,
        acceptedByAttempt: await this.currentAttemptId(taskId),
        completedAt: internal.terminalAt === null ? null : new Date(internal.terminalAt).toISOString(),
      };
    }
    const start = Number(offset);
    const size = limit === undefined || limit === null ? MAX_RESULT_SEGMENT_BYTES : Number(limit);
    if (!Number.isInteger(start) || start < 0) throw new ServiceError('result_range_invalid', 'offset 无效。');
    if (!Number.isInteger(size) || size <= 0 || size > MAX_RESULT_SEGMENT_BYTES) {
      throw new ServiceError('result_range_invalid', 'limit 无效。');
    }
    if (start >= totalBytes) throw new ServiceError('result_range_unsatisfiable', 'offset 已超出结果长度。');
    const slice = buffer.subarray(start, start + size);
    const done = start + slice.length >= totalBytes;
    return {
      contractVersion: CONTRACT_VERSION,
      taskId,
      outcome: 'succeeded',
      failure: null,
      offset: start,
      limit: size,
      bytesReturned: slice.length,
      totalBytes,
      nextOffset: done ? null : start + slice.length,
      done,
      payloadBase64: slice.toString('base64'),
    };
  }

  async readConcurrency() {
    const rows = await this.query("SELECT value,version FROM settings WHERE key='agentConcurrency'");
    const row = rows[0];
    if (!row) {
      return {
        contractVersion: CONTRACT_VERSION,
        agentConcurrency: 3,
        default: 3,
        version: 0,
        runningCount: await this.runningCount(),
        queuedCount: await this.queuedCount(),
      };
    }
    return {
      contractVersion: CONTRACT_VERSION,
      agentConcurrency: Number(row[0]),
      default: 3,
      version: row[1],
      runningCount: await this.runningCount(),
      queuedCount: await this.queuedCount(),
    };
  }

  async runningCount() {
    const rows = await this.query(
      'SELECT count(*) FROM tasks WHERE attempt_exit_state IN (?,?,?)',
      ACTIVE_EXIT_STATES,
    );
    return rows[0][0];
  }

  async queuedCount() {
    const rows = await this.query("SELECT count(*) FROM tasks WHERE state='queued'");
    return rows[0][0];
  }

  /// Frozen web-api/1 §5: a committed concurrency change broadcasts a
  /// `settings.changed` event. The event row commits in the SAME transaction
  /// as the settings write and the conditional UPDATE carries a pre-commit
  /// `expectChanges: 1` assertion, so a losing CAS rolls the event back with
  /// it — a settings change that did not happen leaves no phantom frame. The
  /// caller broadcasts post-commit with the returned authoritative cursor.
  async writeConcurrency(value, expectedVersion) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 32) throw validation('agentConcurrency 无效。');
    const settingsEvent = (nextVersion) => this.eventOp({
      objectType: 'setting',
      objectId: SETTINGS_KEY,
      type: 'settings.changed',
      payload: { agentConcurrency: numeric, version: nextVersion },
      objectVersion: nextVersion,
    });
    const current = await this.query("SELECT value,version FROM settings WHERE key='agentConcurrency'");
    const row = current[0];
    if (!row) {
      if (expectedVersion !== 0) throw new ServiceError('version_conflict', '设置版本已变化，请重新读取。');
      const result = await this.transact({
        ops: [{
          sql: "INSERT INTO settings(key,value,version)VALUES('agentConcurrency',?,1)",
          expectChanges: 1,
          params: [String(numeric)],
        }, settingsEvent(1)],
      });
      return { snapshot: await this.readConcurrency(), cursor: eventCursor(result) };
    }
    if (row[1] !== expectedVersion) throw new ServiceError('version_conflict', '设置版本已变化，请重新读取。');
    const result = await this.transact({
      ops: [{
        sql: "UPDATE settings SET value=?,version=version+1 WHERE key='agentConcurrency' AND version=?",
        expectChanges: 1,
        params: [String(numeric), expectedVersion],
      }, settingsEvent(row[1] + 1)],
    });
    return { snapshot: await this.readConcurrency(), cursor: eventCursor(result) };
  }

  // --- scheduler primitives (single writer) ---------------------------------

  /// Claim the oldest queued task when a slot is free. Returns the internal row
  /// or null. The conditional update is the single-writer guard: a losing
  /// writer observes `changes=0` and moves on.
  async claimNext(concurrency, epoch) {
    const rows = await this.query(
      `SELECT task_id FROM tasks WHERE state='queued' AND attempt_exit_state='not_started'
        AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY submit_seq ASC LIMIT 1`,
      [this.now()],
    );
    const taskId = rows[0]?.[0];
    if (!taskId) return null;
    const running = await this.runningCount();
    if (running >= concurrency) return null;
    const attemptId = `att_${randomBytes(16).toString('hex')}`;
    const now = this.now();
    const before = this.rowToInternal((await this.getTaskRow(taskId)));
    const result = await this.transact({
      ops: [
        {
          sql: `UPDATE tasks SET state='running',attempt_exit_state='active',version=version+1,updated_at=?
            WHERE task_id=? AND state='queued' AND attempt_exit_state='not_started'`,
          params: [now, taskId],
          expectChanges: 1,
        },
        {
          sql: `INSERT INTO task_attempts (attempt_id,task_id,epoch,worker_pid,started_at) VALUES (?,?,?,NULL,?)`,
          params: [attemptId, taskId, epoch, now],
        },
        this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'running' }, objectVersion: before.version + 1 }),
      ],
    });
    if (result.results[0].changes !== 1) return null;
    const row = await this.getTaskRow(taskId);
    return { row: this.rowToInternal(row), attemptId };
  }

  /// Bounded auto-backoff (frozen §4.6 / §3.2): the safety routing comes first
  /// and is code-independent — an unproven side effect isolates the task for
  /// review for EVERY registered code (无法证明即 unknown，转 needs_review),
  /// because a failure code is never a safety proof; no code retries
  /// automatically while the side-effect safety is unproven. Only a
  /// proven-safe `auto_backoff` failure re-enqueues, and the attempt budget is
  /// decremented; exhaustion downgrades the task to `manual`.
  async maybeAutoRetry(taskId) {
    const row = await this.getTaskRow(taskId);
    if (!row) return null;
    const internal = this.rowToInternal(row);
    if (internal.state !== 'failed') return null;
    const failure = internal.failure ?? {};
    const now = this.now();
    if (failure.sideEffectSafety !== 'proven_safe') {
      await this.markNeedsReview(taskId, { ...failure, cause: 'failure_unknown_side_effect' }, { exited: true });
      return 'needs_review';
    }
    // The stored `retryable` may have been downgraded by budget exhaustion.
    if (failure.retryable !== 'auto_backoff') return null;
    if (internal.nextAttemptAt && internal.nextAttemptAt > now) return 'deferred';
    const remaining = internal.attemptBudget - 1;
    if (remaining < 0) {
      await this.transact({
        ops: [{
          sql: `UPDATE tasks SET failure=? WHERE task_id=?`,
          params: [JSON.stringify({ ...failure, retryable: 'manual', nextAttemptAt: null }), taskId],
        }],
      });
      return 'failed';
    }
    const nextAttemptAt = now + AUTO_BACKOFF_MS;
    await this.transact({
      ops: [
        {
          sql: `UPDATE tasks SET state='queued',attempt_exit_state='not_started',result_pending_exit=0,
            pending_outcome=NULL,cancel_intent=0,next_attempt_at=?,attempt_budget=?,terminal_at=NULL,
            version=version+1,updated_at=? WHERE task_id=? AND state='failed'`,
          params: [nextAttemptAt, remaining, now, taskId],
          expectChanges: 1,
        },
        this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'queued', attemptBudget: remaining }, objectVersion: internal.version + 1 }),
      ],
    });
    return 'queued';
  }

  /// Persist a typed failure and release the slot when a worker completion
  /// transition itself fails (staging/confirmation error). The task is isolated
  /// for review rather than being left stuck in `running`.
  /// `exited` must reflect an actual process-exit observation, not an
  /// assumption: only then is the slot released (`exited_confirmed`); otherwise
  /// the attempt stays `exited_unknown` and keeps its slot.
  ///
  /// IDEMPOTENCE (the caff8b2 C-2 finding): the whole call is fenced on the
  /// task-state premise — the UPDATE carries `expectChanges: 1` (both
  /// variants), and the `exited` variant additionally refuses a task that is
  /// ALREADY `needs_review` (a duplicate/concurrent producer must not re-enter
  /// the state, bump the version again, insert a SECOND pending item or emit a
  /// phantom event). A lost premise rolls the whole transaction back — no
  /// item row, no event — and answers `state_conflict`, exactly like the other
  /// fenced transitions.
  async markNeedsReview(taskId, failure, { exited = false } = {}) {
    const row = await this.getTaskRow(taskId);
    if (!row) return null;
    const internal = this.rowToInternal(row);
    const now = this.now();
    // R6-M-4: a task already in a terminal state (failed/succeeded/cancelled)
    // carries terminal_at; leaving it set would violate the tasks CHECK, so the
    // downgrade clears it (and the staged-outcome columns).
    const sql = exited
      ? `UPDATE tasks SET state='needs_review',attempt_exit_state='exited_confirmed',failure=?,
          terminal_at=NULL,
          version=version+1,updated_at=? WHERE task_id=? AND state<>'needs_review'`
      : `UPDATE tasks SET state='needs_review',attempt_exit_state='exited_unknown',failure=?,
          version=version+1,updated_at=? WHERE task_id=? AND attempt_exit_state IN ('active','exiting')`;
    // The attempt stays open here: a needs_review task is not claimable, and
    // the open row records the unfinished attempt until the review is
    // resolved. The staged outcome is committed through the recovery item
    // version/task CAS, never through this row; the row itself is finalized
    // by the staged-resume commit or the re-queue (R8-M-2), never reopened.
    // §12: every needs_review task carries ONE authority recovery item — the
    // row both resolve entries CAS on — so it joins this same transaction,
    // exactly as the other needs_review producers (confirmExit,
    // confirmExtractExit, TaskRecovery.classify) already write theirs. The
    // dock REUSES the task's disposed line on a re-entering episode (version
    // +1, pending again, audit cleared — the C-4 cross-episode fix): a stale
    // episode request can never match the advanced authority version, and a
    // duplicate/ concurrent producer is refused by the state fence above or
    // the dock's pending-row refusal instead of inserting a second row.
    await this.transact({ ops: [
      { sql, params: [JSON.stringify(failure), now, taskId], expectChanges: 1 },
      this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'needs_review' }, objectVersion: internal.version + 1 }),
      await this.recoveryItemDockOp(taskId),
    ], conflictCode: 'state_conflict' });
    return this.toWire(taskId);
  }

  /// Stage a worker result before its exit is confirmed. The slot stays occupied
  /// and `result`/`failure` stay invisible.
  /// Deterministic receipt id (frozen P-3): SHA-256(UTF-8 compact
  /// JSON.stringify([runId, attemptId, kind, callKey])) first 32 hex chars.
  receiptId({ runId, attemptId, kind, callKey }) {
    return createHash('sha256')
      .update(JSON.stringify([runId, attemptId, kind, callKey]), 'utf8')
      .digest('hex')
      .slice(0, 32);
  }

  /// Record a real, non-secret side-effect fact for the current attempt/epoch.
  /// Duplicate frames are idempotent (receipt_id primary key) and never
  /// overwrite a different call's identity. `provable_readonly` is only ever
  /// true when the fact itself is an explicitly read-only operation.
  async recordReceipt({ runId, taskId, attemptId, epoch, kind, callKey, externalRef = null, provableReadonly = false }) {
    const row = await this.getTaskRow(taskId);
    if (!row) return false;
    const internal = this.rowToInternal(row);
    if (internal.attemptExitState !== 'active') return false;
    if (epoch !== undefined && epoch !== null && (await this.attemptEpoch(attemptId)) !== epoch) return false;
    const receiptId = this.receiptId({ runId, attemptId, kind, callKey });
    const existing = await this.query('SELECT receipt_id FROM side_effect_receipts WHERE receipt_id=?', [receiptId]);
    if (existing[0]) return true;
    // `external_ref` is NOT NULL: when no real external trace identifier exists
    // (an unattributed call), store a non-secret single-identity marker rather
    // than inventing a trace reference.
    const externalRefValue = externalRef ?? `unattributed:${receiptId}`;
    await this.transact({
      ops: [{
        sql: `INSERT INTO side_effect_receipts (receipt_id,attempt_id,kind,external_ref,recorded_at,provable_readonly)
          VALUES (?,?,?,?,?,?)`,
        params: [receiptId, attemptId, kind, externalRefValue, this.now(), provableReadonly ? 1 : 0],
      }],
    });
    return true;
  }

  /// Whether the attempt has any receipt that is NOT proven read-only. A zero
  /// count is never evidence of safety.
  async hasNonReadonlyReceipts(attemptId) {
    const rows = await this.query(
      'SELECT COUNT(*) FROM side_effect_receipts WHERE attempt_id=? AND provable_readonly=0',
      [attemptId],
    );
    return rows[0][0] > 0;
  }

  /// The persisted receipt count for an attempt. A zero count is never
  /// evidence of safety on its own; the scheduler's trusted-path proof binds
  /// it to the observed execution facts of the same attempt.
  async receiptCount(attemptId) {
    const rows = await this.query(
      'SELECT COUNT(*) FROM side_effect_receipts WHERE attempt_id=?',
      [attemptId],
    );
    return rows[0][0];
  }

  /// Persist the real result bytes for an attempt. `task_result_payloads`
  /// stores an opaque BLOB addressed by `result://<attemptId>/<name>`, so the
  /// task row only ever carries the reference (frozen §3.1/§4.3).
  async persistResultPayload(attemptId, name, bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
    await this.transact({
      ops: [{
        // The existing string parameter carries the exact bytes; CAST stores
        // them as a BLOB so `length()` counts bytes, not characters.
        sql: `INSERT INTO task_result_payloads (attempt_id,name,payload_blob,total_bytes,created_at)
          VALUES (?,?,CAST(? AS BLOB),?,?)
          ON CONFLICT(attempt_id,name) DO UPDATE SET
            payload_blob=excluded.payload_blob,total_bytes=excluded.total_bytes,created_at=excluded.created_at`,
        params: [attemptId, name, buffer.toString('utf8'), buffer.length, this.now()],
      }],
    });
  }

  async readResultPayload(attemptId, name) {
    const rows = await this.query(
      'SELECT payload_blob,total_bytes FROM task_result_payloads WHERE attempt_id=? AND name=?',
      [attemptId, name],
    );
    if (!rows[0]) return null;
    return Buffer.from(rows[0][0]);
  }

  /// Resolve a frozen `result://<attemptId>/<name>` reference to its bytes.
  resolvePayloadRef(payloadRef) {
    if (!payloadRef || typeof payloadRef !== 'string') return null;
    const match = /^result:\/\/([^/]+)\/(.+)$/.exec(payloadRef);
    if (!match) return null;
    return { attemptId: match[1], name: match[2] };
  }

  /// The epoch of an attempt, used to fence late/stale result frames (m-6).
  async attemptEpoch(attemptId) {
    const rows = await this.query('SELECT epoch FROM task_attempts WHERE attempt_id=?', [attemptId]);
    return rows[0]?.[0] ?? null;
  }

  async stageResult(taskId, attemptId, epoch, outcome, payload) {
    const row = await this.getTaskRow(taskId);
    if (!row) return false;
    const internal = this.rowToInternal(row);
    if (internal.attemptExitState !== 'active') return false;
    const currentAttempt = await this.currentAttemptId(taskId);
    if (currentAttempt !== attemptId) return false;
    // Fencing: only the attempt belonging to this instance epoch may stage.
    if (epoch !== undefined && epoch !== null && (await this.attemptEpoch(attemptId)) !== epoch) return false;
    const now = this.now();
    const bytes = outcome === 'succeeded' ? Buffer.from(JSON.stringify(payload ?? {}), 'utf8') : null;
    const resultRef = outcome === 'succeeded'
      ? { kind: payload?.kind ?? 'json', payloadRef: `result://${attemptId}/result` }
      : null;
    // Frozen §4.6: retryable is derived from the trusted backend failure code,
    // never taken from the model or the worker payload.
    const failure = outcome === 'failed'
      ? normalizeFailure(payload)
      : null;
    const ops = [{
      sql: `UPDATE tasks SET result_pending_exit=1,pending_outcome=?,result_ref=?,failure=?,
        version=version+1,updated_at=? WHERE task_id=? AND attempt_exit_state='active'`,
      params: [outcome, resultRef ? JSON.stringify(resultRef) : null, failure ? JSON.stringify(failure) : null, now, taskId],
      // The pre-commit assertion keeps staging atomic: a premise lost between
      // the read and the COMMIT rolls the payload row and the task.changed
      // event back with the no-op UPDATE — no phantom event survives.
      expectChanges: 1,
    }];
    if (bytes) {
      ops.push({
        sql: `INSERT INTO task_result_payloads (attempt_id,name,payload_blob,total_bytes,created_at)
          VALUES (?,?,CAST(? AS BLOB),?,?)
          ON CONFLICT(attempt_id,name) DO UPDATE SET
            payload_blob=excluded.payload_blob,total_bytes=excluded.total_bytes,created_at=excluded.created_at`,
        params: [attemptId, 'result', bytes.toString('utf8'), bytes.length, now],
      });
    }
    ops.push(this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'running', resultPendingExit: true, pendingOutcome: outcome }, objectVersion: internal.version + 1 }));
    // A lost premise answers the established `false` contract; the whole
    // staging transaction (payload + event included) rolled back.
    try {
      await this.transact({ ops });
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'version_conflict') return false;
      throw error;
    }
    return true;
  }

  /// Confirm the worker process tree has exited and commit the staged outcome.
  /// Returns the terminal state or null when the task had no staged outcome.
  /// Close the attempt row so `task_attempts_current` no longer blocks a
  /// re-claim (R6-M-1). Safe to call more than once.
  async closeAttempt(attemptId, at, reason = 'confirmed') {
    if (!attemptId) return;
    await this.transact({
      ops: [{
        // The audit reason follows the fact: an UNCONFIRMED park must never be
        // recorded as a confirmed exit (frozen §3.1.1/§3.2.1 — the verdict is
        // the authority, not the close itself).
        sql: `UPDATE task_attempts SET ended_at=?, exit_confirmed_at=?, exit_reason=?
          WHERE attempt_id=? AND ended_at IS NULL`,
        params: [at, ...(reason === 'confirmed' ? [at] : [null]), reason, attemptId],
      }],
    });
  }

  /// Strict persistence (frozen §3.1.1 + A2): the evidence must be written AND
  /// reread byte-identically before any release/event/visibility. Returns true
  /// only when the on-disk record matches; a missing run directory, a write
  /// failure or a reread mismatch all fail closed.
  persistAttemptExitEvidenceStrict(attemptId, evidence) {
    if (!this.root || !attemptId || evidence === null || evidence === undefined) return false;
    const runId = this.findRunIdForAttempt(attemptId);
    if (!runId) return false;
    const path = this.attemptExitEvidencePath(runId);
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    } catch {
      return false;
    }
    try {
      const reread = JSON.parse(readFileSync(path, 'utf8'));
      return JSON.stringify(reread) === JSON.stringify(evidence);
    } catch {
      return false;
    }
  }

  /// A launch-precheck failure (no model / no credential): NO worker was ever
  /// spawned. The registry domain is empty and there is no argv to scan, so the
  /// registry-domain exit is trivially confirmed by a degenerate typed evidence
  /// (frozen §3.1: `total=0` is a legal B(a) shape). A synthetic run record is
  /// materialized so the evidence has a directory to bind to and the
  /// attribution gate holds — never the legacy boolean.
  async confirmNoWorkerExit(taskId, attemptId, failurePayload) {
    const runId = `run_${randomBytes(12).toString('hex')}`;
    const now = this.now();
    const evidence = {
      verdict: 'registry_extinct',
      workerExited: true,
      groupAbsent: true,
      registry: { total: 0, confirmedExtinct: 0, unobservable: 0, survivors: [] },
      argvScan: { performed: true, hits: 0 },
      veto: { triggered: false, reason: null, detail: null },
      residual: { treeExtinctProven: false, scope: 'registry_domain', strayLedger: null },
      confirmedAt: new Date(now).toISOString(),
    };
    const dir = join(this.root, 'runs', runId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'worker.json'), JSON.stringify({
      runId, attemptId, taskId, pid: null, pgid: null, children: [], noWorker: true,
    }, null, 2), { mode: 0o600 });
    if (!this.persistAttemptExitEvidenceStrict(attemptId, evidence)) return null;
    return this.confirmExit(taskId, attemptId, { evidence, failurePayload });
  }

  /// Full consumer gate (frozen §3.1.1/§3.2.1 + A1): the supplied evidence
  /// must be structurally valid, must be `registry_extinct`, and must be the
  /// SAME record that is persisted beside the attempt (no forged, truncated,
  /// self-contradictory or late/old in-memory observation).
  validateExitEvidenceFor(attemptId, evidence) {
    if (!evidence || typeof evidence !== 'object') return { ok: false, reason: 'missing' };
    if (validateAttemptExitEvidence(evidence).length > 0) return { ok: false, reason: 'invalid' };
    if (evidence.verdict !== 'registry_extinct') return { ok: false, reason: 'not_extinct' };
    const persisted = this.readAttemptExitEvidence(attemptId);
    if (!persisted) return { ok: false, reason: 'not_persisted' };
    if (JSON.stringify(persisted) !== JSON.stringify(evidence)) {
      return { ok: false, reason: 'attribution_mismatch' };
    }
    return { ok: true };
  }

  /// Record the confirmed exit on the attempt row WITHOUT closing it: the
  /// attempt stays the task's current attempt until a resolve re-claims
  /// (frozen §3.4 — the recovery VERIFIES the exit, the resolve finalizes it).
  async markAttemptExitConfirmed(attemptId, at, reason = 'confirmed') {
    if (!attemptId) return;
    await this.transact({
      ops: [{
        sql: `UPDATE task_attempts SET exit_confirmed_at=?, exit_reason=?
          WHERE attempt_id=? AND exit_confirmed_at IS NULL`,
        params: [at, reason, attemptId],
      }],
    });
  }

  async confirmExit(taskId, attemptId, { exited = true, cancel = false, failurePayload = null, evidence = undefined } = {}) {
    const row = await this.getTaskRow(taskId);
    if (!row) return null;
    const internal = this.rowToInternal(row);
    if (internal.attemptExitState !== 'active' && internal.attemptExitState !== 'exiting') return null;
    const currentAttempt = await this.currentAttemptId(taskId);
    if (currentAttempt !== attemptId) return null;
    const now = this.now();
    // Typed verdict discrimination (frozen §3.1.1/§3.2.1 + A1): when the typed
    // evidence is supplied, the FULL consumer gate decides — structure,
    // invariants, verdict AND the persisted attribution must all hold. A
    // missing/forged/stale evidence fails closed (never confirms). The legacy
    // boolean stays only for callers with no typed observation at all.
    let confirmed = exited === true;
    if (evidence !== undefined) confirmed = this.validateExitEvidenceFor(attemptId, evidence).ok;
    // Every transition is conditional on the state a worker may legally be in
    // when its exit is confirmed, so a concurrent HTTP writer cannot double-write.
    const guard = " AND state IN ('running','cancelling')";
    if (!confirmed) {
      // The exit could not be confirmed, so the attempt stays
      // `exited_unknown` and keeps its slot — a missing worker handle is
      // never promoted to `exited_confirmed` on the guess that nothing ran.
      // The isolation registers its cause in the SAME transaction (frozen
      // §3.2/§3.5): a `needs_review` task without a recovery cause is not a
      // contract state — its `recovery` object would be null. With a staged
      // outcome the cause is `result_exit_unconfirmed` and the staged
      // envelope is preserved; with nothing staged it is `exit_unconfirmed`
      // and the envelope carries the real close-out fact through the §4.6
      // registry. The recovery item (fresh at version 1 on the task's first
      // episode, the task's disposed line advanced on a re-entering one — the
      // C-4 cross-episode fix) commits with them, and the task UPDATE keeps
      // its state premise as a pre-commit `expectChanges` assertion so a
      // concurrent producer that won the race rolls this WHOLE transaction —
      // item op included — back instead of writing a second pending row.
      const staged = internal.resultPendingExit === 1;
      const cause = staged ? 'result_exit_unconfirmed' : 'exit_unconfirmed';
      const failure = staged
        ? { ...(internal.failure ?? {}), cause }
        : { ...normalizeFailure(failurePayload ?? { code: 'worker_lost', message: '整理进程退出未能确认。' }), cause };
      await this.transact({
        ops: [{
          sql: `UPDATE tasks SET attempt_exit_state='exited_unknown',state='needs_review',failure=?,
            version=version+1,updated_at=? WHERE task_id=?${guard}`,
          params: [JSON.stringify(failure), now, taskId],
          expectChanges: 1,
        }, this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'needs_review', attemptExitState: 'exited_unknown' }, objectVersion: internal.version + 1 }),
        await this.recoveryItemDockOp(taskId)],
      });
      await this.closeAttempt(attemptId, now, 'unconfirmed');
      return 'needs_review';
    }
    if (internal.resultPendingExit === 1) {
      const terminal = internal.pendingOutcome === 'succeeded' ? 'succeeded' : 'failed';
      await this.transact({
        ops: [{
          sql: `UPDATE tasks SET state=?,attempt_exit_state='exited_confirmed',cancel_intent=0,
            terminal_at=?,version=version+1,updated_at=? WHERE task_id=?${guard}`,
          params: [terminal, now, now, taskId],
        }, this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: terminal, attemptExitState: 'exited_confirmed' }, objectVersion: internal.version + 1 })],
      });
      await this.closeAttempt(attemptId, now, 'confirmed');
      return terminal;
    }
    if (cancel) {
      await this.transact({
        ops: [{
          sql: `UPDATE tasks SET state='cancelled',attempt_exit_state='exited_confirmed',cancel_intent=0,
            terminal_at=?,version=version+1,updated_at=? WHERE task_id=?${guard}`,
          params: [now, now, taskId],
        }, this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'cancelled' }, objectVersion: internal.version + 1 })],
      });
      await this.closeAttempt(attemptId, now, 'confirmed');
      return 'cancelled';
    }
    await this.transact({
      ops: [{
        sql: `UPDATE tasks SET state='failed',attempt_exit_state='exited_confirmed',
          failure=?,terminal_at=?,version=version+1,updated_at=? WHERE task_id=?${guard}`,
        params: [JSON.stringify({ code: 'worker_lost', message: '整理进程未返回结果。', retryable: 'manual', sideEffectSafety: 'unknown' }), now, now, taskId],
      }, this.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'failed' }, objectVersion: internal.version + 1 })],
    });
    await this.closeAttempt(attemptId, now, 'confirmed');
    return 'failed';
  }
}

export { TASK_TYPES, ACTIVE_EXIT_STATES, TERMINAL_STATES, FAILURE_REGISTRY, normalizeFailure, RESOLVE_DECIDED_BY, acknowledgedReceiptsOrRefuse };
