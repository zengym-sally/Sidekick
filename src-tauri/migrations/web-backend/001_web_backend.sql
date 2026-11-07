-- Proposed migration: src-tauri/migrations/web-backend/001_web_backend.sql
-- Lineage: web-backend/1 (new, independent from the legacy store v1-v5)
-- Status: PROPOSAL ONLY — not approved, not applied, not executed.
-- Basis: docs/engineering/web-api-contract.md §12 (accepted web-api/1) and
--        docs/engineering/web-backend-design.md §5.
-- Revised 2026-11-07 per lead ruling and ZCode R1-R3:
--   R1 partial unique index task_attempts_current (no exemption);
--   R2 PRAGMA user_version is the migration-progress authority, schema_meta.schema_version
--      is a same-transaction mirror (see web_backend_schema runner contract);
--   task_result_payloads adopted (explicitly in AUTH-SCHEMA-1a).
-- This file is a reference artifact in build/; it is NOT the migration file.
-- The migration file itself is to be created only after approval.

PRAGMA application_id = 0x57424b31;

CREATE TABLE schema_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_lineage TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    applied_at_ms INTEGER NOT NULL
);

INSERT INTO schema_meta (id, schema_lineage, schema_version, applied_at_ms)
VALUES (1, 'web-backend/1', 1, CAST(strftime('%s','now') AS INTEGER) * 1000);

CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    role TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','running','cancelling','succeeded','failed','cancelled','interrupted','needs_review')),
    version INTEGER NOT NULL CHECK (version >= 1),
    submit_seq INTEGER NOT NULL UNIQUE,
    attempt_exit_state TEXT NOT NULL CHECK (attempt_exit_state IN ('not_started','active','exiting','exited_unknown','exited_confirmed')),
    result_pending_exit INTEGER NOT NULL DEFAULT 0 CHECK (result_pending_exit IN (0,1)),
    pending_outcome TEXT CHECK (pending_outcome IN ('succeeded','failed')),
    config_revision TEXT NOT NULL,
    original_config_revision TEXT NOT NULL,
    input_ref TEXT NOT NULL,
    cancel_intent INTEGER NOT NULL DEFAULT 0 CHECK (cancel_intent IN (0,1)),
    next_attempt_at INTEGER,
    attempt_budget INTEGER NOT NULL DEFAULT 0 CHECK (attempt_budget >= 0),
    result_ref TEXT,
    failure TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    terminal_at INTEGER,
    CHECK ((result_pending_exit = 1 AND pending_outcome IS NOT NULL)
        OR (result_pending_exit = 0 AND pending_outcome IS NULL)),
    CHECK ((state IN ('succeeded','failed','cancelled') AND terminal_at IS NOT NULL)
        OR (state NOT IN ('succeeded','failed','cancelled') AND terminal_at IS NULL))
);
CREATE INDEX tasks_state_active ON tasks(state)
    WHERE state IN ('queued','running','cancelling','interrupted','needs_review');
CREATE INDEX tasks_exit_state ON tasks(attempt_exit_state)
    WHERE attempt_exit_state IN ('active','exiting','exited_unknown');

CREATE TABLE task_attempts (
    attempt_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(task_id),
    epoch TEXT NOT NULL,
    worker_pid INTEGER,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    exit_confirmed_at INTEGER,
    exit_reason TEXT,
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    CHECK (exit_confirmed_at IS NULL OR exit_confirmed_at >= started_at)
);
-- R1: at most one unfinished attempt per task, enforced at the schema level.
CREATE UNIQUE INDEX task_attempts_current ON task_attempts(task_id) WHERE ended_at IS NULL;
CREATE INDEX task_attempts_task ON task_attempts(task_id, started_at);
CREATE INDEX task_attempts_epoch ON task_attempts(epoch);

CREATE TABLE task_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT,
    object_type TEXT NOT NULL CHECK (object_type IN ('task','setting','workspace','recovery_hold')),
    object_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    object_version INTEGER NOT NULL CHECK (object_version >= 1),
    epoch TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX task_events_object ON task_events(object_type, object_id);
CREATE INDEX task_events_epoch_cursor ON task_events(epoch, cursor);

CREATE TABLE side_effect_receipts (
    receipt_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES task_attempts(attempt_id),
    kind TEXT NOT NULL,
    external_ref TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    provable_readonly INTEGER NOT NULL CHECK (provable_readonly IN (0,1))
);
CREATE INDEX side_effect_receipts_attempt ON side_effect_receipts(attempt_id);

CREATE TABLE workspace_operations (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('switch','restore','backup')),
    target_root_id TEXT,
    backup_id TEXT,
    hold_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending','succeeded','failed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE recovery_holds (
    hold_id TEXT PRIMARY KEY,
    cause TEXT NOT NULL CHECK (cause IN ('backup_restore','root_activation','root_import')),
    paused_submissions INTEGER NOT NULL DEFAULT 1 CHECK (paused_submissions IN (0,1)),
    paused_scheduling INTEGER NOT NULL DEFAULT 1 CHECK (paused_scheduling IN (0,1)),
    paused_timers INTEGER NOT NULL DEFAULT 1 CHECK (paused_timers IN (0,1)),
    paused_outbox INTEGER NOT NULL DEFAULT 1 CHECK (paused_outbox IN (0,1)),
    opened_at INTEGER NOT NULL,
    closed_at INTEGER
);

CREATE TABLE recovery_items (
    item_id TEXT PRIMARY KEY,
    hold_id TEXT REFERENCES recovery_holds(hold_id),
    task_id TEXT NOT NULL REFERENCES tasks(task_id),
    version INTEGER NOT NULL CHECK (version >= 1),
    verification_state TEXT NOT NULL CHECK (verification_state IN ('pending','verified','auto_safe','resumed','cancelled')),
    decision TEXT CHECK (decision IN ('resume','cancel')),
    decided_by TEXT,
    decided_at INTEGER,
    CHECK (decision IS NULL OR decided_by IS NOT NULL),
    CHECK (decision IS NULL OR decided_at IS NOT NULL)
);
CREATE INDEX recovery_items_hold ON recovery_items(hold_id);
CREATE INDEX recovery_items_task ON recovery_items(task_id);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TABLE instance_epochs (
    epoch TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    stopped_at INTEGER,
    CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

-- Adopted by lead ruling 2026-11-07; explicitly included in AUTH-SCHEMA-1a.
-- Contract §12 does not enumerate this table, but §4.3 segmented result reads
-- require durable opaque payload bytes addressed by result://<attemptId>/<name>.
CREATE TABLE task_result_payloads (
    attempt_id TEXT NOT NULL REFERENCES task_attempts(attempt_id),
    name TEXT NOT NULL,
    payload_blob BLOB NOT NULL,
    total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (attempt_id, name),
    CHECK (total_bytes = length(payload_blob))
);
