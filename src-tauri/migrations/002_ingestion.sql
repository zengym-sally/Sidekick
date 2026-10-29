ALTER TABLE todos ADD COLUMN capture_method TEXT NOT NULL DEFAULT 'manual' CHECK(capture_method IN ('manual','signed_ai'));
ALTER TABLE todos ADD COLUMN due_precision TEXT NOT NULL DEFAULT 'minute' CHECK(due_precision IN ('minute','day'));
ALTER TABLE todos ADD COLUMN followup_precision TEXT NOT NULL DEFAULT 'minute' CHECK(followup_precision IN ('minute','day'));
CREATE TABLE todo_events_v2 (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    todo_id TEXT NOT NULL REFERENCES todos(id),
    action TEXT NOT NULL CHECK(action IN ('create','update','complete','reopen','delete','link')),
    occurred_at_ms INTEGER NOT NULL,
    request_json TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL
);
INSERT INTO todo_events_v2 SELECT * FROM todo_events;
DROP TABLE todo_events;
ALTER TABLE todo_events_v2 RENAME TO todo_events;
CREATE INDEX todo_events_item ON todo_events(todo_id,sequence);
CREATE TABLE sources (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind='text'),
    raw_text TEXT NOT NULL, source_at_ms INTEGER, imported_at_ms INTEGER NOT NULL,
    anchor_at_ms INTEGER NOT NULL, time_zone TEXT NOT NULL, succeeded_run_id TEXT
);
CREATE TABLE runs (
    id TEXT PRIMARY KEY, source_id TEXT REFERENCES sources(id),
    kind TEXT NOT NULL CHECK(kind IN ('extract','revise','test')),
    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')),
    snapshot_json TEXT NOT NULL, input_json TEXT NOT NULL,
    candidate_id TEXT, candidate_version INTEGER, preview_json TEXT,
    error_code TEXT, created_at_ms INTEGER NOT NULL, finished_at_ms INTEGER
);
CREATE TABLE candidates (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
    run_id TEXT NOT NULL REFERENCES runs(id), ordinal INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','accepted','discarded')),
    version INTEGER NOT NULL CHECK(version>=1), fields_json TEXT NOT NULL,
    evidence TEXT NOT NULL, due_expression TEXT, followup_expression TEXT,
    warnings_json TEXT NOT NULL, unresolved INTEGER NOT NULL CHECK(unresolved IN (0,1)),
    accepted_todo_id TEXT REFERENCES todos(id), processed_at_ms INTEGER,
    UNIQUE(source_id,ordinal)
);
CREATE TABLE todo_sources (
    todo_id TEXT NOT NULL REFERENCES todos(id), source_id TEXT NOT NULL REFERENCES sources(id),
    candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id), evidence TEXT NOT NULL,
    association TEXT NOT NULL CHECK(association IN ('new','manual_link')),
    operation_id TEXT NOT NULL UNIQUE, created_at_ms INTEGER NOT NULL,
    PRIMARY KEY(todo_id,candidate_id)
);
CREATE TABLE ingestion_operations (
    operation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, request_json TEXT NOT NULL,
    result_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL
);
CREATE INDEX candidates_status ON candidates(status,source_id);
CREATE INDEX runs_source ON runs(source_id,created_at_ms);
CREATE INDEX todo_sources_item ON todo_sources(todo_id);
