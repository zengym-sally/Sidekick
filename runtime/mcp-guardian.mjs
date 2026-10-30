import { spawn, execFileSync } from 'node:child_process';
import { writeSync, fstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(import.meta.url);
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const mode = arg('--mode'), run = arg('--run'), nonce = arg('--nonce');
const group = mode === 'guardian' ? process.pid : Number(arg('--group'));
const guardian = mode === 'guardian' ? process.pid : Number(arg('--guardian'));
const lifetime = Math.min(120000, Math.max(1, Number(arg('--lifetime')) || 120000));
const controlEnv = { PATH: '/usr/bin:/bin', TMPDIR: '/tmp' };
let audit = false; try { audit = fstatSync(3).isFile(); } catch {}
const stdio = streams => [...streams, ...(audit ? [3] : [])];
const proof = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    const text = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid=,stat=,command='], { encoding: 'utf8', env: controlEnv }).trim();
    const m = text.match(/^(\d+)\s+(\S+)\s+(.*)$/s);
    return m && Number(m[1]) === group && !m[2].startsWith('Z') && m[3].includes(script) && m[3].includes(`--run ${run} `) && m[3].includes(`--nonce ${nonce} `) && /--mode (guardian|keeper)( |$)/.test(m[3]);
  } catch { return false; }
};
function signal(pid, sig) {
  if (!proof(pid)) return false;
  if (audit) { try { writeSync(3, JSON.stringify({ at: Date.now(), actor: mode, group, proofPid: pid, run, nonce, signal: sig, matched: true }) + '\n'); } catch { return false; } }
  try { process.kill(-group, sig); return true; } catch { return false; }
}
if (mode === 'cleaner') {
  const keeper = Number(arg('--keeper'));
  for (const sig of ['SIGSTOP', 'SIGKILL']) {
    const pid = [guardian, keeper].find(proof);
    if (!pid || !signal(pid, sig)) break;
  }
  process.exit(0);
}
let closing = false, keeper;
function cleanup() {
  if (closing) return; closing = true;
  const child = spawn(process.execPath, [script, '--mode', 'cleaner', '--run', run, '--nonce', nonce, '--group', String(group), '--guardian', String(guardian), '--keeper', String(keeper?.pid || process.pid)], { detached: true, env: controlEnv, stdio: stdio(['ignore', 'ignore', 'ignore']) });
  child.on('error', () => process.exit(2)); child.unref();
}
setTimeout(cleanup, lifetime);
process.on('SIGTERM', cleanup); process.on('SIGHUP', cleanup);
process.stdin.on('error', cleanup); process.stdin.on('end', cleanup);
if (mode === 'keeper') {
  process.stdin.resume(); writeSync(1, 'ready\n');
} else if (mode === 'guardian') {
  keeper = spawn(process.execPath, [script, '--mode', 'keeper', '--run', run, '--nonce', nonce, '--group', String(group), '--guardian', String(guardian), '--lifetime', String(lifetime)], { detached: false, env: controlEnv, stdio: stdio(['pipe', 'pipe', 'ignore']) });
  keeper.stdin.on('error', cleanup); keeper.on('error', cleanup); keeper.on('exit', cleanup);
  keeper.stdout.once('data', () => writeSync(1, JSON.stringify({ sidekick: 'owner', guardian, keeper: keeper.pid, run, nonce }) + '\n'));
  let buffer = Buffer.alloc(0), service, boot = false;
  const fail = () => { try { writeSync(4, '{"sidekick":"error"}\n'); } catch {} cleanup(); };
  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  process.stdout.on('error', cleanup);
  process.stdin.on('data', chunk => {
    if (closing) return;
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.includes(10)) {
      const i = buffer.indexOf(10); if (i + 1 > 2000000) { fail(); return; }
      const line = buffer.subarray(0, i + 1); buffer = buffer.subarray(i + 1);
      if (!boot) {
        let p; try { p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); } catch { fail(); return; }
        if (p.run !== run || p.nonce !== nonce || typeof p.command !== 'string' || !Array.isArray(p.args) || !p.args.every(x => typeof x === 'string') || typeof p.cwd !== 'string' || !p.env || typeof p.env !== 'object') { fail(); return; }
        boot = true;
        service = spawn(p.command, p.args, { cwd: p.cwd, env: p.env, detached: false, stdio: ['pipe', 1, 2] });
        service.stdin.on('error', fail);
        service.on('error', fail); service.on('exit', () => { if (!closing) fail(); });
        // Inherited pipe ends let Runtime drain the original streams after this guardian dies.
      } else if (!service.stdin.write(line)) {
        process.stdin.pause(); service.stdin.once('drain', () => { if (!closing) process.stdin.resume(); });
      }
    }
    if (buffer.length >= 2000000) fail();
  });
} else process.exit(2);
