//! Web backend process entry: startup configuration, storage adapter, HTTP/SSE
//! assembly, task scheduler and graceful shutdown.
//!
//! Importing this module has no side effects; `startWebBackend(config)` is the
//! programmatic surface used by tests and by the CLI below.

import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { StorageClient } from '../lib/storage-client.mjs';
import { ManualItemsService } from '../lib/manual-items-service.mjs';
import { ApplicationSettingsService } from '../lib/application-settings-service.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { SseHub } from '../lib/sse-hub.mjs';
import { HttpServer } from '../lib/http-server.mjs';
import { TaskService } from '../lib/task-service.mjs';
import { TextIntakeService } from '../lib/text-intake-service.mjs';
import { ConfigStore } from '../lib/config-store.mjs';
import { createCredentialProvider } from '../lib/credential-provider.mjs';
import { TaskScheduler } from '../lib/task-scheduler.mjs';
import { TaskRecovery } from '../lib/task-recovery.mjs';
import { WorkerHost } from '../lib/worker-host.mjs';

export const DEFAULT_PORT = 8787;

// Default bundle layout, matching the slice-III `build-backend.mjs` output:
//   build/web-backend/server/entries/web-backend-entry.mjs
//   build/web-backend/{static,bin/web-backend-storage,runtime/}
// The entry itself sits at `<bundle>/server/entries/`, so the bundle root is
// exactly TWO levels up from the module's own directory — the defaults are
// derived from this module's real location (`import.meta.url`), never from
// the process cwd, and a test or CLI run overrides them explicitly.
// Source/test runs override `runtimeRoot` with this tree's `build/s0-runtime`.
function defaultStaticRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../static');
}

function defaultStorageBin() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../bin/web-backend-storage');
}

function defaultRuntimeRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../runtime');
}

export async function startWebBackend(config = {}) {
  const root = resolve(config.root ?? '');
  if (!root) throw new Error('root 必须显式给定');
  // GAP-5 pure validation first: the private knobs are checked BEFORE any
  // resource is opened, so a rejected configuration can never leak a storage
  // adapter, an SSE hub or a listening socket (the adapter's stdio pipes
  // otherwise keep the host process alive forever).
  const workerRunLimitMs = normalizeRunLimit(config.workerRunLimitMs);
  const port = Number(config.port ?? DEFAULT_PORT);
  const staticRoot = resolve(config.staticRoot ?? defaultStaticRoot());
  const storageBin = resolve(config.storageBin ?? defaultStorageBin());
  const runtimeRoot = resolve(config.runtimeRoot ?? defaultRuntimeRoot());
  const initialize = config.initialize === true;

  const storage = new StorageClient({ binary: storageBin, root, initialize });
  await storage.start();

  // Everything below runs with the storage adapter already open. A failure
  // anywhere in this assembly releases the resources THIS instance opened —
  // the adapter first, then the hub and the listening socket — before the
  // error is rethrown, so a failed start never leaks a child process.
  let httpServer = null;
  let scheduler = null;
  let sse = null;
  try {
    const credentialProvider = config.credentialProvider ?? createCredentialProvider();
    const service = new ManualItemsService(storage);
    const applicationSettings = new ApplicationSettingsService(storage);
    const sessions = new SessionStore();
    sse = new SseHub();
    sse.start();
    // One instance epoch for the SSE stream, the task_events rows and the
    // instance_epochs registration; a restarted backend gets a fresh one.
    const taskService = new TaskService({ storage, epoch: sse.epoch, root });
    const configStore = new ConfigStore({ root, credentialProvider });

    const textIntake = new TextIntakeService({
      storage,
      taskService,
      configStore,
      // The production default for an omitted `timeZone` on source submit
      // (frozen §5.1): the stored `application.timeZone` setting / OS fallback.
      applicationSettings,
      onCandidatesChanged: (change) => sse.broadcastCandidateChanged(change),
    });
    const workerHost = new WorkerHost({
      runtimeRoot,
      root,
      runLimitMs: workerRunLimitMs,
      processFactory: config.workerProcessFactory ?? null,
    });
    scheduler = new TaskScheduler({
      taskService,
      textIntakeService: textIntake,
      workerHost,
      credentialProvider,
      sse,
      epoch: sse.epoch,
    });
    const recovery = new TaskRecovery({ storage, taskService, root, workerHost, epoch: sse.epoch });

    httpServer = new HttpServer({
      service,
      sessions,
      sse,
      staticRoot,
      root,
      expectedHost: '',
      applicationSettings,
      taskService,
      textIntake,
      configStore,
      scheduler,
    });
    const actualPort = await httpServer.listen(port);
    const expectedHost = `127.0.0.1:${actualPort}`;
    httpServer.expectedHost = expectedHost;

    // GAP-2: a successful pairing consumes the one-time code and immediately
    // issues the next one through the same private callback. TTL, single-use and
    // rate-limit semantics are unchanged; no unauthenticated code endpoint exists.
    const sessionStore = sessions;
    const consumePairingCode = sessionStore.pair.bind(sessionStore);
    sessionStore.pair = (code) => {
      const result = consumePairingCode(code);
      if (typeof config.onPairingCode === 'function') config.onPairingCode(sessionStore.generatePairingCode());
      return result;
    };
    const pairingCode = sessions.generatePairingCode();
    if (typeof config.onPairingCode === 'function') config.onPairingCode(pairingCode);

    if (config.recover !== false) {
      await recovery.registerEpoch();
      const report = await recovery.recover();
      if (report.unverified.length) {
        scheduler.paused = report.unverified[0].reason;
      }
    }
    if (config.scheduler !== false) scheduler.start();

    const origin = `http://${expectedHost}`;
    let closed = false;
    const shutdown = async () => {
      if (closed) return;
      closed = true;
      await scheduler.stop();
      sse.stop();
      await httpServer.close();
      await storage.close();
    };

    return {
      origin,
      close: shutdown,
      pairingCode,
      port: actualPort,
      runtimeRoot,
      credentialProvider,
      scheduler,
      recovery,
    };
  } catch (error) {
    // Assembly failure: release what this instance opened, in reverse order.
    // The scheduler (when constructed) owns the worker host; the HTTP server
    // (when listening) owns the socket; the SSE hub owns its timers; the
    // storage adapter owns the child process and the root lock.
    if (scheduler) await scheduler.stop().catch(() => {});
    if (sse) sse.stop();
    if (httpServer) await httpServer.close().catch(() => {});
    await storage.close().catch(() => {});
    throw error;
  }
}

/// GAP-5: the run limit is a programmatic test knob, bounded to the same
/// 1–120000 ms range the runtime enforces. It is not read from HTTP/CLI/env.
/// The value is a strict JSON number: only an omitted/undefined knob takes the
/// default — a numeric string (`'500'`) or `null` is rejected, not coerced.
function normalizeRunLimit(value) {
  if (value === undefined) return 120000;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 120000) {
    throw new Error('workerRunLimitMs 必须是 1–120000 的整数。');
  }
  return value;
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith('--')) throw new Error(`无法识别的参数：${flag}`);
    const name = flag.slice(2);
    if (name === 'init') {
      // Boolean flag: no value, and never consumes the next flag.
      args.init = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`参数 ${flag} 缺少值`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) throw new Error('--root 必须显式给定');
  const backend = await startWebBackend({
    root: args.root,
    port: args.port ?? DEFAULT_PORT,
    staticRoot: args['static-root'],
    storageBin: args['storage-bin'],
    runtimeRoot: args['runtime-root'],
    initialize: args.init === true,
    onPairingCode: (code) => {
      process.stdout.write(`配对码：${code}\n`);
    },
  });
  process.stdout.write(`Web 后端已启动：${backend.origin}\n`);
  const shutdown = () => {
    void backend.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectRun = (() => {
  try {
    // Resolve symlinks on both sides: a CLI invoked through a symlinked path
    // must still run instead of silently doing nothing.
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] ?? ''));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`启动失败：${error.message}\n`);
    process.exit(1);
  });
}
