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
cp.execFileSync = (file, args = [], options = {}) => {
  if (file === '/usr/bin/open') {
    if (process.env.NATIVE_TEST_STALE) {
      const stale = JSON.parse(process.env.NATIVE_TEST_STALE);
      note({ kind: 'simulated-open' });
      fs.writeFileSync(stale.path, JSON.stringify(stale.info), { mode: 0o600, flag: 'wx' });
      return options.encoding ? '' : Buffer.alloc(0);
    }
    return block('open')();
  }
  if (process.env.NATIVE_TEST_STALE && file === '/bin/ps') {
    const stale = JSON.parse(process.env.NATIVE_TEST_STALE);
    if (args[0] === '-p' && args[1] === String(stale.info.pid) && args.includes('command=')) {
      note({ kind: 'simulated-app-ps' });
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

async function setup(t) {
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const result = await mkdtemp(join(artifacts, 'case-'));
  const base = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'sidekick-native-launcher-')));
  await chmod(base, 0o700);
  const root = join(base, 'app'), evidence = join(base, 'evidence');
  await mkdir(root, { mode: 0o700 }); await mkdir(evidence, { mode: 0o700 });
  const nonce = randomBytes(24).toString('hex'), marker = join(root, '.p6-native-verification');
  await writeFile(marker, nonce, { mode: 0o600, flag: 'wx' });
  await writeFile(join(root, 'native-info-existing.json'), '{"syntheticExistingInfo":true}', { mode: 0o600, flag: 'wx' });
  const fixture = await realpath(join(bundle, 'Contents/Resources/s33-ui/mcp-trial.mjs'));
  const fixtureSha256 = digest(await readFile(fixture));
  assert.equal(fixtureSha256, digest(await readFile('tests/fixtures/mcp-trial.mjs')), 'build the dedicated verification package before launcher tests');
  const modelLog = join(base, 'model.jsonl'), bundledNode = join(bundle, 'Contents/Resources/s0-runtime/node');
  const model = spawn(bundledNode, [fixture, 'model', modelLog, 'normal', 'launcher-negative', nonce], { env: { PATH: '/usr/bin:/bin', TMPDIR: base }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const receiptPath = join(evidence, 'owned-launch.json'), audit = join(evidence, 'test-audit.ndjson'), preload = join(evidence, 'test-preload.cjs');
  const save = () => writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  await save(); await writeFile(preload, preloadSource, { mode: 0o600, flag: 'wx' });
  await writeFile(join(result, 'setup-proof.json'), JSON.stringify({ base, root, nonce, model: receipt.model, listener }, null, 2));
  return { result, base, root, evidence, nonce, marker, receipt, receiptPath, modelLog, model, stop, save, audit, preload };
}

async function invoke(state, { dimensions = ['640', '900'], extra = [], stale = null } = {}) {
  const ignored = new Set([state.audit, ...(stale ? [stale.path] : [])]);
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

for (const dimensions of [['640', '1000'], ['1440', '900'], ['0', '900'], ['640', 'NaN']]) test(`invalid dimensions ${dimensions.join('x')} are rejected before launch`, async t => {
  const state = await setup(t);
  await rejected(state, /Invalid native reopen dimensions/, { dimensions });
});

test('extra CLI arguments are rejected before trusting a receipt', async t => {
  const state = await setup(t);
  await rejected(state, /Invalid native reopen arguments/, { extra: ['unowned-extra'] });
});

test('stale native-info dimensions are rejected in a test-only LaunchServices simulation; this is not native GUI evidence', async t => {
  const state = await setup(t);
  const stale = { path: join(state.root, 'native-info-simulated-stale.json'), command: `${executable} --s33-mcp-ui ${state.root} ${state.nonce}`, info: { identifier: 'com.sidekick.s33.ui.verify', workspace: join(state.root, 'workspace'), modelOwner: { pid: state.model.pid, nonce: state.nonce }, pid: unavailablePid - 1, geometryConfirmed: true, physicalInnerSize: { width: 1440, height: 1000 }, scale: 1, outerRect: { x: 0, y: 0, width: 640, height: 900 }, primaryMonitor: { x: 0, y: 0, width: 1920, height: 1080 } } };
  const result = await rejected(state, /Native reopen dimensions not confirmed/, { stale });
  assert.equal(result.audit.filter(note => note.kind === 'simulated-open').length, 1);
  assert.equal(result.audit.filter(note => note.kind === 'simulated-app-ps').length, 0);
  assert.deepEqual(JSON.parse(await readFile(stale.path, 'utf8')), stale.info);
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
