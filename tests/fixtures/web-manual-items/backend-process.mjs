// Test helper for the W1 web manual-items acceptance suites (MAYNE-23 slice II, revision r2).
// Wraps the frozen docking interface only:
//   server/entries/web-backend-entry.mjs exports async startWebBackend(config) and does
//   not auto-listen on import; config = {root, port, staticRoot, storageBin, initialize,
//   onPairingCode}; success resolves {origin, close} after the backend is ready, and close
//   waits for HTTP/SSE, the storage child process and the root lock to be released.
// The pairing code is obtained in memory via the onPairingCode private callback (in-process
// mode) or over a test-owned child process's dedicated IPC channel (subprocess mode used by
// the SIGKILL restart suite). It never enters a URL, log, receipt or file.
//
// Wire literals fixed by the 2026-11-08 interface arbitration (registered in the MAYNE-23
// task description): the pair request body field is pairingCode, the CSRF token sits at the
// top level of the GET /api/session response as csrfToken, and write requests carry
// X-CSRF-Token. They are constants here — no environment variable can change them, so the
// suites cannot silently diverge from the standard wire format. Environment variables only
// point at this tree's artifacts (source entry, cargo binary, static root); the effective
// values are recorded as non-secret evidence by effectiveConfig().
// List parameter rules from the same arbitration: limit defaults to 50 and an explicit value
// must be an integer in 1–200; an unknown status is rejected 400 validation_failed.
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';

export const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');
export const evidenceRoot = join(repositoryRoot, 'build/web-manual-items-tests');

export const PAIR_FIELD = 'pairingCode';
export const CSRF_RESPONSE_FIELD = 'csrfToken';
export const CSRF_HEADER = 'X-CSRF-Token';
export const LIST_LIMIT = { default: 50, min: 1, max: 200, integerOnly: true };

export class PrerequisiteGap extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrerequisiteGap';
  }
}

export function pairRequestBody(code) {
  return { [PAIR_FIELD]: code };
}

// Contract §9.4 forbids signing acceptance from a design prototype: an explicit static root
// inside the repository design/ directory is a misconfiguration, not a fallback.
const prototypeRoots = () => [join(repositoryRoot, 'design')];

export function rejectPrototypeRoot(root) {
  for (const prototype of prototypeRoots()) {
    if (root === prototype || root.startsWith(prototype + sep)) {
      throw new Error(
        `static root must not point at the design prototype directory (contract §9.4 forbids ` +
        `design previews as acceptance): ${root}`,
      );
    }
  }
}

export function envPath(name, fallback) {
  const value = process.env[name];
  return value ? resolve(value) : fallback;
}

export function resolveArtifacts() {
  const entry = envPath('WEB_MANUAL_ITEMS_ENTRY', join(repositoryRoot, 'build/web-backend/server/entries/web-backend-entry.mjs'));
  const storageBin = envPath('WEB_MANUAL_ITEMS_STORAGE_BIN', join(repositoryRoot, 'build/web-backend/bin/web-backend-storage'));
  let staticRoot;
  if (process.env.WEB_MANUAL_ITEMS_STATIC_ROOT) {
    staticRoot = resolve(process.env.WEB_MANUAL_ITEMS_STATIC_ROOT);
    rejectPrototypeRoot(staticRoot);
  } else {
    staticRoot = join(repositoryRoot, 'build/web-backend/static');
  }
  return { entry, storageBin, staticRoot };
}

// Static-root selection for the same-origin browser suite: an explicit root wins over the
// packaged build artifact, and a synthetic fixture root is used only when neither exists.
// The design/prototype rejection applies to every branch (it can only trigger for an
// explicit root, but the check is unconditional so a misconfiguration can never pass).
export function resolveSuiteStaticRoot() {
  if (process.env.WEB_MANUAL_ITEMS_STATIC_ROOT) {
    const root = resolve(process.env.WEB_MANUAL_ITEMS_STATIC_ROOT);
    rejectPrototypeRoot(root);
    return { root, mode: 'explicit' };
  }
  const packaged = join(repositoryRoot, 'build/web-backend/static');
  rejectPrototypeRoot(packaged);
  if (existsSync(join(packaged, 'index.html'))) return { root: packaged, mode: 'packaged' };
  return { root: null, mode: 'synthetic' };
}

// Non-secret effective configuration recorded as run evidence: the fixed wire literals, the
// list parameter rule and the artifact locations this run resolved. No pairing code, cookie,
// CSRF token or credential is ever included.
export function effectiveConfig(extra = {}) {
  return {
    pairBodyField: PAIR_FIELD,
    csrfResponseField: CSRF_RESPONSE_FIELD,
    csrfRequestHeader: CSRF_HEADER,
    listLimit: LIST_LIMIT,
    artifacts: resolveArtifacts(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    generatedAt: new Date().toISOString(),
    ...extra,
  };
}

export function writeEvidence(name, payload) {
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const path = join(evidenceRoot, name);
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  return path;
}

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

// Pair with the one-time code; the code travels only in the request body, in the fixed
// pairingCode field.
export async function pair(origin, code) {
  const response = await fetch(`${origin}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pairRequestBody(code)),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw text for the diagnostic below */ }
  if (response.status !== 200) {
    throw new Error(`pair failed: status ${response.status} body ${text}`);
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((entry) => entry.split(';', 1)[0]).join('; ');
  if (!cookie) throw new Error(`pair succeeded but no session cookie was set (set-cookie: ${JSON.stringify(setCookie)})`);
  return { cookie, setCookie, body: json };
}

// GET /api/session returns the session (with capabilities) and the CSRF token. The arbitration
// fixed the carrier: the token is read strictly from the top-level csrfToken field, with no
// fallback to any other response shape.
export async function readSession(origin, cookie) {
  const response = await fetch(`${origin}/api/session`, { headers: { cookie } });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* fall through to the diagnostic */ }
  if (response.status !== 200 || !json) throw new Error(`session read failed: status ${response.status} body ${text}`);
  const csrfToken = json[CSRF_RESPONSE_FIELD];
  if (typeof csrfToken !== 'string' || csrfToken.length === 0) {
    throw new Error(
      `CSRF token not found at the top-level "${CSRF_RESPONSE_FIELD}" of GET /api/session ` +
      `(fixed wire literal; no other response shape is accepted): ${text}`,
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
    if (csrf) finalHeaders[CSRF_HEADER] = csrf;
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
    if (csrf) finalHeaders[CSRF_HEADER] = csrf;
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

// In-process backend on an explicit synthetic root. Every failure path after the backend
// handle exists (interface mismatch, pairing timeout, pair or session rejection) closes the
// handle and removes a root this helper created, so a failed start never leaks an HTTP
// server, a storage child or a temporary directory. A successful close() follows the same
// ownership rule: the handle is closed and awaited first, then a self-created root is
// removed while a caller-supplied root and its contents are preserved.
export async function startBackend(options = {}) {
  const {
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
  const ownsRoot = options.root === undefined;
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'web-manual-items-'));
  let handle = null;
  try {
    const module = await import(pathToFileURL(entry).href);
    if (typeof module.startWebBackend !== 'function') {
      throw new PrerequisiteGap(`${entry} does not export startWebBackend(config); the frozen docking interface is not met`);
    }
    let resolveCode;
    const codePromise = new Promise((resolve) => { resolveCode = resolve; });
    handle = await module.startWebBackend({
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
        // Root ownership is the same on the success path as on the failure path below: a
        // caller-supplied root and everything in it survive (the caller owns it), and only
        // a root this helper created is removed. Unconditionally removing the root here
        // deleted a caller's data on a successful close (OBS-1).
        if (ownsRoot) rmSync(root, { recursive: true, force: true });
      },
    };
    if (shouldPair) await backend.pairWithStartupCode();
    return backend;
  } catch (error) {
    if (handle) await handle.close().catch(() => { /* the original failure is the reportable one */ });
    if (ownsRoot) rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

// Subprocess mode for the SIGKILL restart suite: a test-owned child imports the same pinned
// entry, forwards the pairing code over its dedicated IPC channel, and can be killed hard.
// Any failure after the spawn (ready timeout, pairing-code timeout, pair or session
// rejection) kills the child and removes the temporary config directory, so a failed start
// never leaks a process or a directory.
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
  const timers = new Set();
  const armTimer = (callback, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, ms);
    timers.add(timer);
    return timer;
  };
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
    const timer = armTimer(() => reject(new Error(`child did not report ${type} within ${readyTimeoutMs}ms; stderr: ${stderr}`)), readyTimeoutMs);
    waiters.push({
      resolve: (message) => {
        if (message.type !== type) return false;
        clearTimeout(timer);
        timers.delete(timer);
        resolvePromise(message);
        return true;
      },
      reject: (error) => { clearTimeout(timer); timers.delete(timer); reject(error); },
    });
  });
  const release = async () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise((resolvePromise) => {
        const done = () => resolvePromise();
        child.once('exit', done);
        setTimeout(done, 5000).unref();
      });
    }
    rmSync(configDir, { recursive: true, force: true });
  };
  try {
    const ready = await waitFor('ready');
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
  } catch (error) {
    await release();
    throw error;
  }
}
