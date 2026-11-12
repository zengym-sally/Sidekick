// In-page mount harness for the web-api/2 exit-evidence faces (MAYNE-38).
//
// This module runs INSIDE headless Chrome, served by the driver's Vite dev
// server straight from the repo root, so the mounted component is the REAL
// production TaskQueue.vue over the REAL stores, the REAL pairing sync and
// the REAL WebApiClient transport. The one substitution is the transport
// boundary: fetch is answered with legal frozen web-api/2 shapes from a
// mutable `world` (rows come from the frozen 0c9febc samples, passed by the
// driver), every call is recorded, and the SSE connection is a controllable
// text/event-stream. All observation and judgment live in the driver
// tests/fixtures/web-api-v2-client/evidence-browser.mjs.
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import TaskQueue from '../../../../src/components/TaskQueue.vue';
import { usePairing } from '../../../../src/stores/pairing.ts';

interface Call { seq: number; method: string; path: string; body: any; lastEventId: string | null }
interface World {
  tasks: any[];
  taskListVersion: string;
  concurrency: any;
  concurrencyPutReply: { status: number; body: any } | null;
  actionReply: { status: number; body: any } | null;
  snapshot: any;
  sseController: ReadableStreamDefaultController<Uint8Array> | null;
}

const recorded: Call[] = [];
const encoder = new TextEncoder();
const world: World = {
  tasks: [],
  taskListVersion: 'web-api/2',
  concurrency: { contractVersion: 'web-api/2', agentConcurrency: 3, default: 3, version: 5, runningCount: 2, queuedCount: 1 },
  concurrencyPutReply: null,
  actionReply: null,
  snapshot: null,
  sseController: null,
};

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sseResponse = () => new Response(new ReadableStream({
  start(controller) { world.sseController = controller; },
}), { status: 200, headers: { 'content-type': 'text/event-stream' } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const call: Call = {
    seq: recorded.length + 1,
    method: init?.method ?? 'GET',
    path,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    lastEventId: headers['Last-Event-ID'] ?? null,
  };
  recorded.push(call);
  if (path === '/api/events') return sseResponse();
  if (path === '/api/session' && call.method === 'GET') {
    // A live session: pairing.start() then opens the REAL SSE subscription.
    return respond(200, { contractVersion: 'web-api/2', session: { capabilities: [] }, csrfToken: 'csrf-page' });
  }
  if (path === '/api/tasks' && call.method === 'GET') {
    return respond(200, { contractVersion: world.taskListVersion, tasks: world.tasks, nextCursor: null });
  }
  if (path === '/api/settings/agent-concurrency' && call.method === 'GET') {
    return respond(200, { ...world.concurrency });
  }
  if (path === '/api/settings/agent-concurrency' && call.method === 'PUT') {
    if (world.concurrencyPutReply) return respond(world.concurrencyPutReply.status, world.concurrencyPutReply.body);
    Object.assign(world.concurrency, { agentConcurrency: call.body.agentConcurrency, version: (world.concurrency.version ?? 0) + 1 });
    return respond(200, { ...world.concurrency });
  }
  const action = /^\/api\/tasks\/([^/]+)\/(cancel|retry|resolve)$/.exec(path);
  if (action && call.method === 'POST') {
    if (world.actionReply) return respond(world.actionReply.status, world.actionReply.body);
    return respond(202, { contractVersion: 'web-api/2', task: { taskId: action[1] } });
  }
  if (path === '/api/snapshot') {
    return world.snapshot
      ? respond(200, world.snapshot)
      : respond(503, { contractVersion: 'web-api/2', status: 503, error: { code: 'unavailable', message: 'snapshot not scripted' } });
  }
  return respond(404, { contractVersion: 'web-api/2', status: 404, error: { code: 'not_found', message: `unscripted ${call.method} ${path}` } });
}) as typeof fetch;

const pinia = createPinia();
const configRevision = ref<string | null>(null);
const app = createApp({ setup: () => () => h(TaskQueue, { configRevision: configRevision.value }) });
app.use(pinia);
app.mount('#task-queue-root');
// The REAL pairing sync starts on the same pinia: a live scripted session
// opens the real SSE subscription, and its frames drive the queue's
// production invalidation path (frames never carry payload state).
usePairing().start();

const waitFor = (predicate: () => boolean, timeoutMs = 3000): Promise<true> => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs;
  const tick = () => {
    try { if (predicate()) { resolve(true); return; } } catch (error) { reject(error); return; }
    if (Date.now() > deadline) { reject(new Error('in-page waitFor timeout')); return; }
    setTimeout(tick, 25);
  };
  tick();
});

const buttonByAria = (label: string): HTMLElement | null => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.task-queue button'));
  return buttons.find((button) => button.getAttribute('aria-label') === label) ?? null;
};

const state = () => {
  const root = document.querySelector('.task-queue');
  const doc = document.documentElement;
  const buttons = Array.from(root?.querySelectorAll('button') ?? []).map((button) => {
    const rect = button.getBoundingClientRect();
    return {
      label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
      x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height),
      disabled: (button as HTMLButtonElement).disabled,
      ariaExpanded: button.getAttribute('aria-expanded'),
      ariaControls: button.getAttribute('aria-controls'),
      inRow: button.closest('li')?.id ?? null,
    };
  });
  const alerts = Array.from(root?.querySelectorAll('[role="alert"]') ?? []).map((node) => node.textContent?.trim() ?? '');
  return {
    text: root?.textContent ?? '',
    docScrollWidth: doc.scrollWidth,
    buttons,
    alerts,
    live: root?.querySelector('.queue-announce')?.textContent ?? '',
    busyRows: Array.from(root?.querySelectorAll('li[aria-busy="true"]') ?? []).map((node) => node.id),
    activeElement: (() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      return {
        tag: active.tagName.toLowerCase(),
        ariaLabel: active.getAttribute('aria-label'),
        id: active.id,
        isListContainer: active.tagName === 'UL',
        insideRow: active.closest('li')?.id ?? null,
      };
    })(),
  };
};

// --- driver seams ------------------------------------------------------------

(window as any).__v2Evidence = {
  ready: true,
  seed(rows: any[]) { world.tasks = rows; return true; },
  setTaskListVersion(version: string) { world.taskListVersion = version; return true; },
  setConcurrency(view: any) { world.concurrency = { contractVersion: 'web-api/2', ...view }; return true; },
  setConcurrencyPutReply(reply: any) { world.concurrencyPutReply = reply; return true; },
  setActionReply(reply: any) { world.actionReply = reply; return true; },
  setSnapshot(snapshot: any) { world.snapshot = snapshot; return true; },
  /// Push one SSE frame through the REAL transport/parser/pairing pipeline.
  emitFrame(event: string, data: any, id: string | null) {
    const controller = world.sseController;
    if (!controller) return false;
    controller.enqueue(encoder.encode(`event: ${event}\n${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`));
    return true;
  },
  waitForText(text: string) { return waitFor(() => (document.querySelector('.task-queue')?.textContent ?? '').includes(text)); },
  waitForGone(text: string) { return waitFor(() => !(document.querySelector('.task-queue')?.textContent ?? '').includes(text)); },
  waitForPredicate(predicateSrc: string, timeoutMs = 3000) { return waitFor(new Function(`return (${predicateSrc})()`) as () => boolean, timeoutMs); },
  clickByAria(label: string) { const button = buttonByAria(label); if (!button) throw new Error(`no button ${label}`); button.click(); return true; },
  focusByAria(label: string) { const button = buttonByAria(label); if (!button) throw new Error(`no button ${label}`); button.focus(); return true; },
  setInput(value: string) {
    const input = document.getElementById('task-queue-concurrency-input') as HTMLInputElement | null;
    if (!input) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  state,
  lastSeq() { return recorded.length; },
  callsAfter(seq: number) { return recorded.filter((call) => call.seq > seq).map((call) => ({ method: call.method, path: call.path, body: call.body, lastEventId: call.lastEventId })); },
};
