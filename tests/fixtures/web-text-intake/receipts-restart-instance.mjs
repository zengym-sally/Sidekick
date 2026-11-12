//! First-instance runner for the MCP-receipt cross-restart regression tests.
//!
//! Byte-mirror of `recovery-instance.mjs` (blob 5fe68cb4…, verified identical
//! on the locked chain) with exactly one face changed: the controlled stub's
//! environment passthrough carries THIS suite's mode and receipt-identity
//! variables instead of the recovery suite's. Everything else is unchanged —
//! it boots the REAL web backend through the production entry
//! (`startWebBackend`: storage adapter, recovery scan, scheduler, HTTP/SSE)
//! with only the worker binary swapped for the controlled real stub process.
//! The test kills this process with SIGKILL to produce the genuine
//! crash/restart face, so the fixture must own nothing the surviving world
//! still needs.
//!
//! Usage: node receipts-restart-instance.mjs <root> <statusFile> <stubWorkerPath>
//! Writes one JSON line per lifecycle step to <statusFile>.

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [root, statusFile, stubWorkerPath] = process.argv.slice(2);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const storageBin = resolve(repositoryRoot, 'src-tauri/target/release/web-backend-storage');
const credentialModule = resolve(repositoryRoot, 'server/lib/credential-provider.mjs');
const configStoreModule = resolve(repositoryRoot, 'server/lib/config-store.mjs');
const entryModule = resolve(repositoryRoot, 'server/entries/web-backend-entry.mjs');

function record(event, extra = {}) {
  appendFileSync(statusFile, `${JSON.stringify({ event, ...extra })}\n`);
}

try {
  const { ControlledCredentialProvider } = await import(credentialModule);
  const { ConfigStore } = await import(configStoreModule);
  const { startWebBackend } = await import(entryModule);

  const credentialProvider = new ControlledCredentialProvider({ secrets: new Map([['controlled:e2e', 'synthetic']]) });
  // The model configuration must exist before the scheduler starts, so the
  // first claim launches a worker instead of failing on a missing snapshot.
  const configStore = new ConfigStore({ root, credentialProvider });
  await configStore.writeModelConfiguration({
    providers: [{ id: 'controlled', name: 'Controlled', apiFormat: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', auth: { type: 'bearer', apiKeyRef: 'controlled:e2e' }, enabled: true }],
    models: [{ id: 'controlled-model', providerId: 'controlled', apiModelId: 'controlled-model', name: 'Controlled', enabled: true, capabilities: { toolCall: false } }],
    defaultModelId: 'controlled-model',
  }, '');

  const backend = await startWebBackend({
    root,
    port: 0,
    initialize: true,
    storageBin,
    credentialProvider,
    workerRunLimitMs: 30000,
    workerProcessFactory: (file, args, options) =>
      // Same identity/argv shape as the real runtime (the `--run` marker
      // survives), only the payload binary is the controlled stub.
      spawn(process.execPath, [stubWorkerPath, ...args.slice(1)], {
        ...options,
        env: {
          ...options.env,
          SIDEKICK_RECEIPTS_STUB: process.env.SIDEKICK_RECEIPTS_STUB ?? 'receipts-bare',
          SIDEKICK_RECEIPTS_IDENTITY: process.env.SIDEKICK_RECEIPTS_IDENTITY ?? '{}',
        },
      }),
  });

  // Pair a real HTTP session so the test can drive this instance through the
  // frozen endpoints until it is SIGKILLed.
  const pairResponse = await fetch(`${backend.origin}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: backend.origin },
    body: JSON.stringify({ pairingCode: backend.pairingCode }),
  });
  const pairBody = await pairResponse.json();
  const cookie = (pairResponse.headers.get('set-cookie') ?? '').split(';')[0];

  record('ready', {
    pid: process.pid,
    port: backend.port,
    origin: backend.origin,
    token: cookie.replace('sidekick_session=', ''),
    csrfToken: pairBody.csrfToken,
  });
} catch (error) {
  record('fatal', { message: String(error?.stack ?? error) });
  process.exit(1);
}

// The test kills this process with SIGKILL (a genuine crash). No cleanup here:
// the storage adapter releases its root lock when its stdin closes.
