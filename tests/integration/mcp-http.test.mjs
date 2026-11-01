import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { controlledHttp } from '../fixtures/mcp-http.mjs';

const { ManagedHttpTransport, McpClient } = await import(pathToFileURL(resolve('build/mcp-http/probe/entry.mjs')).href);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function seam(t, mode = 'json', options = {}) {
  const service = await controlledHttp({ mode, ...options }); t.after(() => service.close());
  const actions = [], errors = [];
  const deadline = Date.now() + (options.lifetime || 1500);
  const transport = new ManagedHttpTransport({ url: service.url, httpHeaders: options.headers || {}, sessionNonce: randomUUID(), runId: 'synthetic-http', deadline, totalDeadline: deadline }, { open: async value => { actions.push(['open', value]); await options.open?.(); }, end: async value => { actions.push(['end', value]); }, callGuard: () => {} });
  const client = new McpClient({ name: 'Controlled HTTP test', version: '1', capabilities: {}, requestTimeoutMs: options.softTimeout || 500 });
  client.onError(error => errors.push(error.message)); t.after(async () => { await transport.close(); await client.close(); });
  return { service, transport, client, actions, errors };
}
async function call(s, options = {}) { s.transport.grantCall('lookup', { text: 'controlled' }, Date.now() + 500); return s.client.callTool('lookup', { text: 'controlled' }, options); }

for (const mode of ['json', 'sse', 'tool-error']) test(`fixed Pi HTTP ${mode} initializes, discovers and calls with a one-shot permit`, async t => {
  const s = await seam(t, mode); await s.client.connect(s.transport); assert.equal((await s.client.listTools())[0].name, 'lookup');
  const result = await call(s); assert.equal(result.content[0].text, 'controlled-text'); assert.equal(!!result.isError, mode === 'tool-error');
  await s.client.close(); assert.equal(s.service.calls(), 1); assert.equal(s.transport.remoteClose, 'confirmed'); assert.deepEqual(s.actions.map(a => a[0]), ['open', 'end']);
  assert.ok(s.service.requests.filter(r => r.message?.method !== 'initialize').every(r => r.headers['mcp-session-id'] === 'synthetic-session'));
});
test('an ungranted or already consumed call never reaches HTTP', async t => {
  const s = await seam(t); await s.client.connect(s.transport);
  await assert.rejects(s.client.callTool('lookup', { text: 'controlled' })); assert.equal(s.service.calls(), 0);
});
test('a denied host open acknowledgement prevents every network request', async t => {
  const s = await seam(t, 'json', { open: () => { throw Error('synthetic refusal'); } }); await assert.rejects(s.client.connect(s.transport)); assert.equal(s.service.requests.length, 0);
});
test('static custom auth is explicit and unauthorized initialization cannot succeed or retry', async t => {
  const s = await seam(t, 'auth', { headers: { 'X-Controlled-Auth': 'synthetic-only-token' } }); await assert.rejects(s.client.connect(s.transport));
  assert.equal(s.service.requests.length, 1); assert.equal(s.service.requests[0].headers['x-controlled-auth'], 'synthetic-only-token'); assert.equal(s.service.calls(), 0);
});
test('static authorization and custom headers reach only the configured controlled endpoint', async t => {
  const headers = { Authorization: 'Bearer synthetic-http-token', 'X-Canary': 'synthetic-custom-token' };
  const s = await seam(t, 'json', { headers }); await s.client.connect(s.transport); await call(s); await s.client.close();
  assert.ok(s.service.requests.every(r => r.headers.authorization === headers.Authorization && r.headers['x-canary'] === headers['X-Canary']));
  assert.ok(s.service.requests.every(r => !r.headers['x-model-key']));
});
for (const method of ['POST', 'GET', 'DELETE']) for (const status of [301, 302, 303, 307, 308]) test(`${method} ${status} never follows redirects or forwards custom credentials`, async t => {
  const second = await controlledHttp(); t.after(() => second.close());
  const s = await seam(t, `redirect-${method}-${status}`, { redirect: second.url, headers: { 'X-Controlled-Auth': 'synthetic-only-token' } });
  if (method === 'POST') await assert.rejects(s.client.connect(s.transport));
  else { try { await s.client.connect(s.transport); await pause(20); } catch {} await s.client.close(); await s.transport.close(); }
  assert.ok(s.service.requests.some(r => r.method === method));
  assert.equal(second.requests.length, 0); if (method === 'DELETE') assert.equal(s.transport.remoteClose, 'unconfirmed');
});
for (const mode of ['invalid-utf8', 'wrong-id', 'batch', 'oversized']) test(`bounded HTTP rejects ${mode} before Pi can publish it`, async t => {
  const s = await seam(t, mode); await assert.rejects(s.client.connect(s.transport)); assert.equal(s.service.calls(), 0);
});
for (const mode of ['lost', 'invalid-sse', 'long-id', 'notification-flood', 'expired', 'status']) test(`HTTP ${mode} fails without resumption or tool replay`, async t => {
  const s = await seam(t, mode); await s.client.connect(s.transport); await assert.rejects(call(s)); await pause(30);
  assert.equal(s.service.calls(), 1); assert.ok(s.service.requests.filter(r => r.method === 'GET').length <= 1); assert.ok(s.service.requests.every(r => !r.headers['last-event-id'])); await assert.rejects(call(s)); assert.equal(s.service.calls(), 1);
});
for (const mode of ['no-headers', 'dribble']) test(`HTTP ${mode} cannot extend the hard deadline`, async t => {
  const s = await seam(t, mode, { lifetime: 300, softTimeout: 3000 }); const start = Date.now();
  if (mode === 'no-headers') await assert.rejects(s.client.connect(s.transport)); else { await s.client.connect(s.transport); await assert.rejects(call(s)); }
  assert.ok(Date.now() - start < 2000); await s.client.close();
});
test('cancellation after granting prevents dispatch', async t => {
  const s = await seam(t); await s.client.connect(s.transport); const controller = new AbortController(); controller.abort();
  await assert.rejects(call(s, { signal: controller.signal })); assert.equal(s.service.calls(), 0);
});
for (const mode of ['delete-unsupported', 'delete-error']) test(`${mode} distinguishes local close from remote session confirmation`, async t => {
  const s = await seam(t, mode); await s.client.connect(s.transport); await s.client.close();
  assert.equal(s.transport.closed, true); assert.equal(s.transport.remoteClose, mode === 'delete-unsupported' ? 'unsupported' : 'unconfirmed'); assert.equal(s.actions.at(-1)[0], 'end');
});

test('an active GET stream is actually cancelled and no local socket remains after close', async t => {
  const s = await seam(t, 'get-stream'); await s.client.connect(s.transport);
  for (let i = 0; i < 50 && !s.service.requests.some(r => r.method === 'GET'); i++) await pause(10);
  assert.equal(s.service.requests.filter(r => r.method === 'GET').length, 1);
  await s.client.close();
  for (let i = 0; i < 50 && s.service.sockets.size; i++) await pause(10);
  assert.equal(s.service.sockets.size, 0); assert.equal(s.transport.readers.size, 0); assert.equal(s.transport.requests.size, 0);
});
test('direct fetch cannot bypass the host open or message permit', async t => {
  const s = await seam(t); await assert.rejects(s.transport.fetch(s.service.url)); assert.equal(s.service.requests.length, 0);
  await s.client.connect(s.transport); await assert.rejects(s.transport.fetch(s.service.url, { method: 'POST', body: '{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"lookup","arguments":{}}}' })); assert.equal(s.service.calls(), 0);
});
test('late host acknowledgement after the absolute deadline cannot dispatch initialization', async t => {
  let release; const s = await seam(t, 'json', { lifetime: 150, softTimeout: 3000, open: () => new Promise(resolve => { release = resolve; }) });
  await assert.rejects(s.client.connect(s.transport)); release(); await pause(30); assert.equal(s.service.requests.length, 0);
});

for (const mode of ['json-at', 'json-over']) test(`JSON ${mode} tests the exact 1 MiB boundary with valid padded JSON`, async t => {
  const s = await seam(t, mode); if (mode === 'json-at') await s.client.connect(s.transport); else await assert.rejects(s.client.connect(s.transport));
});
for (const mode of ['total-at', 'total-over']) test(`${mode} uses the exact cumulative 2000000-byte boundary`, async t => {
  const s = await seam(t, mode); await s.client.connect(s.transport); await call(s);
  if (mode === 'total-at') { await call(s); assert.equal(s.transport.bytes, 2000000); } else await assert.rejects(call(s));
  assert.equal(s.service.calls(), 2);
});
for (const session of ['x'.repeat(1024), 'x'.repeat(1025)]) test(`session header boundary ${session.length}`, async t => {
  const s = await seam(t, 'json', { session }); if (session.length === 1024) await s.client.connect(s.transport); else await assert.rejects(s.client.connect(s.transport));
});
for (const headers of [{ Host: 'invalid' }, { 'X-Test': 'a', 'x-test': 'b' }, { 'X-Test': 'line\r\ninjection' }, { 'X-Test': 'x'.repeat(4097) }]) test(`invalid private header input is rejected before network: ${Object.keys(headers).join(',')}`, async t => {
  await assert.rejects(seam(t, 'json', { headers }));
});

test('each concurrent POST accepts only its own response ID', async t => {
  const s = await seam(t, 'cross-id'); await s.client.connect(s.transport);
  const work = ['alpha', 'beta'].map(text => { s.transport.grantCall('lookup', { text }, Date.now() + 1000); return s.client.callTool('lookup', { text }); });
  const results = await Promise.allSettled(work); assert.equal(s.service.calls(), 2); assert.ok(results.every(r => r.status === 'rejected'));
});
test('a GET stream cannot impersonate the outstanding POST response', async t => {
  const s = await seam(t, 'get-response'); await s.client.connect(s.transport);
  for (let i = 0; i < 50 && !s.service.requests.some(r => r.method === 'GET'); i++) await pause(10);
  assert.ok(s.service.requests.some(r => r.method === 'GET')); await assert.rejects(call(s)); assert.equal(s.service.calls(), 1);
});
for (const closeStatus of [200, 405, 500]) test(`a known session after malformed initialization is deleted once (${closeStatus})`, async t => {
  const s = await seam(t, 'invalid-utf8', { closeStatus }); await assert.rejects(s.client.connect(s.transport)); await s.transport.close();
  assert.equal(s.service.requests.filter(r => r.method === 'DELETE').length, 1); assert.equal(s.transport.remoteClose, closeStatus === 200 ? 'confirmed' : closeStatus === 405 ? 'unsupported' : 'unconfirmed');
});
for (const value of [' synthetic-private ', 'Bearer synthetic-private ']) test(`header normalization is rejected before dispatch (${value.length})`, async t => {
  await assert.rejects(seam(t, 'json', { headers: { 'X-Private': value } }), /MCP_HTTP_HEADER/);
});
for(const suffix of ['?auth=synthetic','?key=synthetic','?sig=synthetic','?jwt=synthetic','#'])test(`private HTTP endpoint rejects forbidden query or fragment ${suffix}`,()=>{
 assert.throws(()=>new ManagedHttpTransport({url:'http://127.0.0.1:43123/mcp'+suffix,sessionNonce:'synthetic',deadline:Date.now()+1000,totalDeadline:Date.now()+1000},{}),/MCP_CONFIG_INVALID/);
});
