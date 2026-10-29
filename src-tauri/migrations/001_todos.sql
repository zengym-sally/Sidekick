PRAGMA application_id = 0x53444b31;
CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('action','followup')),
    owner TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
    status TEXT NOT NULL CHECK(status IN ('open','completed','deleted')),
    due_at_ms INTEGER, due_timezone TEXT, due_local TEXT,
    followup_at_ms INTEGER, followup_timezone TEXT, followup_local TEXT,
    tags_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER, deleted_at_ms INTEGER,
    version INTEGER NOT NULL CHECK(version >= 1),
    source TEXT NOT NULL CHECK(source IN ('manual')),
    CHECK((due_at_ms IS NULL AND due_timezone IS NULL AND due_local IS NULL) OR (due_at_ms IS NOT NULL AND due_timezone IS NOT NULL AND due_local IS NOT NULL)),
    CHECK((followup_at_ms IS NULL AND followup_timezone IS NULL AND followup_local IS NULL) OR (followup_at_ms IS NOT NULL AND followup_timezone IS NOT NULL AND followup_local IS NOT NULL))
);
CREATE TABLE todo_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    todo_id TEXT NOT NULL REFERENCES todos(id),
    action TEXT NOT NULL CHECK(action IN ('create','update','complete','reopen','delete')),
    occurred_at_ms INTEGER NOT NULL,
    request_json TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL
);
CREATE INDEX todo_events_item ON todo_events(todo_id,sequence);
CREATE INDEX todos_status ON todos(status,kind);
