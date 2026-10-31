import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';

const [role, record, mode = 'normal', marker = ''] = process.argv.slice(2);
const note = value => appendFileSync(record, JSON.stringify(value) + '\n', { mode: 0o600 });
if (role === 'model') {
  const stream = (response, tools) => {
    const delta = tools ? { role: 'assistant', tool_calls: tools.map((tool, index) => ({ index, id: `synthetic-call-${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } })) } : { role: 'assistant', content: JSON.stringify({ candidates: [{ title: '整理合成清单', kind: 'action', owner: '我', priority: 'medium', tags: [], evidence: '我整理合成清单。', dueExpression: null, followupExpression: null }] }) };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tools ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  };
  const server = createServer(async (request, response) => {
    try {
      let raw = ''; for await (const bytes of request) { raw += bytes; if (Buffer.byteLength(raw) > 2000000) throw new Error(); }
      const body = JSON.parse(raw), results = body.messages.filter(message => message.role === 'tool');
      const names = (body.tools || []).map(tool => tool.function.name).filter(name => name.startsWith('mcp_'));
      note({ type: 'model', names, results: results.map(message => String(message.content)) });
      if (mode === 'freeze' && !results.length) {
        const deadline = Date.now() + 5000;
        while (!existsSync(`${marker}.continue`) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (!results.length && names.length) {
        const calls = names.slice(0, 2).map(name => ({ name, args: { text: mode === 'coercion' ? 7 : 'controlled' } }));
        if (mode === 'lost') calls.splice(1, 0, { name: 'read', args: { path: `${marker}.read` } }, { name: 'bash', args: { command: `/usr/bin/touch '${marker}'` } });
        stream(response, calls);
      } else stream(response);
    } catch { response.writeHead(400); response.end('{}'); }
  });
  server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}/v1\n`));
  process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
} else {
  note({ type: 'pid', role, pid: process.pid, modelKeyPresent: Object.values(process.env).includes('p3-synthetic-token') });
  process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
  if (role === 'service') {
    spawn(process.execPath, [process.argv[1], 'child', record, mode], { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' });
    for await (const line of createInterface({ input: process.stdin })) {
      const request = JSON.parse(line); if (!('id' in request)) continue;
      let result;
      if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'controlled-trial', version: '1' } };
      else if (request.method === 'tools/list') result = { tools: [{ name: 'lookup', description: 'Controlled lookup', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] };
      else if (request.method === 'tools/call') {
        note({ type: 'call', name: request.params.name, arguments: request.params.arguments });
        if (mode === 'lost') continue;
        result = { content: [{ type: 'text', text: 'controlled-text' }], structuredContent: { value: 7 }, ...(mode === 'error' ? { isError: true } : {}) };
        if (mode === 'invalid') result.isError = 'bad';
        if (mode === 'oversized') result.content[0].text = 'x'.repeat(262144);
        if (mode === 'private') result.content[0].text = process.env.CONTROLLED_SECRET;
        if (mode === 'coercion') writeFileSync(marker, 'unexpected call');
      } else continue;
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
    }
  }
}
