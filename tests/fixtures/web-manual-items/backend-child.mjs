// Test-owned child process for the SIGKILL restart suite. It imports the same pinned
// startWebBackend interface as the in-process helper and forwards the one-time pairing code
// (received through the private onPairingCode callback) to the test process over this child's
// dedicated IPC channel. The code never reaches stdout, a URL, a log or a file.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const send = (message) => {
  if (process.send) process.send(message);
};

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let handle = null;

try {
  const module = await import(pathToFileURL(config.entry).href);
  if (typeof module.startWebBackend !== 'function') {
    throw new Error(`${config.entry} does not export startWebBackend(config); the frozen docking interface is not met`);
  }
  handle = await module.startWebBackend({
    root: config.root,
    port: 0,
    staticRoot: config.staticRoot,
    storageBin: config.storageBin,
    initialize: config.initialize !== false,
    onPairingCode: (code) => send({ type: 'pairing-code', code }),
  });
  if (!handle?.origin || typeof handle.close !== 'function') {
    throw new Error('startWebBackend did not return {origin, close}; the frozen docking interface is not met');
  }
  send({ type: 'ready', origin: handle.origin });
} catch (error) {
  send({ type: 'error', message: String(error?.stack ?? error) });
  process.exit(1);
}

process.on('SIGTERM', async () => {
  try { await handle?.close(); } catch { /* hard-exit paths are covered by the SIGKILL case */ }
  process.exit(0);
});
