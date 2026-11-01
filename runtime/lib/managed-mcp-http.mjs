import { createHash } from 'node:crypto';
import { StreamableHttpTransport } from '@sidekick/pi-http';
import { parseJsonRpcMessage } from '@sidekick/pi-jsonrpc';
import { canonicalArguments } from './mcp-tool-contract.mjs';

const FRAME_LIMIT = 1048576, TOTAL_LIMIT = 2000000;
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const reserved = new Set(['host', 'accept', 'content-type', 'content-length', 'connection', 'transfer-encoding', 'origin', 'cookie', 'set-cookie', 'proxy-authorization', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']);
const stop = code => { throw new Error(code); };
function bounded(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error('MCP_CANCELLED'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('MCP_CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export class ManagedHttpTransport {
  constructor(config, control) {
    this.config = config; this.control = control; this.url = new URL(config.url);
    if (!['http:', 'https:'].includes(this.url.protocol) || this.url.username || this.url.password || this.url.href.includes('#') || (this.url.protocol === 'http:' && !['127.0.0.1', '[::1]'].includes(this.url.hostname)) || this.url.href.length > 4096) stop('MCP_CONFIG_INVALID');
    for (const key of this.url.searchParams.keys()) { const name = key.toLowerCase().replace(/[-_]/g, ''); if (/token|secret|password|passwd|authorization|credential|apikey|signature/.test(name) || ['auth', 'key', 'sig', 'jwt'].includes(name)) stop('MCP_CONFIG_INVALID'); }
    if (!config.sessionNonce || !Number.isFinite(config.deadline) || !Number.isFinite(config.totalDeadline)) stop('MCP_PROTOCOL');
    const headers = Object.create(null), names = new Set(); let size = 0;
    for (const [name, value] of Object.entries(config.httpHeaders || {})) {
      const key = name.toLowerCase();
      if (!token.test(name) || reserved.has(key) || names.has(key) || typeof value !== 'string' || !value || value.length > 4096 || /[^\x20-\x7e\x80-\xff]/.test(value) || new Headers([[name, value]]).get(name) !== value) stop('MCP_HTTP_HEADER');
      names.add(key); size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4; headers[name] = value;
    }
    if (names.size > 64 || size > 14336) stop('MCP_HTTP_HEADER');
    this.endpointSha256 = createHash('sha256').update(this.url.href).digest('hex');
    this.nonce = config.sessionNonce; this.messages = new Set(); this.errors = new Set(); this.closes = new Set();
    this.pending = new Map(); this.outbound = new Map(); this.peer = new Set(); this.readers = new Set(); this.requests = new Set(); this.controller = new AbortController();
    this.bytes = 0; this.notifications = 0; this.remoteClose = 'not-needed'; this.closed = false; this.closing = false; this.fatal = false; this.started = false;
    this.inner = new StreamableHttpTransport({ url: this.url.href, headers, fetch: (input, init) => this.fetch(input, init), maxMessageBytes: FRAME_LIMIT, reconnect: { maxRetries: 0 } });
    this.inner.onMessage(message => {
      if (this.fatal || this.closing) return;
      if (!message.method) {
        const entry = this.pending.get(message.id);
        if (!entry?.wire || entry.delivered) { this.fail('MCP_PROTOCOL'); return; }
        entry.delivered = true;
      }
      for (const listener of this.messages) listener(message);
    });
    this.inner.onError(() => this.fail('MCP_PROTOCOL'));
    this.inner.onClose(() => this.emitClose());
  }
  onMessage(fn) { this.messages.add(fn); return () => this.messages.delete(fn); }
  onError(fn) { this.errors.add(fn); return () => this.errors.delete(fn); }
  onClose(fn) { this.closes.add(fn); return () => this.closes.delete(fn); }
  setProtocolVersion(version) { this.protocolVersion = version; this.inner.setProtocolVersion(version); }
  emitClose() { if (!this.closeEmitted) { this.closeEmitted = true; for (const listener of this.closes) listener(); } }
  guard(signal, deadline = this.config.deadline) {
    if (this.fatal || this.closing) stop(this.code || 'MCP_PROTOCOL');
    if (Date.now() >= Math.min(this.config.deadline, deadline)) stop('MCP_TIMEOUT');
    if (signal?.aborted) stop('MCP_CANCELLED');
  }
  fail(code = 'MCP_PROTOCOL') {
    if (this.fatal || this.closing) return;
    this.fatal = true; this.code = code; this.controller.abort();
    for (const listener of this.errors) listener(new Error(code));
    this.emitClose();
  }
  async start() {
    this.guard(); if (this.started) stop('MCP_PROTOCOL'); this.started = true;
    this.timer = setTimeout(() => this.fail('MCP_TIMEOUT'), Math.max(1, this.config.deadline - Date.now())); this.timer.unref?.();
    try { await bounded(this.control.open({ transport: 'http', run: this.config.runId, nonce: this.nonce, endpointSha256: this.endpointSha256 }), this.controller.signal); this.registered = true; this.guard(); await this.inner.start(); this.opened = true; }
    catch { this.fail(Date.now() >= this.config.deadline ? 'MCP_TIMEOUT' : 'MCP_PROTOCOL'); throw new Error(this.code); }
  }
  grantCall(name, args, deadline = this.config.deadline) {
    this.guard(); this.control.callGuard?.();
    if (!this.control.callGuard || this.permit) stop('MCP_PROTOCOL');
    this.permit = { name, argumentsJson: canonicalArguments(args), deadline };
  }
  async send(message, options = {}) {
    this.guard(options.signal); parseJsonRpcMessage(message);
    let permit;
    if (message.method === 'tools/call') {
      this.control.callGuard?.(); permit = this.permit; this.permit = null;
      if (!this.control.callGuard || !permit || permit.name !== message.params?.name || permit.argumentsJson !== canonicalArguments(message.params?.arguments)) stop('MCP_PROTOCOL');
      this.guard(options.signal, permit.deadline);
    } else if (message.method && !['initialize', 'tools/list', 'notifications/initialized', 'notifications/cancelled'].includes(message.method)) stop('MCP_PROTOCOL');
    else if (!message.method && !this.peer.delete(message.id)) stop('MCP_PROTOCOL');
    const body = JSON.stringify(message), entry = { method: message.method, body, signal: options.signal, deadline: Math.min(this.config.deadline, permit?.deadline ?? this.config.deadline), permit, fetched: false, wire: false, delivered: false, isRequest: !!message.method && message.id !== undefined };
    if (entry.isRequest) {
      if (this.pending.size >= 512 || this.pending.has(message.id)) stop('MCP_PROTOCOL');
      this.pending.set(message.id, entry);
    }
    if (this.outbound.has(body)) stop('MCP_PROTOCOL'); this.outbound.set(body, entry);
    try { await this.inner.send(message, options); }
    catch { this.fail(Date.now() >= this.config.deadline ? 'MCP_TIMEOUT' : options.signal?.aborted ? 'MCP_CANCELLED' : this.code || 'MCP_PROTOCOL'); throw new Error(this.code); }
    finally { this.outbound.delete(body); }
  }
  observe(value, context) {
    const message = parseJsonRpcMessage(value);
    if (!message.method) {
      const entry = this.pending.get(message.id);
      if (!entry || entry !== context || !context.isRequest || entry.wire || entry.signal?.aborted || Date.now() >= entry.deadline) stop('MCP_PROTOCOL');
      entry.wire = true;
    } else if (message.id !== undefined) { if (this.peer.size >= 64 || this.peer.has(message.id)) stop('MCP_PROTOCOL'); this.peer.add(message.id); }
    else if (++this.notifications > 64) stop('MCP_PROTOCOL');
  }
  session(response, entry) {
    let size = 0; for (const [name, value] of response.headers) size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    const id = response.headers.get('mcp-session-id');
    if (id !== null) this.remoteClose = 'unconfirmed';
    if (size > 16384 || (id !== null && (!/^[\x21-\x7e]{1,1024}$/.test(id) || (this.sessionId && this.sessionId !== id) || (!this.sessionId && entry?.method !== 'initialize')))) stop('MCP_HTTP_SESSION');
    if (id && !this.sessionId) { this.sessionId = id; this.control.sensitive?.(id); }
  }
  async fetch(input, init = {}) {
    const method = init.method || 'GET', closing = method === 'DELETE'; let entry;
    if (String(input) !== this.url.href || !['GET', 'POST', 'DELETE'].includes(method)) stop('MCP_PROTOCOL');
    if (closing) { if (!this.closing || !this.sessionId || this.deleteAttempted) stop('MCP_PROTOCOL'); this.deleteAttempted = true; this.remoteClose = 'unconfirmed'; }
    else { this.guard(); if (!this.opened) stop('MCP_PROTOCOL'); }
    if (method === 'POST') {
      entry = this.outbound.get(init.body);
      if (!entry || entry.fetched) stop('MCP_PROTOCOL');
      this.guard(entry.signal, entry.deadline); if (entry.permit) this.control.callGuard(); entry.fetched = true; this.outbound.delete(init.body);
    }
    const headers = new Headers(init.headers); headers.set('connection', 'close');
    let headerBytes = 0; for (const [name, value] of headers) headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    if (headerBytes > 16384) stop('MCP_HTTP_HEADER');
    const deadline = closing ? Math.min(this.config.totalDeadline, Date.now() + 1000) : entry?.deadline ?? this.config.deadline;
    if (Date.now() >= deadline) { if (closing) return new Response(null, { status: 408 }); stop('MCP_TIMEOUT'); }
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), Math.max(1, deadline - Date.now()));
    const signal = AbortSignal.any([timeout.signal, ...(init.signal ? [init.signal] : []), ...(!closing ? [this.controller.signal] : []), ...(entry?.signal ? [entry.signal] : [])]);
    const context = { entry, timeout, timer, signal, deadline, released: false };
    const release = () => { if (!context.released) { context.released = true; clearTimeout(timer); this.requests.delete(context); } };
    this.requests.add(context);
    try {
      if (!closing) { this.guard(entry?.signal, deadline); if (entry?.permit) this.control.callGuard(); }
      const response = await globalThis.fetch(this.url, { ...init, headers, redirect: 'manual', signal });
      if (closing) { this.remoteClose = response.status >= 200 && response.status < 300 ? 'confirmed' : response.status === 405 ? 'unsupported' : 'unconfirmed'; await response.body?.cancel(); release(); return new Response(null, { status: response.status }); }
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); stop('MCP_HTTP_REDIRECT'); }
      if (method === 'GET' && response.status === 405) { await response.body?.cancel(); release(); return new Response(null, { status: 405 }); }
      if (!response.ok) { await response.body?.cancel(); stop([401, 403].includes(response.status) ? 'MCP_HTTP_AUTH' : response.status === 404 ? 'MCP_HTTP_SESSION' : 'MCP_HTTP_STATUS'); }
      this.session(response, entry);
      if (method === 'POST' && !entry.isRequest) { await response.body?.cancel(); release(); return new Response(null, { status: response.status }); }
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (!response.body || !['application/json', 'text/event-stream'].includes(type) || (method === 'GET' && type !== 'text/event-stream')) { await response.body?.cancel(); stop('MCP_PROTOCOL'); }
      if (type === 'application/json') {
        const reader = response.body.getReader(); this.readers.add(reader); const chunks = []; let bytes = 0;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; this.bytes += value.length; if (bytes > FRAME_LIMIT || this.bytes > TOTAL_LIMIT) stop('MCP_HTTP_LIMIT'); chunks.push(value); } }
        finally { this.readers.delete(reader); await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const raw = Buffer.concat(chunks); this.observe(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), entry); release();
        return new Response(raw, { status: response.status, headers: response.headers });
      }
      const reader = response.body.getReader(); this.readers.add(reader); const decoder = new TextDecoder('utf-8', { fatal: true });
      let buffer = '', data = [], event, eventBytes = 0;
      const dispatch = () => { if (data.length && (!event || event === 'message') && data.join('\n').trim()) this.observe(JSON.parse(data.join('\n')), entry); data = []; event = undefined; eventBytes = 0; };
      const line = value => {
        value = value.endsWith('\r') ? value.slice(0, -1) : value;
        if (!value) { dispatch(); return; }
        eventBytes += Buffer.byteLength(value) + 1; if (eventBytes > FRAME_LIMIT) stop('MCP_HTTP_LIMIT');
        const colon = value.indexOf(':'), field = colon < 0 ? value : value.slice(0, colon); let item = colon < 0 ? '' : value.slice(colon + 1); if (item.startsWith(' ')) item = item.slice(1);
        if (field === 'id' && (Buffer.byteLength(item) > 256 || /[\x00-\x1f\x7f]/.test(item))) stop('MCP_HTTP_SESSION');
        if (field === 'data') data.push(item); if (field === 'event') event = item;
      };
      const finish = () => { this.readers.delete(reader); release(); };
      const body = new ReadableStream({
        pull: async output => {
          try {
            const { value, done } = await reader.read();
            if (done) { buffer += decoder.decode(); if (buffer) line(buffer); dispatch(); finish(); reader.releaseLock(); output.close(); return; }
            this.bytes += value.length; if (this.bytes > TOTAL_LIMIT) stop('MCP_HTTP_LIMIT'); buffer += decoder.decode(value, { stream: true });
            let newline; while ((newline = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
            if (Buffer.byteLength(buffer) > FRAME_LIMIT) stop('MCP_HTTP_LIMIT'); output.enqueue(value);
          } catch { finish(); await reader.cancel().catch(() => {}); if (!this.closing && !entry?.delivered) this.fail(Date.now() >= deadline ? 'MCP_TIMEOUT' : 'MCP_PROTOCOL'); output.error(new Error(this.code || 'MCP_PROTOCOL')); }
        },
        cancel: async () => { finish(); await reader.cancel().catch(() => {}); },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      release();
      if (closing) return new Response(null, { status: 500 });
      this.fail(Date.now() >= deadline ? 'MCP_TIMEOUT' : ['MCP_HTTP_REDIRECT', 'MCP_HTTP_AUTH', 'MCP_HTTP_STATUS', 'MCP_HTTP_SESSION', 'MCP_HTTP_LIMIT'].includes(error?.message) ? error.message : 'MCP_PROTOCOL');
      throw new Error(this.code || 'MCP_PROTOCOL');
    }
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true; clearTimeout(this.timer); this.controller.abort(); this.permit = null;
    this.closePromise = (async () => {
      for (const context of this.requests) if (!context.closing) context.timeout.abort();
      await Promise.allSettled([...this.readers].map(reader => reader.cancel()));
      await this.inner.close();
      if (this.sessionId && !this.deleteAttempted) {
        const headers = new Headers(this.inner.options.headers); headers.set('mcp-session-id', this.sessionId);
        if (this.protocolVersion) headers.set('mcp-protocol-version', this.protocolVersion);
        await this.fetch(this.url.href, { method: 'DELETE', headers });
      }
      for (const context of this.requests) { clearTimeout(context.timer); context.timeout.abort(); } this.requests.clear(); this.readers.clear();
      this.closed = true; if (this.registered) await this.control.end({ transport: 'http', run: this.config.runId, nonce: this.nonce, endpointSha256: this.endpointSha256, remoteClose: this.remoteClose });
    })();
    return this.closePromise;
  }
}
