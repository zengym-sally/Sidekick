// Read-only database observation for the W1 text-intake acceptance suites. The
// database is the real web-backend SQLite file under the same synthetic root
// the backend was started with (data/web-backend.sqlite, per
// src-tauri/src/store/web_backend_schema.rs DEFAULT_DB_FILE). The observer
// never writes business rows: every query is a SELECT, and the connection is
// read-only whenever the writer process allows it (WAL readers coexist with
// the Rust writer). A read-write open is used only as a fallback when a
// read-only open is refused after a hard kill (WAL recovery), and it still
// issues SELECT statements only.
//
// Table and column names follow the frozen sources: tasks/task_attempts/
// task_events/settings/instance_epochs from the frozen 001 DDL, and the 003
// proposal tables (text_sources/candidates/candidate_previews/
// manual_item_sources/sign_off_batches) with the column names the frozen
// contract §4.2/§5.4 pins. A table or column that does not exist yet (slice I
// not integrated in this tree) raises a named error — the suites fail
// explicitly instead of silently observing nothing.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

export function databasePath(root) {
  return join(root, 'data', 'web-backend.sqlite');
}

export function observe(root, query) {
  const path = databasePath(root);
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    db = new DatabaseSync(path);
  }
  try {
    return query(db);
  } finally {
    db.close();
  }
}

export function hasTable(root, name) {
  return observe(root, (db) => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    return Boolean(row);
  });
}

function requireTable(root, name) {
  if (!hasTable(root, name)) {
    throw new Error(`read-only observation: table ${name} does not exist in ${databasePath(root)} `
      + '(migration 003 is delivered by slice I; a suite asserting on it fails explicitly until then)');
  }
}

function requireColumns(root, table, columns) {
  const present = observe(root, (db) => db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const column of columns) {
    if (!present.includes(column)) {
      throw new Error(`read-only observation: table ${table} has no column ${column} (columns: ${present.join(',')})`);
    }
  }
}

export function schemaVersion(root) {
  return observe(root, (db) => {
    const row = db.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get();
    return row?.schema_version ?? null;
  });
}

// Counts for every table the suites reason about. A table that does not exist
// in this tree's schema is reported as null rather than throwing, so a single
// snapshot call works before and after slice I integrates migration 003.
export function tableCounts(root) {
  const tables = {
    manualItems: 'manual_items',
    manualItemEvents: 'manual_item_events',
    textSources: 'text_sources',
    candidates: 'candidates',
    candidatePreviews: 'candidate_previews',
    manualItemSources: 'manual_item_sources',
    signOffBatches: 'sign_off_batches',
    tasks: 'tasks',
    taskAttempts: 'task_attempts',
    taskEvents: 'task_events',
    taskResultPayloads: 'task_result_payloads',
    sideEffectReceipts: 'side_effect_receipts',
    recoveryHolds: 'recovery_holds',
    recoveryItems: 'recovery_items',
    instanceEpochs: 'instance_epochs',
  };
  const counts = {};
  for (const [key, table] of Object.entries(tables)) {
    counts[key] = hasTable(root, table)
      ? observe(root, (db) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n)
      : null;
  }
  return counts;
}

export function sourceRow(root, sourceId) {
  requireTable(root, 'text_sources');
  // Column set per the FROZEN 003 DDL (verified against the authorized
  // migration bytes, SHA-256 8e4e3159…): text_sources carries source_id,
  // fingerprint, kind, raw_text, source_at_ms, imported_at_ms, anchor_at_ms,
  // time_zone and succeeded_run_id — there is NO status column (the source's
  // lifecycle is the task's, reached through succeeded_run_id). The earlier
  // requirement of a status column failed against the real DDL (B-1).
  requireColumns(root, 'text_sources', ['source_id', 'fingerprint', 'raw_text', 'succeeded_run_id']);
  return observe(root, (db) => db.prepare('SELECT * FROM text_sources WHERE source_id = ?').get(sourceId) ?? null);
}

export function sourceRows(root) {
  requireTable(root, 'text_sources');
  return observe(root, (db) => db.prepare('SELECT * FROM text_sources ORDER BY rowid').all());
}

export function candidateRows(root, options = {}) {
  requireTable(root, 'candidates');
  const { sourceId, status } = options;
  let sql = 'SELECT * FROM candidates';
  const params = [];
  const clauses = [];
  if (sourceId) { clauses.push('source_id = ?'); params.push(sourceId); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  sql += ' ORDER BY source_id, ordinal';
  return observe(root, (db) => db.prepare(sql).all(...params));
}

export function candidateRow(root, candidateId) {
  requireTable(root, 'candidates');
  return observe(root, (db) => db.prepare('SELECT * FROM candidates WHERE candidate_id = ?').get(candidateId) ?? null);
}

export function previewRows(root, candidateId) {
  requireTable(root, 'candidate_previews');
  return observe(root, (db) => db.prepare('SELECT * FROM candidate_previews WHERE candidate_id = ? ORDER BY rowid').all(candidateId));
}

export function signOffBatchRow(root, operationId) {
  requireTable(root, 'sign_off_batches');
  return observe(root, (db) => db.prepare('SELECT * FROM sign_off_batches WHERE operation_id = ?').get(operationId) ?? null);
}

export function manualItemSourceRows(root, options = {}) {
  requireTable(root, 'manual_item_sources');
  const { itemId, candidateId } = options;
  let sql = 'SELECT * FROM manual_item_sources';
  const params = [];
  const clauses = [];
  if (itemId) { clauses.push('item_id = ?'); params.push(itemId); }
  if (candidateId) { clauses.push('candidate_id = ?'); params.push(candidateId); }
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  return observe(root, (db) => db.prepare(sql).all(...params));
}

export function taskRow(root, taskId) {
  requireTable(root, 'tasks');
  return observe(root, (db) => db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) ?? null);
}

export function taskByOperationId(root, operationId) {
  requireTable(root, 'tasks');
  return observe(root, (db) => db.prepare('SELECT * FROM tasks WHERE operation_id = ?').get(operationId) ?? null);
}

export function taskRows(root) {
  requireTable(root, 'tasks');
  return observe(root, (db) => db.prepare('SELECT * FROM tasks ORDER BY submit_seq').all());
}

export function taskEventRows(root, taskId) {
  requireTable(root, 'task_events');
  return observe(root, (db) => db.prepare(
    'SELECT cursor, object_type, object_id, type, payload, object_version, epoch, created_at '
    + 'FROM task_events WHERE object_type = ? AND object_id = ? ORDER BY cursor',
  ).all('task', taskId));
}

export function attemptRows(root, taskId) {
  requireTable(root, 'task_attempts');
  return observe(root, (db) => db.prepare('SELECT * FROM task_attempts WHERE task_id = ? ORDER BY started_at').all(taskId));
}

export function settingsRow(root, key) {
  requireTable(root, 'settings');
  return observe(root, (db) => db.prepare('SELECT * FROM settings WHERE key = ?').get(key) ?? null);
}

export function instanceEpochRows(root) {
  requireTable(root, 'instance_epochs');
  return observe(root, (db) => db.prepare('SELECT * FROM instance_epochs ORDER BY started_at').all());
}

// sqlite_sequence watermarks for the rebuilt 002 tables: migration 003 must
// preserve the historical high-water marks so new rows never reuse a deleted
// tail's value. Read-only evidence for the restart/sequence assertions.
export function sequenceWatermarks(root) {
  return observe(root, (db) => {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get()) return {};
    const rows = db.prepare('SELECT name, seq FROM sqlite_sequence').all();
    return Object.fromEntries(rows.map((row) => [row.name, row.seq]));
  });
}

export function manualItemRow(root, itemId) {
  requireTable(root, 'manual_items');
  return observe(root, (db) => db.prepare('SELECT * FROM manual_items WHERE item_id = ?').get(itemId) ?? null);
}

export function manualItemEvents(root, itemId) {
  requireTable(root, 'manual_item_events');
  return observe(root, (db) => db.prepare(
    'SELECT sequence, operation_id, item_id, action, occurred_at_ms, request_json, before_json, after_json '
    + 'FROM manual_item_events WHERE item_id = ? ORDER BY sequence',
  ).all(itemId));
}
