// Test-owned child process for the SIGKILL restart suite. It imports the same
// pinned startWebBackend interface as the in-process helper and forwards the
// one-time pairing code (received through the private onPairingCode callback)
// to the test process over this child's dedicated IPC channel. The code never
// reaches stdout, a URL, a log or a file.
//
// The MAYNE-24 arbitration additions are forwarded the same private way: an
// optional runtimeRoot (source verification points at this tree's bundled Pi
// runtime) and the controlled credential provider. Per the frozen 2026-11-08
// arbitration the provider spec is received over this dedicated IPC channel
// BEFORE the backend starts; the child builds the in-memory controlled
// provider and hands it to the established config.credentialProvider. No
// post-start setter alias is probed. Revocation arrives later as a
// credential-status message that mutates the child-held provider state, so
// the fixture-held state change reaches production without any production
// setter.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const send = (message) => {
  if (process.send) process.send(message);
};

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const credentialEntries = new Map();

const buildProvider = () => ({
  kind: 'controlled',
  async resolve(ref) {
    const entry = credentialEntries.get(ref);
    if (!entry || entry.status === 'missing') {
      const error = new Error(`controlled credential provider: ref ${ref} is not resolvable`);
      error.code = 'CREDENTIAL_MISSING';
      throw error;
    }
    return entry.value;
  },
  async status(ref) {
    const entry = credentialEntries.get(ref);
    if (!entry) return { status: 'missing', detail: 'no synthetic entry for this ref' };
    return { status: entry.status ?? 'available' };
  },
});

let handle = null;

// Startup gate: the child does not import or start the backend until the test
// process has delivered the credential decision over the private IPC channel
// (the provider spec, or an explicit begin when the suite injects nothing).
const startupGate = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('the child did not receive the credential-provider IPC message within 30s')),
    30000,
  );
  const onStartup = (message) => {
    if (message?.type === 'credential-provider') {
      for (const [ref, entry] of Object.entries(message.entries ?? {})) credentialEntries.set(ref, { ...entry });
      clearTimeout(timer);
      process.off('message', onStartup);
      resolve(buildProvider());
    } else if (message?.type === 'begin') {
      clearTimeout(timer);
      process.off('message', onStartup);
      resolve(null);
    }
  };
  process.on('message', onStartup);
});

// Revocation: the fixture-held provider state is pushed in over the same
// private channel; the child-held provider mirrors it and acknowledges.
process.on('message', (message) => {
  if (message?.type !== 'credential-status') return;
  const entry = credentialEntries.get(message.ref);
  if (!entry) {
    send({ type: 'credential-status-error', ref: message.ref, message: `no synthetic entry for ref ${message.ref}` });
    return;
  }
  entry.status = message.status;
  send({ type: 'credential-status-applied', ref: message.ref, status: message.status });
});

try {
  const provider = await startupGate;
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
    ...(config.runtimeRoot !== undefined ? { runtimeRoot: config.runtimeRoot } : {}),
    ...(provider !== null ? { credentialProvider: provider } : {}),
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
