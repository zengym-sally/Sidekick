import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const [log, mode = 'normal', role = 'service'] = process.argv.slice(2);
if (mode === 'artifact-collision' && role === 'service') writeFileSync('mcp-catalog.json', 'collision-sentinel', { mode: 0o600 });
const record = value => appendFileSync(log, JSON.stringify({ ...value, at: Date.now(), pid: process.pid, ppid: process.ppid, role }) + '\n', { mode: 0o600 });
record({ event: 'started', envKeys: Object.keys(process.env).sort(), auditFdInherited: (() => { try { appendFileSync('/dev/fd/3', 'UNTRUSTED_FD_LEAK'); return true; } catch { return false; } })() });
if (mode === 'large-bootstrap' && role === 'service') record({ event: 'synthetic-env-received', items: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('FILL')).map(([k,v]) => [k, { bytes: Buffer.byteLength(v), sha256: createHash('sha256').update(v).digest('hex') }])) });
process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {});
if (role !== 'grandchild') {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), log, mode, role === 'service' ? 'child' : 'grandchild'], { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore', detached: false });
  child.on('error', () => {});
}
setInterval(() => {}, 1000);
if (role === 'service') {
  const send = frame => process.stdout.write(JSON.stringify(frame) + '\n');
  const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
  const tools = () => {
    if (mode === 'catalog-exact' || mode === 'catalog-plus-one') {
      const tool = { name: 'exact', description: '', inputSchema: { type: 'object' } };
      const overhead = Buffer.byteLength(JSON.stringify({ tools: [tool] })); tool.description = 'x'.repeat(524288 - overhead + (mode === 'catalog-plus-one' ? 1 : 0)); return [tool];
    }
    if (mode === 'schema-exact' || mode === 'schema-plus-one') { const schema = { type: 'object', title: '' }; schema.title = 'x'.repeat(32768 - Buffer.byteLength(JSON.stringify(schema)) + (mode === 'schema-plus-one' ? 1 : 0)); return [{ name: 'schema', inputSchema: schema }]; }
    if (mode === 'large' || mode === 'limit') return Array.from({ length: 16 }, (_, i) => ({ name: `t${i}`, description: 'x'.repeat(mode === 'large' ? 30000 : 32768), inputSchema: { type: 'object' } }));
    return [{ name: process.env.TOOL_NAME || 'lookup', inputSchema: mode === 'ref' ? { type: 'object', $ref: '#/bad' } : { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, ...(mode === 'secret' ? { description: process.env.REFERENCED_SECRET } : {}) }];
  };
  createInterface({ input: process.stdin }).on('line', async line => {
    let frame; try { frame = JSON.parse(line); } catch { return; }
    record({ event: 'request', method: frame.method, cursor: frame.params?.cursor });
    if (frame.method === 'initialize') {
      for (let i = 0; i < 80 && !readFileSync(log, 'utf8').includes('grandchild'); i++) await new Promise(r => setTimeout(r, 25));
      if (mode === 'wait-init') return;
      send(reply(frame.id, { protocolVersion: frame.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'controlled-s33', version: '1' } }));
    } else if (frame.method === 'tools/list') {
      if (mode === 'gate') while (!existsSync(log + '.release')) await new Promise(r => setTimeout(r, 20));
      if (mode === 'wait-list') return;
      if (mode === 'stderr-allowed') process.stderr.write('synthetic-private-stderr-is-discarded\n');
      if (mode === 'slow-pages') await new Promise(r => setTimeout(r, 600));
      if (mode === 'invalid-utf8') process.stdout.write(Buffer.from([0xff, 10]));
      if (mode === 'stderr-overflow') process.stderr.write(Buffer.alloc(2000001, 120));
      if (mode === 'notifications-overflow') for (let i = 0; i < 65; i++) send({ jsonrpc: '2.0', method: 'notifications/message', params: {} });
      if (mode === 'bad-then-valid') process.stdout.write('not-json\n');
      if (mode === 'oversize-then-valid') process.stdout.write('x'.repeat(1048577) + '\n');
      if (mode === 'unknown-response') send(reply(9999, {}));
      const result = frame.params?.cursor ? { tools: [{ name: 'second', inputSchema: { type: 'object' } }] } : { tools: tools(), ...(['normal', 'slow-pages', 'duplicate-tool'].includes(mode) ? { nextCursor: 'page-2' } : {}) };
      if (mode === 'cycle') result.nextCursor = 'cycle';
      if (mode === 'duplicate-tool' && frame.params?.cursor) result.tools[0].name = 'lookup';
      if (mode === 'pages-exact' || mode === 'pages-plus-one') { const n = Number(frame.params?.cursor || 0); result.tools = []; if (n < (mode === 'pages-exact' ? 63 : 64)) result.nextCursor = String(n + 1); }
      if (mode === 'changed') send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      send(reply(frame.id, result));
      if (mode === 'tail-fence') {
        while (!existsSync(log + '.write-tail')) await new Promise(r => setTimeout(r, 10));
        await new Promise(r => process.stdout.write('bad-tail\n', r)); record({ event: 'tail-written' });
      }
      if (mode === 'duplicate-response') send(reply(frame.id, result));
      if (mode === 'tail-bad') process.stdout.write('bad-tail\n');
      if (mode === 'tail-incomplete') process.stdout.write('{incomplete');
    } else if (frame.method === 'tools/call') send(reply(frame.id, { content: [] }));
  });
  process.stdin.on('end', () => {});
}
