CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL CHECK(agent_id IN ('organizer','tracker','advisor')),
    purpose TEXT NOT NULL CHECK(purpose='role_trial'),
    status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled','interrupted')),
    snapshot_json TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT,
    error_code TEXT,
    created_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER
);
CREATE INDEX agent_runs_role ON agent_runs(agent_id,created_at_ms);
