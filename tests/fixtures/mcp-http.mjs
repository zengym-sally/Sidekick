import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function controlledHttp({ mode = 'json', headers = {}, redirect = '', session = 'synthetic-session', closeStatus, closeDelay = 0, listDelay = 0, note = () => {} } = {}) {
  const requests = [], sockets = new Set(), timers = new Set(), pending = []; let calls = 0, responseBytes = 0, getStream;
  const server = createServer(async (request, response) => {
    const event = { method: request.method, url: request.url, headers: request.headers, message: null };
    requests.push(event);
    request.on('error', () => {}); response.on('error', () => {});
    if (request.headers.origin && request.headers.origin !== 'http://127.0.0.1') { response.writeHead(403); response.end(); return; }
    const redirection = new RegExp(`^redirect-${request.method}-(301|302|303|307|308)$`).exec(mode);
    if (redirection) { response.writeHead(Number(redirection[1]), { location: redirect }); response.end(); return; }
    if (Object.entries(headers).some(([key, value]) => request.headers[key.toLowerCase()] !== value) || mode === 'auth' || mode === 'freeze-header' && request.headers['x-controlled-secret'] !== 'synthetic-first') { response.writeHead(401); response.end('synthetic private body'); return; }
    if (request.method === 'DELETE') {
      if (closeDelay === null) return;
      if (closeDelay) await new Promise(resolve => { const timer = setTimeout(() => { timers.delete(timer); resolve(); }, closeDelay); timers.add(timer); });
      response.writeHead(closeStatus || (mode === 'delete-error' ? 500 : mode === 'delete-unsupported' ? 405 : 200)); response.end(); return;
    }
    if (request.method === 'GET') {
      if (['get-stream', 'get-response', 'wait-list'].includes(mode)) { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders(); getStream = response; return; }
      response.writeHead(405); response.end(); return;
    }
    let body = '';
    for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 100000) { response.writeHead(413); response.end(); return; } }
    const message = JSON.parse(body); event.message = message; note({ method: message.method });
    if (message.method === 'tools/list' && listDelay) await new Promise(resolve => { const timer = setTimeout(() => { timers.delete(timer); resolve(); }, listDelay); timers.add(timer); });
    if (message.method === 'tools/call') { calls++; note({ type: 'call', count: calls }); }
    const callMode = mode === 'after-first-lost' && calls > 1 ? 'lost' : mode;
    if (message.method === 'tools/call' && mode === 'cross-id') {
      pending.push({ message, response });
      if (pending.length === 2) for (let i = 0; i < 2; i++) { pending[i].response.writeHead(200, { 'content-type': 'application/json' }); pending[i].response.end(JSON.stringify({ jsonrpc: '2.0', id: pending[1 - i].message.id, result: { content: [{ type: 'text', text: pending[i].message.params.arguments.text }] } })); }
      return;
    }
    if (message.method === 'tools/call' && mode === 'get-response') {
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders();
      getStream.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'wrong-stream' }] } })}\n\n`); return;
    }
    if (!Object.hasOwn(message, 'id')) { response.writeHead(202); response.end(); return; }
    if (mode === 'no-headers') return;
    if (mode === 'wait-list' && message.method === 'tools/list') { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders(); return; }
    if (mode === 'status' && message.method === 'tools/call') { response.writeHead(500); response.end(); return; }
    if (mode === 'expired' && message.method === 'tools/call') { response.writeHead(404); response.end(); return; }
    const result = message.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'controlled-http', version: '1' } } : message.method === 'tools/list' ? { tools: [{ name: 'lookup', description: mode === 'private-catalog' ? request.headers['x-controlled-secret'] : 'Controlled HTTP lookup', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] } : { content: [{ type: 'text', text: mode === 'private-header' ? request.headers['x-controlled-secret'] : mode === 'private-session' ? session : 'controlled-text' }], ...(mode === 'tool-error' ? { isError: true } : {}) };
    let json = JSON.stringify({ jsonrpc: '2.0', id: mode === 'wrong-id' ? 'foreign' : message.id, result });
    if (mode === 'json-at' || mode === 'json-over') json += ' '.repeat(1048576 + (mode === 'json-over' ? 1 : 0) - Buffer.byteLength(json));
    if (['total-at', 'total-over'].includes(mode) && message.method === 'tools/call') json += ' '.repeat((calls === 1 ? 1000000 : 2000000 - responseBytes + (mode === 'total-over' ? 1 : 0)) - Buffer.byteLength(json));
    responseBytes += Buffer.byteLength(json);
    if (mode === 'oversized') json = ' '.repeat(1048577);
    if (mode === 'batch') json = `[${json}]`;
    const isSse = mode === 'sse-all' || ['sse', 'lost', 'dribble', 'late', 'invalid-sse', 'long-id', 'notification-flood', 'list-changed'].includes(callMode) && message.method === 'tools/call';
    event.responseType = isSse ? 'text/event-stream' : 'application/json';
    response.writeHead(200, { 'content-type': isSse ? 'text/event-stream' : 'application/json', ...(session ? { 'mcp-session-id': session } : {}) });
    if (isSse) {
      if (callMode === 'lost') { response.end('id: synthetic-cursor\ndata:\n\n'); return; }
      if (mode === 'list-changed') { response.end(`data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\ndata: ${json}\n\n`); return; }
      if (mode === 'invalid-sse') { response.end(Buffer.from([100, 97, 116, 97, 58, 32, 255, 10, 10])); return; }
      if (mode === 'long-id') { response.end(`id: ${'x'.repeat(257)}\ndata: ${json}\n\n`); return; }
      if (mode === 'notification-flood') { response.end(Array.from({ length: 65 }, () => 'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n').join('')); return; }
      if (mode === 'dribble') { response.flushHeaders(); const timer = setInterval(() => response.write(': progress\n\n'), 20); timers.add(timer); response.on('close', () => { clearInterval(timer); timers.delete(timer); }); return; }
      if (mode === 'late') { response.flushHeaders(); const timer = setTimeout(() => { timers.delete(timer); note({ type: 'late_attempt', closed: response.destroyed }); response.end(`data: ${json}\n\n`); }, 1600); timers.add(timer); return; }
      response.end(`id: synthetic-event-${message.id}\ndata: ${json}\n\n`); return;
    }
    if (mode === 'invalid-utf8') { response.end(Buffer.from([255])); return; }
    response.end(json);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests, sockets, calls: () => calls, close: async () => { for (const timer of timers) clearInterval(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [record, mode = 'json'] = process.argv.slice(2);
  const service = await controlledHttp({ mode, note: value => appendFileSync(record, JSON.stringify(value) + '\n', { mode: 0o600 }) });
  process.stdout.write(service.url + '\n');
  process.on('SIGTERM', () => { void service.close().then(() => process.exit(0)); });
}
