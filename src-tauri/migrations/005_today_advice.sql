DROP TRIGGER tool_calls_owner_insert;
DROP TRIGGER tool_calls_owner_update;
DROP TRIGGER agent_runs_owner_identity;
CREATE TABLE agent_runs_v5 (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    purpose TEXT NOT NULL CHECK(purpose IN ('role_trial','mcp_probe','today_advice')),
    status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled','interrupted')),
    snapshot_json TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT,
    error_code TEXT,
    created_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER,
    CHECK((purpose='role_trial' AND agent_id IS NOT NULL AND agent_id IN ('organizer','tracker','advisor'))
       OR (purpose='mcp_probe' AND agent_id IS NULL)
       OR (purpose='today_advice' AND agent_id IS NOT NULL AND agent_id='advisor'))
);
-- fault-point: after-create
INSERT INTO agent_runs_v5(rowid,id,agent_id,purpose,status,snapshot_json,input_json,result_json,error_code,created_at_ms,finished_at_ms)
SELECT rowid,id,agent_id,purpose,status,snapshot_json,input_json,result_json,error_code,created_at_ms,finished_at_ms FROM agent_runs;
-- fault-point: after-copy
DROP TABLE agent_runs;
ALTER TABLE agent_runs_v5 RENAME TO agent_runs;
CREATE INDEX agent_runs_role ON agent_runs(agent_id,created_at_ms);
CREATE INDEX agent_runs_probe ON agent_runs(purpose,created_at_ms) WHERE purpose='mcp_probe';

CREATE INDEX agent_runs_today ON agent_runs(purpose,created_at_ms) WHERE purpose='today_advice';
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
