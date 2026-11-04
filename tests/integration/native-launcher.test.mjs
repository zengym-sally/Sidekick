import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, readFile, writeFile, readdir, lstat, readlink, chmod, symlink, link, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const program = resolve(process.env.NATIVE_LAUNCHER_SCRIPT || 'scripts/probes/run-mcp-native.mjs');
const artifacts = resolve('build/p6-native-20261101/launcher-implementation');
const bundle = resolve('src-tauri/target/release/bundle/macos/Sidekick MCP Verify.app');
const executable = join(bundle, 'Contents/MacOS/sidekick');
const proofOptions = { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000 };
const digest = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const unavailablePid = 2147483647;

const preloadSource = `const cp = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { syncBuiltinESMExports } = require('node:module');
const note = value => fs.appendFileSync(process.env.NATIVE_TEST_AUDIT, JSON.stringify(value) + '\\n', { mode: 0o600 });
const block = kind => (...args) => { note({ kind }); throw new Error('TEST_NATIVE_FORBIDDEN_' + kind); };
const originalExec = cp.execFileSync;
let appIdentityObservations = 0;
cp.execFileSync = (file, args = [], options = {}) => {
  if (file === '/usr/bin/open') {
    if (process.env.NATIVE_TEST_STALE) {
      const stale = JSON.parse(process.env.NATIVE_TEST_STALE);
      note({ kind: 'simulated-open' });
      if (stale.startup) {
        fs.writeFileSync(stale.startup.path, stale.partialStartup ? '' : JSON.stringify(stale.startup.data), { mode: 0o600, flag: 'wx' });
        if (stale.partialStartup && !stale.neverComplete) setTimeout(() => fs.writeFileSync(stale.startup.path, JSON.stringify(stale.startup.data)), 150);
      }
      if (stale.failure) {
        fs.writeFileSync(stale.failure.path, stale.partialFailure ? '' : JSON.stringify(stale.failure.data), { mode: 0o600, flag: 'wx' });
        if (stale.partialFailure && !stale.neverCompleteFailure) setTimeout(() => fs.writeFileSync(stale.failure.path, JSON.stringify(stale.failure.data)), 150);
        if (stale.failure.mode) fs.chmodSync(stale.failure.path, stale.failure.mode);
        const sibling = require('node:path').join(require('node:path').dirname(stale.failure.path), 'failure-reference.json');
        if (stale.failure.hardlink) fs.linkSync(stale.failure.path, sibling);
        if (stale.failure.symlink) { fs.renameSync(stale.failure.path, sibling); fs.symlinkSync(sibling, stale.failure.path); }
      }
      fs.writeFileSync(stale.path, stale.partialReady ? '' : JSON.stringify(stale.info), { mode: 0o600, flag: 'wx' });
      if (stale.partialReady && !stale.neverComplete) setTimeout(() => fs.writeFileSync(stale.path, JSON.stringify(stale.info)), 150);
      return options.encoding ? '' : Buffer.alloc(0);
    }
    return block('open')();
  }
  if (process.env.NATIVE_TEST_STALE && file === '/bin/ps') {
    const stale = JSON.parse(process.env.NATIVE_TEST_STALE);
    if (args[0] === '-p' && args[1] === String(stale.info.pid) && (args.includes('command=') || args.includes('uid=,lstart=,command='))) {
      note({ kind: 'simulated-app-ps' });
      if (args.includes('uid=,lstart=,command=')) {
        appIdentityObservations++;
        if (stale.exitAfterStartup && appIdentityObservations > 1) { const error = new Error('TEST_APP_EXITED'); error.status = 1; throw error; }
        return appIdentityObservations === 1 ? stale.identity : stale.readyIdentity || stale.identity;
      }
      return stale.command;
    }
  }
  note({ kind: 'exec', file, args });
  return originalExec(file, args, options);
};
cp.spawn = block('spawn');
net.connect = block('network'); net.createConnection = block('network');
http.request = block('network'); http.get = block('network');
https.request = block('network'); https.get = block('network');
globalThis.fetch = block('network');
syncBuiltinESMExports();
`;

async function notes(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function waitFor(check, label) {
  const deadline = Date.now() + 5000;
  while (!(await check())) { assert.ok(Date.now() < deadline, label); await pause(10); }
}

async function tree(path, ignored = new Set()) {
  const entries = [];
  async function visit(current, name) {
    if (ignored.has(current)) return;
    const info = await lstat(current);
    entries.push({ name, mode: info.mode & 0o7777, uid: info.uid, ...(info.isDirectory() ? {} : { nlink: info.nlink }), type: info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'directory' : 'file', ...(info.isSymbolicLink() ? { target: await readlink(current) } : info.isFile() ? { sha256: digest(await readFile(current)) } : {}) });
    if (info.isDirectory()) for (const child of (await readdir(current)).sort()) await visit(join(current, child), `${name}/${child}`);
  }
  await visit(path, '.');
  return entries;
}

async function setup(t, g1 = false) {
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const result = await mkdtemp(join(artifacts, 'case-'));
  const base = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'sidekick-native-launcher-')));
  await chmod(base, 0o700);
  const root = join(base, 'app'), evidence = join(base, 'evidence');
  await mkdir(root, { mode: 0o700 }); await mkdir(evidence, { mode: 0o700 });
  const nonce = randomBytes(24).toString('hex'), marker = join(root, g1 ? '.s36-native-verification' : '.p6-native-verification');
  await writeFile(marker, nonce, { mode: 0o600, flag: 'wx' });
  await writeFile(join(root, 'native-info-existing.json'), '{"syntheticExistingInfo":true}', { mode: 0o600, flag: 'wx' });
  const fixture = await realpath(join(bundle, 'Contents/Resources/s33-ui/mcp-trial.mjs'));
  const fixtureSha256 = digest(await readFile(fixture));
  assert.equal(fixtureSha256, digest(await readFile('tests/fixtures/mcp-trial.mjs')), 'build the dedicated verification package before launcher tests');
  const modelLog = join(base, 'model.jsonl'), bundledNode = join(bundle, 'Contents/Resources/s0-runtime/node');
  const model = spawn(bundledNode, [fixture, 'model', modelLog, g1 ? 'g1' : 'normal', 'launcher-negative', nonce], { env: { PATH: '/usr/bin:/bin', TMPDIR: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  model.stdout.on('data', bytes => { stdout += bytes; }); model.stderr.on('data', bytes => { stderr += bytes; });
  const stop = async () => { if (model.exitCode === null && model.signalCode === null) { const exited = once(model, 'exit'); model.kill('SIGTERM'); await exited; } };
  t.after(async () => { await stop(); await writeFile(join(result, 'model-stdout.log'), stdout); await writeFile(join(result, 'model-stderr.log'), stderr); });
  await waitFor(() => { assert.equal(model.exitCode, null, `owned fixture exited: ${stderr}`); return stdout.includes('\n'); }, 'owned fixture did not become ready');
  const port = Number(new URL(stdout.trim()).port), command = execFileSync('/bin/ps', ['-p', String(model.pid), '-o', 'uid=,lstart=,command='], proofOptions).trim();
  const listener = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(model.pid), '-iTCP@127.0.0.1:' + port, '-sTCP:LISTEN', '-Fp'], proofOptions);
  assert.ok(listener.split('\n').includes('p' + model.pid));
  assert.throws(() => process.kill(unavailablePid, 0), { code: 'ESRCH' });
  const receipt = { layer: 'launcher rejection tests; synthetic model; no native App', bundle, executable, model: { port, pid: model.pid, command, nonce, script: fixture }, root, base, nonce, fixtureSha256, executableSha256: digest(await readFile(executable)), launched: [{ pid: unavailablePid }] };
  if (g1) receipt.scope = 'controlled-native-g1';
  const receiptPath = join(evidence, 'owned-launch.json'), audit = join(evidence, 'test-audit.ndjson'), preload = join(evidence, 'test-preload.cjs');
  const save = () => writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  await save(); await writeFile(preload, preloadSource, { mode: 0o600, flag: 'wx' });
  await writeFile(join(result, 'setup-proof.json'), JSON.stringify({ base, root, nonce, model: receipt.model, listener }, null, 2));
  return { result, base, root, evidence, nonce, marker, receipt, receiptPath, modelLog, model, stop, save, audit, preload };
}

async function invoke(state, { dimensions = ['640', '900'], extra = [], stale = null } = {}) {
  const ignored = new Set([state.audit, ...(stale ? [stale.path, ...(stale.startup ? [stale.startup.path] : [])] : [])]);
  const before = await tree(state.base, ignored);
  const result = spawnSync(process.execPath, ['--require', state.preload, program, '--reopen', state.evidence, ...dimensions, ...extra], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', TMPDIR: state.base, NATIVE_TEST_AUDIT: state.audit, ...(stale ? { NATIVE_TEST_STALE: JSON.stringify(stale) } : {}) }, timeout: 10000 });
  await writeFile(join(state.result, 'runner-stdout.log'), result.stdout || '');
  await writeFile(join(state.result, 'runner-stderr.log'), result.stderr || '');
  const audit = await notes(state.audit), modelRequests = await notes(state.modelLog);
  await writeFile(join(state.result, 'runner-result.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, audit, modelRequests }, null, 2));
  return { ...result, audit, modelRequests, unchanged: async () => assert.deepEqual(await tree(state.base, ignored), before, 'rejected launcher changed its synthetic root or receipt') };
}

async function rejected(state, expected, options) {
  const result = await invoke(state, options);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, expected);
  assert.ok(!result.stdout.includes('"ready":true'));
  assert.equal(result.audit.filter(note => ['open', 'spawn', 'network'].includes(note.kind)).length, 0, 'launcher reached a forbidden side effect');
  assert.equal(result.modelRequests.length, 0, 'launcher sent model HTTP');
  await result.unchanged();
  return result;
}

test('noncanonical base is rejected before any launch, child creation, root creation, or model HTTP', async t => {
  const state = await setup(t);
  state.receipt.base += '/.'; await state.save();
  await rejected(state, /Native reopen scope mismatch/);
});

test('test-only side-effect guard blocks open before the OS call and leaves real ps available', async t => {
  const state = await setup(t);
  const result = spawnSync(process.execPath, ['--require', state.preload, '-e', "const cp = require('node:child_process'); cp.execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'pid=']); cp.execFileSync('/usr/bin/open', []);"], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', NATIVE_TEST_AUDIT: state.audit }, timeout: 2000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TEST_NATIVE_FORBIDDEN_open/);
  const audit = await notes(state.audit);
  assert.equal(audit.filter(note => note.kind === 'exec' && note.file === '/bin/ps').length, 1);
  assert.equal(audit.filter(note => note.kind === 'open').length, 1);
  assert.equal((await notes(state.modelLog)).length, 0);
  await writeFile(join(state.result, 'guard-self-test.json'), JSON.stringify({ status: result.status, audit, scope: 'open wrapper was invoked; OS open was blocked' }, null, 2));
});

test('a living prior App OS process substitute is rejected before cold reopen; this is not native GUI evidence', async t => {
  const state = await setup(t);
  const substitute = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', state.root, state.nonce], { argv0: executable, env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' });
  t.after(async () => { if (substitute.exitCode === null && substitute.signalCode === null) { const exited = once(substitute, 'exit'); substitute.kill('SIGTERM'); await exited; } });
  await pause(20);
  const command = execFileSync('/bin/ps', ['-p', String(substitute.pid), '-o', 'command='], proofOptions).trim();
  assert.ok(command.startsWith(executable) && command.includes(state.root) && command.includes(state.nonce), 'OS argv0 is unavailable; native launcher rejection was not exercised');
  await writeFile(join(state.result, 'app-os-substitute.json'), JSON.stringify({ layer: 'owned Node Child with argv0; not a native App', pid: substitute.pid, command }, null, 2));
  state.receipt.launched = [{ pid: substitute.pid }]; await state.save();
  await rejected(state, /The previous owned App must exit before a cold reopen/);
});

test('receipt owner launch identity drift is rejected before launch', async t => {
  const state = await setup(t);
  state.receipt.model.command += ' changed-owner-start'; await state.save();
  await rejected(state, /Native reopen model identity changed/);
});

test('an exited receipt model owner is rejected without creating a new model child', async t => {
  const state = await setup(t); await state.stop();
  await rejected(state, /Command failed: \/bin\/ps/);
});

test('a port listening under another owned model child is rejected without HTTP to either child', async t => {
  const state = await setup(t), other = await setup(t);
  state.receipt.model.port = other.receipt.model.port; await state.save();
  await rejected(state, /Command failed: \/usr\/sbin\/lsof/);
  assert.equal((await notes(other.modelLog)).length, 0);
});

for (const [name, change] of [
  ['nonprivate receipt mode', state => chmod(state.receiptPath, 0o644)],
  ['multiply linked receipt', state => link(state.receiptPath, join(state.evidence, 'receipt-other-link.json'))],
  ['symlink receipt', async state => { const original = join(state.evidence, 'receipt-original.json'); await rename(state.receiptPath, original); await symlink(original, state.receiptPath); }]
]) test(`${name} is rejected before trusting the native scope`, async t => {
  const state = await setup(t); await change(state);
  await rejected(state, /Private native launch receipt required/);
});

for (const [name, change] of [
  ['nonprivate marker mode', state => chmod(state.marker, 0o644)],
  ['multiply linked marker', state => link(state.marker, join(state.root, 'marker-other-link'))],
  ['symlink marker', async state => { const original = join(state.root, 'marker-original'); await rename(state.marker, original); await symlink(original, state.marker); }],
  ['nonprivate root mode', state => chmod(state.root, 0o755)],
  ['nonprivate base mode', state => chmod(state.base, 0o755)]
]) test(`${name} is rejected before cold reopen`, async t => {
  const state = await setup(t); await change(state);
  await rejected(state, /Private native reopen scope required/);
});

test('a marker carrying another nonce is rejected without mutating the root', async t => {
  const state = await setup(t);
  await writeFile(state.marker, randomBytes(24).toString('hex'), { mode: 0o600 });
  await rejected(state, /Native reopen marker mismatch/);
});

for (const [name, change, expected] of [
  ['another bundle path', receipt => { receipt.bundle += '.unowned'; }, /Native reopen scope mismatch/],
  ['another executable path', receipt => { receipt.executable += '.unowned'; }, /Native reopen scope mismatch/],
  ['another model script', receipt => { receipt.model.script += '.unowned'; }, /Native reopen scope mismatch/],
  ['another model nonce', receipt => { receipt.model.nonce = '0'.repeat(48); }, /Native reopen scope mismatch/],
  ['another claimed model UID', receipt => { receipt.model.command = receipt.model.command.replace(/^\d+/, String(process.getuid() + 1)); }, /Native reopen model identity mismatch/],
  ['a privileged model port', receipt => { receipt.model.port = 80; }, /Native reopen model identity mismatch/],
  ['missing prior App receipt', receipt => { receipt.launched = []; }, /Native reopen previous App receipt missing/],
  ['changed packaged fixture digest', receipt => { receipt.fixtureSha256 = '0'.repeat(64); }, /Native reopen fixture changed/]
]) test(`${name} is rejected without launching or repairing a scope`, async t => {
  const state = await setup(t); change(state.receipt); await state.save();
  await rejected(state, expected);
});

for (const dimensions of [['640', '1000'], ['1440', '900'], ['640', '800'], ['1440', '800'], ['0', '900'], ['640', 'NaN']]) test(`invalid dimensions ${dimensions.join('x')} are rejected before launch`, async t => {
  const state = await setup(t);
  await rejected(state, /Invalid native reopen dimensions/, { dimensions });
});

test('extra CLI arguments are rejected before trusting a receipt', async t => {
  const state = await setup(t);
  await rejected(state, /Invalid native reopen arguments/, { extra: ['unowned-extra'] });
});

function g1Simulation(state, width = 640, height = 900) {
  const pid = unavailablePid - 1, scope = 'controlled-native-g1';
  const launchScope = scope + ':' + state.receipt.model.port + ':' + state.model.pid;
  const command = [executable, '--s33-mcp-ui', state.root, state.nonce, String(width), String(height), launchScope, '--reopen'].join(' ');
  const identity = String(process.getuid()) + ' Mon Nov 2 00:00:00 2026 ' + command;
  const startup = { pid, uid: process.getuid(), identity, command, identifier: 'com.sidekick.s33.ui.verify', scope, launchScope, root: state.root, nonce: state.nonce };
  return {
    path: join(state.root, 'native-info-g1-simulated.json'), command, identity,
    startup: { path: join(state.root, 'native-startup-g1-simulated.json'), data: startup },
    info: { identifier: 'com.sidekick.s33.ui.verify', workspace: join(state.root, 'workspace'), modelOwner: { pid: state.model.pid, nonce: state.nonce }, pid, scope, startupIdentity: startup, schemaVersion: 5, geometryConfirmed: true, physicalInnerSize: { width, height }, scale: 1, outerRect: { x: 0, y: 0, width, height }, primaryMonitor: { x: 0, y: 0, width: 1920, height: 1080 } },
  };
}
test('g1 launcher reopens its own scope with startup identity in a simulation, without native GUI evidence', async t => {
  const state = await setup(t, true), simulated = g1Simulation(state);
  const result = await invoke(state, { stale: simulated });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.audit.filter(row => row.kind === 'simulated-open').length, 1);
  assert.equal(result.audit.filter(row => ['open', 'spawn', 'network'].includes(row.kind)).length, 0);
  assert.equal(result.modelRequests.length, 0);
  const receipt = JSON.parse(await readFile(state.receiptPath, 'utf8'));
  assert.equal(receipt.scope, 'controlled-native-g1');
  assert.equal(receipt.launched.at(-1).initialIdentity.identity, simulated.identity);
});
for (const height of [800, 900, 1000]) test(`g1 launcher reopens a 1440x${height} wide window with exact geometry in a simulation`, async t => {
  const state = await setup(t, true), simulated = g1Simulation(state, 1440, height);
  if (height === 900) {
    simulated.info.outerRect = { x: 36, y: 20, width: 1440, height: 928 };
    simulated.info.primaryMonitor = { x: 0, y: 0, width: 1512, height: 982 };
  }
  const result = await invoke(state, { dimensions: ['1440', String(height)], stale: simulated });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.audit.filter(row => row.kind === 'simulated-open').length, 1);
  assert.equal(result.audit.filter(row => ['open', 'spawn', 'network'].includes(row.kind)).length, 0);
  assert.equal(result.modelRequests.length, 0);
  assert.deepEqual(JSON.parse(result.stdout).requested, { width: 1440, height });
});
test('g1 launcher reopens the approved 640x800 narrow window', async t => {
  const state = await setup(t, true), simulated = g1Simulation(state, 640, 800);
  const result = await invoke(state, { dimensions: ['640', '800'], stale: simulated });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).requested, { width: 640, height: 800 });
  assert.equal(result.modelRequests.length, 0);
});
for (const dimensions of [['640', '1000'], ['1440', '899'], ['1440', '901']]) test(`g1 launcher rejects unapproved dimensions ${dimensions.join('x')} before open`, async t => {
  const state = await setup(t, true);
  await rejected(state, /Invalid native reopen dimensions/, { dimensions });
});
for (const failure of ['physical-size', 'outside-monitor']) test(`g1 1440x900 still rejects ${failure} in a simulation`, async t => {
  const state = await setup(t, true), simulated = g1Simulation(state, 1440, 900);
  simulated.info.primaryMonitor = { x: 0, y: 0, width: 1512, height: 982 };
  if (failure === 'physical-size') simulated.info.physicalInnerSize.height = 1000;
  else simulated.info.outerRect = { x: 100, y: 0, width: 1440, height: 928 };
  const result = await invoke(state, { dimensions: ['1440', '900'], stale: simulated });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, failure === 'physical-size' ? /Native reopen dimensions not confirmed/ : /Native reopen window is outside the display/);
  assert.ok(!result.stdout.includes('"ready":true'));
  assert.equal(result.audit.filter(row => row.kind === 'simulated-open').length, 1);
  assert.equal(result.audit.filter(row => ['open', 'spawn', 'network'].includes(row.kind)).length, 0);
  assert.equal(result.modelRequests.length, 0);
  const receipt = JSON.parse(await readFile(state.receiptPath, 'utf8'));
  assert.equal(receipt.launched.at(-1).state, 'starting');
  assert.equal(receipt.launched.at(-1).initialIdentity.identity, simulated.identity);
});
test('g1 launcher rejects cross-scope marker reuse before simulated open', async t => {
  const state = await setup(t);
  state.receipt.scope = 'controlled-native-g1'; await state.save();
  await rejected(state, /scope|ENOENT|marker/i);
});
test('g1 launcher rejects a startup identity that disagrees with its root nonce', async t => {
  const state = await setup(t, true), simulated = g1Simulation(state);
  simulated.startup.data = { ...simulated.startup.data, nonce: '0'.repeat(48) };
  await rejected(state, /startup|identity/i, { stale: simulated });
});
for (const pending of ['partialStartup', 'partialReady']) test('g1 launcher retries a visible but unfinished ' + pending + ' receipt', async t => {
  const state = await setup(t, true), simulated = g1Simulation(state);
  simulated[pending] = true;
  const result = await invoke(state, { stale: simulated });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.audit.filter(row => row.kind === 'simulated-open').length, 1);
  assert.equal(result.modelRequests.length, 0);
});
test('g1 launcher bounds a startup receipt that never becomes complete', async t => {
  const state = await setup(t, true), simulated = g1Simulation(state);
  simulated.partialStartup = true; simulated.neverComplete = true;
  const started = performance.now();
  const result = await invoke(state, { stale: simulated });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /startup|incomplete/i);
  assert.ok(performance.now() - started >= 7000, 'incomplete receipt was rejected before its bounded publication wait');
  assert.ok(performance.now() - started < 10000);
  assert.ok(!result.stdout.includes('"ready":true'));
  assert.equal(result.modelRequests.length, 0);
  await result.unchanged();
});
for (const field of ['start-time', 'uid']) test('g1 launcher rejects ready process ' + field + ' drift after a valid startup observation', async t => {
  const state = await setup(t, true), simulated = g1Simulation(state);
  simulated.readyIdentity = field === 'uid' ? simulated.identity.replace(/^\d+/, String(process.getuid() + 1)) : simulated.identity.replace('00:00:00', '00:00:01');
  const result = await invoke(state, { stale: simulated });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /identity/i);
  assert.ok(!result.stdout.includes('"ready":true'));
  assert.equal(result.modelRequests.length, 0);
});

function failureSimulation(state) {
  const simulated = g1Simulation(state);
  simulated.failure = { path: join(state.root, 'native-failure-simulated.json'), data: {
    version: 1, kind: 'g1-native-readiness-failure', scope: 'controlled-native-g1', pid: simulated.info.pid, nonceSha256: digest(state.nonce),
    diagnostic: { stage: 'inner_size', reason: 'deadline', requested: [640, 900], inner: [1280, 1600], scale: 2, monitor: [0, 0, 3024, 1964], workArea: [0, 66, 3024, 1774], outer: null, target: null, position: null },
  } };
  return simulated;
}
async function refusedFailure(state, simulated, pattern) {
  const result = await invoke(state, { stale: simulated });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, pattern);
  assert.ok(!result.stdout.includes('"ready":true'));
  assert.ok(!result.stderr.includes('PRIVATE_DIAGNOSTIC_CANARY'));
  assert.equal(result.audit.filter(row => row.kind === 'simulated-open').length, 1);
  assert.equal(result.audit.filter(row => ['open', 'spawn', 'network'].includes(row.kind)).length, 0);
  assert.equal(result.modelRequests.length, 0);
  const receipt = JSON.parse(await readFile(state.receiptPath, 'utf8'));
  assert.equal(receipt.launched.at(-1).state, 'starting');
  return result;
}
test('g1 private readiness failure takes precedence over a simultaneously visible ready record', async t => {
  const state = await setup(t, true), simulated = failureSimulation(state);
  await refusedFailure(state, simulated, /Native readiness failed at inner_size \(deadline\)/);
});
test('g1 partial private failure blocks ready until its bounded publication completes', async t => {
  const state = await setup(t, true), simulated = failureSimulation(state);
  simulated.partialFailure = true;
  await refusedFailure(state, simulated, /Native readiness failed at inner_size \(deadline\)/);
});
test('g1 diagnostics preserve negative coordinates and an outer rectangle beyond the monitor', async t => {
  const state = await setup(t, true), simulated = failureSimulation(state);
  Object.assign(simulated.failure.data.diagnostic, { stage: 'bounds', reason: 'bounds', monitor: [-300, -200, 1280, 800], outer: [2880, 1656], target: [-10, -20], position: [-30, -40] });
  await refusedFailure(state, simulated, /Native readiness failed at bounds \(bounds\)/);
});
test('g1 never-complete failure cannot be bypassed by valid ready data', async t => {
  const state = await setup(t, true), simulated = failureSimulation(state);
  simulated.partialFailure = true; simulated.neverCompleteFailure = true;
  const started = performance.now();
  await refusedFailure(state, simulated, /startup|ready|receipt/i);
  assert.ok(performance.now() - started >= 7000);
  assert.ok(performance.now() - started < 10000);
});
for (const [name, change] of [
  ['wrong pid', f => { f.data.pid++; }],
  ['wrong nonce digest', f => { f.data.nonceSha256 = '0'.repeat(64); }],
  ['wrong scope', f => { f.data.scope = 'controlled-native-mcp'; }],
  ['wrong version', f => { f.data.version = 2; }],
  ['wrong dimensions', f => { f.data.diagnostic.requested = [1440, 800]; }],
  ['unknown stage', f => { f.data.diagnostic.stage = 'PRIVATE_DIAGNOSTIC_CANARY'; }],
  ['unknown reason', f => { f.data.diagnostic.reason = 'PRIVATE_DIAGNOSTIC_CANARY'; }],
  ['extra secret field', f => { f.data.extra = 'PRIVATE_DIAGNOSTIC_CANARY'; }],
  ['extra diagnostic field', f => { f.data.diagnostic.error = 'PRIVATE_DIAGNOSTIC_CANARY'; }],
  ['oversized record', f => { f.data.extra = 'PRIVATE_DIAGNOSTIC_CANARY'.repeat(300); }],
  ['invalid numeric shape', f => { f.data.diagnostic.inner = [1]; }],
  ['nonprivate mode', f => { f.mode = 0o644; }],
  ['hardlinked record', f => { f.hardlink = true; }],
  ['symlink record', f => { f.symlink = true; }],
]) test(`g1 failure ${name} is rejected without publishing ready or its raw contents`, async t => {
  const state = await setup(t, true), simulated = failureSimulation(state); change(simulated.failure);
  await refusedFailure(state, simulated, /Invalid private native failure receipt/);
});
test('g1 readiness failure never relaxes the fresh App identity check after exit', async t => {
  const state = await setup(t, true), simulated = failureSimulation(state);
  simulated.exitAfterStartup = true;
  await refusedFailure(state, simulated, /identity|process|TEST_APP_EXITED/i);
});
test('g1 failure growth is refused after reading at most its fixed limit plus one', async t => {
  const state = await setup(t, true), simulated = failureSimulation(state);
  const source = preloadSource + `
const fsp = require('node:fs/promises');
const originalOpen = fsp.open;
fsp.open = async (path, ...args) => {
  const file = await originalOpen(path, ...args);
  if (String(path).includes('native-failure-')) {
    const read = file.read.bind(file);
    file.read = async (...options) => {
      fs.appendFileSync(path, 'x'.repeat(5000));
      const size = options[0].buffer.length;
      note({ kind: 'bounded-failure-read', requested: size });
      return read(...options);
    };
    file.readFile = async () => { note({ kind: 'unbounded-failure-read' }); throw new Error('TEST_UNBOUNDED_READ'); };
  }
  return file;
};
syncBuiltinESMExports();`;
  await writeFile(state.preload, source, { mode: 0o600 });
  const result = await refusedFailure(state, simulated, /Invalid private native failure receipt/);
  assert.equal(result.audit.filter(row => row.kind === 'unbounded-failure-read').length, 0);
  assert.deepEqual(result.audit.filter(row => row.kind === 'bounded-failure-read').map(row => row.requested), [4097]);
});

test('stale native-info dimensions are rejected in a test-only LaunchServices simulation; this is not native GUI evidence', async t => {
  const state = await setup(t);
  const stale = { path: join(state.root, 'native-info-simulated-stale.json'), command: `${executable} --s33-mcp-ui ${state.root} ${state.nonce}`, info: { identifier: 'com.sidekick.s33.ui.verify', workspace: join(state.root, 'workspace'), modelOwner: { pid: state.model.pid, nonce: state.nonce }, pid: unavailablePid - 1, geometryConfirmed: true, physicalInnerSize: { width: 1440, height: 1000 }, scale: 1, outerRect: { x: 0, y: 0, width: 640, height: 900 }, primaryMonitor: { x: 0, y: 0, width: 1920, height: 1080 } } };
  const result = await rejected(state, /Native reopen dimensions not confirmed/, { stale });
  assert.equal(result.audit.filter(note => note.kind === 'simulated-open').length, 1);
  assert.equal(result.audit.filter(note => note.kind === 'simulated-app-ps').length, 0);
  assert.deepEqual(JSON.parse(await readFile(stale.path, 'utf8')), stale.info);
});

for (const g1 of [false, true]) for (const control of [false, true]) test(`${g1 ? 'g1' : 'legacy MCP'} initial dimensions${control ? ' and stdin scope boundaries' : ''} use guarded launch simulation`, async t => {
  const state = await setup(t, g1), evidence = join(state.base, 'initial-dimensions');
  await mkdir(evidence, { mode: 0o700 });
  const audit = join(state.result, 'dimensions-audit.ndjson'), preload = join(state.result, 'dimensions-preload.cjs');
  const source = preloadSource
    .replace('let appIdentityObservations = 0;', 'let appIdentityObservations = 0; let initialNative = null; let initialOpenCount = 0;')
    .replace("if (file === '/usr/bin/open') {", `if (file === '/usr/bin/open') {
    if (process.env.NATIVE_TEST_INITIAL === '1') {
      const path = require('node:path');
      const launch = args.slice(args.indexOf('--args') + 1);
      const [flag, root, nonce, rawWidth, rawHeight, launchScope] = launch;
      if (flag !== '--s33-mcp-ui' || !root.startsWith(process.env.TMPDIR + path.sep) || !/^[0-9a-f]{48}$/.test(nonce)) throw new Error('TEST_INITIAL_SCOPE');
      const width = Number(rawWidth), height = Number(rawHeight), scope = process.env.NATIVE_STARTUP_SCOPE === 'g1' ? 'controlled-native-g1' : 'controlled-native-mcp';
      if (!launchScope.startsWith(scope + ':')) throw new Error('TEST_INITIAL_SCOPE');
      const pid = 2147483646, command = [args[args.indexOf('--args') - 1] + '/Contents/MacOS/sidekick', ...launch].join(' ');
      const identity = String(process.getuid()) + ' Mon Nov 2 00:00:00 2026 ' + command;
      const startup = { pid, uid: process.getuid(), identity, command, identifier: 'com.sidekick.s33.ui.verify', scope, launchScope, root, nonce };
      const monitor = JSON.parse(process.env.NATIVE_INITIAL_MONITOR);
      const info = { identifier: startup.identifier, workspace: path.join(root, 'workspace'), modelOwner: { pid: Number(launchScope.split(':')[2]), nonce }, pid, scope, startupIdentity: startup, schemaVersion: 4, geometryConfirmed: true, physicalInnerSize: { width, height }, scale: 1, outerRect: { x: 0, y: 0, width, height: height + 28 }, primaryMonitor: { x: 0, y: 0, width: monitor[0], height: monitor[1] } };
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      initialNative = { pid, command, identity };
      initialOpenCount++;
      note({ kind: 'initial-simulated-open', width, height, launch });
      if (scope === 'controlled-native-g1') fs.writeFileSync(path.join(root, 'native-startup-initial-' + initialOpenCount + '.json'), JSON.stringify(startup), { mode: 0o600, flag: 'wx' });
      fs.writeFileSync(path.join(root, 'native-info-initial-' + initialOpenCount + '.json'), JSON.stringify(info), { mode: 0o600, flag: 'wx' });
      return options.encoding ? '' : Buffer.alloc(0);
    }`)
    .replace("if (process.env.NATIVE_TEST_STALE && file === '/bin/ps') {", `if (initialNative && file === '/bin/ps' && args[0] === '-p' && args[1] === String(initialNative.pid)) {
    if (args.includes('uid=,lstart=,command=')) return initialNative.identity;
    if (args.includes('command=')) return initialNative.command;
  }
  if (process.env.NATIVE_TEST_STALE && file === '/bin/ps') {`)
    .replace("cp.spawn = block('spawn');", `const originalSpawn = cp.spawn;
cp.spawn = (file, args, options) => {
  const path = require('node:path'), base = path.dirname(args[2] || '');
  const mode = process.env.NATIVE_STARTUP_SCOPE;
  if (file !== process.env.NATIVE_STARTUP_NODE || args.length !== 6 || args[0] !== process.env.NATIVE_STARTUP_FIXTURE || args[1] !== 'model' || args[3] !== mode || !/^[0-9a-f]{48}$/.test(args[5]) || !base.startsWith(process.env.TMPDIR + path.sep) || args[2] !== path.join(base, 'model.jsonl') || args[4] !== (mode === 'g1' ? path.join(base, 'app/synthetic-marker') : 'native') || Object.keys(options.env).sort().join(',') !== 'PATH,TMPDIR') return block('spawn')();
  const child = originalSpawn(file, args, options);
  const identity = originalExec('/bin/ps', ['-p', String(child.pid), '-o', 'uid=,lstart=,command='], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).trim();
  note({ kind: 'owned-model-spawn', pid: child.pid, file, args, identity });
  return child;
};`);
  await writeFile(preload, source, { mode: 0o600 });
  const commands = control ? [{ op: 'reopen', width: 640, height: 1000 }, { op: 'reopen', width: 1440, height: 899 }, { op: 'reopen', width: 1440, height: 800 }, { op: 'reopen', width: 640, height: 800 }, { op: 'reopen', width: 1440, height: 900 }, { op: 'reopen', width: 1440, height: 1000 }, { op: 'reopen', width: 640, height: 900 }] : [];
  commands.push({ op: 'stop-model' });
  const result = spawnSync(process.execPath, ['--require', preload, program, ...(g1 ? ['--g1'] : []), evidence], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', TMPDIR: state.base, NATIVE_TEST_AUDIT: audit, NATIVE_TEST_INITIAL: '1', NATIVE_STARTUP_SCOPE: g1 ? 'g1' : 'normal', NATIVE_STARTUP_NODE: join(bundle, 'Contents/Resources/s0-runtime/node'), NATIVE_STARTUP_FIXTURE: state.receipt.model.script, NATIVE_INITIAL_MONITOR: JSON.stringify(g1 && !control ? [1512, 982] : [1920, 1080]) }, input: commands.map(value => JSON.stringify(value)).join('\n') + '\n', timeout: 10000 });
  const events = await notes(audit), children = events.filter(row => row.kind === 'owned-model-spawn');
  const alive = child => {
    try {
      const actual = execFileSync('/bin/ps', ['-p', String(child.pid), '-o', 'uid=,lstart=,command='], proofOptions).trim();
      assert.equal(actual, child.identity, 'only the exact initial owned model may be observed or signalled');
      return true;
    } catch (error) { if (error.status === 1) return false; throw error; }
  };
  t.after(async () => { for (const child of children) if (alive(child)) { process.kill(child.pid, 'SIGTERM'); await waitFor(() => !alive(child), 'initial model cleanup failed'); } });
  await writeFile(join(state.result, 'dimensions-result.json'), JSON.stringify({ status: result.status, error: result.error?.message, events, stdout: result.stdout, stderr: result.stderr }, null, 2));
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const expected = [[1440, g1 ? 800 : 1000], ...(control ? [...(g1 ? [[1440, 800], [640, 800], [1440, 900]] : []), [1440, 1000], [640, 900]] : [])];
  assert.deepEqual(events.filter(row => row.kind === 'initial-simulated-open').map(row => [row.width, row.height]), expected);
  const receipt = JSON.parse(await readFile(join(evidence, 'owned-launch.json'), 'utf8'));
  assert.equal(receipt.launched.length, expected.length);
  assert.equal(result.stdout.trim().split('\n').filter(line => JSON.parse(line).ready).length, expected.length);
  assert.equal((result.stderr.match(/Unexpected native acceptance dimensions/g) || []).length, control ? g1 ? 2 : 5 : 0);
  assert.equal(events.filter(row => ['open', 'spawn', 'network', 'simulated-open'].includes(row.kind)).length, 0);
  assert.equal(children.length, 1);
  for (const child of children) { assert.equal((await notes(child.args[2])).length, 0); assert.equal(alive(child), false); }
  assert.equal((await notes(state.modelLog)).length, 0);
});

for (const failure of ['existing-input', 'existing-stderr', 'receipt-write', 'stderr-write']) test(`initial runner ${failure} leaves no owned model child`, async t => {
  const state = await setup(t);
  const evidence = join(state.base, 'initial-evidence');
  await mkdir(evidence, { mode: 0o700 });
  if (failure === 'existing-input') await writeFile(join(evidence, 'service-input.json'), 'preserved-input', { mode: 0o600 });
  if (failure === 'existing-stderr') await writeFile(join(evidence, 'model-stderr.log'), 'preserved-log', { mode: 0o600 });
  const audit = join(state.result, 'initial-audit.ndjson'), preload = join(state.result, 'initial-preload.cjs');
  const source = preloadSource.replace("cp.spawn = block('spawn');", `const originalSpawn = cp.spawn;
cp.spawn = (file, args, options) => {
  if (file !== process.env.NATIVE_STARTUP_NODE || args[0] !== process.env.NATIVE_STARTUP_FIXTURE || args[1] !== 'model' || !/^[0-9a-f]{48}$/.test(args.at(-1))) return block('spawn')();
  const child = originalSpawn(file, args, options);
  note({ kind: 'owned-model-spawn', pid: child.pid, file, args });
  if (process.env.NATIVE_STARTUP_FAIL_STDERR) {
    const pipe = child.stderr.pipe.bind(child.stderr);
    child.stderr.pipe = (destination, ...rest) => { const result = pipe(destination, ...rest); process.nextTick(() => { note({ kind: 'stderr-write-fault' }); destination.emit('error', new Error('TEST_NATIVE_STDERR_WRITE')); }); return result; };
  }
  return child;
};
const fsp = require('node:fs/promises');
const originalWrite = fsp.writeFile;
fsp.writeFile = async (path, ...args) => {
  if (process.env.NATIVE_STARTUP_FAIL_RECEIPT && String(path).endsWith('/owned-launch.json')) { note({ kind: 'receipt-write-fault' }); throw new Error('TEST_NATIVE_RECEIPT_WRITE'); }
  return originalWrite(path, ...args);
};`);
  await writeFile(preload, source, { mode: 0o600 });
  const result = spawnSync(process.execPath, ['--require', preload, program, evidence], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', TMPDIR: state.base, NATIVE_TEST_AUDIT: audit, NATIVE_STARTUP_NODE: join(bundle, 'Contents/Resources/s0-runtime/node'), NATIVE_STARTUP_FIXTURE: state.receipt.model.script, ...(failure === 'receipt-write' ? { NATIVE_STARTUP_FAIL_RECEIPT: '1' } : {}), ...(failure === 'stderr-write' ? { NATIVE_STARTUP_FAIL_STDERR: '1' } : {}) }, timeout: 10000 });
  const events = await notes(audit), children = events.filter(event => event.kind === 'owned-model-spawn');
  const proof = { status: result.status, error: result.error?.message, events, stdout: result.stdout, stderr: result.stderr };
  const alive = child => {
    try {
      const line = execFileSync('/bin/ps', ['-p', String(child.pid), '-o', 'stat=,command='], proofOptions).trim();
      if (!line || line.split(/\s+/)[0].startsWith('Z')) return false;
      assert.ok(line.includes(child.args[0]) && line.includes(child.args.at(-1)), 'only the recorded owned model may be observed or signalled');
      return true;
    } catch (error) { if (error.status === 1) return false; throw error; }
  };
  t.after(async () => {
    for (const child of children) if (alive(child)) { process.kill(child.pid, 'SIGTERM'); await waitFor(() => !alive(child), 'test cleanup could not reap its exact owned model'); }
  });
  await writeFile(join(state.result, 'initial-result.json'), JSON.stringify(proof, null, 2));
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes('"ready":true'));
  assert.equal(events.filter(event => ['open', 'spawn', 'network', 'simulated-open'].includes(event.kind)).length, 0, 'initial failure must not reach App open or an unowned child/network');
  assert.ok(children.length <= 1);
  if (failure.startsWith('existing-')) assert.equal(children.length, 0, 'evidence conflicts must be rejected before creating a model child');
  if (failure === 'receipt-write') assert.equal(events.filter(event => event.kind === 'receipt-write-fault').length, 1);
  if (failure === 'stderr-write') {
    assert.equal(events.filter(event => event.kind === 'stderr-write-fault').length, 1);
    assert.ok(!result.stderr.includes("Unhandled 'error' event"), 'stderr failures must enter owned cleanup instead of an unhandled stream crash');
  }
  const deadline = Date.now() + 1500;
  while (children.some(alive) && Date.now() < deadline) await pause(10);
  proof.childrenAliveAfterFailure = children.filter(alive).map(child => child.pid);
  await writeFile(join(state.result, 'initial-result.json'), JSON.stringify(proof, null, 2));
  assert.deepEqual(proof.childrenAliveAfterFailure, [], 'the runner leaked its newly spawned model after preparation failed');
  assert.equal((await notes(state.modelLog)).length, 0);
  assert.equal(state.model.exitCode, null, 'unrelated controlled model remains alive');
  if (failure === 'existing-input') assert.equal(await readFile(join(evidence, 'service-input.json'), 'utf8'), 'preserved-input');
  if (failure === 'existing-stderr') assert.equal(await readFile(join(evidence, 'model-stderr.log'), 'utf8'), 'preserved-log');
});
