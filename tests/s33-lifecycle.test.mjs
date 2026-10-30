import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const node = resolve('build/s0-runtime/node'), entry = resolve('build/s33-lifecycle/process.mjs');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function until(fn, message, limit = 4000) {
  const start = Date.now();
  while (Date.now() - start < limit) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail(message);
}
async function records(file) { try { return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }

for (const scenario of ['normal', 'cancel', 'timeout', 'kill-host', 'kill-runtime', 'kill-guardian', 'kill-server', 'guardian-timeout']) {
  test(`MCP lifecycle: ${scenario}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'sidekick-s33-p1-')), record = join(root, 'owned.ndjson');
    const host = spawn(node, [entry, 'host', scenario, record, randomUUID(), randomUUID()], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const control = spawn(node, ['-e', 'setInterval(()=>{},1000)'], { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' });
    const frames = []; let stderr = '';
    createInterface({ input: host.stdout }).on('line', line => frames.push(JSON.parse(line)));
    host.stderr.on('data', chunk => { stderr += chunk; }); host.stdin.on('error', () => {});
    t.after(async () => {
      const owned = (await records(record)).filter(x => x.type === 'pid').map(x => x.pid);
      if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
      for (const pid of [...owned, frames.find(x => x.type === 'runtime')?.pid].filter(Boolean)) {
        let command = '';
        try { command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }); } catch {}
        if (command.includes(record)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      }
      if (control.exitCode === null && control.signalCode === null) control.kill('SIGKILL');
      await rm(root, { recursive: true, force: true });
    });
    await until(() => frames.some(x => x.type === 'ready'), `no MCP roundtrip: ${stderr}`);
    const ready = frames.find(x => x.type === 'ready'), runtime = frames.find(x => x.type === 'runtime').pid;
    const worker = frames.find(x => x.type === 'worker' && x.action === 'start');
    assert.ok(frames.some(x => x.type === 'owner-registered' && x.pid === worker.pid));
    assert.deepEqual(ready.tools, ['echo', 'error', 'wait']);
    assert.equal(ready.echo.content[0].text, 's33-real-stdio-roundtrip'); assert.equal(ready.error.isError, true);
    const owned = (await records(record)).filter(x => x.type === 'pid');
    assert.deepEqual(owned.map(x => x.role).sort(), ['child', 'grandchild', 'server']);
    for (const { pid } of owned) {
      const pgid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
      assert.equal(pgid, worker.pid);
    }
    if (scenario === 'normal') host.stdin.write('{"type":"close"}\n');
    else {
      await until(() => frames.some(x => x.type === 'waiting'), 'wait tool was not actually dispatched');
      if (scenario === 'cancel') host.stdin.write('{"type":"cancel"}\n');
      if (scenario === 'kill-host') host.kill('SIGKILL');
      if (scenario === 'kill-runtime') process.kill(runtime, 'SIGKILL');
      if (scenario === 'kill-guardian') process.kill(worker.pid, 'SIGKILL');
      if (scenario === 'kill-server') process.kill(owned.find(x => x.role === 'server').pid, 'SIGKILL');
    }
    const pids = [...owned.map(x => x.pid), worker.pid, runtime, host.pid];
    const started = Date.now();
    await until(() => pids.every(pid => !alive(pid)), `owned processes survived: ${pids.filter(alive).join(',')}`, 5000);
    assert.ok(alive(control.pid), 'unrelated process was killed'); assert.equal(stderr, '');
    assert.ok(!frames.some(x => x.type === 'unexpected-success'));
    if (scenario === 'normal') {
      assert.ok(frames.some(x => x.type === 'closed'));
      assert.ok(!frames.some(x => x.type === 'error'));
      assert.ok(frames.some(x => x.type === 'runtime-exit' && x.code === 0 && x.signal === null));
    }
    const calls = (await records(record)).filter(x => x.type === 'call');
    assert.deepEqual(calls.map(x => x.name), scenario === 'normal' ? ['echo', 'error'] : ['echo', 'error', 'wait']);
    if (scenario === 'cancel' || scenario === 'timeout') {
      assert.ok(frames.some(x => x.type === 'stopped' && x.category === (scenario === 'cancel' ? 'AbortError' : 'McpTimeoutError')));
    }
    t.diagnostic(JSON.stringify({ scenario, discovered: ready.tools.length, calls: calls.length, ownedProcessesExited: pids.length, unrelatedAlive: true, stopObservationMs: Date.now() - started }));
  });
}

for (const scenario of ['no-owner-ack', 'initialization-wait']) {
  test(`MCP startup lifecycle: ${scenario}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'sidekick-s33-start-')), record = join(root, 'owned.ndjson');
    const host = spawn(node, [entry, 'host', scenario, record, randomUUID(), randomUUID()], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const frames = []; let stderr = '';
    createInterface({ input: host.stdout }).on('line', line => frames.push(JSON.parse(line)));
    host.stderr.on('data', chunk => { stderr += chunk; }); host.stdin.on('error', () => {});
    t.after(async () => {
      if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
      for (const pid of [...(await records(record)).filter(x => x.type === 'pid').map(x => x.pid), frames.find(x => x.type === 'runtime')?.pid].filter(Boolean)) {
        let command = '';
        try { command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }); } catch {}
        if (command.includes(record)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      }
      await rm(root, { recursive: true, force: true });
    });
    await until(() => frames.some(x => x.type === 'owner-registered'), 'worker was not registered');
    if (scenario === 'initialization-wait') {
      await until(async () => (await records(record)).filter(x => x.type === 'pid').length === 3 && (await records(record)).some(x => x.type === 'initialize'), 'server did not enter initialization');
      host.stdin.write('{"type":"cancel"}\n');
    }
    await until(() => frames.some(x => x.type === 'closed'), 'startup did not stop within its bound', scenario === 'no-owner-ack' ? 4000 : 1500);
    const owned = (await records(record)).filter(x => x.type === 'pid');
    const pids = [...owned.map(x => x.pid), frames.find(x => x.type === 'worker' && x.action === 'start').pid, frames.find(x => x.type === 'runtime').pid, host.pid];
    await until(() => pids.every(pid => !alive(pid)), 'startup left an owned process');
    assert.equal(stderr, ''); assert.ok(frames.some(x => x.type === 'error'));
    assert.ok(!frames.some(x => x.type === 'ready'));
    assert.ok(!(await records(record)).some(x => x.type === 'call'));
    if (scenario === 'no-owner-ack') assert.equal(owned.length, 0, 'server started before ownership acknowledgement');
    t.diagnostic(JSON.stringify({ scenario, noToolCalls: true, ownedProcessesExited: pids.length }));
  });
}
