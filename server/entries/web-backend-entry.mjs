//! Web backend process entry: startup configuration, storage adapter, HTTP/SSE
//! assembly, static serving and graceful shutdown.
//!
//! Importing this module has no side effects; `startWebBackend(config)` is the
//! programmatic surface used by tests and by the CLI below.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { StorageClient } from '../lib/storage-client.mjs';
import { ManualItemsService } from '../lib/manual-items-service.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { SseHub } from '../lib/sse-hub.mjs';
import { HttpServer } from '../lib/http-server.mjs';

export const DEFAULT_PORT = 8787;

function defaultStaticRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../static');
}

function defaultStorageBin() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../bin/web-backend-storage');
}

export async function startWebBackend(config = {}) {
  const root = resolve(config.root ?? '');
  if (!root) throw new Error('root 必须显式给定');
  const port = Number(config.port ?? DEFAULT_PORT);
  const staticRoot = resolve(config.staticRoot ?? defaultStaticRoot());
  const storageBin = resolve(config.storageBin ?? defaultStorageBin());
  const initialize = config.initialize === true;

  const storage = new StorageClient({ binary: storageBin, root, initialize });
  await storage.start();

  const service = new ManualItemsService(storage);
  const sessions = new SessionStore();
  const sse = new SseHub();
  sse.start();

  const httpServer = new HttpServer({
    service,
    sessions,
    sse,
    staticRoot,
    root,
    expectedHost: '',
  });
  const actualPort = await httpServer.listen(port);
  const expectedHost = `127.0.0.1:${actualPort}`;
  httpServer.expectedHost = expectedHost;

  const pairingCode = sessions.generatePairingCode();
  if (typeof config.onPairingCode === 'function') config.onPairingCode(pairingCode);

  const origin = `http://${expectedHost}`;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    sse.stop();
    await httpServer.close();
    await storage.close();
  }

  return { origin, close, pairingCode, port: actualPort };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag.startsWith('--')) throw new Error(`无法识别的参数：${flag}`);
    args[flag.slice(2)] = argv[index + 1];
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
    initialize: args.init === undefined ? false : true,
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
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
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
