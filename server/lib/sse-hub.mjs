//! Server-sent events hub.
//!
//! Task frames keep their frozen cursor/epoch semantics. Item changes are
//! in-process hints only: no `id` line, no task cursor, no `task_events` row.
//! Clients re-read the manual-item endpoints after subscribing, reconnecting
//! or receiving `stream.reset` (W1 contract §5, M2).

import { randomBytes } from 'node:crypto';
import { CONTRACT_VERSION } from './manual-items-service.mjs';

export class SseHub {
  constructor({ heartbeatMs = 15000, maxFrames = 500 } = {}) {
    this.heartbeatMs = heartbeatMs;
    this.epoch = `inst_${randomBytes(6).toString('hex')}`;
    this.clients = new Set();
    this.timer = null;
    this.cursor = 0;
    // Bounded in-instance replay window. Task frames carry the authoritative
    // `task_events.cursor`; item/candidate hints are not replayed.
    this.maxFrames = maxFrames;
    this.frames = [];
    // The highest cursor actually dropped from the bounded buffer (0 while
    // nothing was evicted). This — not the oldest retained frame — is the
    // eviction boundary: transitions committed without a broadcast (audit
    // events) leave gaps in the buffer, and a token inside such a gap was
    // never evicted, so it stays resumable.
    this.evictedThrough = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // already closed
      }
    }
    this.clients.clear();
  }

  get size() {
    return this.clients.size;
  }

  addClient(req, res, { watermark = null } = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    // The authoritative instance watermark is the real `task_events`
    // high-watermark (the value `/api/snapshot` reports as `lastEventId`),
    // supplied by the caller; the in-memory broadcast counter only lags it
    // when a transition was committed without a broadcast.
    const high = watermark === null || watermark === undefined ? this.cursor : watermark;
    // Frozen web-api/1 §6: a reconnect token whose epoch differs from this
    // instance's, is malformed, or points outside the retention window is
    // answered with `stream.reset` before the handshake; a resumable token is
    // replayed from the bounded buffer.
    const replay = this.replayFrom(req.headers['last-event-id'], high);
    if (replay.reset) {
      this.send(res, 'stream.reset', {
        contractVersion: CONTRACT_VERSION,
        epoch: this.epoch,
        reason: replay.reason,
      });
    } else {
      for (const frame of replay.frames) {
        this.send(res, frame.event, frame.data, `${this.epoch}:${frame.cursor}`);
      }
    }
    this.send(res, 'stream.ready', {
      contractVersion: CONTRACT_VERSION,
      epoch: this.epoch,
      cursor: high,
    });
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  /// Decide how to resume a reconnect: replay the frames after `token`, or
  /// report why the token cannot be resumed. `watermark` is the real instance
  /// high watermark (the `task_events` cursor); a token beyond it claims
  /// events that do not exist, and a token below the actual eviction
  /// boundary lost frames — both require a snapshot re-sync. A token between
  /// the two is resumable even when its cursor falls in a gap left by
  /// unbroadcast (audit) events: the client already applied everything up to
  /// it, and the authoritative state lives in SQLite.
  replayFrom(token, watermark = this.cursor) {
    if (token === undefined || token === null || token === '') return { reset: false, frames: [] };
    const match = /^([^:]+):(\d+)$/.exec(String(token));
    if (!match) return { reset: true, reason: 'malformed_last_event_id' };
    const [, epoch, cursorText] = match;
    if (epoch !== this.epoch) return { reset: true, reason: 'epoch_changed' };
    const cursor = Number(cursorText);
    if (cursor > watermark) return { reset: true, reason: 'cursor_out_of_window' };
    if (cursor < this.evictedThrough) return { reset: true, reason: 'cursor_out_of_window' };
    return { reset: false, frames: this.frames.filter((frame) => frame.cursor > cursor) };
  }

  send(res, event, data, id = null) {
    let frame = `event: ${event}\n`;
    if (id !== null && id !== undefined) frame += `id: ${id}\n`;
    frame += `data: ${JSON.stringify(data)}\n\n`;
    try {
      res.write(frame);
    } catch {
      this.clients.delete(res);
    }
  }

  broadcastItemChanged(item) {
    const data = {
      contractVersion: CONTRACT_VERSION,
      objectType: 'item',
      itemId: item.itemId,
      itemVersion: item.version,
      at: new Date().toISOString(),
    };
    for (const res of this.clients) this.send(res, 'item.changed', data);
  }

  /// Frozen `web-api/1` §6 task frame: `id: <epoch>:<cursor>`, monotonic within
  /// the instance. The cursor defaults to the authoritative `task_events`
  /// cursor supplied by the caller; the internal counter only keeps the stream
  /// monotonic when a caller has none.
  broadcastTaskChanged({ taskId, taskVersion, taskState, attemptExitState = null, cursor = null }) {
    const resolved = cursor === null || cursor === undefined ? this.cursor + 1 : cursor;
    this.cursor = Math.max(this.cursor, resolved);
    const data = {
      contractVersion: CONTRACT_VERSION,
      cursor: resolved,
      epoch: this.epoch,
      objectType: 'task',
      objectId: taskId,
      objectVersion: taskVersion,
      taskState,
      // Frozen web-api/2 §6: the task frame carries the typed exit state.
      attemptExitState,
      at: new Date().toISOString(),
    };
    this.frames.push({ cursor: resolved, event: 'task.changed', data });
    while (this.frames.length > this.maxFrames) {
      const dropped = this.frames.shift();
      if (dropped.cursor > this.evictedThrough) this.evictedThrough = dropped.cursor;
    }
    for (const res of this.clients) this.send(res, 'task.changed', data, `${this.epoch}:${resolved}`);
  }

  /// Candidate/source changes are in-process hints only: no `id`, no task
  /// cursor, no `task_events` row. Clients re-read after subscribing,
  /// reconnecting or receiving `stream.reset`.
  broadcastCandidateChanged({ sourceId }) {
    const data = {
      contractVersion: CONTRACT_VERSION,
      objectType: 'candidate',
      sourceId: sourceId ?? null,
      at: new Date().toISOString(),
    };
    for (const res of this.clients) this.send(res, 'candidate.changed', data);
  }

  /// Frozen `web-api/1` §5/§6 `settings.changed` frame: a committed settings
  /// change carries the same `id: <epoch>:<cursor>` discipline as task frames —
  /// the cursor is the authoritative `task_events` cursor of the settings
  /// event (the same value `/api/snapshot` reports), so the bounded replay
  /// window, the eviction boundary and reconnect legitimacy stay uniform
  /// across event types.
  broadcastSettingsChanged({ objectId, objectVersion, agentConcurrency, cursor = null }) {
    const resolved = cursor === null || cursor === undefined ? this.cursor + 1 : cursor;
    this.cursor = Math.max(this.cursor, resolved);
    const data = {
      contractVersion: CONTRACT_VERSION,
      cursor: resolved,
      epoch: this.epoch,
      objectType: 'setting',
      objectId,
      objectVersion,
      agentConcurrency,
      at: new Date().toISOString(),
    };
    this.frames.push({ cursor: resolved, event: 'settings.changed', data });
    while (this.frames.length > this.maxFrames) {
      const dropped = this.frames.shift();
      if (dropped.cursor > this.evictedThrough) this.evictedThrough = dropped.cursor;
    }
    for (const res of this.clients) this.send(res, 'settings.changed', data, `${this.epoch}:${resolved}`);
  }

  heartbeat() {
    for (const res of this.clients) {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        this.clients.delete(res);
      }
    }
  }
}
