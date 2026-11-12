// Browser probe for the W1 text-intake same-origin acceptance suite
// (MAYNE-24 slice II, T-14). Drives headless Chrome through the DevTools
// Protocol and evaluates an in-page probe, so the assertions observe what the
// browser actually rendered and reached — not the static index.html on disk.
//
// The probe reports: whether the application mounted into #app in the live
// DOM, the static reference classification (same-origin http(s) network
// references, inline data: resources, unexpected schemes), horizontal
// overflow, the same-origin /api/session and /api/events answers, the
// pairing-gate visibility and the text-intake entry state (the capture
// dialog's 文本智能整理 tab: enabled vs the base tree's disabled
// "未接通" state). A separate evaluate() channel lets the suite drive the
// real UI (pair, open the capture dialog, fill the intake form) and re-probe.
//
// Zero dependencies: the DevTools WebSocket uses the built-in client.
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

// In-page probe evaluated through the Chrome DevTools Protocol. It runs
// inside the served page, so it observes the rendered DOM and the requests
// the page itself made.
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
  }, 8000);
  const element = document.getElementById('app');
  const refs = [...document.querySelectorAll('script[src],link[href],img[src]')]
    .map((node) => node.getAttribute('src') || node.getAttribute('href') || '')
    .filter((value) => value.length > 0);
  const classify = (value) => {
    let url;
    try { url = new URL(value, location.href); } catch { return { value, kind: 'unparseable' }; }
    if (url.protocol === 'data:') {
      const comma = value.indexOf(',');
      return { value, kind: 'inline-data', mediaType: comma < 0 ? '' : value.slice('data:'.length, comma), payloadLength: comma < 0 ? 0 : value.length - comma - 1 };
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') return { value, kind: 'network', origin: url.origin };
    return { value, kind: 'unexpected-scheme', protocol: url.protocol };
  };
  const classified = refs.map((value) => classify(value));
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
  const pairingGate = document.querySelector('.pairing-gate');
  const nav = document.querySelector('nav');
  const text = (document.body.textContent ?? '').replace(/\\s+/g, ' ');
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
    classified,
    crossOriginRefs: classified.filter((entry) => entry.kind === 'network' && entry.origin !== location.origin).map((entry) => entry.value),
    inlineDataRefs: classified.filter((entry) => entry.kind === 'inline-data'),
    unexpectedRefs: classified.filter((entry) => entry.kind !== 'network' && entry.kind !== 'inline-data').map((entry) => entry.value),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflow: document.documentElement.scrollWidth <= window.innerWidth,
    session: await settle('/api/session'),
    events: await settle('/api/events'),
    pairing: {
      gateVisible: !!pairingGate,
      gateHeading: pairingGate ? (pairingGate.querySelector('h1')?.textContent ?? '') : null,
      hasCodeInput: !!document.querySelector('input[aria-label="配对码"]'),
    },
    workbench: {
      navVisible: !!nav,
      navItems: nav ? [...nav.querySelectorAll('button')].map((node) => (node.textContent ?? '').replace(/\\s+/g, ' ').trim()) : [],
      inboxDisabled: nav ? [...nav.querySelectorAll('button')].some((node) => /待确认/.test(node.textContent ?? '') && node.disabled) : null,
      hasCaptureEntry: /整理一段原文|记录第一条|记录一条/.test(text),
    },
  };
})()`;

async function waitForCdpTarget(port, stderr) {
  // Bounded well inside the frozen 20000ms case budget (happy path: Chrome's
  // DevTools endpoint answers within a couple of seconds), so a Chrome that
  // never comes up fails with this named error instead of being killed by the
  // case timeout as an opaque budget kill.
  const deadline = Date.now() + 10000;
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

// Launches headless Chrome on an ephemeral debugging port, navigates to url
// at the given viewport width, evaluates PAGE_PROBE inside the page, and
// returns the report together with the live DOM, a screenshot and an
// evaluate() channel for driving the real UI. The Chrome process is always
// killed before returning.
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
    const observedRequests = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
      if (message.method === 'Network.requestWillBeSent' && message.params?.request?.url) {
        const requestUrl = message.params.request.url;
        let origin = 'unparseable';
        try { origin = new URL(requestUrl).origin; } catch { /* keep the unparseable marker */ }
        observedRequests.push({ url: requestUrl, origin, resourceType: message.params.type ?? null });
      }
    };
    const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
      nextId += 1;
      const id = nextId;
      pending.set(id, resolvePromise);
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP ${method} did not answer within 10s`));
      }, 10000).unref();
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 1500));
    const evaluate = async (expression, { awaitPromise = true } = {}) => {
      const evaluated = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      if (evaluated.result?.exceptionDetails) {
        throw new Error(`the in-page evaluation threw: ${JSON.stringify(evaluated.result.exceptionDetails)}`);
      }
      return evaluated.result?.result?.value;
    };
    const report = await evaluate(PAGE_PROBE);
    if (!report) throw new Error(`the in-page probe returned no value`);
    report.networkRequests = observedRequests;
    const dom = await evaluate('document.documentElement.outerHTML', { awaitPromise: false });
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    // The browser stays alive for the returned evaluate/navigate channel; the
    // caller MUST call close(), which kills the Chrome process. (Killing it in
    // a finally here would strand every post-probe interaction on a dead
    // browser.)
    let closed = false;
    return {
      report,
      dom: dom ?? '',
      screenshot: screenshot.result?.data ?? null,
      evaluate,
      async navigate(nextUrl) {
        await send('Page.navigate', { url: nextUrl });
        await new Promise((r) => setTimeout(r, 1500));
      },
      close() {
        if (closed) return;
        closed = true;
        socket.close();
        child.kill('SIGKILL');
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

// Shared cold-start assertions for the served page. mode 'synthetic' signs
// fixture mechanics only; a real-dist mode ('packaged' / 'explicit') requires
// the product UI itself to have mounted into #app in the live DOM.
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
  assert.deepEqual(report.crossOriginRefs, [],
    `every http(s) static reference must be same-origin: ${JSON.stringify(report.crossOriginRefs)}`);
  assert.deepEqual(report.unexpectedRefs, [],
    `no static reference may use an unexpected scheme (only same-origin http(s) and inline data: are accepted): `
    + JSON.stringify(report.unexpectedRefs));
  for (const entry of report.inlineDataRefs ?? []) {
    assert.ok(entry.payloadLength > 0, `an inline data: reference must carry a payload: ${String(entry.value).slice(0, 80)}`);
  }
  assert.ok(Array.isArray(report.networkRequests), 'the probe must report the network requests the browser observed');
  const inlineDataRequests = (report.networkRequests ?? []).filter((entry) => /^data:/i.test(entry.url));
  for (const entry of inlineDataRequests) {
    const comma = entry.url.indexOf(',');
    assert.ok(comma >= 0 && entry.url.length > comma + 1, `an inline data: request must carry a payload: ${entry.url.slice(0, 80)}`);
  }
  const realNetworkRequests = (report.networkRequests ?? []).filter((entry) => !/^data:/i.test(entry.url));
  const foreignRequests = realNetworkRequests.filter((entry) => entry.origin !== report.origin).map((entry) => entry.url);
  assert.deepEqual(foreignRequests, [],
    `every real network request the page issued must be same-origin: ${JSON.stringify(foreignRequests)}`);
  assert.ok(!report.session.fetchError, `the page must reach /api/session same-origin: ${report.session.fetchError ?? ''}`);
  assert.equal(report.session.status, 401, 'the unpaired page must reach /api/session same-origin and be told to pair');
  assert.match(report.session.contentType, /^application\/json/, '/api/session must answer JSON, not HTML');
  assert.equal(report.session.json?.contractVersion, 'web-api/2', '/api/session must answer with the frozen envelope');
  assert.equal(report.session.json?.error?.code, 'unauthenticated', '/api/session must answer with the frozen envelope');
  assert.ok(!report.events.fetchError, `the page must reach /api/events same-origin: ${report.events.fetchError ?? ''}`);
  assert.equal(report.events.status, 401, 'the page must reach /api/events same-origin');
  assert.match(report.events.contentType, /^application\/json/, '/api/events must answer JSON, not HTML');
  assert.equal(report.events.json?.contractVersion, 'web-api/2', '/api/events must answer with the frozen envelope');
  assert.equal(report.events.json?.error?.code, 'unauthenticated', '/api/events must answer with the frozen envelope');
  assert.equal(report.overflow, true,
    `the page must not overflow horizontally${width ? ` at ${width}px` : ''} `
    + `(scrollWidth=${report.scrollWidth}, innerWidth=${report.innerWidth})`);
}

// Pair inside the real page: the one-time code is typed into the product's
// own pairing input (Vue reactivity is driven through the native value setter
// and a real input event) and the product's own form is submitted. The code
// never leaves the test process except in this request body.
export async function pairInPage(evaluate, code) {
  return evaluate(`(async () => {
    const input = document.querySelector('input[aria-label="配对码"]');
    if (!input) return { ok: false, reason: 'pairing code input not found in the served UI' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(code)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const form = document.querySelector('form.pairing-form');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.querySelector('button[type=submit]')?.click();
    const deadline = Date.now() + 10000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 100));
      if (!document.querySelector('.pairing-gate')) return { ok: true };
      if (Date.now() >= deadline) {
        const error = document.querySelector('.pairing-gate .form-error');
        return { ok: false, reason: 'the pairing gate did not close', error: error?.textContent ?? null };
      }
    }
  })()`);
}

// Open the capture dialog on the text-intake tab through the product's own
// controls and report the intake entry's state.
export async function openIntakeEntry(evaluate) {
  return evaluate(`(async () => {
    const openButton = [...document.querySelectorAll('button')].find((node) => /整理一段原文/.test(node.textContent ?? ''));
    if (!openButton) return { ok: false, reason: 'the capture entry (整理一段原文) is not present in the served UI' };
    openButton.click();
    await new Promise((r) => setTimeout(r, 300));
    const tab = [...document.querySelectorAll('[role=tab]')].find((node) => /文本智能整理/.test(node.textContent ?? ''));
    const textarea = document.querySelector('form.text-intake textarea');
    return {
      ok: true,
      tabPresent: !!tab,
      tabDisabled: tab ? tab.disabled : null,
      tabTitle: tab ? (tab.getAttribute('title') ?? '') : null,
      formPresent: !!textarea,
    };
  })()`);
}

// Fill the intake textarea through the product's own form and submit it.
export async function submitIntakeText(evaluate, text) {
  return evaluate(`(async () => {
    const textarea = document.querySelector('form.text-intake textarea');
    if (!textarea) return { ok: false, reason: 'the intake textarea is not present' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, ${JSON.stringify(text)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const submit = [...document.querySelectorAll('form.text-intake button')].find((node) => /开始整理/.test(node.textContent ?? ''));
    if (!submit) return { ok: false, reason: 'the 开始整理 submit button is not present' };
    if (submit.disabled) return { ok: false, reason: 'the 开始整理 submit button is disabled in the served UI' };
    submit.click();
    return { ok: true };
  })()`);
}

// Drive a real manual-item write through the product's own capture form. Used
// as the authenticated request that surfaces an in-session 401: the product's
// session-lost path only fires on a request through its own API client, so a
// revoked session becomes visible exactly when the user next acts.
export async function writeManualItemInPage(evaluate, title) {
  return evaluate(`(async () => {
    const open = [...document.querySelectorAll('button')].find((node) => /记录第一条|记录一条/.test(node.textContent ?? ''));
    if (!open) return { ok: false, reason: 'the capture entry (记录第一条/记录一条) is not present' };
    open.click();
    await new Promise((r) => setTimeout(r, 400));
    const input = document.querySelector('input[placeholder="要做什么，或需要盯住什么？"]');
    if (!input) return { ok: false, reason: 'the manual capture title input is not present' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const save = [...document.querySelectorAll('button')].find((node) => /保存事项/.test(node.textContent ?? ''));
    if (!save) return { ok: false, reason: 'the 保存事项 submit button is not present' };
    save.click();
    await new Promise((r) => setTimeout(r, 2500));
    return { ok: true, gateVisible: !!document.querySelector('.pairing-gate'), error: document.querySelector('.form-error')?.textContent ?? null };
  })()`);
}
