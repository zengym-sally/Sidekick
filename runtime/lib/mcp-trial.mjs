import { randomUUID } from 'node:crypto';
import { McpClient } from '@sidekick/pi-mcp-client';
import { ManagedMcpTransport } from './managed-mcp.mjs';
import { normalizeCatalog } from './mcp-catalog.mjs';
import { canonicalArguments, checkArguments, checkMcpResult, modelToolName } from './mcp-tool-contract.mjs';

export class McpTrial {
  constructor({ runId, directory, cwd, deadline, servers, control, sensitive, onFatal }) {
    Object.assign(this, { runId, directory, cwd, deadline, servers, control, sensitive, onFatal });
    this.sessions = []; this.names = new Set(['read', 'bash']); this.resultBytes = 0; this.catalogBytes = 0; this.toolCount = 0; this.error = null;
  }
  guard(signal) {
    if (this.error || signal?.aborted || Date.now() >= this.deadline) throw new Error(this.error || 'MCP_TIMEOUT');
  }
  fail(code = 'MCP_PROTOCOL') {
    if (!this.error) { this.error = code; this.control.close(); this.onFatal(); }
  }
  beforeToolCall({ toolCall, args }, signal) {
    this.guard(signal);
    if (this.names.has(toolCall.name) && toolCall.name.startsWith('mcp_')) checkArguments(toolCall.arguments, args);
  }
  async connect() {
    const tools = [];
    for (const server of this.servers) {
      this.guard();
      const connectDeadline = Math.min(this.deadline, Date.now() + server.connectTimeoutMs);
      const control = (action, owner) => this.control.request(action, { ...owner, serverId: server.id }, action === 'end' ? this.cleanupDeadline : connectDeadline);
      const transport = new ManagedMcpTransport({ ...server, runId: this.runId, directory: this.directory, runDirectory: this.cwd, deadline: this.deadline, totalDeadline: this.deadline }, { prepare: owner => control('prepare', owner), own: owner => control('owner', owner), end: owner => control('end', owner), callGuard: () => this.guard() });
      const client = new McpClient({ name: 'Sidekick', version: '0.3.0', capabilities: {}, requestTimeoutMs: Math.max(1, connectDeadline - Date.now()) });
      const session = { server, transport, client }; this.sessions.push(session);
      client.onError(() => { this.fail(); transport.fail(); });
      client.onNotification('notifications/tools/list_changed', () => { this.refreshRequired = true; });
      let timer;
      try {
        const discover = async () => {
          await client.connect(transport);
          const catalog = [], cursors = new Set(); let cursor;
          for (let page = 0; page < 64; page++) {
            this.guard();
            const result = await client.request('tools/list', cursor === undefined ? undefined : { cursor }, { timeoutMs: Math.max(1, connectDeadline - Date.now()) });
            if (!result || !Array.isArray(result.tools)) throw new Error('MCP_CATALOG_INVALID');
            catalog.push(...result.tools); if (catalog.length > 64) throw new Error('MCP_CATALOG_INVALID');
            cursor = result.nextCursor;
            if (cursor === undefined || cursor === null || cursor === '') return normalizeCatalog(catalog, this.sensitive);
            if (typeof cursor !== 'string' || Buffer.byteLength(cursor) > 256 || cursors.has(cursor)) throw new Error('MCP_CATALOG_INVALID');
            cursors.add(cursor);
          }
          throw new Error('MCP_CATALOG_INVALID');
        };
        const catalog = await Promise.race([discover(), new Promise((_, reject) => { timer = setTimeout(() => { this.fail('MCP_TIMEOUT'); void transport.close().catch(() => {}); reject(new Error('MCP_TIMEOUT')); }, Math.max(1, connectDeadline - Date.now())); })]);
        this.catalogBytes += Buffer.byteLength(JSON.stringify(catalog)); this.toolCount += catalog.tools.length;
        if (this.catalogBytes > 524288 || this.toolCount > 256) throw new Error('MCP_CATALOG_INVALID');
        const ack = await this.control.request('catalog', { serverId: server.id, catalog }, connectDeadline);
        if (!Array.isArray(ack.mapping) || ack.mapping.length !== catalog.tools.length) throw new Error('MCP_PROTOCOL');
        for (let index = 0; index < catalog.tools.length; index++) {
          const tool = catalog.tools[index], binding = ack.mapping[index], name = modelToolName(server.id, tool.name);
          if (binding.serverId !== server.id || binding.toolName !== tool.name || binding.modelName !== name || !/^[0-9a-f]{64}$/.test(binding.schemaSha256) || this.names.has(name)) throw new Error('MCP_PROTOCOL');
          this.names.add(name);
          tools.push({ name, label: `${server.id}/${tool.name}`, description: tool.description || `MCP ${server.id}/${tool.name}`, parameters: tool.inputSchema, executionMode: 'sequential', execute: (modelCallId, args, signal) => this.call(session, binding, modelCallId, args, signal) });
        }
      } catch (error) {
        this.fail(['MCP_TIMEOUT', 'MCP_CATALOG_INVALID', 'MCP_PRIVATE_OUTPUT'].includes(error?.message) ? error.message : 'MCP_PROTOCOL');
        throw new Error(this.error);
      } finally { clearTimeout(timer); }
    }
    return tools;
  }
  async call(session, binding, modelCallId, args, signal) {
    this.guard(signal);
    const argumentsJson = canonicalArguments(args), callId = randomUUID();
    const controller = new AbortController();
    const deadline = Math.min(this.deadline, Date.now() + session.server.toolTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    try {
      await this.control.request('call_begin', { serverId: binding.serverId, callId, input: { id: callId, modelCallId, modelName: binding.modelName, configurationRevision: session.server.configurationRevision, schemaSha256: binding.schemaSha256, argumentsJson } }, deadline);
      this.guard(combined);
      session.transport.grantCall(binding.toolName, args);
      const raw = await session.client.callTool(binding.toolName, JSON.parse(argumentsJson), { signal: combined, timeoutMs: Math.max(1, deadline - Date.now()) });
      this.guard(combined);
      const checked = checkMcpResult(raw, this.sensitive, this.resultBytes); this.resultBytes += checked.bytes;
      await this.control.request('call_response', { serverId: binding.serverId, callId, result: checked.result }, deadline);
      this.guard(combined);
      return { content: checked.content, ...(raw.structuredContent === undefined ? {} : { structuredContent: raw.structuredContent }), ...(checked.isError ? { isError: true } : {}) };
    } catch (error) {
      this.fail(controller.signal.aborted ? 'MCP_TIMEOUT' : ['MCP_PRIVATE_OUTPUT', 'MCP_RESULT_INVALID'].includes(error?.message) ? error.message : 'MCP_PROTOCOL');
      throw new Error(this.error);
    } finally { clearTimeout(timer); }
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.cleanupDeadline = Date.now() + 5000;
    this.closePromise = (async () => {
      const results = await Promise.allSettled(this.sessions.map(async session => { await session.transport.close(); await session.client.close(); }));
      if (results.some(result => result.status === 'rejected')) { this.fail('MCP_CLEANUP'); throw new Error('MCP_CLEANUP'); }
    })();
    return this.closePromise;
  }
}
