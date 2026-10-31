import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const evidence = resolve('build/p6-native-20261101/fetch-implementation/cases');
const fixtureScript = await realpath(resolve('tests/fixtures/mcp-trial.mjs'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ownerCommand = pid => execFileSync('/bin/ps', ['-p', String(pid), '-o', 'uid=,lstart=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const body = JSON.stringify({ model: 'p6-synthetic', stream: true, messages: [{ role: 'user', content: '{}' }] });
const nativeFetch = async (pin, options) => (await import('../../runtime/lib/native-model-fetch.mjs')).createNativeModelFetch(pin, options);
const request = (owner, overrides = {}) => [owner.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, ...overrides }];

async function records(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function waitFor(check, label) {
  const deadline = Date.now() + 5000;
  while (!(await check())) { assert.ok(Date.now() < deadline, label); await pause(10); }
}

async function directory() {
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  return realpath(await mkdtemp(join(evidence, 'case-')));
}

async function startChild(t, script, args, record, port = 0) {
  const nonce = randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [script, ...args(nonce, port)], { env: { PATH: '/usr/bin:/bin', P6_LABEL: 'native-fetch-test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  };
  t.after(stop);
  await waitFor(() => {
    assert.equal(child.exitCode, null, `model owner exited before ready: ${stderr}`);
    return stdout.includes('\n');
  }, 'model owner did not become ready');
  const base = stdout.trim().split('\n')[0], url = `${base}/chat/completions`;
  const pin = { port: Number(new URL(base).port), pid: child.pid, command: ownerCommand(child.pid), nonce, script };
  return { child, pin, url, record, stop, notes: () => records(record), stderr: () => stderr };
}

const serverSource = `import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
const [record, mode, nonce, target, port] = process.argv.slice(2);
const note = value => appendFileSync(record, JSON.stringify(value) + '\\n', { mode: 0o600 });
const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  note({ type: 'http', method: request.method, url: request.url, bytes: Buffer.concat(chunks).length, authorized: request.headers.authorization === 'Bearer p6-synthetic-token', nonce: request.headers['x-sidekick-native-nonce'] === nonce });
  if (mode.startsWith('redirect-')) { response.writeHead(Number(mode.slice(9)), { location: target }); response.end(); }
  else if (mode === 'drop') request.socket.destroy();
  else if (mode === 'hold') { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders(); response.write('data: '); }
  else if (mode === 'overlimit') { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('x'.repeat(1000000)); response.end('x'.repeat(1000001)); }
  else if (mode === 'declared-overlimit') { response.writeHead(200, { 'content-length': '2000001' }); response.end('x'); }
  else if (mode === 'atlimit') response.end('x'.repeat(2000000));
  else response.end('data: {"ok":true}\\n\\ndata: [DONE]\\n\\n');
});
server.on('connection', socket => { note({ type: 'connection' }); socket.on('close', () => note({ type: 'closed' })); });
server.listen(Number(port), '127.0.0.1', () => process.stdout.write('http://127.0.0.1:' + server.address().port + '/v1\\n'));
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
`;

async function owner(t, mode = 'normal', target = '', port = 0) {
  const base = await directory(), script = join(base, 'model-owner.mjs'), record = join(base, 'requests.ndjson');
  await writeFile(script, serverSource, { mode: 0o600, flag: 'wx' });
  return startChild(t, script, (nonce, selectedPort) => [record, mode, nonce, target, String(selectedPort)], record, port);
}

async function fixture(t, nonceEnabled = true) {
  const base = await directory(), record = join(base, 'fixture.ndjson');
  return startChild(t, fixtureScript, nonce => ['model', record, 'normal', join(base, 'marker'), ...(nonceEnabled ? [nonce] : [])], record);
}

const count = (notes, type) => notes.filter(note => note.type === type).length;
async function noHttp(...owners) { for (const current of owners) assert.equal(count(await current.notes(), 'http'), 0); }

test('native fixture rejects missing or mismatched synthetic credentials and nonce before accepting model HTTP', async t => {
  const controlled = await fixture(t);
  for (const headers of [{}, { authorization: 'Bearer wrong', 'x-sidekick-native-nonce': controlled.pin.nonce }, { authorization: 'Bearer p6-synthetic-token', 'x-sidekick-native-nonce': '0'.repeat(48) }]) {
    assert.equal((await fetch(...request(controlled, { headers }))).status, 403);
  }
  assert.equal(count(await controlled.notes(), 'model'), 0);
});

test('owned fixture accepts one actual HTTP request through Request input with fixed synthetic headers', async t => {
  const controlled = await fixture(t), fetchOwned = await nativeFetch(controlled.pin);
  const response = await fetchOwned(new Request(...request(controlled, { headers: { authorization: 'Bearer ignored-input', 'x-sidekick-native-nonce': 'wrong', 'content-type': 'application/json' } })));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(await response.text(), /data: \[DONE\]/);
  assert.equal(count(await controlled.notes(), 'model'), 1);
});

test('URL input uses exactly one owned TCP connection and preserves the public Response stream', async t => {
  const controlled = await owner(t), fetchOwned = await nativeFetch(controlled.pin);
  const response = await fetchOwned(new URL(controlled.url), request(controlled)[1]);
  assert.match(await response.text(), /data: \[DONE\]/);
  const notes = await controlled.notes();
  assert.equal(count(notes, 'connection'), 1);
  assert.equal(count(notes, 'http'), 1);
  assert.deepEqual(notes.find(note => note.type === 'http'), { type: 'http', method: 'POST', url: '/v1/chat/completions', bytes: Buffer.byteLength(body), authorized: true, nonce: true });
});

test('legacy fixture remains available without the native nonce argument', async t => {
  const controlled = await fixture(t, false);
  assert.equal((await fetch(...request(controlled))).status, 200);
  assert.equal(count(await controlled.notes(), 'model'), 1);
});

test('fixture PID notes expose the synthetic cwd and label and detect a leaked P6 token', async t => {
  const base = await directory(), record = join(base, 'pid.ndjson');
  const child = spawn(process.execPath, [fixtureScript, 'child', record], { cwd: base, env: { PATH: '/usr/bin:/bin', P6_LABEL: 'native-fetch-pid-note', CONTROLLED_KEY: 'p6-synthetic-token' }, stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } });
  await waitFor(async () => (await records(record)).length === 1, 'synthetic child did not record its PID');
  assert.deepEqual((await records(record))[0], { type: 'pid', role: 'child', pid: child.pid, cwd: base, p6Label: 'native-fetch-pid-note', modelKeyPresent: true });
});

test('mutating the input pin cannot change the immutable fetch owner', async t => {
  const controlled = await owner(t), external = await owner(t), pin = { ...controlled.pin }, fetchOwned = await nativeFetch(pin);
  Object.assign(pin, external.pin);
  assert.match(await (await fetchOwned(...request(controlled))).text(), /data: \[DONE\]/);
  await noHttp(external);
  assert.equal(count(await external.notes(), 'connection'), 0);
});

test('malformed or noncanonical owner pins are rejected before opening a connection', async t => {
  const controlled = await owner(t);
  for (const changed of [{ pid: 1 }, { pid: '2' }, { port: 80 }, { port: 65536 }, { nonce: 'a'.repeat(47) }, { nonce: 'G'.repeat(48) }, { command: '' }, { command: controlled.pin.command.replace(controlled.pin.nonce, 'wrong') }, { script: controlled.pin.script.replace('/model-owner.mjs', '/./model-owner.mjs') }, { command: controlled.pin.command.replace(/^\d+/, String(process.getuid() + 1)) }]) {
    await assert.rejects(() => nativeFetch({ ...controlled.pin, ...changed }));
  }
  assert.equal(count(await controlled.notes(), 'connection'), 0);
});

test('only the pinned loopback authority and exact POST path can receive bytes', async t => {
  const controlled = await owner(t), external = await owner(t), fetchOwned = await nativeFetch(controlled.pin);
  for (const url of [external.url, controlled.url.replace('127.0.0.1', 'localhost'), `${controlled.url}?extra=1`, `${controlled.url}#fragment`, controlled.url.replace('/chat/completions', '/other')]) await assert.rejects(() => fetchOwned(url, request(controlled)[1]));
  await assert.rejects(() => fetchOwned(controlled.url, { method: 'GET' }));
  await noHttp(controlled, external);
  assert.equal(count(await controlled.notes(), 'connection'), 0);
  assert.equal(count(await external.notes(), 'connection'), 0);
});

test('an occupied port owned by a different child receives no HTTP headers or body', async t => {
  const controlled = await owner(t), occupant = await owner(t), fetchOwned = await nativeFetch({ ...controlled.pin, port: occupant.pin.port });
  await assert.rejects(() => fetchOwned(...request(occupant)));
  await noHttp(controlled, occupant);
  assert.equal(count(await occupant.notes(), 'connection'), 1);
});

test('a child without a ready listener cannot receive model HTTP', async t => {
  const controlled = await owner(t), unused = createServer();
  await new Promise(resolve => unused.listen(0, '127.0.0.1', resolve));
  const port = unused.address().port;
  await new Promise(resolve => unused.close(resolve));
  const fetchOwned = await nativeFetch({ ...controlled.pin, port });
  await assert.rejects(() => fetchOwned(`http://127.0.0.1:${port}/v1/chat/completions`, request(controlled)[1]));
  await noHttp(controlled);
});

test('an exited owner cannot be used for model HTTP', async t => {
  const controlled = await owner(t), fetchOwned = await nativeFetch(controlled.pin);
  await controlled.stop();
  await assert.rejects(() => fetchOwned(...request(controlled)));
  await noHttp(controlled);
});

test('a same-port replacement listener is rejected using the original owner pin', async t => {
  const controlled = await owner(t), fetchOwned = await nativeFetch(controlled.pin);
  await controlled.stop();
  const replacement = await owner(t, 'normal', '', controlled.pin.port);
  await assert.rejects(() => fetchOwned(...request(replacement)));
  await noHttp(controlled, replacement);
  assert.equal(count(await replacement.notes(), 'connection'), 1);
});

test('a changed ps launch identity is rejected after connection and before HTTP', async t => {
  const controlled = await owner(t), fetchOwned = await nativeFetch({ ...controlled.pin, command: `${controlled.pin.command} changed-launch-identity` });
  await assert.rejects(() => fetchOwned(...request(controlled)));
  await noHttp(controlled);
  assert.equal(count(await controlled.notes(), 'connection'), 1);
});

test('owner loss after TCP connect cannot send HTTP or reconnect to a replacement', async t => {
  const controlled = await owner(t); let replacement;
  const fetchOwned = await nativeFetch(controlled.pin, { afterConnect: async () => { await controlled.stop(); replacement = await owner(t, 'normal', '', controlled.pin.port); } });
  await assert.rejects(() => fetchOwned(...request(controlled)));
  assert.ok(replacement);
  await noHttp(controlled, replacement);
  assert.equal(count(await controlled.notes(), 'connection'), 1);
  assert.equal(count(await replacement.notes(), 'connection'), 0);
});

test('every 3xx response is rejected and an external redirect target receives zero HTTP', async t => {
  const external = await owner(t);
  for (const status of [300, 301, 302, 303, 304, 305, 307, 308, 399]) {
    const controlled = await owner(t, `redirect-${status}`, external.url), fetchOwned = await nativeFetch(controlled.pin);
    await assert.rejects(() => fetchOwned(...request(controlled)), /REDIRECT/);
    assert.equal(count(await controlled.notes(), 'http'), 1);
    assert.equal(count(await controlled.notes(), 'connection'), 1);
  }
  await noHttp(external);
  assert.equal(count(await external.notes(), 'connection'), 0);
});

test('the input byte cap rejects multibyte bodies before any TCP connection', async t => {
  const controlled = await owner(t), fetchOwned = await nativeFetch(controlled.pin);
  await assert.rejects(() => fetchOwned(...request(controlled, { body: '合'.repeat(666667) })), /LIMIT/);
  assert.equal(count(await controlled.notes(), 'connection'), 0);
});

test('the response byte cap allows exactly 2000000 bytes', async t => {
  const controlled = await owner(t, 'atlimit'), fetchOwned = await nativeFetch(controlled.pin);
  assert.equal((await (await fetchOwned(...request(controlled))).arrayBuffer()).byteLength, 2000000);
  assert.equal(count(await controlled.notes(), 'http'), 1);
});

test('streamed and declared oversized responses fail and release the only socket', async t => {
  for (const mode of ['overlimit', 'declared-overlimit']) {
    const controlled = await owner(t, mode), fetchOwned = await nativeFetch(controlled.pin);
    await assert.rejects(async () => { const response = await fetchOwned(...request(controlled)); await response.text(); }, /LIMIT/);
    await waitFor(async () => count(await controlled.notes(), 'closed') === 1, 'oversized response socket remained open');
    assert.equal(count(await controlled.notes(), 'connection'), 1);
  }
});

test('abort before connection sends no HTTP', async t => {
  const controlled = await owner(t), fetchOwned = await nativeFetch(controlled.pin), controller = new AbortController();
  controller.abort();
  await assert.rejects(() => fetchOwned(...request(controlled, { signal: controller.signal })), { name: 'AbortError' });
  assert.equal(count(await controlled.notes(), 'connection'), 0);
});

test('abort while reading an unfinished input body cancels it before any connection', async t => {
  const controlled = await owner(t), fetchOwned = await nativeFetch(controlled.pin), controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({ start(writer) { writer.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
  const pending = fetchOwned(...request(controlled, { body: stream, duplex: 'half', signal: controller.signal }));
  await pause(20);
  controller.abort();
  await assert.rejects(() => pending, { name: 'AbortError' });
  await waitFor(() => cancelled, 'aborted request body remained open');
  assert.equal(count(await controlled.notes(), 'connection'), 0);
});

test('abort after TCP connection closes the socket before HTTP ownership consumption', async t => {
  const controlled = await owner(t), controller = new AbortController();
  const fetchOwned = await nativeFetch(controlled.pin, { afterConnect: () => controller.abort() });
  await assert.rejects(() => fetchOwned(...request(controlled, { signal: controller.signal })), { name: 'AbortError' });
  await waitFor(async () => count(await controlled.notes(), 'closed') === 1, 'aborted connected socket remained open');
  await noHttp(controlled);
  assert.equal(count(await controlled.notes(), 'connection'), 1);
});

test('abort during SSE consumption releases the socket and errors the Response body', async t => {
  const controlled = await owner(t, 'hold'), fetchOwned = await nativeFetch(controlled.pin), controller = new AbortController();
  const response = await fetchOwned(...request(controlled, { signal: controller.signal })), reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: ');
  controller.abort();
  await assert.rejects(() => reader.read(), { name: 'AbortError' });
  await waitFor(async () => count(await controlled.notes(), 'closed') === 1, 'aborted SSE socket remained open');
});

test('timeout and transport error release their one socket without retry', async t => {
  for (const mode of ['hold', 'drop']) {
    const controlled = await owner(t, mode), fetchOwned = await nativeFetch(controlled.pin, { timeoutMs: 500 });
    await assert.rejects(async () => { const response = await fetchOwned(...request(controlled)); await response.text(); });
    await waitFor(async () => count(await controlled.notes(), 'closed') === 1, 'failed model socket remained open');
    assert.equal(count(await controlled.notes(), 'connection'), 1);
    assert.equal(count(await controlled.notes(), 'http'), 1);
  }
});

test('a timeout reached during a synchronous connection checkpoint cannot send HTTP', async t => {
  const controlled = await owner(t); let checkpoint = false;
  const fetchOwned = await nativeFetch(controlled.pin, { timeoutMs: 100, afterConnect: () => { checkpoint = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); } });
  await assert.rejects(() => fetchOwned(...request(controlled)), { name: 'TimeoutError' });
  assert.equal(checkpoint, true);
  await waitFor(async () => count(await controlled.notes(), 'closed') === 1, 'timed out connected socket remained open');
  await noHttp(controlled);
  assert.equal(count(await controlled.notes(), 'connection'), 1);
});

test('cancelling a Response stream closes the owned socket', async t => {
  const controlled = await owner(t, 'hold'), fetchOwned = await nativeFetch(controlled.pin);
  const response = await fetchOwned(...request(controlled));
  await response.body.cancel();
  await waitFor(async () => count(await controlled.notes(), 'closed') === 1, 'cancelled response socket remained open');
});

test('ordinary global fetch retains its existing redirect behavior', async t => {
  const external = await owner(t), controlled = await owner(t, 'redirect-302', external.url);
  assert.equal((await fetch(...request(controlled))).status, 200);
  assert.equal(count(await external.notes(), 'http'), 1);
});
