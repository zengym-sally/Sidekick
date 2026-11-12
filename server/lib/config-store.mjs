//! Workspace-root configuration store (`config/` files).
//!
//! The web backend keeps provider/model/organizer configuration as JSON files
//! under `<root>/config/` — the same layout the legacy Rust store used — so the
//! frozen `web-api/1` model/agent endpoints can be served without a new table.
//! Writes are atomic (temporary file + rename, 0600) and compare-and-set on the
//! revision returned by the last read.
//!
//! Secrets are never stored here: a provider carries either `apiKeyEnv` (a host
//! variable name) or `apiKeyRef` (a provider-side reference resolved by the
//! CredentialProvider). Plaintext API keys submitted over HTTP are rejected.

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalize, ServiceError } from './manual-items-service.mjs';

const MODELS_FILE = 'models.json';
const PROVIDERS_FILE = 'providers.json';
const AGENTS_DIR = 'agents';
/// The fixed agent-role set of the configuration domain (the W2+ three-role
/// reserve). Exported so the HTTP face can tell a known-but-unwired role
/// apart from an unknown identifier; the reserve itself is unchanged.
export const AGENT_IDS = ['organizer', 'tracker', 'advisor'];
const DEFAULT_AGENT_PREFERENCES = {
  organizer: { detail: 'standard', focus: 'balanced' },
  tracker: { detail: 'standard', focus: 'evidence' },
  advisor: { detail: 'standard', focus: 'deadline' },
};

function validation(message) {
  return new ServiceError('validation_failed', message);
}

function conflict(message) {
  return new ServiceError('version_conflict', message);
}

function revisionOf(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex').slice(0, 32);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/// Identifier rule shared with the legacy store: non-empty, bounded, and
/// restricted to a safe alphabet so a value can never escape its JSON field.
function identifier(value, label) {
  if (typeof value !== 'string' || !value || value.length > 128) {
    throw validation(`${label}无效。`);
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) throw validation(`${label}无效。`);
  return value;
}

/// Credential references may be `env:<NAME>` or a provider-side reference, so
/// the alphabet is wider than a plain identifier (which stays strict).
function credentialRef(value, label) {
  if (typeof value !== 'string' || !value || value.length > 256) throw validation(`${label}无效。`);
  if (!/^[A-Za-z0-9._:/-]+$/.test(value)) throw validation(`${label}无效。`);
  return value;
}

/// Fields the frozen configuration model knows. Anything else is dropped, and
/// anything that looks like a secret is rejected outright (legacy
/// `reject_plain_secrets`): a provider/model document must never carry a
/// plaintext key, whatever the client sends.
const PROVIDER_FIELDS = ['id', 'name', 'apiFormat', 'baseUrl', 'auth', 'enabled', 'network', 'extraHeaders'];
const MODEL_FIELDS = ['id', 'providerId', 'apiModelId', 'name', 'description', 'enabled', 'status', 'aliases', 'limits', 'capabilities', 'reasoning', 'defaultParams', 'pricing'];
const SECRET_FIELD = /(secret|token|password|passwd|credential|authCode|privateKey)/i;
const SECRET_EXACT = /^(apiKey|apiToken|key)$/i;
/// `apiKeyRef`/`apiKeyEnv` are references, not secrets; everything else that
/// looks like a key is rejected.
function isSecretKey(key) {
  if (key === 'apiKeyRef' || key === 'apiKeyEnv') return false;
  return SECRET_EXACT.test(key) || SECRET_FIELD.test(key);
}

function pickAllowed(raw, allowed, label) {
  if (!isPlainObject(raw)) throw validation(`${label}无效。`);
  const picked = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isSecretKey(key)) {
      throw new ServiceError('plain_credential', '配置不接受明文密钥，请改用凭据引用。');
    }
    if (allowed.includes(key)) picked[key] = value;
  }
  return picked;
}

function normalizeProvider(raw) {
  if (!isPlainObject(raw)) throw validation('供应商配置无效。');
  const id = identifier(raw.id, '供应商 ID');
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw validation('供应商名称无效。');
  if (typeof raw.baseUrl !== 'string' || !/^https?:\/\//.test(raw.baseUrl)) {
    throw validation('服务地址无效。');
  }
  let url;
  try {
    url = new URL(raw.baseUrl);
  } catch {
    throw validation('服务地址无效。');
  }
  if (url.username || url.password) throw validation('服务地址不能包含认证信息。');
  for (const key of url.searchParams.keys()) {
    if (SECRET_FIELD.test(key)) throw validation('服务地址不能包含认证信息。');
  }
  const auth = isPlainObject(raw.auth) ? pickAllowed(raw.auth, ['type', 'apiKeyEnv', 'apiKeyRef'], '认证方式') : {};
  const authMode = auth.apiKeyRef ? 'key' : 'env';
  const provider = {
    ...pickAllowed(raw, PROVIDER_FIELDS, '供应商配置'),
    id,
    name: raw.name.trim(),
    apiFormat: typeof raw.apiFormat === 'string' ? raw.apiFormat : 'openai-compatible',
    baseUrl: raw.baseUrl.trim(),
    auth: { type: 'bearer' },
    enabled: raw.enabled !== false,
  };
  if (authMode === 'env') {
    const env = typeof auth.apiKeyEnv === 'string' ? auth.apiKeyEnv : '';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env)) throw validation('环境变量名称无效。');
    provider.auth.apiKeyEnv = env;
  } else {
    provider.auth.apiKeyRef = credentialRef(auth.apiKeyRef, '凭据引用');
  }
  return provider;
}

function normalizeModel(raw) {
  if (!isPlainObject(raw)) throw validation('模型配置无效。');
  const id = identifier(raw.id, '模型 ID');
  if (typeof raw.providerId !== 'string' || !raw.providerId) throw validation('模型所属供应商无效。');
  if (typeof raw.apiModelId !== 'string' || !raw.apiModelId.trim()) throw validation('模型 API 标识无效。');
  return {
    ...pickAllowed(raw, MODEL_FIELDS, '模型配置'),
    id,
    providerId: raw.providerId,
    apiModelId: raw.apiModelId.trim(),
    name: typeof raw.name === 'string' ? raw.name : raw.apiModelId.trim(),
    enabled: raw.enabled !== false && raw.status !== 'disabled',
  };
}

function normalizeProvidersDocument(value) {
  if (!isPlainObject(value) || !Array.isArray(value.providers)) throw validation('供应商配置无效。');
  return { providers: value.providers.map(normalizeProvider) };
}

function normalizeModelsDocument(value, defaultModelId, revision) {
  if (!isPlainObject(value) || !Array.isArray(value.models)) throw validation('模型配置无效。');
  const models = value.models.map(normalizeModel);
  return {
    models,
    sidekick: { version: 1, defaultModelId, revision },
  };
}

export class ConfigStore {
  constructor({ root, credentialProvider = null, now = () => Date.now() }) {
    this.root = root;
    this.credentialProvider = credentialProvider;
    this.now = now;
  }

  configDirectory() {
    return join(this.root, 'config');
  }

  agentsDirectory() {
    return join(this.configDirectory(), AGENTS_DIR);
  }

  /// The config directory and every file inside it must be real directories /
  /// regular files with one link: a symlink swap must never be read or written.
  ensureConfigDirectory() {
    const directory = this.configDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    let metadata;
    try {
      metadata = lstatSync(directory);
    } catch {
      throw new ServiceError('invalid_model_config', '配置目录无效。');
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new ServiceError('invalid_model_config', '配置目录无效。');
    }
    return directory;
  }

  filePath(name) {
    const path = join(this.ensureConfigDirectory(), name);
    let metadata;
    try {
      metadata = lstatSync(path);
    } catch {
      return path;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      throw new ServiceError('invalid_model_config', '配置文件无效。');
    }
    return path;
  }

  agentPath(agentId) {
    if (!AGENT_IDS.includes(agentId)) throw validation('智能体角色无效。');
    mkdirSync(this.agentsDirectory(), { recursive: true, mode: 0o700 });
    return this.filePath(`${AGENTS_DIR}/${agentId}.json`);
  }

  readJson(path) {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new ServiceError('invalid_model_config', '配置文件无法识别。');
    }
  }

  writeJson(path, value) {
    const temporary = `${path}.tmp-${process.pid}-${this.now()}`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    try {
      renameSync(temporary, path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  async readModelConfiguration() {
    const providersPath = this.filePath(PROVIDERS_FILE);
    const modelsPath = this.filePath(MODELS_FILE);
    if (!existsSync(providersPath) && !existsSync(modelsPath)) return null;
    const providers = normalizeProvidersDocument(this.readJson(providersPath) ?? { providers: [] });
    const modelsRaw = this.readJson(modelsPath) ?? { models: [], sidekick: null };
    if (!isPlainObject(modelsRaw) || !Array.isArray(modelsRaw.models)) {
      throw new ServiceError('invalid_model_config', '模型配置无法识别。');
    }
    const sidekick = isPlainObject(modelsRaw.sidekick) ? modelsRaw.sidekick : {};
    const defaultModelId = identifier(sidekick.defaultModelId ?? '', '默认模型');
    const revision = identifier(sidekick.revision ?? '', '配置修订');
    const models = normalizeModelsDocument(modelsRaw, defaultModelId, revision);
    const credentialStatus = {};
    for (const provider of providers.providers) {
      credentialStatus[provider.id] = await this.credentialStatusFor(provider);
    }
    return {
      providers,
      models,
      defaultModelId,
      revision,
      credentialStatus,
    };
  }

  /// Credential status comes only from the injected provider: never from a host
  /// environment read. An `apiKeyEnv` provider is expressed as the synthetic
  /// reference `env:<NAME>` so the controlled provider can answer it.
  async credentialStatusFor(provider) {
    if (!this.credentialProvider) return 'unavailable';
    const auth = provider.auth ?? {};
    const ref = auth.apiKeyRef ?? (auth.apiKeyEnv ? `env:${auth.apiKeyEnv}` : null);
    if (!ref) return 'missing';
    const status = await this.credentialProvider.status(ref);
    return status.status;
  }

  async writeModelConfiguration(input, expectedRevision) {
    if (!isPlainObject(input)) throw validation('配置内容无效。');
    if (input.apiKeys !== undefined && Object.keys(input.apiKeys ?? {}).length) {
      // The web surface never accepts plaintext secrets: a provider carries a
      // reference (env name or provider ref), resolved privately at run time.
      throw new ServiceError('plain_credential', '配置接口不接受明文密钥，请改用凭据引用。');
    }
    const providers = normalizeProvidersDocument({ providers: input.providers ?? [] });
    const modelsRaw = { models: input.models ?? [] };
    if (!Array.isArray(modelsRaw.models)) throw validation('模型配置无效。');
    const models = modelsRaw.models.map(normalizeModel);
    const defaultModelId = identifier(input.defaultModelId ?? '', '默认模型');
    if (!models.some((model) => model.id === defaultModelId && model.enabled !== false)) {
      throw validation('默认模型无效或已停用。');
    }
    for (const model of models) {
      if (!providers.providers.some((provider) => provider.id === model.providerId)) {
        throw validation('模型所属供应商不存在。');
      }
    }
    const current = await this.readModelConfiguration();
    const currentRevision = current?.revision ?? '';
    if (currentRevision !== (expectedRevision ?? '')) {
      throw conflict('配置已有更新，请重新读取后重试。');
    }
    const next = { providers: providers.providers, models, defaultModelId };
    const revision = revisionOf(next);
    const providersPath = this.filePath(PROVIDERS_FILE);
    const modelsPath = this.filePath(MODELS_FILE);
    this.writeJson(providersPath, providers);
    try {
      this.writeJson(modelsPath, normalizeModelsDocument({ models }, defaultModelId, revision));
    } catch (error) {
      // Roll the providers file back to the previously committed document so a
      // failed save never leaves the two files describing different revisions.
      if (current) this.writeJson(providersPath, current.providers);
      throw error;
    }
    return {
      configuration: await this.readModelConfiguration(),
      warning: null,
    };
  }

  async readAgent(agentId) {
    const path = this.agentPath(agentId);
    const raw = this.readJson(path);
    if (!raw) {
      const draft = {
        version: 1,
        agentId,
        revision: '',
        modelId: null,
        preferences: { ...DEFAULT_AGENT_PREFERENCES[agentId] },
        supplementalInstructions: '',
      };
      draft.revision = revisionOf({ ...draft, revision: '' });
      return draft;
    }
    return this.normalizeAgent(raw, agentId);
  }

  normalizeAgent(raw, agentId) {
    if (!isPlainObject(raw) || raw.agentId !== agentId) throw new ServiceError('invalid_agent_config', '智能体配置无法识别。');
    const preferences = isPlainObject(raw.preferences) ? raw.preferences : {};
    return {
      version: 1,
      agentId,
      revision: identifier(raw.revision ?? '', '配置修订'),
      modelId: raw.modelId === null || raw.modelId === undefined ? null : identifier(raw.modelId, '模型'),
      preferences: {
        detail: typeof preferences.detail === 'string' ? preferences.detail : 'standard',
        focus: typeof preferences.focus === 'string' ? preferences.focus : DEFAULT_AGENT_PREFERENCES[agentId].focus,
      },
      supplementalInstructions: typeof raw.supplementalInstructions === 'string' ? raw.supplementalInstructions : '',
    };
  }

  async writeAgent(agentId, input, expectedRevision) {
    if (!AGENT_IDS.includes(agentId)) throw validation('智能体角色无效。');
    const current = await this.readAgent(agentId);
    if (current.revision !== (expectedRevision ?? '')) {
      throw conflict('配置已有更新，请重新读取后重试。');
    }
    const draft = isPlainObject(input) ? input : {};
    const modelId = draft.modelId === null || draft.modelId === undefined ? null : identifier(draft.modelId, '模型');
    const preferences = isPlainObject(draft.preferences) ? draft.preferences : {};
    const next = {
      version: 1,
      agentId,
      revision: '',
      modelId,
      preferences: {
        detail: typeof preferences.detail === 'string' ? preferences.detail : 'standard',
        focus: typeof preferences.focus === 'string' ? preferences.focus : DEFAULT_AGENT_PREFERENCES[agentId].focus,
      },
      supplementalInstructions: typeof draft.supplementalInstructions === 'string' ? draft.supplementalInstructions : '',
    };
    next.revision = revisionOf({ ...next, revision: '' });
    this.writeJson(this.agentPath(agentId), next);
    return { configuration: await this.readAgent(agentId), warning: null };
  }

  async resetAgent(agentId, expectedRevision) {
    const current = await this.readAgent(agentId);
    if (current.revision !== (expectedRevision ?? '')) {
      throw conflict('配置已有更新，请重新读取后重试。');
    }
    rmSync(this.agentPath(agentId), { force: true });
    return { configuration: await this.readAgent(agentId) };
  }

  /// Provider capability view for `GET /api/providers`: never a secret value.
  async listProviders() {
    const configuration = await this.readModelConfiguration();
    const providers = configuration?.providers.providers ?? [];
    return providers.map((provider) => ({
      providerId: provider.id,
      enabled: provider.enabled !== false,
      authMode: provider.auth?.apiKeyRef ? 'api_key' : 'env',
      apiFormat: provider.apiFormat,
      credentialRefs: [
        {
          ref: provider.auth?.apiKeyRef ?? provider.auth?.apiKeyEnv ?? '',
          status: configuration?.credentialStatus?.[provider.id] ?? 'unavailable',
          detail: null,
        },
      ],
    }));
  }

  /// Resolve the provider/model pair a task should run with. Returns null when
  /// the default model is missing or disabled.
  async resolveModel(modelId = null) {
    const configuration = await this.readModelConfiguration();
    if (!configuration) return null;
    const models = configuration.models.models;
    const providerById = new Map(configuration.providers.providers.map((entry) => [entry.id, entry]));
    const model = models.find((entry) => entry.id === (modelId ?? configuration.defaultModelId));
    if (!model || model.enabled === false) return null;
    const provider = providerById.get(model.providerId);
    if (!provider || provider.enabled === false) return null;
    return { configuration, provider, model };
  }
}

export { revisionOf, identifier };
