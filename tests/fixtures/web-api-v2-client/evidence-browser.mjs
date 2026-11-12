// Real-Chrome driver for the web-api/2 exit-evidence faces (MAYNE-38):
// honest presentation of exit evidence, snapshot/version rejection, SSE
// frame discipline and the a11y/narrow-viewport faces, all on the REAL
// production TaskQueue.vue + stores + client + pairing transport.
//
// Run: node tests/fixtures/web-api-v2-client/evidence-browser.mjs
// Prerequisites: Chrome at the platform default path (or SIDEKICK_TEST_CHROME),
// Node >= 24 with the locked dependency tree (vite). No network access needed.
//
// The driver starts a repo-root Vite dev server (middleware mode, the
// production vite.config.ts pipeline) behind an ephemeral local HTTP listener
// plus one headless Chrome over the DevTools protocol, and serves the in-page
// mount harness tests/fixtures/web-api-v2-client/evidence-page/ — the REAL
// production TaskQueue.vue compiled by the production pipeline. Wire rows are
// the BYTE-EXACT frozen 0c9febc samples and the derived one-defect negatives.
// Layout, keyboard (trusted CDP key events), focus management and ARIA
// dynamics are observed through the REAL DOM. Output: TAP lines + summary
// JSON + PNG screenshots; exit 0 only when every face holds.
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const PAGE_PATH = '/tests/fixtures/web-api-v2-client/evidence-page/index.html';
const OUT_DIR = process.env.V2_EVIDENCE_OUT ?? join(REPO_ROOT, 'build', 'mayne38-api2-browser', 'browser-run');
const WORK_MS = 13000;
const CLEANUP_MS = 5500;
const VIEWPORT = { width: 640, height: 900 };
const EPOCH = 'inst_9f27c1aa40b2';

const resolveChrome = () => process.env.SIDEKICK_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeAvailable = () => existsSync(resolveChrome());
const withDeadline = (promise, label, deadline) => {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded the remaining case budget (${Math.max(0, deadline - Date.now())}ms left)`)), Math.max(250, deadline - Date.now()));
    timer.unref();
  });
  timeout.catch(() => {});
  return Promise.race([promise, timeout]);
};
const frozenSample = (name) => JSON.parse(readFileSync(join(HERE, 'frozen', name), 'utf8'));
const derivedSample = (name) => JSON.parse(readFileSync(join(HERE, 'derived', name), 'utf8'));

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
  const profileDir = mkdtempSync(join(tmpdir(), 'v2-evidence-chrome-'));
  let vite = null;
  let httpServer = null;
  let chromeChild = null;
  let socket = null;
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
    const cdpDeadline = Math.min(workDeadline, Date.now() + 8000);
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
    const page = (expression) => evaluate(`window.__v2Evidence.${expression}`);
    const readyPoll = async () => {
      const deadline = Math.min(workDeadline, Date.now() + 8000);
      for (;;) {
        if (await evaluate('typeof window.__v2Evidence === "object" && window.__v2Evidence.ready === true') === true) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    const poke = async (cursor) => {
      // One web-api/2 frame through the REAL transport: the production
      // invalidation path that paces the queue's fenced read-back.
      await page(`emitFrame('settings.changed', { contractVersion: 'web-api/2', cursor: ${cursor}, epoch: ${JSON.stringify(EPOCH)}, objectType: 'setting', objectId: 'agentConcurrency', objectVersion: ${cursor}, setting: { agentConcurrency: 3 }, at: '2026-11-06T12:31:45.000Z' }, ${JSON.stringify(`${EPOCH}:${cursor}`)})`);
    };
    const settle = async (cursor, what) => {
      const before = await page('lastSeq()');
      await poke(cursor);
      const deadline = Math.min(workDeadline, Date.now() + 2500);
      for (;;) {
        const calls = await page(`callsAfter(${before})`);
        if (calls.some((call) => call.method === 'GET' && call.path === '/api/tasks')) return calls;
        if (Date.now() >= deadline) throw new Error(`queue read-back never followed the frame (${what})`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
    await withDeadline(send('Page.navigate', { url: `http://127.0.0.1:${port}${PAGE_PATH}` }), 'page navigate', workDeadline);
    if (!await readyPoll()) throw new Error('the in-page evidence harness never became ready (window.__v2Evidence)');

    // ---- Face 1: exited_unknown rows are honest, slot-held, read-only ----
    // The seven frozen unresolved veto samples, one at a time: every one shows
    // the occupied-slot fact + the readable veto reason, and none offers any
    // disposition entry.
    // The `known_survivor` wording is derived from WHERE the evidence places
    // the live process: the registered set, the stray ledger, the argv scan,
    // or only the still-present process group. A registered member is never
    // claimed alive unless `registry.survivors` reports one (§3.1.1
    // invariant 2).
    const UNKNOWN_ROWS = [
      ['task-exit-unconfirmed-group-survivor.json', '进程组仍存在，已知有未登记进程存活'],
      ['task-exit-unconfirmed-group-eperm.json', '退出观察或清扫被操作系统拒绝'],
      ['task-exit-unconfirmed-argv-hit.json', 'argv 扫描命中仍存活的进程'],
      ['task-exit-unconfirmed-argv-scan-eperm.json', '退出观察或清扫被操作系统拒绝'],
      ['task-exit-unconfirmed-argv-not-performed.json', '退出证据不足，无法确认'],
      ['task-exit-unconfirmed-argv-scan-failed.json', '退出证据不足，无法确认'],
      ['task-exit-unconfirmed-stray-pending.json', '发现未登记的残余进程仍存活且未清扫'],
    ];
    let cursor = 10;
    for (const [name, vetoText] of UNKNOWN_ROWS) {
      const task = frozenSample(name);
      await page(`seed([${JSON.stringify(task)}])`);
      const calls = await settle(++cursor, name);
      const state = await page('state()');
      tap(state.text.includes('退出未知·待系统核实') && state.text.includes('占 1 个执行槽，等待系统核实退出'), `§3.1.2 exited_unknown shows the slot-held fact (${name})`, { text: state.text.slice(0, 200) });
      tap(state.text.includes(`未确认原因：${vetoText}`), `§3.1.1 unresolved veto reason is readable (${name})`, { text: state.text.slice(0, 260) });
      tap(!state.buttons.some((button) => button.label.includes('核对') || button.label.includes('恢复') || button.label.includes('放弃') || button.label.includes('重试')), `§4.5 exited_unknown offers no disposition entry (${name})`, { buttons: state.buttons.map((button) => button.label) });
      tap(!calls.some((call) => call.method === 'POST'), `§4.5 exited_unknown fires no action POST (${name})`, { calls });
      tap(!state.text.includes('无残余') && !state.text.includes('已证明灭绝') && !state.text.includes('进程树已全部退出'), `§3.1.2 forbidden wording never renders (${name})`, {});
    }

    // ---- Face 2: the confirmed registry-domain exit discloses honestly ----
    const confirmed = frozenSample('task-needs-review-exit-reclaimed.json');
    await page(`seed([${JSON.stringify(confirmed)}])`);
    let calls = await settle(++cursor, 'confirmed');
    let state = await page('state()');
    tap(state.buttons.some((button) => button.label === `核对整理任务 ${confirmed.type}`), '§3.1.2 exited_confirmed shows the review entry', { buttons: state.buttons.map((button) => button.label) });
    await page(`clickByAria('核对整理任务 ${confirmed.type}')`);
    await page(`waitForText('已确认登记进程集全部退出；不证明全部后代进程已退出')`);
    state = await page('state()');
    tap(state.text.includes('已确认登记进程集全部退出；不证明全部后代进程已退出。'), '§3.1.2 the mandated honest boundary sentence renders verbatim', {});
    tap(state.text.includes('登记进程 2 个：确认退出 2 · 存活 0 · 无法观察 0'), '§3.1.1 the registry decomposition renders', { text: state.text.slice(0, 400) });
    tap(state.text.includes('argv 扫描：已执行，命中 0。'), '§3.1.1 the argv supplement renders with its hit count', {});
    tap(state.text.includes('残余清扫台账：发现 1 · 已清扫 1 · 待清扫 0。'), '§3.1.1 the stray sweep ledger renders found/swept/pending', {});
    tap(state.text.includes('发现为 0 不等于不存在残余'), '§3.1.2 the found=0 boundary is stated (never "无残余")', {});
    tap(!state.text.includes('无残余') && !state.text.includes('进程树已全部退出') && !state.text.includes('完整退出已证明') && !state.text.includes('已证明灭绝'), '§3.1.2 no tree-extinct claim anywhere on the confirmed row', {});
    tap(state.text.includes('登记域确认时间：2026-11-06T12:50:00.000Z'), '§3.1.1 confirmedAt is disclosed', {});

    // ---- Face 3: resolve is evidence-gated and the ACK list echoes verbatim
    const resumeEnabled = await page(`waitForPredicate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '恢复执行整理任务 organize_text'); return b && !b.disabled; }, 2500)`);
    tap(resumeEnabled === true, '§4.5 resolve is enabled behind valid registry_extinct evidence + receipts', {});
    const beforeResolve = await page('lastSeq()');
    await page(`clickByAria('恢复执行整理任务 ${confirmed.type}')`);
    await page(`waitForPredicate(() => window.__v2Evidence.lastSeq() > ${beforeResolve}, 3000)`);
    await page(`waitForPredicate(() => window.__v2Evidence.callsAfter(${beforeResolve}).some((c) => c.method === 'POST' && c.path.endsWith('/resolve')), 3000)`);
    calls = await page(`callsAfter(${beforeResolve})`);
    const resolveCall = calls.find((call) => call.method === 'POST' && call.path.endsWith('/resolve'));
    tap(resolveCall && resolveCall.body.expectedVersion === 2 && resolveCall.body.decision === 'resume' && JSON.stringify(resolveCall.body.acknowledgedReceipts) === '[]', '§3.5.1/§4.5 resolve carries the authoritative itemVersion and the verbatim ACK list', resolveCall?.body);

    // ---- Face 4: found=0 ledger stays honest ----
    const foundZero = structuredClone(confirmed);
    foundZero.taskId = 'tsk_3f8a1c5e9b2d4706fa1c3e5b7d9a2f99';
    foundZero.attemptExitEvidence.residual.strayLedger = { found: 0, swept: 0, pending: 0 };
    foundZero.recovery = { ...foundZero.recovery, itemVersion: 3 };
    await page(`seed([${JSON.stringify(foundZero)}])`);
    calls = await settle(++cursor, 'found-zero');
    await page(`clickByAria('核对整理任务 ${confirmed.type}')`);
    await page(`waitForText('残余清扫台账：发现 0 · 已清扫 0 · 待清扫 0。')`);
    state = await page('state()');
    tap(state.text.includes('残余清扫台账：发现 0 · 已清扫 0 · 待清扫 0。') && state.text.includes('发现为 0 不等于不存在残余'), '§3.1.1 a zero-count ledger is disclosed with the absence boundary', {});
    tap(!state.text.includes('无残余'), '§3.1.2 found=0 never renders as 无残余', {});

    // ---- Face 5: malformed evidence fails closed with a readable reason ----
    const malformed = derivedSample('task-evidence-malformed-tree-proven.json');
    await page(`seed([${JSON.stringify(malformed)}])`);
    calls = await settle(++cursor, 'malformed');
    await page(`waitForText('退出证据不合规')`);
    state = await page('state()');
    tap(state.alerts.some((text) => text.includes('treeExtinctProven')), '§3.1.1 the malformed evidence rejection renders in a role=alert slot', { alerts: state.alerts });
    tap(!state.text.includes('已确认登记进程集全部退出'), '§3.1.1 no honest-disclosure is built from rejected evidence', {});
    tap(!calls.some((call) => call.method === 'POST'), '§4.5 malformed evidence fires no action POST', { calls });
    tap(await screenshot('v2-evidence-malformed-rejection.png') === 'v2-evidence-malformed-rejection.png', 'evidence: the malformed-evidence rejection screenshot', {});

    // ---- Face 6: staged/terminal discipline (no early 终局) ----------------
    const staged = frozenSample('task-result-pending-exit.json');
    // Fresh task identity: the snapshot row reuses the confirmed sample's
    // task id at a LOWER version, which the per-ID epoch watermark (required
    // by the F2 fix) correctly treats as a stale row. This face tests the
    // staged/cancelling display, so it uses its own id — exactly as Face 4
    // and Face 10 already clone the confirmed sample with a fresh id.
    const cancelling = structuredClone(frozenSample('snapshot-high-watermark.json').tasks[0]);
    cancelling.taskId = 'tsk_cancelling_000000000000000000000000000000';
    await page(`seed([${JSON.stringify(staged)}, ${JSON.stringify(cancelling)}])`);
    await settle(++cursor, 'staged');
    await page(`waitForText('进行中')`);
    state = await page('state()');
    tap(state.text.includes('进行中') && state.text.includes('取消中'), '§3.1.2 staged/cancelling rows keep the in-progress wording', {});
    tap(!state.text.includes('已完成') && !state.text.includes('已取消') && !state.text.includes('已失败'), '§3.1.2 no terminal wording before the exit is confirmed', {});
    tap(!calls.some((call) => call.method === 'POST'), '§3.2 staged rows fire no action POST in this face', { calls });

    // ---- Face 7: a V1 task list is rejected outright, readably ----
    await page(`setTaskListVersion('web-api/1')`);
    await page(`seed([])`);
    await settle(++cursor, 'v1-list');
    await page(`waitForText('web-api/2 契约格式')`);
    state = await page('state()');
    tap(state.alerts.some((text) => text.includes('web-api/2 契约格式')), '§1 the V1 task list is rejected with the readable version reason', { alerts: state.alerts });
    tap(!calls.some((call) => call.method === 'POST'), '§1 a version-rejected read fires no action POST', { calls });
    await page(`setTaskListVersion('web-api/2')`);

    // ---- Face 8: SSE reset → §6.1 snapshot → header-carried resubscribe ----
    await page(`setSnapshot(${JSON.stringify(frozenSample('snapshot-high-watermark.json'))})`);
    const beforeReset = await page('lastSeq()');
    await page(`emitFrame('stream.reset', { contractVersion: 'web-api/2', epoch: 'inst_c4018ee7b5a9', reason: 'reconnect token epoch does not match the current instance' })`);
    await page(`waitForPredicate(() => window.__v2Evidence.callsAfter(${beforeReset}).some((c) => c.path === '/api/snapshot'), 3000)`);
    calls = await page(`callsAfter(${beforeReset})`);
    tap(calls.some((call) => call.path === '/api/snapshot'), '§6 the V2 stream.reset drives the snapshot resync', { calls: calls.map((call) => call.path) });
    const resubscribed = await page(`waitForPredicate(() => window.__v2Evidence.callsAfter(${beforeReset}).some((c) => c.path === '/api/events' && c.lastEventId === 'inst_9f27c1aa40b2:1042'), 3000)`);
    tap(resubscribed === true, '§6.1 the resubscribe carries the snapshot lastEventId as the Last-Event-ID header', {});
    // A V1 stream.reset from a V1 server never drives our snapshot pipeline.
    const beforeV1Reset = await page('lastSeq()');
    await page(`emitFrame('stream.reset', { contractVersion: 'web-api/1', epoch: 'inst_other', reason: 'epoch_changed' })`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    calls = await page(`callsAfter(${beforeV1Reset})`);
    tap(!calls.some((call) => call.path === '/api/snapshot'), '§1 a V1 stream.reset never triggers a snapshot resync', { calls: calls.map((call) => call.path) });
    // The consumed snapshot advanced the applied cursor to its high watermark:
    // later same-epoch frames must carry a HIGHER cursor to stay applicable.
    cursor = 1042;

    // ---- Face 9: the concurrency write carries the settings VERSION ----
    await page(`setConcurrency({ agentConcurrency: 3, default: 3, version: 5, runningCount: 2, queuedCount: 1 })`);
    await page(`setConcurrencyPutReply({ status: 200, body: { contractVersion: 'web-api/2', agentConcurrency: 4, default: 3, version: 6, runningCount: 2, queuedCount: 1 } })`);
    await page(`clickByAria('并发设置')`);
    await page(`waitForText('当前 3')`);
    await page(`waitForPredicate(() => !!document.getElementById('task-queue-concurrency-input'), 2000)`);
    await page(`setInput('4')`);
    const beforePut = await page('lastSeq()');
    await page(`clickByAria('应用并发设置')`);
    await page(`waitForPredicate(() => window.__v2Evidence.callsAfter(${beforePut}).some((c) => c.method === 'PUT' && c.path === '/api/settings/agent-concurrency'), 3000)`);
    calls = await page(`callsAfter(${beforePut})`);
    const put = calls.find((call) => call.method === 'PUT');
    tap(put && put.body.agentConcurrency === 4 && put.body.expectedVersion === 5, '§5 the CAS input is the settings version (5), never the concurrency value', put?.body);
    await page(`waitForText('并发设置已更新为 4')`);
    await page(`setConcurrencyPutReply(null)`);

    // ---- Face 10: keyboard reachability of the disclosure + 640px layout ----
    // A FRESH confirmed row (new taskId): the review panel starts collapsed,
    // so the Enter below is genuinely what expands it.
    const keyboardRow = structuredClone(confirmed);
    keyboardRow.taskId = 'tsk_3f8a1c5e9b2d4706fa1c3e5b7d9a2faa';
    keyboardRow.recovery = { ...keyboardRow.recovery, itemVersion: 7 };
    await page(`seed([${JSON.stringify(keyboardRow)}])`);
    await settle(++cursor, 'keyboard');
    await page(`waitForPredicate(() => !!document.querySelector('.task-queue button[aria-label^="核对整理任务"]'), 2000)`);
    await evaluate(`document.body.focus()`);
    let reached = null;
    for (let index = 0; index < 12 && reached === null; index += 1) {
      await keyTap('Tab', 'Tab', 9);
      const active = await page('state()');
      const label = active.activeElement?.ariaLabel ?? active.activeElement?.id ?? active.activeElement?.tag;
      if (typeof label === 'string' && label.startsWith('核对整理任务')) reached = label;
    }
    tap(reached !== null, 'U8: Tab reaches the review entry of the confirmed row', { reached });
    if (reached === null) await page(`focusByAria('核对整理任务 ${confirmed.type}')`);
    await keyTap('Enter', 'Enter', 13, '\r');
    await page(`waitForText('已确认登记进程集全部退出')`);
    state = await page('state()');
    tap(state.text.includes('已确认登记进程集全部退出；不证明全部后代进程已退出。'), 'U8: Enter expands the honest disclosure on the real DOM', {});
    tap(state.docScrollWidth <= 640, 'U8: 640px viewport shows no horizontal overflow', { docScrollWidth: state.docScrollWidth });
    const overflow = state.buttons.filter((button) => !button.disabled && (button.x < 0 || button.x + button.w > 640));
    tap(overflow.length === 0, 'U8: every enabled control stays within the 640px viewport', { overflow });
    tap(await screenshot('v2-evidence-narrow-640.png') === 'v2-evidence-narrow-640.png', 'evidence: the confirmed-exit disclosure screenshot (640×900)', {});

    // ---- Face 11: a stale older-version/attempt row cannot replace the ----
    // ---- installed unresolved evidence or enable resolve (F2) ----
    // The current attempt holds the slot; a later read carrying an OLDER
    // version under a DIFFERENT attempt id must be rejected by the install
    // fence, not installed over the newer evidence.
    const freshUnknown = frozenSample('task-exit-unconfirmed-stray-pending.json');
    freshUnknown.taskId = 'tsk_review_generation';
    freshUnknown.version = 20;
    freshUnknown.attemptId = 'att_current';
    freshUnknown.attemptCount = 2;
    await page(`seed([${JSON.stringify(freshUnknown)}])`);
    await settle(++cursor, 'current-unresolved');
    state = await page('state()');
    tap(state.text.includes('占 1 个执行槽，等待系统核实退出'), '§3.1.1 the current attempt holds its slot', {});
    const staleConfirmed = frozenSample('task-needs-review-exit-reclaimed.json');
    staleConfirmed.taskId = freshUnknown.taskId;
    staleConfirmed.version = 12;
    staleConfirmed.attemptId = 'att_previous';
    staleConfirmed.attemptCount = 1;
    await page(`seed([${JSON.stringify(staleConfirmed)}])`);
    await settle(++cursor, 'older-confirmed-attempt');
    state = await page('state()');
    const staleReview = state.buttons.some((button) => button.label.startsWith('核对整理任务'));
    const enabledResolve = state.buttons.some((button) => button.label.startsWith('恢复执行') && !button.disabled);
    tap(state.text.includes('占 1 个执行槽，等待系统核实退出') && !staleReview && !enabledResolve, '§3.1.1 a stale older version/attempt cannot replace the unresolved evidence or enable resolve', { buttons: state.buttons.map((button) => button.label) });
    if (enabledResolve) {
      const beforeStale = await page('lastSeq()');
      await page(`clickByAria('恢复执行整理任务 ${staleConfirmed.type}')`);
      await page(`waitForPredicate(() => window.__v2Evidence.callsAfter(${beforeStale}).some((c) => c.method === 'POST'), 2000)`);
      const staleCalls = await page(`callsAfter(${beforeStale})`);
      tap(!staleCalls.some((call) => call.method === 'POST' && call.path.endsWith('/resolve')), '§3.1.1 stale evidence cannot trigger a resolve POST', staleCalls);
    }

    // ---- Face 12: the read-only disclosure is independent of disposition ----
    // ---- (F3): a failed+confirmed row and an unresolved stray-pending row ----
    const failedConfirmed = frozenSample('task-needs-review-exit-reclaimed.json');
    failedConfirmed.taskId = 'tsk_review_failed';
    failedConfirmed.state = 'failed';
    failedConfirmed.resultPendingExit = false;
    failedConfirmed.terminalAt = '2026-11-06T12:50:00.000Z';
    failedConfirmed.recovery = null;
    failedConfirmed.result = null;
    failedConfirmed.failure = { code: 'worker_error', message: 'synthetic failure', retryable: 'manual', sideEffectSafety: 'proven_safe' };
    await page(`seed([${JSON.stringify(failedConfirmed)}])`);
    await settle(++cursor, 'failed-confirmed');
    state = await page('state()');
    tap(state.text.includes('已确认登记进程集全部退出；不证明全部后代进程已退出。'), '§3.1.2 a failed+exited_confirmed row still discloses the honest boundary', {});
    const pendingLedger = frozenSample('task-exit-unconfirmed-stray-pending.json');
    await page(`seed([${JSON.stringify(pendingLedger)}])`);
    await settle(++cursor, 'pending-ledger');
    state = await page('state()');
    tap(state.text.includes('待清扫 1') && state.text.includes('发现为 0 不等于不存在残余'), '§3.1.2 the unresolved stray-pending ledger is inspectable with its boundary', {});

    // ---- Face 13: a legitimate newer attempt installs and the queue keeps ----
    // ---- updating (F5 — the confirmed-irreversibility fence is PER-ATTEMPT) ----
    // A normal failure retry keeps the task id, bumps the version/attempt and
    // starts with no exit evidence. The previous attempt's confirmed verdict
    // must not block the new attempt, and one row's advance must not freeze the
    // rest of the queue.
    const failedBase = frozenSample('task-needs-review-exit-reclaimed.json');
    const failedRow = structuredClone(failedBase);
    failedRow.taskId = 'tsk_retry_failed_0000000000000000000000';
    failedRow.version = 20;
    failedRow.attemptCount = 1;
    failedRow.state = 'failed';
    failedRow.cancelIntent = false;
    failedRow.recovery = null;
    failedRow.result = null;
    failedRow.resultPendingExit = false;
    failedRow.terminalAt = '2026-11-06T12:50:00.000Z';
    failedRow.failure = { code: 'worker_error', message: 'synthetic failure', retryable: 'manual', sideEffectSafety: 'proven_safe' };
    await page(`seed([${JSON.stringify(failedRow)}])`);
    await settle(++cursor, 'failed-before-retry');
    state = await page('state()');
    const retryLabel = state.buttons.find((button) => button.label.startsWith('重试') && !button.disabled)?.label ?? '';
    tap(retryLabel !== '', '§3.2 a failed confirmed row offers the manual retry entry', {});
    const retried = structuredClone(failedBase);
    retried.taskId = failedRow.taskId;
    retried.version = 22;
    retried.attemptCount = 2;
    retried.attemptId = 'att_retry_new_000000000000000000000000';
    retried.state = 'running';
    retried.attemptExitState = 'active';
    retried.attemptExitEvidence = null;
    retried.failure = null;
    retried.terminalAt = null;
    retried.recovery = null;
    retried.result = null;
    retried.resultPendingExit = false;
    const unrelated = structuredClone(failedBase);
    unrelated.taskId = 'tsk_retry_other_0000000000000000000000';
    unrelated.version = 7;
    unrelated.state = 'running';
    unrelated.attemptExitState = 'active';
    unrelated.attemptExitEvidence = null;
    unrelated.failure = null;
    unrelated.terminalAt = null;
    unrelated.recovery = null;
    await page(`seed([${JSON.stringify(retried)}, ${JSON.stringify(unrelated)}])`);
    await page(`clickByAria(${JSON.stringify(retryLabel)})`);
    await settle(++cursor, 'new-attempt-after-retry');
    state = await page('state()');
    tap(state.text.includes('进行中') && !state.buttons.some((button) => button.label.startsWith('重试')), '§3.1.1 a legitimate newer attempt installs over the failed confirmed row', {});
    tap(state.buttons.some((button) => button.inRow === `task-row-${unrelated.taskId}`), '§3.1.1 unrelated queue rows keep updating during a retry', {});

    // ---- Face 14: an omission cannot erase a known ID's watermark; a stale ----
    // ---- confirmation cannot reauthorize resolve (F2) ----
    const protectedRow = frozenSample('task-exit-unconfirmed-stray-pending.json');
    protectedRow.taskId = 'tsk_omission_current_000000000000000000';
    protectedRow.version = 20;
    protectedRow.attemptCount = 2;
    protectedRow.attemptId = 'att_omission_current_0000000000000000';
    await page(`seed([${JSON.stringify(protectedRow)}])`);
    await settle(++cursor, 'before-omission');
    state = await page('state()');
    tap(state.text.includes('占 1 个执行槽，等待系统核实退出'), '§3.1.1 the current attempt holds its slot before the omission', {});
    await page('seed([])');
    await settle(++cursor, 'stale-list-omits-current-task');
    const staleRow = frozenSample('task-needs-review-exit-reclaimed.json');
    staleRow.taskId = protectedRow.taskId;
    staleRow.version = 12;
    staleRow.attemptCount = 1;
    staleRow.attemptId = 'att_omission_stale_00000000000000000000';
    await page(`seed([${JSON.stringify(staleRow)}])`);
    await settle(++cursor, 'stale-confirmation-after-omission');
    state = await page('state()');
    if (state.buttons.some((button) => button.label.startsWith('核对整理任务'))) await page(`clickByAria('核对整理任务 ${staleRow.type}')`);
    state = await page('state()');
    const canResolveAfterOmission = state.buttons.some((button) => button.label.startsWith('恢复执行') && !button.disabled);
    tap(!canResolveAfterOmission && state.text.includes('占 1 个执行槽，等待系统核实退出'), '§3.1.1 an omission cannot erase the fence and reauthorize a stale confirmation', {});
    if (canResolveAfterOmission) {
      const beforeStale = await page('lastSeq()');
      await page(`clickByAria('恢复执行整理任务 ${staleRow.type}')`);
      await settle(++cursor, 'stale-resolve-after-omission');
      const staleCalls = await page(`callsAfter(${beforeStale})`);
      tap(!staleCalls.some((call) => call.method === 'POST' && call.path.endsWith('/resolve')), '§3.1.1 the stale confirmation cannot issue a resolve POST', staleCalls);
    }
  } catch (error) {
    tap(false, 'driver face crashed', { error: String(error?.message ?? error).slice(0, 400) });
  } finally {
    // Cleanup: every step attempted regardless of earlier failures.
    try { if (socket) socket.close(); } catch { /* already closed */ }
    try { if (chromeChild) { chromeChild.kill('SIGKILL'); } } catch { /* already dead */ }
    const chromeExited = await new Promise((resolve) => {
      if (!chromeChild || chromeChild.exitCode !== null) { resolve(true); return; }
      const timer = setTimeout(() => resolve(false), 3500);
      timer.unref();
      chromeChild.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    steps.chromeClosed = chromeExited;
    try { if (vite) await Promise.race([Promise.resolve(vite.close()), new Promise((resolve) => setTimeout(resolve, 2500))]); steps.viteClosed = true; } catch { steps.viteClosed = false; }
    try { if (httpServer) { httpServer.closeAllConnections?.(); await new Promise((resolve) => httpServer.close(resolve)); } steps.httpClosed = true; } catch { steps.httpClosed = false; }
    try { rmSync(profileDir, { recursive: true, force: true }); steps.profileRemoved = !existsSync(profileDir); } catch { steps.profileRemoved = false; }
  }

  const summary = { pass: passCount, fail: failCount, cleanup: steps, results, viewport: VIEWPORT, date: new Date().toISOString() };
  writeFileSync(join(OUT_DIR, 'v2-evidence-browser-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`# cleanup ${JSON.stringify(steps)}`);
  console.log(`# summary pass=${passCount} fail=${failCount} out=${OUT_DIR}`);
  if (failCount > 0) process.exit(1);
}

main().then(() => {}, (error) => {
  console.error(`# driver failed: ${error?.message ?? error}`);
  process.exit(1);
});
