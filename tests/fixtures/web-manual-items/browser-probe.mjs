// Browser probe for the same-origin acceptance suites (MAYNE-23 slice II, revision r2).
// Drives headless Chrome through the DevTools Protocol and evaluates an in-page probe, so
// the assertions observe what the browser actually rendered and reached — not the static
// index.html on disk. The retired --dump-dom check could be satisfied by the empty
// <div id="app"></div> of an unmounted Vite page; this probe distinguishes a mounted
// application from an empty mount point, measures horizontal overflow, and lets the page
// itself reach /api/session and /api/events same-origin. Zero dependencies: the DevTools
// WebSocket uses the built-in client.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

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

// In-page probe evaluated through the Chrome DevTools Protocol. It runs inside the served
// page, so it observes the rendered DOM and the requests the page itself made: whether the
// application mounted into #app, whether every static reference stays same-origin, the
// same-origin /api/session and /api/events answers, and the horizontal overflow measurement.
export const PAGE_PROBE = `(async () => {
  const waitFor = async (predicate, deadlineMs) => {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      if (predicate()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const mounted = await waitFor(() => {
    const element = document.getElementById('app');
    return !!element && (element.childElementCount > 0 || element.getAttribute('data-probe') === 'ready');
  }, 5000);
  const element = document.getElementById('app');
  const refs = [...document.querySelectorAll('script[src],link[href],img[src]')]
    .map((node) => node.getAttribute('src') || node.getAttribute('href') || '')
    .filter((value) => value.length > 0);
  const sameOrigin = (value) => {
    try { return new URL(value, location.href).origin === location.origin; } catch { return false; }
  };
  const settle = async (path) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(path, { credentials: 'same-origin', signal: controller.signal });
      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: response.status, contentType, json, body: text.slice(0, 240) };
    } catch (error) { return { fetchError: String(error) }; }
  };
  return {
    href: location.href,
    origin: location.origin,
    title: document.title,
    mounted,
    app: {
      present: !!element,
      childElementCount: element ? element.childElementCount : 0,
      textLength: element ? (element.textContent ?? '').trim().length : 0,
      dataProbe: element ? element.getAttribute('data-probe') : null,
    },
    refs,
    crossOriginRefs: refs.filter((value) => !sameOrigin(value)),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
    overflow: document.documentElement.scrollWidth <= window.innerWidth,
    session: await settle('/api/session'),
    events: await settle('/api/events'),
  };
})()`;

// Shared cold-start assertions for the served page, used by the static suite and by the F-3
// counter-example probe so both check exactly the same properties. mode 'synthetic' signs
// fixture mechanics only; a real-dist mode ('packaged' / 'explicit') requires the product UI
// itself to have mounted into #app in the live DOM — an empty <div id="app"></div> inside
// index.html is not evidence, which is exactly what the retired dump-dom check accepted.
export function assertColdStartReport(report, options = {}) {
  const { origin, mode = 'packaged', width } = options;
  assert.equal(report.origin, origin, 'the page must be served from the backend origin');
  assert.equal(report.app.present, true, 'the served page must contain the application mount point');
  if (mode === 'synthetic') {
    assert.equal(report.mounted, true, 'the synthetic fixture page must report a mounted probe');
    assert.equal(report.app.dataProbe, 'ready', 'the synthetic probe script must have run into the page');
  } else {
    assert.equal(report.mounted, true,
      `the application must mount into #app in the live DOM (childElementCount=${report.app.childElementCount}, `
      + `textLength=${report.app.textLength}); an empty #app inside index.html is not evidence of a mounted UI`);
    assert.ok(report.app.childElementCount > 0, 'the mounted application must render elements into #app');
    assert.ok(report.app.textLength > 0, 'the mounted application must render text into #app');
  }
  assert.deepEqual(report.crossOriginRefs, [], `all static references must be same-origin: ${JSON.stringify(report.crossOriginRefs)}`);
  assert.ok(!report.session.fetchError, `the page must reach /api/session same-origin: ${report.session.fetchError ?? ''}`);
  assert.equal(report.session.status, 401, 'the unpaired page must reach /api/session same-origin and be told to pair');
  assert.match(report.session.contentType, /^application\/json/, '/api/session must answer JSON, not HTML');
  assert.equal(report.session.json?.contractVersion, 'web-api/1', '/api/session must answer with the frozen envelope');
  assert.equal(report.session.json?.error?.code, 'unauthenticated', '/api/session must answer with the frozen envelope');
  assert.ok(!report.events.fetchError, `the page must reach /api/events same-origin: ${report.events.fetchError ?? ''}`);
  assert.equal(report.events.status, 401, 'the page must reach /api/events same-origin');
  assert.match(report.events.contentType, /^application\/json/, '/api/events must answer JSON, not HTML');
  assert.equal(report.events.json?.contractVersion, 'web-api/1', '/api/events must answer with the frozen envelope');
  assert.equal(report.events.json?.error?.code, 'unauthenticated', '/api/events must answer with the frozen envelope');
  assert.equal(report.overflow, true,
    `the page must not overflow horizontally${width ? ` at ${width}px` : ''} `
    + `(scrollWidth=${report.scrollWidth}, innerWidth=${report.innerWidth})`);
}

async function waitForCdpTarget(port, stderr) {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page');
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch { /* chrome is still starting */ }
    if (Date.now() >= deadline) throw new Error(`Chrome DevTools endpoint never came up on port ${port}; stderr: ${stderr}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Launches headless Chrome on an ephemeral debugging port, navigates to url at the given
// viewport width, evaluates PAGE_PROBE inside the page, and returns the report together with
// the live DOM and a screenshot. The Chrome process is always killed before returning.
export async function probeWithChrome(url, width, options = {}) {
  const { profileDir } = options;
  const chrome = resolveChrome();
  const port = await freePort();
  const child = spawn(chrome, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-extensions', '--use-mock-keychain',
    ...(profileDir ? [`--user-data-dir=${profileDir}`] : []),
    `--remote-debugging-port=${port}`, `--window-size=${width},1000`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const target = await waitForCdpTarget(port, stderr);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolvePromise, reject) => {
      socket.onopen = resolvePromise;
      socket.onerror = () => reject(new Error(`CDP WebSocket connection failed; chrome stderr: ${stderr}`));
    });
    let nextId = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
      nextId += 1;
      const id = nextId;
      pending.set(id, resolvePromise);
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP ${method} did not answer within 30s`));
      }, 30000).unref();
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 1500));
    const evaluated = await send('Runtime.evaluate', { expression: PAGE_PROBE, awaitPromise: true, returnByValue: true });
    if (evaluated.result?.exceptionDetails) {
      throw new Error(`the in-page probe threw: ${JSON.stringify(evaluated.result.exceptionDetails)}`);
    }
    const report = evaluated.result?.result?.value;
    if (!report) throw new Error(`the in-page probe returned no value: ${JSON.stringify(evaluated.result)}`);
    const dom = await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true });
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    socket.close();
    return { report, dom: dom.result?.result?.value ?? '', screenshot: screenshot.result?.data ?? null };
  } finally {
    child.kill('SIGKILL');
  }
}
