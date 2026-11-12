// Protocol worker factory (MAYNE-24 slice II) — the frozen 2026-11-08
// arbitration's approved programmatic private test signatures (GAP-3..GAP-5):
//
//   config.workerProcessFactory(file, args, spawnOptions): ChildProcess
//     Synchronously returns a Node child process interface with real stdio
//     and exit events; it replaces ONLY the WorkerHost spawn call. When the
//     config key is unset the production default must spawn the real Pi —
//     the suites that need the real Pi simply pass no factory.
//   config.workerRunLimitMs: integer 1..120000, default still 120000; a
//     short limit is fed into the same production timeout path.
//
// Neither key enters HTTP/CLI/environment configuration, and this fixture
// never modifies fencing, exit verification or state-transition criteria:
// every staging / publish / fence / timeout decision is production code
// reacting to the fake worker's real stdio frames. The real-Pi normal chain
// stays verified by the controlled-model suite and the real-Pi queue cases.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const WORKER_SCENARIOS = [
  'well-behaved',
  'stage-then-hang',
  'late-identity-frame',
  'lingering-tree',
  'early-failure',
];

// The cleanup retry pause: a still-live pid gets another SIGKILL round after
// this sleep. It is a per-round pause, never a total wait — every round stays
// bounded by the caller's remaining hard budget.
const CLEANUP_RETRY_SLEEP_MS = 100;

// Scenarios are consumed in spawn order (one worker per attempt); a suite can
// enqueue more mid-run. The registry file carries worker identities (so a
// later worker can stamp a genuinely late frame) and derived grandchild pids
// (so cleanup can reach them).
export function createProtocolWorkerFactory(options = {}) {
  const { scenarios = ['well-behaved'], registryDir } = options;
  const queue = [...scenarios];
  const ownsRegistry = registryDir === undefined;
  const registryRoot = registryDir ?? mkdtempSync(join(tmpdir(), 'web-text-intake-protocol-'));
  const registryPath = join(registryRoot, 'identities.jsonl');
  const workers = [];
  // One entry per spawn attempt, in order: {attempt, scenario, pid}. The pid
  // is known synchronously from spawn(), so identity registration covers even
  // a worker that fails before writing anything (R2-3).
  const attempts = [];
  let exhaustionError = null;
  const factory = (file, args, spawnOptions = {}) => {
    const attempt = attempts.length + 1;
    const scenario = queue.length > 0 ? queue.shift() : null;
    if (scenario === null) {
      // Scenario exhaustion is an EXPLICIT error, never a silent fallback
      // (R2-1): an attempt beyond the registered scenarios must fail loudly
      // with the registered count and the attempt number, so the suite can
      // assert the exact attempt count instead of a silently substituted
      // well-behaved worker.
      exhaustionError = new Error(
        `protocol worker scenario queue exhausted: ${attempts.length} scenario(s) registered, `
        + `attempt ${attempt} requested — no silent fallback; every worker spawn must map to a `
        + 'registered scenario',
      );
      // The exhausted attempt is recorded too (pid null — nothing was
      // spawned), so attempts.length is the true number of spawn attempts.
      attempts.push({ attempt, scenario: null, pid: null });
      throw exhaustionError;
    }
    if (!WORKER_SCENARIOS.includes(scenario)) {
      throw new Error(`unknown protocol worker scenario: ${scenario}`);
    }
    const child = spawn(process.execPath, [
      join(import.meta.dirname, 'protocol-worker-process.mjs'),
      '--scenario', scenario,
      '--registry', registryPath,
    ], { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] });
    attempts.push({ attempt, scenario, pid: child.pid });
    workers.push(child);
    return child;
  };
  factory.workers = workers;
  factory.attempts = attempts;
  factory.scenarioQueue = queue;
  factory.registryPath = registryPath;
  factory.exhaustionError = () => exhaustionError;
  factory.enqueue = (scenario) => {
    if (!WORKER_SCENARIOS.includes(scenario)) throw new Error(`unknown protocol worker scenario: ${scenario}`);
    queue.push(scenario);
    return factory;
  };
  const isAlive = (pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  // Kill every spawned worker plus every derived grandchild the registry
  // recorded, then VERIFY all exits: each recorded pid must be gone (a
  // survivor is retried with SIGKILL while budget remains). The grandchildren
  // carry the same 300s lifetime in every scenario, so a live one at cleanup
  // time proves the kill — not the lifetime — ended it (shortening the
  // lifetime is not a substitute for cleanup). Returns the verification
  // report; throws when any recorded pid survives.
  //
  // Every wait derives from the caller's remaining HARD budget (the aggregate
  // runs `node --test --test-timeout=20000`, and each case keeps a margin
  // between its work deadline and that hard deadline for exactly this step):
  // the retired fixed 5s/15s waits could outlive the hard deadline, and a
  // Promise timeout that resolves without a verified exit would mask a
  // leftover process. Termination comes first, then every recorded pid is
  // verified gone one by one; no margin left or any survivor is an explicit
  // failure.
  factory.cleanup = async (hardDeadline) => {
    const remaining = () => {
      if (typeof hardDeadline !== 'number' || !Number.isFinite(hardDeadline)) {
        throw new Error(
          'factory.cleanup requires the case hard deadline (absolute epoch ms) so the cleanup budget '
          + 'derives from the remaining hard budget; a fixed wait is no longer accepted',
        );
      }
      return hardDeadline - Date.now();
    };
    // Terminate FIRST — even with no margin left the self-built processes must
    // not be left running; a missing margin is reported after the kill.
    for (const child of workers) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    const grandchildren = [];
    try {
      for (const line of readFileSync(registryPath, 'utf8').trim().split('\n').filter(Boolean)) {
        let entry = null;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry?.lingerPid) grandchildren.push(entry.lingerPid);
      }
    } catch { /* no registry written */ }
    for (const pid of grandchildren) {
      if (isAlive(pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
    if (remaining() <= 0) {
      throw new Error(
        `protocol worker cleanup has no margin left to the hard deadline (${hardDeadline}): the case overran `
        + 'its work deadline. Every worker and derived grandchild was SIGKILLed, but the exits cannot be '
        + 'verified within the hard budget — cleanup must fail explicitly rather than outlive it',
      );
    }
    const waitExit = (child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(resolve, Math.max(0, remaining()));
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    for (const child of workers) await waitExit(child);
    // Verify every recorded pid one by one; a still-live pid gets another
    // SIGKILL round while the remaining hard budget allows it.
    const survivors = [];
    const spawnedPids = attempts.filter((entry) => typeof entry.pid === 'number').map((entry) => entry.pid);
    for (const pid of [...spawnedPids, ...grandchildren]) {
      let gone = !isAlive(pid);
      while (!gone && remaining() > 0) {
        try { process.kill(pid, 'SIGKILL'); } catch { gone = true; }
        await new Promise((done) => setTimeout(done, Math.min(CLEANUP_RETRY_SLEEP_MS, Math.max(0, remaining()))));
        gone = !isAlive(pid);
      }
      if (!gone) survivors.push(pid);
    }
    const report = {
      workers: spawnedPids,
      grandchildren,
      survivors,
    };
    factory.cleanupReport = report;
    if (ownsRegistry) rmSync(registryRoot, { recursive: true, force: true });
    if (survivors.length > 0) {
      throw new Error(
        `protocol worker cleanup could not verify all exits: survivor pids ${JSON.stringify(survivors)} `
        + `(workers ${JSON.stringify(report.workers)}, derived grandchildren ${JSON.stringify(grandchildren)})`,
      );
    }
    return report;
  };
  return factory;
}
