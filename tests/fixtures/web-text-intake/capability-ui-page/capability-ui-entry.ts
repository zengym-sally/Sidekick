// In-page mount harness for the capability-UI behavioral faces (MAYNE-24).
//
// This module runs INSIDE headless Chrome, served by the session's Vite dev
// server straight from the repo root, so every panel below is the REAL
// production SFC compiled by the production Vite pipeline
// (@vitejs/plugin-vue from the repo vite.config.ts), and every store is the
// REAL production factory from src/stores/*.ts.
//
// The one substitution is at the documented store-injection seam: the
// factories take a `Backend` transport parameter for exactly this purpose
// ("Tests and fixtures may still construct or inject their own client",
// src/lib/web-api-client.ts), and this harness injects a RECORDING transport
// that logs every command and answers with seed fixtures. No production
// judgment is re-implemented here: the guard callbacks below are the
// production store wiring lines verbatim (useAgents/useOrganizer in
// src/stores/agents.ts / organizer.ts) with `invoke` swapped for the recorder,
// and the responder answers live at the backend boundary only.
//
// Faces OBSERVE and return plain JSON; all judgment (assertions) lives in the
// committed test file tests/unit/web-text-intake-capability-ui.test.mjs.
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createPinia, defineStore } from 'pinia';
import AgentSettingsPanel from '../../../../src/components/AgentSettingsPanel.vue';
import ModelSettingsPanel from '../../../../src/components/ModelSettingsPanel.vue';
import SettingsPanel from '../../../../src/components/SettingsPanel.vue';
import { createAgentSettings } from '../../../../src/stores/agents.ts';
import { createModelSettings } from '../../../../src/stores/models.ts';
import { createOrganizerModel } from '../../../../src/stores/organizer.ts';
import { createApplicationSettings } from '../../../../src/stores/settings.ts';

interface Call { command: string; args: unknown }
interface Seed {
  configuration?: unknown;
  agentConfigs?: Record<string, unknown>;
  savedAgentConfig?: unknown;
  failAgentSave?: boolean;
  testRun?: unknown;
  preload?: string[];
  withNativeFlag?: boolean;
}
type StoreHandle = Record<string, any>;

let calls: Call[] = [];
let respond: (command: string, args: Record<string, unknown>) => unknown = () => null;
let app: ReturnType<typeof createApp> | null = null;
let stores: Record<string, StoreHandle> = {};
let emitted: Array<[string, unknown]> = [];

// The recording transport: request counting happens here, at the exact seam
// the production stores use for every read/write/reset/test command.
const transport = async (command: string, args?: Record<string, unknown>) => {
  calls.push({ command, args: args ?? null });
  return await respond(command, args ?? {});
};

function buildResponder(seed: Seed) {
  // A started run becomes the active run, like the real service: refresh()
  // after a command reconciles run.value against active_model_run, so the
  // seeded backend must track it or the run would vanish from the UI.
  let activeRun: unknown = null;
  return (command: string, args: Record<string, unknown>) => {
    switch (command) {
      case 'read_application_settings':
        return { timeZone: 'Asia/Shanghai', version: 3 };
      case 'read_model_configuration':
        return seed.configuration ?? null;
      case 'read_agent_configuration': {
        const agentId = String(args.agentId ?? '');
        // The frozen server gate (WIRED_AGENT_IDS=['organizer'],
        // server/lib/http-server.mjs requireWiredAgent) answers 404 for the
        // unwired roles; the recorder mirrors that registered fact.
        if (agentId !== 'organizer') {
          throw Object.assign(new Error('未接通的智能体角色。'), { code: 'not_found' });
        }
        return seed.agentConfigs?.organizer ?? null;
      }
      case 'save_agent_configuration':
        if (seed.failAgentSave) {
          throw Object.assign(new Error('工作目录暂时不可用，配置未保存。'), { code: 'WORKSPACE_IO' });
        }
        return { configuration: seed.savedAgentConfig ?? seed.agentConfigs?.organizer ?? null, warning: null };
      case 'test_model':
        activeRun = seed.testRun ?? null;
        return activeRun;
      case 'latest_agent_trial':
      case 'active_agent_trial':
      case 'read_agent_trial':
        return null;
      case 'list_import_batches':
        return [];
      case 'active_model_run':
        return activeRun ? (activeRun as { id: string }).id : null;
      case 'read_model_run':
        return activeRun;
      case 'read_import_batch':
        return null;
      case 'workspace_info':
        return { root: '/tmp/capability-ui-root', needsSetup: false, pendingRoot: null };
      default:
        throw Object.assign(new Error('不支持的命令：' + command), { code: 'unsupported_command' });
    }
  };
}

function wipeHost() {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (app) {
    app.unmount();
    app = null;
  }
  const host = document.getElementById('capui-root');
  if (host) host.innerHTML = '';
  document.querySelectorAll('.sk-select-popup').forEach((node) => node.remove());
  stores = {};
  calls = [];
  emitted = [];
}

function waitFor(name: string, predicate: () => boolean, timeoutMs = 4000, stepMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok = false;
      try { ok = predicate(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() >= deadline) {
        return reject(new Error(`waitFor timeout [${name}]; calls=${JSON.stringify(callCommands())}; emitted=${JSON.stringify(emitted)}`));
      }
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mountPanel(panel: 'agents' | 'models' | 'settings', seed: Seed, props: Record<string, unknown> = {}) {
  wipeHost();
  respond = buildResponder(seed);
  const pinia = createPinia();
  // Injection wrappers replicate the production wiring lines verbatim with the
  // recording transport in place of the native invoke (see file header).
  const useModelsR = defineStore('models', () => createModelSettings(transport));
  const useAgentsR = defineStore('agents', () => createAgentSettings(transport, () => {
    const model = useModelsR();
    if (!model.ready || model.loading || model.saving) throw Error('请先在模型服务重新读取并核对配置。');
  }));
  const useOrganizerR = defineStore('organizer', () => createOrganizerModel(transport, (command: string) => {
    const model = useModelsR();
    if (!model.ready || model.loading || model.saving) throw Error('请先在模型服务重新读取并核对配置。');
    if (command !== 'test_model') {
      const role = useAgentsR().states.organizer;
      if (!role.ready || role.loading || role.saving) throw Error('请先在智能体页重新读取并核对事项整理配置。');
    }
  }));
  const useSettingsR = defineStore('settings', () => createApplicationSettings(transport));
  if (seed.preload?.includes('settings')) await useSettingsR(pinia).load();
  if (seed.preload?.includes('models')) await useModelsR(pinia).load();
  if (seed.preload?.includes('agent-organizer')) await useAgentsR(pinia).load('organizer');
  stores = {
    models: useModelsR(pinia),
    agents: useAgentsR(pinia),
    organizer: useOrganizerR(pinia),
    settings: useSettingsR(pinia),
  };
  // The face counts requests issued by the PANEL: the counter resets after the
  // preload phase, before the mount.
  calls = [];
  emitted = [];
  const tab = ref(String(props.tab ?? ''));
  const panelComponent = () => {
    if (panel === 'agents') return h(AgentSettingsPanel);
    if (panel === 'models') return h(ModelSettingsPanel);
    return h(SettingsPanel, {
      tab: tab.value,
      root: String(props.root ?? '/tmp/capability-ui-root'),
      onSelectTab: (value: string) => { emitted.push(['selectTab', value]); tab.value = value; },
      onOpenDirectory: () => { emitted.push(['openDirectory']); },
    });
  };
  const HostApp = defineComponent({
    setup() {
      return () => {
        const children: ReturnType<typeof h>[] = [];
        // Standalone panel mounts provide the same Teleport anchors the real
        // SettingsPanel shell provides; the settings mount renders the real
        // shell, which brings its own.
        if (panel !== 'settings') children.push(h('div', { id: 'settings-heading-actions' }));
        if (panel !== 'settings') children.push(h('div', { id: 'settings-save-slot' }));
        children.push(panelComponent());
        return h('div', { id: 'capui-page' }, children);
      };
    },
  });
  app = createApp(HostApp);
  app.use(pinia);
  const hostEl = document.getElementById('capui-root');
  if (!hostEl) throw new Error('#capui-root missing');
  app.mount(hostEl);
}

// ---- DOM helpers -----------------------------------------------------------

const buttons = (selector = 'button') => [...document.querySelectorAll<HTMLButtonElement>(selector)];
const buttonByText = (text: string, selector = 'button') =>
  buttons(selector).find((b) => (b.textContent || '').trim() === text);
const buttonContaining = (text: string, selector = 'button') =>
  buttons(selector).find((b) => (b.textContent || '').includes(text));
const textOf = (selector: string) => document.querySelector(selector)?.textContent ?? '';
const tabSnapshot = () => buttons('.agent-role-tabs button').map((b) => ({
  text: (b.textContent || '').trim(),
  disabled: b.disabled,
  pressed: b.getAttribute('aria-pressed'),
}));
const callCommands = () => calls.map((c) => c.command);

// ---- Faces (observe only; assertions live in the test file) ----------------

async function faceRoleTabs(seed: Seed) {
  await mountPanel('agents', seed);
  await waitFor('agents organizer ready', () => stores.agents.states.organizer.ready === true);
  await waitFor('agent trial probe', () => calls.some((c) => c.command === 'latest_agent_trial'));
  const tabsBefore = tabSnapshot();
  const tracker = buttonContaining('进展跟踪', '.agent-role-tabs button');
  tracker?.click();
  await settle(150);
  return {
    tabsBefore,
    tabsAfter: tabSnapshot(),
    selectedAfter: stores.agents.selected,
    callsAfterTrackerClick: callCommands(),
  };
}

async function faceModelMountRequests(seed: Seed) {
  // No preload: the mount-time requests ARE the behavior under observation.
  await mountPanel('models', seed);
  await waitFor('model config ready', () => stores.models.ready === true);
  await waitFor('organizer pre-read settled', () => stores.agents.states.organizer.ready === true);
  await settle(200);
  return { calls: calls.map((c) => ({ command: c.command, agentId: (c.args as Record<string, unknown> | null)?.agentId ?? null })) };
}

async function faceTrialDisabled(seed: Seed) {
  await mountPanel('agents', seed);
  await waitFor('agents organizer ready', () => stores.agents.states.organizer.ready === true);
  await waitFor('agent trial probe', () => calls.some((c) => c.command === 'latest_agent_trial'));
  const start = buttonByText('开始隔离试跑');
  const note = textOf('.agent-trial-pane p[role="note"]');
  const sample = document.querySelector<HTMLTextAreaElement>('.agent-trial-pane textarea');
  const callsBefore = callCommands();
  start?.click();
  await settle(150);
  const resultTab = buttonByText('结果', '.agent-trial-tabs button');
  resultTab?.click();
  await settle(100);
  return {
    startFound: !!start,
    startDisabled: start?.disabled ?? null,
    sampleDisabled: sample?.disabled ?? null,
    noteText: note,
    resultText: textOf('.trial-outcome'),
    callsAfterStartClick: callCommands().filter((c) => !callsBefore.includes(c)),
  };
}

async function faceTrialNativeFlag(seed: Seed) {
  // A Tauri-like host flag is present during this mount; the trial entry must
  // stay disabled regardless of any host flag (trialWired is not host-gated).
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: async () => { throw new Error('native bridge is not exercised by this face'); },
  };
  try {
    return await faceTrialDisabled(seed);
  } finally {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
}

async function faceCredentialHelp(seed: Seed) {
  await mountPanel('models', seed);
  await waitFor('model config ready', () => stores.models.ready === true);
  await settle(150);
  const editor = document.querySelector('.catalog-editor');
  const fields = [...editor?.querySelectorAll<HTMLElement>('.sk-field') ?? []];
  const apiKeyField = fields.find((f) => (f.querySelector('label')?.textContent || '').trim().startsWith('API Key'));
  const authField = fields.find((f) => (f.querySelector('label')?.textContent || '').trim().startsWith('认证方式'));
  const authTrigger = authField?.querySelector<HTMLInputElement>('.sk-select input') ?? null;
  const secretInput = apiKeyField?.querySelector<HTMLInputElement>('input[type="password"]') ?? null;
  const pageText = editor?.textContent ?? '';
  return {
    authTriggerLabel: authTrigger?.value ?? null,
    keyHelp: apiKeyField?.querySelector('small.muted')?.textContent?.trim() ?? '',
    keyPlaceholder: secretInput?.getAttribute('placeholder') ?? null,
    credentialStatusText: apiKeyField?.querySelector('p[role="status"]')?.textContent?.trim() ?? '',
    promisesKeychainWrite: pageText.includes('密钥将写入系统钥匙串'),
    mentionsDesktopKeychain: pageText.includes('或在桌面端填写密钥'),
    mentionsKeychainLabel: pageText.includes('API Key · 钥匙串'),
  };
}

async function faceSettingsTabs(seed: Seed) {
  await mountPanel('settings', seed, { tab: 'about' });
  await waitFor('settings ready', () => stores.settings.ready === true);
  await settle(150);
  const aboutText = textOf('#settings-panel-about');
  const agentsTab = buttonByText('智能体', '.settings-tabs button');
  agentsTab?.click();
  await waitFor('agents section mounted', () => !!document.querySelector('#settings-panel-agents'));
  await waitFor('nested organizer ready', () => stores.agents.states.organizer.ready === true);
  const headerAfterAgentsClick = textOf('.settings-heading p');
  const agentsTabsAfter = tabSnapshot();
  const modelsTab = buttonByText('模型服务', '.settings-tabs button');
  modelsTab?.click();
  await waitFor('models section mounted', () => !!document.querySelector('#settings-panel-models'));
  const headerAfterModelsClick = textOf('.settings-heading p');
  return {
    aboutText,
    emitted,
    headerAfterAgentsClick,
    agentsTabsAfter,
    headerAfterModelsClick,
    modelsPanelPresent: !!document.querySelector('#settings-panel-models'),
  };
}

async function faceDraftRetention(seed: Seed, typed: string) {
  await mountPanel('agents', seed);
  await waitFor('agents organizer ready', () => stores.agents.states.organizer.ready === true);
  await waitFor('agent trial probe', () => calls.some((c) => c.command === 'latest_agent_trial'));
  const form = document.querySelector<HTMLTextAreaElement>('.agent-config-form textarea');
  if (!form) return { formFound: false };
  form.value = typed;
  form.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  const draftAfterType = stores.agents.states.organizer.draft.supplementalInstructions;
  const saveButton = buttonByText('保存偏好');
  saveButton?.click();
  await waitFor('failed save settled', () => calls.some((c) => c.command === 'save_agent_configuration') && stores.agents.states.organizer.saving === false);
  const errorText = textOf('.agent-config-form .profile-alert p');
  const reread = buttonContaining('重新读取，保留草稿', '.agent-config-form button');
  const rereadDisabled = reread?.disabled ?? null;
  reread?.click();
  await waitFor('re-read settled', () => stores.agents.states.organizer.loading === false && calls.some((c) => c.command === 'read_agent_configuration'));
  await settle(120);
  const formAfter = document.querySelector<HTMLTextAreaElement>('.agent-config-form textarea');
  return {
    formFound: true,
    draftAfterType,
    saveErrorText: errorText,
    rereadFound: !!reread,
    rereadDisabled,
    draftAfterReread: formAfter?.value ?? null,
    readyAfterReread: stores.agents.states.organizer.ready,
    serverSupplementalInstructions: (seed.savedAgentConfig as { supplementalInstructions?: string } | undefined)?.supplementalInstructions ?? null,
    commands: callCommands(),
  };
}

async function faceConnectivityTest(seed: Seed) {
  await mountPanel('models', seed);
  await waitFor('model config ready', () => stores.models.ready === true);
  await settle(150);
  const testButton = buttonContaining('测试连接');
  const testDisabledBefore = testButton?.disabled ?? null;
  testButton?.click();
  // Wait for the observed OUTCOME (status line rendered or an error recorded),
  // not for the request log: the result must survive the store's refresh.
  await waitFor('connection result rendered', () => !!document.querySelector('.connection-result') || !!stores.organizer.error);
  await settle(150);
  return {
    testButtonFound: !!testButton,
    testDisabledBefore,
    resultText: textOf('.connection-result'),
    organizerError: stores.organizer.error,
    commands: callCommands(),
  };
}

const faces: Record<string, (seed: Seed) => Promise<unknown>> = {
  'role-tabs': faceRoleTabs,
  'model-mount-requests': faceModelMountRequests,
  'trial-disabled': faceTrialDisabled,
  'trial-native-flag': faceTrialNativeFlag,
  'credential-help': faceCredentialHelp,
  'settings-tabs': faceSettingsTabs,
  'draft-retention': (seed: Seed) => faceDraftRetention(seed, '自定义草稿说明，重读后必须保留。'),
  'connectivity-test': faceConnectivityTest,
};

const api = {
  ready: true as const,
  async face(name: string, seed: Seed) {
    const face = faces[name];
    if (!face) throw new Error(`unknown face: ${name}`);
    return await face(seed);
  },
};

(window as unknown as Record<string, unknown>).__capui = api;
export {};
