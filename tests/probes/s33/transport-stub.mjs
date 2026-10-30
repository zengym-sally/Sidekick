export class McpAbortError extends Error {}
export class McpConnectionClosedError extends Error {}
export class StdioTransport {
  static latest;
  pid = 424242;
  listeners = [];
  constructor() { StdioTransport.latest = this; }
  async start() {}
  async send() {}
  async close() { this.signalClose(); }
  onMessage() { return () => {}; }
  onError() { return () => {}; }
  onClose(listener) { this.listeners.push(listener); return () => {}; }
  signalClose() { for (const listener of this.listeners) listener(); }
}
