import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const program = resolve('scripts/probes/run-mcp-live.py');
const harness = String.raw`
import importlib.util, io, json, os, pathlib, sys, tempfile, types
sys.dont_write_bytecode = True
program, scenario = sys.argv[1:]
sys.argv = [program, '--real' if scenario == 'admission' else '--synthetic']
root = pathlib.Path(tempfile.mkdtemp(prefix='sidekick-launcher-test-'))
events = []
gate = types.ModuleType('model_budget')
gate.REPOSITORY, gate.NIGHT, gate.LIMIT, gate.CUTOFF, gate.FAKE_KEY = root, root / 'forbidden-night', 10, 9999999999, 'synthetic-private-canary'
def fail(code='BUDGET_UNAVAILABLE'):
    raise RuntimeError(code)
gate.fail = fail
gate.BudgetError = RuntimeError
gate.initialize = lambda path: events.append('initialize')
gate.private_directory = lambda path: None
gate.private_json = lambda path, maximum=8192: json.loads(path.read_text())
gate.sync_directory = lambda path: None
def secret_scan(value, secret):
    if secret and secret in json.dumps(value): fail('PRIVATE_CANARY_REJECTED')
gate.secret_scan = secret_scan
gate.private_model = lambda node: fail('PRIVATE_MODEL_MUST_NOT_RUN')
class Budget:
    def __init__(self, *args):
        events.append('budget')
        self.reads = 0
    def deadline(self): pass
    def inspect(self):
        self.reads += 1
        n = 0 if self.reads == 1 else 6
        if scenario == 'late-budget' and self.reads > 2: fail('FINAL_BUDGET_UNKNOWN')
        return {'reserved': n + (1 if n and scenario == 'failed-slot' else 0), 'forwarded': n, 'completed': n, 'requests': [gate.FAKE_KEY] if n and scenario == 'summary-secret' else []}
gate.Budget = Budget
class Relay:
    server_address = ('127.0.0.1', 12345)
    def __init__(self, *args): self.shutdown_unknown = scenario == 'relay-unknown'
    def serve_forever(self, **kwargs): pass
    def shutdown(self):
        events.append('shutdown')
        if scenario == 'shutdown': fail('SHUTDOWN_FAILED')
    def server_close(self): events.append('server_close')
gate.Relay = Relay
sys.modules['model_budget'] = gate
spec = importlib.util.spec_from_file_location('launcher_under_test', program)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
hash_reads = 0
def hashes():
    global hash_reads
    hash_reads += 1
    return {'synthetic': 'changed' if scenario == 'late-source' and hash_reads > 3 else 'fixed'}
launcher.hashes = hashes
core_reads = native_reads = 0
def core_hash():
    global core_reads
    core_reads += 1
    return 'changed-core' if scenario == 'late-core' and core_reads > 2 else launcher.DESIGN_SHA256
launcher.core_hash = core_hash
def native_binding(executable):
    global native_reads
    native_reads += 1
    return {'path': 'src-tauri/target/debug/deps/sidekick_lib-synthetic', 'sha256': 'changed-native' if scenario == 'late-native' and native_reads > 2 else 'synthetic-native-hash'}
launcher.native_binding = native_binding
def prepare(evidence):
    if scenario == 'prepare': fail('PREPARE_FAILED')
    return root / 'synthetic-test-executable'
launcher.prepare = prepare
launcher.admission = lambda: fail('LIVE_ADMISSION_REQUIRED')
launcher.register = lambda *args: {}
def remaining(owned):
    events.append('remaining')
    return {}
launcher.remaining = remaining
def cleanup(*args):
    events.append('cleanup')
    if scenario == 'cleanup': fail('CLEANUP_FAILED')
launcher.cleanup = cleanup
class Process:
    def __init__(self, args, **kwargs):
        self.args, self.pid = args, 987654
        self.model = args[0].endswith('/node')
        if not self.model:
            assert args == [str(root / 'synthetic-test-executable'), '--exact', launcher.CASE, '--test-threads=1', '--nocapture']
            assert kwargs['start_new_session'] is True
            assert set(kwargs['env']) == {'PATH', 'SIDEKICK_P5_LIVE_INFO'}
            info_path = pathlib.Path(kwargs['env']['SIDEKICK_P5_LIVE_INFO'])
            info = json.loads(info_path.read_text())
            assert info_path.stat().st_mode & 0o777 == 0o600
            assert info_path.parent.stat().st_mode & 0o777 == 0o700
            assert info_path.stat().st_uid == os.getuid() and info_path.stat().st_nlink == 1
            assert info['base'] == str(info_path.parent) and info['parentPid'] == os.getpid()
            assert info['relayToken'] == 'sidekick-p5-relay-' + info['nonce']
            assert not (info_path.parent / 'app').exists() and not (info_path.parent / 'workspace').exists()
        self.returncode = None if self.model else (1 if scenario == 'native' else 0)
        payload = {'calls': [{}, {}, {}], 'serviceCounts': {'lookup': 3}, 'trialBusinessUnchanged': True}
        if self.model:
            self.stdout = io.BytesIO(b'http://127.0.0.1:1234/v1\n')
        else:
            read_fd, write_fd = os.pipe()
            os.write(write_fd, ('P5_LIVE_EVIDENCE ' + json.dumps(payload) + '\n').encode())
            if scenario == 'native-secret': os.write(write_fd, gate.FAKE_KEY.encode())
            os.close(write_fd)
            self.stdout = os.fdopen(read_fd, 'rb')
    def poll(self): return self.returncode
    def kill(self):
        events.append('model_kill' if self.model else 'child_kill')
        self.returncode = -9
    def wait(self, **kwargs):
        events.append('model_wait' if self.model else 'child_wait')
        if scenario == 'model-wait' and self.model: fail('MODEL_WAIT_FAILED')
        return self.returncode
launcher.subprocess.Popen = Process
class Thread:
    def __init__(self, target, **kwargs):
        self.target, self.reader, self.joined = target, target.__name__ == 'collect', False
    def start(self):
        if self.reader: self.target()
    def join(self, **kwargs): self.joined = True
    def is_alive(self): return (not self.reader and not self.joined) or (self.reader and scenario == 'collector')
launcher.threading.Thread = Thread
if hasattr(launcher, 'model_ready'):
    launcher.model_ready = lambda *args, **kwargs: 'http://127.0.0.1:1234/v1'
error = None
try:
    launcher.main()
except BaseException as caught:
    error = str(caught)
summaries = list(root.glob('build/p5-formal-20261101/*/summary.json'))
summary = json.loads(summaries[0].read_text()) if len(summaries) == 1 else None
print(json.dumps({'events': events, 'error': error, 'summary': summary, 'evidence': str(root), 'nativeLogExists': any(root.glob('build/p5-formal-20261101/*/native-test.log'))}))
`;

function run(scenario) {
  const output = execFileSync('python3', ['-c', harness, program, scenario], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 });
  return JSON.parse(output.trim().split('\n').at(-1));
}

for (const scenario of ['cleanup', 'shutdown', 'model-wait']) test(`${scenario} failure still attempts every owned resource and retains failed evidence`, () => {
  const result = run(scenario);
  for (const expected of ['cleanup', 'shutdown', 'server_close', 'model_kill', 'model_wait']) assert.ok(result.events.includes(expected), `${expected} was skipped: ${JSON.stringify(result)}`);
  assert.equal(result.summary?.conclusion, 'fail', JSON.stringify(result));
  assert.ok(result.error, 'cleanup failure must fail the launcher');
});

for (const scenario of ['native', 'failed-slot', 'collector', 'prepare', 'admission', 'late-budget', 'late-source', 'late-core', 'late-native', 'native-secret', 'summary-secret', 'relay-unknown']) test(`${scenario} failure remains a failure with retained evidence`, () => {
  const result = run(scenario);
  assert.equal(result.summary?.conclusion, 'fail', JSON.stringify(result));
  assert.ok(result.error, 'failed verification must throw');
  if (scenario === 'admission') assert.deepEqual(result.events, ['cleanup'], 'admission refusal must precede budget initialization and private-model access');
  if (scenario.endsWith('-secret')) assert.ok(!JSON.stringify(result.summary).includes('synthetic-private-canary'), 'a private canary must not enter summary evidence');
  if (scenario === 'native-secret') assert.equal(result.nativeLogExists, false, 'unscanned native output must never be written');
  if (scenario === 'relay-unknown') assert.equal(result.summary.budgetState, 'unknown; no reset permitted');
});

test('a successful controlled launcher reports pass only after all cleanup succeeds', () => {
  const result = run('success');
  assert.equal(result.error, null, JSON.stringify(result));
  assert.equal(result.summary?.conclusion, 'pass');
  assert.equal(result.summary?.realModelRequests, 0);
  assert.deepEqual(result.summary.nativeExecutable, result.summary.nativeExecutableAfter);
  assert.equal(result.summary.designSha256, result.summary.designSha256After);
  assert.ok(result.events.indexOf('remaining') < result.events.indexOf('cleanup'), 'natural descendant exit must be checked before forced cleanup');
});

const functionHarness = String.raw`
import hashlib, importlib.util, json, os, pathlib, stat, subprocess, sys, tempfile, time, types
sys.dont_write_bytecode = True
program, scenario = sys.argv[1:]
sys.argv = [program]
gate = types.ModuleType('model_budget')
gate.REPOSITORY = pathlib.Path(program).resolve().parents[2]
def fail(code='BUDGET_UNAVAILABLE'): raise RuntimeError(code)
gate.fail = fail
gate.BudgetError = RuntimeError
sys.modules['model_budget'] = gate
spec = importlib.util.spec_from_file_location('launcher_functions', program)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
if scenario.startswith('ready-'):
    code = {'ready-timeout': 'import time; time.sleep(5)', 'ready-overflow': 'import sys,time; sys.stdout.write("x"*9000); sys.stdout.flush(); time.sleep(5)', 'ready-success': "import time; print('http://127.0.0.1:1234/v1', flush=True); time.sleep(5)"}[scenario]
    child = subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        start = time.monotonic()
        result = None
        error = None
        try: result = launcher.model_ready(child, timeout=0.1)
        except RuntimeError as caught: error = str(caught)
        print(json.dumps({'result': result, 'error': error, 'elapsed': time.monotonic() - start}))
    finally:
        child.kill()
        child.wait(timeout=5)
        child.stdout.close()
elif scenario == 'cleanup-inventory':
    events = []
    child = types.SimpleNamespace(pid=987654, args=['controlled'])
    child.poll = lambda: None
    child.kill = lambda: events.append('kill')
    child.wait = lambda **kwargs: events.append('wait')
    launcher.register = lambda *args: fail('INVENTORY_FAILED')
    launcher.remaining = lambda owned: {}
    error = None
    try: launcher.cleanup(child, {})
    except RuntimeError as caught: error = str(caught)
    print(json.dumps({'events': events, 'error': error}))
elif scenario == 'process-identity':
    child = types.SimpleNamespace(pid=987654, args=['controlled', '--exact', launcher.CASE])
    child.poll = lambda: None
    def still_running(**kwargs): raise subprocess.TimeoutExpired(child.args, kwargs['timeout'])
    child.wait = still_running
    legitimate = {'parent': os.getpid(), 'group': child.pid, 'command': ' '.join(child.args)}
    failures = []
    for change in [{'parent': 1}, {'group': 1}, {'command': 'unrelated'}]:
        launcher.inventory = lambda: {child.pid: {**legitimate, **change}}
        try: launcher.register(child, {})
        except RuntimeError as caught: failures.append(str(caught))
    launcher.inventory = lambda: {child.pid: legitimate, 987655: {'parent': child.pid, 'group': child.pid, 'command': 'controlled-descendant'}, 987656: {'parent': 1, 'group': 987656, 'command': 'unrelated'}}
    owned = {}
    launcher.register(child, owned)
    print(json.dumps({'failures': failures, 'owned': list(owned)}))
elif scenario.startswith('process-exit-'):
    child = subprocess.Popen(['/bin/sh', '-c', 'read value; exit 0'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        processes = launcher.inventory()
        assert child.poll() is None and child.pid in processes
        processes[child.pid]['command'] = '(unavailable during controlled exit)'
        processes[child.pid]['state'] = '?s'
        if scenario == 'process-exit-confirmed':
            child.stdin.write(b'exit\n')
            child.stdin.flush()
            child.wait(timeout=2)
        launcher.inventory = lambda: processes
        owned = {}
        error = None
        identity = None
        try: launcher.register(child, owned)
        except BaseException as caught:
            error = str(caught)
            identity = getattr(caught, 'identity', None)
        exit_code = child.poll()
        cleanup_error = None
        if scenario == 'process-exit-live':
            try: launcher.cleanup(child, owned)
            except RuntimeError as caught: cleanup_error = str(caught)
        print(json.dumps({'error': error, 'identity': identity, 'exitCode': exit_code, 'owned': list(owned), 'cleanupError': cleanup_error, 'exitAfterCleanup': child.poll()}))
    finally:
        if child.poll() is None: child.kill()
        child.wait(timeout=5)
        child.stdin.close()
elif scenario == 'owned-processes':
    sleeper = ['/bin/sleep', '10']
    child = subprocess.Popen(['/bin/sh', '-c', '/bin/sleep 10 & echo $!; wait'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
    unrelated = subprocess.Popen(sleeper, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    owned = {}
    try:
        descendant = int(launcher.model_ready(child, timeout=2))
        launcher.register(child, owned)
        assert descendant in owned
        launcher.cleanup(child, owned)
        assert child.poll() is not None and not launcher.remaining(owned)
        assert unrelated.poll() is None
        print(json.dumps({'ownedDescendants': len(owned), 'unrelatedAlive': True}))
    finally:
        if child.poll() is None: child.kill()
        child.wait(timeout=5)
        child.stdout.close()
        for pid, value in launcher.remaining(owned).items():
            if value['group'] not in {os.getpgrp(), unrelated.pid}:
                try: os.killpg(value['group'], 9)
                except ProcessLookupError: pass
        unrelated.kill()
        unrelated.wait(timeout=5)
elif scenario.startswith('source-'):
    gate.REPOSITORY = pathlib.Path(tempfile.mkdtemp(prefix='sidekick-launcher-source-input-')).resolve()
    subprocess.run(['git', 'init', '--quiet', str(gate.REPOSITORY)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for relative in launcher.CRITICAL:
        candidate = gate.REPOSITORY / relative
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_bytes(b'synthetic required input')
    error = None
    before = launcher.hashes()
    if scenario == 'source-excluded':
        names = ['src/node_modules/ignored.js', 'src-tauri/target/ignored.rs', 'src/.env.synthetic', 'src/.env.example']
        for relative in names:
            candidate = gate.REPOSITORY / relative
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_bytes(b'synthetic excluded input')
        subprocess.run(['git', '-C', str(gate.REPOSITORY), 'add', '--force', '--', *names], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        after = launcher.hashes()
        print(json.dumps({'excludedAbsent': all(name not in after for name in names[:3]), 'exampleIncluded': names[3] in after, 'seededRuntimeIncluded': all(name in after for name in launcher.CRITICAL if name.startswith('build/s0-runtime/'))}))
    elif scenario == 'source-symlink':
        with tempfile.TemporaryDirectory(prefix='sidekick-launcher-outside-input-') as external:
            outside = pathlib.Path(external) / 'outside.txt'
            outside.write_bytes(b'synthetic outside root')
            link = gate.REPOSITORY / 'src/outside-link.txt'
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(outside)
            try: launcher.hashes()
            except RuntimeError as caught: error = str(caught)
        print(json.dumps({'error': error}))
    elif scenario == 'source-cached':
        candidate = gate.REPOSITORY / 'src/tracked.ts'
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_bytes(b'approved tracked input')
        subprocess.run(['git', '-C', str(gate.REPOSITORY), 'add', '--', 'src/tracked.ts'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        before = launcher.hashes()
        candidate.write_bytes(b'changed tracked working input')
        after = launcher.hashes()
        print(json.dumps({'changed': before != after, 'workingBytesBound': after['src/tracked.ts'] == hashlib.sha256(candidate.read_bytes()).hexdigest()}))
elif scenario.startswith('admission-'):
    plan_relative = 'docs/product/05-第一阶段实施计划.md'
    plan_bytes = (gate.REPOSITORY / plan_relative).read_bytes()
    gate.REPOSITORY = pathlib.Path(tempfile.mkdtemp(prefix='sidekick-launcher-admission-test-')).resolve()
    launcher.ADMISSION = gate.REPOSITORY / 'build/p5-formal-20261101/budget-admission.json'
    launcher.ADMISSION.parent.mkdir(parents=True, mode=0o700)
    plan = gate.REPOSITORY / plan_relative
    plan.parent.mkdir(parents=True)
    plan.write_bytes(plan_bytes)
    design = '8961b453f91bc7927c2855a4bd9d9e156a2f879dfb3655aeeda72c8baa056ea9'
    binding_targets = {'admission-package-input': 'package.json', 'admission-runtime-input': 'build/s0-runtime/organizer.mjs', 'admission-node-input': 'build/s0-runtime/node', 'admission-host-input': 'src-tauri/src/host/mcp_host.rs', 'admission-config-input': 'src-tauri/src/store/model_config.rs', 'admission-recovery-input': 'src-tauri/src/host/mcp_recovery_tests.rs', 'admission-cargo-input': 'src-tauri/Cargo.toml', 'admission-build-input': 'src-tauri/build.rs', 'admission-new-input': 'src-tauri/src/host/new_guard.rs'}
    if scenario in binding_targets:
        subprocess.run(['git', 'init', '--quiet', str(gate.REPOSITORY)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for relative in set(launcher.CRITICAL) | set(binding_targets.values()):
            if relative == binding_targets['admission-new-input']: continue
            candidate = gate.REPOSITORY / relative
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_bytes(b'synthetic approved input')
        sources = launcher.hashes()
    else:
        sources = {'synthetic': 'fixed'}
        launcher.hashes = lambda: sources
    native = gate.REPOSITORY / 'src-tauri/target/debug/deps/sidekick_lib-synthetic'
    native.parent.mkdir(parents=True, exist_ok=True)
    native.write_bytes(b'synthetic approved native executable')
    native.chmod(0o700)
    native_executable = {'path': str(native.relative_to(gate.REPOSITORY)), 'sha256': hashlib.sha256(native.read_bytes()).hexdigest()}
    gate.identity = lambda metadata: {'dev': metadata.st_dev, 'ino': metadata.st_ino}
    def private_open(path):
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        metadata = os.fstat(descriptor)
        if stat.S_IMODE(metadata.st_mode) != 0o600:
            os.close(descriptor)
            fail('PRIVATE_MODE_INVALID')
        return descriptor, metadata
    gate.private_open = private_open
    def private_json(path, maximum):
        descriptor, metadata = private_open(path)
        try: return json.loads(os.read(descriptor, maximum + 1))
        finally: os.close(descriptor)
    gate.private_json = private_json
    reports = []
    for name in ['delivery-a', 'delivery-b', 'synthetic']:
        report = {'syntheticFixture': True, 'sources': sources, 'designSha256': design, 'nativeExecutable': native_executable, 'verdict': 'APPROVE', 'conclusion': 'pass', 'realModelRequests': 0}
        if name == 'delivery-a' and scenario == 'admission-source': report['sources'] = {'synthetic': 'stale'}
        if name == 'delivery-a' and scenario == 'admission-verdict': report['verdict'] = 'BLOCK'
        if name == 'synthetic' and scenario == 'admission-real': report['realModelRequests'] = 1
        if name == 'synthetic' and scenario == 'admission-native-report': report['nativeExecutable'] = {**native_executable, 'sha256': '0' * 64}
        path = launcher.ADMISSION.parent / (name + '.json')
        data = json.dumps(report).encode()
        path.write_bytes(data)
        path.chmod(0o600)
        reports.append({'path': str(path.relative_to(gate.REPOSITORY)), 'sha256': hashlib.sha256(data).hexdigest()})
    value = {'version': 1, 'conclusion': 'pass', 'sources': sources, 'designSha256': design, 'nativeExecutable': native_executable, 'deliveryApproved': True, 'syntheticVerified': True, 'deliveryEvidence': reports[:2], 'syntheticEvidence': reports[2]}
    target = gate.REPOSITORY / reports[0]['path']
    if scenario == 'admission-digest': target.write_bytes(b'{}')
    if scenario == 'admission-core':
        plan.write_bytes(plan_bytes.replace('P5正式文本MCP闭环'.encode(), 'P5 changed core'.encode()))
    if scenario == 'admission-core-status': plan.write_bytes(plan_bytes + b'\nSynthetic later status evidence.\n')
    if scenario == 'admission-shared': value['deliveryEvidence'] = [reports[0], reports[0]]
    if scenario == 'admission-mode': target.chmod(0o644)
    if scenario == 'admission-symlink':
        moved = target.with_suffix('.moved.json')
        target.rename(moved)
        target.symlink_to(moved)
    if scenario == 'admission-outside': value['deliveryEvidence'][0] = {'path': '../outside.json', 'sha256': reports[0]['sha256']}
    if scenario == 'admission-missing': target.unlink()
    if scenario == 'admission-boolean-only':
        value.pop('deliveryEvidence')
        value.pop('syntheticEvidence')
    if scenario in binding_targets:
        (gate.REPOSITORY / binding_targets[scenario]).write_bytes(b'synthetic changed executable input')
    if scenario == 'admission-native-drift': native.write_bytes(b'synthetic changed native executable')
    if scenario == 'admission-native-mode': native.chmod(0o600)
    if scenario == 'admission-native-missing': native.unlink()
    if scenario == 'admission-native-absent': value.pop('nativeExecutable')
    if scenario == 'admission-native-symlink':
        moved = native.with_suffix('.moved')
        native.rename(moved)
        native.symlink_to(moved)
    launcher.ADMISSION.write_text(json.dumps(value))
    launcher.ADMISSION.chmod(0o600)
    error = None
    try:
        if scenario == 'admission-native-prepared': launcher.admission(native.with_name('sidekick_lib-different'))
        elif scenario == 'admission-native-prepared-positive': launcher.admission(native)
        else: launcher.admission()
    except BaseException as caught: error = type(caught).__name__
    print(json.dumps({'error': error, 'syntheticFixture': True}))
`;

function runFunction(scenario) {
  return JSON.parse(execFileSync('python3', ['-c', functionHarness, program, scenario], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 }));
}

test('synthetic model readiness has a deadline even when the owned process keeps stdout open', () => {
  const result = runFunction('ready-timeout');
  assert.equal(result.error, 'LIVE_CANARY_DEADLINE');
  assert.ok(result.elapsed < 1, 'readiness must not block on an incomplete line');
});

test('synthetic model readiness rejects an unbounded line', () => {
  assert.equal(runFunction('ready-overflow').error, 'LIVE_CANARY_INVALID');
});

test('synthetic model readiness accepts a complete local relay URL', () => {
  const result = runFunction('ready-success');
  assert.equal(result.error, null);
  assert.equal(result.result, 'http://127.0.0.1:1234/v1');
});

test('owned child cleanup still kills and waits when process inventory fails', () => {
  const result = runFunction('cleanup-inventory');
  assert.deepEqual(result.events, ['kill', 'wait']);
  assert.equal(result.error, 'LIVE_CLEANUP_UNKNOWN');
});

test('process registration rejects mismatched parent, argv and group and excludes unrelated processes', () => {
  const result = runFunction('process-identity');
  assert.deepEqual(result.failures, Array(3).fill('LIVE_CHILD_IDENTITY_INVALID'));
  assert.deepEqual(result.owned, [987655]);
});

test('an args-unavailable snapshot of a confirmed exited child proceeds to exit and evidence checks', () => {
  const result = runFunction('process-exit-confirmed');
  assert.equal(result.error, null);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.owned, []);
});

test('an args-unavailable snapshot of a still-live owned child remains an identity failure', () => {
  const result = runFunction('process-exit-live');
  assert.equal(result.error, 'LIVE_CHILD_IDENTITY_INVALID');
  assert.equal(result.exitCode, null);
  assert.equal(result.identity?.commandMatches, false);
  assert.equal(result.cleanupError, 'LIVE_CLEANUP_UNKNOWN');
  assert.notEqual(result.exitAfterCleanup, null, 'the owned live child must still be killed and reaped');
});

test('cleanup reaps only owned process groups and preserves an unrelated canary', () => {
  const result = runFunction('owned-processes');
  assert.equal(result.ownedDescendants, 1);
  assert.equal(result.unrelatedAlive, true);
});

test('admission accepts two approved source-bound reports and a zero-real-request synthetic report in an isolated fixture', () => {
  assert.equal(runFunction('admission-positive').error, null);
});

for (const scenario of ['digest', 'source', 'verdict', 'real', 'core', 'shared', 'mode', 'symlink', 'outside', 'missing', 'boolean-only', 'package-input', 'runtime-input', 'node-input', 'host-input', 'config-input', 'recovery-input', 'cargo-input', 'build-input', 'new-input', 'native-report', 'native-drift', 'native-mode', 'native-missing', 'native-absent', 'native-symlink', 'native-prepared']) test(`admission rejects ${scenario} evidence before any real-mode resource access`, () => {
  const result = runFunction(`admission-${scenario}`);
  assert.ok(result.error);
  assert.equal(result.syntheticFixture, true);
});

test('later non-normative plan evidence does not invalidate the approved core', () => {
  assert.equal(runFunction('admission-core-status').error, null);
});

test('the prepared native path must match the approved executable binding', () => {
  assert.equal(runFunction('admission-native-prepared-positive').error, null);
});

test('dynamic source binding excludes private env and generated dependency directories while retaining prepared Runtime inputs', () => {
  const result = runFunction('source-excluded');
  assert.equal(result.excludedAbsent, true);
  assert.equal(result.exampleIncluded, true);
  assert.equal(result.seededRuntimeIncluded, true);
});

test('dynamic source binding refuses a source symlink outside the repository', () => {
  assert.equal(runFunction('source-symlink').error, 'LIVE_INPUT_INVALID');
});

test('dynamic source binding reads current bytes for tracked working files', () => {
  const result = runFunction('source-cached');
  assert.equal(result.changed, true);
  assert.equal(result.workingBytesBound, true);
});

test('launcher tests run from a source-only snapshot without ignored build evidence', { skip: process.env.SIDEKICK_LAUNCHER_SOURCE_SNAPSHOT === '1' }, async () => {
  const snapshot = await mkdtemp(join(tmpdir(), 'sidekick-launcher-source-only-'));
  let succeeded = false;
  try {
    for (const path of ['scripts/probes/run-mcp-live.py', 'scripts/probes/model_budget.py', 'tests/integration/mcp-launcher.test.mjs', 'docs/product/05-第一阶段实施计划.md']) {
      const target = join(snapshot, path);
      await mkdir(dirname(target), { recursive: true });
      await cp(resolve(path), target);
    }
    assert.equal(existsSync(join(snapshot, 'build')), false);
    const output = execFileSync(process.execPath, ['--test', '--test-timeout=30000', 'tests/integration/mcp-launcher.test.mjs'], { cwd: snapshot, encoding: 'utf8', env: { PATH: process.env.PATH, SIDEKICK_LAUNCHER_SOURCE_SNAPSHOT: '1' }, timeout: 30000 });
    assert.match(output, /fail 0/);
    succeeded = true;
  } finally {
    if (succeeded) await rm(snapshot, { recursive: true });
  }
});
