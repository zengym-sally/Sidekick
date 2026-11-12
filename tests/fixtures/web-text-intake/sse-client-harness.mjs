//! Controlled transport + real compiled PairingGate harness for the W1 task-SSE
//! client black-box regression (MAYNE-24).
//!
//! Dispatch lineage: coordination comment `01a1c15f-071c-7020-bcb8-9d8f123d9320`
//! (original SSE black-box dispatch), reassigned to ZCode by
//! `01a1c1e3-b46e-7119-9bd7-5741af26aac9`. The prior run delivered only an
//! EventSource-era skeleton (platform commit `2e8b5d53`, fixture blob
//! `95fa6115`); its bones (compile-and-mount mechanics, controlled doubles,
//! legal-response table, labeled waits) are reused here, but its transport
//! double is superseded: the frozen `web-api/1` §6 compensation requires
//! resubscribing with the snapshot token as the `Last-Event-ID` request
//! HEADER, which native `EventSource` cannot carry, so the real transport is
//! the same-origin fetch stream (`src/lib/sse-stream.ts`). This harness drives
//! BOTH transports through one seam: trees whose pairing store still
//! subscribes through `globalThis.EventSource` get a faithful native double,
//! trees with the fetch stream get a real `text/event-stream` Response body.
//!
//! What this harness does — and deliberately does not do:
//!   - It drives the REAL modules of the tree it runs in: the real
//!     `PairingGate.vue` compiled from source (the component that registers
//!     the event routing under test), the real `TaskQueue.vue` mounted in its
//!     slot, the real stores over the real `WebApiClient`, and the tree's real
//!     SSE transport. Nothing here registers or re-implements a sync callback:
//!     the handler under test is the one the production gate registers.
//!   - It only answers the frozen HTTP surface with legal controlled responses
//!     and writes legal SSE frames at the transport boundary. It never injects
//!     store state, and its assertions observe the read-backs the sync
//!     pipeline itself dispatches within windows far below the queue's 1s
//!     poll, so polling can never mask missing compensation.

import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import * as pinia from 'pinia';
import { parse, compileScript } from 'vue/compiler-sfc';
import ts from 'typescript';

import * as pairingModule from '../../../src/stores/pairing.ts';
import * as todosModule from '../../../src/stores/todos.ts';
import * as organizerModule from '../../../src/stores/organizer.ts';
import * as webApiClientModule from '../../../src/lib/web-api-client.ts';

// The same real store hooks the compiled gate resolves through its require
// shim — one module graph, one Pinia instance per case.
const { usePairing } = pairingModule;
const { useTodos } = todosModule;
const { useOrganizer } = organizerModule;

/// A legal `web-api/1` native EventSource double for trees whose pairing store
/// still constructs one. It records every instance, listener registration and
/// close, and can emit one event name to its listeners (the zero-argument hint
/// the old seam delivers — ids are not observable on this transport).
export class ControlledEventSource {
  constructor(url, options) {
    this.url = String(url);
    this.options = options ?? null;
    this.listeners = new Map();
    this.closed = false;
    this.closeCount = 0;
    ControlledEventSource.instances.push(this);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) ?? [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  close() {
    this.closed = true;
    this.closeCount += 1;
  }

  /// Dispatch one event name. A real EventSource delivers a MessageEvent; the
  /// old seam's listeners take no arguments, so the frame value is irrelevant.
  emit(type) {
    for (const handler of this.listeners.get(type) ?? []) handler();
  }
}
ControlledEventSource.instances = [];

/// One SSE frame exactly as it travels on the wire (`id:` line only for event
/// frames; handshake and hint frames carry none, per frozen §6 / intake §6.3).
function sseText(event, data, id) {
  let text = `event: ${event}\n`;
  if (id !== null && id !== undefined) text += `id: ${id}\n`;
  text += `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
  return text;
}

const OK = (body) => ({ status: 200, body });
const ISO = (ms) => new Date(ms).toISOString();
export const T0 = Date.parse('2026-11-09T10:00:00.000Z');

/// Wire fixtures modelled on the frozen contract samples
/// (tests/fixtures/web-contract/snapshot-high-watermark.json,
/// sse-events-sample.json): every field the client's wire mapping reads.
const confirmedExitEvidence = JSON.parse(readFileSync(new URL('../web-api-v2-client/frozen/task-needs-review-exit-reclaimed.json', import.meta.url), 'utf8')).attemptExitEvidence;

export function wireTask({
  taskId,
  type = 'organize_text',
  state = 'queued',
  version = 1,
  attemptCount = 0,
  createdAtMs = T0,
  queuePosition = null,
  failure = null,
  inputRef = { kind: 'inline_text', sourceId: null },
}) {
  return {
    contractVersion: 'web-api/2',
    taskId,
    operationId: `op_${taskId}`,
    type,
    role: 'organizer',
    state,
    version,
    createdAt: ISO(createdAtMs),
    updatedAt: ISO(createdAtMs),
    terminalAt: ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state) ? ISO(createdAtMs + 1000) : null,
    submitSeq: 1000,
    queuePosition,
    attemptCount,
    attemptId: state !== 'queued' && attemptCount > 0 ? `att_${taskId}` : null,
    attemptExitState: state === 'running' ? 'active' : state === 'cancelling' ? 'exiting' : state === 'queued' || attemptCount === 0 ? 'not_started' : 'exited_confirmed',
    attemptExitEvidence: ['running', 'cancelling', 'queued'].includes(state) || attemptCount === 0 ? null : structuredClone(confirmedExitEvidence),
    cancelIntent: false,
    configRevision: 'cfgrev_sse_test',
    originalConfigRevision: 'cfgrev_sse_test',
    inputRef,
    progress: null,
    result: null,
    resultPendingExit: false,
    failure,
    recovery: null,
  };
}

const WIRE_ITEM = {
  contractVersion: 'web-api/2',
  itemId: 'mi_1',
  title: '周五前提交方案（sse-client 合成样例）',
  kind: 'action',
  owner: '李四',
  priority: 'medium',
  status: 'open',
  due: null,
  followup: null,
  tags: [],
  createdAt: ISO(T0),
  updatedAt: ISO(T0),
  completedAt: null,
  deletedAt: null,
  version: 1,
  source: 'manual',
};

const WIRE_SOURCE = {
  sourceId: 'src_1',
  fingerprint: 'fp_sse_client_test_1',
  kind: 'inline_text',
  rawText: '周五前提交方案（sse-client 合成样例原文）',
  sourceAt: null,
  importedAtMs: T0,
  anchorAtMs: T0,
  timeZone: 'Asia/Shanghai',
  succeededRunId: null,
  evidence: null,
  association: null,
  createdAt: ISO(T0),
};

const SESSION = { contractVersion: 'web-api/2', session: { capabilities: ['workspace.backup'] }, csrfToken: 'csrf_sse_client_test' };

/// The default legal world: one source, one queued task of epoch `inst_a`,
/// one manual item. Cases override single responses through `behavior`.
export function defaultWorld() {
  return {
    epoch: 'inst_a',
    highWatermark: 0,
    agentConcurrency: 3,
    items: [WIRE_ITEM],
    sources: [WIRE_SOURCE],
    tasks: [wireTask({ taskId: 'tsk_1', state: 'queued', version: 1, queuePosition: 1 })],
  };
}

export function snapshotBody(world) {
  return {
    contractVersion: 'web-api/2',
    generatedAt: ISO(T0),
    settings: { agentConcurrency: world.agentConcurrency, version: 0 },
    workspace: { mode: 'local', currentRoot: { id: 'root_synthetic', label: 'Synthetic root' }, capabilities: [], recovery: null },
    highWatermark: world.highWatermark,
    lastEventId: `${world.epoch}:${world.highWatermark}`,
    epoch: world.epoch,
    agentConcurrency: world.agentConcurrency,
    tasks: world.tasks,
  };
}

/// Route one recorded non-event-stream call to its legal response. `behavior`
/// lets a case override exactly the next response of one surface (one-shot
/// hooks are consumed on use); everything else answers from `world`.
async function routeCall(world, behavior, call) {
  const { path, query } = call;
  if (path === '/api/session') return behavior.session ? consume(behavior, 'session') : OK(SESSION);
  if (path === '/api/pair') return behavior.pair ? consume(behavior, 'pair') : OK(SESSION);
  if (path === '/api/manual-items') return behavior.items ? consume(behavior, 'items') : OK({ contractVersion: 'web-api/2', items: world.items });
  if (path === '/api/snapshot') return behavior.snapshot ? consume(behavior, 'snapshot') : OK(snapshotBody(world));
  if (path === '/api/text-sources') return behavior.sources ? consume(behavior, 'sources') : OK({ contractVersion: 'web-api/2', sources: world.sources, nextCursor: null });
  if (/^\/api\/text-sources\/[^/]+\/candidates$/.test(path)) {
    return behavior.candidates ? consume(behavior, 'candidates') : OK({ contractVersion: 'web-api/2', candidates: [], nextCursor: null });
  }
  if (/^\/api\/text-sources\/[^/]+$/.test(path)) {
    return behavior.source ? consume(behavior, 'source') : OK({ contractVersion: 'web-api/2', source: world.sources[0], run: null, candidates: [], previews: [] });
  }
  if (path === '/api/tasks') {
    if (behavior.nextTaskList && query.includes('limit=200')) return OK({ contractVersion: 'web-api/2', tasks: consume(behavior, 'nextTaskList'), nextCursor: null });
    if (behavior.holdNextTasks) {
      behavior.holdNextTasks = false;
      const body = await behavior.tasksHold.promise;
      return OK(body);
    }
    const cursor = new URLSearchParams(query).get('cursor');
    if (behavior.taskPages) return OK(behavior.taskPages(cursor));
    return OK({ contractVersion: 'web-api/2', tasks: world.tasks, nextCursor: null });
  }
  const single = /^\/api\/tasks\/([^/]+)$/.exec(path);
  if (single) {
    if (behavior.nextTaskRow) return OK({ contractVersion: 'web-api/2', task: consume(behavior, 'nextTaskRow') });
    return OK({ contractVersion: 'web-api/2', task: world.tasks.find((task) => task.taskId === single[1]) ?? world.tasks[0] });
  }
  throw new Error(`sse-client-harness: no legal response scripted for ${call.method} ${path}`);
}

/// One-shot consumption: take the hook's return value once, then fall through
/// to the defaults on later calls.
function consume(behavior, key) {
  const value = behavior[key];
  behavior[key] = undefined;
  return typeof value === 'function' ? value() : value;
}

/// Behavior hooks may answer either a raw legal body or a `{status, body}`
/// shape (for 401 probes); normalize raw bodies into the latter.
function normalizeAnswer(answered) {
  if (answered && typeof answered === 'object' && !('body' in answered) && !('status' in answered)) {
    return { status: 200, body: answered };
  }
  return answered;
}

/// Install the controlled transport: `globalThis.window`, a faithful native
/// `EventSource` double and a recording `fetch` that answers the frozen HTTP
/// surface. `/api/events` opens a real `text/event-stream` Response body the
/// production fetch-stream transport reads through its own parser.
export function installControlledNetwork(world, behavior = {}) {
  const log = [];
  const streams = [];
  const encoder = new TextEncoder();
  const previous = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    EventSource: globalThis.EventSource,
  };
  ControlledEventSource.instances = [];

  globalThis.window = { location: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' } };
  globalThis.EventSource = ControlledEventSource;

  globalThis.fetch = async (url, options = {}) => {
    const raw = String(url);
    const q = raw.indexOf('?');
    const call = {
      seq: log.length + 1,
      at: Date.now(),
      method: options.method ?? 'GET',
      path: q === -1 ? raw : raw.slice(0, q),
      query: q === -1 ? '' : raw.slice(q + 1),
      url: raw,
      headers: { ...(options.headers ?? {}) },
      signal: options.signal ?? null,
    };
    log.push(call);
    if (call.path === '/api/events') {
      if (behavior.nextEventsStatus) {
        const status = consume(behavior, 'nextEventsStatus');
        return new Response(null, { status });
      }
      let controller = null;
      const body = new ReadableStream({
        start(c) {
          controller = c;
        },
      });
      const record = { entry: call, controller: null, closed: false };
      record.controller = controller;
      streams.push(record);
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const answered = normalizeAnswer(await routeCall(world, behavior, call));
    return new Response(JSON.stringify(answered.body ?? null), {
      status: answered.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const liveStream = () => {
    for (let i = streams.length - 1; i >= 0; i -= 1) {
      if (!streams[i].closed) return streams[i];
    }
    return null;
  };

  return {
    log,
    streams,
    eventSources: ControlledEventSource.instances,
    /// Write one legal frame at the transport boundary: the fetch stream's
    /// body when the tree uses it, the native double's listeners otherwise.
    emit(event, data, id = null) {
      const stream = liveStream();
      if (stream) {
        stream.controller.enqueue(encoder.encode(sseText(event, data, id)));
        return 'fetch-stream';
      }
      if (ControlledEventSource.instances.length > 0) {
        for (const source of ControlledEventSource.instances) source.emit(event);
        return 'eventsource';
      }
      throw new Error('sse-client-harness: no live transport to emit on');
    },
    /// The transport's native connection-loss signal: natural stream end on
    /// the fetch stream, the `error` event on the native double.
    loseStream() {
      const stream = liveStream();
      if (stream) {
        stream.closed = true;
        stream.controller.close();
        return 'fetch-stream';
      }
      for (const source of ControlledEventSource.instances) source.emit('error');
      return 'eventsource';
    },
    /// Hold the next queue list read (the fence face resolves it later with a
    /// chosen body — the response then arrives AFTER the epoch moved).
    holdNextTasks() {
      behavior.holdNextTasks = true;
      let resolve;
      behavior.tasksHold = { promise: new Promise((r) => { resolve = r; }) };
      return (body) => resolve({ contractVersion: 'web-api/2', tasks: body, nextCursor: null });
    },
    /// Calls recorded after `seq` whose PATH starts with `prefix` (paths carry
    /// no query — match query strings through the entries themselves).
    callsAfter(seq, prefix) {
      return log.filter((call) => call.seq > seq && call.path.startsWith(prefix));
    },
    lastSeq() {
      return log.length;
    },
    restore() {
      globalThis.fetch = previous.fetch;
      globalThis.window = previous.window;
      globalThis.EventSource = previous.EventSource;
      streams.length = 0;
      ControlledEventSource.instances = [];
    },
  };
}

function inertComponent() {
  return {
    setup: (_props, context) => () => Vue.h('span', context.slots?.default?.()),
  };
}

const moduleCache = new Map();

/// Compile a real SFC from the tree under test (the proven repo pattern:
/// parse + compileScript inlineTemplate + CJS transpile + require shim).
/// `shallowIf` stubs presentational children; everything else resolves for
/// real, so the compiled gate wires the REAL stores and the REAL TaskQueue.
function compileVueComponent(url, shallowIf) {
  if (moduleCache.has(url.href)) return moduleCache.get(url.href);
  const { descriptor } = parse(readFileSync(url, 'utf8'), { filename: url.pathname });
  const script = compileScript(descriptor, { id: url.pathname, inlineTemplate: true });
  const code = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  Function('require', 'exports', code)((name) => {
    if (name === 'vue') return Vue;
    if (name === 'pinia') return pinia;
    const base = name.replaceAll('.ts', '').replaceAll('.vue', '');
    if (base.endsWith('/pairing')) return pairingModule;
    if (base.endsWith('/todos')) return todosModule;
    if (base.endsWith('/organizer')) return organizerModule;
    if (base.endsWith('/web-api-client')) return webApiClientModule;
    if (shallowIf?.(name) && name.endsWith('.vue')) return { default: inertComponent() };
    if (name.endsWith('.svg')) return { default: 'data:image/svg+xml;base64,' };
    if (name.endsWith('.vue')) return { default: compileVueComponent(new URL(name, url), shallowIf) };
    throw new Error(`sse-client-harness: unexpected component dependency: ${name} (in ${url.pathname})`);
  }, exports);
  if (!exports.default) throw new Error(`sse-client-harness: ${url.pathname} produced no default export`);
  moduleCache.set(url.href, exports.default);
  return exports.default;
}

function node(type) {
  return { type, children: [], props: {}, text: '', parent: null };
}

function walkText(node_, into) {
  // Elements whose compiler shape is TEXT_CHILDREN hold their string on the
  // element itself (hostSetElementText contract), text vnodes on `#text`
  // nodes — collect both.
  if (node_.text) into.push(node_.text);
  for (const child of node_.children) walkText(child, into);
}

const renderer = Vue.createRenderer({
  patchProp(el, key, _prev, next) {
    el.props[key] = next;
  },
  createElement: (tag) => node(tag),
  // The text content rides the create call for hoisted static vnodes; keep
  // it, or every static string renders empty.
  createText: (text) => {
    const created = node('#text');
    created.text = String(text ?? '');
    return created;
  },
  createComment: (text) => {
    const created = node('#comment');
    created.text = String(text ?? '');
    return created;
  },
  setText(el, text) {
    el.text = text;
  },
  setElementText(el, text) {
    el.text = text;
  },
  parentNode: (el) => el.parent,
  // A consistent child-list model: siblings come from the parent's children,
  // so Vue's anchor traversals (fragment start/end anchors) terminate.
  nextSibling: (el) => {
    const list = el?.parent?.children ?? [];
    const index = list.indexOf(el);
    return index >= 0 ? (list[index + 1] ?? null) : null;
  },
  insert(el, parent, anchor) {
    el.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index >= 0) parent.children.splice(index, 0, el);
    else parent.children.push(el);
  },
  remove(el) {
    if (el?.parent) {
      el.parent.children = el.parent.children.filter((child) => child !== el);
      el.parent = null;
    }
  },
});

/// Mount the real compiled gate with a fresh Pinia (per-case store isolation).
/// The slot carries the REAL TaskQueue so the queue display, its fence and the
/// invalidation seam are exercised through the real composition.
export function mountGate() {
  const gate = compileVueComponent(new URL('../../../src/components/PairingGate.vue', import.meta.url), (name) =>
    name.endsWith('SkButton.vue') || name.endsWith('SkInput.vue') || name.endsWith('Icon.vue'));
  const queue = compileVueComponent(new URL('../../../src/components/TaskQueue.vue', import.meta.url), null);
  const piniaInstance = pinia.createPinia();
  pinia.setActivePinia(piniaInstance);
  const app = renderer.createApp({
    render: () => Vue.h(gate, null, { default: () => Vue.h(queue) }),
  });
  app.use(piniaInstance);
  const root = node('root');
  app.mount(root);
  return {
    app,
    pinia: piniaInstance,
    pairing: usePairing(piniaInstance),
    todos: useTodos(piniaInstance),
    organizer: useOrganizer(piniaInstance),
    renderedText() {
      const parts = [];
      walkText(root, parts);
      return parts.join('\n');
    },
    unmount() {
      app.unmount();
    },
  };
}

/// Poll until `predicate` holds or the budget expires; throws with the label
/// on timeout (labeled diagnostics, per the repo's convention).
export async function waitFor(predicate, what, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function settle(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
