// Test helper for the W1 web manual-items acceptance suites (MAYNE-23 slice II).
// Wraps the frozen docking interface only:
//   server/entries/web-backend-entry.mjs exports async startWebBackend(config) and does
//   not auto-listen on import; config = {root, port, staticRoot, storageBin, initialize,
//   onPairingCode}; success resolves {origin, close} after the backend is ready.
// The pairing code is obtained in memory via the onPairingCode private callback (in-process
// mode) or over a test-owned child process's dedicated IPC channel (subprocess mode used by
// the SIGKILL restart suite). It never enters a URL, log, receipt or file.
//
// Interface points the frozen contracts pin semantically but not by literal name are
// overridable through environment variables; defaults are documented in admission.json and
// docs/reviews/web-manual-items-tests-20261108.md for Codex adjudication against slice I:
//   WEB_MANUAL_ITEMS_PAIR_FIELD   pair request body field          (default "code")
//   WEB_MANUAL_ITEMS_CSRF_HEADER  CSRF submission header           (default "x-csrf-token")
//   WEB_MANUAL_ITEMS_ENTRY        web-backend-entry.mjs path       (default build/web-backend/...)
//   WEB_MANUAL_ITEMS_STORAGE_BIN  web-backend-storage binary path  (default build/web-backend/...)
//   WEB_MANUAL_ITEMS_STATIC_ROOT  static root for the UI           (default build/web-backend/static)
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';

export const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');

export class PrerequisiteGap extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrerequisiteGap';
  }
}

export function envPath(name, fallback) {
  const value = process.env[name];
  return value ? resolve(value) : fallback;
}

export function resolveArtifacts() {
  return {
    entry: envPath('WEB_MANUAL_ITEMS_ENTRY', join(repositoryRoot, 'build/web-backend/server/entries/web-backend-entry.mjs')),
    storageBin: envPath('WEB_MANUAL_ITEMS_STORAGE_BIN', join(repositoryRoot, 'build/web-backend/bin/web-backend-storage')),
    staticRoot: envPath('WEB_MANUAL_ITEMS_STATIC_ROOT', join(repositoryRoot, 'build/web-backend/static')),
  };
}

export const pairField = () => process.env.WEB_MANUAL_ITEMS_PAIR_FIELD || 'code';
export const csrfHeader = () => process.env.WEB_MANUAL_ITEMS_CSRF_HEADER || 'x-csrf-token';

export function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${message}`)), ms).unref()),
  ]);
}

function requireFile(path, what, how) {
  if (!existsSync(path)) {
    throw new PrerequisiteGap(
      `missing prerequisite: ${what} not found at ${path}. ${how} ` +
      'This suite is written against the frozen contract; the production entry, storage binary ' +
      'and static root are delivered by slice I/III (npm run build:backend, or point ' +
      'WEB_MANUAL_ITEMS_ENTRY / WEB_MANUAL_ITEMS_STORAGE_BIN / WEB_MANUAL_ITEMS_STATIC_ROOT at ' +
      "this tree's source entry, cargo-built binary and dist). No business result is claimed.",
    );
  }
}

// Pair with the one-time code; the code travels only in the request body.
export async function pair(origin, code) {
  const response = await fetch(`${origin}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [pairField()]: code }),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw text for the diagnostic below */ }
  if (response.status !== 200) {
    const hint = response.status === 401 && json?.error?.code === 'pair_code_invalid'
      ? ` (the one-time code was rejected; if the pair body field is not "${pairField()}", ` +
        'set WEB_MANUAL_ITEMS_PAIR_FIELD to the implementation field — pending Codex adjudication)'
      : '';
    throw new Error(`pair failed: status ${response.status} body ${text}${hint}`);
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((entry) => entry.split(';', 1)[0]).join('; ');
  if (!cookie) throw new Error(`pair succeeded but no session cookie was set (set-cookie: ${JSON.stringify(setCookie)})`);
  return { cookie, setCookie, body: json };
}

// GET /api/session returns the session (with capabilities) and the CSRF token. The frozen
// contract pins the content but not the literal carrier, so extraction accepts the documented
// body fields and response headers; failure names what was inspected.
export async function readSession(origin, cookie) {
  const response = await fetch(`${origin}/api/session`, { headers: { cookie } });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* fall through to the diagnostic */ }
  if (response.status !== 200 || !json) throw new Error(`session read failed: status ${response.status} body ${text}`);
  const csrfToken = json.csrfToken ?? json.csrf_token
    ?? response.headers.get('x-csrf-token') ?? response.headers.get('x-csrf');
  if (!csrfToken) {
    throw new Error(
      'CSRF token not found in GET /api/session response (inspected body fields csrfToken/csrf_token ' +
      `and headers x-csrf-token/x-csrf; body: ${text})`,
    );
  }
  return { capabilities: json.session?.capabilities ?? json.capabilities ?? null, csrfToken, body: json };
}

// Minimal same-origin client. A real same-origin page sends Origin on non-GET writes and none
// on GET, so writes default to Origin: <origin>; tests override it for rejection cases.
export function createRequester(origin) {
  return async function request(method, path, options = {}) {
    const { body, cookie, csrf, headers = {}, raw = false } = options;
    const finalHeaders = { ...headers };
    if (cookie) finalHeaders.cookie = cookie;
    if (csrf) finalHeaders[csrfHeader()] = csrf;
    if (body !== undefined) finalHeaders['content-type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD' && !finalHeaders.origin) finalHeaders.origin = origin;
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    if (!raw) { try { json = JSON.parse(text); } catch { /* non-JSON body kept as text */ } }
    return {
      status: response.status,
      headers: response.headers,
      text,
      json,
      setCookie: response.headers.getSetCookie?.() ?? [],
    };
  };
}

// Raw node:http client for cases fetch forbids (a foreign Host header). Same response shape
// as the fetch client.
export function createRawRequester(origin) {
  return function request(method, path, options = {}) {
    const { body, cookie, csrf, headers = {} } = options;
    const finalHeaders = { ...headers };
    if (cookie) finalHeaders.cookie = cookie;
    if (csrf) finalHeaders[csrfHeader()] = csrf;
    if (body !== undefined) finalHeaders['content-type'] = 'application/json';
    return new Promise((resolve, reject) => {
      const request = http.request(`${origin}${path}`, { method, headers: finalHeaders }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch { /* non-JSON body kept as text */ }
          resolve({ status: response.statusCode, headers: response.headers, text, json, setCookie: response.headers['set-cookie'] ?? [] });
        });
      });
      request.on('error', reject);
      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    });
  };
}

// In-process backend on an explicit synthetic root.
export async function startBackend(options = {}) {
  const {
    root = mkdtempSync(join(tmpdir(), 'web-manual-items-')),
    initialize = true,
    staticRoot,
    storageBin,
    pair: shouldPair = true,
    pairingTimeoutMs = 20000,
  } = options;
  const artifacts = resolveArtifacts();
  const entry = options.entry ?? artifacts.entry;
  const bin = storageBin ?? artifacts.storageBin;
  requireFile(entry, 'web backend entry module', 'Build it with the slice III build:backend script or point WEB_MANUAL_ITEMS_ENTRY at the source entry.');
  requireFile(bin, 'web-backend-storage binary', 'Build it with cargo (slice I registers the [[bin]]) or point WEB_MANUAL_ITEMS_STORAGE_BIN at it.');
  const module = await import(pathToFileURL(entry).href);
  if (typeof module.startWebBackend !== 'function') {
    throw new PrerequisiteGap(`${entry} does not export startWebBackend(config); the frozen docking interface is not met`);
  }
  let resolveCode;
  const codePromise = new Promise((resolve) => { resolveCode = resolve; });
  const handle = await module.startWebBackend({
    root,
    port: 0,
    staticRoot: staticRoot ?? (existsSync(artifacts.staticRoot) ? artifacts.staticRoot : root),
    storageBin: bin,
    initialize,
    onPairingCode: (code) => resolveCode(code),
  });
  if (!handle?.origin || typeof handle.close !== 'function') {
    throw new PrerequisiteGap('startWebBackend did not return {origin, close}; the frozen docking interface is not met');
  }
  const backend = {
    root,
    origin: handle.origin,
    request: createRequester(handle.origin),
    cookie: null,
    csrf: null,
    capabilities: null,
    pairingCode: null,
    async receivePairingCode() {
      backend.pairingCode = await withTimeout(codePromise, pairingTimeoutMs,
        'pairing code was not delivered through the onPairingCode private callback');
      return backend.pairingCode;
    },
    async pairWithStartupCode() {
      await backend.receivePairingCode();
      const session = await pair(backend.origin, backend.pairingCode);
      const info = await readSession(backend.origin, session.cookie);
      backend.cookie = session.cookie;
      backend.csrf = info.csrfToken;
      backend.capabilities = info.capabilities;
      return info;
    },
    async close() {
      await handle.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
  if (shouldPair) await backend.pairWithStartupCode();
  return backend;
}

// Subprocess mode for the SIGKILL restart suite: a test-owned child imports the same pinned
// entry, forwards the pairing code over its dedicated IPC channel, and can be killed hard.
export async function startBackendChild(options = {}) {
  const {
    root,
    initialize = true,
    staticRoot,
    storageBin,
    readyTimeoutMs = 30000,
  } = options;
  const artifacts = resolveArtifacts();
  const entry = options.entry ?? artifacts.entry;
  const bin = storageBin ?? artifacts.storageBin;
  requireFile(entry, 'web backend entry module', 'Build it with the slice III build:backend script or point WEB_MANUAL_ITEMS_ENTRY at the source entry.');
  requireFile(bin, 'web-backend-storage binary', 'Build it with cargo (slice I registers the [[bin]]) or point WEB_MANUAL_ITEMS_STORAGE_BIN at it.');
  const configDir = mkdtempSync(join(tmpdir(), 'web-manual-items-child-'));
  const configPath = join(configDir, 'child-config.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(configPath, JSON.stringify({
    entry,
    root,
    staticRoot: staticRoot ?? root,
    storageBin: bin,
    initialize,
  }));
  const child = spawn(process.execPath, [join(import.meta.dirname, 'backend-child.mjs'), configPath], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const messages = [];
  const waiters = [];
  child.on('message', (message) => {
    messages.push(message);
    if (message.type === 'error') {
      for (const waiter of waiters.splice(0)) {
        waiter.reject(new Error(`backend child failed to start: ${message.message}`));
      }
      return;
    }
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (waiters[index].resolve(message)) waiters.splice(index, 1);
    }
  });
  const waitFor = (type) => new Promise((resolvePromise, reject) => {
    const existing = messages.find((message) => message.type === type);
    if (existing) return resolvePromise(existing);
    const timer = setTimeout(() => reject(new Error(`child did not report ${type} within ${readyTimeoutMs}ms; stderr: ${stderr}`)), readyTimeoutMs);
    waiters.push({
      resolve: (message) => {
        if (message.type !== type) return false;
        clearTimeout(timer);
        resolvePromise(message);
        return true;
      },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
  });
  const ready = await waitFor('ready').catch((error) => {
    child.kill('SIGKILL');
    throw error;
  });
  const codeMessage = await withTimeout(waitFor('pairing-code'), readyTimeoutMs,
    'pairing code was not forwarded over the child IPC channel');
  const session = await pair(ready.origin, codeMessage.code);
  const info = await readSession(ready.origin, session.cookie);
  return {
    root,
    origin: ready.origin,
    pid: child.pid,
    request: createRequester(ready.origin),
    cookie: session.cookie,
    csrf: info.csrfToken,
    capabilities: info.capabilities,
    pairingCode: codeMessage.code,
    stderr: () => stderr,
    stdout: () => stdout,
    killHard() { child.kill('SIGKILL'); },
    async waitExit(timeoutMs = 15000) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await withTimeout(new Promise((resolvePromise) => child.once('exit', resolvePromise)), timeoutMs, 'child exit');
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await this.waitExit().catch(() => child.kill('SIGKILL'));
      }
      rmSync(configDir, { recursive: true, force: true });
    },
  };
}
