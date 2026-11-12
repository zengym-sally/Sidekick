//! Text sources, candidates, revise previews and batch sign-off.
//!
//! Every write is one atomic transaction. `staged` candidates are written by the
//! result-staging transaction and stay invisible/unsignable until the worker
//! exit is confirmed; sign-off is all-or-nothing and records the batch ledger
//! plus the deterministic per-row `sign_off:` keys (frozen contract §5.1).

import { createHash, randomBytes } from 'node:crypto';
import { ServiceError, canonicalize, CONTRACT_VERSION, normalizeInput, normalizeTags, normalizePoint, pointParameters, wirePoint } from './manual-items-service.mjs';
import { normalizeFailure, RESOLVE_DECIDED_BY, acknowledgedReceiptsOrRefuse } from './task-service.mjs';
import { buildModelSnapshot, credentialRefFor } from './model-snapshot.mjs';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const SELECT_SOURCE = `SELECT source_id,fingerprint,kind,raw_text,source_at_ms,imported_at_ms,
  anchor_at_ms,time_zone,succeeded_run_id FROM text_sources`;

const SELECT_CANDIDATE = `SELECT candidate_id,source_id,run_id,ordinal,status,version,fields_json,
  evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms
  FROM candidates`;

function validation(message) {
  return new ServiceError('validation_failed', message);
}

function notFound(message) {
  return new ServiceError('candidate_not_found', message);
}

function stateConflict(message) {
  return new ServiceError('state_conflict', message);
}

function timeReviewRequired() {
  return new ServiceError('time_review_required', '存在未定期字段，请核对时间或勾选保留未定期。');
}

/// The runtime's draft shape is the internal/domain shape (`due.atMs`), not the
/// wire shape (`due.at`). Normalize it to the same internal shape the candidate
/// columns store, so a staged draft round-trips without a lossy conversion.
function normalizeDraftPoint(value, label) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation(`${label}格式无效。`);
  // Accept both the internal/domain shape (`atMs`) and the wire shape (`at`).
  const atMs = Number.isInteger(value.atMs)
    ? value.atMs
    : (typeof value.at === 'string' ? Date.parse(value.at) : NaN);
  if (!Number.isInteger(atMs) || Math.abs(atMs) > 8640000000000000) throw validation(`${label}时间无效。`);
  const timeZone = typeof value.timeZone === 'string' ? value.timeZone : '';
  if (!timeZone) throw validation(`${label}缺少时区。`);
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw validation(`${label}时区无效。`);
  }
  const localText = typeof value.localText === 'string' ? value.localText : '';
  if (!localText) throw validation(`${label}缺少原始表达。`);
  const precision = value.precision ?? 'minute';
  if (precision !== 'minute' && precision !== 'day') throw validation(`${label}精度无效。`);
  return { atMs, timeZone, localText, precision };
}

function normalizeDraftFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('input 必须是对象。');
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title) throw validation('标题不能为空。');
  if ([...title].length > 500) throw validation('标题最多 500 字。');
  if (value.kind !== 'action' && value.kind !== 'followup') throw validation('事项类型无效。');
  const owner = typeof value.owner === 'string' ? value.owner.trim() : '';
  if (!owner) throw validation('负责人不能为空。');
  if ([...owner].length > 200) throw validation('负责人最多 200 字。');
  if (!['low', 'medium', 'high'].includes(value.priority)) throw validation('优先级无效。');
  return {
    title,
    kind: value.kind,
    owner,
    priority: value.priority,
    due: normalizeDraftPoint(value.due, '截止时间'),
    followup: normalizeDraftPoint(value.followup, '下次跟进'),
    tags: normalizeTags(value.tags),
  };
}

function parseLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_LIMIT) {
    throw validation(`limit 必须是 1–${MAX_LIMIT} 的整数。`);
  }
  return numeric;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error();
    return { importedAtMs: decoded[0], sourceId: decoded[1] };
  } catch {
    throw validation('cursor 无效。');
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function deriveSignOffKey(batchOperationId, candidateId) {
  const json = JSON.stringify(['sign_off', batchOperationId, candidateId]);
  return `sign_off:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
}

/// The reviewed operation-key family (frozen §5.1): the deterministic
/// `sign_off:` per-row keys share the `operation_id` namespace with the
/// manual-item event/source ledgers and the batch table itself. A UNIQUE
/// conflict on one of these exact columns — with no batch row of our own —
/// is a cross-family key collision: another family's row already occupies
/// the key, the whole batch rolled back, and the honest answer is a state
/// conflict. The match is exact on the constraint text the storage adapter
/// surfaces, so no other SQL error is ever treated as a key conflict.
const OPERATION_KEY_CONSTRAINTS = [
  'manual_item_events.operation_id',
  'manual_item_sources.operation_id',
  'sign_off_batches.operation_id',
];

function isOperationKeyConflict(error) {
  const message = String(error?.message ?? '');
  return OPERATION_KEY_CONSTRAINTS.some((column) => message === `UNIQUE constraint failed: ${column}`);
}

function toDomainPoint(point) {
  return point
    ? { atMs: point.atMs, timeZone: point.timeZone, localText: point.localText, precision: point.precision ?? 'minute' }
    : null;
}

function fieldsToDomain(fields) {
  return {
    title: fields.title,
    kind: fields.kind,
    owner: fields.owner,
    priority: fields.priority,
    tags: fields.tags,
    due: toDomainPoint(fields.due),
    followup: toDomainPoint(fields.followup),
  };
}

/// The public wire for the editable fields: identical to the domain fields
/// except the two date points, which cross the HTTP boundary on the
/// established DatePoint line (`{at,timeZone,localText,precision}`, frozen
/// web-api/1 §1) — the same conversion `ManualItemsService.toWire` applies to
/// an item's due/followup, reused through the shared `wirePoint`. The private
/// `atMs` points never cross: stored `fields_json`, the revise task input and
/// the runtime drafts stay on the internal shape.
function fieldsToWire(fields) {
  const domain = fieldsToDomain(fields);
  return { ...domain, due: wirePoint(domain.due), followup: wirePoint(domain.followup) };
}

/// The canonical draft the runtime's revise branch produces (and
/// `stageReviseResult` persists): the editable attributes nested under
/// `fields`, with `evidence`, both date expressions, `warnings` and the
/// `unresolved` flag beside them — the same attribute set a candidate carries
/// on the wire (frozen §5.1). Reading the whole draft as fields (the earlier
/// behaviour) silently dropped every attribute but `fields` itself.
function draftAttributes(draft) {
  const canonical = draft !== null && typeof draft === 'object' && !Array.isArray(draft)
    && draft.fields !== null && typeof draft.fields === 'object';
  return {
    fields: canonical ? draft.fields : draft,
    evidence: canonical && typeof draft.evidence === 'string' ? draft.evidence : '',
    dueExpression: canonical && typeof draft.dueExpression === 'string' ? draft.dueExpression : null,
    followupExpression: canonical && typeof draft.followupExpression === 'string' ? draft.followupExpression : null,
    warnings: canonical && Array.isArray(draft.warnings) ? draft.warnings.filter((entry) => typeof entry === 'string') : [],
    unresolved: canonical ? draft.unresolved === true : false,
  };
}

/// The candidate columns an applied preview writes. A canonical draft carries
/// every attribute, so the apply makes the candidate's evidence, date
/// expressions, warnings and unresolved flag consistent with the applied
/// fields in the same commit; a bare-fields draft (no `fields` wrapper) only
/// carries the fields and leaves the candidate's other attributes as they are.
function appliedAttributes(draft, candidate) {
  const canonical = draft !== null && typeof draft === 'object' && !Array.isArray(draft)
    && draft.fields !== null && typeof draft.fields === 'object';
  if (!canonical) {
    return {
      evidence: candidate.evidence,
      dueExpression: candidate.dueExpression,
      followupExpression: candidate.followupExpression,
      warnings: candidate.warnings,
      unresolved: candidate.unresolved,
    };
  }
  return {
    evidence: typeof draft.evidence === 'string' ? draft.evidence : candidate.evidence,
    dueExpression: typeof draft.dueExpression === 'string' ? draft.dueExpression : null,
    followupExpression: typeof draft.followupExpression === 'string' ? draft.followupExpression : null,
    warnings: Array.isArray(draft.warnings) ? draft.warnings.filter((entry) => typeof entry === 'string') : [],
    unresolved: draft.unresolved === true,
  };
}

export class TextIntakeService {
  constructor({ storage, taskService, configStore = null, applicationSettings = null, now = () => Date.now(), onCandidatesChanged = null }) {
    this.storage = storage;
    this.taskService = taskService;
    this.configStore = configStore;
    this.applicationSettings = applicationSettings;
    this.now = now;
    this.onCandidatesChanged = onCandidatesChanged;
  }

  /// The production default for an omitted `timeZone` (frozen §5.1: the field
  /// is optional): the stored `application.timeZone` setting, falling back to
  /// the instance OS zone — the same resolution `ApplicationSettingsService`
  /// performs for every other read. Without a wired settings service the OS
  /// zone is used directly, so the default never depends on the caller.
  async defaultTimeZone() {
    if (this.applicationSettings) {
      const snapshot = await this.applicationSettings.read();
      return snapshot.settings.timeZone;
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  emitChanged(sourceId) {
    if (typeof this.onCandidatesChanged === 'function') this.onCandidatesChanged({ sourceId });
  }

  /// Build the immutable run snapshot, tolerating an unconfigured model so the
  /// task is queued and fails at run time instead of being rejected at intake.
  async snapshotFor() {
    if (!this.configStore) return null;
    try {
      return await buildModelSnapshot({ configStore: this.configStore, agentId: 'organizer', profile: {} });
    } catch (error) {
      if (error?.code === 'model_not_configured' || error?.code === 'invalid_model_config') return null;
      throw error;
    }
  }

  async query(sql, params = []) {
    const result = await this.storage.command('query', { sql, params });
    return result.rows;
  }

  /// Run a transaction, mapping the adapter's pre-commit assertion failure to
  /// the existing public conflict code.
  async transact(ops) {
    try {
      return await this.storage.command('transact', { ops });
    } catch (error) {
      if (error.code === 'WEB_BACKEND_CONDITION_FAILED') {
        throw new ServiceError('version_conflict', '条件更新未匹配，请刷新后重试。');
      }
      throw error;
    }
  }

  rowToSource(row) {
    return {
      sourceId: row[0],
      fingerprint: row[1],
      kind: row[2],
      rawText: row[3],
      sourceAtMs: row[4] === null || row[4] === undefined ? null : row[4],
      importedAtMs: row[5],
      anchorAtMs: row[6],
      timeZone: row[7],
      succeededRunId: row[8],
    };
  }

  /// The source wire (frozen §5.1 + the C4 date-point line). `sourceAt` is the
  /// `{at,timeZone,localText,precision}` point shared with the manual-item
  /// due/followup DTO. The three source columns cannot carry
  /// `localText`/`precision`, so the COMPLETE first canonical point is read
  /// back from the first task's immutable `input_ref` — the read-back binds to
  /// the first task, which is also what fingerprint dedup and operationId
  /// replay return. A source whose first task (or its point) is missing — only
  /// possible for rows written before the point line or when the link itself
  /// was lost — falls back to the columns with the unknown point parts left
  /// null rather than fabricating metadata.
  ///
  /// `point` is the first task's `sourceAt` when the caller already read it;
  /// omitted, it is looked up from the first task.
  async sourceWire(source, point = undefined) {
    let resolved = point;
    if (resolved === undefined) {
      const task = source.succeededRunId ? await this.taskService.get(source.succeededRunId) : null;
      resolved = task?.inputRef?.source?.sourceAt ?? null;
    }
    return {
      sourceId: source.sourceId,
      fingerprint: source.fingerprint,
      kind: source.kind,
      rawText: source.rawText,
      sourceAt: resolved ?? {
        at: new Date(source.anchorAtMs).toISOString(),
        timeZone: source.timeZone,
        localText: null,
        precision: 'minute',
      },
      importedAtMs: source.importedAtMs,
      anchorAtMs: source.anchorAtMs,
      timeZone: source.timeZone,
      succeededRunId: source.succeededRunId,
    };
  }

  /// The first tasks' `sourceAt` points for a page of sources, in one batched
  /// read of the immutable `tasks.input_ref` (the only place the complete
  /// point survives). Missing tasks simply have no entry.
  async firstTaskPoints(succeededRunIds) {
    const points = new Map();
    const ids = [...new Set(succeededRunIds.filter((id) => typeof id === 'string' && id))];
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100);
      const rows = await this.query(
        `SELECT task_id,input_ref FROM tasks WHERE task_id IN (${batch.map(() => '?').join(',')})`,
        batch,
      );
      for (const row of rows) {
        let inputRef = {};
        try {
          inputRef = JSON.parse(row[1] ?? '{}');
        } catch {
          inputRef = {};
        }
        points.set(row[0], inputRef?.source?.sourceAt ?? null);
      }
    }
    return points;
  }

  /// Frozen W1 contract §5.1: the candidate attributes (`fields`, `evidence`,
  /// `dueExpression`, `followupExpression`, `warnings`, `unresolved`) are
  /// first-level candidate properties — there is no `draft` wrapper on the
  /// wire. `fields` is isomorphic with a manual item (title/kind/owner/
  /// priority/due/followup/tags).
  rowToCandidate(row) {
    const fields = JSON.parse(row[6]);
    return {
      candidateId: row[0],
      sourceId: row[1],
      runId: row[2],
      ordinal: row[3],
      status: row[4],
      version: row[5],
      fields: fieldsToDomain(fields),
      evidence: row[7],
      dueExpression: row[8] ?? null,
      followupExpression: row[9] ?? null,
      warnings: JSON.parse(row[10]),
      unresolved: row[11] === 1,
      acceptedItemId: row[12] ?? null,
      processedAt: row[13] === null || row[13] === undefined ? null : new Date(row[13]).toISOString(),
    };
  }

  /// The public candidate wire (frozen §5.1): the same first-level attribute
  /// set `rowToCandidate` builds, with `fields.due`/`fields.followup` on the
  /// established DatePoint line. `rowToCandidate` stays the INTERNAL converter
  /// — its `atMs` points are what the revise task input, the sign-off paths
  /// and the stored `fields_json` use — and every public read maps through
  /// here, so the point conversion stops at the HTTP serialization boundary.
  candidateWire(candidate) {
    return { ...candidate, fields: fieldsToWire(candidate.fields) };
  }

  async findSourceByFingerprint(fingerprint) {
    const rows = await this.query(`${SELECT_SOURCE} WHERE fingerprint=?`, [fingerprint]);
    return rows[0] ? this.rowToSource(rows[0]) : null;
  }

  async getSourceRow(sourceId) {
    const rows = await this.query(`${SELECT_SOURCE} WHERE source_id=?`, [sourceId]);
    return rows[0] ?? null;
  }

  async getCandidateRow(candidateId) {
    const rows = await this.query(`${SELECT_CANDIDATE} WHERE candidate_id=?`, [candidateId]);
    return rows[0] ?? null;
  }

  async submitSource(operationId, input) {
    if (typeof operationId !== 'string' || !operationId.trim()) throw validation('operationId 无效。');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw validation('input 无效。');
    const text = typeof input.text === 'string' ? input.text : '';
    if (!text.trim()) throw validation('原文不能为空。');
    if ([...text].length > 200000) throw validation('原文过长。');
    // Frozen §5.1: `timeZone` is optional input. An omitted zone resolves to
    // the production default (application setting, OS fallback); an explicitly
    // provided zone must be a valid IANA zone and is rejected otherwise. The
    // resolved zone is the source's time anchor for date resolution, and the
    // fingerprint dedup below keeps the FIRST recorded anchor and zone.
    let timeZone;
    if (input.timeZone === undefined || input.timeZone === null) {
      timeZone = await this.defaultTimeZone();
    } else {
      timeZone = input.timeZone;
    }
    if (typeof timeZone !== 'string' || !timeZone) throw validation('timeZone 无效。');
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      throw validation('timeZone 无效。');
    }
    // C4: `sourceAt` is the date point on the same line as a manual item's
    // due/followup point — `{at,timeZone,localText,precision}` (frozen web-api/1
    // §1 time format). An omitted point defaults to the first import time. The
    // integer millisecond bridge (`source_at_ms`/`anchor_at_ms` columns, the
    // runtime `anchorAtMs` int) stays private: the point is the only public
    // shape, and `localText`/`precision` — which the three columns cannot
    // carry — travel in the first task's immutable `input_ref` below.
    let sourceAt = null;
    if (input.sourceAt !== undefined && input.sourceAt !== null) {
      sourceAt = normalizePoint(input.sourceAt, 'sourceAt');
      // An explicit anchor zone that contradicts the explicit top-level zone
      // leaves date resolution undefined: which zone governs is a real
      // contradiction, not a defaultable omission — reject instead of guessing.
      if (typeof input.timeZone === 'string' && input.timeZone !== sourceAt.timeZone) {
        throw validation('sourceAt 时区与 timeZone 不一致。');
      }
      // With no explicit top-level zone the anchor's own zone governs.
      timeZone = sourceAt.timeZone;
    }
    const sourceAtMs = sourceAt === null ? null : Date.parse(sourceAt.at);
    // The source columns carry a `source_at_ms > 0` CHECK: an instant at or
    // before the epoch is a validation failure, not a storage error.
    if (sourceAtMs !== null && (!Number.isInteger(sourceAtMs) || sourceAtMs <= 0)) {
      throw validation('sourceAt 无效。');
    }
    const fingerprint = createHash('sha256').update(text, 'utf8').digest('hex');
    const existing = await this.findSourceByFingerprint(fingerprint);
    if (existing) {
      const task = existing.succeededRunId ? await this.taskService.get(existing.succeededRunId) : null;
      return { reused: true, source: await this.sourceWire(existing, task?.inputRef?.source?.sourceAt ?? null), task };
    }
    // A missing/disabled model must not block submission: the task is queued and
    // fails at run time with `credential_unavailable`/`model_not_configured`,
    // preserving the source for a retry (frozen §4.6, T-3).
    const snapshot = await this.snapshotFor();
    const now = this.now();
    const source = {
      sourceId: `src_${randomBytes(16).toString('hex')}`,
      fingerprint,
      kind: 'text',
      rawText: text,
      sourceAtMs,
      importedAtMs: now,
      anchorAtMs: sourceAtMs ?? now,
      timeZone,
      succeededRunId: null,
    };
    // The first task's immutable input carries the COMPLETE first canonical
    // input: the anchor instant (the private ms bridge the runtime request
    // uses, so a queued, restarted or retried attempt keeps the FIRST anchor
    // instead of drifting to the worker start time) plus the full date point
    // (the only place localText/precision survive). The source row, the task
    // row and their link commit in ONE transaction — a source can never exist
    // without its first input, and a failed submit leaves neither behind.
    // An omitted point records the first import instant with no original
    // expression (`localText: null`) — never a fabricated one.
    const sourceAtPoint = sourceAt === null
      ? { at: new Date(source.anchorAtMs).toISOString(), timeZone, localText: null, precision: 'minute' }
      : { at: sourceAt.at, timeZone: sourceAt.timeZone, localText: sourceAt.localText, precision: sourceAt.precision };
    const submitted = await this.taskService.submit({
      operationId,
      type: 'extract',
      role: 'organizer',
      input: {
        configRevision: snapshot?.revision ?? '',
        snapshot,
        sourceId: source.sourceId,
        anchorAtMs: source.anchorAtMs,
        // The worker host reads only `source.text`/`source.timeZone` from this
        // object; the point travels with the source's first input and is the
        // read-back's only complete carrier of localText/precision.
        source: { text, timeZone, sourceAt: sourceAtPoint },
      },
      companionOps: (taskId) => [{
        sql: `INSERT INTO text_sources (source_id,fingerprint,kind,raw_text,source_at_ms,imported_at_ms,anchor_at_ms,time_zone,succeeded_run_id)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        params: [source.sourceId, source.fingerprint, source.kind, source.rawText, source.sourceAtMs, source.importedAtMs, source.anchorAtMs, source.timeZone, taskId],
      }],
    });
    if (submitted.replayed) {
      // A concurrent identical submit won the insert: its companion transaction
      // committed the first source, so bind to that first source/task pair
      // instead of answering with a source row that was never written.
      const winner = await this.findSourceByFingerprint(fingerprint);
      if (winner) {
        const task = winner.succeededRunId ? await this.taskService.get(winner.succeededRunId) : null;
        return { reused: true, source: await this.sourceWire(winner, task?.inputRef?.source?.sourceAt ?? null), task };
      }
      throw new ServiceError('idempotency_conflict', '同一 operationId 已用于不同请求。');
    }
    source.succeededRunId = submitted.task.taskId;
    return { reused: false, source: await this.sourceWire(source, submitted.task?.inputRef?.source?.sourceAt ?? null), task: submitted.task };
  }

  async listSources({ cursor, limit } = {}) {
    const watermark = decodeCursor(cursor);
    const clauses = [];
    const params = [];
    if (watermark) {
      clauses.push('(imported_at_ms < ? OR (imported_at_ms = ? AND source_id > ?))');
      params.push(watermark.importedAtMs, watermark.importedAtMs, watermark.sourceId);
    }
    const pageSize = parseLimit(limit);
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = await this.query(
      `${SELECT_SOURCE}${where} ORDER BY imported_at_ms DESC, source_id ASC LIMIT ?`,
      [...params, pageSize + 1],
    );
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    // The points are read back from the first tasks' immutable input_refs in
    // one batched read; a source with no first task has no entry and falls
    // back to its columns inside sourceWire.
    const points = await this.firstTaskPoints(page.map((row) => row[8]));
    const sources = [];
    for (const row of page) {
      const source = this.rowToSource(row);
      sources.push(await this.sourceWire(source, points.get(source.succeededRunId) ?? null));
    }
    const nextCursor = hasMore && page.length
      ? encodeCursor([this.rowToSource(page[page.length - 1]).importedAtMs, this.rowToSource(page[page.length - 1]).sourceId])
      : null;
    return { sources, nextCursor };
  }

  async listCandidates(sourceId, { status, cursor, limit } = {}) {
    // Frozen §4.3: a `staged` row is written inside the result-staging
    // transaction and stays INVISIBLE until the worker exit is confirmed, so
    // every public read of this source's candidates excludes it — by default
    // and under an explicit filter alike.
    const clauses = ['source_id=?', `status!='staged'`];
    const params = [sourceId];
    if (status !== undefined && status !== null) {
      // The public filter vocabulary is the visible statuses only. Naming
      // `staged` asks for a state no public read may return, so the request
      // is rejected instead of being answered with a permanently empty page.
      if (!['pending', 'accepted', 'discarded'].includes(status)) throw validation('status 无效。');
      clauses.push('status=?');
      params.push(status);
    }
    if (cursor) {
      const numeric = Number(cursor);
      if (!Number.isInteger(numeric) || numeric < 1) throw validation('cursor 无效。');
      clauses.push('ordinal>?');
      params.push(numeric);
    }
    const pageSize = parseLimit(limit);
    const rows = await this.query(
      `${SELECT_CANDIDATE} WHERE ${clauses.join(' AND ')} ORDER BY ordinal ASC LIMIT ?`,
      [...params, pageSize + 1],
    );
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    return {
      candidates: page.map((row) => this.candidateWire(this.rowToCandidate(row))),
      nextCursor: hasMore && page.length ? String(this.rowToCandidate(page[page.length - 1]).ordinal) : null,
    };
  }

  /// The preview id the revise task's CURRENT published result carries, or
  /// null when the task has published no preview result at all. Publication
  /// means the staged success is committed — the terminal `succeeded` state
  /// with a confirmed exit (the normal close-out and the staged-resume
  /// recovery path both land here, which also clears the staged-window
  /// marker) — and the result reference resolves to a payload naming this
  /// preview.
  ///
  /// The payload binding is what keeps a row staged by an attempt the task
  /// has moved on from from riding a newer terminal state: only the preview
  /// the current result actually carries is ever published. Nothing is
  /// deleted to enforce the fence — the preview row and the staged payload
  /// bytes stay exactly as they were for the recovery path.
  async publishedPreviewId(task) {
    if (!task || task.state !== 'succeeded') return null;
    if (task.attemptExitState !== 'exited_confirmed') return null;
    if (Number(task.resultPendingExit) !== 0) return null;
    const reference = this.taskService.resolvePayloadRef(task.resultRef?.payloadRef ?? null);
    if (!reference) return null;
    const payload = await this.taskService.readResultPayload(reference.attemptId, reference.name);
    if (!payload) return null;
    let staged = null;
    try {
      staged = JSON.parse(payload.toString('utf8'));
    } catch {
      return null;
    }
    return typeof staged?.previewId === 'string' ? staged.previewId : null;
  }

  /// The release fence (frozen §4.3 applied to the preview surface): a preview
  /// row is public only when it is the preview its revise task has published.
  /// A row written by `stageReviseResult` exists from the moment the worker's
  /// result frame is persisted — the worker may still be running and the exit
  /// unconfirmed — so a task inside the staged window, or one whose exit was
  /// never confirmed, failed or was cancelled, publishes nothing.
  async previewReleased(previewId, task) {
    return (await this.publishedPreviewId(task)) === previewId;
  }

  async getSource(sourceId) {
    const row = await this.getSourceRow(sourceId);
    if (!row) throw new ServiceError('source_not_found', '来源不存在。');
    const source = this.rowToSource(row);
    const run = source.succeededRunId ? await this.taskService.get(source.succeededRunId) : null;
    const { candidates } = await this.listCandidates(sourceId, { status: 'pending', limit: 200 });
    // The release fence joins each preview to the revise task that staged it:
    // a preview inside the staged window (worker alive, exit unconfirmed) or
    // whose task failed or was cancelled is not listed at all, and a row a
    // superseded attempt left behind never rides a newer terminal state.
    const previewsRows = await this.query(
      `SELECT p.preview_id,p.candidate_id,p.run_id,p.candidate_version,p.draft_json,p.created_at_ms,
        t.state,t.attempt_exit_state,t.result_pending_exit,t.result_ref
       FROM candidate_previews p JOIN tasks t ON t.task_id=p.run_id
       WHERE p.candidate_id IN (SELECT candidate_id FROM candidates WHERE source_id=? AND status!='staged')
       ORDER BY p.created_at_ms DESC`,
      [sourceId],
    );
    const previews = [];
    for (const previewRow of previewsRows) {
      let resultRef = null;
      try {
        resultRef = previewRow[9] ? JSON.parse(previewRow[9]) : null;
      } catch {
        resultRef = null;
      }
      const released = await this.previewReleased(previewRow[0], {
        state: previewRow[6],
        attemptExitState: previewRow[7],
        resultPendingExit: previewRow[8],
        resultRef,
      });
      if (!released) continue;
      const draft = draftAttributes(JSON.parse(previewRow[4]));
      previews.push({
        previewId: previewRow[0],
        candidateId: previewRow[1],
        runId: previewRow[2],
        candidateVersion: previewRow[3],
        draft: {
          fields: fieldsToWire(draft.fields),
          evidence: draft.evidence,
          dueExpression: draft.dueExpression,
          followupExpression: draft.followupExpression,
          warnings: draft.warnings,
          unresolved: draft.unresolved,
        },
        createdAt: new Date(previewRow[5]).toISOString(),
      });
    }
    return { source: await this.sourceWire(source, run?.inputRef?.source?.sourceAt ?? null), run, candidates, previews };
  }

  async getCandidate(candidateId) {
    const row = await this.getCandidateRow(candidateId);
    // A staged row is invisible until the exit is confirmed (frozen §4.3):
    // the single-candidate read answers `candidate_not_found` instead of
    // revealing that a staged row exists.
    if (!row || row[4] === 'staged') throw notFound();
    return this.candidateWire(this.rowToCandidate(row));
  }

  /// The candidate-operation ledger (owner authorization D, frozen §5.1 replay
  /// semantics): `operation_id` is the idempotency arbiter. The lookup runs
  /// BEFORE the target existence check and any state/version guard, so an
  /// identical retry replays the candidate's CURRENT authoritative state — no
  /// second change, no event, no version consumed — while any changed
  /// behavior-affecting byte under the same key is the registered 409
  /// `idempotency_conflict` (even when the other target is gone). Only a
  /// successful transaction writes a row, so a rejected guard or validation
  /// never consumes a key.
  async candidateOperationRow(operationId) {
    const rows = await this.query(
      'SELECT request_json FROM candidate_operations WHERE operation_id=?',
      [operationId],
    );
    return rows[0] ?? null;
  }

  /// Run one direct-edit family under the ledger's authority. An unused key
  /// executes `execute` (guards + mutation + ledger INSERT in one transaction);
  /// ANY failure re-adjudicates, because a concurrent identical request may
  /// have committed between our first adjudication and our own attempt. A
  /// committed identical request is answered as its replay, a different one as
  /// the registered 409, and with no committed row the original failure stands.
  async runCandidateOperation(operationId, canonical, candidateId, execute) {
    const used = await this.adjudicateCandidateOperation(operationId, canonical, candidateId);
    if (used) return used;
    try {
      return await execute();
    } catch (error) {
      const row = await this.candidateOperationRow(operationId);
      if (!row) throw error;
      if (row[0] === canonical) return this.getCandidate(candidateId);
      throw new ServiceError('idempotency_conflict', '同一 operationId 已用于不同请求。');
    }
  }

  /// The ledger adjudication every direct-edit family shares, and the FIRST
  /// thing each entry point does after building its canonical bytes: a stored
  /// row with identical bytes replays the candidate's current state; a
  /// different body under the same key is the registered 409. It runs BEFORE
  /// the target existence check and every business guard, so a used key
  /// conflicts even when the other target no longer exists, while an unused key
  /// keeps the natural 404 for a missing candidate.
  async adjudicateCandidateOperation(operationId, canonical, candidateId) {
    const row = await this.candidateOperationRow(operationId);
    if (!row) return null;
    if (row[0] !== canonical) {
      throw new ServiceError('idempotency_conflict', '同一 operationId 已用于不同请求。');
    }
    return this.getCandidate(candidateId);
  }

  async editCandidate(candidateId, operationId, expectedVersion, input, timeReviewed) {
    if (typeof operationId !== 'string' || !operationId.trim()) throw validation('operationId 无效。');
    const normalized = normalizeInput(input);
    const canonical = canonicalize({ action: 'edit', candidateId, expectedVersion, input: normalized, timeReviewed: Boolean(timeReviewed) });
    return this.runCandidateOperation(operationId, canonical, candidateId, async () => {
      const row = await this.getCandidateRow(candidateId);
      if (!row) throw notFound();
      const candidate = this.rowToCandidate(row);
      if (candidate.status !== 'pending') throw stateConflict('仅待核对候选可编辑。');
      if (candidate.version !== expectedVersion) {
        throw new ServiceError('version_conflict', '候选已有更新，请刷新后重试。');
      }
      if (candidate.unresolved && !timeReviewed) throw timeReviewRequired();
      const now = this.now();
      await this.transact([
        {
          sql: `UPDATE candidates SET fields_json=?,version=version+1 WHERE candidate_id=? AND version=? AND status='pending'`,
          expectChanges: 1,
          params: [JSON.stringify(normalized), candidateId, expectedVersion],
        },
        {
          sql: `INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES (?,?,?,?,?)`,
          params: [operationId, candidateId, 'edit', canonical, now],
        },
      ]);
      this.emitChanged(candidate.sourceId);
      return this.getCandidate(candidateId);
    });
  }

  async discardCandidate(candidateId, operationId, expectedVersion) {
    if (typeof operationId !== 'string' || !operationId.trim()) throw validation('operationId 无效。');
    const canonical = canonicalize({ action: 'discard', candidateId, expectedVersion });
    return this.runCandidateOperation(operationId, canonical, candidateId, async () => {
      const row = await this.getCandidateRow(candidateId);
      if (!row) throw notFound();
      const candidate = this.rowToCandidate(row);
      if (candidate.status !== 'pending') throw stateConflict('仅待核对候选可丢弃。');
      if (candidate.version !== expectedVersion) {
        throw new ServiceError('version_conflict', '候选已有更新，请刷新后重试。');
      }
      const now = this.now();
      await this.transact([
        {
          sql: `UPDATE candidates SET status='discarded',processed_at_ms=?,version=version+1 WHERE candidate_id=? AND version=? AND status='pending'`,
          expectChanges: 1,
          params: [now, candidateId, expectedVersion],
        },
        {
          sql: `INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES (?,?,?,?,?)`,
          params: [operationId, candidateId, 'discard', canonical, now],
        },
      ]);
      this.emitChanged(candidate.sourceId);
      return this.getCandidate(candidateId);
    });
  }

  async requestRevision(candidateId, operationId, instruction) {
    if (typeof operationId !== 'string' || !operationId.trim()) throw validation('operationId 无效。');
    const text = typeof instruction === 'string' ? instruction.trim() : '';
    if (!text) throw validation('修改要求不能为空。');
    const row = await this.getCandidateRow(candidateId);
    if (!row) throw notFound();
    const candidate = this.rowToCandidate(row);
    if (candidate.status !== 'pending') throw stateConflict('仅待核对候选可修改。');
    const snapshot = await this.snapshotFor();
    // The revise instruction resolves its date expressions against the FIRST
    // anchor of the source the candidate came from — the same instant the
    // original extraction resolved against. The anchor travels in the task
    // input, so a queued, restarted or retried attempt keeps the first anchor
    // instead of drifting to the worker start time
    // (`input.anchorAtMs ?? this.now()` in the worker host). The candidate's
    // zone travels under `source` — the shape the worker host reads for the
    // zone on every kind.
    const sourceRow = await this.getSourceRow(candidate.sourceId);
    const submitted = await this.taskService.submit({
      operationId,
      type: 'revise',
      role: 'organizer',
      input: {
        configRevision: snapshot?.revision ?? '',
        snapshot,
        candidateId,
        candidateVersion: candidate.version,
        // The runtime's revise branch reads `request.candidate.draft` as the
        // base to patch (the worker host wraps this value), so the full draft
        // must travel with the task — the same object the frozen §5.1
        // candidate attributes describe.
        candidate: {
          fields: candidate.fields,
          evidence: candidate.evidence,
          dueExpression: candidate.dueExpression,
          followupExpression: candidate.followupExpression,
          warnings: candidate.warnings,
          unresolved: candidate.unresolved,
        },
        instruction: text,
        anchorAtMs: sourceRow ? sourceRow[6] : null,
        source: { timeZone: candidate.fields.due?.timeZone ?? candidate.fields.followup?.timeZone ?? 'UTC' },
      },
    });
    return submitted.task;
  }

  async applyPreview(candidateId, runId, operationId, expectedVersion) {
    if (typeof operationId !== 'string' || !operationId.trim()) throw validation('operationId 无效。');
    const canonical = canonicalize({ action: 'apply_preview', candidateId, runId, expectedVersion });
    return this.runCandidateOperation(operationId, canonical, candidateId, async () => {
      const row = await this.getCandidateRow(candidateId);
      if (!row) throw notFound();
      const candidate = this.rowToCandidate(row);
      if (candidate.status !== 'pending') throw stateConflict('仅待核对候选可应用预览。');
      if (candidate.version !== expectedVersion) {
        throw new ServiceError('version_conflict', '候选已有更新，请刷新后重试。');
      }
      // The release fence: the applied row is the one the revise task has
      // PUBLISHED — terminal success with a confirmed exit, carrying this row in
      // the task's current result. A pending candidate version or a known runId
      // alone is never enough: an unconfirmed, failed or cancelled exit, and a
      // row a superseded attempt left behind, are refused with the registered
      // conflict code while the candidate keeps its version and content. The
      // staged bytes are preserved for the recovery path.
      const anyPreview = await this.query(
        `SELECT preview_id FROM candidate_previews WHERE candidate_id=? AND run_id=? LIMIT 1`,
        [candidateId, runId],
      );
      if (!anyPreview[0]) throw new ServiceError('candidate_not_found', '预览不存在。');
      const taskRow = await this.taskService.getTaskRow(runId);
      const releasedId = taskRow
        ? await this.publishedPreviewId(this.taskService.rowToInternal(taskRow))
        : null;
      const previewRows = releasedId === null ? [] : await this.query(
        `SELECT draft_json,candidate_version FROM candidate_previews WHERE candidate_id=? AND run_id=? AND preview_id=?`,
        [candidateId, runId, releasedId],
      );
      if (!previewRows[0]) throw stateConflict('预览尚未发布，请等待整理完成。');
      if (previewRows[0][1] !== candidate.version) {
        throw new ServiceError('state_conflict', '预览基于的候选版本已变化，请重新生成预览。');
      }
      const draft = JSON.parse(previewRows[0][0]);
      // The runtime's preview draft nests the editable fields under `fields`;
      // accept that shape as well as a bare fields object.
      const normalized = normalizeDraftFields(draft.fields ?? draft);
      // The applied preview's other attributes travel with the fields: after an
      // explicit apply the candidate's evidence, date expressions, warnings and
      // unresolved flag are the ones the preview carried (a bare-fields draft
      // leaves them untouched). Preview generation itself never writes here.
      const attributes = appliedAttributes(draft, candidate);
      const now = this.now();
      await this.transact([
        {
          // The fence as a transaction guard: the pre-commit assertion aborts the
          // whole apply if the owning task's published success (or the result it
          // carries) changed between the read above and the COMMIT, so no
          // check-then-apply interleaving can slip an unreleased preview through.
          sql: `UPDATE tasks SET version=version WHERE task_id=? AND state='succeeded' AND attempt_exit_state='exited_confirmed' AND result_pending_exit=0 AND result_ref=?`,
          expectChanges: 1,
          params: [runId, taskRow[16]],
        }, {
          sql: `UPDATE candidates SET fields_json=?,evidence=?,due_expression=?,followup_expression=?,warnings_json=?,unresolved=?,version=version+1 WHERE candidate_id=? AND version=? AND status='pending'`,
          expectChanges: 1,
          params: [
            JSON.stringify(normalized), attributes.evidence, attributes.dueExpression,
            attributes.followupExpression, JSON.stringify(attributes.warnings),
            attributes.unresolved ? 1 : 0, candidateId, expectedVersion,
          ],
        }, {
          sql: `INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES (?,?,?,?,?)`,
          params: [operationId, candidateId, 'apply_preview', canonical, now],
        },
      ]);
      this.emitChanged(candidate.sourceId);
      return this.getCandidate(candidateId);
    });
  }

  async signOff(operationId, choices) {
    if (typeof operationId !== 'string' || !operationId.trim()) throw validation('operationId 无效。');
    // Frozen §5.1: a sign-off batch is any NON-EMPTY `choices` array — single
    // and multi select share the same transaction, ledger and derived-key
    // family. The contract's only 400 on this endpoint is an unreviewed time
    // (`time_review_required`); there is no minimum-batch rule.
    if (!Array.isArray(choices) || choices.length < 1) throw validation('签收批次至少需要一条候选。');
    const canonical = canonicalize({ action: 'sign_off', choices });
    const batchRows = await this.query('SELECT operation_id,status,request_json,result_json FROM sign_off_batches WHERE operation_id=?', [operationId]);
    if (batchRows[0]) {
      if (batchRows[0][2] === canonical) {
        const mapping = JSON.parse(batchRows[0][3]);
        const items = [];
        for (const choice of choices) {
          const itemId = mapping[choice.candidateId];
          const rows = await this.query(
            `SELECT item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source FROM manual_items WHERE item_id=?`,
            [itemId],
          );
          if (rows[0]) items.push(this.itemWire(rows[0]));
        }
        return { replayed: true, items };
      }
      throw new ServiceError('idempotency_conflict', '同一 operationId 已用于不同请求。');
    }

    const now = this.now();
    const ops = [];
    const mapping = {};
    const createdItems = [];
    for (const choice of choices) {
      const row = await this.getCandidateRow(choice.candidateId);
      if (!row) throw notFound();
      const candidate = this.rowToCandidate(row);
      if (candidate.status !== 'pending') throw stateConflict('仅待核对候选可签收。');
      if (candidate.version !== choice.expectedVersion) {
        throw new ServiceError('version_conflict', '候选已有更新，请刷新后重试。');
      }
      const fields = normalizeDraftFields(choice.fields);
      if (candidate.unresolved && !choice.timeReviewed) throw timeReviewRequired();
      const derivedKey = deriveSignOffKey(operationId, choice.candidateId);
      if (choice.target) {
        const targetRows = await this.query(
          `SELECT item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source FROM manual_items WHERE item_id=?`,
          [choice.target.id],
        );
        if (!targetRows[0]) throw new ServiceError('item_not_found', '关联事项不存在。');
        const target = targetRows[0];
        if (target[19] !== choice.target.expectedVersion) {
          throw new ServiceError('version_conflict', '关联事项已有更新，请刷新后重试。');
        }
        const targetWire = this.itemWire(target);
        // A link never overwrites the target's fields; it only records the
        // association and advances the target's version (frozen §5.1).
        ops.push({
          sql: `UPDATE manual_items SET version=version+1,updated_at_ms=? WHERE item_id=? AND version=?`,
          expectChanges: 1,
          params: [now, choice.target.id, choice.target.expectedVersion],
        });
        ops.push({
          sql: `INSERT INTO manual_item_events (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES (?,?,'link',?,?,?,?)`,
          params: [derivedKey, choice.target.id, now, canonical, JSON.stringify(targetWire), JSON.stringify({ ...targetWire, version: target[19] + 1 })],
        });
        ops.push({
          sql: `INSERT INTO manual_item_sources (item_id,source_id,candidate_id,evidence,association,operation_id,created_at_ms) VALUES (?,?,?,?,?,?,?)`,
          params: [choice.target.id, candidate.sourceId, candidate.candidateId, candidate.evidence, 'manual_link', derivedKey, now],
        });
        ops.push({
          sql: `UPDATE candidates SET status='accepted',accepted_item_id=?,processed_at_ms=?,version=version+1 WHERE candidate_id=? AND version=? AND status='pending'`,
          expectChanges: 1,
          params: [choice.target.id, now, candidate.candidateId, choice.expectedVersion],
        });
        mapping[candidate.candidateId] = choice.target.id;
        createdItems.push({ ...targetWire, version: target[19] + 1 });
      } else {
        const itemId = `mi_${randomBytes(16).toString('hex')}`;
        const item = {
          itemId,
          ...fields,
          status: 'open',
          createdAtMs: now,
          updatedAtMs: now,
          completedAtMs: null,
          deletedAtMs: null,
          version: 1,
          source: 'signed_ai',
        };
        ops.push({
          sql: `INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source)
            VALUES (?,?,?,?,?,'open',?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,1,'signed_ai')`,
          params: [
            item.itemId, item.title, item.kind, item.owner, item.priority,
            ...pointParameters(item.due), ...pointParameters(item.followup),
            JSON.stringify(item.tags), item.createdAtMs, item.updatedAtMs,
          ],
        });
        const wire = this.itemWireFromInternal(item);
        ops.push({
          sql: `INSERT INTO manual_item_events (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES (?,?,'create',?,?,NULL,?)`,
          params: [derivedKey, itemId, now, canonical, JSON.stringify(wire)],
        });
        ops.push({
          sql: `INSERT INTO manual_item_sources (item_id,source_id,candidate_id,evidence,association,operation_id,created_at_ms) VALUES (?,?,?,?,?,?,?)`,
          params: [itemId, candidate.sourceId, candidate.candidateId, candidate.evidence, 'new', derivedKey, now],
        });
        ops.push({
          sql: `UPDATE candidates SET status='accepted',accepted_item_id=?,processed_at_ms=?,version=version+1 WHERE candidate_id=? AND version=? AND status='pending'`,
          expectChanges: 1,
          params: [itemId, now, candidate.candidateId, choice.expectedVersion],
        });
        mapping[candidate.candidateId] = itemId;
        createdItems.push(wire);
      }
    }
    ops.push({
      sql: `INSERT INTO sign_off_batches (operation_id,status,request_json,result_json,created_at_ms,completed_at_ms) VALUES (?,'succeeded',?,?,?,?)`,
      params: [operationId, canonical, JSON.stringify(mapping), now, now],
    });
    // Every conditional write carries a pre-commit `expectChanges: 1`
    // assertion, so a losing CAS aborts the whole transaction before COMMIT
    // (the adapter rolls back) instead of throwing after the fact.
    try {
      await this.transact(ops);
    } catch (error) {
      // A concurrent identical batch may have committed the ledger row first:
      // merge onto it instead of surfacing a raw uniqueness error.
      if (error.code === 'WEB_BACKEND_SQL_ERROR') {
        const raced = await this.query('SELECT operation_id,status,request_json,result_json FROM sign_off_batches WHERE operation_id=?', [operationId]);
        if (raced[0]) {
          if (raced[0][2] === canonical) {
            const mapping = JSON.parse(raced[0][3]);
            const items = [];
            for (const choice of choices) {
              const rows = await this.query(
                `SELECT item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source FROM manual_items WHERE item_id=?`,
                [mapping[choice.candidateId]],
              );
              if (rows[0]) items.push(this.itemWire(rows[0]));
            }
            return { replayed: true, items };
          }
          throw new ServiceError('idempotency_conflict', '同一 operationId 已用于不同请求。');
        }
        // No batch row of our own: a UNIQUE conflict on the reviewed
        // operation-key family is a cross-family collision — the key is
        // occupied by another family's row and the batch is fully rolled
        // back, so the answer is a state conflict. Every other SQL error is
        // rethrown unchanged; a collision is never generalized into a
        // swallow-all.
        if (isOperationKeyConflict(error)) {
          throw new ServiceError('state_conflict', '操作键已被其他记录占用，请更换 operationId 后重试。');
        }
      }
      throw error;
    }
    this.emitChanged(null);
    return { replayed: false, items: createdItems };
  }

  itemWireFromInternal(item) {
    return {
      contractVersion: CONTRACT_VERSION,
      itemId: item.itemId,
      title: item.title,
      kind: item.kind,
      owner: item.owner,
      priority: item.priority,
      status: item.status,
      due: item.due ? { at: new Date(item.due.atMs).toISOString(), timeZone: item.due.timeZone, localText: item.due.localText, precision: item.due.precision ?? 'minute' } : null,
      followup: item.followup ? { at: new Date(item.followup.atMs).toISOString(), timeZone: item.followup.timeZone, localText: item.followup.localText, precision: item.followup.precision ?? 'minute' } : null,
      tags: item.tags,
      createdAt: new Date(item.createdAtMs).toISOString(),
      updatedAt: new Date(item.updatedAtMs).toISOString(),
      completedAt: null,
      deletedAt: null,
      version: item.version,
      source: item.source,
    };
  }

  itemWire(row) {
    const internal = {
      itemId: row[0],
      title: row[1],
      kind: row[2],
      owner: row[3],
      priority: row[4],
      status: row[5],
      due: row[6] === null ? null : { atMs: row[6], timeZone: row[7], localText: row[8], precision: row[9] },
      followup: row[10] === null ? null : { atMs: row[10], timeZone: row[11], localText: row[12], precision: row[13] },
      tags: JSON.parse(row[14]),
      createdAtMs: row[15],
      updatedAtMs: row[16],
      completedAtMs: row[17] === null ? null : row[17],
      deletedAtMs: row[18] === null ? null : row[18],
      version: row[19],
      source: row[20],
    };
    const wire = this.itemWireFromInternal(internal);
    wire.completedAt = internal.completedAtMs === null ? null : new Date(internal.completedAtMs).toISOString();
    wire.deletedAt = internal.deletedAtMs === null ? null : new Date(internal.deletedAtMs).toISOString();
    return wire;
  }

  // --- result staging / exit confirmation ----------------------------------

  async stageExtractResult(taskId, attemptId, candidates) {
    const row = await this.taskService.getTaskRow(taskId);
    if (!row) return false;
    const internal = this.taskService.rowToInternal(row);
    if (internal.attemptExitState !== 'active') return false;
    const currentAttempt = await this.taskService.currentAttemptId(taskId);
    if (currentAttempt !== attemptId) return false;
    const now = this.now();
    const payloadBytes = Buffer.from(JSON.stringify({ candidates }), 'utf8');
    const ops = [{
      sql: `UPDATE tasks SET result_pending_exit=1,pending_outcome='succeeded',result_ref=?,
        version=version+1,updated_at=? WHERE task_id=? AND attempt_exit_state='active'`,
      params: [JSON.stringify({ kind: 'candidates', payloadRef: `result://${attemptId}/result` }), now, taskId],
      // The pre-commit assertion keeps the whole staging transaction atomic:
      // when the read-time premise was lost (the attempt superseded between
      // the read and the COMMIT), the payload row and the task.changed event
      // roll back with the no-op UPDATE instead of leaving a phantom event.
      expectChanges: 1,
    }, {
      sql: `INSERT INTO task_result_payloads (attempt_id,name,payload_blob,total_bytes,created_at)
        VALUES (?,?,CAST(? AS BLOB),?,?)
        ON CONFLICT(attempt_id,name) DO UPDATE SET
          payload_blob=excluded.payload_blob,total_bytes=excluded.total_bytes,created_at=excluded.created_at`,
      params: [attemptId, 'result', payloadBytes.toString('utf8'), payloadBytes.length, now],
    },
    this.taskService.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'running', resultPendingExit: true }, objectVersion: internal.version + 1 })];
    for (const [index, candidate] of candidates.entries()) {
      const normalized = normalizeDraftFields(candidate.fields);
      const candidateId = `cand_${randomBytes(16).toString('hex')}`;
      ops.push({
        sql: `INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms)
          VALUES (?,?,?,?,'staged',1,?,?,?,?,?,?,NULL,NULL)`,
        params: [
          candidateId, internal.inputRef?.sourceId ?? '', taskId, index + 1,
          JSON.stringify(normalized), candidate.evidence, candidate.dueExpression ?? null,
          candidate.followupExpression ?? null, JSON.stringify(candidate.warnings ?? []),
          candidate.unresolved ? 1 : 0,
        ],
      });
    }
    // A lost premise answers the established `false` contract — the staging
    // transaction (payload + event included) rolled back, so no phantom
    // event or half-staged result survives.
    try {
      await this.transact(ops);
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'version_conflict') return false;
      throw error;
    }
    return true;
  }

  async stageReviseResult(taskId, attemptId, preview) {
    const row = await this.taskService.getTaskRow(taskId);
    if (!row) return false;
    const internal = this.taskService.rowToInternal(row);
    if (internal.attemptExitState !== 'active') return false;
    const currentAttempt = await this.taskService.currentAttemptId(taskId);
    if (currentAttempt !== attemptId) return false;
    const now = this.now();
    const previewId = `prev_${randomBytes(16).toString('hex')}`;
    const payloadBytes = Buffer.from(JSON.stringify({ previewId }), 'utf8');
    const ops = [{
      sql: `UPDATE tasks SET result_pending_exit=1,pending_outcome='succeeded',result_ref=?,
        version=version+1,updated_at=? WHERE task_id=? AND attempt_exit_state='active'`,
      params: [JSON.stringify({ kind: 'preview', payloadRef: `result://${attemptId}/result` }), now, taskId],
      // Same atomicity guard as the extract staging: a lost premise rolls the
      // payload row and the event back with the no-op UPDATE.
      expectChanges: 1,
    }, {
      sql: `INSERT INTO task_result_payloads (attempt_id,name,payload_blob,total_bytes,created_at)
        VALUES (?,?,CAST(? AS BLOB),?,?)
        ON CONFLICT(attempt_id,name) DO UPDATE SET
          payload_blob=excluded.payload_blob,total_bytes=excluded.total_bytes,created_at=excluded.created_at`,
      params: [attemptId, 'result', payloadBytes.toString('utf8'), payloadBytes.length, now],
    },
    this.taskService.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'running', resultPendingExit: true }, objectVersion: internal.version + 1 })];
    if (preview) {
      ops.push({
        sql: `INSERT INTO candidate_previews (preview_id,candidate_id,run_id,candidate_version,draft_json,created_at_ms) VALUES (?,?,?,?,?,?)`,
        params: [previewId, internal.inputRef?.candidateId, taskId, internal.inputRef?.candidateVersion ?? 1, JSON.stringify(preview), now],
      });
    }
    try {
      await this.transact(ops);
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'version_conflict') return false;
      throw error;
    }
    return true;
  }

  /// Exit confirmation for extract/revise attempts (the scheduler path).
  ///
  /// A normal exit may only drive a task that is still awaiting confirmation:
  /// a terminal task, a `needs_review` task or an `exited_unknown` attempt is
  /// never pushed to `succeeded` and its slot is not released here. A staged
  /// outcome waiting for recovery is committed by the dedicated
  /// `commitStagedResume` path instead (frozen §3.4/§6.1.1): finalizing an
  /// attempt and deciding a recovery are never mixed in one transition.
  ///
  /// `deadlineTriggered` carries the REAL close-out fact from the worker host
  /// (its independent backend deadline fired), so a no-staging finalization
  /// never guesses: the timeout face maps to the registered timeout envelope
  /// (`model_timeout` → `model_request_failed`/`auto_backoff`) and an
  /// unexpected worker death keeps `worker_lost`/`manual` (frozen §4.6). A
  /// staged outcome always wins — the deadline fact is only consulted when
  /// nothing was staged.
  ///
  /// `failurePayload` carries the other real close-out fact from the worker
  /// host: the code of the error frame the host actually received (a real
  /// model or tool error), the zero-frame death code (`runtime_exit`) or the
  /// spawn code (`runtime_start`). The code travels through the frozen §4.6
  /// registry — the single source of the `retryable` default — so the public
  /// envelope reports the real cause instead of guessing `worker_lost` for
  /// every unstaged extract/revise death. Precedence is deadline > frame code
  /// > zero-frame default, and a frame-carried safety claim is never read:
  /// only the code and message cross this boundary, and the safety face stays
  /// `unknown` unless a receipt proved otherwise.
  async confirmExtractExit(taskId, attemptId, { exited = true, cancel = false, epoch = null, deadlineTriggered = false, failurePayload = null, evidence = undefined } = {}) {
    const row = await this.taskService.getTaskRow(taskId);
    if (!row) return null;
    const internal = this.taskService.rowToInternal(row);
    const currentAttempt = await this.taskService.currentAttemptId(taskId);
    if (currentAttempt !== attemptId) return null;
    // Foreign attempt/epoch fencing.
    if (epoch !== null && epoch !== undefined && (await this.taskService.attemptEpoch(attemptId)) !== epoch) return null;
    if (['succeeded', 'failed', 'cancelled', 'needs_review'].includes(internal.state)) return internal.state;
    if (internal.attemptExitState === 'exited_unknown') return 'needs_review';
    const now = this.now();
    // Typed verdict discrimination: the registry-domain verdict decides when
    // supplied; a missing/non-registry_extinct evidence fails closed.
    // Frozen §3.1.1/§3.2.1 + A1: the FULL consumer gate decides — structure,
    // invariants, verdict AND the persisted attribution must all hold.
    let confirmed = exited === true;
    if (evidence !== undefined) confirmed = this.taskService.validateExitEvidenceFor(attemptId, evidence).ok;
    if (!confirmed) {
      // The exit could not be confirmed, so the attempt stays
      // `exited_unknown` and keeps its slot — a missing worker handle is
      // never promoted to `exited_confirmed` on the guess that nothing ran.
      // The task is isolated for review with a REGISTERED cause: frozen
      // §3.2/§3.5 make a `needs_review` task without a recovery cause a
      // non-contract state (its `recovery` object would be null and no
      // resolve entry could be versioned). The cause follows the staged
      // branch — a staged outcome is preserved and reported as
      // `result_exit_unconfirmed`, with nothing staged the exit fact stays
      // `exit_unconfirmed` — and the cause, the failure envelope and the
      // recovery item commit in ONE transaction (the task-recovery
      // precedent), so a parked task always carries its item version. The
      // item op is the shared dock op (frozen §12 one-row/monotonic — the
      // C-4 cross-episode fix): the task's disposed line is REUSED and
      // advanced on a re-entering episode, so a stale episode request can
      // never match the new authority version.
      const staged = internal.resultPendingExit === 1;
      const cause = staged ? 'result_exit_unconfirmed' : 'exit_unconfirmed';
      const failure = staged
        // A staged outcome (success or failure) is preserved as-is; the cause
        // rides along so the recovery object resolves. A staged success keeps
        // its invisible-to-the-wire state: `visibleFailure` only publishes a
        // failure for a staged FAILED outcome after the exit is confirmed.
        ? { ...(internal.failure ?? {}), cause }
        // With nothing staged the envelope carries the REAL close-out fact
        // the worker host observed (the spawn code, a received error frame
        // code or the zero-frame death), through the frozen §4.6 registry.
        : { ...normalizeFailure(failurePayload ?? { code: 'worker_lost', message: '整理进程退出未能确认。' }), cause };
      await this.transact([{
        sql: `UPDATE tasks SET attempt_exit_state='exited_unknown',state='needs_review',failure=?,
          version=version+1,updated_at=? WHERE task_id=? AND state IN ('running','cancelling')`,
        params: [JSON.stringify(failure), now, taskId],
        expectChanges: 1,
      },
      this.taskService.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'needs_review', attemptExitState: 'exited_unknown' }, objectVersion: internal.version + 1 }),
      await this.taskService.recoveryItemDockOp(taskId)]);
      return 'needs_review';
    }
    if (internal.resultPendingExit !== 1 && cancel) {
      await this.transact([
        {
          sql: `UPDATE tasks SET state='cancelled',attempt_exit_state='exited_confirmed',cancel_intent=0,
            terminal_at=?,version=version+1,updated_at=? WHERE task_id=? AND state IN ('running','cancelling')`,
          params: [now, now, taskId],
          expectChanges: 1,
        },
        this.taskService.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'cancelled' }, objectVersion: internal.version + 1 }),
      ]);
      return 'cancelled';
    }
    if (internal.resultPendingExit !== 1) {
      // R7-M-1: a confirmed exit with no staged outcome is a failure (worker
      // lost / backend deadline), never a silent `succeeded` with zero
      // results. The close-out carries the registry envelope for the REAL
      // exit fact — the frozen §4.6 registry is the single source of the
      // `retryable` default, and the public envelope never carries an
      // internal diagnostic field. The backend deadline wins over a frame
      // code; a received error frame's code maps through the registry
      // aliases; a zero-frame death keeps `worker_lost`/`manual`.
      const failure = normalizeFailure(deadlineTriggered
        ? { code: 'model_timeout', message: '整理超出后端时限。' }
        : failurePayload ?? { code: 'worker_lost', message: '整理进程未返回结果。' });
      await this.transact([
        {
          sql: `UPDATE tasks SET state='failed',attempt_exit_state='exited_confirmed',cancel_intent=0,failure=?,
            terminal_at=?,version=version+1,updated_at=? WHERE task_id=? AND state IN ('running','cancelling')`,
          params: [JSON.stringify(failure), now, now, taskId],
          expectChanges: 1,
        },
        this.taskService.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'failed' }, objectVersion: internal.version + 1 }),
        {
          sql: `UPDATE task_attempts SET ended_at=?, exit_confirmed_at=?, exit_reason='confirmed'
            WHERE attempt_id=? AND ended_at IS NULL`,
          params: [now, now, attemptId],
        },
      ]);
      return 'failed';
    }
    // The staged outcome is committed from a `needs_review` task only by the
    // dedicated `commitStagedResume` path, so this guard is unconditional.
    //
    // D1 (R5-M-1): the success terminal transition carries its own
    // `task.changed` event in the SAME transaction, so the cursor advances
    // with the commit and a client holding a mid-staged-window reconnect
    // token replays the terminal frame instead of being reset. The terminal
    // commit also clears the staged-window markers (`result_pending_exit`,
    // `pending_outcome`) while `result_ref` — and therefore the persisted
    // result bytes — is kept (frozen §3.1: `resultPendingExit` is only true
    // while the exit is unconfirmed).
    const ops = [
      {
        sql: `UPDATE tasks SET state='succeeded',attempt_exit_state='exited_confirmed',cancel_intent=0,
          result_pending_exit=0,pending_outcome=NULL,
          terminal_at=?,version=version+1,updated_at=? WHERE task_id=? AND state IN ('running','cancelling')`,
        params: [now, now, taskId],
        expectChanges: 1,
      },
      this.taskService.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: 'succeeded', attemptExitState: 'exited_confirmed' }, objectVersion: internal.version + 1 }),
      {
        sql: `UPDATE task_attempts SET ended_at=?, exit_confirmed_at=?, exit_reason='confirmed'
          WHERE attempt_id=? AND ended_at IS NULL`,
        params: [now, now, attemptId],
      },
    ];
    if (internal.pendingOutcome === 'succeeded') {
      ops.push({
        sql: `UPDATE candidates SET status='pending' WHERE run_id=? AND status='staged'`,
        params: [taskId],
      });
    } else {
      ops.push({
        sql: `DELETE FROM candidates WHERE run_id=? AND status='staged'`,
        params: [taskId],
      });
    }
    await this.transact(ops);
    this.emitChanged(null);
    return 'succeeded';
  }

  /// R8-M-1: the dedicated staged-resume path (frozen §3.4/§6.1.1).
  ///
  /// Resuming a `needs_review` task that carries a staged outcome commits the
  /// ORIGINAL staged outcome and publishes the staged candidates, instead of
  /// discarding them by re-queueing. The path is gated on the frozen
  /// preconditions — the task isolated for review, a verified exit, the
  /// authority recovery item version, the verifiable-receipt acknowledgment
  /// (§4.5: the SAME gate as the plain resolve entry) and the current attempt
  /// attribution — so a live worker inside the staged window, a cancelling
  /// task, an unverified exit, a stale item version or an unacknowledged
  /// receipt can never be force-published; each is refused with the contract
  /// code.
  ///
  /// The CAS is the AUTHORITY recovery item's version (§12) — the same row and
  /// gate as `TaskService.resolve` — never the client-mirrored
  /// `inputRef.recovery`, which no business flow writes and which a forged
  /// submit value can neither pass nor override. A missing item is a visible
  /// refusal; a disposed item keeps answering `state_conflict`. The item
  /// disposition (version +1, `resumed`/decision audit) joins the SAME
  /// transaction as the task terminal commit, the candidate publication and
  /// the attempt finalization, so a lost premise rolls back whole — a refused
  /// resume publishes nothing and writes nothing.
  ///
  /// The attempt row may still be open (this commit finalizes it) or already
  /// closed by recovery: the commit never depends on the attempt row, only on
  /// the recovery item version and the task state CAS, so a closed attempt
  /// cannot discard the staged outcome.
  async commitStagedResume(taskId, attemptId, expectedVersion, acknowledgedReceipts = []) {
    const row = await this.taskService.getTaskRow(taskId);
    if (!row) throw new ServiceError('task_not_found', '任务不存在。');
    const internal = this.taskService.rowToInternal(row);
    if (internal.state !== 'needs_review') throw stateConflict('仅待核对任务可处置。');
    if (internal.attemptExitState === 'exited_unknown') {
      throw new ServiceError('exit_unconfirmed', '进程退出尚未确认，请等待恢复扫描。');
    }
    // Frozen §3.5/§12: the recovery item version CAS binds the authority row.
    const item = await this.taskService.currentRecoveryItem(taskId);
    if (!item) throw stateConflict('恢复条目缺失，无法处置。');
    // An AMBIGUOUS authority (two or more pending rows) is refused, never
    // disposed by picking the newest row (the caff8b2 CC2 finding) — the same
    // gate as the plain resolve entry.
    if (item.ambiguous) throw stateConflict('恢复条目存在多条待核对记录，请先消解歧义。');
    if (item.verificationState !== 'pending') throw stateConflict('核对条目已处置，请刷新后重试。');
    if (item.version !== expectedVersion) {
      throw new ServiceError('version_conflict', '核对条目已有更新，请刷新后重试。');
    }
    // Frozen §4.5: resume requires the acknowledged receipts to cover every
    // `verifiable=true` entry of the attempt's authority receipt ledger, and
    // the ACK list carries the frozen wire shape shared with the plain entry:
    // an explicitly provided non-array or non-string-member list is a
    // `validation_failed` client error — never a substring confirmation, never
    // a TypeError 500.
    const acknowledged = acknowledgedReceiptsOrRefuse(acknowledgedReceipts);
    const receipts = await this.taskService.recoveryReceipts(taskId);
    const unacknowledged = receipts.find(
      (receipt) => receipt.verifiable && !acknowledged.includes(receipt.receiptId),
    );
    if (unacknowledged) throw validation('请先确认全部可核对回执。');
    // Attempt attribution: an attempt row still open must be the one this
    // resume was read against; a row recovery already closed is acceptable.
    const currentAttempt = await this.taskService.currentAttemptId(taskId);
    if (currentAttempt !== null && currentAttempt !== attemptId) {
      throw stateConflict('任务状态已变化，请刷新后重试。');
    }
    const now = this.now();
    const terminal = internal.pendingOutcome === 'succeeded' ? 'succeeded' : 'failed';
    const ops = [
      {
        sql: `UPDATE tasks SET state=?,attempt_exit_state='exited_confirmed',cancel_intent=0,
          result_pending_exit=0,pending_outcome=NULL,terminal_at=?,version=version+1,updated_at=?
          WHERE task_id=? AND state='needs_review' AND attempt_exit_state='exited_confirmed'`,
        params: [terminal, now, now, taskId],
        expectChanges: 1,
      },
      this.taskService.eventOp({ objectType: 'task', objectId: taskId, type: 'task.changed', payload: { state: terminal }, objectVersion: internal.version + 1 }),
    ];
    if (terminal === 'succeeded') {
      ops.push({
        sql: `UPDATE candidates SET status='pending' WHERE run_id=? AND status='staged'`,
        params: [taskId],
      });
    } else {
      ops.push({
        sql: `DELETE FROM candidates WHERE run_id=? AND status='staged'`,
        params: [taskId],
      });
    }
    // Finalize the attempt row when it is still open (R6-M-1/R8-M-2): the
    // exit fact was established before a resume may run, so the row is closed
    // here and never reopened; a row recovery already closed is a no-op.
    ops.push({
      sql: `UPDATE task_attempts SET ended_at=?, exit_confirmed_at=?, exit_reason='confirmed'
        WHERE task_id=? AND ended_at IS NULL`,
      params: [now, now, taskId],
    });
    // The item disposition commits with the publication it authorized (§3.5:
    // task and item versions advance together). The conditional UPDATE keeps
    // `pending` as a pre-commit assertion — a concurrent disposition aborts
    // the whole batch, leaving no published candidate and no terminal state.
    ops.push({
      sql: `UPDATE recovery_items SET version=version+1,verification_state='resumed',decision='resume',decided_by=?,decided_at=?
        WHERE item_id=? AND version=? AND verification_state='pending'`,
      params: [RESOLVE_DECIDED_BY, now, item.itemId, item.version],
      expectChanges: 1,
    });
    await this.transact(ops);
    this.emitChanged(null);
    return this.taskService.toWire(taskId);
  }

  async confirmReviseExit(taskId, attemptId, { exited = true, epoch = null, deadlineTriggered = false, failurePayload = null, evidence = undefined } = {}) {
    return this.confirmExtractExit(taskId, attemptId, { exited, epoch, deadlineTriggered, failurePayload, evidence });
  }
}

export { deriveSignOffKey };
