// Real-compiled mount harness for the MAYNE-37 candidate-operation browser
// faces. It mounts the production PairingGate — the component that owns the
// session bootstrap AND the event routing that turns `candidate.changed`
// hints into `organizer.refresh()` authoritative read-backs — with the
// production InboxView in its slot. The stores run over the real
// WebApiClient against the harness's reverse proxy to the locked D backend,
// so every request the faces observe is a real HTTP write. Nothing here
// injects store state: the faces drive the REAL compiled CandidateCard DOM
// through the components' own click handlers.
//
// Same harness lineage as task-controls-page/ and capability-ui-page/ (real
// modules through the production vite pipeline); the driver lives in
// tests/fixtures/web-text-intake/candidate-operations-browser.mjs.
import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import PairingGate from '../../../../src/components/PairingGate.vue';
import InboxView from '../../../../src/components/InboxView.vue';
import { getWebApiClient } from '../../../../src/lib/web-api-client.ts';
import { useModelSettings } from '../../../../src/stores/models.ts';
import { useAgents } from '../../../../src/stores/agents.ts';

// Native-bridge double (labeled controlled transport in the suite evidence):
// the product composition for candidate operations is the Tauri webview plus
// the web client, and the organizer's action guard requires the model/agent
// configuration stores to be loaded (Workbench.loadNative() does that via
// invoke in the shell). A plain Chrome has no shell, so this page provides
// exactly that missing native side: `invoke` delegates the configuration
// commands to the WebApiClient's own command shims — the frozen web-api/1
// surface (/api/models, /api/agents/:id) answering with the REAL backend
// configuration this suite wrote. No other native capability is faked, and
// the candidate operations under test do not pass through this bridge at
// all (they run through the web client like in the shell).
const webCommands = getWebApiClient().asBackend();
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => webCommands(command, args),
};

const pinia = createPinia();
const app = createApp({ render: () => h(PairingGate, null, { default: () => h(InboxView) }) });
app.use(pinia);
app.mount('#candidate-operations-root');

// Observation-only handle for the suite's failure diagnostics: what the
// inbox store currently holds (batch id + candidate rows). No writes.
void (async () => {
  const { useOrganizer } = await import('../../../../src/stores/organizer.ts');
  const store = useOrganizer(pinia);
  (window as unknown as Record<string, unknown>).__m37batch = () => ({
    selected: store.selected,
    batchId: store.batch?.source?.sourceId ?? null,
    candidates: (store.batch?.candidates ?? []).map((c) => ({ id: c.id, status: c.status, version: c.version })),
    error: store.error,
    reconcileRequired: store.reconcileRequired,
  });
})();

// Observation-only handle for the suite's failure diagnostics: what the
// inbox store currently holds (batch id + candidate rows). No writes.
void (async () => {
  const { useOrganizer } = await import('../../../../src/stores/organizer.ts');
  const store = useOrganizer();
  (window as unknown as Record<string, unknown>).__m37batch = () => ({
    selected: store.selected,
    batchId: store.batch?.source?.sourceId ?? null,
    candidates: (store.batch?.candidates ?? []).map((c) => ({ id: c.id, status: c.status, version: c.version })),
    error: store.error,
    reconcileRequired: store.reconcileRequired,
  });
})();

// The loadNative() equivalent for the two stores the action guard reads.
void (async () => {
  try {
    await useModelSettings().load();
    await useAgents().load('organizer');
    (window as unknown as Record<string, unknown>).__m37configReady = true;
  } catch (error) {
    (window as unknown as Record<string, unknown>).__m37configError = String(error);
  }
})();
function cardElement(index = 0): Element | null {
  return document.querySelectorAll('article.candidate-card')[index] ?? null;
}
function textOf(node: Element | null): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const api = {
  ready: true as const,
  card(index = 0) {
    const article = cardElement(index);
    if (!article) return { present: false };
    const previewError = article.querySelector('.revision-preview .form-error');
    return {
      present: true,
      pill: textOf(article.querySelector('header.candidate-heading .pill')),
      title: (article.querySelector('.candidate-fields input[maxlength="200"]') as HTMLInputElement | null)?.value ?? null,
      buttons: [...article.querySelectorAll('button')].map((node) => ({ label: textOf(node), disabled: (node as HTMLButtonElement).disabled })),
      error: textOf(article.querySelector('.form-error')),
      alert: textOf(article.querySelector('.profile-alert')),
      preview: textOf(article.querySelector('.revision-preview h3')) || null,
      previewError: previewError ? textOf(previewError) : null,
    };
  },
  cardCount() { return document.querySelectorAll('article.candidate-card').length; },
  // Observation-only: the harness page reads (never writes) the live store
  // state so failures can report what the inbox actually holds.
  diag() {
    const store = window.__m37batch?.();
    return store ?? null;
  },
  async clickButton(label: string, index = 0) {
    const article = cardElement(index);
    if (!article) return { ok: false, reason: 'no candidate card in the live DOM' };
    const button = [...article.querySelectorAll('button')].find((node) => textOf(node) === label);
    if (!button) return { ok: false, reason: `button not found: ${label}` };
    if ((button as HTMLButtonElement).disabled) return { ok: false, reason: `button disabled: ${label}` };
    (button as HTMLButtonElement).click();
    return { ok: true };
  },
  async fillTitle(value: string, index = 0) {
    const input = cardElement(index)?.querySelector('.candidate-fields input[maxlength="200"]') as HTMLInputElement | null;
    if (!input) return { ok: false, reason: 'title input not found' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { ok: true };
  },
  async fillOwner(value: string, index = 0) {
    const input = cardElement(index)?.querySelector('.candidate-fields input[maxlength="100"]') as HTMLInputElement | null;
    if (!input) return { ok: false, reason: 'owner input not found' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { ok: true };
  },
  async fillTags(value: string, index = 0) {
    const input = cardElement(index)?.querySelector('.candidate-fields input[placeholder="用逗号分隔"]') as HTMLInputElement | null;
    if (!input) return { ok: false, reason: 'tags input not found' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { ok: true };
  },
  async requestRevision(instruction: string, index = 0) {
    const article = cardElement(index);
    if (!article) return { ok: false, reason: 'no candidate card' };
    const details = article.querySelector('details.candidate-revision') as HTMLDetailsElement | null;
    if (!details) return { ok: false, reason: 'revision details not found' };
    details.open = true;
    const textarea = details.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) return { ok: false, reason: 'instruction textarea not found' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, instruction);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const generate = [...details.querySelectorAll('button')].find((node) => /生成修改预览/.test(textOf(node)));
    if (!generate) return { ok: false, reason: 'generate button not found' };
    if ((generate as HTMLButtonElement).disabled) return { ok: false, reason: 'generate button disabled' };
    (generate as HTMLButtonElement).click();
    return { ok: true };
  },
  // In-page observation helper: the faces fetch with the same write contract
  // as the production client (the CSRF token comes from the driver's CDP
  // capture of the app's own writes). NOTE: this page deliberately opens NO
  // second SSE subscription — the app's own fetch stream under test is the
  // only consumer of candidate.changed, and the read-back faces prove the
  // hint behaviorally (state converges with zero extra writes).
  async pageFetch(path: string, body: unknown, csrfToken: string | null) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: location.origin };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body) });
    const text = await response.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* non-JSON kept out */ }
    return { status: response.status, json };
  },
};

(window as unknown as Record<string, unknown>).__m37 = api;
export {};
