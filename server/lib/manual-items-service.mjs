//! Manual-item business transactions over the storage adapter.
//!
//! Every write is a single atomic transaction: the conditional item update
//! (version guard) and the history event insert commit together or not at all.
//! Idempotency replays return the current authoritative state before any state
//! or version guard runs (W1 contract §6, M1).
//!
//! Internally items use millisecond timestamps and `atMs` time points; the wire
//! shape required by `web-api/1` (ISO strings) is produced at the boundary.

import { randomBytes } from 'node:crypto';
import { zonedCandidates } from '../../shared/dates.mjs';

export const CONTRACT_VERSION = 'web-api/1';

/// Reviewed wire format for `TimePoint.at`: ISO 8601 UTC with millisecond
/// precision (contract §4.2). Anything else is rejected rather than parsed in
/// the server's local zone.
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/// The structured local expression `zonedCandidates` can resolve.
const STRUCTURED_LOCAL = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/;

const SELECT_ITEM = `SELECT item_id,title,kind,owner,priority,status,
  due_at_ms,due_timezone,due_local,due_precision,
  followup_at_ms,followup_timezone,followup_local,followup_precision,
  tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source
  FROM manual_items`;

const INSERT_ITEM = `INSERT INTO manual_items
  (item_id,title,kind,owner,priority,status,
   due_at_ms,due_timezone,due_local,due_precision,
   followup_at_ms,followup_timezone,followup_local,followup_precision,
   tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source)
  VALUES (?,?,?,?,?,'open',?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,1,'manual')`;

const INSERT_EVENT = `INSERT INTO manual_item_events
  (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json)
  VALUES (?,?,?,?,?,?,?)`;

/// History insert gated on the immediately preceding conditional UPDATE: when
/// the version guard matched zero rows the event row is not written at all, so
/// a losing writer leaves no history and does not consume its operationId
/// (MAJOR-1). `changes()` still reports the previous statement's row count
/// while this statement's WHERE clause is evaluated.
const INSERT_EVENT_GATED = `INSERT INTO manual_item_events
  (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json)
  SELECT ?,?,?,?,?,?,?
  WHERE (SELECT changes()) = 1`;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ALLOWED_STATUSES = ['open', 'completed', 'deleted', 'all'];

export class ServiceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.details = details;
  }
}

function validation(message) {
  return new ServiceError('validation_failed', message);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizePoint(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') throw validation(`${label}格式无效。`);
  const raw = value.at;
  if (typeof raw !== 'string' || !ISO_UTC_MS.test(raw)) {
    throw validation(`${label}时间必须是 ISO 8601 UTC 毫秒（YYYY-MM-DDTHH:mm:ss.sssZ）。`);
  }
  const atMs = Date.parse(raw);
  if (!Number.isFinite(atMs)) throw validation(`${label}时间无效。`);
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
  // Cross-check a structured local expression against the instant: a DST-gap
  // local time has no candidate, and an instant that is not one of the
  // expressed local time's candidates is rejected. Free-form expressions keep
  // their original text and are not resolved server-side.
  if (precision === 'minute' && STRUCTURED_LOCAL.test(localText)) {
    const candidates = zonedCandidates(localText, timeZone);
    if (!candidates.length) throw validation(`${label}本地时刻在 ${timeZone} 不存在。`);
    if (!candidates.includes(atMs)) throw validation(`${label}时刻与本地表达不一致。`);
  }
  return { atMs, at: raw, timeZone, localText, precision };
}

function normalizeTags(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw validation('标签必须是数组。');
  const seen = new Set();
  const tags = [];
  for (const entry of value) {
    if (typeof entry !== 'string') throw validation('标签必须是字符串。');
    const tag = entry.trim();
    if (!tag) continue;
    if ([...tag].length > 50) throw validation('标签最多 50 字。');
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  if (tags.length > 20) throw validation('标签最多 20 个。');
  return tags;
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validation('input 必须是对象。');
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw validation('标题不能为空。');
  if ([...title].length > 500) throw validation('标题最多 500 字。');
  if (input.kind !== 'action' && input.kind !== 'followup') throw validation('事项类型无效。');
  const owner = typeof input.owner === 'string' ? input.owner.trim() : '';
  if (!owner) throw validation('负责人不能为空。');
  if ([...owner].length > 200) throw validation('负责人最多 200 字。');
  if (!['low', 'medium', 'high'].includes(input.priority)) throw validation('优先级无效。');
  const due = normalizePoint(input.due, '截止时间');
  const followup = normalizePoint(input.followup, '下次跟进');
  const tags = normalizeTags(input.tags);
  return { title, kind: input.kind, owner, priority: input.priority, due, followup, tags };
}

function pointParameters(point) {
  return [
    point?.atMs ?? null,
    point?.timeZone ?? null,
    point?.localText ?? null,
    point?.precision ?? 'minute',
  ];
}

function itemParameters(item) {
  return [
    item.itemId,
    item.title,
    item.kind,
    item.owner,
    item.priority,
    ...pointParameters(item.due),
    ...pointParameters(item.followup),
    JSON.stringify(item.tags),
    item.createdAtMs,
    item.updatedAtMs,
  ];
}

function rowToInternal(row) {
  return {
    itemId: row[0],
    title: row[1],
    kind: row[2],
    owner: row[3],
    priority: row[4],
    status: row[5],
    due: row[6] === null || row[6] === undefined
      ? null
      : { atMs: row[6], timeZone: row[7], localText: row[8], precision: row[9] },
    followup: row[10] === null || row[10] === undefined
      ? null
      : { atMs: row[10], timeZone: row[11], localText: row[12], precision: row[13] },
    tags: JSON.parse(row[14]),
    createdAtMs: row[15],
    updatedAtMs: row[16],
    completedAtMs: row[17] === null || row[17] === undefined ? null : row[17],
    deletedAtMs: row[18] === null || row[18] === undefined ? null : row[18],
    version: row[19],
    source: row[20],
  };
}

function wirePoint(point) {
  return point
    ? { at: new Date(point.atMs).toISOString(), timeZone: point.timeZone, localText: point.localText, precision: point.precision }
    : null;
}

function toWire(item) {
  return {
    contractVersion: CONTRACT_VERSION,
    itemId: item.itemId,
    title: item.title,
    kind: item.kind,
    owner: item.owner,
    priority: item.priority,
    status: item.status,
    due: wirePoint(item.due),
    followup: wirePoint(item.followup),
    tags: item.tags,
    createdAt: new Date(item.createdAtMs).toISOString(),
    updatedAt: new Date(item.updatedAtMs).toISOString(),
    completedAt: item.completedAtMs === null ? null : new Date(item.completedAtMs).toISOString(),
    deletedAt: item.deletedAtMs === null ? null : new Date(item.deletedAtMs).toISOString(),
    version: item.version,
    source: item.source,
  };
}

/// Parse a pagination `limit`: absent means the default, an explicit value must
/// be an integer in 1..MAX_LIMIT (2026-11-08 interface ruling — no silent
/// clamping or fallback).
function parseLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_LIMIT) {
    throw validation(`limit 必须是 1–${MAX_LIMIT} 的整数。`);
  }
  return numeric;
}

function decodeCursor(cursor, kind) {
  if (!cursor) return null;
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw validation('cursor 无效。');
  }
  if (kind === 'list') {
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'number' || typeof decoded[1] !== 'string') {
      throw validation('cursor 无效。');
    }
    return { createdAtMs: decoded[0], itemId: decoded[1] };
  }
  if (typeof decoded !== 'number') throw validation('cursor 无效。');
  return { sequence: decoded };
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export class ManualItemsService {
  constructor(storage, { now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = now;
  }

  async findEvent(operationId) {
    const result = await this.storage.command('query', {
      sql: 'SELECT operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json FROM manual_item_events WHERE operation_id=?',
      params: [operationId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      operationId: row[0],
      itemId: row[1],
      action: row[2],
      occurredAtMs: row[3],
      requestJson: row[4],
      beforeJson: row[5],
      afterJson: row[6],
    };
  }

  async getItem(itemId) {
    const result = await this.storage.command('query', {
      sql: `${SELECT_ITEM} WHERE item_id=?`,
      params: [itemId],
    });
    const row = result.rows[0];
    if (!row) throw new ServiceError('item_not_found', '事项不存在。');
    return toWire(rowToInternal(row));
  }

  async replayOrConflict(operationId, canonical, event) {
    if (!event) return null;
    if (event.requestJson === canonical) {
      const result = await this.storage.command('query', {
        sql: `${SELECT_ITEM} WHERE item_id=?`,
        params: [event.itemId],
      });
      const row = result.rows[0];
      if (row) return { item: toWire(rowToInternal(row)), replayed: true };
    }
    throw new ServiceError('idempotency_conflict', '同一 operationId 已用于不同请求。');
  }

  async createItem(operationId, input) {
    const normalized = normalizeInput(input);
    const existing = await this.findEvent(operationId);
    const canonical = canonicalize({ action: 'create', input: normalized });
    const replay = await this.replayOrConflict(operationId, canonical, existing);
    if (replay) return replay;

    const now = this.now();
    const item = {
      itemId: `mi_${randomBytes(16).toString('hex')}`,
      ...normalized,
      status: 'open',
      createdAtMs: now,
      updatedAtMs: now,
      completedAtMs: null,
      deletedAtMs: null,
      version: 1,
      source: 'manual',
    };
    try {
      await this.storage.command('transact', {
        ops: [
          { sql: INSERT_ITEM, params: itemParameters(item) },
          {
            sql: INSERT_EVENT,
            params: [operationId, item.itemId, 'create', now, canonical, null, JSON.stringify(toWire(item))],
          },
        ],
      });
    } catch (error) {
      if (error.code === 'WEB_BACKEND_SQL_ERROR') {
        const raced = await this.findEvent(operationId);
        if (raced) return this.replayOrConflict(operationId, canonical, raced);
      }
      throw error;
    }
    return { item: toWire(item), replayed: false };
  }

  async readBefore(itemId) {
    const result = await this.storage.command('query', {
      sql: `${SELECT_ITEM} WHERE item_id=?`,
      params: [itemId],
    });
    const row = result.rows[0];
    return row ? rowToInternal(row) : null;
  }

  async updateItem(itemId, operationId, expectedVersion, input) {
    const normalized = normalizeInput(input);
    const canonical = canonicalize({ action: 'update', itemId, expectedVersion, input: normalized });
    const existing = await this.findEvent(operationId);
    const replay = await this.replayOrConflict(operationId, canonical, existing);
    if (replay) return replay;

    const before = await this.readBefore(itemId);
    if (!before) throw new ServiceError('item_not_found', '事项不存在。');
    if (before.status === 'deleted') throw new ServiceError('state_conflict', '已删除事项不能变更。');
    if (before.version !== expectedVersion) {
      throw new ServiceError('version_conflict', '事项已有更新，请刷新后重试。');
    }

    const now = this.now();
    const after = {
      ...before,
      ...normalized,
      updatedAtMs: now,
      version: before.version + 1,
    };
    try {
      const result = await this.storage.command('transact', {
        ops: [
          {
            sql: `UPDATE manual_items SET title=?,kind=?,owner=?,priority=?,
              due_at_ms=?,due_timezone=?,due_local=?,due_precision=?,
              followup_at_ms=?,followup_timezone=?,followup_local=?,followup_precision=?,
              tags_json=?,updated_at_ms=?,version=version+1
              WHERE item_id=? AND version=?`,
            params: [
              after.title, after.kind, after.owner, after.priority,
              ...pointParameters(after.due),
              ...pointParameters(after.followup),
              JSON.stringify(after.tags), now, itemId, expectedVersion,
            ],
          },
          {
            sql: INSERT_EVENT_GATED,
            params: [operationId, itemId, 'update', now, canonical, JSON.stringify(toWire(before)), JSON.stringify(toWire(after))],
          },
        ],
      });
      if (result.results[1].changes !== 1) {
        throw new ServiceError('version_conflict', '事项已有更新，请刷新后重试。');
      }
    } catch (error) {
      if (error.code === 'WEB_BACKEND_SQL_ERROR') {
        const raced = await this.findEvent(operationId);
        if (raced) return this.replayOrConflict(operationId, canonical, raced);
      }
      throw error;
    }
    return { item: toWire(after), replayed: false };
  }

  async transitionItem(itemId, operationId, expectedVersion, action, nextStatus) {
    const canonical = canonicalize({ action, itemId, expectedVersion });
    const existing = await this.findEvent(operationId);
    const replay = await this.replayOrConflict(operationId, canonical, existing);
    if (replay) return replay;

    const before = await this.readBefore(itemId);
    if (!before) throw new ServiceError('item_not_found', '事项不存在。');
    if (before.status === 'deleted') throw new ServiceError('state_conflict', '已删除事项不能变更。');
    if (before.version !== expectedVersion) {
      throw new ServiceError('version_conflict', '事项已有更新，请刷新后重试。');
    }
    const allowed = action === 'complete' ? ['open'] : action === 'reopen' ? ['completed'] : ['open', 'completed'];
    if (!allowed.includes(before.status)) {
      throw new ServiceError('state_conflict', '当前状态不允许该操作。');
    }

    const now = this.now();
    const after = {
      ...before,
      status: nextStatus,
      completedAtMs: action === 'complete' ? now : action === 'reopen' || action === 'delete' ? null : before.completedAtMs,
      deletedAtMs: action === 'delete' ? now : null,
      updatedAtMs: now,
      version: before.version + 1,
    };
    const assignments = ['status=?', 'updated_at_ms=?', 'version=version+1'];
    const params = [nextStatus, now];
    if (action === 'complete') {
      assignments.push('completed_at_ms=?');
      params.push(now);
    }
    if (action === 'reopen') assignments.push('completed_at_ms=NULL');
    if (action === 'delete') {
      // The frozen 002 CHECK requires completed_at_ms to be NULL unless the
      // status is exactly 'completed', so deleting a completed item clears it.
      assignments.push('deleted_at_ms=?', 'completed_at_ms=NULL');
      params.push(now);
    }
    params.push(itemId, expectedVersion);

    try {
      const result = await this.storage.command('transact', {
        ops: [
          { sql: `UPDATE manual_items SET ${assignments.join(',')} WHERE item_id=? AND version=?`, params },
          {
            sql: INSERT_EVENT_GATED,
            params: [operationId, itemId, action, now, canonical, JSON.stringify(toWire(before)), JSON.stringify(toWire(after))],
          },
        ],
      });
      if (result.results[1].changes !== 1) {
        throw new ServiceError('version_conflict', '事项已有更新，请刷新后重试。');
      }
    } catch (error) {
      if (error.code === 'WEB_BACKEND_SQL_ERROR') {
        const raced = await this.findEvent(operationId);
        if (raced) return this.replayOrConflict(operationId, canonical, raced);
      }
      throw error;
    }
    return { item: toWire(after), replayed: false };
  }

  completeItem(itemId, operationId, expectedVersion) {
    return this.transitionItem(itemId, operationId, expectedVersion, 'complete', 'completed');
  }

  reopenItem(itemId, operationId, expectedVersion) {
    return this.transitionItem(itemId, operationId, expectedVersion, 'reopen', 'open');
  }

  deleteItem(itemId, operationId, expectedVersion) {
    return this.transitionItem(itemId, operationId, expectedVersion, 'delete', 'deleted');
  }

  async listItems({ status, kind, cursor, limit } = {}) {
    const clauses = [];
    const params = [];
    if (status === undefined || status === null) {
      clauses.push("status IN ('open','completed')");
    } else if (ALLOWED_STATUSES.includes(status)) {
      if (status === 'all') {
        // no filter
      } else if (status === 'deleted') {
        clauses.push('status=?');
        params.push('deleted');
      } else {
        clauses.push('status=?');
        params.push(status);
      }
    } else {
      throw validation('status 无效。');
    }
    if (kind === 'action' || kind === 'followup') {
      clauses.push('kind=?');
      params.push(kind);
    }
    const watermark = decodeCursor(cursor, 'list');
    if (watermark) {
      clauses.push('(created_at_ms < ? OR (created_at_ms = ? AND item_id > ?))');
      params.push(watermark.createdAtMs, watermark.createdAtMs, watermark.itemId);
    }
    const pageSize = parseLimit(limit);
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.storage.command('query', {
      sql: `${SELECT_ITEM}${where} ORDER BY created_at_ms DESC, item_id ASC LIMIT ?`,
      params: [...params, pageSize + 1],
    });
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const items = page.map((row) => toWire(rowToInternal(row)));
    const nextCursor = hasMore && page.length
      ? encodeCursor([page[page.length - 1][15], page[page.length - 1][0]])
      : null;
    return { items, nextCursor };
  }

  async history(itemId, { cursor, limit } = {}) {
    await this.getItem(itemId);
    const pageSize = parseLimit(limit);
    const watermark = decodeCursor(cursor, 'history');
    const clauses = ['item_id=?'];
    const params = [itemId];
    if (watermark) {
      clauses.push('sequence < ?');
      params.push(watermark.sequence);
    }
    const result = await this.storage.command('query', {
      sql: `SELECT sequence,operation_id,action,occurred_at_ms,request_json,before_json,after_json
        FROM manual_item_events WHERE ${clauses.join(' AND ')} ORDER BY sequence DESC LIMIT ?`,
      params: [...params, pageSize + 1],
    });
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const events = page.map((row) => ({
      contractVersion: CONTRACT_VERSION,
      operationId: row[1],
      action: row[2],
      occurredAt: new Date(row[3]).toISOString(),
      before: row[5] ? JSON.parse(row[5]) : null,
      after: row[6] ? JSON.parse(row[6]) : null,
    }));
    const nextCursor = hasMore && page.length ? encodeCursor(page[page.length - 1][0]) : null;
    return { events, nextCursor };
  }
}
