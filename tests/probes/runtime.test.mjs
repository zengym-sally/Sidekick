import assert from 'node:assert/strict';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../vendor/pi');
const pi = (path) => import(pathToFileURL(join(source, path)));
const [{ Agent }, ai, { openAICompletionsApi }, mcp, { createBashTool }, { createReadTool }, skills] = await Promise.all([
  pi('packages/agent/dist/index.js'), pi('packages/ai/dist/index.js'),
  pi('packages/ai/dist/api/openai-completions.lazy.js'), pi('packages/mcp/dist/index.js'),
  pi('packages/coding-agent/dist/core/tools/bash.js'), pi('packages/coding-agent/dist/core/tools/read.js'),
  pi('packages/coding-agent/dist/core/skills.js'),
]);

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'sidekick-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const plain = (result) => result.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
const bashAt = (cwd) => createBashTool(cwd, {
  shellPath: '/bin/bash', exposeSessionEnvironment: false,
  spawnHook: (context) => ({ ...context, env: { PATH: '/usr/bin:/bin', S0_VALUE: 'fixture-value' } }),
});

test('source packages come from the same pinned workspace', async () => {
  for (const name of ['agent', 'ai', 'mcp', 'coding-agent']) {
    const meta = JSON.parse(await readFile(join(source, 'packages', name, 'package.json'), 'utf8'));
    assert.equal(meta.version, '1.4.0');
  }
  assert.equal(typeof Agent, 'function');
});

test('Bash executes scripts with cwd, environment, streaming and nonzero status', async (t) => {
  const root = await temporary(t);
  const tool = bashAt(root);
  const updates = [];
  const result = await tool.execute('bash-success', {
    command: 'pwd; printf "%s\\n" "$S0_VALUE"; sleep 0.2; printf done', timeout: 2,
  }, undefined, (event) => updates.push(event));
  assert.match(plain(result), /fixture-value/);
  assert.match(plain(result), /done/);
  assert.ok(plain(result).includes(await import('node:fs/promises').then((fs) => fs.realpath(root))));
  assert.ok(updates.some((event) => plain(event).includes('fixture-value')));
  const failed = await tool.execute('bash-failure', { command: 'exit 7', timeout: 2 });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent.exit_code, 7);
});

for (const mode of ['timeout', 'cancel']) {
  test(`Bash ${mode} terminates its child process group`, async (t) => {
    const root = await temporary(t);
    const controller = new AbortController();
    const tool = bashAt(root);
    let childPid;
    const task = tool.execute(`bash-${mode}`, {
      command: 'sleep 30 & child=$!; printf "child=%s\\n" "$child"; wait', timeout: mode === 'timeout' ? 0.5 : 5,
    }, controller.signal, (event) => {
      const match = plain(event).match(/child=(\d+)/);
      if (match) {
        childPid = Number(match[1]);
        if (mode === 'cancel') controller.abort();
      }
    });
    await assert.rejects(task, mode === 'timeout' ? /timed out/ : /aborted/);
    assert.ok(childPid, 'Child PID was observed before termination');
    for (let attempt = 0; attempt < 20; attempt++) {
      try { process.kill(childPid, 0); } catch (error) {
        assert.equal(error.code, 'ESRCH');
        return;
      }
      await new Promise((done) => setTimeout(done, 25));
    }
    assert.fail(`Child ${childPid} outlived its tool task`);
  });
}

test('Skills load explicit complete packages, relative Read/Bash, rescan and collisions', async (t) => {
  const root = await temporary(t);
  await cp(join(here, 'fixtures/skills'), join(root, 'skills'), { recursive: true });
  const options = { cwd: root, agentDir: join(root, 'empty-agent'), skillPaths: [join(root, 'skills')], includeDefaults: false };
  const first = skills.loadSkills(options);
  assert.deepEqual(first.skills.map((skill) => skill.name), ['s0-reader']);
  const read = await createReadTool(first.skills[0].baseDir).execute('read-reference', { path: 'references/context.md' });
  assert.match(plain(read), /delivery is on Friday; follow-up is today/);
  const run = await bashAt(first.skills[0].baseDir).execute('run-skill', { command: '/bin/bash scripts/echo.sh', timeout: 2 });
  assert.equal(plain(run).trim(), 's0-skill-script');
  const originalPrompt = skills.formatSkillsForPrompt(first.skills);
  await writeFile(join(root, 'skills/s0-reader/SKILL.md'), '---\nname: s0-reader\ndescription: Updated fixture description.\n---\nUpdated.\n');
  assert.match(skills.formatSkillsForPrompt(skills.loadSkills(options).skills), /Updated fixture description/);
  assert.ok(!originalPrompt.includes('Updated fixture description'));
  await mkdir(join(root, 'collision'), { recursive: true });
  await cp(join(root, 'skills/s0-reader'), join(root, 'collision/s0-reader'), { recursive: true });
  const duplicate = skills.loadSkills({ ...options, skillPaths: [...options.skillPaths, join(root, 'collision')] });
  assert.ok(duplicate.diagnostics.some((item) => item.type === 'collision'));
});

test('MCP stdio discovers and calls tools, distinguishes errors, cancels and closes', async (t) => {
  const transport = new mcp.StdioTransport({ command: process.execPath, args: [join(here, 'fixtures/mcp-stdio.mjs')], inheritEnv: false, env: { PATH: '/usr/bin:/bin' } });
  const client = new mcp.McpClient({ name: 'sidekick-s0', version: '0.0.0', requestTimeoutMs: 500 });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools())[0].name, 'echo');
  assert.equal(plain(await client.callTool('echo', { text: 'stdio-roundtrip' })), 'stdio-roundtrip');
  assert.equal((await client.callTool('error')).isError, true);
  await assert.rejects(client.callTool('slow'), /timed out/i);
  const controller = new AbortController();
  const cancelled = client.callTool('slow', {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled);
  const pid = transport.pid;
  assert.ok(pid);
  await client.close();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('MCP reports missing executable instead of a successful connection', async () => {
  const client = new mcp.McpClient({ name: 'sidekick-s0-missing', version: '0', requestTimeoutMs: 500 });
  try {
    await assert.rejects(client.connect(new mcp.StdioTransport({ command: '/sidekick-s0/nonexistent' })));
  } finally { await client.close(); }
});

async function listen(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('MCP Streamable HTTP initializes, invokes, rejects 401 and establishes a fresh connection', async (t) => {
  const origin = await listen(t, async (request, response) => {
    if (request.url === '/unauthorized') { response.writeHead(401); response.end(); return; }
    if (request.method === 'GET') { response.writeHead(405); response.end(); return; }
    if (request.method === 'DELETE') { response.writeHead(200); response.end(); return; }
    let data = '';
    for await (const chunk of request) data += chunk;
    const message = JSON.parse(data);
    if (!('id' in message)) { response.writeHead(202); response.end(); return; }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 's0-http', version: '1' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
        : { content: [{ type: 'text', text: message.params.arguments.text }] };
    response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's0-session' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = new mcp.McpClient({ name: 'sidekick-s0-http', version: '0', requestTimeoutMs: 1000 });
    try {
      await client.connect(new mcp.StreamableHttpTransport({ url: `${origin}/mcp` }));
      assert.equal((await client.listTools())[0].name, 'echo');
      assert.equal(plain(await client.callTool('echo', { text: 'http-roundtrip' })), 'http-roundtrip');
    } finally { await client.close(); }
  }
  const unauthorized = new mcp.McpClient({ name: 's0-401', version: '0', requestTimeoutMs: 1000 });
  try {
    await assert.rejects(unauthorized.connect(new mcp.StreamableHttpTransport({ url: `${origin}/unauthorized` })));
  } finally { await unauthorized.close(); }
});

test('Agent traverses a real HTTP streaming adapter and Bash tool loop using a controlled model fixture', async (t) => {
  const requests = [];
  const origin = await listen(t, async (request, response) => {
    let data = '';
    for await (const chunk of request) data += chunk;
    const payload = JSON.parse(data);
    requests.push(payload);
    const hasToolResult = payload.messages.some((message) => message.role === 'tool');
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = hasToolResult
      ? { content: '{"candidates":[{"title":"Synthetic probe task"}]}' }
      : { tool_calls: [{ index: 0, id: 's0-tool', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'printf s0-agent-tool', timeout: 2 }) } }] };
    response.write(`data: ${JSON.stringify({ id: 's0-completion', object: 'chat.completion.chunk', model: 's0-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ id: 's0-completion', object: 'chat.completion.chunk', model: 's0-model', choices: [{ index: 0, delta: {}, finish_reason: hasToolResult ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
  });
  const model = { id: 's0-model', name: 'Controlled fixture', api: 'openai-completions', provider: 's0-fixture', baseUrl: `${origin}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 256 };
  const models = ai.createModels();
  models.setProvider(ai.createProvider({ id: model.provider, baseUrl: model.baseUrl, models: [model], auth: { apiKey: { name: 'Synthetic only', resolve: async () => ({ auth: { apiKey: 's0-not-a-real-secret' } }) } }, api: openAICompletionsApi() }));
  const root = await temporary(t);
  const agent = new Agent({ initialState: { model, systemPrompt: 'S0 controlled test only.', tools: [bashAt(root)] }, streamFn: models.streamSimple.bind(models) });
  const events = [];
  agent.subscribe((event) => events.push(event.type));
  await agent.prompt('Run the controlled tool and return a synthetic candidate.');
  assert.ok(events.includes('tool_execution_end'));
  assert.ok(events.includes('message_update'));
  assert.equal(requests.length, 2);
  const result = agent.state.messages.findLast((message) => message.role === 'assistant');
  assert.equal(JSON.parse(result.content.find((block) => block.type === 'text').text).candidates[0].title, 'Synthetic probe task');
});
