import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { Agent, request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';

const byteLimit = 2000000;
const failure = code => new Error(`NATIVE_MODEL_FETCH_${code}`);

function ownerPin(value) {
  if (!value || !Number.isInteger(value.pid) || value.pid <= 1 || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || typeof value.nonce !== 'string' || !/^[0-9a-f]{48}$/.test(value.nonce) || typeof value.script !== 'string' || !isAbsolute(value.script) || realpathSync(value.script) !== value.script || typeof value.command !== 'string' || value.command.trim() !== value.command || !value.command.includes(value.script) || !value.command.includes(value.nonce) || Number(/^(\d+)\s/.exec(value.command)?.[1]) !== process.getuid()) throw failure('OWNER_PIN');
  return Object.freeze({ pid: value.pid, port: value.port, nonce: value.nonce, script: value.script, command: value.command });
}

function verifyOwner(pin) {
  const options = { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 1000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    const command = execFileSync('/bin/ps', ['-p', String(pin.pid), '-o', 'uid=,lstart=,command='], options).trim();
    if (command !== pin.command || !command.includes(pin.script) || !command.includes(pin.nonce)) throw failure('OWNER');
    const listeners = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pin.pid), `-iTCP@127.0.0.1:${pin.port}`, '-sTCP:LISTEN', '-Fp'], options).trim().split('\n').filter(line => line.startsWith('p'));
    if (listeners.length !== 1 || listeners[0] !== `p${pin.pid}`) throw failure('OWNER');
  } catch { throw failure('OWNER'); }
}

export function createNativeModelFetch(value, { timeoutMs = 30000, afterConnect } = {}) {
  const pin = ownerPin(value), target = `http://127.0.0.1:${pin.port}/v1/chat/completions`;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || (afterConnect !== undefined && typeof afterConnect !== 'function')) throw failure('OPTIONS');
  return (input, init) => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let socket, agent, outgoing, incoming, bodyReader, bodyController, signal, timer, finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      outgoing?.destroy(); incoming?.destroy(); socket?.destroy(); agent?.destroy();
    };
    const fail = error => {
      if (finished) return;
      finished = true;
      if (bodyReader) void bodyReader.cancel(error).catch(() => {});
      bodyController?.error(error);
      cleanup(); reject(error);
    };
    const abort = () => fail(signal.reason ?? new DOMException('Native model request aborted', 'AbortError'));
    timer = setTimeout(() => fail(new DOMException('Native model request timed out', 'TimeoutError')), timeoutMs);
    void (async () => {
      const request = new Request(input, init);
      if (request.url !== target || request.method !== 'POST') throw failure('TARGET');
      signal = request.signal;
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      const chunks = []; let bytes = 0;
      if (request.body) {
        bodyReader = request.body.getReader();
        try {
          while (!finished) {
            const next = await bodyReader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > byteLimit) throw failure('INPUT_LIMIT');
            chunks.push(Buffer.from(next.value));
          }
        } finally { bodyReader.releaseLock(); bodyReader = undefined; }
      }
      if (finished) return;
      const body = Buffer.concat(chunks, bytes), headers = Object.fromEntries(request.headers);
      for (const name of ['connection', 'content-length', 'expect', 'host', 'proxy-authorization', 'transfer-encoding', 'upgrade']) delete headers[name];
      Object.assign(headers, { authorization: 'Bearer p6-synthetic-token', 'x-sidekick-native-nonce': pin.nonce, host: `127.0.0.1:${pin.port}`, connection: 'close', 'content-length': String(body.byteLength), 'accept-encoding': 'identity' });
      if (Buffer.byteLength(JSON.stringify(headers)) > byteLimit) throw failure('INPUT_LIMIT');
      socket = createConnection({ host: '127.0.0.1', port: pin.port });
      socket.on('error', fail);
      await new Promise((connected, failed) => {
        const finish = (callback, value) => { socket.removeListener('connect', onConnect); socket.removeListener('error', onError); socket.removeListener('close', onClose); callback(value); };
        const onConnect = () => finish(connected);
        const onError = error => finish(failed, error);
        const onClose = () => finish(failed, failure('CONNECT_CLOSED'));
        socket.once('connect', onConnect); socket.once('error', onError); socket.once('close', onClose);
      });
      if (afterConnect) await afterConnect();
      if (finished) return;
      if (Date.now() >= deadline) throw new DOMException('Native model request timed out', 'TimeoutError');
      verifyOwner(pin);
      if (Date.now() >= deadline) throw new DOMException('Native model request timed out', 'TimeoutError');
      if (socket.destroyed) throw failure('CONNECT_CLOSED');
      agent = new Agent({ keepAlive: false, maxSockets: 1, maxTotalSockets: 1 });
      let claimed = false;
      agent.createConnection = () => {
        if (claimed || socket.destroyed) throw failure('SECOND_CONNECTION');
        claimed = true;
        return socket;
      };
      outgoing = httpRequest({ host: '127.0.0.1', port: pin.port, path: '/v1/chat/completions', method: 'POST', headers, agent }, response => {
        incoming = response;
        incoming.on('error', fail);
        incoming.on('aborted', () => fail(failure('RESPONSE_ABORTED')));
        incoming.on('close', () => { if (!incoming.complete) fail(failure('RESPONSE_CLOSED')); });
        if (incoming.statusCode >= 300 && incoming.statusCode <= 399) { fail(failure('REDIRECT')); return; }
        if (Number(incoming.headers['content-length']) > byteLimit) { fail(failure('RESPONSE_LIMIT')); return; }
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
        const noBody = incoming.statusCode === 204 || incoming.statusCode === 205;
        incoming.pause();
        const stream = noBody ? null : new ReadableStream({
          start(controller) { bodyController = controller; },
          pull() { incoming.resume(); },
          cancel() { fail(new DOMException('Native model response cancelled', 'AbortError')); }
        });
        let received = 0;
        incoming.on('data', chunk => {
          if (finished) return;
          received += chunk.byteLength;
          if (received > byteLimit) { fail(failure('RESPONSE_LIMIT')); return; }
          bodyController?.enqueue(new Uint8Array(chunk));
          if (bodyController && bodyController.desiredSize <= 0) incoming.pause();
        });
        incoming.on('end', () => {
          if (finished) return;
          finished = true; bodyController?.close(); cleanup();
        });
        try { resolve(new Response(stream, { status: incoming.statusCode, statusText: incoming.statusMessage, headers: responseHeaders })); }
        catch (error) { fail(error); }
        if (noBody) incoming.resume();
      });
      outgoing.on('error', fail);
      outgoing.end(body);
    })().catch(fail);
  });
}
