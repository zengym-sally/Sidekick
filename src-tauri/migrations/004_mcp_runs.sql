CREATE TABLE agent_runs_v4 (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    purpose TEXT NOT NULL CHECK(purpose IN ('role_trial','mcp_probe')),
    status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled','interrupted')),
    snapshot_json TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT,
    error_code TEXT,
    created_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER,
    CHECK((purpose='role_trial' AND agent_id IS NOT NULL AND agent_id IN ('organizer','tracker','advisor'))
       OR (purpose='mcp_probe' AND agent_id IS NULL))
);
-- fault-point: after-create
INSERT INTO agent_runs_v4(rowid,id,agent_id,purpose,status,snapshot_json,input_json,result_json,error_code,created_at_ms,finished_at_ms)
SELECT rowid,id,agent_id,purpose,status,snapshot_json,input_json,result_json,error_code,created_at_ms,finished_at_ms FROM agent_runs;
-- fault-point: after-copy
DROP TABLE agent_runs;
ALTER TABLE agent_runs_v4 RENAME TO agent_runs;
CREATE INDEX agent_runs_role ON agent_runs(agent_id,created_at_ms);
CREATE INDEX agent_runs_probe ON agent_runs(purpose,created_at_ms) WHERE purpose='mcp_probe';

CREATE TABLE tool_calls (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(CAST(id AS BLOB)) BETWEEN 1 AND 128),
    run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
    agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE RESTRICT,
    model_call_id TEXT NOT NULL CHECK(length(CAST(model_call_id AS BLOB)) BETWEEN 1 AND 256),
    configuration_revision TEXT NOT NULL CHECK(length(CAST(configuration_revision AS BLOB)) BETWEEN 1 AND 128),
    schema_sha256 TEXT NOT NULL CHECK(typeof(schema_sha256)='text' AND length(CAST(schema_sha256 AS BLOB))=64 AND length(schema_sha256)=64 AND schema_sha256 NOT GLOB '*[^0-9a-f]*'),
    server_id TEXT NOT NULL CHECK(length(CAST(server_id AS BLOB)) BETWEEN 1 AND 64),
    tool_name TEXT NOT NULL CHECK(length(CAST(tool_name AS BLOB)) BETWEEN 1 AND 256),
    arguments_sha256 TEXT NOT NULL CHECK(typeof(arguments_sha256)='text' AND length(CAST(arguments_sha256 AS BLOB))=64 AND length(arguments_sha256)=64 AND arguments_sha256 NOT GLOB '*[^0-9a-f]*'),
    send_state TEXT NOT NULL CHECK(send_state IN ('possibly_sent','responded','unknown')),
    response_category TEXT CHECK(response_category IN ('success','tool_error')),
    response_summary TEXT CHECK(response_summary IS NULL OR length(CAST(response_summary AS BLOB))<=2048),
    created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms>=0),
    finished_at_ms INTEGER CHECK(finished_at_ms IS NULL OR (typeof(finished_at_ms)='integer' AND finished_at_ms>=created_at_ms)),
    CHECK((run_id IS NOT NULL AND agent_run_id IS NULL) OR (run_id IS NULL AND agent_run_id IS NOT NULL)),
    CHECK((send_state='possibly_sent' AND response_category IS NULL AND response_summary IS NULL AND finished_at_ms IS NULL)
       OR (send_state='responded' AND response_category IS NOT NULL AND finished_at_ms IS NOT NULL)
       OR (send_state='unknown' AND response_category IS NULL AND response_summary IS NULL AND finished_at_ms IS NOT NULL))
);
CREATE INDEX tool_calls_run ON tool_calls(run_id,created_at_ms);
CREATE INDEX tool_calls_agent_run ON tool_calls(agent_run_id,created_at_ms);
CREATE INDEX tool_calls_state ON tool_calls(send_state,created_at_ms);
CREATE TRIGGER tool_calls_owner_insert BEFORE INSERT ON tool_calls BEGIN
    SELECT RAISE(ABORT,'invalid tool call owner') WHERE
        (NEW.agent_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_runs WHERE id=NEW.agent_run_id AND purpose='role_trial'))
        OR (NEW.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM runs WHERE id=NEW.run_id AND kind IN ('extract','revise')));
END;
CREATE TRIGGER tool_calls_owner_update BEFORE UPDATE OF run_id,agent_run_id ON tool_calls BEGIN
    SELECT RAISE(ABORT,'invalid tool call owner') WHERE
        (NEW.agent_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_runs WHERE id=NEW.agent_run_id AND purpose='role_trial'))
        OR (NEW.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM runs WHERE id=NEW.run_id AND kind IN ('extract','revise')));
END;
CREATE TRIGGER agent_runs_owner_identity BEFORE UPDATE OF agent_id,purpose ON agent_runs
WHEN OLD.agent_id IS NOT NEW.agent_id OR OLD.purpose IS NOT NEW.purpose BEGIN
    SELECT RAISE(ABORT,'agent run identity is immutable');
END;
