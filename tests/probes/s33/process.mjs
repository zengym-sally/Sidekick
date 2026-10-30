import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from '@earendil-works/pi-mcp';
import { managedStdio, stopGroup } from './transport.mjs';

const [mode, scenario, record, runId, nonce] = process.argv.slice(2);
const directory = dirname(fileURLToPath(import.meta.url));
const emit = value => { if (!process.stdout.destroyed) process.stdout.write(`${JSON.stringify(value)}\n`); };
const lines = createInterface({ input: process.stdin });
if (mode === 'host') {
  const runtime = spawn(process.execPath, [process.argv[1], 'runtime', scenario, record, runId, nonce], {
    env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  emit({ type: 'runtime', pid: runtime.pid });
  const workers = new Map();
  const owns = owner => {
    let command = '';
    try { command = execFileSync('/bin/ps', ['-p', String(owner.pid), '-o', 'command='], { encoding: 'utf8' }); } catch {}
    return command.includes(owner.script) && command.includes(`--run ${runId}`) && command.includes(`--nonce ${nonce}`);
  };
  const reap = () => {
    for (const [pid, owner] of workers) {
      if (owns(owner)) stopGroup(pid);
    }
  };
  createInterface({ input: runtime.stdout }).on('line', line => {
    const frame = JSON.parse(line);
    if (frame.type === 'worker' && frame.action === 'start') {
      if (!owns(frame)) { runtime.stdin.end(); return; }
      workers.set(frame.pid, frame);
      if (scenario !== 'no-owner-ack') runtime.stdin.write(`${JSON.stringify({ type: 'owned', pid: frame.pid, nonce })}\n`);
      emit({ type: 'owner-registered', pid: frame.pid });
    }
    if (frame.type === 'worker' && frame.action === 'end') workers.delete(frame.pid);
    emit(frame);
  });
  runtime.stderr.on('data', () => {});
  runtime.stdin.on('error', () => {});
  lines.on('line', line => runtime.stdin.write(`${line}\n`));
  lines.on('close', () => runtime.stdin.end());
  process.stdout.on('error', () => { runtime.stdin.end(); reap(); });
  runtime.on('exit', (code, signal) => { reap(); emit({ type: 'runtime-exit', code, signal }); lines.close(); process.stdin.destroy(); });
} else {
  const controller = new AbortController();
  let finishNormal;
  const normal = new Promise(resolve => { finishNormal = resolve; });
  let registerWorker, registeredPid;
  const registered = new Promise(resolve => { registerWorker = resolve; });
  let ending = false;
  const transport = managedStdio({
    node: process.execPath, guardian: join(directory, 'guardian.mjs'), runId, nonce,
    command: process.execPath, args: [join(directory, 'service.mjs'), record, 'server', scenario], cwd: directory,
    env: { PATH: '/usr/bin:/bin' }, lifetimeMs: scenario === 'guardian-timeout' ? 900 : 8000,
    onWorker: frame => { emit({ type: 'worker', ...frame }); if (frame.action === 'start') { registeredPid = frame.pid; return registered; } },
  });
  const client = new McpClient({ name: 'sidekick-s33-lifecycle', version: '1', requestTimeoutMs: 3000 });
  const close = async () => { controller.abort(); finishNormal(); await transport.close(); };
  lines.on('line', line => {
    const frame = JSON.parse(line);
    if (frame.type === 'cancel') { controller.abort(); void transport.close(); }
    if (frame.type === 'close') finishNormal();
    if (frame.type === 'owned' && frame.nonce === nonce && frame.pid === registeredPid) registerWorker();
  });
  lines.on('close', () => { if (!ending) void close(); });
  process.on('SIGTERM', () => { void close(); });
  process.stdout.on('error', () => { void close(); });
  const deadline = setTimeout(() => { void close(); }, 10000);
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const echo = await client.callTool('echo', { text: 's33-real-stdio-roundtrip' });
    const error = await client.callTool('error', {});
    while (readFileSync(record, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(x => x.type === 'pid').length < 3) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    emit({ type: 'ready', tools: tools.map(x => x.name), echo, error });
    if (scenario === 'normal') await normal;
    else {
      const pending = client.callTool('wait', {}, { signal: controller.signal, timeoutMs: scenario === 'timeout' ? 500 : 6000 });
      pending.catch(() => {});
      while (!readFileSync(record, 'utf8').includes('"name":"wait"')) await new Promise(resolve => setTimeout(resolve, 10));
      emit({ type: 'waiting' });
      try { await pending; emit({ type: 'unexpected-success' }); }
      catch (error) { emit({ type: 'stopped', category: error.name }); }
    }
  } catch (error) { emit({ type: 'error', category: error.name }); process.exitCode = 1; }
  finally {
    ending = true; clearTimeout(deadline); await client.close(); await transport.close();
    emit({ type: 'closed' }); lines.close(); process.stdin.destroy();
  }
}
