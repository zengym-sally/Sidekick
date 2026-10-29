import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { forwardListenerSignals } from './listener-lifecycle.mjs';

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} stops only the owned child and preserves the interruption status`, async (t) => {
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    await once(child.stdout, 'data');
    const owner = new EventEmitter();
    forwardListenerSignals(child, owner);
    const ended = once(child, 'exit');
    owner.emit(signal);
    await ended;
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    assert.equal(owner.exitCode, signal === 'SIGINT' ? 130 : 143);
    assert.equal(owner.listenerCount(signal), 0);
  });
}
test('a child that ignores SIGTERM is reaped within the bounded cleanup', async (t) => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); process.stdout.write("ready"); setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await once(child.stdout, 'data');
  const owner = new EventEmitter();
  forwardListenerSignals(child, owner);
  const ended = once(child, 'exit');
  owner.emit('SIGINT');
  const [, signal] = await ended;
  assert.equal(signal, 'SIGKILL');
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});
