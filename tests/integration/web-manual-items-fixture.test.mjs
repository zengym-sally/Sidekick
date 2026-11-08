// MAYNE-23 slice II (revision r4): ownership regression for the in-process backend fixture
// (OBS-1 from the OhMyPi r3 review of 229c8cb, backend-process.mjs close()). A successful
// close() must follow the same root-ownership rule as the failure path: a caller-supplied
// root and its contents survive every path, only a root the fixture created is removed, and
// the backend handle — which in production waits for the HTTP/SSE server, the storage child
// process and the root lock — is still closed and awaited before close() resolves.
// The docking interface is pinned by the fixture itself (startWebBackend(config) resolving
// {origin, close}); these cases stub that interface with a synthetic entry, so the fixture's
// own ownership and cleanup logic runs without build artifacts. Production behavior stays
// covered by the real HTTP/restart/static suites; nothing here signs a business result.
// Leak attribution (OBS-1' from the OhMyPi r4 review): a temporary root is only this
// process's business when this process created it, so every temporary root this file
// creates is confined to a private per-run base and the leak check reads exactly that set.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBackend, PrerequisiteGap } from '../fixtures/web-manual-items/backend-process.mjs';

// Synthetic docking-interface stub: startWebBackend(config) resolves {origin, close}, spawns
// a stand-in for the storage child process and records its pid, and initializes the root it
// was handed. close() kills and reaps that child — the lifecycle production promises, so a
// fixture that skipped or did not await handle.close() is caught by the process assertions.
const stubEntrySource = `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function startWebBackend(config) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 120000);'], { stdio: 'ignore' });
  writeFileSync(new URL('./storage-child.pid', import.meta.url), String(child.pid));
  writeFileSync(join(config.root, 'stub-initialized.marker'), 'the stub backend initialized this root');
  return {
    origin: 'http://127.0.0.1:1',
    async close() {
      child.kill('SIGKILL');
      await new Promise((resolve) => { child.once('exit', resolve); });
    },
  };
}
`;

const missingInterfaceEntrySource = 'export const notTheDockingInterface = true;\n';

function stubWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'web-manual-items-fixture-stub-'));
  const entry = join(dir, 'stub-entry.mjs');
  writeFileSync(entry, stubEntrySource);
  const storageBin = join(dir, 'stub-storage-bin');
  writeFileSync(storageBin, 'synthetic storage binary stand-in\n');
  return { dir, entry, storageBin, pidFile: join(dir, 'storage-child.pid') };
}

// Explicit synthetic root owned by the caller, with recognizable content that must survive
// every fixture path — including a successful close().
function callerRoot(tag) {
  const root = join(mkdtempSync(join(tmpdir(), 'web-manual-items-caller-')), tag);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'caller-marker.txt'), 'caller-owned content');
  mkdirSync(join(root, 'nested'), { recursive: true });
  writeFileSync(join(root, 'nested', 'deep.txt'), 'deep caller content');
  return root;
}

function assertCallerRootIntact(root) {
  assert.ok(existsSync(root), `the caller-supplied root must survive: ${root}`);
  assert.equal(readFileSync(join(root, 'caller-marker.txt'), 'utf8'), 'caller-owned content');
  assert.equal(readFileSync(join(root, 'nested', 'deep.txt'), 'utf8'), 'deep caller content');
}

// Leak attribution (OBS-1'): the previous criterion compared the whole shared temp
// directory's same-prefix set before and after, so a concurrent process creating or
// removing a web-manual-items-* root — the three business suites run in their own
// processes and mkdtemp the same prefix — could flip the equality without this process
// leaking anything. Every temporary root this process creates (the fixture's mkdtemp
// roots, the stub workspaces and the caller roots) is therefore confined to a private
// per-run base, and the leak check reads exactly that set: a root this process leaks
// still lands there and is still rejected, while foreign churn in the shared directory
// cannot be seen.
const privateTmpBase = mkdtempSync(join(tmpdir(), 'web-manual-items-fixture-run-'));
const previousTmpdir = process.env.TMPDIR;
process.env.TMPDIR = privateTmpBase;
after(() => {
  if (previousTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpdir;
  rmSync(privateTmpBase, { recursive: true, force: true });
});

// Roots the fixture itself created, by the exact mkdtempSync('web-manual-items-') name;
// the stub and caller prefixes carry extra segments and are excluded, and the scan reads
// the private per-run base, so the set is exactly the roots this process created.
const selfCreatedRootName = /^web-manual-items-[A-Za-z0-9]{6}$/;
function selfCreatedRoots() {
  return readdirSync(privateTmpBase).filter((name) => selfCreatedRootName.test(name)).sort();
}

function childPid(workspace) {
  return Number(readFileSync(workspace.pidFile, 'utf8'));
}

function assertProcessGone(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    assert.equal(error.code, 'ESRCH', `the backend child ${pid} must be gone after close(), got ${error.code}`);
    return;
  }
  assert.fail(`the backend child process ${pid} must not survive close()`);
}

function killIfAlive(pid) {
  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');
  } catch { /* already gone */ }
}

function cleanup(workspace, root) {
  if (existsSync(workspace.pidFile)) killIfAlive(childPid(workspace));
  rmSync(workspace.dir, { recursive: true, force: true });
  if (root) rmSync(root, { recursive: true, force: true });
}

test('close() on the success path preserves a caller-supplied root and its contents (OBS-1)', async () => {
  const workspace = stubWorkspace();
  const root = callerRoot('success');
  try {
    const backend = await startBackend({ entry: workspace.entry, storageBin: workspace.storageBin, root, pair: false });
    assert.equal(backend.root, root, 'the fixture must run on the caller-supplied root');
    assert.equal(readFileSync(join(root, 'stub-initialized.marker'), 'utf8'),
      'the stub backend initialized this root', 'the backend writes into the caller root while it runs');
    await backend.close();
    assertCallerRootIntact(root);
    assert.equal(readFileSync(join(root, 'stub-initialized.marker'), 'utf8'),
      'the stub backend initialized this root', 'content the backend wrote into the caller root must survive a successful close()');
    assertProcessGone(childPid(workspace));
  } finally {
    cleanup(workspace, root);
  }
});

test('close() on the success path removes a root the fixture created', async () => {
  const workspace = stubWorkspace();
  let root = null;
  try {
    const backend = await startBackend({ entry: workspace.entry, storageBin: workspace.storageBin, pair: false });
    root = backend.root;
    assert.ok(existsSync(root), 'the self-created root must exist while the backend runs');
    await backend.close();
    assert.ok(!existsSync(root), 'a root the fixture created must be removed by close()');
    assertProcessGone(childPid(workspace));
  } finally {
    cleanup(workspace, root);
  }
});

test('a failed start (pairing timeout) closes the handle and preserves a caller-supplied root', async () => {
  const workspace = stubWorkspace();
  const root = callerRoot('pair-timeout');
  const before = selfCreatedRoots();
  try {
    await assert.rejects(
      startBackend({ entry: workspace.entry, storageBin: workspace.storageBin, root, pairingTimeoutMs: 300 }),
      /pairing code was not delivered through the onPairingCode private callback/,
    );
    assertCallerRootIntact(root);
    assertProcessGone(childPid(workspace));
  } finally {
    cleanup(workspace, root);
  }
  assert.deepEqual(selfCreatedRoots(), before, 'a failed start must not leak a temporary root');
});

test('a failed start (pairing timeout) removes a root the fixture created', async () => {
  const workspace = stubWorkspace();
  const before = selfCreatedRoots();
  try {
    await assert.rejects(
      startBackend({ entry: workspace.entry, storageBin: workspace.storageBin, pairingTimeoutMs: 300 }),
      /pairing code was not delivered through the onPairingCode private callback/,
    );
    assertProcessGone(childPid(workspace));
  } finally {
    cleanup(workspace, null);
  }
  assert.deepEqual(selfCreatedRoots(), before, 'a failed start must remove a root the fixture created');
});

test('an entry without startWebBackend fails with PrerequisiteGap and leaks no root', async () => {
  const workspace = stubWorkspace();
  const entry = join(workspace.dir, 'wrong-interface.mjs');
  writeFileSync(entry, missingInterfaceEntrySource);
  const root = callerRoot('wrong-interface');
  const before = selfCreatedRoots();
  try {
    await assert.rejects(
      startBackend({ entry, storageBin: workspace.storageBin, root }),
      (error) => error instanceof PrerequisiteGap && /does not export startWebBackend/.test(error.message),
    );
    assertCallerRootIntact(root);
  } finally {
    cleanup(workspace, root);
  }
  assert.deepEqual(selfCreatedRoots(), before, 'a failed start must leak no temporary root');
});

test('a missing entry or storage binary fails with PrerequisiteGap before the root is touched', async () => {
  const workspace = stubWorkspace();
  const root = callerRoot('missing-artifacts');
  const before = selfCreatedRoots();
  try {
    await assert.rejects(
      startBackend({ entry: join(workspace.dir, 'absent-entry.mjs'), storageBin: workspace.storageBin, root }),
      (error) => error instanceof PrerequisiteGap && /missing prerequisite: web backend entry module/.test(error.message),
    );
    await assert.rejects(
      startBackend({ entry: workspace.entry, storageBin: join(workspace.dir, 'absent-storage-bin'), root }),
      (error) => error instanceof PrerequisiteGap && /missing prerequisite: web-backend-storage binary/.test(error.message),
    );
    assertCallerRootIntact(root);
  } finally {
    cleanup(workspace, root);
  }
  assert.deepEqual(selfCreatedRoots(), before, 'a prerequisite failure happens before any root is created');
});
