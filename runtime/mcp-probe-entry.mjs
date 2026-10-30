import { McpClient } from '@sidekick/pi-mcp-client';
import { McpTimeoutError } from '@sidekick/pi-jsonrpc';
import { ManagedMcpTransport } from './managed-mcp.mjs';
import { normalizeCatalog } from './mcp-catalog.mjs';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const runId = arg('--run'), hostNonce = arg('--nonce');
let config, transport, fatal = false, stopped = false, buffer = Buffer.alloc(0), total = 0;
const acks = new Map();
const send = frame => new Promise((resolve, reject) => process.stdout.write(JSON.stringify({ ...frame, runId, hostNonce }) + '\n', error => error ? reject(new Error('MCP_PROCESS')) : resolve()));
const shutdown = () => { stopped = true; void transport?.close().catch(() => {}); for (const { reject } of acks.values()) reject(new Error('MCP_PROCESS')); acks.clear(); };
process.stdin.on('end', shutdown); process.stdin.on('error', shutdown); process.stdout.on('error', shutdown);
process.on('SIGTERM', shutdown); process.on('SIGHUP', shutdown);
function requestAck(kind, owner) {
  if (stopped && ['prepare', 'owner'].includes(kind)) return Promise.reject(new Error('MCP_PROCESS'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { acks.delete(kind); reject(new Error('MCP_TIMEOUT')); }, Math.max(1, Math.min(kind !== 'end' ? config.connectDeadline - Date.now() : 5000, config.totalDeadline - Date.now())));
    acks.set(kind, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); }, owner });
    send({ type: kind, ...owner }).catch(reject);
  });
}
async function run(p) {
  let code, catalog, client, timer;
  const deadline = Math.min(p.totalDeadline, Date.now() + p.connectTimeoutMs); config.connectDeadline = deadline;
  try {
    if (p.runId !== runId || p.hostNonce !== hostNonce || !Number.isFinite(p.totalDeadline) || deadline <= Date.now()) throw new Error('MCP_PROTOCOL');
    const sensitive = p.sensitiveNames.map(name => p.env[name]).filter(Boolean);
    transport = new ManagedMcpTransport({ ...p, deadline }, { prepare: intent => requestAck('prepare', intent), own: owner => requestAck('owner', owner), end: owner => requestAck('end', owner) });
    client = new McpClient({ name: 'Sidekick', version: '0.3.0', capabilities: {}, requestTimeoutMs: Math.max(1, deadline - Date.now()) });
    client.onError(() => { fatal = true; transport.fail(); });
    client.onNotification('notifications/tools/list_changed', () => { fatal = true; transport.fail(); });
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { stopped = true; void transport.close().catch(() => {}); reject(new Error('MCP_TIMEOUT')); }, Math.max(1, deadline - Date.now())); });
    const discover = async () => {
      await client.connect(transport);
      let cursor; const cursors = new Set(), tools = [];
      for (let page = 0; page < 64; page++) {
        const result = await client.request('tools/list', cursor === undefined ? undefined : { cursor }, { timeoutMs: Math.max(1, deadline - Date.now()) });
        if (!result || !Array.isArray(result.tools)) throw new Error('MCP_CATALOG_INVALID');
        tools.push(...result.tools); if (tools.length > 64) throw new Error('MCP_CATALOG_INVALID');
        cursor = result.nextCursor;
        if (cursor === undefined || cursor === null || cursor === '') return normalizeCatalog(tools, sensitive);
        if (typeof cursor !== 'string' || Buffer.byteLength(cursor) > 256 || cursors.has(cursor)) throw new Error('MCP_CATALOG_INVALID');
        cursors.add(cursor);
      }
      throw new Error('MCP_CATALOG_INVALID');
    };
    catalog = await Promise.race([discover(), timeout]);
  } catch (error) {
    code = error instanceof McpTimeoutError ? 'MCP_TIMEOUT' : ['MCP_TIMEOUT', 'MCP_CATALOG_INVALID', 'MCP_PRIVATE_OUTPUT'].includes(error?.message) ? error.message : 'MCP_PROTOCOL';
  } finally {
    clearTimeout(timer);
    try { await transport?.close(); } catch { code = 'MCP_CLEANUP'; }
    await client?.close().catch(() => {});
  }
  if (fatal || transport?.fatal) code ||= 'MCP_PROTOCOL';
  if (stopped) code ||= 'MCP_PROCESS';
  try { await send(code ? { type: 'error', code } : { type: 'result', catalog }); } catch {}
  process.stdin.destroy(); process.exitCode = code ? 1 : 0;
}
process.stdin.on('data', chunk => {
  total += chunk.length;
  if (total > 2020000) { fatal = true; shutdown(); return; }
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.includes(10)) {
    const i = buffer.indexOf(10); const line = buffer.subarray(0, i); buffer = buffer.subarray(i + 1);
    if (i + 1 > 2000000) { fatal = true; shutdown(); return; }
    try {
      const frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
      if (!config) { config = frame; void run(frame); }
      else {
        const pending = acks.get(frame.type);
        if (!pending || frame.runId !== runId || frame.hostNonce !== hostNonce || frame.nonce !== pending.owner.nonce || frame.guardian !== pending.owner.guardian || frame.keeper !== pending.owner.keeper) throw new Error();
        acks.delete(frame.type); pending.resolve();
      }
    } catch { fatal = true; shutdown(); }
  }
  if (buffer.length >= 2000000) { fatal = true; shutdown(); }
});
