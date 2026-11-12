// Controlled OpenAI-compatible model service for the W1 text-intake
// acceptance suites (MAYNE-24 slice II; P2 readiness §7). It exists so the
// suites can drive the REAL bundled Pi organizer (build/s0-runtime/
// organizer.mjs) through the production backend without any real model,
// real credential or real network egress:
//
//   - loopback only (127.0.0.1), synthetic root, zero npm dependencies;
//   - SSE chat-completions responses scripted per request through a JSON
//     script file the test owns (consumed in request order; the file is
//     re-read when its mtime changes so a suite can swap scenarios mid-run);
//   - every request is recorded as one JSON line: shape, model, message
//     counts, tool usage (including the relayed tool-result contents of the
//     scripted synthetic commands) and WHETHER an Authorization header was
//     present plus its length — never its value. The suites falsify "no model
//     call happened" from the record count and prove the auth header exists
//     without recording the secret;
//   - fault injection per P2 §7: HTTP status (401/429/5xx), slow response,
//     mid-stream break, service self-exit, hang, and invalid model outputs
//     (non-JSON, evidence not a substring of the source, action carrying a
//     followup expression, oversize tags) which the runtime output contract
//     must reject without persisting candidates;
//   - readiness is signalled by one URL line on stdout (no fixed sleep);
//     SIGTERM closes all connections and exits.
//
// Usage: node controlled-model-service.mjs --script <file.json> --record <file.jsonl> [--port N]
import { createServer } from 'node:http';
import { readFileSync, statSync, appendFileSync, existsSync } from 'node:fs';
import { argv } from 'node:process';
import { createHash } from 'node:crypto';

const args = argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};
const scriptPath = valueOf('script');
const recordPath = valueOf('record');
const port = Number(valueOf('port') ?? 0);

// The valid fallback when the script is missing or exhausted: an empty
// candidate list is contract-legal (array, <= 50), so the service can never
// push the runtime into MODEL_INVALID_OUTPUT by accident.
const FALLBACK_CONTENT = JSON.stringify({ candidates: [] });

// Script entries are matched against the request instead of being consumed in
// blind order, so a suite's answer follows its request even when tasks
// interleave: an entry with a `match` clause applies to the first unconsumed
// request whose user text / system prompt / tool-result count satisfies it;
// an entry with `repeat: true` is a standing answer that is never consumed;
// an entry with neither is consumed in order as a one-shot.
let scriptCache = { mtimeMs: -1, entries: [], consumed: new Set() };

function loadScript() {
  if (!scriptPath || !existsSync(scriptPath)) {
    scriptCache = { mtimeMs: -1, entries: [], consumed: new Set() };
    return;
  }
  const mtimeMs = statSync(scriptPath).mtimeMs;
  if (mtimeMs === scriptCache.mtimeMs) return;
  let entries = [];
  try {
    const parsed = JSON.parse(readFileSync(scriptPath, 'utf8'));
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    entries = [];
  }
  scriptCache = { mtimeMs, entries, consumed: new Set() };
}

function matches(entry, request) {
  const match = entry.match;
  if (!match) return true;
  if (match.userTextIncludes !== undefined && !request.userText.includes(match.userTextIncludes)) return false;
  if (match.systemIncludes !== undefined && !request.systemText.includes(match.systemIncludes)) return false;
  if (match.toolResults !== undefined && request.toolResults !== match.toolResults) return false;
  if (match.hasTools !== undefined && request.hasTools !== match.hasTools) return false;
  return true;
}

function nextEntry(request) {
  loadScript();
  const entries = scriptCache.entries;
  if (entries.length === 0) return { entry: { kind: 'sse', content: FALLBACK_CONTENT }, index: -1 };
  // 1. A matched one-shot entry (match clause satisfied) is consumed in file
  //    order — specific answers follow their request even when tasks
  //    interleave.
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.repeat === true || !entry.match) continue;
    if (scriptCache.consumed.has(index)) continue;
    if (matches(entry, request)) {
      scriptCache.consumed.add(index);
      return { entry, index };
    }
  }
  // 2. A one-shot entry without a match clause is consumed in file order by
  //    whatever request arrives next (ordered fault/answer sequences).
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.repeat === true || entry.match) continue;
    if (scriptCache.consumed.has(index)) continue;
    scriptCache.consumed.add(index);
    return { entry, index };
  }
  // 3. A standing repeat entry answers everything else without being consumed.
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.repeat === true && matches(entry, request)) return { entry, index };
  }
  const standing = entries.find((entry) => entry.repeat === true);
  return { entry: standing ?? { kind: 'sse', content: FALLBACK_CONTENT }, index: standing ? entries.indexOf(standing) : -1 };
}

function record(entry) {
  if (!recordPath) return;
  appendFileSync(recordPath, JSON.stringify(entry) + '\n');
}

const sseBody = (delta, finishReason) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
  + `data: [DONE]\n\n`;

const toolCallDelta = (call, index) => ({
  role: 'assistant',
  tool_calls: [{
    index: index ?? 0,
    id: `controlled-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
  }],
});

// Message content arrives either as a plain string or as content parts
// ([{type:'text',text}]) depending on the client; matching and recording use
// the extracted text so a parts-array user message never degrades to
// "[object Object]".
const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && part.type === 'text') return String(part.text ?? '');
      return '';
    }).join('');
  }
  return content == null ? '' : String(content);
};

const server = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body = {};
  try { body = JSON.parse(raw); } catch { /* recorded as an unparsed body */ }
  const authorization = request.headers.authorization;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemMessage = messages.find((message) => message.role === 'system');
  const userText = messages.filter((message) => message.role === 'user').map((message) => textOf(message.content)).join('\n');
  const toolResults = messages.filter((message) => message.role === 'tool').length;
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  // The tool-result contents the runtime relays back (scripted commands only,
  // synthetic by construction): the joint "real Pi" proof observes the
  // scripted command's output marker here, so the relay is directly
  // evidenced rather than inferred from message counts. The record is still
  // grepped for the synthetic secret by every suite.
  const toolContents = messages.filter((message) => message.role === 'tool').map((message) => textOf(message.content));
  const { entry, index } = nextEntry({ userText, systemText: textOf(systemMessage?.content), toolResults, hasTools });
  record({
    at: new Date().toISOString(),
    method: request.method,
    url: request.url,
    model: body.model ?? null,
    stream: body.stream ?? null,
    hasAuthorization: typeof authorization === 'string' && authorization.length > 0,
    authorizationLength: typeof authorization === 'string' ? authorization.length : 0,
    messageCount: messages.length,
    toolMessageCount: toolResults,
    hasTools,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    ...(toolContents.length > 0 ? { toolContents } : {}),
    scriptIndex: index,
    systemPromptSha256: systemMessage ? createHash('sha256').update(textOf(systemMessage.content)).digest('hex') : null,
    userTextLength: userText.length,
    userTextSha256: userText ? createHash('sha256').update(userText).digest('hex') : null,
  });
  try {
    if (entry.kind === 'status') {
      response.writeHead(entry.status, { 'content-type': 'application/json' });
      response.end(entry.body ?? JSON.stringify({ error: { message: 'controlled fault injection' } }));
      return;
    }
    if (entry.kind === 'slow') {
      await new Promise((done) => setTimeout(done, entry.delayMs ?? 5000));
      const nested = entry.then ?? { kind: 'sse', content: FALLBACK_CONTENT };
      if (nested.kind === 'status') {
        response.writeHead(nested.status, { 'content-type': 'application/json' });
        response.end(nested.body ?? '{}');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(sseBody({ role: 'assistant', content: nested.content ?? FALLBACK_CONTENT }, 'stop'));
      return;
    }
    if (entry.kind === 'break') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${entry.partial ?? JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: '{"candid' } }] })}\n\n`);
      // Destroy the socket without terminating the SSE body: the client sees a
      // truncated stream (network-class failure), never a complete answer.
      response.socket?.destroy();
      return;
    }
    if (entry.kind === 'exit') {
      // The service dies without answering: the organizer observes a failed
      // request/EOF, which must map to a model failure and no candidates.
      process.exit(0);
    }
    if (entry.kind === 'hang') {
      // Never answer and never close: exercises the run-limit / timeout path.
      return;
    }
    if (entry.kind === 'toolCalls') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(sseBody(toolCallDelta(entry.call ?? { name: 'read', args: {} }, entry.index), 'tool_calls'));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(sseBody({ role: 'assistant', content: entry.content ?? FALLBACK_CONTENT }, 'stop'));
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'controlled service failure' } }));
    } else {
      response.socket?.destroy();
    }
    record({ at: new Date().toISOString(), serviceError: String(error?.message ?? error) });
  }
});

server.listen(port, '127.0.0.1', () => {
  // Readiness signal: one URL line on stdout. The suite waits for this line
  // instead of sleeping.
  process.stdout.write(`http://127.0.0.1:${server.address().port}/v1\n`);
});

process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
