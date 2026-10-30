import test from 'node:test';
import assert from 'node:assert/strict';
import { StdioTransport } from '@earendil-works/pi-mcp';
import { managedStdio } from './transport.mjs';

for (const mode of ['close', 'peer-close']) {
  test(`ownership ends once after ${mode}`, async () => {
    const trace = [], originalKill = process.kill;
    process.kill = (pid, signal) => { trace.push({ type: 'signal', pid, signal }); return true; };
    try {
      const transport = managedStdio({ node: 'synthetic-node', guardian: 'synthetic-guardian', runId: 'synthetic-run', nonce: 'synthetic-nonce', command: 'synthetic-command', args: [], cwd: '/synthetic', env: {}, lifetimeMs: 1000, onWorker: frame => trace.push({ type: frame.action }) });
      await transport.start();
      if (mode === 'peer-close') StdioTransport.latest.signalClose();
      await transport.close(); await transport.close();
      assert.deepEqual(trace, [{ type: 'start' }, { type: 'signal', pid: -424242, signal: 'SIGSTOP' }, { type: 'signal', pid: -424242, signal: 'SIGKILL' }, { type: 'end' }]);
    } finally { process.kill = originalKill; }
  });
}
