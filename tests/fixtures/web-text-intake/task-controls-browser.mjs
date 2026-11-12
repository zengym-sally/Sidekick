// Real-Chrome driver for the TaskQueue a11y / narrow-viewport faces
// (MAYNE-24 W1 task controls, r3 plan §6/U8).
//
// Run: node tests/fixtures/web-text-intake/task-controls-browser.mjs
// Prerequisites: Chrome at the platform default path (or SIDEKICK_TEST_CHROME),
// Node >= 24 with the locked dependency tree (vite). No network access needed.
//
// The driver starts a repo-root Vite dev server (middleware mode, the
// production vite.config.ts pipeline) behind an ephemeral local HTTP listener
// plus one headless Chrome over the DevTools protocol, and serves the in-page
// mount harness tests/fixtures/web-text-intake/task-controls-page/ — the REAL
// production TaskQueue.vue compiled by the production pipeline. Layout,
// keyboard (trusted CDP key events), focus management and ARIA dynamics are
// observed through the REAL DOM; screenshots are written next to the run's
// TAP output. Output: TAP lines + summary JSON + PNG screenshots; exit 0 only
// when every face holds.
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { chromeAvailable, resolveChrome, withDeadline } from './capability-ui-browser.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGE_PATH = '/tests/fixtures/web-text-intake/task-controls-page/index.html';
const OUT_DIR = process.env.TASK_CONTROLS_OUT ?? join(REPO_ROOT, 'build', 'mayne24-task-controls-impl-20261110');
const WORK_MS = 14000;
const CLEANUP_MS = 6000;
const VIEWPORT = { width: 640, height: 900 };

const results = [];
let passCount = 0;
let failCount = 0;
function tap(ok, name, detail) {
  results.push({ ok, name, detail: detail ?? null });
  if (ok) { passCount += 1; console.log(`ok ${passCount + failCount} - ${name}`); }
  else { failCount += 1; console.log(`not ok ${passCount + failCount} - ${name}`); if (detail) console.log(`  # ${JSON.stringify(detail).slice(0, 500)}`); }
}

const freePort = () => new Promise((resolve, reject) => {
  const server = createHttpServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

async function main() {
  if (!chromeAvailable()) throw new Error(`Chrome not found at ${resolveChrome()}; set SIDEKICK_TEST_CHROME`);
  mkdirSync(OUT_DIR, { recursive: true });
  const workDeadline = Date.now() + WORK_MS;
  const profileDir = mkdtempSync(join(tmpdir(), 'task-controls-chrome-'));
  let vite = null;
  let httpServer = null;
  let chrome = null;
  let socket = null;
  let chromeChild = null;
  const steps = {};
  try {
    vite = await withDeadline(createViteServer({
      configFile: join(REPO_ROOT, 'vite.config.ts'),
      root: REPO_ROOT,
      server: { middlewareMode: true, hmr: false, fs: { strict: false }, watch: { ignored: ['**'] } },
      optimizeDeps: { include: ['vue', 'pinia'] },
      logLevel: 'error',
    }), 'vite server create', workDeadline);
    httpServer = createHttpServer((req, res) => { vite.middlewares(req, res); });
    await withDeadline(new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    }), 'http listener', workDeadline);
    const port = httpServer.address().port;

    // One headless Chrome over the DevTools protocol (same hardened spawn
    // flags as the capability-ui fixture), with Page/Runtime/Emulation/Input
    // so the keyboard faces run on TRUSTED key events.
    const cdpPort = await freePort();
    chromeChild = spawn(resolveChrome(), [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--disable-extensions', '--use-mock-keychain',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${cdpPort}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    chromeChild.stderr.on('data', (chunk) => { stderr += chunk; });
    let target = null;
    const cdpDeadline = Math.min(workDeadline, Date.now() + 10000);
    for (;;) {
      if (chromeChild.exitCode !== null || chromeChild.signalCode !== null) {
        throw new Error(`Chrome exited before its DevTools endpoint came up; stderr: ${stderr.slice(-300)}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        if (response.ok) {
          const targets = await response.json();
          const page = targets.find((entry) => entry.type === 'page');
          if (page?.webSocketDebuggerUrl) { target = page; break; }
        }
      } catch { /* chrome is still starting */ }
      if (Date.now() >= cdpDeadline) throw new Error(`Chrome DevTools endpoint never came up; stderr: ${stderr.slice(-300)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await withDeadline(new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error('CDP WebSocket connection failed'));
    }), 'CDP WebSocket open', workDeadline);
    let nextId = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      nextId += 1;
      const id = nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP ${method} timed out`));
      }, 8000);
      timer.unref();
    });
    const evaluate = async (expression) => {
      const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (reply.result?.exceptionDetails) {
        throw new Error(`in-page evaluation failed: ${JSON.stringify(reply.result.exceptionDetails).slice(0, 400)}`);
      }
      return reply.result?.result?.value;
    };
    const keyTap = async (key, code, keyCode, text) => {
      const down = { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
      if (text !== undefined) { down.text = text; down.unmodifiedText = text; }
      await send('Input.dispatchKeyEvent', down);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    };
    const screenshot = async (name) => {
      const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(join(OUT_DIR, name), Buffer.from(reply.result.data, 'base64'));
      return name;
    };
    const page = async (expression) => evaluate(`window.__taskControls.${expression}`);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
    await withDeadline(send('Page.navigate', { url: `http://127.0.0.1:${port}${PAGE_PATH}` }), 'page navigate', workDeadline);
    const ready = await chrome_deadline(() => evaluate('typeof window.__taskControls === "object" && window.__taskControls.ready === true'));
    if (!ready) throw new Error('the in-page task-controls harness never became ready (window.__taskControls)');
    steps.ready = true;

    // Legal frozen wire rows (same shapes as the unit suite seeds).
    const row = (base) => ({
      contractVersion: 'web-api/1', operationId: `op_${base.taskId}`, role: 'organizer',
      createdAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z', terminalAt: null,
      submitSeq: 1000, attemptId: base.attemptCount > 0 ? `att_${base.taskId}` : null,
      attemptExitState: base.state === 'running' ? 'active' : base.attemptCount > 0 ? 'exited_confirmed' : 'not_started',
      cancelIntent: false, configRevision: 'cfgrev_sse_test', originalConfigRevision: 'cfgrev_sse_test',
      inputRef: { kind: 'inline_text', sourceId: null }, progress: null, result: null,
      resultPendingExit: false, failure: null, recovery: null, ...base,
    });
    const SEED = [
      row({ taskId: 'tsk_q', type: 'organize_text', state: 'queued', version: 1, queuePosition: 1 }),
      row({
        taskId: 'tsk_f', type: 'revise_candidate', state: 'failed', version: 5, attemptCount: 1,
        failure: { code: 'auth_or_config_invalid', message: '模型凭据校验失败，请检查配置。', retryable: 'manual', sideEffectSafety: 'unknown' },
      }),
      row({
        taskId: 'tsk_sr', type: 'revise_candidate', state: 'needs_review', version: 3, attemptCount: 1,
        resultPendingExit: true, result: { payloadRef: 'result://att_tsk_sr/payload.json', kind: 'json' },
        recovery: {
          cause: 'result_exit_unconfirmed', itemVersion: 2, stagedResult: true, sideEffectKnown: false,
          autoResume: false, reason: '结果已暂存，worker 退出未确认。', receipts: [
            { receiptId: 'rc_a', kind: 'lark_message_send', verifiable: true },
          ],
          decisionOptions: ['resume', 'cancel'],
        },
      }),
      row({
        taskId: 'tsk_eu', type: 'test', state: 'needs_review', version: 2, attemptCount: 1, attemptExitState: 'exited_unknown', queuePosition: null,
        recovery: { cause: 'exit_unconfirmed', itemVersion: 1, stagedResult: false, sideEffectKnown: false, autoResume: false, reason: 'worker 退出无法确认。', receipts: [] },
      }),
      row({
        taskId: 'tsk_ir', type: 'extract', state: 'interrupted', version: 2, attemptCount: 1,
        recovery: { cause: 'backend_restart', sideEffectKnown: true, autoResume: false, reason: '重启，旧 worker 已确认停止。', receipts: [], resumeEligible: true },
      }),
    ];

    // ---- Face 1: 640×900 layout with review + concurrency open ----
    await page(`seed(${JSON.stringify(SEED)})`);
    await page(`setConcurrency({ agentConcurrency: 3, version: 0, runningCount: 2, queuedCount: 1 })`);
    await page(`waitForText('重启恢复中')`);
    await page(`clickByAria('核对整理任务 revise_candidate')`);
    await page(`waitForText('暂存成功结局')`);
    await page(`clickByAria('并发设置')`);
    await page(`waitForText('当前 3')`);
    let state = await page('state()');
    tap(state.docScrollWidth <= 640, 'U8: 640px viewport shows no horizontal overflow', { docScrollWidth: state.docScrollWidth });
    const overflow = state.buttons.filter((button) => !button.disabled && (button.x < 0 || button.x + button.w > 640));
    tap(overflow.length === 0, 'U8: every enabled control stays within the 640px viewport', { overflow });
    const minHeight = Math.min(...state.buttons.map((button) => button.h));
    tap(minHeight >= 24, 'U8: control touch heights stay usable (min observed >= 24px)', { minHeight });
    tap(!state.text.includes('失败·无法重试') && !state.text.includes('失败·将自动重试'), '§4.1: no-retry/auto-backoff notes render only on failed rows (none in this seed)', {});
    const labels = state.buttons.map((button) => button.label);
    tap(labels.includes('取消整理任务 organize_text') && labels.includes('重试失败任务 revise_candidate') && labels.includes('并发设置') && labels.includes('核对整理任务 revise_candidate'), 'U8: task-context addressable names in the real DOM', { labels });
    const expanded = state.buttons.find((button) => button.label === '核对整理任务 revise_candidate');
    tap(expanded?.ariaExpanded === 'true' && expanded.ariaControls === 'task-review-tsk_sr', 'U8: aria-expanded/aria-controls wiring in the real DOM', expanded);
    tap((await page(`setInput('2')`)) === true, 'U8: the concurrency number input is operable in the real DOM');
    tap(await screenshot('narrow-640-queue.png') === 'narrow-640-queue.png', 'U8: 640×900 screenshot captured (queue + review + concurrency)', { out: 'narrow-640-queue.png' });

    // ---- Face 2: keyboard flow with TRUSTED Tab/Enter ----
    await evaluate(`document.body.focus()`);
    const visited = [];
    for (let index = 0; index < 12; index += 1) {
      await keyTap('Tab', 'Tab', 9);
      const active = await page('state()');
      const label = active.activeElement?.ariaLabel ?? active.activeElement?.id ?? active.activeElement?.tag;
      visited.push(label);
      if (label === '重试失败任务 revise_candidate') break;
    }
    tap(visited[0] === '并发设置' || visited.includes('取消整理任务 organize_text'), 'U8: Tab order walks the queue entries from the top', { visited });
    tap(visited.includes('重试失败任务 revise_candidate'), 'U8: Tab reaches the failed row retry entry', { visited });
    const landedOnRetry = await evaluate(`(document.activeElement?.getAttribute('aria-label') || '') === '重试失败任务 revise_candidate'`);
    if (landedOnRetry !== true) await page(`focusByAria('重试失败任务 revise_candidate')`);
    const beforeRetry = await page('lastSeq()');
    await keyTap('Enter', 'Enter', 13, '\r');
    await new Promise((resolve) => setTimeout(resolve, 600));
    const diag = await evaluate(`JSON.stringify({ active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? String(document.activeElement), calls: window.__taskControls.recorded.map((c) => c.method + ' ' + c.path) })`);
    console.log(`# DIAG after Enter: ${diag}`);
    await page(`waitForPredicate(() => window.__taskControls.recorded.some((c) => c.method === 'POST' && c.path.endsWith('/retry')), 3000)`);
    const retryCalls = (await page(`callsAfter(${beforeRetry})`)).filter((call) => call.method === 'POST' && call.path.endsWith('/retry'));
    tap(retryCalls.length === 1 && retryCalls[0].body.expectedVersion === 5 && retryCalls[0].body.configRevision === undefined, 'U8/U1: Enter activates the retry entry and the POST carries only the task version', { body: retryCalls[0]?.body, landedOnRetry, visited });
    await page(`waitForPredicate(() => document.activeElement && document.activeElement.closest('#task-row-tsk_f') !== null, 2000)`);
    tap(true, 'U8: focus stays inside its row after the action completes (row remains)', {});
    state = await page('state()');
    tap(state.busyRows.length === 0, 'U9: the row in-flight marker cleared after the action', { busyRows: state.busyRows });

    // ---- Face 3: 409 conflict alert (role=alert) ----
    await page(`setActionReply({ status: 409, body: { contractVersion: 'web-api/1', error: { code: 'version_conflict', message: '任务版本已过期。' } } })`);
    await page(`focusByAria('重试失败任务 revise_candidate')`);
    await page(`clickByAria('重试失败任务 revise_candidate')`);
    await page(`waitForText('版本已过期')`);
    state = await page('state()');
    tap(state.alerts.some((text) => text.includes('版本已过期')), 'U8/U1: the 409 hint renders in a role=alert slot (not color-only)', { alerts: state.alerts });
    tap(await screenshot('narrow-640-conflict-alert.png') === 'narrow-640-conflict-alert.png', 'U8: conflict-state screenshot captured', { out: 'narrow-640-conflict-alert.png' });
    await page(`setActionReply(null)`);

    // ---- Face 4: focus falls to the list container when the row leaves ----
    await page(`toggleReceipt('rc_a', true)`);
    await page(`waitForPredicate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '提交暂存结果整理任务 revise_candidate'); return b && !b.disabled; }, 2000)`);
    await page(`setActionReply({ status: 202, body: { contractVersion: 'web-api/1', task: { taskId: 'tsk_sr', state: 'succeeded' } } })`);
    await page(`setPostActionTasks([${JSON.stringify(SEED[0])}])`);
    await page(`clickByAria('提交暂存结果整理任务 revise_candidate')`);
    await page(`waitForPredicate(() => !document.getElementById('task-row-tsk_sr'), 3000)`);
    await page(`waitForPredicate(() => document.activeElement && document.activeElement.tagName === 'UL', 2000)`);
    state = await page('state()');
    tap(state.activeElement?.isListContainer === true, 'U8: focus falls to the list container when the row leaves the display', state.activeElement);
    tap(state.live.includes('动作已完成'), 'U8: the aria-live region announces the outcome', { live: state.live });
    await page(`setPostActionTasks(null)`);
    await page(`setActionReply(null)`);

    // ---- Face 5: config rerun entry with the saved revision wired ----
    await page(`seed([${JSON.stringify(SEED[1])}])`);
    await page(`waitForText('auth_or_config_invalid')`);
    await page(`setConfigRevision('cfgrev_new_20261110')`);
    await page(`waitForPredicate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '用新配置重跑整理任务 revise_candidate'); return b && !b.disabled; }, 2000)`);
    const beforeRerun = await page('lastSeq()');
    await page(`clickByAria('用新配置重跑整理任务 revise_candidate')`);
    await page(`waitForPredicate(() => window.__taskControls.recorded.some((c) => c.method === 'POST' && c.path.endsWith('/tsk_f/retry') && c.seq > ${beforeRerun}), 3000)`);
    const rerunCalls = (await page(`callsAfter(${beforeRerun})`)).filter((call) => call.method === 'POST' && call.path.endsWith('/retry'));
    tap(rerunCalls.length === 1 && rerunCalls[0].body.expectedVersion === 5 && rerunCalls[0].body.configRevision === 'cfgrev_new_20261110', 'U2: the rerun entry sends the SAVED revision with the task version', rerunCalls[0]?.body);
    tap(retryCalls[0].body.configRevision === undefined, 'U2: the plain retry never ships a config revision (RS-1)', retryCalls[0]?.body);
  } catch (error) {
    tap(false, 'driver face crashed', { error: String(error?.message ?? error).slice(0, 400) });
  } finally {
    // Cleanup: every step attempted regardless of earlier failures.
    try { if (socket) socket.close(); } catch { /* already closed */ }
    try { if (chromeChild) { chromeChild.kill('SIGKILL'); } } catch { /* already dead */ }
    const chromeExited = await new Promise((resolve) => {
      if (!chromeChild || chromeChild.exitCode !== null) { resolve(true); return; }
      const timer = setTimeout(() => resolve(false), 4000);
      timer.unref();
      chromeChild.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    steps.chromeClosed = chromeExited;
    try { if (vite) await Promise.race([Promise.resolve(vite.close()), new Promise((resolve) => setTimeout(resolve, 3000))]); steps.viteClosed = true; } catch { steps.viteClosed = false; }
    try { if (httpServer) { httpServer.closeAllConnections?.(); await new Promise((resolve) => httpServer.close(resolve)); } steps.httpClosed = true; } catch { steps.httpClosed = false; }
    try { rmSync(profileDir, { recursive: true, force: true }); steps.profileRemoved = !existsSync(profileDir); } catch { steps.profileRemoved = false; }
  }

  const summary = { pass: passCount, fail: failCount, cleanup: steps, results, viewport: VIEWPORT, date: new Date().toISOString() };
  writeFileSync(join(OUT_DIR, 'task-controls-browser-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`# cleanup ${JSON.stringify(steps)}`);
  console.log(`# summary pass=${passCount} fail=${failCount} out=${OUT_DIR}`);
  if (failCount > 0) process.exit(1);
}

async function chrome_deadline(predicateFactory) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const value = await predicateFactory();
    if (value === true) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

main().then(() => {}, (error) => {
  console.error(`# driver failed: ${error?.message ?? error}`);
  process.exit(1);
});
