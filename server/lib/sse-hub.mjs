//! Server-sent events hub.
//!
//! Task frames keep their frozen cursor/epoch semantics. Item changes are
//! in-process hints only: no `id` line, no task cursor, no `task_events` row.
//! Clients re-read the manual-item endpoints after subscribing, reconnecting
//! or receiving `stream.reset` (W1 contract §5, M2).

import { randomBytes } from 'node:crypto';
import { CONTRACT_VERSION } from './manual-items-service.mjs';

export class SseHub {
  constructor({ heartbeatMs = 15000 } = {}) {
    this.heartbeatMs = heartbeatMs;
    this.epoch = `inst_${randomBytes(6).toString('hex')}`;
    this.clients = new Set();
    this.timer = null;
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

  addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    this.send(res, 'stream.ready', {
      contractVersion: CONTRACT_VERSION,
      epoch: this.epoch,
      cursor: 0,
    });
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
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
