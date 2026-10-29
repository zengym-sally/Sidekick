import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, createAssistantMessageEventStream, Type } from '@earendil-works/pi-ai';
import { stream as openAIStream, streamSimple as openAISimple } from '@earendil-works/pi-ai/api/openai-completions';
import { McpClient, StdioTransport, StreamableHttpTransport } from '@earendil-works/pi-mcp';
import { createBashTool } from '@sidekick/pi-bash';
import { createReadTool } from '@sidekick/pi-read';
import { loadSkills } from '@sidekick/pi-skills';
import { isSyntheticFollowupBatch } from './probe-contract.mjs';

const bundleDirectory = dirname(fileURLToPath(import.meta.url));
const toolPath = `${bundleDirectory}:/usr/bin:/bin`;

if (process.argv[2] === '--mcp-fixture') {
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line);
    if (!('id' in message)) continue;
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 's0-bundled', version: '1' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }
        : { content: [{ type: 'text', text: 'bundled-mcp-roundtrip' }] };
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
  }
} else if (process.argv[2] === '--model-env') {
  let stage = 'configuration';
  try {
    process.loadEnvFile(process.argv[3]);
    const key = process.env.DEEPSEEK_API_KEY;
    const id = process.env.DEEPSEEK_MODEL_ID;
    const baseUrl = process.env.DEEPSEEK_BASE_URL;
    if (!key || !id || !baseUrl) throw new Error('Missing model configuration');
    stage = 'provider';
    const model = { id, name: id, api: 'openai-completions', provider: 'sidekick-s0', baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 };
    const models = createModels();
    models.setProvider(createProvider({ id: model.provider, baseUrl, models: [model], auth: { apiKey: { name: 'Probe credential', resolve: async () => ({ auth: { apiKey: key } }) } }, api: { stream: openAIStream, streamSimple: openAISimple } }));
    const skill = join(bundleDirectory, 'skills/s0-reader');
    const agent = new Agent({
      initialState: { model, tools: [createReadTool(skill), createBashTool(skill, { shellPath: '/bin/bash', exposeSessionEnvironment: false, spawnHook: (context) => ({ ...context, env: { PATH: toolPath } }) })], systemPrompt: 'You are Sidekick organizer running a synthetic integration probe. First use read with path SKILL.md and then read with path references/context.md. Then use bash with exactly the command /bin/bash scripts/echo.sh. Return JSON only: {"candidates":[{"title":"...","kind":"followup","dueExpression":"Friday","followupExpression":"today","evidence":"exact quotation of the delivery and follow-up clause"}]}. Preserve distinct delivery and follow-up dates. Do not modify business data or execute other scripts.' },
      streamFn: (selected, context, options) => models.streamSimple(selected, context, { ...options, maxTokens: 1024 }),
    });
    const tools = [];
    const argumentsByCall = new Map();
    const proof = { skillRead: false, referenceRead: false, expectedScriptExecuted: false };
    agent.subscribe((event) => {
      if (event.type === 'tool_execution_start') argumentsByCall.set(event.toolCallId, event.args);
      if (event.type === 'tool_execution_end') {
        tools.push({ tool: event.toolName, error: event.isError });
        if (event.isError) return;
        const args = argumentsByCall.get(event.toolCallId) || {};
        const text = (Array.isArray(event.result?.content) ? event.result.content : []).filter((block) => block.type === 'text').map((block) => block.text).join('');
        if (event.toolName === 'read' && typeof args.path === 'string') {
          if (resolve(skill, args.path) === join(skill, 'SKILL.md') && text.includes('name: s0-reader')) proof.skillRead = true;
          if (resolve(skill, args.path) === join(skill, 'references/context.md') && text.includes('delivery is on Friday; follow-up is today')) proof.referenceRead = true;
        }
        if (event.toolName === 'bash' && args.command?.trim() === '/bin/bash scripts/echo.sh' && text.trim() === 's0-skill-script') proof.expectedScriptExecuted = true;
      }
    });
    const timer = setTimeout(() => agent.abort(), 120000);
    const started = performance.now();
    try {
      stage = 'model-request';
      await agent.prompt('Use the complete s0-reader fixture skill in the current tool directory. Produce one follow-up candidate from its context.');
      if (agent.state.errorMessage) {
        const known = [['__dirname', 'BUNDLE_DIRNAME'], ['Dynamic require', 'BUNDLE_REQUIRE'], ['ENOENT', 'BUNDLE_ASSET'], ['certificate', 'TLS_CERTIFICATE'], ['401', 'MODEL_AUTH'], ['fetch failed', 'MODEL_NETWORK']].find(([text]) => agent.state.errorMessage.includes(text));
        throw new Error(known?.[1] || 'MODEL_SERVICE');
      }
      stage = 'result-validation';
      const last = agent.state.messages.findLast((message) => message.role === 'assistant');
      const text = last.content.filter((block) => block.type === 'text').map((block) => block.text).join('').replace(/^```(?:json)?\s*|\s*```$/g, '');
      const result = JSON.parse(text);
      if (!isSyntheticFollowupBatch(result) || !Object.values(proof).every(Boolean)) throw new Error('Model probe result did not match the fixture');
      process.stdout.write(JSON.stringify({ status: 'passed', modelId: id, milliseconds: Math.round(performance.now() - started), syntheticInput: true, bundledRuntime: true, strictSampleContract: true, proof, tools, candidates: 1, businessWrites: 0 }));
    } finally { clearTimeout(timer); }
  } catch (error) {
    const category = ['BUNDLE_DIRNAME', 'BUNDLE_REQUIRE', 'BUNDLE_ASSET', 'TLS_CERTIFICATE', 'MODEL_AUTH', 'MODEL_NETWORK', 'MODEL_SERVICE'].includes(error.message) ? error.message : (error.code || error.name);
    process.stderr.write(JSON.stringify({ status: 'failed', stage, category, frames: stage === 'provider' ? String(error.stack || '').split('\n').slice(1, 4) : undefined, detailsWithheld: true }));
    process.exitCode = 1;
  }
} else {
  const timer = setTimeout(() => process.exit(1), 15000);
  const cwd = await mkdtemp(join(tmpdir(), 'sidekick-bundled-'));
  const client = new McpClient({ name: 'sidekick-s0-bundled', version: '0', requestTimeoutMs: 2000 });
  const httpClient = new McpClient({ name: 'sidekick-s0-http', version: '0', requestTimeoutMs: 2000 });
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') { response.writeHead(405); response.end(); return; }
    if (request.method === 'DELETE') { response.writeHead(200); response.end(); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    if (!('id' in message)) { response.writeHead(202); response.end(); return; }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 's0-loopback', version: '1' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }
        : { content: [{ type: 'text', text: 'bundled-http-roundtrip' }] };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  try {
    const skills = loadSkills({ cwd, agentDir: join(cwd, 'empty-agent'), skillPaths: [process.argv[2]], includeDefaults: false });
    if (skills.skills.length !== 1) throw new Error('controlled skill not found');
    const read = await createReadTool(skills.skills[0].baseDir).execute('read', { path: 'references/context.md' });
    const bash = await createBashTool(cwd, {
      shellPath: '/bin/bash', exposeSessionEnvironment: false,
      spawnHook: (context) => ({ ...context, env: { PATH: toolPath } }),
    }).execute('echo', { command: 'printf bundled-bash-roundtrip', timeout: 2 });
    const cliFromBash = await createBashTool(cwd, { shellPath: '/bin/bash', exposeSessionEnvironment: false, spawnHook: (context) => ({ ...context, env: { PATH: toolPath } }) }).execute('cli-version', { command: 'lark-cli --version', timeout: 3 });
    if (cliFromBash.isError || !cliFromBash.content[0].text.includes('lark-cli version 1.0.98')) throw new Error('Bash could not resolve the bundled CLI');
    await client.connect(new StdioTransport({ command: process.execPath, args: [process.argv[1], '--mcp-fixture'], inheritEnv: false, env: { PATH: '/usr/bin:/bin' } }));
    const result = await client.callTool('echo', {});
    let mcpAgentCalls = 0;
    const mcpTool = (await client.listTools())[0];
    const fixtureModel = { id: 's0-fixture', name: 'Controlled fixture', api: 'faux', provider: 'fixture', baseUrl: '', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const toolAgent = new Agent({
      initialState: { model: fixtureModel, tools: [{ name: 'mcp_s0_echo', label: 'Synthetic echo', description: 'S0 controlled MCP tool', parameters: Type.Unsafe(mcpTool.inputSchema), execute: async (_id, args, signal) => {
        const called = await client.callTool(mcpTool.name, args, { signal });
        if (called.content[0].text !== 'bundled-mcp-roundtrip') throw new Error('MCP AgentTool result mismatch');
        mcpAgentCalls += 1;
        return { content: called.content, details: {} };
      } }] },
      streamFn: (_model, context) => {
        const done = context.messages.some((message) => message.role === 'toolResult');
        const message = { role: 'assistant', api: 'faux', provider: 'fixture', model: 's0-fixture', timestamp: Date.now(), stopReason: done ? 'stop' : 'toolUse', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, content: done ? [{ type: 'text', text: 'MCP tool loop complete' }] : [{ type: 'toolCall', id: 'mcp-call-1', name: 'mcp_s0_echo', arguments: {} }] };
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => stream.push({ type: 'done', reason: message.stopReason, message }));
        return stream;
      },
    });
    await toolAgent.prompt('Invoke the controlled MCP fixture.');
    if (mcpAgentCalls !== 1) throw new Error('MCP tool was not executed through AgentTool');
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    await httpClient.connect(new StreamableHttpTransport({ url: `http://127.0.0.1:${server.address().port}/mcp` }));
    await httpClient.listTools();
    const httpResult = await httpClient.callTool('echo', {});
    if (!read.content[0].text.includes('delivery is on Friday') || bash.content[0].text !== 'bundled-bash-roundtrip' || result.content[0].text !== 'bundled-mcp-roundtrip') {
      throw new Error('bundled result mismatch');
    }
    if (httpResult.content[0].text !== 'bundled-http-roundtrip') throw new Error('bundled HTTP result mismatch');
    process.stdout.write(JSON.stringify({ status: 'passed', node: process.version, arch: process.arch, agentAvailable: typeof Agent === 'function', skillCount: skills.skills.length, read: true, bash: true, bashFindsBundledCli: true, mcpStdio: true, mcpStreamableHttp: true, mcpAgentToolRoundtrip: true, externalModel: false, businessWrites: 0 }));
  } catch {
    process.stderr.write('Bundled Runtime probe failed.');
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await client.close();
    await httpClient.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(cwd, { recursive: true, force: true });
  }
}
