// Headless-Chrome DevTools driver for the capability-UI behavioral faces.
// Zero dependencies: the DevTools WebSocket uses the built-in client, the same
// pattern as tests/fixtures/web-manual-items/browser-probe.mjs (MAYNE-23 slice II
// r3). Unlike that probe fixture, this driver stays connected across many
// evaluations so the faces can mount panels, trigger real events, and read the
// resulting DOM through one browser session.
//
// Reclaim + budget contract (hardened per coordinator dispatch 01a1c1b2):
// - From the moment startChrome spawns the child, EVERY failure path below is
//   inside the try block: the socket (when it exists) is closed, the child is
//   SIGKILLed and its exit is confirmed BEFORE the startup error propagates,
//   with the reclaim record attached to the error (error.chromeReclaim). The
//   session layer never sees a window where this child exists without a
//   handle that kills it.
// - All waits (DevTools endpoint, WebSocket open, every CDP call, in-page
//   waits) are bounded by the caller's work deadline — the case entry's
//   remaining hard budget — never by naked fixed constants. The DevTools
//   wait also fails fast once the child has exited (or failed to spawn), so
//   a binary that is not Chrome does not burn the whole budget polling a
//   port nothing will ever serve.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

export function resolveChrome() {
  return process.env.SIDEKICK_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

export function chromeAvailable() {
  return existsSync(resolveChrome());
}

const freePort = () => new Promise((resolvePromise, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolvePromise(port));
  });
});

// Race a promise against a deadline. The loser of the race must never crash
// the process with a late unhandled rejection, so both sides get a no-op
// handler up front; the original rejection still reaches whoever is waiting.
export function withDeadline(promise, label, deadline) {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded the remaining case budget (${Math.max(0, deadline - Date.now())}ms left)`)), Math.max(250, deadline - Date.now()));
    timer.unref();
  });
  timeout.catch(() => {});
  promise.catch(() => {});
  return Promise.race([promise, timeout]);
}

// Wait for the DevTools HTTP endpoint. Bounded by the caller's work deadline
// and fail-fast: a child that has already exited (or failed to spawn) throws
// immediately instead of polling until the deadline.
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

// Kill this test's own chrome child and confirm the exit within confirmMs.
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

export async function startChrome({ profileDir, width = 1280, workDeadline, chromePath } = {}) {
  const chromePathResolved = chromePath || resolveChrome();
  const deadline = workDeadline ?? (Date.now() + 14000);
  const port = await freePort();
  const child = spawn(chromePathResolved, [
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
  let send = null;
  try {
    const target = await withDeadline(waitForCdpTarget(port, child, () => spawnError, stderr, deadline), 'Chrome DevTools endpoint', deadline);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await withDeadline(new Promise((resolvePromise, reject) => {
      socket.onopen = resolvePromise;
      socket.onerror = () => reject(new Error(`CDP WebSocket connection failed; chrome stderr: ${stderr.slice(-400)}`));
    }), 'CDP WebSocket open', deadline);
    let nextId = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    };
    send = (method, params = {}, timeoutMs) => new Promise((resolvePromise, reject) => {
      nextId += 1;
      const id = nextId;
      const bound = Math.max(250, timeoutMs ?? Math.min(30000, deadline - Date.now()));
      pending.set(id, resolvePromise);
      socket.send(JSON.stringify({ id, method, params }));
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP ${method} did not answer within ${bound}ms (remaining case budget discipline)`));
      }, bound);
      timer.unref();
    });
    await send('Page.enable');
    await send('Runtime.enable');
  } catch (startupError) {
    // Reclaim path: whatever the failure, this function owns the child and
    // must not hand a half-started chrome to anyone. Close the socket when it
    // exists, terminate, and confirm the exit before propagating.
    let socketClosed = false;
    if (socket) {
      try { socket.close(); socketClosed = true; } catch { socketClosed = true; /* already closed */ }
    }
    const reclaim = spawnError
      ? { killed: false, exitConfirmed: true, note: `spawn failed: ${spawnError.code || spawnError.message}` }
      : await killChildConfirmed(child, 4000);
    startupError.chromeReclaim = { socketClosed, ...reclaim };
    throw startupError;
  }
  return {
    async navigate(url) {
      await send('Page.navigate', { url });
    },
    async evaluate(expression) {
      const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (reply.result?.exceptionDetails) {
        throw new Error(`in-page evaluation failed: ${JSON.stringify(reply.result.exceptionDetails).slice(0, 600)}`);
      }
      return reply.result?.result?.value;
    },
    async waitForFunction(predicateExpression, timeoutMs = 15000, intervalMs = 100) {
      const bounded = Math.min(timeoutMs, Math.max(250, deadline - Date.now()));
      const localDeadline = Date.now() + bounded;
      for (;;) {
        const done = await this.evaluate(predicateExpression);
        if (done) return true;
        if (Date.now() >= localDeadline) return false;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
    async close({ exitConfirmMs = 4000 } = {}) {
      let socketClosed = false;
      try { socket.close(); socketClosed = true; } catch { socketClosed = true; /* already closed */ }
      return { socketClosed, ...(await killChildConfirmed(child, exitConfirmMs)) };
    },
  };
}
