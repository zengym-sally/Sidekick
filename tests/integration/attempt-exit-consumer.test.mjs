//! Consumer integration: the web-api/2 wire surface carries the typed exit
//! evidence, the SSE task frame carries the exit state, and every envelope
//! (task / error / stream) reports `web-api/2`. Real service over a synthetic
//! root; the worker is a synthetic protocol process, never a real Pi.
//!
//! Expectations come from the frozen web-api/2 contract (§3.1/§3.1.1/§6), not
//! from the implementation's own outputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  startBackend,
  pollUntil,
  createControlledCredentialProvider,
  runtimeRootAvailable,
  bundledRuntimeRoot,
} from '../fixtures/web-text-intake/backend-process.mjs';
import { createProtocolWorkerFactory } from '../fixtures/web-text-intake/protocol-worker.mjs';
import { startControlledModelService, writeScript } from '../fixtures/web-text-intake/controlled-model.mjs';
import { openEventStream } from '../fixtures/web-text-intake/sse-listener.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const storageBinary = join(repositoryRoot, 'src-tauri/target/release/web-backend-storage');

class PrerequisiteGap extends Error {}
function requireBinary() {
  if (!existsSync(storageBinary)) throw new PrerequisiteGap('storage adapter binary not found; build it with cargo.');
}

function writeModelConfig(root, baseUrl, revision) {
  const configDir = join(root, 'config');
  mkdirSync(join(configDir, 'agents'), { recursive: true });
  writeFileSync(join(configDir, 'providers.json'), JSON.stringify({
    providers: [{
      id: 'controlled-openai', name: 'Controlled', enabled: true, apiFormat: 'openai_compatible',
      baseUrl, auth: { type: 'bearer', apiKeyRef: 'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY' },
    }],
  }, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(configDir, 'models.json'), JSON.stringify({
    models: [{ id: 'controlled-organizer-model', providerId: 'controlled-openai', apiModelId: 'controlled-organizer-model', name: 'Controlled', enabled: true, capabilities: { toolCall: true } }],
    sidekick: { defaultModelId: 'controlled-organizer-model', revision },
  }, null, 2) + '\n', { mode: 0o600 });
}

test('the task resource, SSE frame and error envelope all report web-api/2', async (t) => {
  requireBinary();
  const runtimeRoot = runtimeRootAvailable() ? bundledRuntimeRoot : undefined;
  const backend = await startBackend({
    runtimeRoot,
    pairingTimeoutMs: 20000,
    credentialProvider: createControlledCredentialProvider({
      'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY': { value: 'synthetic-consumer-key', status: 'available' },
    }),
    workerProcessFactory: createProtocolWorkerFactory({ scenarios: ['well-behaved'] }),
  });
  const script = writeScript(join(backend.root, 'model-script'), 'export function queueExtractAnswer() { return { candidates: [] }; }');
  const model = await startControlledModelService({ script, record: join(backend.root, 'model.jsonl') });
  t.after(async () => { await model.stop(); await backend.close(); });
  writeModelConfig(backend.root, model.url, 'rev-consumer-1');

  const submitted = await backend.request('POST', '/api/text-sources', {
    body: {
      operationId: `op_exit_consumer_${Date.now()}`,
      input: { text: '消费者集成面：合成整理输入，用于验证 web-api/2 线域。', timeZone: 'Asia/Shanghai' },
    },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(submitted.status, 200, `source submit must succeed: ${submitted.text}`);
  const taskId = submitted.json.task.taskId;

  // The SSE task.changed frame carries the typed exit state (frozen §6).
  const stream = await openEventStream(backend.origin, { cookie: backend.cookie });
  const changed = await stream.waitFor((frame) => frame.event === 'task.changed'
    && frame.data?.objectId === taskId
    && frame.data?.taskState === 'succeeded');
  assert.equal(changed.data.contractVersion, 'web-api/2');
  assert.equal(changed.data.attemptExitState, 'exited_confirmed');
  stream.close();

  // The task resource carries the typed evidence (frozen §3.1/§3.1.1).
  const task = await pollUntil(async () => {
    const response = await backend.request('GET', `/api/tasks/${taskId}`, { cookie: backend.cookie });
    const resource = response.json?.task ?? response.json;
    return resource?.state === 'succeeded' ? resource : null;
  }, { timeoutMs: 15000, message: 'the task to reach succeeded' });
  assert.equal(task.contractVersion, 'web-api/2');
  assert.equal(task.attemptExitState, 'exited_confirmed');
  assert.ok(task.attemptExitEvidence, 'the terminal task must carry its typed evidence');
  assert.equal(task.attemptExitEvidence.verdict, 'registry_extinct');
  assert.equal(task.attemptExitEvidence.residual.treeExtinctProven, false);
  assert.ok(task.result, 'the staged outcome is published');

  // The static 404 envelope reports the same contract version.
  const missing = await backend.request('GET', '/api/tasks/tsk_does_not_exist', { cookie: backend.cookie });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.contractVersion, 'web-api/2');
});

test('the reviewed client readSnapshot accepts the real HTTP snapshot and rejects a shape violation', async (t) => {
  requireBinary();
  const runtimeRoot = runtimeRootAvailable() ? bundledRuntimeRoot : undefined;
  const backend = await startBackend({
    runtimeRoot,
    pairingTimeoutMs: 20000,
    credentialProvider: createControlledCredentialProvider({
      'env:WEB_TEXT_INTAKE_SYNTHETIC_KEY': { value: 'synthetic-snapshot-key', status: 'available' },
    }),
  });
  t.after(() => backend.close());

  // The real HTTP snapshot output, fed to the REVIEWED client's readSnapshot.
  const response = await fetch(`${backend.origin}/api/snapshot`, { headers: { cookie: backend.cookie } });
  const payload = await response.json();
  const { WebApiClient } = await import('../../src/lib/web-api-client.ts');

  const origin = new URL(backend.origin);
  const windowStub = { location: { host: origin.host, origin: backend.origin } };
  const realFetch = globalThis.fetch;
  const realWindow = globalThis.window;
  globalThis.window = windowStub;
  globalThis.fetch = (url, options) => realFetch(new URL(url, backend.origin), {
    ...options,
    headers: { ...(options?.headers ?? {}), cookie: backend.cookie },
  });
  t.after(() => { globalThis.fetch = realFetch; globalThis.window = realWindow; });

  const client = new WebApiClient(backend.origin);
  const snapshot = await client.readSnapshot();
  assert.equal(snapshot.contractVersion, 'web-api/2');
  assert.equal(typeof snapshot.generatedAt, 'string');
  assert.equal(typeof snapshot.settings.version, 'number');
  assert.equal(snapshot.agentConcurrency, snapshot.settings.agentConcurrency);
  assert.ok(Array.isArray(snapshot.workspace.capabilities));
  assert.ok('recovery' in snapshot.workspace);

  // Negative control: a snapshot missing a normative member is REJECTED.
  const broken = { ...payload, generatedAt: undefined };
  globalThis.fetch = async () => new Response(JSON.stringify(broken), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => client.readSnapshot(), (error) => error?.code === 'contract_shape');
});
