-- Proposed migration: src-tauri/migrations/web-backend/003_text_intake.sql
-- Lineage: web-backend/1 (schema_version 3)
-- Status: PROPOSAL ONLY — not approved, not applied, not executed.
-- Basis: docs/engineering/web-text-intake-contract.md §4/§6 and
--        docs/engineering/web-api-contract.md (web-api/1, frozen).
-- Appends to frozen 001/002; does not modify them.
--
-- The runner applies every migration in ONE transaction with
-- `PRAGMA foreign_keys=ON` (web_backend_schema.rs::configure_connection).
-- `ALTER TABLE ... RENAME` is used for both tables so the child FK is
-- repointed to the rebuilt parent; the old child is dropped before the old
-- parent, so no FK blocks the rebuild. Existing rows are preserved
-- byte-for-byte (rowid is NOT promised). The AUTOINCREMENT high-water is
-- preserved explicitly so a hard-deleted tail can never be reused.

-- 0. Capture the historical AUTOINCREMENT high-water before the rebuild.
CREATE TABLE _web_backend_seq_high_water (name TEXT PRIMARY KEY, seq INTEGER);
INSERT INTO _web_backend_seq_high_water(name, seq)
SELECT 'manual_item_events', seq FROM sqlite_sequence WHERE name = 'manual_item_events';

-- 1. Parent first: rebuild manual_items with source extended to signed_ai.
CREATE TABLE manual_items_v3 (
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
    source TEXT NOT NULL CHECK (source IN ('manual','signed_ai')),
    CHECK ((due_at_ms IS NULL AND due_timezone IS NULL AND due_local IS NULL)
        OR (due_at_ms IS NOT NULL AND due_timezone IS NOT NULL AND due_local IS NOT NULL)),
    CHECK ((followup_at_ms IS NULL AND followup_timezone IS NULL AND followup_local IS NULL)
        OR (followup_at_ms IS NOT NULL AND followup_timezone IS NOT NULL AND followup_local IS NOT NULL)),
    CHECK ((status = 'completed' AND completed_at_ms IS NOT NULL)
        OR (status <> 'completed' AND completed_at_ms IS NULL)),
    CHECK ((status = 'deleted' AND deleted_at_ms IS NOT NULL)
        OR (status <> 'deleted' AND deleted_at_ms IS NULL))
);
INSERT INTO manual_items_v3
    (item_id,title,kind,owner,priority,status,
     due_at_ms,due_timezone,due_local,due_precision,
     followup_at_ms,followup_timezone,followup_local,followup_precision,
     tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source)
SELECT item_id,title,kind,owner,priority,status,
       due_at_ms,due_timezone,due_local,due_precision,
       followup_at_ms,followup_timezone,followup_local,followup_precision,
       tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source
FROM manual_items;

-- 2. Child: rebuild manual_item_events with the link action and an FK to the
--    rebuilt parent. Copy preserves row order and the sequence values.
CREATE TABLE manual_item_events_v3 (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    item_id TEXT NOT NULL REFERENCES manual_items_v3(item_id),
    action TEXT NOT NULL CHECK (action IN ('create','update','complete','reopen','delete','link')),
    occurred_at_ms INTEGER NOT NULL,
    request_json TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL
);
INSERT INTO manual_item_events_v3
    (sequence,operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json)
SELECT sequence,operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json
FROM manual_item_events;

-- 3. Drop the old child first, then the old parent (no FK blocks).
DROP TABLE manual_item_events;
DROP TABLE manual_items;

-- 4. Rename both to the frozen names (RENAME repoints the child FK).
ALTER TABLE manual_items_v3 RENAME TO manual_items;
ALTER TABLE manual_item_events_v3 RENAME TO manual_item_events;

-- 5. Restore the historical AUTOINCREMENT high-water (migration-only write to
--    sqlite_sequence; never in the business transact whitelist).
DELETE FROM sqlite_sequence WHERE name = 'manual_item_events';
INSERT INTO sqlite_sequence(name, seq)
SELECT 'manual_item_events', seq FROM _web_backend_seq_high_water WHERE seq IS NOT NULL;
DROP TABLE _web_backend_seq_high_water;

-- 6. Rebuild the frozen index set under the original names.
CREATE INDEX manual_items_status ON manual_items(status, kind);
CREATE INDEX manual_items_open_time ON manual_items(kind, followup_at_ms, due_at_ms)
    WHERE status = 'open';
CREATE INDEX manual_items_list_order ON manual_items(created_at_ms DESC, item_id ASC);
CREATE INDEX manual_item_events_item ON manual_item_events(item_id, sequence);

-- 7. Text sources (one per intake; fingerprint dedups re-submission).
CREATE TABLE text_sources (
    source_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('text')),
    raw_text TEXT NOT NULL,
    source_at_ms INTEGER,
    imported_at_ms INTEGER NOT NULL,
    anchor_at_ms INTEGER NOT NULL,
    time_zone TEXT NOT NULL,
    succeeded_run_id TEXT REFERENCES tasks(task_id),
    CHECK (source_at_ms IS NULL OR source_at_ms > 0)
);
CREATE INDEX text_sources_imported ON text_sources(imported_at_ms DESC, source_id ASC);

-- 8. Candidate cards (versioned, signable, source-evidenced). `staged` rows are
--    written by the result-staging transaction and are invisible/unsignable
--    until the worker exit is confirmed (frozen web-api/1 §3.2).
CREATE TABLE candidates (
    candidate_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES text_sources(source_id),
    run_id TEXT NOT NULL REFERENCES tasks(task_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
    status TEXT NOT NULL CHECK (status IN ('staged','pending','accepted','discarded')),
    version INTEGER NOT NULL CHECK (version >= 1),
    fields_json TEXT NOT NULL,
    evidence TEXT NOT NULL,
    due_expression TEXT,
    followup_expression TEXT,
    warnings_json TEXT NOT NULL,
    unresolved INTEGER NOT NULL CHECK (unresolved IN (0,1)),
    accepted_item_id TEXT REFERENCES manual_items(item_id),
    processed_at_ms INTEGER,
    UNIQUE (source_id, ordinal),
    CHECK ((status = 'accepted' AND accepted_item_id IS NOT NULL AND processed_at_ms IS NOT NULL)
        OR (status = 'discarded' AND accepted_item_id IS NULL AND processed_at_ms IS NOT NULL)
        OR (status IN ('staged','pending') AND accepted_item_id IS NULL AND processed_at_ms IS NULL))
);
CREATE INDEX candidates_pending ON candidates(source_id, ordinal) WHERE status = 'pending';
CREATE INDEX candidates_status ON candidates(status, source_id, ordinal);

-- 9. Natural-language revise previews (never auto-applied).
CREATE TABLE candidate_previews (
    preview_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
    run_id TEXT NOT NULL REFERENCES tasks(task_id),
    candidate_version INTEGER NOT NULL CHECK (candidate_version >= 1),
    draft_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);
CREATE INDEX candidate_previews_candidate ON candidate_previews(candidate_id, candidate_version);

-- 10. Item <-> source <-> candidate association with evidence.
CREATE TABLE manual_item_sources (
    item_id TEXT NOT NULL REFERENCES manual_items(item_id),
    source_id TEXT NOT NULL REFERENCES text_sources(source_id),
    candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
    evidence TEXT NOT NULL,
    association TEXT NOT NULL CHECK (association IN ('new','manual_link')),
    operation_id TEXT NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (item_id, candidate_id)
);
CREATE INDEX manual_item_sources_source ON manual_item_sources(source_id);
CREATE INDEX manual_item_sources_item ON manual_item_sources(item_id);

-- 11. Batch sign-off ledger: one row per client batch operationId, binding the
--     canonical request and the candidate -> item ID mapping. Per-row
--     operationIds are the deterministic `sign_off:` + SHA-256(UTF-8 JSON
--     ["sign_off", batchOperationId, candidateId]) keys, so the frozen per-row
--     UNIQUE constraints are satisfied without widening the event table's
--     namespace. Replay reads the current authoritative objects by mapping.
CREATE TABLE sign_off_batches (
    operation_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
    request_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    CHECK ((status = 'succeeded' AND completed_at_ms IS NOT NULL)
        OR (status = 'failed' AND completed_at_ms IS NOT NULL)
        OR (status NOT IN ('succeeded','failed') AND completed_at_ms IS NULL))
);
CREATE INDEX sign_off_batches_created ON sign_off_batches(created_at_ms DESC);

-- 12. Advance the schema_meta mirror inside the SAME migration transaction.
UPDATE schema_meta SET schema_version = 3 WHERE id = 1;
