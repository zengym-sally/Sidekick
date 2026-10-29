import { createInterface } from 'node:readline';

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const message = JSON.parse(line);
  if (!('id' in message)) continue;
  let result;
  if (message.method === 'initialize') {
    result = {
      protocolVersion: '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'sidekick-s0-fixture', version: '1.0.0' },
    };
  } else if (message.method === 'tools/list') {
    result = { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] };
  } else if (message.method === 'tools/call') {
    if (message.params.name === 'slow') continue;
    result = message.params.name === 'error'
      ? { content: [{ type: 'text', text: 'controlled failure' }], isError: true }
      : { content: [{ type: 'text', text: message.params.arguments.text }] };
  } else if (message.method === 'ping') {
    result = {};
  } else {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown method' } })}\n`);
    continue;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
}
