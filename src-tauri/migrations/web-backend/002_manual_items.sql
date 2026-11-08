-- Proposed migration: src-tauri/migrations/web-backend/002_manual_items.sql
-- Lineage: web-backend/1 (schema_version 2)
-- Status: PROPOSAL ONLY — not approved, not applied, not executed.
-- Basis: docs/engineering/web-manual-items-contract.md §4/§7 and
--        docs/engineering/web-api-contract.md (web-api/1, frozen).
-- Appends to the frozen 001_web_backend.sql; does not modify it.

CREATE TABLE manual_items (
    item_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('action','followup')),
    owner TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
    status TEXT NOT NULL CHECK (status IN ('open','completed','deleted')),
    due_at_ms INTEGER, due_timezone TEXT, due_local TEXT,
    due_precision TEXT NOT NULL DEFAULT 'minute' CHECK (due_precision IN ('minute','day')),
    followup_at_ms INTEGER, followup_timezone TEXT, followup_local TEXT,
    followup_precision TEXT NOT NULL DEFAULT 'minute' CHECK (followup_precision IN ('minute','day')),
    tags_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER, deleted_at_ms INTEGER,
    version INTEGER NOT NULL CHECK (version >= 1),
    source TEXT NOT NULL CHECK (source IN ('manual')),
    CHECK ((due_at_ms IS NULL AND due_timezone IS NULL AND due_local IS NULL)
        OR (due_at_ms IS NOT NULL AND due_timezone IS NOT NULL AND due_local IS NOT NULL)),
    CHECK ((followup_at_ms IS NULL AND followup_timezone IS NULL AND followup_local IS NULL)
        OR (followup_at_ms IS NOT NULL AND followup_timezone IS NOT NULL AND followup_local IS NOT NULL)),
    CHECK ((status = 'completed' AND completed_at_ms IS NOT NULL)
        OR (status <> 'completed' AND completed_at_ms IS NULL)),
    CHECK ((status = 'deleted' AND deleted_at_ms IS NOT NULL)
        OR (status <> 'deleted' AND deleted_at_ms IS NULL))
);
CREATE INDEX manual_items_status ON manual_items(status, kind);
CREATE INDEX manual_items_open_time ON manual_items(kind, followup_at_ms, due_at_ms)
    WHERE status = 'open';
-- m6: supports ORDER BY created_at_ms DESC, item_id ASC and the (created_at_ms, item_id)
-- cursor watermark without a TEMP B-TREE.
CREATE INDEX manual_items_list_order ON manual_items(created_at_ms DESC, item_id ASC);

CREATE TABLE manual_item_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    item_id TEXT NOT NULL REFERENCES manual_items(item_id),
    action TEXT NOT NULL CHECK (action IN ('create','update','complete','reopen','delete')),
    occurred_at_ms INTEGER NOT NULL,
    request_json TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL
);
CREATE INDEX manual_item_events_item ON manual_item_events(item_id, sequence);

-- B1: the schema_meta mirror must be advanced inside the SAME migration transaction
-- that raises PRAGMA user_version 1 -> 2; otherwise the runner's validate() rejects
-- the database on the next open with WEB_BACKEND_SCHEMA_VERSION_MISMATCH.
UPDATE schema_meta SET schema_version = 2 WHERE id = 1;
