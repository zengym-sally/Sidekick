// Headless-Chrome DevTools driver + real-pipeline page harness for the
// MAYNE-37 candidate-operation browser faces. The browser session follows the
// reclaim + budget discipline of capability-ui-browser.mjs (this tree's
// reviewed pattern), extended with exactly two capabilities the candidate
// faces need and that fixture does not have:
//
// 1. Deterministic in-browser transport control. The D-suite response dropper
//    (candidate-operations-response-dropper.mjs on the LOCKED backend tree)
//    cannot serve the real page: the page's fetches are same-origin and
//    cannot be redirected through a test-process proxy. The browser-native
//    equivalent is the CDP Fetch domain — a request paused at the Request
//    stage and failed never reaches the server; paused at the Response stage
//    and failed, the request WAS sent and processed by the real backend (the
//    commit is observable read-only in the database) while the page sees the
//    same socket-level failure the dropper produces. Both are labeled as
//    controlled transport in the suite evidence; neither stands in for the
//    real Pi runtime, which runs for real in every case.
// 2. Request-body capture. Every /api/candidates/* request is paused at the
//    Request stage and continued, so the faces observe the exact wire body —
//    including the `operationId` the compiled CandidateCard generated — plus
//    the session's CSRF header for verbatim in-page replays. The Network
//    domain records the full URL stream, so the faces can assert that a load
//    or an unknown response triggers NO candidate write.
//
// The page harness (startHarnessPage) serves the REAL production modules
// through the production vite pipeline (middleware mode, the same lineage as
// task-controls/capability-ui) and reverse-proxies /api to the locked
// backend, rewriting Host/Origin exactly like the D-suite dropper did — a
// controlled transport recorded in evidence, with no business bytes altered.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer, request as createHttpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const HARNESS_PAGE_PATH = '/tests/fixtures/web-text-intake/candidate-operations-browser-page/index.html';

export function resolveChrome() {
  return process.env.SIDEKICK_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

export function chromeAvailable() {
  return existsSync(resolveChrome());
}

const freePort = () => new Promise((resolvePromise, reject) => {
  const server = createHttpServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolvePromise(port));
  });
});

export function withDeadline(promise, label, deadline) {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded the remaining case budget (${Math.max(0, deadline - Date.now())}ms left)`)), Math.max(250, deadline - Date.now()));
    timer.unref();
  });
  timeout.catch(() => {});
  promise.catch(() => {});
  return Promise.race([promise, timeout]);
}

async function waitForCdpTarget(port, child, getSpawnError, stderr, deadline) {
  for (;;) {
    const spawnError = getSpawnError();
    if (spawnError) throw new Error(`Chrome spawn failed (${spawnError.code}); stderr: ${stderr.slice(-400)}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chrome exited (code=${child.exitCode}, signal=${child.signalCode}) before its DevTools endpoint came up on port ${port}; stderr: ${stderr.slice(-400)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page');
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch { /* chrome is still starting */ }
    if (Date.now() >= deadline) throw new Error(`Chrome DevTools endpoint never came up within the remaining case budget on port ${port}; stderr: ${stderr.slice(-400)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function killChildConfirmed(child, confirmMs) {
  try { child.kill('SIGKILL'); } catch { /* already dead */ }
  if (child.exitCode !== null || child.signalCode !== null) return { killed: true, exitConfirmed: true };
  const exitConfirmed = await new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), Math.max(250, confirmMs));
    timer.unref();
    child.once('exit', () => { clearTimeout(timer); resolvePromise(true); });
  });
  return { killed: true, exitConfirmed };
}

// The reverse proxy to the locked backend. The backend validates same-origin
// Host/Origin (frozen web-api/1), so the proxy rewrites both — the same
// header rewrite the locked tree's response dropper performs for the
// test-process client.
async function startHarnessPage({ backendOrigin, workDeadline }) {
  const deadline = workDeadline ?? (Date.now() + 14000);
  const report = { vite: null, http: null, origin: null };
  let vite = null;
  let httpServer = null;
  try {
    vite = await withDeadline(createViteServer({
      configFile: join(REPO_ROOT, 'vite.config.ts'),
      root: REPO_ROOT,
      server: {
        middlewareMode: true,
        hmr: false,
        fs: { strict: false },
        watch: { ignored: ['**'] },
        optimizeDeps: { include: ['vue', 'pinia'] },
        proxy: {
          '/api': {
            target: backendOrigin,
            changeOrigin: true,
            configure(proxy) {
              proxy.on('proxyReq', (proxyReq) => {
                if (proxyReq.getHeader('origin')) proxyReq.setHeader('Origin', backendOrigin);
              });
              // The one-shot page-traffic dropper destroys its upstream socket
              // to drop a response; http-proxy would synthesize a 502 — a
              // DEFINITE error envelope, not the dropper's socket-level
              // failure. Destroy the client socket instead so the page sees
              // the raw transport failure.
              proxy.on('error', (_error, _req, res) => {
                try { res?.socket?.destroy(); } catch { /* already gone */ }
              });
            },
          },
        },
        logLevel: 'error',
      },
    }), 'vite server create', deadline);
    report.vite = { ok: true };
    httpServer = createHttpServer((req, res) => { vite.middlewares(req, res); });
    await withDeadline(new Promise((resolvePromise, rejectPromise) => {
      httpServer.once('error', rejectPromise);
      httpServer.listen(0, '127.0.0.1', resolvePromise);
    }), 'http listener', deadline);
    const port = httpServer.address().port;
    report.http = { ok: true, port };
    report.origin = `http://127.0.0.1:${port}`;
    return {
      origin: report.origin,
      async close() {
        const steps = {};
        if (vite) {
          try { await vite.close(); steps.vite = { ok: true }; } catch (error) { steps.vite = { ok: false, detail: String(error) }; }
        }
        if (httpServer) {
          try { await new Promise((resolvePromise) => httpServer.close(resolvePromise)); steps.http = { ok: true }; } catch (error) { steps.http = { ok: false, detail: String(error) }; }
        }
        return steps;
      },
    };
  } catch (error) {
    if (vite) { try { await vite.close(); } catch { /* best effort on the failure path */ } }
    if (httpServer) { try { httpServer.close(); } catch { /* best effort on the failure path */ } }
    error.cleanupReport = report;
    throw error;
  }
}

export { startHarnessPage };

// One-shot page-traffic response dropper — the browser-suite counterpart of
// the locked tree's candidate-operations-response-dropper.mjs. The locked
// script is an all-traffic test-process proxy that a same-origin page cannot
// traverse, so this suite owns the same mechanism at the page's proxy hop:
// forward every request to the backend (Host/Origin rewritten exactly like
// the locked dropper), pipe responses back normally — EXCEPT the first
// request whose URL includes the armed selector: its response is dropped and
// both sockets are destroyed on the first upstream response byte. The commit
// therefore lands (observable read-only in the database) while the page sees
// the same transport failure the locked dropper produces. One-shot and
// targeted: no other request in the case is affected.
export function startPageDropper(targetOrigin) {
  const target = new URL(targetOrigin);
  const targetHost = target.host;
  const targetOriginHeader = `http://${targetHost}`;
  // Every socket this proxy holds — the downstream connections it accepts
  // (INCLUDING one parked mid-request-head, for which the http.Server request
  // handler never fires) and the upstream requests it opens. `close()` must be
  // able to release all of them itself: `server.close()` waits for live
  // connections, so an unfinished request would otherwise hold the listener
  // open and the suite's finally would outlive the case budget.
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };
  let armed = null;
  const server = createHttpServer((clientReq, clientRes) => {
    const matched = armed !== null && clientReq.url.includes(armed.urlIncludes);
    if (matched) armed = null;
    const upstream = createHttpRequest({
      host: target.hostname,
      port: target.port,
      method: clientReq.method,
      path: clientReq.url,
      headers: { ...clientReq.headers, host: targetHost, ...(clientReq.headers.origin ? { origin: targetOriginHeader } : {}) },
    });
    track(upstream);
    if (matched) {
      // The drop path: forward the request bytes; the moment the upstream
      // response HEADERS arrive (the first response bytes — the commit has
      // already happened server-side), destroy both sockets so the client
      // never sees status or body.
      clientReq.pipe(upstream);
      const drop = () => {
        try { upstream.destroy(); } catch { /* already gone */ }
        try { clientRes.socket?.destroy(); } catch { /* already gone */ }
      };
      upstream.on('response', drop);
      upstream.on('error', drop);
      clientReq.on('error', () => { try { upstream.destroy(); } catch { /* already gone */ } });
      return;
    }
    // Pass-through path: normal proxying.
    clientReq.pipe(upstream);
    upstream.on('response', (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    });
    upstream.on('error', () => {
      try { clientRes.socket?.destroy(); } catch { /* already gone */ }
    });
    clientRes.on('close', () => { try { upstream.destroy(); } catch { /* already gone */ } });
  });
  // The http.Server request handler only runs once a request head is complete;
  // a half-sent head would leave the accepted socket untracked. Track every
  // connection at the socket layer instead.
  server.on('connection', track);
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      let closePromise = null;
      resolvePromise({
        origin: `http://127.0.0.1:${port}`,
        dropNext(urlIncludes) { armed = { urlIncludes }; },
        consumeReport() {
          // Truth about the last arm: whether a matching request was dropped
          // (armed cleared) or never arrived.
          return { fired: armed === null };
        },
        close() {
          // Idempotent and self-sufficient: stop accepting, destroy every
          // socket this proxy holds (finished or not), then let the listener
          // finish. No external client destruction may be required.
          if (!closePromise) {
            closePromise = new Promise((done) => {
              server.close(() => done());
              for (const socket of sockets) {
                try { socket.destroy(); } catch { /* already gone */ }
              }
              sockets.clear();
            });
          }
          return closePromise;
        },
      });
    });
  });
}

export async function startCandidateBrowser({ profileDir, width = 1280, workDeadline } = {}) {
  // Startup and per-case budgets are separate. `startupDeadline` is spent once
  // while Chrome comes up; every CDP command after that draws on `caseDeadline`,
  // which the caller re-arms at the start of each case (`browser.deadline = …`).
  // A long suite must not inherit one absolute startup deadline for all later
  // cases: once it passes, every later command would be squeezed to the 250ms
  // floor and fail for reasons unrelated to the behavior under test.
  const startupDeadline = workDeadline ?? (Date.now() + 14000);
  let caseDeadline = startupDeadline;
  const port = await freePort();
  const child = spawn(resolveChrome(), [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-extensions', '--use-mock-keychain',
    ...(profileDir ? [`--user-data-dir=${profileDir}`] : []),
    `--remote-debugging-port=${port}`, `--window-size=${width},1000`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let spawnError = null;
  child.on('error', (error) => { spawnError = error; });
  let socket = null;
  try {
    const target = await withDeadline(waitForCdpTarget(port, child, () => spawnError, stderr, startupDeadline), 'Chrome DevTools endpoint', startupDeadline);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await withDeadline(new Promise((resolvePromise, rejectPromise) => {
      socket.onopen = resolvePromise;
      socket.onerror = () => rejectPromise(new Error(`CDP WebSocket connection failed; chrome stderr: ${stderr.slice(-400)}`));
    }), 'CDP WebSocket open', startupDeadline);
    let nextId = 0;
    const pending = new Map();
    const fetchEvents = [];
    const armedDrops = [];
    const candidateRequests = [];
    const networkLog = [];
    const send = (method, params = {}, timeoutMs) => new Promise((resolvePromise, rejectPromise) => {
      nextId += 1;
      const id = nextId;
      const bound = Math.max(250, timeoutMs ?? Math.min(30000, caseDeadline - Date.now()));
      pending.set(id, (message) => {
        if (message.error) rejectPromise(new Error(`CDP ${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`));
        else resolvePromise(message);
      });
      socket.send(JSON.stringify({ id, method, params }));
      const timer = setTimeout(() => {
        if (pending.delete(id)) rejectPromise(new Error(`CDP ${method} did not answer within ${bound}ms (remaining case budget discipline)`));
      }, bound);
      timer.unref();
    });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
      if (message.method === 'Fetch.requestPaused') fetchEvents.push(message.params);
      if (message.method === 'Network.requestWillBeSent') {
        networkLog.push({ url: message.params.request.url, method: message.params.request.method, ts: Date.now() });
      }
    };
    const pump = setInterval(() => {
      for (const params of fetchEvents.splice(0)) {
        const request = params.request ?? {};
        const stage = (params.responseStatusCode !== undefined || params.responseErrorReason !== undefined) ? 'response' : 'request';
        const dropIndex = armedDrops.findIndex((drop) => drop.stage === stage && request.url.includes(drop.urlIncludes));
        const dropped = dropIndex >= 0;
        if (dropped) {
          const drop = armedDrops.splice(dropIndex, 1)[0];
          send('Fetch.failRequest', { requestId: params.requestId, errorReason: drop.errorReason ?? 'ConnectionReset' }, 8000).catch(() => {});
        } else if (stage === 'request') {
          send('Fetch.continueRequest', { requestId: params.requestId }, 8000).catch(() => {});
        } else {
          send('Fetch.continueResponse', { requestId: params.requestId }, 8000).catch(() => {});
        }
        candidateRequests.push({
          url: request.url, method: request.method, stage,
          postData: request.postData ?? null,
          csrfToken: request.headers?.['x-csrf-token'] ?? request.headers?.['X-CSRF-Token'] ?? null,
          dropped, ts: Date.now(),
        });
      }
    }, 5);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Fetch.enable', {
      patterns: [
        { urlPattern: '*://*/api/candidates/*', interceptionStage: 'Request' },
        { urlPattern: '*://*/api/candidates/*', interceptionStage: 'Response' },
      ],
    });
    // The pump defers continuation by one interval; two failsafe drains keep
    // the event queue from outliving close().
    return {
      // The suite's per-case budget control: each test assigns a fresh window
      // (e.g. `browser.deadline = caseDeadline()`), so a later case always has
      // its own 20s instead of inheriting the session's startup deadline.
      get deadline() { return caseDeadline; },
      set deadline(value) { caseDeadline = value; },
      async navigate(url) {
        await send('Page.navigate', { url });
        // Waiting for the app to mount belongs to the caller (waitForFunction
        // on the harness DOM), so every case observes its own load.
      },
      async evaluate(expression) {
        const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (reply.result?.exceptionDetails) {
          throw new Error(`in-page evaluation failed: ${JSON.stringify(reply.result.exceptionDetails).slice(0, 600)}`);
        }
        return reply.result?.result?.value;
      },
      async waitForFunction(predicateExpression, timeoutMs = 15000, intervalMs = 100) {
        const bounded = Math.min(timeoutMs, Math.max(250, caseDeadline - Date.now()));
        const localDeadline = Date.now() + bounded;
        for (;;) {
          const done = await this.evaluate(predicateExpression);
          if (done) return true;
          if (Date.now() >= localDeadline) return false;
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      },
      candidateRequests() { return candidateRequests.slice(); },
      networkLog() { return networkLog.slice(); },
      // Per-page-load reset: the faces reason about THEIR OWN case's requests;
      // earlier cases' captures must never leak into a later case's counts.
      resetObserved() {
        candidateRequests.length = 0;
        networkLog.length = 0;
      },
      candidatePosts() { return candidateRequests.filter((entry) => entry.method === 'POST' && entry.stage === 'request'); },
      lastCsrfToken() {
        for (let index = candidateRequests.length - 1; index >= 0; index -= 1) {
          if (candidateRequests[index].csrfToken) return candidateRequests[index].csrfToken;
        }
        return null;
      },
      // One-shot: the next candidate request whose URL includes `urlIncludes`
      // is failed at `stage` (Request = never sent; Response = sent and
      // processed by the backend, response destroyed).
      dropNext(urlIncludes, { stage = 'response', errorReason = 'ConnectionReset' } = {}) {
        armedDrops.push({ urlIncludes, stage, errorReason });
      },
      async close({ exitConfirmMs = 4000 } = {}) {
        clearInterval(pump);
        let socketClosed = false;
        try { socket.close(); socketClosed = true; } catch { socketClosed = true; }
        return { socketClosed, ...(await killChildConfirmed(child, exitConfirmMs)) };
      },
    };
  } catch (startupError) {
    let socketClosed = false;
    if (socket) {
      try { socket.close(); socketClosed = true; } catch { socketClosed = true; }
    }
    const reclaim = spawnError
      ? { killed: false, exitConfirmed: true, note: `spawn failed: ${spawnError.code || spawnError.message}` }
      : await killChildConfirmed(child, 4000);
    startupError.chromeReclaim = { socketClosed, ...reclaim };
    throw startupError;
  }
}
