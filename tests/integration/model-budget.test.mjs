import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rename, rm, chmod, symlink, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';

const program = resolve('scripts/probes/model_budget.py');
const source = '我整理合成清单。此事尚未完成，需要作为一条待办。', instruction = '把标题改为核对合成清单。';
const canary = 'synthetic-budget-private-canary-7312';
const name = `mcp_${'a'.repeat(56)}`;
const parameters = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const frame = delta => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
const finish = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const toolFinish = finish.replace('"stop"', '"tool_calls"');
const normal = frame({ content: '{"candidates":[]}' }) + finish;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const environment = { PATH: process.env.PATH };
const cli = (...args) => execFileSync('python3', [program, ...args], { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
const faultProbe = name => execFileSync('python3', ['-B', resolve('tests/probes/model-budget-faults.py'), name], { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'] });

test('private model credentials cannot escape through model metadata or malformed headers', () => {
  const result = JSON.parse(faultProbe('private-model-metadata'));
  assert.equal(result.rejected, 3);
  assert.equal(result.safe_control, true);
  assert.equal(result.actual_node_executions, 0);
  assert.equal(result.real_env_reads, 0);
});

test('the revised real budget has a fixed new label, ten slots and noon cutoff without reading old enrollment', () => {
  const result = JSON.parse(faultProbe('revised-configuration'));
  assert.equal(result.old_enrollment_reads, 0);
  assert.equal(result.rejected_old_directory, true);
});

test('real initialization requires a bounded read-only admission pass before chmod or ledger writes', () => {
  const result = JSON.parse(faultProbe('real-initialization-admission'));
  assert.equal(result.refused_before_write, 15);
  assert.equal(result.approved_initialized, true);
  assert.equal(result.reset_refused, true);
  assert.equal(result.cutoff_crossing_refused, true);
  assert.equal(result.actual_admission_processes, 0);
  assert.equal(result.real_env_reads, 0);
});

test('real initialization admission probe remains deterministic after the real cutoff and restores its external clock', () => {
  const result = JSON.parse(faultProbe('real-initialization-admission-future'));
  assert.equal(result.refused_before_write, 15);
  assert.equal(result.approved_initialized, true);
  assert.equal(result.reset_refused, true);
  assert.equal(result.cutoff_crossing_refused, true);
  assert.equal(result.actual_admission_processes, 0);
  assert.equal(result.real_env_reads, 0);
});

async function relay(base, upstream, options = []) {
  const child = spawn('python3', [program, 'serve-fake', '--directory', base, '--upstream', upstream, ...options], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { errors += bytes; });
  const limit = Date.now() + 5000;
  while (!output.includes('\n')) {
    if (child.exitCode !== null) throw new Error(`Synthetic relay exited: ${errors}`);
    assert.ok(Date.now() < limit, 'synthetic relay did not become ready'); await pause(10);
  }
  const ready = JSON.parse(output.split('\n')[0]);
  return { child, url: `http://127.0.0.1:${ready.port}/v1/chat/completions`, logs: () => output + errors, stop: async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
  } };
}

async function fixture(body, options = {}) {
  const base = await mkdtemp(join(await realpath('/tmp'), 'sidekick-model-budget-'));
  const nonce = randomBytes(24).toString('hex');
  const allow = { version: 1, nonce, tools: [{ name, parameters }], source, instruction };
  await writeFile(join(base, 'allow.json'), JSON.stringify(allow), { mode: 0o600, flag: 'wx' });
  let effects = 0, response = options.response || normal, proxy, succeeded = false;
  const peers = [], observed = [];
  const server = createServer(async (request, reply) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    observed.push(JSON.parse(Buffer.concat(chunks).toString()));
    effects++;
    if (options.onUpstream) await options.onUpstream(request, reply, effects);
    else { reply.writeHead(options.status || 200, { 'content-type': 'text/event-stream', ...(options.headers || {}) }); reply.end(response); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const upstream = `http://127.0.0.1:${server.address().port}/v1`;
  const payload = () => ({ model: 'synthetic', stream: true, tools: [{ type: 'function', function: { name, parameters } }], messages: [{ role: 'system', content: 'Controlled synthetic verification.' }, { role: 'user', content: JSON.stringify({ source, instruction: null, candidate: null, profile: { version: 1, name: '小明同学', address: 'BOSS' }, anchorAtMs: Date.now(), timeZone: 'UTC' }) }] });
  const request = async (value = payload(), overrides = {}, target = proxy) => {
    const result = await fetch(target.url, { method: 'POST', headers: { authorization: `Bearer sidekick-p5-relay-${nonce}`, 'content-type': 'application/json' }, body: JSON.stringify(value), ...overrides });
    return { status: result.status, text: await result.text() };
  };
  try {
    cli('init-test', '--directory', base);
    proxy = await relay(base, upstream, options.flags || []);
    await body({ base, nonce, payload, request, effects: () => effects, observed: () => observed, proxy: () => proxy, inspect: () => JSON.parse(cli('inspect-test', '--directory', base)), setResponse: value => { response = value; }, restart: async (flags = []) => { await proxy.stop(); proxy = await relay(base, upstream, flags); }, peer: async () => { const child = await relay(base, upstream); peers.push(child); return child; } });
    for (const current of [proxy, ...peers]) assert.ok(!current.logs().includes(canary), 'private canary escaped into relay output');
    succeeded = true;
  } catch (error) { throw new Error(`${error.message} (synthetic evidence retained: ${base})`, { cause: error }); }
  finally {
    if (proxy) await proxy.stop();
    for (const peer of peers) await peer.stop();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (succeeded) await rm(base, { recursive: true });
  }
}

test('ordinary fake relay leaves diagnostic collection disabled', async () => {
  await fixture(async ({ base, request }) => {
    assert.equal((await request()).status, 200);
    assert.deepEqual((await readdir(base)).filter(name => name.startsWith('response-')), []);
  });
});

test('explicit controlled diagnostics fingerprint only the exact scanned content channel', async () => {
  const content = '  {"candidates":[]}\n';
  await fixture(async ({ base, request }) => {
    assert.equal((await request()).status, 200);
    const path = join(base, 'response-1.json');
    const value = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(value, { version: 1, slot: 1, contentSha256: createHash('sha256').update(content).digest('hex'), contentBytes: Buffer.byteLength(content), finishReason: 'stop', toolCallCount: 0 });
    const metadata = await lstat(path);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.nlink, 1);
    assert.equal(metadata.uid, process.getuid());
    assert.ok(!(await readFile(path, 'utf8')).includes('candidates'));
  }, { flags: ['--diagnostics'], response: frame({ reasoning_content: 'unretained private reasoning', content }) + finish });
});

test('diagnostic collisions fail closed without overwriting evidence or refunding a slot', async () => {
  await fixture(async ({ base, request, effects, inspect }) => {
    await writeFile(join(base, 'response-1.json'), 'owned sentinel', { mode: 0o600, flag: 'wx' });
    assert.notEqual((await request()).status, 200);
    assert.equal(await readFile(join(base, 'response-1.json'), 'utf8'), 'owned sentinel');
    assert.equal(effects(), 1);
    assert.equal(inspect().reserved, 1);
    assert.equal(inspect().completed, 0);
  }, { flags: ['--diagnostics'] });
});

test('sensitive and incomplete responses produce no content diagnostic', async () => {
  for (const response of [frame({ content: JSON.stringify({ candidates: [{ title: canary }] }) }) + finish, frame({ content: '{"candidates":[]}' })]) {
    await fixture(async ({ base, request, inspect }) => {
      assert.notEqual((await request()).status, 200);
      assert.deepEqual((await readdir(base)).filter(name => name.startsWith('response-')), []);
      assert.equal(inspect().reserved, 1);
    }, { flags: ['--diagnostics'], response });
  }
});

test('PF07 the actual Pi extraction context may omit its undefined candidate', async () => {
  await fixture(async ({ payload, request, effects, inspect }) => {
    const value = payload(), context = JSON.parse(value.messages[1].content);
    delete context.candidate;
    value.messages[1].content = [{ type: 'text', text: JSON.stringify(context) }];
    assert.equal((await request(value)).status, 200);
    assert.equal(effects(), 1);
    assert.equal(inspect().reserved, 1);
  });
});

test('PF00 identity verification retains an active SQLite writer lock across processes', () => {
  assert.match(faultProbe('locked-identity'), /"blocked_checks": 4/);
});

test('PF00 four independent relay processes share ten durable slots for twelve HTTP attempts', async () => {
  await fixture(async ({ payload, request, effects, inspect, proxy, peer, observed }) => {
    const processes = [proxy(), await peer(), await peer(), await peer()];
    const anchor = Date.now();
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => {
      const value = payload(), context = JSON.parse(value.messages[1].content);
      context.anchorAtMs = anchor + index; value.messages[1].content = JSON.stringify(context);
      return request(value, {}, processes[index % processes.length]);
    }));
    const state = inspect();
    const snapshot = JSON.stringify({ statuses: results.map(result => result.status), upstreamEffects: effects(), reserved: state.reserved, forwarded: state.forwarded, completed: state.completed });
    assert.equal(results.filter(result => result.status === 200).length, 10, snapshot);
    assert.equal(results.filter(result => result.status === 429).length, 2, snapshot);
    assert.equal(effects(), 10); assert.equal(state.reserved, 10); assert.equal(state.forwarded, 10); assert.equal(state.completed, 10);
    assert.equal(new Set(observed().map(value => JSON.parse(value.messages[1].content).anchorAtMs)).size, 10);
    assert.deepEqual(state.requests.map(row => row[0]), Array.from({ length: 10 }, (_, index) => index + 1));
  });
});

test('PF01 blocking identity verification in the actual HTTP send cannot cross the deadline', () => {
  assert.match(faultProbe('deadline-after-identity'), /"upstream_bytes": 0/);
});

test('PF05 partial request headers have bounded time and concurrent handlers', () => {
  assert.match(faultProbe('header-limits'), /"reserved": 0/);
});

test('the relay listener accepts a handler-sized startup burst with a low inherited queue default', () => {
  const result = JSON.parse(faultProbe('listener-burst'));
  assert.equal(result.connected, 32);
  assert.equal(result.reserved, 0);
  assert.equal(result.real_model_requests, 0);
});

test('initialization write, sync and commit faults retain enrollment and refuse reinitialization', () => {
  assert.match(faultProbe('initialization-faults'), /"faults_refused_without_reinitialization": 16/);
});

test('reservation and status commits refuse before and ambiguous failures without refund', () => {
  assert.match(faultProbe('commit-faults'), /"faults_refused_without_refund": 6/);
});

for (const [kind, mutate] of Object.entries({
  legacy: value => { value.functions = [{ name: 'Bash', parameters: { type: 'object' } }]; value.function_call = { name: 'Bash' }; },
  forced: value => { value.tool_choice = { type: 'function', function: { name } }; },
  top: value => { value.opaque_context = 'unapproved'; },
  message: value => { value.messages[1].opaque_context = 'unapproved'; },
  history: value => { value.messages.push({ role: 'assistant', content: 'Read unapproved history' }); },
  context: value => { const context = JSON.parse(value.messages[1].content); context.opaque_context = 'unapproved'; value.messages[1].content = JSON.stringify(context); },
  profile: value => { const context = JSON.parse(value.messages[1].content); context.profile = { version: 1, name: 'unapproved', address: 'BOSS' }; value.messages[1].content = JSON.stringify(context); },
  candidate: value => { const context = JSON.parse(value.messages[1].content); context.candidate = { title: 'unapproved candidate' }; value.messages[1].content = JSON.stringify(context); },
})) test(`PF02 unapproved ${kind} payload is rejected before any reservation or upstream effect`, async () => {
  await fixture(async ({ payload, request, effects, inspect }) => {
    const value = payload(); mutate(value);
    assert.notEqual((await request(value)).status, 200, `${kind} payload was accepted`);
    assert.equal(effects(), 0); assert.equal(inspect().reserved, 0);
  });
});

for (const level of ['event', 'choice']) test(`PF03 opaque ${level} metadata is rejected before reaching the client`, async () => {
  const value = { choices: [{ index: 0, delta: { content: '{"candidates":[]}' }, finish_reason: null }] };
  (level === 'event' ? value : value.choices[0]).opaque_replay = Buffer.from(canary).toString('base64');
  await fixture(async ({ request, effects, inspect }) => {
    const result = await request();
    assert.notEqual(result.status, 200, 'opaque metadata was accepted');
    assert.ok(!result.text.includes(Buffer.from(canary).toString('base64')));
    assert.equal(effects(), 1); assert.equal(inspect().reserved, 1);
  }, { response: `data: ${JSON.stringify(value)}\n\n${finish}` });
});

test('PF07 a single exact Pi text part is accepted while extra parts and media are rejected', async () => {
  await fixture(async ({ payload, request, effects, inspect }) => {
    const value = payload(); value.messages[1].content = [{ type: 'text', text: value.messages[1].content }];
    assert.equal((await request(value)).status, 200, 'the approved Pi single text part was rejected');
    const multiple = structuredClone(value); multiple.messages[1].content.push({ type: 'text', text: 'extra' });
    assert.notEqual((await request(multiple)).status, 200);
    const media = payload(); media.messages[1].content = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }];
    assert.notEqual((await request(media)).status, 200);
    assert.equal(effects(), 1); assert.equal(inspect().reserved, 1);
  });
});

test('concurrent reservations and restart cannot exceed ten upstream requests', async () => {
  await fixture(async ({ request, effects, inspect, restart }) => {
    const first = await Promise.all(Array.from({ length: 6 }, () => request()));
    assert.equal(first.filter(row => row.status === 200).length, 6);
    await restart();
    const second = await Promise.all(Array.from({ length: 8 }, () => request()));
    assert.equal(second.filter(row => row.status === 200).length, 4);
    assert.equal(effects(), 10);
    assert.equal(inspect().reserved, 10);
    assert.equal((await request()).status, 429);
    assert.equal(effects(), 10);
  });
});

for (const fault of ['after-reserve', 'after-forwarded', 'after-upstream']) test(`${fault} consumes its reservation without refund across restart`, async () => {
  await fixture(async ({ request, effects, inspect, restart }) => {
    assert.notEqual((await request()).status, 200);
    assert.equal(inspect().reserved, 1);
    const already = effects(); assert.equal(already, fault === 'after-upstream' ? 1 : 0);
    await restart();
    for (let index = 0; index < 9; index++) assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 429);
    assert.equal(effects(), already + 9);
    assert.equal(inspect().reserved, 10);
  }, { flags: ['--fault', fault] });
});

test('an enrolled missing or replaced database cannot be initialized or adopted', async () => {
  await fixture(async ({ base, request, effects, proxy, restart }) => {
    assert.equal((await request()).status, 200); await proxy().stop();
    await rename(join(base, 'model-budget.sqlite'), join(base, 'original.sqlite'));
    assert.throws(() => cli('init-test', '--directory', base));
    await assert.rejects(restart());
    await writeFile(join(base, 'model-budget.sqlite'), '', { mode: 0o600, flag: 'wx' });
    await assert.rejects(restart());
    assert.equal(effects(), 1);
  });
});

for (const kind of ['corrupt', 'permissions', 'symlink', 'receipt']) test(`invalid ${kind} cannot release an upstream request`, async () => {
  await fixture(async ({ base, request, effects, proxy, restart }) => {
    await proxy().stop();
    const file = join(base, kind === 'receipt' ? 'model-budget.enrollment.json' : 'model-budget.sqlite');
    if (kind === 'corrupt' || kind === 'receipt') await writeFile(file, 'invalid');
    else if (kind === 'permissions') await chmod(file, 0o644);
    else { await rename(file, `${file}.owned`); await symlink(`${file}.owned`, file); }
    await assert.rejects(restart());
    assert.equal(effects(), 0);
  });
});

test('invalid tools, source, auth, path and deadline fail before reservation', async () => {
  await fixture(async ({ request, payload, effects, inspect, restart }) => {
    const read = payload(); read.tools[0].function.name = 'read'; assert.notEqual((await request(read)).status, 200);
    const other = payload(); other.messages[1].content = JSON.stringify({ source: 'unapproved input' }); assert.notEqual((await request(other)).status, 200);
    const skills = payload(); skills.messages[0].content = '<available_skills>blocked</available_skills>'; assert.notEqual((await request(skills)).status, 200);
    assert.notEqual((await request(payload(), { headers: { authorization: 'Bearer invalid' } })).status, 200);
    assert.equal(inspect().reserved, 0); assert.equal(effects(), 0);
    await restart(['--cutoff-offset', '-1']);
    assert.notEqual((await request()).status, 200); assert.equal(effects(), 0);
  });
});

test('a redirect is one charged request and is never followed', async () => {
  await fixture(async ({ request, effects, inspect }) => {
    assert.notEqual((await request()).status, 200); assert.equal(effects(), 1); assert.equal(inspect().reserved, 1);
  }, { status: 307, headers: { location: 'http://127.0.0.1:1/forbidden-redirect' } });
});

test('a killed owned relay leaves its forwarded slot charged after reopening', async () => {
  let release, arrived;
  const held = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { arrived = resolve; });
  await fixture(async ({ request, proxy, restart, effects, inspect }) => {
    const pending = request().catch(error => error);
    await Promise.race([entered, pause(3000).then(() => { throw new Error('owned relay did not reach the held upstream'); })]);
    const child = proxy().child;
    child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve));
    release(); await pending;
    assert.equal(child.signalCode, 'SIGKILL');
    assert.equal(effects(), 1); assert.equal(inspect().reserved, 1); assert.equal(inspect().forwarded, 1);
    await restart();
    for (let index = 0; index < 9; index++) assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 429); assert.equal(effects(), 10); assert.equal(inspect().reserved, 10);
  }, { onUpstream: async (_request, response, count) => { if (count === 1) { arrived(); await held; } response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(normal); } });
});

const secretCases = {
  plain: frame({ content: JSON.stringify({ candidates: [{ title: canary }] }) }) + finish,
  unicode: frame({ content: `{"candidates":[{"title":"${[...canary].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}"}]}` }) + finish,
  events: frame({ content: `{"candidates":[{"title":"${canary.slice(0, 12)}` }) + frame({ content: `${canary.slice(12)}"}]}` }) + finish,
  reasoning: frame({ reasoning_content: canary.slice(0, 12) }) + frame({ reasoning_text: canary.slice(12) }) + frame({ content: '{"candidates":[]}' }) + finish,
  arguments: frame({ tool_calls: [{ index: 0, id: 'call-controlled', type: 'function', function: { name, arguments: `{"text":"${canary.slice(0, 12)}` } }] }) + frame({ tool_calls: [{ index: 0, function: { arguments: `${canary.slice(12)}"}` } }] }) + toolFinish,
};
for (const [kind, response] of Object.entries(secretCases)) test(`decoded ${kind} canary cannot reach the client or evidence`, async () => {
  await fixture(async ({ base, request, effects, inspect }) => {
    const result = await request(); assert.notEqual(result.status, 200); assert.ok(!result.text.includes(canary));
    assert.equal(effects(), 1); assert.equal(inspect().reserved, 1);
    for (const file of ['model-budget.sqlite', 'model-budget.enrollment.json']) assert.ok(!(await readFile(join(base, file))).includes(Buffer.from(canary)));
  }, { response });
});

test('PF06 removing only secret_scan exposes each otherwise valid canary and safe controls pass', () => {
  assert.match(faultProbe('scanner-mutation'), /"scanner_removed_canaries_exposed": 5/);
});

for (const [kind, response] of Object.entries({
  'data-after-finish': finish.split('data: [DONE]')[0] + frame({ content: '{"candidates":[]}' }) + 'data: [DONE]\n\n',
  'tool-finish-without-call': frame({ content: '{"candidates":[]}' }) + toolFinish,
  'non-json-NaN': frame({ content: '{"candidates":[]}' }) + 'data: {"choices":[],"usage":{"prompt_tokens":NaN,"completion_tokens":1,"total_tokens":1}}\n\n' + finish,
  'DONE-without-final-delimiter': normal.slice(0, -2),
})) test(`PF04 inconsistent or truncated ${kind} is rejected`, async () => {
  await fixture(async ({ request, effects, inspect }) => {
    assert.notEqual((await request()).status, 200); assert.equal(effects(), 1); assert.equal(inspect().reserved, 1);
  }, { response });
});

test('normal split SSE survives transport chunks while truncated streams fail closed', async () => {
  await fixture(async ({ request, effects, inspect }) => {
    assert.equal((await request()).status, 200); assert.equal(effects(), 1); assert.equal(inspect().reserved, 1);
  }, { onUpstream: async (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); const value = frame({ content: '{"candi' }) + frame({ content: 'dates":[]}' }) + finish; for (let index = 0; index < value.length; index += 11) response.write(value.slice(index, index + 11)); response.end(); } });
  await fixture(async ({ request, effects, inspect }) => { assert.notEqual((await request()).status, 200); assert.equal(effects(), 1); assert.equal(inspect().reserved, 1); }, { response: frame({ content: '{"candidates":[]}' }) });
});
