import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, realpath, readdir, lstat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';

if (process.argv[2] === '--reopen') {
  if (process.argv.length !== 6) throw new Error('Invalid native reopen arguments.');
  const evidence = resolve(process.argv[3]), width = Number(process.argv[4]), height = Number(process.argv[5]);
  if (!(width === 640 && height === 900 || width === 1440 && height === 1000)) throw new Error('Invalid native reopen dimensions.');
  const path = join(evidence, 'owned-launch.json'), metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== process.getuid() || (metadata.mode & 0o7777) !== 0o600) throw new Error('Private native launch receipt required.');
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  const bundle = resolve('src-tauri/target/release/bundle/macos/Sidekick MCP Verify.app'), executable = join(bundle, 'Contents/MacOS/sidekick');
  const fixture = await realpath(join(bundle, 'Contents/Resources/s33-ui/mcp-trial.mjs'));
  if (receipt.bundle !== bundle || receipt.executable !== executable || receipt.model?.script !== fixture || receipt.model.nonce !== receipt.nonce || !/^[0-9a-f]{48}$/.test(receipt.nonce) || receipt.root !== join(receipt.base, 'app') || await realpath(receipt.root) !== receipt.root || await realpath(receipt.base) !== receipt.base) throw new Error('Native reopen scope mismatch.');
  for (const [entry, mode, directory] of [[receipt.base, 0o700, true], [receipt.root, 0o700, true], [join(receipt.root, '.p6-native-verification'), 0o600, false]]) {
    const current = await lstat(entry);
    if (current.isSymbolicLink() || current.uid !== process.getuid() || (current.mode & 0o7777) !== mode || (directory ? !current.isDirectory() : !current.isFile() || current.nlink !== 1)) throw new Error('Private native reopen scope required.');
  }
  if (await readFile(join(receipt.root, '.p6-native-verification'), 'utf8') !== receipt.nonce) throw new Error('Native reopen marker mismatch.');
  const owner = receipt.model;
  if (!Number.isInteger(owner.port) || owner.port < 1024 || owner.port > 65535 || !Number.isInteger(owner.pid) || owner.pid <= 1 || typeof owner.command !== 'string' || !owner.command.includes(fixture) || !owner.command.includes(receipt.nonce) || Number(owner.command.split(/\s+/)[0]) !== process.getuid()) throw new Error('Native reopen model identity mismatch.');
  const proof = { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] };
  const actualOwner = execFileSync('/bin/ps', ['-p', String(owner.pid), '-o', 'uid=,lstart=,command='], proof).trim();
  if (actualOwner !== owner.command) throw new Error('Native reopen model identity changed.');
  const listener = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(owner.pid), '-iTCP@127.0.0.1:' + owner.port, '-sTCP:LISTEN', '-Fp'], proof);
  if (!listener.split('\n').includes('p' + owner.pid)) throw new Error('Native reopen model listener changed.');
  const prior = receipt.launched?.at(-1);
  if (!prior || !Number.isInteger(prior.pid)) throw new Error('Native reopen previous App receipt missing.');
  let oldCommand = '';
  try { oldCommand = execFileSync('/bin/ps', ['-p', String(prior.pid), '-o', 'command='], proof).trim(); } catch {}
  if (oldCommand.startsWith(executable) && oldCommand.includes(receipt.root) && oldCommand.includes(receipt.nonce)) throw new Error('The previous owned App must exit before a cold reopen.');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  if (receipt.fixtureSha256 !== digest(await readFile(fixture)) || receipt.fixtureSha256 !== digest(await readFile('tests/fixtures/mcp-trial.mjs'))) throw new Error('Native reopen fixture changed.');
  const identifier = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(bundle, 'Contents/Info.plist')], proof).trim();
  if (identifier !== 'com.sidekick.s33.ui.verify') throw new Error('Dedicated native reopen package required.');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], proof);
  const before = new Set(await readdir(receipt.root));
  execFileSync('/usr/bin/open', ['-n', bundle, '--args', '--s33-mcp-ui', receipt.root, receipt.nonce, String(width), String(height), 'controlled-native-mcp:' + owner.port + ':' + owner.pid, '--reopen'], { env: { PATH: '/usr/bin:/bin', TMPDIR: receipt.base }, stdio: 'pipe' });
  let info;
  for (let attempt = 0; attempt < 80; attempt++) {
    const file = (await readdir(receipt.root)).find(name => name.startsWith('native-info-') && !before.has(name));
    if (file) { info = JSON.parse(await readFile(join(receipt.root, file), 'utf8')); break; }
    await new Promise(accept => setTimeout(accept, 100));
  }
  if (!info || info.identifier !== identifier || info.workspace !== join(receipt.root, 'workspace') || info.modelOwner?.pid !== owner.pid || info.modelOwner.nonce !== receipt.nonce) throw new Error('Native reopen receipt was not confirmed.');
  if (info.geometryConfirmed !== true || !Number.isFinite(info.scale) || info.scale <= 0 || info.physicalInnerSize?.width !== Math.round(width * info.scale) || info.physicalInnerSize?.height !== Math.round(height * info.scale)) throw new Error('Native reopen dimensions not confirmed.');
  const actual = execFileSync('/bin/ps', ['-p', String(info.pid), '-o', 'command='], proof).trim();
  if (!actual.startsWith(executable) || !actual.includes(receipt.root) || !actual.includes(receipt.nonce)) throw new Error('Native reopen App identity changed.');
  const rect = info.outerRect, monitor = info.primaryMonitor;
  if (rect.x < monitor.x || rect.y < monitor.y || rect.x + rect.width > monitor.x + monitor.width || rect.y + rect.height > monitor.y + monitor.height) throw new Error('Native reopen window is outside the display.');
  receipt.launched.push({ at: new Date().toISOString(), pid: info.pid, width, height, reopen: true, executableSha256: digest(await readFile(executable)), info });
  await writeFile(path, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify({ ready: true, pid: info.pid, root: receipt.root, modelPid: owner.pid, requested: { width, height }, actual: info.physicalInnerSize, outerRect: rect }) + '\n');
  process.exit(0);
}
if (process.argv.length > 3) throw new Error('Only an evidence directory argument is accepted.');
const evidence = resolve(process.argv[2] || 'build/p6-native-20261101');
await mkdir(join(evidence, 'native'), { recursive: true, mode: 0o700 });
const bundle = resolve('src-tauri/target/release/bundle/macos/Sidekick MCP Verify.app');
const resources = join(bundle, 'Contents/Resources');
const executable = join(bundle, 'Contents/MacOS/sidekick');
const identifier = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
if (identifier !== 'com.sidekick.s33.ui.verify') throw new Error('Dedicated verification package required.');
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
const fixture = await realpath(join(resources, 's33-ui/mcp-trial.mjs'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (digest(await readFile(fixture)) !== digest(await readFile('tests/fixtures/mcp-trial.mjs'))) throw new Error('Controlled fixture does not match the current source.');
for (const name of ['model-stderr.log', 'service-input.json', 'owned-launch.json']) {
  try { await lstat(join(evidence, name)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  throw new Error('Native evidence already exists: ' + name);
}
const nonce = randomBytes(24).toString('hex');
const base = await realpath(await mkdtemp(join(tmpdir(), 'sidekick-p6-native-' + nonce + '-')));
const root = join(base, 'app');
const modelLog = join(base, 'model.jsonl');
const node = join(resources, 's0-runtime/node');
const args = [fixture, 'model', modelLog, 'normal', 'native', nonce];
const modelStderr = createWriteStream(join(evidence, 'model-stderr.log'), { flags: 'wx', mode: 0o600 });
await new Promise((accept, reject) => { modelStderr.once('open', accept); modelStderr.once('error', reject); });
let ending = false;
const model = spawn(node, args, { env: { PATH: '/usr/bin:/bin', TMPDIR: base }, stdio: ['ignore', 'pipe', 'pipe'] });
async function stopModel() {
  ending = true;
  if (!model.pid || model.exitCode !== null || model.signalCode !== null) return;
  const exited = new Promise(accept => model.once('exit', accept));
  model.kill('SIGTERM');
  const timer = setTimeout(() => { if (model.exitCode === null && model.signalCode === null) model.kill('SIGKILL'); }, 1000);
  await exited;
  clearTimeout(timer);
}
process.on('SIGTERM', () => { void stopModel().then(() => process.stdin.destroy()); });
process.on('SIGINT', () => { void stopModel().then(() => process.stdin.destroy()); });
model.once('exit', () => { if (ending) process.stdin.destroy(); else process.stderr.write('Owned model exited; no further launch or trial is authorized.\n'); });
modelStderr.on('error', () => { process.stderr.write('Native model evidence output failed.\n'); process.exitCode = 1; void stopModel().then(() => process.stdin.destroy()); });
try {
model.stderr.pipe(modelStderr);
model.on('error', error => { process.stderr.write('Owned model failed: ' + error.code + '\n'); });
let url;
try { url = await new Promise((accept, reject) => {
  const timer = setTimeout(() => reject(new Error('Owned model was not ready.')), 5000);
  const lines = createInterface({ input: model.stdout });
  lines.once('line', line => { clearTimeout(timer); lines.close(); accept(line.trim()); });
  model.once('exit', () => { clearTimeout(timer); reject(new Error('Owned model exited before ready.')); });
  model.once('error', error => { clearTimeout(timer); reject(error); });
}); } catch (error) { ending = true; model.kill('SIGTERM'); throw error; }
const match = /^http:\/\/127\.0\.0\.1:([0-9]+)\/v1$/.exec(url);
if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535) { ending = true; model.kill('SIGTERM'); throw new Error('Invalid owned loopback endpoint.'); }
const port = Number(match[1]);
const command = execFileSync('/bin/ps', ['-p', String(model.pid), '-o', 'uid=,lstart=,command='], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).trim();
function verifyOwner() {
  if (model.exitCode !== null || model.signalCode !== null) throw new Error('Owned model exited.');
  if (execFileSync('/bin/ps', ['-p', String(model.pid), '-o', 'uid=,lstart=,command='], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).trim() !== command || !command.includes(fixture) || !command.includes(nonce)) throw new Error('Owned model identity changed.');
  const listener = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(model.pid), '-iTCP@127.0.0.1:' + port, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  if (!listener.split('\n').includes('p' + model.pid)) throw new Error('Owned model listener is missing.');
}
try { verifyOwner(); } catch (error) { ending = true; model.kill('SIGTERM'); throw error; }
const receipt = { layer: 'native package; synthetic model; actual Pi and stdio', run: 'p6-native-' + nonce, nonce, base, root, model: { port, pid: model.pid, command, nonce, script: fixture }, bundle, executable, modelLog, fixtureSha256: digest(await readFile(fixture)), executableSha256: digest(await readFile(executable)), runnerPid: process.pid, launched: [] };
const record = async () => writeFile(join(evidence, 'owned-launch.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
const configuration = { name: 'P6 合成本机工具', type: 'stdio', enabled: true, command: node, args: [fixture, 'service', join(root, 'service.jsonl'), 'normal', join(root, 'synthetic-marker')], cwd: join(root, 'workspace'), env: { P6_LABEL: 'synthetic-native' }, connectTimeoutMs: 3000, toolTimeoutMs: 1000 };
await writeFile(join(evidence, 'service-input.json'), JSON.stringify(configuration, null, 2), { flag: 'wx', mode: 0o600 });
async function launch(width, height, reopen) {
  verifyOwner();
  if (![640, 1440].includes(width) || ![900, 1000].includes(height)) throw new Error('Unexpected native acceptance dimensions.');
  const launchArgs = ['--s33-mcp-ui', root, nonce, String(width), String(height), 'controlled-native-mcp:' + port + ':' + model.pid, ...(reopen ? ['--reopen'] : [])];
  const before = new Set(await readdir(root).catch(() => []));
  execFileSync('/usr/bin/open', ['-n', bundle, '--args', ...launchArgs], { env: { PATH: '/usr/bin:/bin', TMPDIR: base }, stdio: 'pipe' });
  let info;
  for (let attempt = 0; attempt < 80; attempt++) {
    const file = (await readdir(root).catch(() => [])).find(name => name.startsWith('native-info-') && !before.has(name));
    if (file) { info = JSON.parse(await readFile(join(root, file), 'utf8')); break; }
    await new Promise(accept => setTimeout(accept, 100));
  }
  if (!info || info.identifier !== identifier || info.workspace !== join(root, 'workspace') || !info.modelOwner || info.modelOwner.pid !== model.pid || info.modelOwner.nonce !== nonce) throw new Error('Native launch receipt was not confirmed.');
  if (info.geometryConfirmed !== true || !Number.isFinite(info.scale) || info.scale <= 0 || info.physicalInnerSize?.width !== Math.round(width * info.scale) || info.physicalInnerSize?.height !== Math.round(height * info.scale)) throw new Error('Native launch dimensions not confirmed.');
  const actual = execFileSync('/bin/ps', ['-p', String(info.pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  if (!actual.startsWith(executable) || !actual.includes(root) || !actual.includes(nonce)) throw new Error('Native App PID is not owned by this run.');
  const rect = info.outerRect, monitor = info.primaryMonitor;
  if (rect.x < monitor.x || rect.y < monitor.y || rect.x + rect.width > monitor.x + monitor.width || rect.y + rect.height > monitor.y + monitor.height) throw new Error('Native window is outside the selected display.');
  receipt.launched.push({ at: new Date().toISOString(), pid: info.pid, width, height, reopen, executableSha256: digest(await readFile(executable)), info });
  await record();
  process.stdout.write(JSON.stringify({ ready: true, pid: info.pid, root, nonce, modelPid: model.pid, requested: { width, height }, actual: info.physicalInnerSize, scale: info.scale, outerRect: info.outerRect }) + '\n');
}
await record();
try { await launch(1440, 1000, false); }
catch (error) { ending = true; model.kill('SIGTERM'); throw error; }
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const input = JSON.parse(line);
    if (input.op === 'reopen') await launch(input.width, input.height, true);
    else if (input.op === 'owner') { verifyOwner(); process.stdout.write(JSON.stringify({ owned: true, pid: model.pid }) + '\n'); }
    else if (input.op === 'stop-model') { await stopModel(); break; }
    else throw new Error('Unknown native runner operation.');
  } catch (error) { process.stderr.write('Native runner refused: ' + error.message + '\n'); }
}

} catch (error) { await stopModel(); modelStderr.destroy(); throw error; }
