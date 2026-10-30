import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [record, role = 'server', scenario] = process.argv.slice(2);
const note = value => appendFileSync(record, `${JSON.stringify(value)}\n`, { mode: 0o600 });
note({ type: 'pid', role, pid: process.pid, ppid: process.ppid });
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
if (role === 'server' || role === 'child') {
  const child = spawn(process.execPath, [process.argv[1], record, role === 'server' ? 'child' : 'grandchild'], {
    env: { PATH: '/usr/bin:/bin' }, detached: false, stdio: 'ignore',
  });
  child.on('error', () => process.exit(1));
}
if (role === 'server') {
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    if (!('id' in request)) {
      if (request.method === 'notifications/cancelled') note({ type: 'cancel', requestId: request.params.requestId });
      continue;
    }
    let result;
    if (request.method === 'initialize') {
      note({ type: 'initialize' });
      if (scenario === 'initialization-wait') continue;
      result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 's33-lifecycle-fixture', version: '1' } };
    } else if (request.method === 'tools/list') {
      note({ type: 'list' });
      result = { tools: ['echo', 'error', 'wait'].map(name => ({ name, inputSchema: { type: 'object', properties: { text: { type: 'string' } } } })) };
    } else if (request.method === 'tools/call') {
      note({ type: 'call', name: request.params.name, text: request.params.arguments?.text });
      if (request.params.name === 'wait') continue;
      result = { content: [{ type: 'text', text: request.params.arguments?.text || 'controlled-error' }], ...(request.params.name === 'error' ? { isError: true } : {}) };
    } else {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown fixture method' } })}\n`);
      continue;
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  }
}
