export class McpControl {
  constructor({ runId, hostNonce, deadline, send }) {
    this.runId = runId; this.hostNonce = hostNonce; this.deadline = deadline; this.send = send;
    this.pending = new Map(); this.sequence = 0; this.closed = false;
  }
  request(action, body, deadline = this.deadline) {
    if (this.closed && action !== 'end') return Promise.reject(new Error('MCP_PROTOCOL'));
    deadline = Math.min(deadline, Date.now() + 10000);
    if (Date.now() >= deadline) return Promise.reject(new Error('MCP_PROTOCOL'));
    const requestId = `mcp-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); this.pending.delete(requestId); reject(error); };
      const timer = setTimeout(() => finish(new Error('MCP_PROTOCOL')), Math.max(1, Math.min(10000, deadline - Date.now())));
      const expected = Object.fromEntries(['serverId', 'callId', 'nonce', 'guardian', 'keeper', 'configurationRevision'].filter(key => body[key] !== undefined).map(key => [key, body[key]]));
      this.pending.set(requestId, { action, expected, deadline, resolve: frame => { clearTimeout(timer); resolve(frame); }, reject: finish });
      try { Promise.resolve(this.send({ type: 'mcp', action, ...body, requestId, runId: this.runId, hostNonce: this.hostNonce })).catch(finish); }
      catch { finish(new Error('MCP_PROTOCOL')); }
    });
  }
  receive(frame) {
    const item = this.pending.get(frame.requestId);
    if (frame.type !== 'mcp_ack' || frame.runId !== this.runId || frame.hostNonce !== this.hostNonce || !item || frame.action !== item.action || Object.entries(item.expected).some(([key, value]) => frame[key] !== value)) return false;
    if (Date.now() >= item.deadline) { item.reject(new Error('MCP_PROTOCOL')); return false; }
    this.pending.delete(frame.requestId); item.resolve(frame); return true;
  }
  close() {
    this.closed = true;
    for (const item of [...this.pending.values()]) item.reject(new Error('MCP_PROTOCOL'));
  }
}
