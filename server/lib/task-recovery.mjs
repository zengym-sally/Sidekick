//! Restart recovery scan.
//!
//! A new instance registers its epoch, then verifies every unfinished attempt's
//! worker process tree before it may schedule again. A worker that cannot be
//! verified leaves scheduling paused; a verified-dead worker is classified by
//! the frozen §3.4 rules (cancel intent / staged result / neither).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ServiceError } from './manual-items-service.mjs';

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export class TaskRecovery {
  constructor({ storage, taskService, root, workerHost = null, epoch = `inst_${randomBytes(6).toString('hex')}`, now = () => Date.now() }) {
    this.storage = storage;
    this.taskService = taskService;
    this.root = root;
    this.workerHost = workerHost;
    this.epoch = epoch;
    this.now = now;
  }

  async registerEpoch() {
    const now = this.now();
    await this.storage.command('transact', {
      ops: [{
        sql: 'INSERT INTO instance_epochs (epoch,started_at) VALUES (?,?)',
        params: [this.epoch, now],
      }],
    });
    return this.epoch;
  }

  /// Find the worker record for an attempt by scanning the run directories. The
  /// record is the authoritative pid/hostNonce ownership proof.
  findWorkerRecord(attemptId) {
    const runs = join(this.root, 'runs');
    if (!existsSync(runs)) return null;
    for (const entry of readdirSync(runs)) {
      const path = join(runs, entry, 'worker.json');
      if (!existsSync(path)) continue;
      try {
        const record = JSON.parse(readFileSync(path, 'utf8'));
        if (record.attemptId === attemptId) return record;
      } catch {
        // A partially written record cannot prove ownership.
      }
    }
    return null;
  }

  async unfinishedAttempts() {
    const rows = await this.taskService.query(
      `SELECT a.attempt_id,a.task_id,a.worker_pid,t.state,t.version,t.cancel_intent,t.result_pending_exit,t.pending_outcome,t.attempt_exit_state,t.input_ref
        FROM task_attempts a JOIN tasks t ON t.task_id=a.task_id
        WHERE (a.ended_at IS NULL AND t.state IN ('running','cancelling','needs_review','interrupted')
               AND t.attempt_exit_state!='exited_confirmed')
           OR (t.attempt_exit_state='exited_unknown'
               AND a.attempt_id=(SELECT b.attempt_id FROM task_attempts b
                                 WHERE b.task_id=t.task_id ORDER BY b.started_at DESC LIMIT 1))`,
      [],
    );
    return rows.map((row) => ({
      attemptId: row[0],
      taskId: row[1],
      workerPid: row[2],
      state: row[3],
      version: row[4],
      cancelIntent: row[5],
      resultPendingExit: row[6],
      pendingOutcome: row[7],
      attemptExitState: row[8],
      inputRef: JSON.parse(row[9] || '{}'),
    }));
  }

  async recover() {
    const attempts = await this.unfinishedAttempts();
    const unverified = [];
    let recovered = 0;
    for (const attempt of attempts) {
      const record = this.findWorkerRecord(attempt.attemptId);
      const pid = record?.pid ?? attempt.workerPid;
      if (processIsAlive(pid)) {
        unverified.push({ attempt, reason: 'worker_process_unverified' });
        continue;
      }
      // Frozen §3.4: the recovery scan RE-VERIFIES the registry-domain
      // predicate and RE-RUNS the stray sweep before it may release a slot.
      // A typed observation requires BOTH the host observer AND a worker
      // record; with neither, the scan must NOT fall back to the V1 liveness
      // shortcut and assert `exited_confirmed` (F-2: that would be a registry
      // assertion, not a liveness fact).
      const runId = record?.runId ?? null;
      let evidence = null;
      let observerPresent = false;
      if (runId && this.workerHost) {
        observerPresent = true;
        try {
          const observation = await this.workerHost.observeAttemptExit(runId);
          evidence = observation?.attemptExitEvidence ?? null;
        } catch {
          evidence = null;
        }
        if (evidence) {
          // A2: the evidence must be reliably persisted and attribution-fixed
          // BEFORE any release/event/visibility; a failure fails closed.
          if (!this.taskService.persistAttemptExitEvidenceStrict(attempt.attemptId, evidence)) {
            unverified.push({ attempt, reason: 'exit_evidence_persist_failed' });
            continue;
          }
          try { await this.workerHost.runStraySweep(runId, { kill: 'real' }); } catch { /* a corrupt ledger never becomes a success */ }
          // Re-observe after the sweep: a proof-matched sweep may clear a
          // pending stray and change the verdict.
          try {
            const after = await this.workerHost.observeAttemptExit(runId);
            if (after?.attemptExitEvidence) {
              if (!this.taskService.persistAttemptExitEvidenceStrict(attempt.attemptId, after.attemptExitEvidence)) {
                unverified.push({ attempt, reason: 'exit_evidence_persist_failed' });
                continue;
              }
              evidence = after.attemptExitEvidence;
            }
          } catch { /* keep the pre-sweep evidence */ }
        }
      }
      const confirmed = this.taskService.validateExitEvidenceFor(attempt.attemptId, evidence).ok;
      if (!confirmed) {
        // No host/record/evidence is INSUFFICIENT EVIDENCE, never a registry
        // assertion: keep the slot held and the task parked.
        unverified.push({ attempt, reason: observerPresent ? 'exit_unverified' : 'exit_evidence_unavailable' });
        continue;
      }
      try {
        if (await this.classify(attempt, evidence)) recovered += 1;
        else unverified.push({ attempt, reason: 'state_changed' });
      } catch (error) {
        if (error instanceof ServiceError && error.code === 'version_conflict') {
          unverified.push({ attempt, reason: 'state_changed' });
        } else throw error;
      }
    }
    return { recovered, unverified };
  }

  /// Recovery transitions commit the state change, its audit event and the
  /// recovery item in ONE transaction (no separate commits).
  async transact(ops) {
    try {
      return await this.storage.command('transact', { ops });
    } catch (error) {
      if (error.code === 'WEB_BACKEND_CONDITION_FAILED') {
        throw new ServiceError('version_conflict', '任务状态已变化，请刷新后重试。');
      }
      throw error;
    }
  }

  async classify(attempt, evidence = null) {
    const now = this.now();
    const eventOp = (objectVersion, payload) => this.taskService.eventOp({
      objectType: 'task', objectId: attempt.taskId, type: 'task.changed', payload, objectVersion,
    });
    // F-2: the classify paths are only reachable with a confirmed typed
    // evidence (recover() gates them). A missing/non-`registry_extinct`
    // evidence fails closed — never assert `exited_confirmed` without it.
    if (!evidence || evidence.verdict !== 'registry_extinct') return false;
    if (attempt.state !== 'needs_review' && (attempt.state === 'cancelling' || attempt.cancelIntent === 1)) {
      // Frozen §6.1.1: a staged outcome wins; with none the cancel completes.
      return Boolean(await this.taskService.confirmExit(attempt.taskId, attempt.attemptId, { evidence, cancel: true }));
    }
    if (attempt.state === 'running') {
      // A dead worker mid-run: the side-effect state is unknown, so the task is
      // isolated for review and scheduling continues for other tasks.
      // Fencing (the C-4 fix round, tightened by the Codex revision): the task
      // UPDATE binds the SCAN-TIME premise — `attempt.state`/`attempt.version`
      // as `unfinishedAttempts` read them — AND that the scanned attempt is
      // still the task's open attempt, as a pre-commit `expectChanges`
      // assertion. A stale scan (a resolve + re-claim, a concurrent park, an
      // exit confirmation) lost the premise, so the WHOLE transaction — the
      // recovery item included — rolls back instead of classifying a dead
      // attempt onto a live one (findings A/B/C). The item op is the shared
      // dock op (frozen §12 one-row/monotonic): the task's first isolated
      // episode creates the row at version 1, a re-entering episode REUSES the
      // disposed line (version +1, pending again, audit cleared), so the
      // previous episode's stale request can never match the new authority
      // version and the item identity stays traceable across restarts.
      await this.transact([
        {
          sql: `UPDATE tasks SET state='needs_review',attempt_exit_state='exited_confirmed',failure=?,
            version=version+1,updated_at=? WHERE task_id=? AND state='running' AND version=?
            AND (SELECT a.attempt_id FROM task_attempts a
              WHERE a.task_id=tasks.task_id AND a.ended_at IS NULL
              ORDER BY a.started_at DESC LIMIT 1)=?`,
          params: [JSON.stringify({ code: 'worker_lost', message: '重启时整理进程已退出，副作用状态待核对。', retryable: 'manual', sideEffectSafety: 'unknown', cause: 'restart_unknown_side_effect' }), now, attempt.taskId, attempt.version, attempt.attemptId],
          expectChanges: 1,
        },
        eventOp(attempt.version + 1, { state: 'needs_review', cause: 'restart_unknown_side_effect' }),
        await this.taskService.recoveryItemDockOp(attempt.taskId),
      ]);
      // The recovery scan ends the attempt it just classified (F-4): an open
      // `task_attempts` row would keep the slot accounted to a dead worker and
      // be re-scanned (version +1, duplicate event) on every restart.
      await this.taskService.markAttemptExitConfirmed(attempt.attemptId, now);
      return true;
    }
    if (attempt.state === 'needs_review') {
      // F-7: an already-confirmed row is idempotent — a repeated scan must not
      // advance the task version or resend the event.
      if (attempt.attemptExitState === 'exited_confirmed') return false;
      const row = await this.taskService.getTaskRow(attempt.taskId);
      if (!row) return false;
      const internal = this.taskService.rowToInternal(row);
      const failure = attempt.cancelIntent === 1
        ? { ...internal.failure, cause: 'cancel_unknown_side_effect' }
        : internal.failure;
      // Already isolated; the exit is now confirmed so a resolve can proceed.
      // The same scan-time fence: a stale scan of an attempt whose task has
      // since been disposed and re-claimed must not release the new attempt's
      // slot or emit an event for it (finding C).
      await this.transact([
        {
          sql: `UPDATE tasks SET attempt_exit_state='exited_confirmed',failure=?,version=version+1,updated_at=?
            WHERE task_id=? AND state='needs_review' AND attempt_exit_state!='exited_confirmed' AND version=?
            AND (SELECT a.attempt_id FROM task_attempts a
              WHERE a.task_id=tasks.task_id
              ORDER BY a.started_at DESC LIMIT 1)=?`,
          params: [failure ? JSON.stringify(failure) : null, now, attempt.taskId, attempt.version, attempt.attemptId],
          expectChanges: 1,
        },
        eventOp(attempt.version + 1, { state: 'needs_review', attemptExitState: 'exited_confirmed' }),
      ]);
      await this.taskService.markAttemptExitConfirmed(attempt.attemptId, now);
      return true;
    }
    return false;
  }
}
