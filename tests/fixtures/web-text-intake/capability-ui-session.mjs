// Session for the capability-UI behavioral faces: repo-root Vite dev server
// (middleware mode, the production vite.config.ts pipeline) behind an
// ephemeral local HTTP listener, plus the headless Chrome DevTools session
// from capability-ui-browser.mjs. The served page is the in-page mount harness
// tests/fixtures/web-text-intake/capability-ui-page/, which compiles and
// mounts the real production panels and exposes window.__capui.
//
// Cleanup contract (hardened per coordinator dispatch 01a1c1b2):
// - The case entry passes the hard budget explicitly: workMs bounds ALL
//   resource work (server spin-up, chrome startup, page ready, faces) and a
//   RESERVED cleanupMs bounds the whole close path — cleanup never has to
//   fight the runner timeout for time, and the runner's forced exit is never
//   relied upon as cleanup.
// - close() attempts EVERY step (chrome, vite, http, profile) regardless of
//   earlier failures, collects a per-step report, and reports ok=false when
//   any step failed — nothing is skipped because a previous step threw, and
//   no failure is swallowed into a silent success.
// - A failed session start runs the SAME collector and attaches its report to
//   the ORIGINAL error (error.cleanupReport), so the real startup failure and
//   the cleanup diagnostics are preserved together.
// - close(faults) carries a TEST-ONLY counter-control seam: each hook runs
//   AFTER the step's real attempt and only overrides the recorded verdict, so
//   propagation and skip-protection can be observed without leaking
//   resources. Production never passes faults.
//
// The report separates "verdict" from "verified reality": steps.*.ok is what
// close() reports upward (faults included), while chromeClosed /
// profileRemoved / steps.*.detail describe what the real attempts actually
// verified, so residue stays checkable even when a fault forced a red verdict.
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { chromeAvailable, resolveChrome, startChrome, withDeadline } from './capability-ui-browser.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGE_PATH = '/tests/fixtures/web-text-intake/capability-ui-page/index.html';

export { chromeAvailable, resolveChrome };

// TEST-ONLY: run the fault hook for one step (after its real attempt) and
// override the recorded verdict when the hook throws or returns an Error.
function applyFault(faults, step, report) {
  const hook = faults?.[step];
  if (!hook) return;
  let injected = null;
  try { injected = hook(); } catch (error) { injected = error; }
  if (injected) {
    const previous = report.steps[step]?.error;
    report.steps[step] = {
      ...report.steps[step],
      ok: false,
      error: `${previous ? `${previous}; ` : ''}injected fault: ${injected.message}`,
    };
  }
}

// The single cleanup collector — used by BOTH session.close() and the
// failed-start path, so the guarantees cannot drift between them. It never
// throws: every outcome (including a collector bug) lands in the report.
async function collectCleanupSteps({ chrome, vite, httpServer, profileDir }, { cleanupMs, faults = {} }) {
  const startedAt = Date.now();
  const cleanupDeadline = startedAt + cleanupMs;
  const report = { ok: true, budgetMs: cleanupMs, steps: {}, chromeClosed: false, profileRemoved: false };
  const remaining = () => Math.max(250, cleanupDeadline - Date.now());

  // chrome — socket close + SIGKILL + bounded exit confirmation.
  try {
    if (chrome) {
      const attempt = await chrome.close({ exitConfirmMs: Math.min(4000, remaining()) });
      report.chromeClosed = attempt.exitConfirmed === true;
      report.steps.chrome = { ok: attempt.exitConfirmed === true, detail: attempt };
      if (attempt.exitConfirmed !== true) report.steps.chrome.error = 'chrome child did not confirm exit within its slice';
    } else {
      report.steps.chrome = { ok: true, detail: { skipped: 'no chrome handle (startup never handed one over)' } };
    }
  } catch (error) {
    report.steps.chrome = { ok: false, error: String(error?.message ?? error), detail: null };
  }
  applyFault(faults, 'chrome', report);

  // vite — close errors are surfaced (never swallowed), bounded by the
  // remaining cleanup slice. Vite 5+ close() returns a promise and ignores
  // callback arguments.
  try {
    if (vite) {
      await withDeadline(Promise.resolve(vite.close()), 'vite close', cleanupDeadline);
      report.steps.vite = { ok: true, detail: { closed: true } };
    } else {
      report.steps.vite = { ok: true, detail: { closed: true, skipped: 'no vite server' } };
    }
  } catch (error) {
    report.steps.vite = { ok: false, error: String(error?.message ?? error) };
  }
  applyFault(faults, 'vite', report);

  // http — graceful close bounded by the remaining slice; keep-alive sockets
  // that outlive it are force-dropped so the listener is guaranteed released.
  try {
    if (httpServer) {
      const graceful = await Promise.race([
        new Promise((resolve) => httpServer.close(() => resolve(true))),
        new Promise((resolve) => { const t = setTimeout(() => resolve(false), remaining()); t.unref(); }),
      ]);
      let connectionsForced = false;
      if (!graceful) {
        connectionsForced = true;
        httpServer.closeAllConnections?.();
        await Promise.race([
          new Promise((resolve) => httpServer.close(() => resolve(true))),
          new Promise((resolve) => { const t = setTimeout(() => resolve(false), Math.min(1000, remaining())); t.unref(); }),
        ]);
      }
      report.steps.http = { ok: true, detail: { closed: true, connectionsForced } };
    } else {
      report.steps.http = { ok: true, detail: { closed: true, skipped: 'no http listener' } };
    }
  } catch (error) {
    report.steps.http = { ok: false, error: String(error?.message ?? error) };
  }
  applyFault(faults, 'http', report);

  // profile — sync removal + on-disk verification.
  try {
    if (profileDir) {
      rmSync(profileDir, { recursive: true, force: true });
      report.profileRemoved = !existsSync(profileDir);
      report.steps.profile = { ok: report.profileRemoved, detail: { removed: report.profileRemoved } };
      if (!report.profileRemoved) report.steps.profile.error = 'profile root still exists after rmSync';
    } else {
      report.steps.profile = { ok: true, detail: { removed: true, skipped: 'no profile dir' } };
    }
  } catch (error) {
    report.steps.profile = { ok: false, error: String(error?.message ?? error), detail: null };
  }
  applyFault(faults, 'profile', report);

  report.ok = ['chrome', 'vite', 'http', 'profile'].every((step) => report.steps[step]?.ok === true);
  report.elapsedMs = Date.now() - startedAt;
  return report;
}

async function runCleanupSteps(resources, options) {
  try {
    return await collectCleanupSteps(resources, options);
  } catch (collectorError) {
    // A bug in the collector itself must not crash the process or mask the
    // original failure: report it as a failed cleanup instead.
    return { ok: false, budgetMs: options.cleanupMs, elapsedMs: 0, steps: {}, chromeClosed: false, profileRemoved: false, collectorError: String(collectorError?.message ?? collectorError) };
  }
}

export async function startCapabilityUiSession({ workMs = 14000, cleanupMs = 6000, chromePath } = {}) {
  const workDeadline = Date.now() + workMs;
  const profileDir = mkdtempSync(join(tmpdir(), 'capui-chrome-'));
  let vite = null;
  let httpServer = null;
  let chrome = null;
  try {
    const pendingVite = createViteServer({
      configFile: join(REPO_ROOT, 'vite.config.ts'),
      root: REPO_ROOT,
      server: { middlewareMode: true, hmr: false, fs: { strict: false }, watch: { ignored: ['**'] } },
      optimizeDeps: { include: ['vue', 'pinia', 'tdesign-vue-next'] },
      logLevel: 'error',
    });
    try {
      vite = await withDeadline(pendingVite, 'vite server create', workDeadline);
    } catch (error) {
      // The loser of the deadline race must not leak: if the server still
      // materialises later, close it best-effort outside the report (the
      // start has already failed; this only prevents orphaned watchers).
      pendingVite.then((server) => { if (server !== vite) Promise.resolve(server.close()).catch(() => {}); }, () => {});
      throw error;
    }
    httpServer = createHttpServer((req, res) => { vite.middlewares(req, res); });
    await withDeadline(new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    }), 'http listener', workDeadline);
    const port = httpServer.address().port;
    chrome = await startChrome({ profileDir, workDeadline, chromePath });
    await withDeadline(chrome.navigate(`http://127.0.0.1:${port}${PAGE_PATH}`), 'page navigate', workDeadline);
    const ready = await chrome.waitForFunction('typeof window.__capui === "object" && window.__capui.ready === true', Math.min(15000, Math.max(250, workDeadline - Date.now())));
    if (!ready) throw new Error('the in-page mount harness never became ready within the remaining case budget (window.__capui)');
    return {
      async face(name, seed) {
        const expression = `window.__capui.face(${JSON.stringify(name)}, ${JSON.stringify(seed)})`;
        return await chrome.evaluate(expression);
      },
      async close(faults = {}) {
        return await runCleanupSteps({ chrome, vite, httpServer, profileDir }, { cleanupMs, faults });
      },
    };
  } catch (error) {
    // The start failed: run the SAME collector, attach its report to the
    // ORIGINAL error, and rethrow that original error — the test sees the
    // real startup failure and the cleanup diagnostics together.
    error.cleanupReport = await runCleanupSteps({ chrome, vite, httpServer, profileDir }, { cleanupMs });
    throw error;
  }
}
