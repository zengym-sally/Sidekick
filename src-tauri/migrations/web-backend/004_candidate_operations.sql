-- Proposed migration: src-tauri/migrations/web-backend/004_candidate_operations.sql
-- Lineage: web-backend/1 (schema_version 4)
-- Status: PROPOSAL ONLY — not approved, not applied, not executed.
-- Basis: docs/reviews/web-text-intake-storage-decision-20261108.md §8
--        (candidate-operation idempotency ledger); frozen replay semantics of
--        docs/engineering/web-text-intake-contract.md §5.1 约定 and
--        docs/engineering/web-manual-items-contract.md appendix A.2.
-- Appends to frozen 001/002/003; does not modify them.
--
-- One row per COMMITTED direct candidate operation (edit / discard /
-- apply_preview). `operation_id` PRIMARY KEY is the idempotency arbiter:
-- replay-before-guards looks this table up FIRST, compares the stored
-- canonical request bytes (same id + same canonical input -> 200 replayed
-- from the candidate's CURRENT authoritative state; different canonical
-- input, action, or target -> 409 idempotency_conflict). Rows are immutable:
-- no UPDATE and no DELETE exist in any authorized template. Guard- or
-- validation-rejected attempts never write a row, so an operationId is
-- consumed only by success (manual-items contract A.2). Replay itself is
-- read-only and does not consume a version (web-api/1 §3.3).

CREATE TABLE candidate_operations (
    operation_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
    action TEXT NOT NULL CHECK (action IN ('edit','discard','apply_preview')),
    request_json TEXT NOT NULL,
    occurred_at_ms INTEGER NOT NULL
);

-- Advance the schema_meta mirror inside the SAME migration transaction
-- (frozen W0 R2 / W1 B1 contract); the runner raises PRAGMA user_version 3 -> 4.
UPDATE schema_meta SET schema_version = 4 WHERE id = 1;
