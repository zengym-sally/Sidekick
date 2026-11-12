// Test helper for the W1 text-intake acceptance suites (MAYNE-24 slice II).
// It wraps the frozen docking interface plus the two MAYNE-24 interface
// arbitration additions registered in the task description:
//   server/entries/web-backend-entry.mjs exports async startWebBackend(config)
//   and does not auto-listen on import; config = {root, port, staticRoot,
//   storageBin, initialize, onPairingCode} extended with optional runtimeRoot
//   (source verification may point at this tree's build/s0-runtime; the
//   packaged default points at bundle/runtime — that default belongs to the
//   entry, this helper only forwards an explicit value) and an optional
//   credentialProvider (test-private programmatic injection; the default
//   installs no OS provider and reads no environment secrets).
// Success resolves {origin, close} after the backend is ready, and close waits
// for HTTP/SSE, the storage child process and the root lock to be released.
// The pairing code is obtained in memory via the onPairingCode private callback
// (in-process mode) or over a test-owned child process's dedicated IPC channel
// (subprocess mode used by the SIGKILL restart suite). It never enters a URL,
// log, receipt or file.
//
// Wire literals are the frozen ones from the 2026-11-08 W1 arbitration (kept
// identical so the two slice families cannot silently diverge): pair body field
// pairingCode, CSRF token at the top level of GET /api/session as csrfToken,
// write header X-CSRF-Token. They are constants here — no environment variable
// can change them. Environment variables only point at this tree's artifacts
// (source entry, cargo binary, static root, runtime root); the effective values
// are recorded as non-secret evidence by effectiveConfig().
//
// List parameter rules from the frozen web-api/1 contract and the W1
// arbitration: limit defaults to 50, an explicit value must be an integer in
// 1–200; an unknown status is rejected 400 validation_failed.
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';

export const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');
export const evidenceRoot = join(repositoryRoot, 'build/web-text-intake-tests');

export const PAIR_FIELD = 'pairingCode';
export const CSRF_RESPONSE_FIELD = 'csrfToken';
export const CSRF_HEADER = 'X-CSRF-Token';
export const LIST_LIMIT = { default: 50, min: 1, max: 200, integerOnly: true };
export const CONTRACT_VERSION = 'web-api/2';

export class PrerequisiteGap extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrerequisiteGap';
  }
}

export function pairRequestBody(code) {
  return { [PAIR_FIELD]: code };
}

// Contract §9.4 forbids signing acceptance from a design prototype: an explicit
// static root inside the repository design/ directory is a misconfiguration,
// not a fallback.
const prototypeRoots = () => [join(repositoryRoot, 'design')];

export function rejectPrototypeRoot(root) {
  for (const prototype of prototypeRoots()) {
    if (root === prototype || root.startsWith(prototype + sep)) {
      throw new Error(
        `static root must not point at the design prototype directory (contract §9.4 forbids `
        + `design previews as acceptance): ${root}`,
      );
    }
  }
}

export function envPath(name, fallback) {
  const value = process.env[name];
  return value ? resolve(value) : fallback;
}

// The bundled runtime produced by the sanctioned fixed command
// `npm run probe:bundle`. Source verification may point the backend at this
// tree's bundle explicitly; the packaged entry default (bundle/runtime) is the
// entry's own business and is not overridden here.
export const bundledRuntimeRoot = join(repositoryRoot, 'build/s0-runtime');

export function runtimeRootAvailable(root = bundledRuntimeRoot) {
  return existsSync(join(root, 'organizer.mjs')) && existsSync(join(root, 'node'));
}

export function resolveArtifacts() {
  const entry = envPath('WEB_TEXT_INTAKE_ENTRY', join(repositoryRoot, 'build/web-backend/server/entries/web-backend-entry.mjs'));
  const storageBin = envPath('WEB_TEXT_INTAKE_STORAGE_BIN', join(repositoryRoot, 'build/web-backend/bin/web-backend-storage'));
  let staticRoot;
  if (process.env.WEB_TEXT_INTAKE_STATIC_ROOT) {
    staticRoot = resolve(process.env.WEB_TEXT_INTAKE_STATIC_ROOT);
    rejectPrototypeRoot(staticRoot);
  } else {
    staticRoot = join(repositoryRoot, 'build/web-backend/static');
  }
  const runtimeRoot = process.env.WEB_TEXT_INTAKE_RUNTIME_ROOT
    ? resolve(process.env.WEB_TEXT_INTAKE_RUNTIME_ROOT)
    : (runtimeRootAvailable() ? bundledRuntimeRoot : null);
  return { entry, storageBin, staticRoot, runtimeRoot };
}

// Static-root selection for the same-origin browser suite: an explicit root
// wins over the packaged build artifact, and a synthetic fixture root is used
// only when neither exists. The design/prototype rejection applies to every
// branch so a misconfiguration can never pass.
export function resolveSuiteStaticRoot() {
  if (process.env.WEB_TEXT_INTAKE_STATIC_ROOT) {
    const root = resolve(process.env.WEB_TEXT_INTAKE_STATIC_ROOT);
    rejectPrototypeRoot(root);
    return { root, mode: 'explicit' };
  }
  const packaged = join(repositoryRoot, 'build/web-backend/static');
  rejectPrototypeRoot(packaged);
  if (existsSync(join(packaged, 'index.html'))) return { root: packaged, mode: 'packaged' };
  return { root: null, mode: 'synthetic' };
}

// Non-secret effective configuration recorded as run evidence: the fixed wire
// literals, the list parameter rule and the artifact locations this run
// resolved. No pairing code, cookie, CSRF token or credential is ever included.
export function effectiveConfig(extra = {}) {
  return {
    pairBodyField: PAIR_FIELD,
    csrfResponseField: CSRF_RESPONSE_FIELD,
    csrfRequestHeader: CSRF_HEADER,
    contractVersion: CONTRACT_VERSION,
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

// ---------------------------------------------------------------------------
// Self-built child termination with exit verification, bounded by the case's
// remaining HARD budget. The aggregate runs `node --test --test-timeout=20000`
// (the frozen per-case budget) and every case keeps a margin between its work
// deadline and that hard deadline for cleanup, so fixture-side waits derive
// from the remaining budget instead of the retired fixed 5s/15s constants: a
// fixed wait could outlive the hard deadline, and a Promise timeout that
// resolves without a verified exit would mask a leftover process. No margin
// left or a surviving child is an explicit failure.
// ---------------------------------------------------------------------------

function remainingHardBudget(hardDeadline, what) {
  if (typeof hardDeadline !== 'number' || !Number.isFinite(hardDeadline)) {
    throw new Error(
      `${what} requires the case hard deadline (absolute epoch ms) so the wait derives from the remaining `
      + 'hard budget; a fixed wait is no longer accepted',
    );
  }
  const remaining = hardDeadline - Date.now();
  if (remaining <= 0) {
    throw new Error(
      `${what} has no margin left to the hard deadline (${hardDeadline}): the case overran its work `
      + 'deadline — the wait cannot be bounded and a leftover process must not be masked by a timeout',
    );
  }
  return remaining;
}

const waitChildExit = (child, ms) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
  const timer = setTimeout(resolve, Math.max(0, ms));
  child.once('exit', () => { clearTimeout(timer); resolve(); });
});

// Terminate a self-built child and VERIFY its exit: SIGTERM (the child's
// graceful path) first, SIGKILL if the remaining budget allows another round,
// then wait for the real 'exit' event. exitCode/signalCode is the
// verification — the Promise timeout never stands in for it. The process is
// always terminated first, so a missing margin fails explicitly only after
// the kill, never leaving the child running.
async function terminateAndVerify(child, hardDeadline, label) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const budget = () => {
    if (typeof hardDeadline !== 'number' || !Number.isFinite(hardDeadline)) {
      throw new Error(
        `${label} termination requires the case hard deadline (absolute epoch ms) so the wait derives from `
        + 'the remaining hard budget; a fixed wait is no longer accepted',
      );
    }
    return Math.max(0, hardDeadline - Date.now());
  };
  child.kill('SIGTERM');
  await waitChildExit(child, budget());
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await waitChildExit(child, budget());
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(
      `${label} pid ${child.pid} survived termination: no exit verified within the remaining hard budget `
      + `(deadline ${hardDeadline}) — a leftover self-built process must fail explicitly`,
    );
  }
}

// ---------------------------------------------------------------------------
// Process-tree observation (macOS): used to find the real Pi worker processes
// the backend spawns, to SIGKILL one for the exit-unknown case, and to assert
// the synthetic secret never reaches a worker's argv.
// ---------------------------------------------------------------------------

export function processTable() {
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  return output.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : null;
  }).filter(Boolean);
}

export function descendantPids(rootPid) {
  const table = processTable();
  const children = new Map();
  for (const entry of table) {
    if (!children.has(entry.ppid)) children.set(entry.ppid, []);
    children.get(entry.ppid).push(entry);
  }
  const found = [];
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length) {
    const entry = queue.shift();
    found.push(entry.pid);
    queue.push(...(children.get(entry.pid) ?? []));
  }
  return found;
}

// The real Pi worker processes: descendants of the given root whose command
// line runs the bundled organizer. Returned with their full command line so a
// suite can assert the secret is absent from argv.
export function findOrganizerWorkers(rootPid) {
  const table = processTable();
  const wanted = new Set(descendantPids(rootPid));
  return table.filter((entry) => wanted.has(entry.pid) && /organizer\.mjs/.test(entry.command));
}

export function killDescendant(pid, signal = 'SIGKILL') {
  process.kill(pid, signal);
}

// Deterministic polling helper: suites must never use a fixed sleep to mask
// readiness. pollUntil re-evaluates a predicate against the live backend until
// it holds or the deadline expires, and returns the predicate's value.
export async function pollUntil(predicate, { timeoutMs = 20000, intervalMs = 25, message = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  for (;;) {
    lastValue = await predicate();
    if (lastValue) return lastValue;
    if (Date.now() >= deadline) {
      throw new Error(`pollUntil deadline after ${timeoutMs}ms waiting for: ${message}; last observed: ${JSON.stringify(lastValue)}`);
    }
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

function requireFile(path, what, how) {
  if (!existsSync(path)) {
    throw new PrerequisiteGap(
      `missing prerequisite: ${what} not found at ${path}. ${how} `
      + 'This suite is written against the frozen contract; the production entry, storage binary '
      + 'and static root are delivered by slice I/III (npm run build:backend, or point '
      + 'WEB_TEXT_INTAKE_ENTRY / WEB_TEXT_INTAKE_STORAGE_BIN / WEB_TEXT_INTAKE_STATIC_ROOT at '
      + "this tree's source entry, cargo-built binary and dist). No business result is claimed.",
    );
  }
}

// Pair with the one-time code; the code travels only in the request body, in
// the fixed pairingCode field.
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

// GET /api/session returns the session (with capabilities) and the CSRF token.
// The arbitration fixed the carrier: the token is read strictly from the
// top-level csrfToken field, with no fallback to any other response shape.
export async function readSession(origin, cookie) {
  const response = await fetch(`${origin}/api/session`, { headers: { cookie } });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* fall through to the diagnostic */ }
  if (response.status !== 200 || !json) throw new Error(`session read failed: status ${response.status} body ${text}`);
  const csrfToken = json[CSRF_RESPONSE_FIELD];
  if (typeof csrfToken !== 'string' || csrfToken.length === 0) {
    throw new Error(
      `CSRF token not found at the top-level "${CSRF_RESPONSE_FIELD}" of GET /api/session `
      + `(fixed wire literal; no other response shape is accepted): ${text}`,
    );
  }
  return { capabilities: json.session?.capabilities ?? json.capabilities ?? null, csrfToken, body: json };
}

// Pair an additional client (a real second session) using the next pairing
// code the backend emits over the private channel. If the backend never
// emits a second code, this fails with a named interface gap — the base entry
// emits exactly one code at startup, and two-client acceptance depends on the
// additional-code emission the frozen contract's remedy implies.
export async function pairAdditionalClient(handle, index = 1) {
  const code = await handle.receivePairingCode(index);
  const session = await pair(handle.origin, code);
  const info = await readSession(handle.origin, session.cookie);
  return { cookie: session.cookie, csrf: info.csrfToken, capabilities: info.capabilities };
}

// Minimal same-origin client. A real same-origin page sends Origin on non-GET
// writes and none on GET, so writes default to Origin: <origin>; tests override
// it for rejection cases.
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

// Raw node:http client for cases fetch forbids (a foreign Host header). Same
// response shape as the fetch client.
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

// The controlled credential provider contract from the MAYNE-24 interface
// arbitration: resolve(ref):Promise<string> and
// status(ref):Promise<{status:"available"|"missing"|"unavailable",detail?}>.
// Tests build the object in memory; the secret exists only inside this object
// and the worker's private stdin (dispatch §2). This helper records which
// refs were resolved so a suite can prove the provider was actually consulted
// without ever recording the resolved value.
export function createControlledCredentialProvider(entries, options = {}) {
  const { onResolve } = options;
  const resolvedRefs = [];
  const table = { ...entries };
  return {
    kind: 'controlled',
    resolvedRefs,
    async resolve(ref) {
      const entry = table[ref];
      if (!entry) {
        const error = new Error(`controlled credential provider: no synthetic entry for ref ${ref}`);
        error.code = 'CREDENTIAL_MISSING';
        throw error;
      }
      if (entry.status === 'missing') {
        const error = new Error(`controlled credential provider: ref ${ref} is revoked`);
        error.code = 'CREDENTIAL_MISSING';
        throw error;
      }
      resolvedRefs.push(ref);
      onResolve?.(ref);
      return entry.value;
    },
    async status(ref) {
      const entry = table[ref];
      if (!entry) return { status: 'missing', detail: 'no synthetic entry for this ref' };
      return { status: entry.status ?? 'available' };
    },
    // Fixture-held state change (frozen 2026-11-08 arbitration): revocation
    // is a state change of this in-memory object — no configuration rewrite
    // and no production setter alias. The next task must observe the revoked
    // reference and fail before any worker starts.
    setStatus(ref, status) {
      const entry = table[ref];
      if (!entry) throw new Error(`controlled credential provider: no synthetic entry for ref ${ref}`);
      entry.status = status;
      return entry;
    },
  };
}

// In-process backend on an explicit synthetic root. Every failure path after
// the backend handle exists (interface mismatch, pairing timeout, pair or
// session rejection) closes the handle and removes a root this helper created,
// so a failed start never leaks an HTTP server, a storage child or a temporary
// directory. A successful close() follows the same ownership rule as the W1
// fixture: the handle is closed and awaited first, then a self-created root is
// removed while a caller-supplied root and its contents are preserved.
export async function startBackend(options = {}) {
  const {
    initialize = true,
    staticRoot,
    storageBin,
    pair: shouldPair = true,
    pairingTimeoutMs = 20000,
    runtimeRoot,
    credentialProvider,
    workerProcessFactory,
    workerRunLimitMs,
  } = options;
  const artifacts = resolveArtifacts();
  const entry = options.entry ?? artifacts.entry;
  const bin = storageBin ?? artifacts.storageBin;
  requireFile(entry, 'web backend entry module', 'Build it with the slice III build:backend script or point WEB_TEXT_INTAKE_ENTRY at the source entry.');
  requireFile(bin, 'web-backend-storage binary', 'Build it with cargo (slice I registers the [[bin]]) or point WEB_TEXT_INTAKE_STORAGE_BIN at it.');
  const ownsRoot = options.root === undefined;
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'web-text-intake-'));
  let handle = null;
  try {
    const module = await import(pathToFileURL(entry).href);
    if (typeof module.startWebBackend !== 'function') {
      throw new PrerequisiteGap(`${entry} does not export startWebBackend(config); the frozen docking interface is not met`);
    }
    let resolveCode;
    const codePromise = new Promise((resolve) => { resolveCode = resolve; });
    // The frozen contract's client remedy for a used code is "取新配对码", so
    // the private onPairingCode channel may deliver more than one code over a
    // backend's life. Every delivered code is captured in order; the base
    // entry implementation emits exactly one at startup, and a suite that
    // needs a second client fails with a named interface gap if no second
    // code ever arrives (see pairingCodes/receivePairingCode).
    const codes = [];
    const codeWaiters = [];
    const config = {
      root,
      port: 0,
      staticRoot: staticRoot ?? (existsSync(artifacts.staticRoot) ? artifacts.staticRoot : root),
      storageBin: bin,
      initialize,
      onPairingCode: (code) => {
        codes.push(code);
        resolveCode(code);
        for (const waiter of codeWaiters.splice(0)) waiter();
      },
    };
    if (runtimeRoot !== undefined) config.runtimeRoot = runtimeRoot;
    if (credentialProvider !== undefined) config.credentialProvider = credentialProvider;
    // The frozen arbitration's two programmatic private keys: the factory
    // replaces only the WorkerHost spawn call (unset must spawn the real Pi)
    // and the short run limit goes through the same production timeout path.
    // Forwarded verbatim; the range/type validation is production's job and
    // the suites assert it there.
    if (workerProcessFactory !== undefined) config.workerProcessFactory = workerProcessFactory;
    if (workerRunLimitMs !== undefined) config.workerRunLimitMs = workerRunLimitMs;
    handle = await module.startWebBackend(config);
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
      pairingCodes: codes,
      async receivePairingCode(index = 0) {
        if (codes.length > index) {
          backend.pairingCode = codes[index];
          return codes[index];
        }
        const deadline = Date.now() + pairingTimeoutMs;
        for (;;) {
          if (codes.length > index) {
            backend.pairingCode = codes[index];
            return codes[index];
          }
          if (Date.now() >= deadline) {
            throw new PrerequisiteGap(
              index === 0
                ? 'pairing code was not delivered through the onPairingCode private callback'
                : `no pairing code #${index + 1} was delivered through the onPairingCode private callback within `
                  + `${pairingTimeoutMs}ms; the entry emitted ${codes.length} code(s). Two-client acceptance `
                  + 'requires the backend to emit an additional one-time code per additional client '
                  + '(frozen contract §2 remedy "取新配对码"); the exact emission trigger is registered as an '
                  + 'interface gap for the captain (MAYNE-24 dispatch §4). No business result is claimed.',
            );
          }
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 50);
            codeWaiters.push(() => { clearTimeout(timer); resolve(); });
          });
        }
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
        // Root ownership is the same on the success path as on the failure
        // path: a caller-supplied root and everything in it survive (the
        // caller owns it), and only a root this helper created is removed.
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

// Subprocess mode for the SIGKILL restart suite: a test-owned child imports
// the same pinned entry, forwards the pairing code over its dedicated IPC
// channel, and can be killed hard. The controlled credential provider is
// delivered to the child over the same private IPC channel BEFORE the child
// starts the backend (frozen 2026-11-08 arbitration: the spec never touches
// a file, argv or environment variable, and the child hands the built
// in-memory provider to the established config.credentialProvider — there is
// no post-start setter alias). Revocation arrives later as a credential-status
// message that mutates the child-held provider state. Any failure after the
// spawn (startup gate timeout, ready timeout, pairing-code timeout, pair or
// session rejection) kills the child and removes the temporary config
// directory. The caller passes its case hard deadline (absolute epoch ms):
// the child's termination, exit verification and close derive every wait from
// the remaining hard budget — a fixed 5s/15s wait could outlive the hard
// deadline and a Promise timeout must never stand in for a verified exit.
export async function startBackendChild(options = {}) {
  const {
    root,
    initialize = true,
    staticRoot,
    storageBin,
    runtimeRoot,
    credentialProviderEntries,
    readyTimeoutMs = 30000,
    hardDeadline,
  } = options;
  const artifacts = resolveArtifacts();
  const entry = options.entry ?? artifacts.entry;
  const bin = storageBin ?? artifacts.storageBin;
  requireFile(entry, 'web backend entry module', 'Build it with the slice III build:backend script or point WEB_TEXT_INTAKE_ENTRY at the source entry.');
  requireFile(bin, 'web-backend-storage binary', 'Build it with cargo (slice I registers the [[bin]]) or point WEB_TEXT_INTAKE_STORAGE_BIN at it.');
  const configDir = mkdtempSync(join(tmpdir(), 'web-text-intake-child-'));
  const configPath = join(configDir, 'child-config.json');
  writeFileSync(configPath, JSON.stringify({
    entry,
    root,
    staticRoot: staticRoot ?? root,
    storageBin: bin,
    initialize,
    ...(runtimeRoot !== undefined ? { runtimeRoot } : {}),
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
  const pairingCodes = [];
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
    if (message.type === 'pairing-code') pairingCodes.push(message.code);
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
    // Drop the pending startup-gate timers first: they are not unref'd, so a
    // survivor would keep the test process alive long after the failure.
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    // Terminate the self-built child and VERIFY its exit within the remaining
    // hard budget — the retired 5s unref'd Promise timeout resolved without
    // any verification and could mask a leftover child.
    await terminateAndVerify(child, hardDeadline, 'backend child (start failure)');
    rmSync(configDir, { recursive: true, force: true });
  };
  try {
    // The frozen arbitration's credential injection: the controlled provider
    // spec goes over this dedicated IPC channel BEFORE the child starts the
    // backend (or an explicit begin when the suite injects nothing), and the
    // child hands the built provider to config.credentialProvider.
    child.send(credentialProviderEntries
      ? { type: 'credential-provider', entries: credentialProviderEntries }
      : { type: 'begin' });
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
      pairingCodes,
      async receivePairingCode(index = 0) {
        const deadline = Date.now() + readyTimeoutMs;
        for (;;) {
          if (pairingCodes.length > index) return pairingCodes[index];
          if (Date.now() >= deadline) {
            throw new PrerequisiteGap(
              `no pairing code #${index + 1} arrived over the child IPC channel; the entry emitted `
              + `${pairingCodes.length} code(s). Two-client acceptance requires the backend to emit an additional `
              + 'one-time code per additional client (interface gap registered with the captain).',
            );
          }
          await new Promise((done) => setTimeout(done, 50));
        }
      },
      // Fixture-held revocation in subprocess mode: the authoritative state
      // stays in the test process and is pushed to the child-held provider
      // over the same private IPC channel (no production setter alias).
      async setCredentialStatus(ref, status) {
        child.send({ type: 'credential-status', ref, status });
        const ack = await withTimeout(new Promise((resolvePromise, reject) => {
          const done = (message) => {
            if (message.type === 'credential-status-applied' || message.type === 'credential-status-error') {
              resolvePromise(message);
              return true;
            }
            return false;
          };
          const existing = messages.find(done);
          if (existing) return resolvePromise(existing);
          waiters.push({ resolve: done, reject });
        }), readyTimeoutMs, `credential status change for ${ref} was not acknowledged over the child IPC channel`);
        if (ack.type === 'credential-status-error') {
          throw new Error(`credential status change failed: ${ack.message}`);
        }
        return ack;
      },
      stderr: () => stderr,
      stdout: () => stdout,
      hardDeadline,
      killHard() { child.kill('SIGKILL'); },
      // Wait for the VERIFIED exit: resolves on the real 'exit' event and
      // rejects on expiry, bounded by the remaining hard budget (the retired
      // fixed 15000ms default is gone).
      async waitExit() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await withTimeout(
          new Promise((resolvePromise) => child.once('exit', resolvePromise)),
          remainingHardBudget(hardDeadline, 'backend child waitExit'),
          'child exit',
        );
      },
      // Terminate the self-built child and verify its exit within the
      // remaining hard budget before the config directory goes; a survivor is
      // an explicit failure, never a swallowed timeout.
      async close() {
        await terminateAndVerify(child, hardDeadline, 'backend child');
        rmSync(configDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const releaseError = await release().then(() => null, (thrown) => thrown);
    if (releaseError) {
      throw new Error(
        `backend child cleanup failed after a start failure: ${releaseError.message}; `
        + `the original start failure was: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}
