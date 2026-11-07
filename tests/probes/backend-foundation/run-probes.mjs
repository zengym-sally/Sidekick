#!/usr/bin/env node
// Runner for the MAYNE-20 backend-foundation probes: it builds the isolated
// Rust storage-adapter harness offline (target stays under build/), seeds
// synthetic roots, and exercises the connection/root-lock, no-CREATE open,
// file-safety, WAL/short-transaction and crash/scheduling boundaries, plus the
// host deployment/credential capability facts. Raw evidence lands in
// build/backend-foundation/; this file is the reviewable entry point.
//
// Usage: node tests/probes/backend-foundation/run-probes.mjs
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  lstatSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const probeDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(probeDir, '..', '..', '..');
const buildDir = path.join(repoRoot, 'build', 'backend-foundation');
const targetDir = path.join(buildDir, 'target');
const rootsDir = path.join(buildDir, 'roots');
const harnessDir = path.join(probeDir, 'storage-adapter-probe');
const binary = path.join(
  targetDir,
  'release',
  process.platform === 'win32' ? 'sidekick-storage-adapter-probe.exe' : 'sidekick-storage-adapter-probe',
);

const results = {
  startedAt: new Date().toISOString(),
  host: {},
  build: null,
  scenarios: [],
  summary: { total: 0, passed: 0, failed: 0 },
};
let logStream = null;

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  if (logStream) writeSync(logStream, `${text}\n`);
}

function commandText(args) {
  return `sidekick-storage-adapter-probe ${args.join(' ')}`;
}

function run(args, { timeout = 60000, env = {} } = {}) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  const stdout = result.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  let json = null;
  let parseError = null;
  if (lines.length > 0) {
    try {
      json = JSON.parse(lines[lines.length - 1]);
    } catch (error) {
      parseError = error.message;
    }
  }
  return {
    command: commandText(args),
    status: result.status,
    signal: result.signal,
    json,
    parseError,
    stdout,
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

function record(name, expectation, runs, check) {
  const detail = check(runs);
  const pass = detail.every((entry) => entry.pass);
  results.scenarios.push({
    name,
    expectation,
    pass,
    checks: detail,
    runs: runs.map((entry) => ({
      command: entry.command,
      status: entry.status,
      signal: entry.signal ?? null,
      json: entry.json,
      stdout: entry.stdout,
      stderr: entry.stderr,
    })),
  });
  results.summary.total += 1;
  results.summary[pass ? 'passed' : 'failed'] += 1;
  log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ` — ${detail.filter((e) => !e.pass).map((e) => e.detail).join('; ')}`}`);
  return pass;
}

function check(name, condition, detail) {
  return { check: name, pass: Boolean(condition), detail: detail ?? '' };
}

function seed(name) {
  const root = path.join(rootsDir, name);
  rmSync(root, { recursive: true, force: true });
  const seeded = run(['seed', '--root', root]);
  if (!seeded.json?.ok) throw new Error(`seed ${name} failed: ${JSON.stringify(seeded.json)}`);
  return root;
}

function freshDir(name) {
  const root = path.join(rootsDir, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

/// Executable fixture used to drive synthetic `kill -0` failures without
/// touching a real process or raising privileges.
function writeFixture(name, content) {
  const dir = path.join(buildDir, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content, { mode: 0o755 });
  chmodSync(file, 0o755);
  return file;
}

/// Snapshot of a synthetic root for the "a rejection must not change the file
/// tree" assertions: every entry as `kind relpath mode`, sorted. A rejected
/// open must leave the snapshot identical.
function snapshot(root) {
  const entries = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = lstatSync(path.join(dir, entry.name));
      const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : 'file';
      entries.push(`${kind} ${rel} ${stat.mode & 0o7777}`);
      if (kind === 'dir') walk(path.join(dir, entry.name), rel);
    }
  };
  walk(root, '');
  return entries.sort();
}

function treeUnchanged(root, before) {
  return check('tree unchanged', JSON.stringify(snapshot(root)) === JSON.stringify(before));
}

function buildHarness() {
  const manifest = path.join(harnessDir, 'Cargo.toml');
  const base = ['build', '--release', '--manifest-path', manifest];
  const env = { ...process.env, CARGO_TARGET_DIR: targetDir };
  const offline = spawnSync('cargo', [...base, '--offline'], { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (offline.status === 0) {
    results.build = { mode: 'offline', command: `cargo ${base.join(' ')} --offline`, status: 0 };
    log(`build ok (offline): ${results.build.command}`);
    return;
  }
  const online = spawnSync('cargo', base, { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  results.build = {
    mode: online.status === 0 ? 'online-fallback' : 'failed',
    command: `cargo ${base.join(' ')}`,
    status: online.status,
    offlineStatus: offline.status,
    offlineError: offline.stderr,
  };
  if (online.status !== 0) {
    log('build FAILED');
    console.error(online.stderr);
    process.exitCode = 1;
    throw new Error('harness build failed');
  }
  log(`build ok (online fallback): ${results.build.command}`);
}

function collectHostFacts() {
  const simple = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const harnessFacts = run(['host-facts']);
  const keychain = run(['keychain-facts']);
  results.host = {
    uname: simple('uname', ['-a']),
    macOS: simple('sw_vers'),
    node: simple('node', ['--version']),
    cargo: simple('cargo', ['--version']),
    rustc: simple('rustc', ['--version']),
    cc: simple('cc', ['--version'])?.split('\n')[0] ?? null,
    harness: harnessFacts.json,
    keychain: keychain.json,
    keychainCommand: keychain.command,
    keychainStatus: keychain.status,
  };
  log(`host: ${results.host.uname}`);
}

// Hold a worker child alive until the runner kills or closes it.
async function holdWorker(root, { writeTx = false } = {}) {
  const args = ['hold', '--root', root, '--worker-file', path.join(root, 'runs', 'worker.json')];
  if (writeTx) args.push('--write-tx');
  const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('hold worker never became ready')), 30000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('\n')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`hold worker exited before ready: ${signal ?? code}`));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return child;
}

function killAndWait(child, signal = 'SIGKILL') {
  const exited = new Promise((resolve) => child.on('exit', (code, exitSignal) => resolve({ code, signal: exitSignal })));
  child.kill(signal);
  return exited;
}

function waitFor(child) {
  return new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
}

async function main() {
  mkdirSync(buildDir, { recursive: true });
  rmSync(rootsDir, { recursive: true, force: true });
  mkdirSync(rootsDir, { recursive: true });
  logStream = openSync(path.join(buildDir, 'run.log'), 'w');

  buildHarness();
  if (process.exitCode) return;
  collectHostFacts();

  // ---- A. connection / root lock share one lifecycle ----------------------
  {
    const root = seed('a-valid');
    const opened = run(['open-check', '--root', root]);
    const f = opened.json?.facts ?? {};
    record(
      'A1 连接与根锁同生命周期：打开、持锁、释放后可重开',
      'open-check ok；WAL/busy_timeout/synchronous/foreign_keys 就位；存活期间二次打开 ROOT_IN_USE；drop 后可重开',
      [opened],
      () => [
        check('exit0', opened.status === 0, `status=${opened.status}`),
        check('journalMode=wal', f.journalMode === 'wal', `journalMode=${f.journalMode}`),
        check('busyTimeoutMs=5000', f.busyTimeoutMs === 5000, `busyTimeoutMs=${f.busyTimeoutMs}`),
        check('synchronous=2(FULL)', f.synchronous === 2, `synchronous=${f.synchronous}`),
        check('foreignKeys=1', f.foreignKeys === 1, `foreignKeys=${f.foreignKeys}`),
        check('userVersion=1', f.userVersion === 1, `userVersion=${f.userVersion}`),
        check('secondOpenRootInUse', opened.json?.secondOpenRootInUse === true),
        check('reopenAfterDrop', opened.json?.reopenAfterDrop === true),
        check('countBefore=2', opened.json?.countBefore === 2, `countBefore=${opened.json?.countBefore}`),
        check('countAfterShortWrite=3', opened.json?.countAfterShortWrite === 3, `countAfterShortWrite=${opened.json?.countAfterShortWrite}`),
      ],
    );
  }
  {
    const root = seed('a-missing-db');
    rmSync(path.join(root, 'data', 'sidekick.sqlite'), { force: true });
    const before = snapshot(root);
    const rejected = run(['open-reject', '--root', root, '--expect', 'MISSING_DATABASE']);
    record(
      'A2 无 CREATE 的已有库打开：缺库拒绝且不新建文件',
      'open-reject 期望 MISSING_DATABASE；库文件仍未出现；拒绝后文件树不变',
      [rejected],
      () => [
        check('exit0', rejected.status === 0, `status=${rejected.status}`),
        check('code=MISSING_DATABASE', rejected.json?.code === 'MISSING_DATABASE', `code=${rejected.json?.code}`),
        check('db still absent', !existsSync(path.join(root, 'data', 'sidekick.sqlite'))),
        treeUnchanged(root, before),
      ],
    );
  }
  {
    const root = freshDir('a-default-open');
    const target = path.join(root, 'data', 'created-by-default.sqlite');
    mkdirSync(path.dirname(target), { recursive: true });
    const control = run(['control-default-open', '--path', target]);
    record(
      'A3 对照：默认 Connection::open 会新建缺失库（证明适配不能使用默认标志）',
      'control-default-open created=true 且文件确实被创建',
      [control],
      () => [
        check('exit0', control.status === 0, `status=${control.status}`),
        check('created=true', control.json?.created === true),
        check('file exists', existsSync(target)),
      ],
    );
  }

  // ---- A4. explicit init is the only creating flow -------------------------
  {
    const root = freshDir('a-init');
    chmodSync(root, 0o700);
    const initialized = run(['init', '--root', root]);
    const reopened = run(['open-check', '--root', root]);
    record(
      'A4 显式初始化：init 创建归属标记、私有目录与数据库，产物可作已有根打开',
      'init ok（标记含 MAGIC、7 个 0700 目录、0600 数据库并写入身份）；随后 open-check ok 且 countBefore=0',
      [initialized, reopened],
      () => [
        check('init exit0', initialized.status === 0, `status=${initialized.status}`),
        check('init ok', initialized.json?.ok === true),
        check(
          'marker created with magic',
          existsSync(path.join(root, '.sidekick-workspace'))
            && readFileSync(path.join(root, '.sidekick-workspace'), 'utf8') === 'sidekick-workspace-v1\n',
        ),
        check(
          'private dirs created 0700',
          ['data', 'runs', 'config', 'skills', 'mcp', 'logs', 'backups'].every((name) => {
            const stat = lstatSync(path.join(root, name));
            return stat.isDirectory() && (stat.mode & 0o7777) === 0o700;
          }),
        ),
        check(
          'database created 0600',
          (() => {
            const stat = lstatSync(path.join(root, 'data', 'sidekick.sqlite'));
            return stat.isFile() && (stat.mode & 0o7777) === 0o600;
          })(),
        ),
        check('reopen exit0', reopened.status === 0, `status=${reopened.status}`),
        check('reopen ok', reopened.json?.ok === true),
        check('countBefore=0', reopened.json?.countBefore === 0, `countBefore=${reopened.json?.countBefore}`),
      ],
    );
  }
  {
    const root = freshDir('a-init-reject');
    writeFileSync(path.join(root, 'unrelated.txt'), 'not a sidekick root');
    const before = snapshot(root);
    const rejected = run(['init', '--root', root]);
    record(
      'A4b 显式初始化不吞并非有目录：非空无标记目录 init 期望 UNKNOWN_ROOT 且文件树不变',
      'init 期望 UNKNOWN_ROOT（ok=false、exit 1）；unrelated.txt 仍在，未创建标记/目录/数据库',
      [rejected],
      () => [
        check('exit1', rejected.status === 1, `status=${rejected.status}`),
        check('ok=false', rejected.json?.ok === false),
        check('code=UNKNOWN_ROOT', rejected.json?.code === 'UNKNOWN_ROOT', `code=${rejected.json?.code}`),
        treeUnchanged(root, before),
      ],
    );
  }

  // ---- A5. ordinary open never creates anything ----------------------------
  {
    const root = freshDir('a-open-empty');
    chmodSync(root, 0o700);
    const before = snapshot(root);
    const rejected = run(['open-reject', '--root', root, '--expect', 'UNKNOWN_ROOT']);
    record(
      'A5 普通打开零创建副作用：空目录 open-reject 期望 UNKNOWN_ROOT 且目录仍为空',
      'open-reject 期望 UNKNOWN_ROOT；未创建归属标记、目录或数据库（文件树不变）',
      [rejected],
      () => [
        check('exit0', rejected.status === 0, `status=${rejected.status}`),
        check('code=UNKNOWN_ROOT', rejected.json?.code === 'UNKNOWN_ROOT', `code=${rejected.json?.code}`),
        check('still empty', snapshot(root).length === 0),
        treeUnchanged(root, before),
      ],
    );
  }
  {
    const root = freshDir('a-open-missing-dirs');
    chmodSync(root, 0o700);
    const marker = path.join(root, '.sidekick-workspace');
    writeFileSync(marker, 'sidekick-workspace-v1\n');
    chmodSync(marker, 0o600);
    const before = snapshot(root);
    const rejected = run(['open-reject', '--root', root, '--expect', 'INVALID_ROOT']);
    record(
      'A5b 普通打开不补建结构：有标记缺私有目录 open-reject 期望 INVALID_ROOT 且文件树不变',
      'open-reject 期望 INVALID_ROOT；未创建 data/runs/config 等目录（文件树不变）',
      [rejected],
      () => [
        check('exit0', rejected.status === 0, `status=${rejected.status}`),
        check('code=INVALID_ROOT', rejected.json?.code === 'INVALID_ROOT', `code=${rejected.json?.code}`),
        treeUnchanged(root, before),
      ],
    );
  }

  // ---- B. NOFOLLOW / identity / permission / hard link --------------------
  const safetyCases = [
    ['db-symlink', 'PATH_CHANGED', (root) => {
      renameSync(path.join(root, 'data/sidekick.sqlite'), path.join(root, 'data/real.sqlite'));
      symlinkSync(path.join(root, 'config/app.json'), path.join(root, 'data/sidekick.sqlite'));
    }],
    ['db-hardlink', 'PATH_CHANGED', (root) => {
      linkSync(path.join(root, 'data/sidekick.sqlite'), path.join(root, 'data/alias.sqlite'));
    }],
    ['db-mode', 'PATH_CHANGED', (root) => {
      chmodSync(path.join(root, 'data/sidekick.sqlite'), 0o644);
    }],
    ['wal-symlink', 'PATH_CHANGED', (root) => {
      symlinkSync(path.join(root, 'config/app.json'), path.join(root, 'data/sidekick.sqlite-wal'));
    }],
    ['wal-hardlink', 'PATH_CHANGED', (root) => {
      writeFileSync(path.join(root, 'data/other.bin'), 'sidecar');
      chmodSync(path.join(root, 'data/other.bin'), 0o600);
      linkSync(path.join(root, 'data/other.bin'), path.join(root, 'data/sidekick.sqlite-wal'));
    }],
    ['shm-symlink', 'PATH_CHANGED', (root) => {
      symlinkSync(path.join(root, 'config/app.json'), path.join(root, 'data/sidekick.sqlite-shm'));
    }],
    ['shm-hardlink', 'PATH_CHANGED', (root) => {
      writeFileSync(path.join(root, 'data/shm-alias.bin'), 'shm alias');
      chmodSync(path.join(root, 'data/shm-alias.bin'), 0o600);
      linkSync(path.join(root, 'data/shm-alias.bin'), path.join(root, 'data/sidekick.sqlite-shm'));
    }],
    ['shm-mode', 'PATH_CHANGED', (root) => {
      writeFileSync(path.join(root, 'data/sidekick.sqlite-shm'), 'stale shm');
      chmodSync(path.join(root, 'data/sidekick.sqlite-shm'), 0o644);
    }],
    ['data-symlink', 'PATH_CHANGED', (root) => {
      renameSync(path.join(root, 'data'), path.join(root, 'data-aside'));
      symlinkSync(path.join(root, 'data-aside'), path.join(root, 'data'));
    }],
    ['data-mode', 'PATH_CHANGED', (root) => {
      chmodSync(path.join(root, 'data'), 0o755);
    }],
    ['runs-symlink', 'PATH_CHANGED', (root) => {
      renameSync(path.join(root, 'runs'), path.join(root, 'runs-aside'));
      symlinkSync(path.join(root, 'runs-aside'), path.join(root, 'runs'));
    }],
    ['runs-mode', 'PATH_CHANGED', (root) => {
      chmodSync(path.join(root, 'runs'), 0o755);
    }],
    ['config-symlink', 'PATH_CHANGED', (root) => {
      renameSync(path.join(root, 'config'), path.join(root, 'config-aside'));
      symlinkSync(path.join(root, 'config-aside'), path.join(root, 'config'));
    }],
    ['config-mode', 'PATH_CHANGED', (root) => {
      chmodSync(path.join(root, 'config'), 0o755);
    }],
    ['marker-symlink', 'INVALID_ROOT', (root) => {
      renameSync(path.join(root, '.sidekick-workspace'), path.join(root, 'data/marker-aside'));
      symlinkSync(path.join(root, 'config/app.json'), path.join(root, '.sidekick-workspace'));
    }],
    ['marker-hardlink', 'INVALID_ROOT', (root) => {
      linkSync(path.join(root, '.sidekick-workspace'), path.join(root, 'data/marker-alias'));
    }],
    ['marker-mode', 'INVALID_ROOT', (root) => {
      chmodSync(path.join(root, '.sidekick-workspace'), 0o644);
    }],
    ['root-mode', 'PATH_CHANGED', (root) => {
      chmodSync(root, 0o755);
    }],
  ];
  for (const [name, expect, mutate] of safetyCases) {
    const root = seed(`b-${name}`);
    mutate(root);
    const before = snapshot(root);
    const rejected = run(['open-reject', '--root', root, '--expect', expect]);
    record(`B 文件身份拒绝 ${name}`, `open-reject 期望 ${expect}；拒绝后文件树不变`, [rejected], () => [
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check(`code=${expect}`, rejected.json?.code === expect, `code=${rejected.json?.code}`),
      treeUnchanged(root, before),
    ]);
  }
  {
    const root = seed('b-corrupt');
    writeFileSync(path.join(root, 'data/sidekick.sqlite'), Buffer.alloc(4096, 7));
    const before = snapshot(root);
    const rejected = run(['open-reject', '--root', root, '--expect', 'CORRUPT_DATABASE']);
    record('B 文件身份拒绝 corrupt-db', 'open-reject 期望 CORRUPT_DATABASE；拒绝后文件树不变', [rejected], () => [
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check('code=CORRUPT_DATABASE', rejected.json?.code === 'CORRUPT_DATABASE', `code=${rejected.json?.code}`),
      treeUnchanged(root, before),
    ]);
  }
  {
    const root = seed('b-app-id');
    const mutated = run(['mutate', '--root', root, '--application-id', '123']);
    const before = snapshot(root);
    const rejected = run(['open-reject', '--root', root, '--expect', 'UNKNOWN_DATABASE']);
    record('B 文件身份拒绝 wrong-app-id', 'mutate 后 open-reject 期望 UNKNOWN_DATABASE；拒绝后文件树不变', [mutated, rejected], () => [
      check('mutate ok', mutated.json?.ok === true),
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check('code=UNKNOWN_DATABASE', rejected.json?.code === 'UNKNOWN_DATABASE', `code=${rejected.json?.code}`),
      treeUnchanged(root, before),
    ]);
  }
  {
    const root = seed('b-future');
    run(['mutate', '--root', root, '--user-version', '6']);
    const before = snapshot(root);
    const rejected = run(['open-reject', '--root', root, '--expect', 'SCHEMA_TOO_NEW']);
    record('B 文件身份拒绝 future-version', 'open-reject 期望 SCHEMA_TOO_NEW；拒绝后文件树不变', [rejected], () => [
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check('code=SCHEMA_TOO_NEW', rejected.json?.code === 'SCHEMA_TOO_NEW', `code=${rejected.json?.code}`),
      treeUnchanged(root, before),
    ]);
  }
  {
    const root = freshDir('b-unknown-root');
    writeFileSync(path.join(root, 'unrelated.txt'), 'not a sidekick root');
    const before = snapshot(root);
    const rejected = run(['open-reject', '--root', root, '--expect', 'UNKNOWN_ROOT']);
    record('B 文件身份拒绝 unknown-root', '非空且无归属标记的目录 open-reject 期望 UNKNOWN_ROOT；未创建归属标记，文件树不变', [rejected], () => [
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check('code=UNKNOWN_ROOT', rejected.json?.code === 'UNKNOWN_ROOT', `code=${rejected.json?.code}`),
      check('marker not created', !existsSync(path.join(root, '.sidekick-workspace'))),
      treeUnchanged(root, before),
    ]);
  }
  {
    const root = seed('b-swap-db');
    const swapped = run(['open-check', '--root', root, '--fault', 'swap-db']);
    record('B 身份替换 fault swap-db：捕获后被换库必须拒绝', 'open-check 期望 PATH_CHANGED；原库保留在 data/original.sqlite', [swapped], () => [
      check('exit1', swapped.status === 1, `status=${swapped.status}`),
      check('code=PATH_CHANGED', swapped.json?.code === 'PATH_CHANGED', `code=${swapped.json?.code}`),
      check('original preserved', existsSync(path.join(root, 'data/original.sqlite'))),
    ]);
  }
  {
    const root = seed('b-replace-marker');
    const replaced = run(['open-check', '--root', root, '--fault', 'replace-marker']);
    record('B 标记替换 fault replace-marker：首次使用停止、后续保持停止', 'open-check ok；faultFirstUse=PATH_CHANGED；faultSecondUseStopped=true', [replaced], () => [
      check('exit0', replaced.status === 0, `status=${replaced.status}`),
      check('faultFirstUse=PATH_CHANGED', replaced.json?.faultFirstUse === 'PATH_CHANGED', `faultFirstUse=${replaced.json?.faultFirstUse}`),
      check('faultSecondUseStopped', replaced.json?.faultSecondUseStopped === true),
    ]);
  }
  const sideFaultCases = [
    ['replace-wal', '打开并写入后 -wal 被换成符号链接'],
    ['replace-shm', '打开并写入后 -shm 被换成额外硬链'],
    ['degrade-runs', '打开后 runs/ 权限被降为 0755'],
  ];
  for (const [fault, label] of sideFaultCases) {
    const root = seed(`b-fault-${fault}`);
    const replaced = run(['open-check', '--root', root, '--fault', fault]);
    record(`B 打开后身份变化 fault ${fault}：${label}`, 'open-check ok；faultFirstUse=PATH_CHANGED；faultSecondUseStopped=true', [replaced], () => [
      check('exit0', replaced.status === 0, `status=${replaced.status}`),
      check('faultFirstUse=PATH_CHANGED', replaced.json?.faultFirstUse === 'PATH_CHANGED', `faultFirstUse=${replaced.json?.faultFirstUse}`),
      check('faultSecondUseStopped', replaced.json?.faultSecondUseStopped === true),
    ]);
  }

  // ---- C. WAL / short transactions ---------------------------------------
  {
    const root = seed('c-wal');
    const wal = run(['wal-check', '--root', root]);
    record(
      'C WAL 与短事务：提交可见、未提交不可见、失败回滚、关闭后检查点',
      'wal-check ok；walAfterWrite=true；readerDuringUncommitted 不含未提交行；rollback 后计数不变；walAfterClose=false',
      [wal],
      () => [
        check('exit0', wal.status === 0, `status=${wal.status}`),
        check('before=2', wal.json?.before === 2, `before=${wal.json?.before}`),
        check('afterCommit=3', wal.json?.afterCommit === 3, `afterCommit=${wal.json?.afterCommit}`),
        check('walAfterWrite', wal.json?.walAfterWrite === true),
        check('readerCount=3', wal.json?.readerCount === 3, `readerCount=${wal.json?.readerCount}`),
        check('uncommitted invisible', wal.json?.readerDuringUncommitted === 3, `readerDuringUncommitted=${wal.json?.readerDuringUncommitted}`),
        check('rollback failed', wal.json?.rollbackFailedStatement === true),
        check('afterRollback=3', wal.json?.afterRollback === 3, `afterRollback=${wal.json?.afterRollback}`),
        check('walAfterClose=false', wal.json?.walAfterClose === false),
      ],
    );
  }

  // ---- D. crash release and scheduling rejection --------------------------
  {
    const root = seed('d-worker-alive');
    const child = await holdWorker(root);
    const blocked = run(['try-schedule', '--root', root]);
    const openBlocked = run(['open-check', '--root', root]);
    const exit = await killAndWait(child, 'SIGKILL');
    const afterCrash = run(['try-schedule', '--root', root]);
    // wal-check runs before open-check: open-check inserts its own probe row.
    const wal = run(['wal-check', '--root', root]);
    const reopened = run(['open-check', '--root', root]);
    record(
      'D1 旧 worker 未退时拒绝调度；SIGKILL 崩溃后释放并可恢复',
      'worker 存活：try-schedule REJECT/ROOT_IN_USE 且 open-check ROOT_IN_USE；SIGKILL 后 try-schedule ACCEPT、wal-check ok（before=3）、open-check ok',
      [blocked, openBlocked, afterCrash, wal, reopened],
      () => [
        check('blocked reject', blocked.json?.decision === 'REJECT' && blocked.json?.code === 'ROOT_IN_USE', `decision=${blocked.json?.decision} code=${blocked.json?.code}`),
        check('worker alive recorded', blocked.json?.worker?.alive === true),
        check('open blocked', openBlocked.json?.code === 'ROOT_IN_USE', `code=${openBlocked.json?.code}`),
        check('killed by SIGKILL', exit.signal === 'SIGKILL', `signal=${exit.signal}`),
        check('afterCrash accept', afterCrash.json?.decision === 'ACCEPT', `decision=${afterCrash.json?.decision}`),
        check('worker dead recorded', afterCrash.json?.worker?.alive === false),
        check('reopened ok', reopened.status === 0 && reopened.json?.ok === true, `status=${reopened.status}`),
        check('wal ok', wal.status === 0 && wal.json?.before === 3, `before=${wal.json?.before}`),
      ],
    );
  }
  // ---- D2. worker record verification: unverifiable pauses scheduling ------
  {
    const gone = spawnSync('true');
    const deadPid = gone.pid;
    const writeRecord = (root, payload, mode = 0o600) => {
      const file = path.join(root, 'runs', 'worker.json');
      writeFileSync(file, typeof payload === 'string' ? payload : JSON.stringify(payload));
      chmodSync(file, mode);
      return file;
    };
    // Synthetic `kill -0` outcomes: the probe program is overridable so the
    // runner can produce permission/spawn failures without a real process.
    const permProbe = writeFixture('kill-perm.sh', '#!/bin/sh\necho "kill: Operation not permitted" >&2\nexit 1\n');
    const esrchProbe = writeFixture('kill-esrch.sh', '#!/bin/sh\necho "kill: No such process" >&2\nexit 1\n');
    const spawnProbe = path.join(buildDir, 'fixtures', 'does-not-exist');
    const cases = [
      ['d-worker-corrupt', '{not-json', 0o600, 'REJECT', 'WORKER_UNVERIFIED', '内容损坏', null],
      ['d-worker-no-pid', { startedAtMs: 1 }, 0o600, 'REJECT', 'WORKER_UNVERIFIED', '缺少 pid 字段', null],
      ['d-worker-symlink', null, 0o600, 'REJECT', 'WORKER_UNVERIFIED', '是符号链接', null],
      ['d-worker-hardlink', { pid: deadPid, startedAtMs: 1 }, 0o600, 'REJECT', 'WORKER_UNVERIFIED', '有额外硬链', null],
      ['d-worker-mode', { pid: deadPid, startedAtMs: 1 }, 0o644, 'REJECT', 'WORKER_UNVERIFIED', '权限 0644', null],
      ['d-worker-pid-range', { pid: 9223372036854775000, startedAtMs: 1 }, 0o600, 'REJECT', 'WORKER_UNVERIFIED', 'pid 超出有效范围', null],
      ['d-worker-live', { pid: process.pid, startedAtMs: Date.now() }, 0o600, 'REJECT', 'WORKER_ALIVE', '存活 PID', null],
      ['d-worker-dead', { pid: deadPid, startedAtMs: 1 }, 0o600, 'ACCEPT', null, '已退出 PID', null],
      ['d-worker-probe-spawn', { pid: deadPid, startedAtMs: 1 }, 0o600, 'REJECT', 'WORKER_UNVERIFIED', '探测命令无法启动', { SIDEKICK_PROBE_KILL: spawnProbe }],
      ['d-worker-probe-perm', { pid: deadPid, startedAtMs: 1 }, 0o600, 'REJECT', 'WORKER_ALIVE', '探测权限不足', { SIDEKICK_PROBE_KILL: permProbe }],
      ['d-worker-probe-esrch', { pid: deadPid, startedAtMs: 1 }, 0o600, 'ACCEPT', null, '探测确认不存在', { SIDEKICK_PROBE_KILL: esrchProbe }],
    ];
    for (const [name, payload, mode, decision, code, label, env] of cases) {
      const root = seed(name);
      if (name === 'd-worker-symlink') {
        const aside = path.join(root, 'runs', 'worker-record.json');
        writeFileSync(aside, JSON.stringify({ pid: deadPid, startedAtMs: 1 }));
        chmodSync(aside, 0o600);
        symlinkSync(aside, path.join(root, 'runs', 'worker.json'));
      } else if (name === 'd-worker-hardlink') {
        writeRecord(root, payload, mode);
        linkSync(path.join(root, 'runs', 'worker.json'), path.join(root, 'runs', 'worker-alias.json'));
      } else {
        writeRecord(root, payload, mode);
      }
      const schedule = run(['try-schedule', '--root', root], { env: env ?? {} });
      const checks = [
        check('exit0', schedule.status === 0, `status=${schedule.status}`),
        check(`decision=${decision}`, schedule.json?.decision === decision, `decision=${schedule.json?.decision}`),
      ];
      if (code) checks.push(check(`code=${code}`, schedule.json?.code === code, `code=${schedule.json?.code}`));
      if (code === 'WORKER_UNVERIFIED') {
        checks.push(check('worker unverified', schedule.json?.worker?.state === 'unverified', `worker=${JSON.stringify(schedule.json?.worker)}`));
      }
      record(`D2 worker 记录${label}：try-schedule ${decision}${code ? `/${code}` : ''}`, `worker.json ${label}：${decision}${code ? ` ${code}` : ''}（不可核实的记录不等于无记录）`, [schedule], () => checks);
    }
    {
      const root = seed('d-worker-absent');
      rmSync(path.join(root, 'runs', 'worker.json'), { force: true });
      const schedule = run(['try-schedule', '--root', root]);
      record('D2 无历史记录：try-schedule ACCEPT', '无 worker.json：ACCEPT（无记录与记录不可核实是两种状态）', [schedule], () => [
        check('exit0', schedule.status === 0, `status=${schedule.status}`),
        check('decision=ACCEPT', schedule.json?.decision === 'ACCEPT', `decision=${schedule.json?.decision}`),
      ]);
    }
  }
  // ---- D5. scheduler entry reuses the full existing-root validation --------
  {
    const markerOf = (root) => path.join(root, '.sidekick-workspace');
    const databaseOf = (root) => path.join(root, 'data', 'sidekick.sqlite');
    const scheduleCases = [
      ['d-schedule-empty', 'UNKNOWN_ROOT', '空目录无归属标记', (root) => {}],
      ['d-schedule-marker-content', 'UNKNOWN_ROOT', '归属标记内容错误', (root) => {
        writeFileSync(markerOf(root), 'unrecognized-root\n');
      }],
      ['d-schedule-marker-symlink', 'INVALID_ROOT', '归属标记是符号链接', (root) => {
        renameSync(markerOf(root), path.join(root, 'data', 'marker-aside'));
        symlinkSync(path.join(root, 'config', 'app.json'), markerOf(root));
      }],
      ['d-schedule-marker-hardlink', 'INVALID_ROOT', '归属标记有额外硬链', (root) => {
        linkSync(markerOf(root), path.join(root, 'data', 'marker-alias'));
      }],
      ['d-schedule-missing-dirs', 'INVALID_ROOT', '缺私有目录', (root) => {
        rmSync(path.join(root, 'data'), { recursive: true, force: true });
      }],
      ['d-schedule-missing-db', 'MISSING_DATABASE', '缺数据库', (root) => {
        rmSync(databaseOf(root), { force: true });
      }],
      ['d-schedule-db-hardlink', 'PATH_CHANGED', '数据库有额外硬链', (root) => {
        linkSync(databaseOf(root), path.join(root, 'data', 'alias.sqlite'));
      }],
      ['d-schedule-db-mode', 'PATH_CHANGED', '数据库权限 0644', (root) => {
        chmodSync(databaseOf(root), 0o644);
      }],
      ['d-schedule-runs-symlink', 'PATH_CHANGED', 'runs/ 是符号链接', (root) => {
        renameSync(path.join(root, 'runs'), path.join(root, 'runs-aside'));
        symlinkSync(path.join(root, 'runs-aside'), path.join(root, 'runs'));
      }],
      ['d-schedule-root-mode', 'PATH_CHANGED', '根目录权限 0755', (root) => {
        chmodSync(root, 0o755);
      }],
    ];
    for (const [name, expect, label, mutate] of scheduleCases) {
      const root = name === 'd-schedule-empty' ? freshDir(name) : seed(name);
      if (name === 'd-schedule-empty') chmodSync(root, 0o700);
      mutate(root);
      const before = snapshot(root);
      const schedule = run(['try-schedule', '--root', root]);
      record(
        `D5 调度入口复用完整根校验：${label}`,
        `try-schedule REJECT/${expect}；拒绝后文件树不变（调度不得旁路 open 的身份/私有性校验）`,
        [schedule],
        () => [
          check('exit0', schedule.status === 0, `status=${schedule.status}`),
          check('decision=REJECT', schedule.json?.decision === 'REJECT', `decision=${schedule.json?.decision}`),
          check(`code=${expect}`, schedule.json?.code === expect, `code=${schedule.json?.code}`),
          treeUnchanged(root, before),
        ],
      );
    }
  }
  {
    const root = seed('d-crash-during-write');
    const child = await holdWorker(root, { writeTx: true });
    const exit = await killAndWait(child, 'SIGKILL');
    // `rows` runs before `open-check`: open-check inserts its own probe row.
    const rows = run(['rows', '--root', root]);
    const reopened = run(['open-check', '--root', root]);
    const schedule = run(['try-schedule', '--root', root]);
    record(
      'D3 写事务中 SIGKILL：WAL 恢复丢弃未提交行，保留已提交行',
      'rows=[seed-a,seed-b,worker-committed]（无 worker-uncommitted）；open-check ok 且 countBefore=3；try-schedule ACCEPT',
      [rows, reopened, schedule],
      () => [
        check('killed by SIGKILL', exit.signal === 'SIGKILL', `signal=${exit.signal}`),
        check(
          'rows exclude uncommitted',
          JSON.stringify(rows.json?.ids) === JSON.stringify(['seed-a', 'seed-b', 'worker-committed']),
          `ids=${JSON.stringify(rows.json?.ids)}`,
        ),
        check('reopened ok', reopened.status === 0 && reopened.json?.ok === true, `status=${reopened.status}`),
        check('countBefore=3', reopened.json?.countBefore === 3, `countBefore=${reopened.json?.countBefore}`),
        check('schedule accept', schedule.json?.decision === 'ACCEPT', `decision=${schedule.json?.decision}`),
      ],
    );
  }
  {
    const root = seed('d-graceful');
    const child = await holdWorker(root);
    child.stdin.end();
    const exit = await waitFor(child);
    const schedule = run(['try-schedule', '--root', root]);
    record(
      'D4 正常退出（stdin EOF）同样释放根锁',
      'hold worker 退出码 0；try-schedule ACCEPT',
      [schedule],
      () => [
        check('exit0', exit.code === 0, `code=${exit.code}`),
        check('schedule accept', schedule.json?.decision === 'ACCEPT', `decision=${schedule.json?.decision}`),
      ],
    );
  }

  // ---- E. host facts ------------------------------------------------------
  {
    const facts = run(['host-facts']);
    const keychain = run(['keychain-facts']);
    const darwin = process.platform === 'darwin';
    record(
      darwin
        ? 'E 主机部署/凭据能力事实：合成根上的 Keychain 往返（仅合成 fixture）'
        : 'E 主机部署/凭据能力事实：非 macOS 平台只断言 Keychain 不受支持',
      darwin
        ? 'host-facts ok；keychain-facts ok（macOS 登录钥匙串，仅合成条目，读取后删除）'
        : 'host-facts ok；keychain-facts supported=false（不跨 OS 代签，Linux 准入见工程文档 §6）',
      [facts, keychain],
      () => {
        const checks = [
          check('host-facts ok', facts.json?.ok === true),
          check(
            'sqlite version recorded',
            typeof facts.json?.sqliteVersion === 'string' && facts.json.sqliteVersion.length > 0,
          ),
        ];
        if (darwin) {
          checks.push(
            check('keychain ok', keychain.json?.ok === true, `status=${keychain.status}`),
            check('keychain synthetic only', keychain.json?.syntheticOnly === true),
            check('keychain fixture removed', keychain.json?.fixtureRemoved === true),
          );
        } else {
          checks.push(
            check('keychain reports unsupported', keychain.json?.supported === false, `supported=${keychain.json?.supported}`),
            check('keychain not claimed verified', keychain.json?.syntheticOnly === undefined),
          );
        }
        return checks;
      },
    );
  }

  results.finishedAt = new Date().toISOString();
  results.summaryText = `${results.summary.passed}/${results.summary.total} scenarios passed`;
  writeFileSync(path.join(buildDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  log(`done: ${results.summaryText}`);
  if (results.summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
