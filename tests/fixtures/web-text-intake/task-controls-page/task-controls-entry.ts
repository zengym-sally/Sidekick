// In-page mount harness for the TaskQueue a11y / narrow-viewport faces
// (MAYNE-24 W1 task controls, r3 plan §6/U8).
//
// This module runs INSIDE headless Chrome, served by the driver's Vite dev
// server straight from the repo root, so TaskQueue below is the REAL
// production SFC compiled by the production Vite pipeline, over the REAL
// stores/client. The one substitution is the transport boundary: fetch is
// answered with legal frozen `web-api/1` shapes from a mutable `world`, and
// every call is recorded. Faces OBSERVE and act through REAL DOM events
// (element.click(), native focus); all judgment lives in the driver
// tests/fixtures/web-text-intake/task-controls-browser.mjs.
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import TaskQueue from '../../../../src/components/TaskQueue.vue';

interface Call { seq: number; method: string; path: string; query: string; body: any }
interface World {
  tasks: any[];
  concurrency: any;
  result: any;
  actionReply: { status: number; body: any } | null;
  postActionTasks: any[] | null;
}

const recorded: Call[] = [];
const world: World = {
  tasks: [],
  concurrency: { contractVersion: 'web-api/1', agentConcurrency: 3, default: 3, version: 0, runningCount: 2, queuedCount: 1 },
  result: null,
  actionReply: null,
  postActionTasks: null,
};

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const call: Call = {
    seq: recorded.length + 1,
    method: init?.method ?? 'GET',
    path,
    query: q === -1 ? '' : url.slice(q + 1),
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
  };
  recorded.push(call);
  if (path === '/api/tasks' && call.method === 'GET') {
    return respond(200, { contractVersion: 'web-api/1', tasks: world.tasks, nextCursor: null });
  }
  if (path === '/api/settings/agent-concurrency' && call.method === 'GET') {
    return respond(200, { ...world.concurrency });
  }
  if (path === '/api/settings/agent-concurrency' && call.method === 'PUT') {
    if (world.actionReply) return respond(world.actionReply.status, world.actionReply.body);
    Object.assign(world.concurrency, {
      agentConcurrency: call.body.agentConcurrency,
      version: (world.concurrency.version ?? 0) + 1,
    });
    return respond(200, { ...world.concurrency });
  }
  const action = /^\/api\/tasks\/([^/]+)\/(cancel|retry|resolve)$/.exec(path);
  if (action && call.method === 'POST') {
    // The authoritative set may converge exactly when the action reply lands
    // (transport-boundary seeding): the action's own fenced read-back then
    // observes the new set deterministically.
    if (world.postActionTasks) world.tasks = world.postActionTasks;
    if (world.actionReply) return respond(world.actionReply.status, world.actionReply.body);
    return respond(202, { contractVersion: 'web-api/1', task: { taskId: action[1] } });
  }
  if (path.endsWith('/result') && call.method === 'GET') {
    return respond(200, world.result);
  }
  return respond(404, { contractVersion: 'web-api/1', error: { code: 'not_found', message: `unscripted ${call.method} ${path}` } });
}) as typeof fetch;

const configRevision = ref<string | null>(null);
const pinia = createPinia();
const app = createApp({
  setup() { return () => h(TaskQueue, { configRevision: configRevision.value }); },
});
app.use(pinia);
app.mount('#task-controls-root');

const waitFor = (predicate: () => boolean, timeoutMs = 3000): Promise<true> => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs;
  const tick = () => {
    try {
      if (predicate()) { resolve(true); return; }
    } catch (error) { reject(error); return; }
    if (Date.now() > deadline) { reject(new Error('in-page waitFor timeout')); return; }
    setTimeout(tick, 25);
  };
  tick();
});

const buttonByAria = (label: string): HTMLElement | null => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.task-queue button'));
  return buttons.find((button) => button.getAttribute('aria-label') === label) ?? null;
};

const describeActive = () => {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return null;
  return {
    tag: active.tagName.toLowerCase(),
    ariaLabel: active.getAttribute('aria-label'),
    id: active.id,
    insideRow: active.closest('li')?.id ?? null,
    isListContainer: active.tagName === 'UL',
  };
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
  return {
    text: root?.textContent ?? '',
    docScrollWidth: doc.scrollWidth,
    docClientWidth: doc.clientWidth,
    buttons,
    activeElement: describeActive(),
    alerts: Array.from(root?.querySelectorAll('[role="alert"]') ?? []).map((el) => el.textContent?.trim() ?? ''),
    live: root?.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '',
    busyRows: Array.from(root?.querySelectorAll('li[aria-busy="true"]') ?? []).map((el) => el.id),
    checkboxStates: Array.from(root?.querySelectorAll('input[type="checkbox"]') ?? []).map((el) => ({
      checked: (el as HTMLInputElement).checked, disabled: (el as HTMLInputElement).disabled,
      labelText: (el.closest('label')?.textContent ?? '').trim(),
    })),
    numberInputValue: (root?.querySelector('input[type="number"]') as HTMLInputElement | null)?.value ?? null,
  };
};

window.__taskControls = {
  ready: true,
  world,
  recorded,
  async seed(rows: any[]) {
    world.tasks = rows;
    world.actionReply = null;
    world.result = null;
    await waitFor(() => (document.querySelector('.task-queue')?.textContent ?? '').length > 0);
    return true;
  },
  setActionReply(reply: { status: number; body: any } | null) {
    world.actionReply = reply;
    return true;
  },
  setPostActionTasks(rows: any[] | null) {
    world.postActionTasks = rows;
    return true;
  },
  setResult(payload: any) {
    world.result = payload;
    return true;
  },
  setConcurrency(payload: any) {
    Object.assign(world.concurrency, payload);
    return true;
  },
  setConfigRevision(value: string | null) {
    configRevision.value = value;
    return true;
  },
  callsAfter(seq: number) {
    return recorded.filter((call) => call.seq > seq);
  },
  lastSeq() {
    return recorded.length;
  },
  async clickByAria(label: string) {
    const button = buttonByAria(label);
    if (!button) throw new Error(`no button with aria-label ${label}`);
    button.click();
    return true;
  },
  async focusByAria(label: string) {
    const button = buttonByAria(label);
    if (!button) throw new Error(`no button with aria-label ${label}`);
    button.focus();
    return true;
  },
  async setInput(value: string) {
    const input = document.querySelector<HTMLInputElement>('.task-queue input[type="number"]');
    if (!input) throw new Error('no concurrency number input');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  async toggleReceipt(needle: string, checked: boolean) {
    const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('.task-receipt'));
    const label = labels.find((el) => (el.textContent ?? '').includes(needle));
    if (!label) throw new Error(`no receipt label containing ${needle}`);
    const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input || input.disabled) throw new Error(`receipt ${needle} is not checkable`);
    input.checked = checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  async waitForText(needle: string, timeoutMs = 3000) {
    await waitFor(() => (document.querySelector('.task-queue')?.textContent ?? '').includes(needle), timeoutMs);
    return true;
  },
  async waitForPredicate(expression: string, timeoutMs = 3000) {
    const predicate = new Function(`return (${expression})();`) as () => boolean;
    await waitFor(() => predicate() === true, timeoutMs);
    return true;
  },
  state,
};
