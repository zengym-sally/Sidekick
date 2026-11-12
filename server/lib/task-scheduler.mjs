//! Single-writer task scheduler.
//!
//! One loop claims queued tasks while a slot is free, spawns a Pi worker for
//! each, stages the result before the exit is confirmed, and commits the staged
//! outcome on exit. Slots follow `attempt_exit_state`, so a cancelled or
//! unknown-exit task keeps its slot until recovery releases it.

import { randomBytes } from 'node:crypto';
import { credentialRefFor } from './model-snapshot.mjs';
import { pairReceiptFact } from './worker-host.mjs';
import { ACTIVE_EXIT_STATES } from './task-service.mjs';

export class TaskScheduler {
  constructor({
    taskService,
    textIntakeService,
    workerHost,
    credentialProvider,
    sse = null,
    pollMs = 200,
    epoch = `inst_${randomBytes(6).toString('hex')}`,
    now = () => Date.now(),
  }) {
    this.taskService = taskService;
    this.textIntakeService = textIntakeService;
    this.workerHost = workerHost;
    this.credentialProvider = credentialProvider;
    this.sse = sse;
    this.pollMs = pollMs;
    this.epoch = epoch;
    this.now = now;
    this.timer = null;
    this.tickRunning = false;
    this.active = new Map();
    // MCP control-plane pairing, isolated per attempt: `openBegins` maps
    // attemptId -> Map(pairKey -> { callKey }) and `closedPairs` maps
    // attemptId -> Set(pairKey). The same serverId+callId under a concurrent
    // attempt is a different call and must never pair across attempts.
    this.openBegins = new Map();
    this.closedPairs = new Map();
    this.paused = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.workerHost.stopAll();
    this.active.clear();
    this.openBegins.clear();
    this.closedPairs.clear();
  }

  /// Broadcast the task frame with the authoritative `task_events` cursor so
  /// the SSE `id` is the same value `/api/snapshot` reports. The broadcast is
  /// strictly post-commit and best-effort: a disconnected client or a closing
  /// storage adapter can never roll back the committed terminal state, and a
  /// failure here never blocks the worker exit chain (the event row is
  /// already durable; the client compensates through the snapshot).
  async notify(taskId) {
    if (!this.sse) return;
    try {
      const task = await this.taskService.get(taskId);
      const cursor = await this.taskService.latestEventCursor(taskId);
      this.sse.broadcastTaskChanged({
        taskId: task.taskId,
        taskVersion: task.version,
        taskState: task.state,
        attemptExitState: task.attemptExitState,
        cursor,
      });
    } catch {
      // Intentionally silent: the state transition is already committed.
    }
  }

  async tick() {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      if (this.paused) return;
      const { agentConcurrency } = await this.taskService.readConcurrency();
      let running = await this.taskService.runningCount();
      while (running < agentConcurrency) {
        const claimed = await this.taskService.claimNext(agentConcurrency, this.epoch);
        if (!claimed) break;
        this.launch(claimed);
        running += 1;
      }
    } finally {
      this.tickRunning = false;
    }
  }

  async launch({ row, attemptId }) {
    const snapshot = row.inputRef?.snapshot ?? null;
    if (!snapshot) {
      // No configured model: fail with a configuration-class code instead of
      // starting a worker that would reject the request as RUNTIME_PROTOCOL.
      await this.taskService.stageResult(row.taskId, attemptId, this.epoch, 'failed', {
        code: 'auth_or_config_invalid',
        message: '还没有可用的默认模型，请到模型设置中配置。',
        retryable: 'manual',
        sideEffectSafety: 'proven_safe',
      });
      // No worker was ever spawned: the registry-domain exit is trivially
      // confirmed by a degenerate typed evidence (never the legacy boolean).
      await this.taskService.confirmNoWorkerExit(row.taskId, attemptId, null);
      void this.notify(row.taskId);
      return;
    }
    const ref = credentialRefFor(snapshot);
    let credential = '';
    if (ref) {
      try {
        credential = await this.credentialProvider.resolve(ref);
      } catch {
        await this.taskService.stageResult(row.taskId, attemptId, this.epoch, 'failed', {
          code: 'credential_unavailable',
          message: '缺少可用的模型密钥。',
          retryable: 'manual',
          sideEffectSafety: 'proven_safe',
        });
        // No worker was ever spawned: the registry-domain exit is trivially
      // confirmed by a degenerate typed evidence (never the legacy boolean).
      await this.taskService.confirmNoWorkerExit(row.taskId, attemptId, null);
        void this.notify(row.taskId);
        return;
      }
    }
    // Staging is driven by the ordered frame hook: a valid-identity result
    // frame is persisted immediately, while the worker may still be running.
    // A frame the transport identity fence rejects is reported to the audit
    // hook on the same ordered queue — the rejection is recorded, never
    // decoded into a result.
    const handle = this.workerHost.start({
      task: row,
      attemptId,
      snapshot,
      credential,
      onFrame: (frame) => this.onWorkerFrame(row.taskId, attemptId, frame),
      onRejectedFrame: (info) => this.auditRejectedLateResult(row.taskId, attemptId, info.reason),
    });
    this.active.set(row.taskId, handle);
    void handle.done
      .then((result) => this.onWorkerDone(row.taskId, handle.runId, attemptId, result))
      .catch((error) => {
        // A failed transition must never leave the task stuck in `running`:
        // persist a typed failure and isolate for review. The slot is only
        // released when the whole tree was verified gone.
        process.stderr.write(`[scheduler] worker completion failed for ${row.taskId}: ${error?.stack ?? error}\n`);
        void this.taskService.markNeedsReview(row.taskId, {
          code: 'output_contract_invalid',
          message: '整理结果暂存失败，已转待核对。',
          retryable: 'manual',
          sideEffectSafety: 'unknown',
        }, { exited: false }).then(() => this.notify(row.taskId)).catch(() => {});
      });
  }

  /// Audit a late result the fences rejected (frozen web-api/1 §3.3). The
  /// write is independent: no business row, no task version, no broadcast —
  /// a `rejected_late_result` task event only. A storage failure here never
  /// disturbs the accepted path, so it is logged and dropped exactly like a
  /// receipt persistence failure.
  async auditRejectedLateResult(taskId, attemptId, reason) {
    try {
      await this.taskService.recordRejectedLateResult(taskId, attemptId, reason);
    } catch (error) {
      process.stderr.write(`[scheduler] late-result audit failed for ${taskId}: ${error?.message ?? error}\n`);
    }
  }

  /// Ordered frame hook: persist a valid-identity result frame immediately.
  /// This is the staging step; the exit confirmation later commits the staged
  /// outcome and must never overwrite it.
  async onWorkerFrame(taskId, attemptId, frame) {
    // Persist the observed side-effect facts in independent small
    // transactions, in arrival order. A staging failure never revokes them.
    const handle = this.active.get(taskId);
    if (handle && Array.isArray(handle.state.receipts)) {
      const facts = handle.state.receipts.splice(0);
      // Pairing state is per attempt: the same serverId+callId under a
      // concurrent attempt is a different call and must never pair across.
      if (!this.openBegins.has(attemptId)) this.openBegins.set(attemptId, new Map());
      if (!this.closedPairs.has(attemptId)) this.closedPairs.set(attemptId, new Set());
      const openBegins = this.openBegins.get(attemptId);
      const closedPairs = this.closedPairs.get(attemptId);
      for (const fact of facts) {
        let kind = fact.kind;
        let callKey = fact.callKey ?? null;
        // Frozen P-3: exact serverId + callId identity, gated on a begin that
        // was persisted earlier in THIS attempt. The key format is the one
        // `pairReceiptFact` pairs on (worker-host.mjs).
        const pairKey = fact.serverId != null && fact.callId != null
          ? `${fact.serverId}\u0000${fact.callId}`
          : null;
        // Decide the pairing on snapshots, so the open/closed sets only
        // advance once the corresponding row has actually persisted.
        const paired = pairReceiptFact({ ...fact, kind, callKey }, new Map(openBegins), new Set(closedPairs));
        kind = paired.kind;
        callKey = paired.callKey ?? null;
        try {
          const persisted = await this.taskService.recordReceipt({
            runId: handle.state.runId,
            taskId,
            attemptId,
            epoch: this.epoch,
            kind,
            callKey,
            externalRef: fact.externalRef,
            provableReadonly: fact.provableReadonly,
          });
          if (!persisted) continue;
          if (kind === 'tool_call_begin') {
            // Only a successfully persisted begin enters the closable set,
            // and a call that already closed never reopens.
            if (pairKey !== null && !closedPairs.has(pairKey)) openBegins.set(pairKey, { callKey });
          } else if (fact.needsPairing === true && kind === 'tool_call_closed' && pairKey !== null) {
            openBegins.delete(pairKey);
            closedPairs.add(pairKey);
          }
        } catch (error) {
          // A failed receipt write means the persisted count can no longer be
          // trusted as an attempt fact: the trusted-path safety proof must
          // stay `unknown` for this attempt (receipt-persistence facts
          // insufficient).
          handle.state.receiptPersistFailed = true;
          process.stderr.write(`[scheduler] receipt persist failed for ${taskId}: ${error?.message ?? error}\n`);
        }
      }
    }
    if (frame.type !== 'result') return;
    const row = await this.taskService.getTaskRow(taskId);
    if (!row) return;
    const internal = this.taskService.rowToInternal(row);
    if (internal.attemptExitState !== 'active') {
      // Status fence: the attempt this result belongs to no longer accepts
      // results (it exited, was cancelled or was reclaimed). The late result
      // is audited, never staged (frozen §3.3).
      await this.auditRejectedLateResult(taskId, attemptId, 'attempt_state');
      return;
    }
    if (internal.type === 'extract') {
      const staged = await this.textIntakeService.stageExtractResult(taskId, attemptId, frame.data?.candidates ?? []);
      if (!staged) await this.auditRejectedLateResult(taskId, attemptId, 'attempt_or_epoch');
    } else if (internal.type === 'revise') {
      const staged = await this.textIntakeService.stageReviseResult(taskId, attemptId, frame.data?.preview ?? null);
      if (!staged) await this.auditRejectedLateResult(taskId, attemptId, 'attempt_or_epoch');
    } else {
      const staged = await this.taskService.stageResult(taskId, attemptId, this.epoch, 'succeeded', frame.data);
      if (!staged) await this.auditRejectedLateResult(taskId, attemptId, 'attempt_or_epoch');
    }
  }

  async onWorkerDone(taskId, runId, attemptId, workerResult) {
    // Every frame of this attempt has been persisted by now — the worker's
    // `done` settles only after its frame queue — so its pairing state can go.
    this.openBegins.delete(attemptId);
    this.closedPairs.delete(attemptId);
    // The host record of this attempt: its execution-source facts (the real
    // bundled runtime vs a private replacement factory, the actual artifacts'
    // identity binding, the observed tool/MCP frames, a failed receipt write)
    // are the trusted-path proof's inputs.
    const handle = this.active.get(taskId);
    // The typed exit evidence is the confirmation authority (frozen
    // §3.1.1/§3.2.1): the registry-domain verdict decides, never the V1
    // boolean surface. A missing/corrupt evidence fails closed.
    const { outcome, payload, deadlineTriggered = false } = workerResult;
    let evidence = null;
    try {
      const observation = await this.workerHost.observeAttemptExit(runId);
      evidence = observation?.attemptExitEvidence ?? null;
    } catch {
      evidence = null;
    }
    // A2: the evidence must be durably persisted and attribution-fixed BEFORE
    // any release/event/visibility; a write or reread failure fails closed.
    if (evidence && !this.taskService.persistAttemptExitEvidenceStrict(attemptId, evidence)) {
      evidence = null;
    }
    const confirmed = evidence !== null && evidence.verdict === 'registry_extinct';
    const row = await this.taskService.getTaskRow(taskId);
    if (!row) return;
    const internal = this.taskService.rowToInternal(row);
    // Observed non-readonly calls can never be called safe: the failure's
    // side-effect safety is forced to unknown when any such receipt exists.
    let effective;
    if (outcome !== 'succeeded' && await this.taskService.hasNonReadonlyReceipts(attemptId)) {
      effective = { outcome, payload: { ...payload, sideEffectSafety: 'unknown' } };
    } else {
      effective = { outcome, payload };
    }
    // The backend deadline is an independent enforcement path: it is reported
    // as a timeout failure, never as a silent success. The fact travels to
    // the exit-confirmation paths so the close-out envelope carries the real
    // cause (registered timeout mapping vs an unexpected worker death); a
    // staged outcome always wins, so the fact is only consulted when nothing
    // was staged.
    let deadlineFailure = false;
    if (deadlineTriggered && effective.outcome !== 'succeeded') {
      effective = { outcome: 'failed', payload: { code: 'model_timeout', message: '整理超出后端时限。', retryable: 'auto_backoff', sideEffectSafety: 'unknown' } };
      deadlineFailure = true;
    }
    // The REAL close-out fact for the no-staging extract/revise closure: the
    // host-received error frame's code (a real model/tool error), the
    // zero-frame death code (`runtime_exit`) or the spawn code. Without it the
    // closure could only guess `worker_lost` and the frozen §4.6 code aliases
    // would stay unreachable for extract/revise. A succeeded worker's payload
    // is never a failure payload, so it is not forwarded.
    //
    // Only the code and the message cross into the close-out envelope: the
    // §4.6 registry derives `retryable` and the safety face stays `unknown`
    // unless a receipt proved otherwise, so no payload-carried claim (a
    // `sideEffectSafety` field included) can ride along into the public
    // envelope. Every production payload is unchanged by this whitelist — the
    // host already reduces an error frame to `{code, message}` and the
    // backend-constructed payloads carry the default `unknown` anyway.
    const failurePayload = effective.outcome === 'succeeded' || effective.payload == null
      ? null
      : { code: effective.payload.code, message: effective.payload.message };
    // The registry-domain verdict is the only release authority: when it is
    // not `registry_extinct` (a known survivor, insufficient evidence, a
    // pending stray, a degenerate argv scan, or a missing/corrupt evidence),
    // keep the slot and isolate for review. The isolation carries the same
    // real close-out fact and the typed veto, so an unconfirmable exit
    // registers its cause instead of parking with no recovery at all.
    if (!confirmed) {
      if (internal.type === 'extract') await this.textIntakeService.confirmExtractExit(taskId, attemptId, { evidence, epoch: this.epoch, failurePayload });
      else if (internal.type === 'revise') await this.textIntakeService.confirmReviseExit(taskId, attemptId, { evidence, epoch: this.epoch, failurePayload });
      else await this.taskService.confirmExit(taskId, attemptId, { evidence, failurePayload });
      this.active.delete(taskId);
      void this.notify(taskId);
      return;
    }
    // Commit the ORIGINAL staged outcome (frozen §3.2/§6.1.1). Staging already
    // happened on the frame; a staged outcome always wins over the cancel
    // intent, and with no staged outcome the cancel completes.
    if (internal.type === 'extract') {
      await this.textIntakeService.confirmExtractExit(taskId, attemptId, { evidence, cancel: internal.state === 'cancelling', epoch: this.epoch, deadlineTriggered: deadlineFailure, failurePayload });
    } else if (internal.type === 'revise') {
      await this.textIntakeService.confirmReviseExit(taskId, attemptId, { evidence, cancel: internal.state === 'cancelling', epoch: this.epoch, deadlineTriggered: deadlineFailure, failurePayload });
    } else if (effective.outcome === 'succeeded') {
      await this.taskService.confirmExit(taskId, attemptId, { evidence });
    } else if (internal.state === 'cancelling' && internal.resultPendingExit !== 1) {
      await this.taskService.confirmExit(taskId, attemptId, { evidence, cancel: true });
    } else {
      if (internal.resultPendingExit !== 1) {
        // The trusted test-path safety proof binds the failure envelope to the
        // audited no-tool/no-MCP execution path before staging. A backend
        // deadline kill is never that path, so the proof is skipped for it;
        // every missing or insufficient fact keeps the §4.6 registry default
        // `unknown`, which routes the task to needs_review.
        if (!deadlineFailure) {
          const verdict = await this.trustedTestPathSafety(row, attemptId, handle, confirmed);
          if (verdict === 'proven_safe') {
            effective = { outcome: effective.outcome, payload: { ...effective.payload, sideEffectSafety: 'proven_safe' } };
          }
        }
        await this.taskService.stageResult(taskId, attemptId, this.epoch, 'failed', effective.payload);
      }
      await this.taskService.confirmExit(taskId, attemptId, { evidence });
    }
    this.active.delete(taskId);
    // The committed terminal transition is broadcast BEFORE the worker-host
    // bookkeeping: the state is already durable, and a client holding a
    // reconnect token must be able to replay it without waiting for the
    // slower, best-effort tree verification (the D1 compensation window).
    // The broadcast is fire-and-forget, so it never blocks the exit chain.
    void this.notify(taskId);
    // Release the worker-host record once the tree is verified; an unverified
    // tree keeps its record and its slot.
    await this.workerHost.confirmExit(runId).catch(() => {});
    const task = await this.taskService.get(taskId);
    // Bounded auto-backoff: only a failed task with a proven-safe failure may
    // re-enqueue, and the attempt budget is decremented.
    if (task.state === 'failed') {
      const retried = await this.taskService.maybeAutoRetry(taskId);
      // Only a transition that actually wrote an event (re-queue or review
      // isolation) is broadcast again; an exhausted budget is an internal
      // audit with no event, so nothing is faked for it.
      if (retried === 'queued' || retried === 'needs_review') void this.notify(taskId);
    }
  }

  /// The trusted `test`-path safety proof — the only grant of `proven_safe`
  /// for a failure a WORKER produced (the other two are the configuration-class
  /// launch failures, where no worker ever ran).
  ///
  /// Frozen §4.6 routes an unproven side effect to `needs_review` for EVERY
  /// registered code, because a failure code is never a safety proof. This
  /// proof grants `proven_safe` only when the failure of a `test`-kind attempt
  /// is bound, fact by fact, to the audited no-tool/no-MCP execution path:
  ///
  ///   * the task type is the server-side `test` kind — the fixed no-tools
  ///     path (extract/revise keep their own close-out and stay `unknown`);
  ///   * the run snapshot is the server-derived one persisted on the task row
  ///     (a client-carried snapshot is never stored as trusted);
  ///   * the worker was spawned by the DEFAULT factory — never a private
  ///     replacement factory — and the ACTUAL execution artifacts (the real
  ///     node binary and the organizer entry, resolved and content-hashed at
  ///     THIS spawn, and the very paths executed) are identical to the
  ///     audited runtime the server's own deployment carries.
  ///     The expected identity is resolved from the host module's location,
  ///     never from the configured `runtimeRoot` and never from a manifest
  ///     inside the runtime root being verified, so "no replacement factory"
  ///     alone is never a trusted Runtime identity;
  ///   * the attempt completed the frozen protocol exchange: the failure
  ///     comes from a legal-identity frame of THIS run (identity facts
  ///     sufficient), never from a frameless death or a dropped frame;
  ///   * the whole worker tree exit was verified (exit facts sufficient);
  ///   * no tool/MCP frame was observed, no receipt persisted for the
  ///     attempt, and no receipt write failed (receipt-persistence facts
  ///     sufficient);
  ///   * the current attempt/epoch: the verdict is computed for the attempt
  ///     being closed now and is staged through the epoch-fenced
  ///     `stageResult`, so a stale attempt can never inherit it.
  ///
  /// The task type or a zero count alone is never the verdict: a private
  /// replacement factory, an execution source whose artifact identity does
  /// not match the audited deployment runtime, a frameless worker death, a
  /// backend deadline kill, an unverified exit, a missing snapshot or a failed
  /// receipt write each keep `unknown`. A client- or worker-carried
  /// `sideEffectSafety` claim can never reach this method — only host-observed
  /// facts and server-derived rows do.
  async trustedTestPathSafety(row, attemptId, handle, treeVerified) {
    const internal = this.taskService.rowToInternal(row);
    if (internal.type !== 'test') return 'unknown';
    const snapshot = internal.inputRef?.snapshot;
    if (!snapshot?.provider?.id || !snapshot?.model?.id) return 'unknown';
    const state = handle?.state;
    // No host record, or a private replacement factory spawned the worker:
    // the execution source is not credibly confirmed.
    if (!state || state.replacementFactory) return 'unknown';
    // Execution source: the ACTUAL node binary and organizer entry must carry
    // the audited deployment runtime's artifact identity (real paths plus
    // SHA-256). An override root, a synthetic root or an unidentifiable
    // artifact set keeps the failure `unknown` — the private replacement
    // interfaces keep working, they simply never earn the grant.
    if (state.executionSource?.trusted !== true) return 'unknown';
    // Identity: only a legal-identity frame of this run carries the failure.
    if (!state.errorFrame) return 'unknown';
    // Exit: a single-process observation is not proof; only a verified tree.
    if (treeVerified !== true) return 'unknown';
    // No tools, no MCP: the audited `test` path emits none of these frames.
    if (state.toolFrames > 0 || state.mcpFrames > 0 || state.workerFrames > 0) return 'unknown';
    // Receipt facts: a failed write makes the count untrustworthy, and any
    // persisted receipt at all disproves the no-side-effect precondition.
    if (state.receiptPersistFailed) return 'unknown';
    if (await this.taskService.hasNonReadonlyReceipts(attemptId)) return 'unknown';
    if (await this.taskService.receiptCount(attemptId) !== 0) return 'unknown';
    return 'proven_safe';
  }

  /// Cancel a running task: the HTTP handler has already persisted the cancel
  /// intent (state=cancelling), so the frame is located by the active handle,
  /// not by re-reading the state. A late cancel after the worker exited is a
  /// no-op; the exit confirmation then completes the cancellation.
  async cancelRunning(taskId) {
    const handle = this.active.get(taskId);
    if (!handle) return false;
    this.workerHost.cancel(handle.runId);
    return true;
  }

  activeExitStates() {
    return [...ACTIVE_EXIT_STATES];
  }
}
