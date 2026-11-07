// Read-only database observation for the acceptance suites. The database is the real
// web-backend SQLite file under the same synthetic root the backend was started with
// (data/web-backend.sqlite, per src-tauri/src/store/web_backend_schema.rs DEFAULT_DB_FILE).
// The observer never writes business rows: every query is a SELECT, and the connection is
// read-only whenever the writer process allows it (WAL readers coexist with the Rust
// writer). A read-write open is used only as a fallback when a read-only open is refused
// after a hard kill (WAL recovery), and it still issues SELECT statements only.
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

export function itemRow(root, itemId) {
  return observe(root, (db) => db.prepare('SELECT * FROM manual_items WHERE item_id = ?').get(itemId) ?? null);
}

export function itemEvents(root, itemId) {
  return observe(root, (db) => db.prepare(
    'SELECT sequence, operation_id, item_id, action, occurred_at_ms, request_json, before_json, after_json '
    + 'FROM manual_item_events WHERE item_id = ? ORDER BY sequence',
  ).all(itemId));
}

export function tableCounts(root) {
  return observe(root, (db) => ({
    manualItems: db.prepare('SELECT count(*) AS n FROM manual_items').get().n,
    manualItemEvents: db.prepare('SELECT count(*) AS n FROM manual_item_events').get().n,
    agentTasks: db.prepare('SELECT count(*) AS n FROM tasks').get().n,
    taskEvents: db.prepare('SELECT count(*) AS n FROM task_events').get().n,
  }));
}

export function schemaVersion(root) {
  return observe(root, (db) => {
    const row = db.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get();
    return row?.schema_version ?? null;
  });
}
