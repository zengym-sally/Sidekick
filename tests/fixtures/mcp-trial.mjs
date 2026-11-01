import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';

const [role, record, mode = 'normal', marker = '', nativeNonce = ''] = process.argv.slice(2);
const note = value => appendFileSync(record, JSON.stringify(value) + '\n', { mode: 0o600 });
if (role === 'model') {
  let requests = 0;
  const stream = (response, tools, prefix = 'synthetic-call-', finalData = null) => {
    const delta = tools ? { role: 'assistant', tool_calls: tools.map((tool, index) => ({ index, id: `${prefix}${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } })) } : { role: 'assistant', content: JSON.stringify(finalData || { candidates: [{ title: '整理合成清单', kind: 'action', owner: '我', priority: 'medium', tags: [], evidence: mode === 'short-evidence' ? '我整理合成清单' : '我整理合成清单。', dueExpression: null, followupExpression: null }] }) };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tools ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  };
  const server = createServer(async (request, response) => {
    try {
      if (nativeNonce && (request.headers.authorization !== 'Bearer p6-synthetic-token' || request.headers['x-sidekick-native-nonce'] !== nativeNonce)) { response.writeHead(403); response.end('{}'); return; }
      let raw = ''; for await (const bytes of request) { raw += bytes; if (Buffer.byteLength(raw) > 2000000) throw new Error(); }
      const body = JSON.parse(raw), results = body.messages.filter(message => message.role === 'tool');
      const user = body.messages.findLast(message => message.role === 'user');
      const userText = typeof user?.content === 'string' ? user.content : (user?.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
      const context = JSON.parse(userText || '{}');
      const finalData = context.task === 'connection test' ? { ok: true } : context.instruction ? { changes: mode === 'diagnostic-invalid-revise' ? {} : { title: '核对合成清单' } } : null;
      const names = (body.tools || []).map(tool => tool.function.name).filter(name => name.startsWith('mcp_'));
      requests++;
      const readPath = ['recovery-retry', 'recovery-read-control'].includes(mode) ? /<location>([^<]+)<\/location>/.exec(body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n'))?.[1] : undefined;
      if (['recovery-retry', 'recovery-read-control'].includes(mode) && (!readPath || !(body.tools || []).some(tool => tool.function.name === 'read'))) throw new Error('Controlled Read target unavailable.');
      note({ type: 'model', names, allNames: (body.tools || []).map(tool => tool.function.name), hasSkills: /<available_skills>|<location>/.test(body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')), request: requests, results: results.map(message => String(message.content)), ...(readPath ? { readPath } : {}) });
      if (mode === 'recovery-read-control' && !results.length) { stream(response, [{ name: 'read', args: { path: readPath } }]); return; }
      if (mode === 'freeze' && !results.length) {
        const deadline = Date.now() + 5000;
        while (!existsSync(`${marker}.continue`) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (mode === 'recovery-hold-final' && results.length) {
        const deadline = Date.now() + 10000;
        while (!existsSync(`${marker}.continue`) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (mode === 'recovery-retry' && names.length) {
        stream(response, [{ name: names[0], args: { text: 'controlled' } }, { name: names[0], args: { text: 'controlled' } }, { name: 'read', args: { path: readPath } }, { name: 'bash', args: { command: `/usr/bin/touch '${marker}'` } }, { name: names[1], args: { text: 'controlled' } }], `recovery-${requests}-`);
        return;
      }
      if (!results.length && names.length) {
        const selected = mode === 'recovery-hold-final' ? names.slice(0, 1) : names.slice(0, 2);
        const calls = selected.map(name => ({ name, args: { text: mode === 'coercion' ? 7 : 'controlled' } }));
        if (mode === 'recovery-budget-over') calls.splice(1, 0, { name: names[0], args: { text: 'controlled' } }, { name: names[0], args: { text: 'controlled' } });
        if (mode === 'lost') calls.splice(1, 0, { name: 'read', args: { path: `${marker}.read` } }, { name: 'bash', args: { command: `/usr/bin/touch '${marker}'` } });
        stream(response, calls);
      } else stream(response, null, 'synthetic-call-', finalData);
    } catch { response.writeHead(400); response.end('{}'); }
  });
  server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}/v1\n`));
  process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
} else {
  note({ type: 'pid', role, pid: process.pid, cwd: process.cwd(), p6Label: process.env.P6_LABEL ?? null, modelKeyPresent: Object.values(process.env).some(value => ['p3-synthetic-token', 'p4-synthetic-token', 'p6-synthetic-token'].includes(value) || value.startsWith('sidekick-p5-relay-')) });
  process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
  if (role === 'service') {
    const waiting = new Map(); let calls = 0;
    spawn(process.execPath, [process.argv[1], 'child', record, mode], { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' });
    for await (const line of createInterface({ input: process.stdin })) {
      const request = JSON.parse(line);
      if (!('id' in request)) {
        if (request.method === 'notifications/cancelled' && mode.startsWith('recovery-late-') && waiting.has(request.params.requestId)) {
          const id = request.params.requestId;
          note({ type: 'late_attempt', id, isError: mode === 'recovery-late-error' });
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'late-controlled' }], ...(mode === 'recovery-late-error' ? { isError: true } : {}) } }) + '\n', error => { if (!error) note({ type: 'late_written', id }); });
        }
        continue;
      }
      let result;
      if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'controlled-trial', version: '1' } };
      else if (request.method === 'tools/list') result = { tools: [{ name: 'lookup', description: 'Controlled lookup', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] };
      else if (request.method === 'tools/call') {
        calls++;
        note({ type: 'call', name: request.params.name, arguments: request.params.arguments });
        if (mode === 'list-changed') process.stdout.write('{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n');
        if (mode === 'lost' || mode === 'recovery-retry') continue;
        if (mode.startsWith('recovery-late-')) { waiting.set(request.id, true); continue; }
        if (mode === 'recovery-progress') {
          let progress = 0;
          const timer = setInterval(() => {
            note({ type: 'progress', progress: ++progress });
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: request.params._meta.progressToken, progress } }) + '\n');
            if (progress >= 30) clearInterval(timer);
          }, 40);
          continue;
        }
        result = { content: [{ type: 'text', text: 'controlled-text' }], structuredContent: { value: 7 }, ...(mode === 'error' ? { isError: true } : {}) };
        if (mode === 'invalid') result.isError = 'bad';
        if (mode === 'oversized') result.content[0].text = 'x'.repeat(262144);
        if (mode === 'private') result.content[0].text = process.env.CONTROLLED_SECRET;
        if (mode === 'coercion') writeFileSync(marker, 'unexpected call');
        if (mode === 'recovery-budget-at' || mode === 'recovery-budget-over') {
          const target = mode === 'recovery-budget-at' ? 262144 : calls <= 2 ? 200000 : 124289;
          result.content[0].text = '';
          const remaining = target - Buffer.byteLength(JSON.stringify(result));
          result.content[0].text = '合'.repeat(Math.floor(remaining / 3)) + 'x'.repeat(remaining % 3);
          note({ type: 'result_bytes', bytes: Buffer.byteLength(JSON.stringify(result)), characters: JSON.stringify(result).length });
        }
      } else continue;
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
    }
  }
}
