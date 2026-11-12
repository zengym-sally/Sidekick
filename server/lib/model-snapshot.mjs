//! Immutable model/agent snapshot captured when a task is submitted.
//!
//! The snapshot is stored inside the task's `input_ref` and never changes while
//! the task waits in the queue, so editing or deleting the configuration after
//! submission cannot affect an already-queued run (frozen `web-api/1` §3.1).

import { ServiceError } from './manual-items-service.mjs';

function validation(message) {
  return new ServiceError('validation_failed', message);
}

/// Build the non-secret snapshot for a run. `provider`/`model` are the resolved
/// configuration objects; `agent` carries the organizer preferences. Secrets are
/// represented only by their reference (`apiKeyRef`/`apiKeyEnv`).
export async function buildModelSnapshot({ configStore, agentId = 'organizer', modelId = null, profile = {}, skills = null }) {
  if (agentId !== 'organizer') {
    // This slice wires only the organizer role; tracker/advisor stay later.
    throw validation('本切片仅支持事项整理角色。');
  }
  const resolved = await configStore.resolveModel(modelId);
  if (!resolved) {
    throw new ServiceError('model_not_configured', '还没有可用的默认模型，请到模型设置中配置。');
  }
  const agent = await configStore.readAgent(agentId);
  return {
    revision: resolved.configuration.revision,
    modelId: resolved.model.id,
    provider: resolved.provider,
    model: resolved.model,
    profile,
    agent: {
      agentId,
      preferences: agent.preferences,
      supplementalInstructions: agent.supplementalInstructions,
    },
    skills,
  };
}

/// The credential reference a snapshot's provider carries. The value itself is
/// resolved by the worker host at run time.
export function credentialRefFor(snapshot) {
  const auth = snapshot?.provider?.auth;
  if (!auth) return null;
  return auth.apiKeyRef ?? (auth.apiKeyEnv ? `env:${auth.apiKeyEnv}` : null);
}
