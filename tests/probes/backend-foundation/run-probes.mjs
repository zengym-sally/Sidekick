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

function run(args, { timeout = 60000 } = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
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
    const rejected = run(['open-reject', '--root', root, '--expect', 'MISSING_DATABASE']);
    record(
      'A2 无 CREATE 的已有库打开：缺库拒绝且不新建文件',
      'open-reject 期望 MISSING_DATABASE；库文件仍未出现',
      [rejected],
      () => [
        check('exit0', rejected.status === 0, `status=${rejected.status}`),
        check('code=MISSING_DATABASE', rejected.json?.code === 'MISSING_DATABASE', `code=${rejected.json?.code}`),
        check('db still absent', !existsSync(path.join(root, 'data', 'sidekick.sqlite'))),
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
    const rejected = run(['open-reject', '--root', root, '--expect', expect]);
    record(`B 文件身份拒绝 ${name}`, `open-reject 期望 ${expect}`, [rejected], () => [
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check(`code=${expect}`, rejected.json?.code === expect, `code=${rejected.json?.code}`),
    ]);
  }
  {
    const root = seed('b-corrupt');
    writeFileSync(path.join(root, 'data/sidekick.sqlite'), Buffer.alloc(4096, 7));
    const rejected = run(['open-reject', '--root', root, '--expect', 'CORRUPT_DATABASE']);
    record('B 文件身份拒绝 corrupt-db', 'open-reject 期望 CORRUPT_DATABASE', [rejected], () => [
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check('code=CORRUPT_DATABASE', rejected.json?.code === 'CORRUPT_DATABASE', `code=${rejected.json?.code}`),
    ]);
  }
  {
    const root = seed('b-app-id');
    const mutated = run(['mutate', '--root', root, '--application-id', '123']);
    const rejected = run(['open-reject', '--root', root, '--expect', 'UNKNOWN_DATABASE']);
    record('B 文件身份拒绝 wrong-app-id', 'mutate 后 open-reject 期望 UNKNOWN_DATABASE', [mutated, rejected], () => [
      check('mutate ok', mutated.json?.ok === true),
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check('code=UNKNOWN_DATABASE', rejected.json?.code === 'UNKNOWN_DATABASE', `code=${rejected.json?.code}`),
    ]);
  }
  {
    const root = seed('b-future');
    run(['mutate', '--root', root, '--user-version', '6']);
    const rejected = run(['open-reject', '--root', root, '--expect', 'SCHEMA_TOO_NEW']);
    record('B 文件身份拒绝 future-version', 'open-reject 期望 SCHEMA_TOO_NEW', [rejected], () => [
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check('code=SCHEMA_TOO_NEW', rejected.json?.code === 'SCHEMA_TOO_NEW', `code=${rejected.json?.code}`),
    ]);
  }
  {
    const root = freshDir('b-unknown-root');
    writeFileSync(path.join(root, 'unrelated.txt'), 'not a sidekick root');
    const rejected = run(['open-reject', '--root', root, '--expect', 'UNKNOWN_ROOT']);
    record('B 文件身份拒绝 unknown-root', '非空且无归属标记的目录 open-reject 期望 UNKNOWN_ROOT', [rejected], () => [
      check('exit0', rejected.status === 0, `status=${rejected.status}`),
      check('code=UNKNOWN_ROOT', rejected.json?.code === 'UNKNOWN_ROOT', `code=${rejected.json?.code}`),
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
  {
    const root = seed('d-lock-not-proof');
    writeFileSync(path.join(root, 'runs/worker.json'), JSON.stringify({ pid: process.pid, startedAtMs: Date.now() }));
    const liveWorker = run(['try-schedule', '--root', root]);
    rmSync(path.join(root, 'runs/worker.json'), { force: true });
    const noRecord = run(['try-schedule', '--root', root]);
    record(
      'D2 根锁不是 worker 已停的证明：活 PID 记录下拒绝调度',
      'worker.json 记录存活 PID：try-schedule REJECT/WORKER_ALIVE；移除记录后 ACCEPT',
      [liveWorker, noRecord],
      () => [
        check('reject WORKER_ALIVE', liveWorker.json?.decision === 'REJECT' && liveWorker.json?.code === 'WORKER_ALIVE', `decision=${liveWorker.json?.decision} code=${liveWorker.json?.code}`),
        check('accept after record removed', noRecord.json?.decision === 'ACCEPT', `decision=${noRecord.json?.decision}`),
      ],
    );
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
    record(
      'E 主机部署/凭据能力事实：合成根上的 Keychain 往返（仅合成 fixture）',
      'host-facts ok；keychain-facts ok（macOS 登录钥匙串，仅合成条目，读取后删除）',
      [facts, keychain],
      () => [
        check('host-facts ok', facts.json?.ok === true),
        check('sqlite version recorded', typeof facts.json?.sqliteVersion === 'string' && facts.json.sqliteVersion.length > 0),
        check('keychain ok', keychain.json?.ok === true, `status=${keychain.status}`),
        check('keychain synthetic only', keychain.json?.syntheticOnly === true),
        check('keychain fixture removed', keychain.json?.fixtureRemoved === true),
      ],
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
