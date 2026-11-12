//! Shared synthetic model-configuration fixture for the four W1 web-text-intake
//! suites (`web-text-intake-http`, `-queue`, `-controlled-model`, `-static`).
//!
//! WHY THIS EXISTS (coordinator dispatch 01a1be44, 2026-11-09):
//! every suite previously inlined its own `providers.json` / `models.json`
//! writer using fields that are NOT part of the frozen configuration DTO, so
//! `ConfigStore.readModelConfiguration()` rejected the whole document with
//! `validation_failed: 供应商名称无效。` before any task could be submitted.
//! The four suites therefore could not construct a legal provider/model pair at
//! all, and their model-configuration cases failed on the fixture rather than
//! on product behaviour.
//!
//! The proof that the FIXTURE was wrong (and not the production) is recorded in
//! `docs/reviews/web-text-intake-ii-config-20261109-ohmypi.md`:
//!   * the inline shape carries `authMode` and `credentialRefs`, neither of
//!     which appears in `PROVIDER_FIELDS`, and omits the required `name`;
//!   * `authMode`/`credentialRefs` are OUTPUT fields of
//!     `ConfigStore.listProviders()` (the `GET /api/providers` capability
//!     view), never persisted input fields;
//!   * the production accepts the legal shape below and builds a snapshot, so
//!     this is NOT a case of the production rejecting a legal configuration.
//!
//! The frozen DTO (`server/lib/config-store.mjs`):
//!   PROVIDER_FIELDS = id, name, apiFormat, baseUrl, auth, enabled, network,
//!                     extraHeaders
//!   auth            = { type, apiKeyEnv?, apiKeyRef? }   (type defaults bearer)
//!   MODEL_FIELDS    = id, providerId, apiModelId, name, description, enabled,
//!                     status, aliases, limits, capabilities, reasoning,
//!                     defaultParams, pricing
//!   models.json     = { models[], sidekick: { version, defaultModelId,
//!                                               revision } }
//!
//! Revocation semantics are preserved: the capability view derives
//! `credentialRefs[0].status` from the live credential provider, so pointing
//! `auth.apiKeyRef` at an unknown reference flips it to `unavailable` and back
//! — the same available/missing/available transitions the suites assert,
//! expressed through the legal field instead of the illegal output field.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTROLLED_PROVIDER_ID = 'controlled-openai';
export const CONTROLLED_MODEL_ID = 'controlled-organizer-model';
export const CONTROLLED_CONFIG_REVISION = 'r1';

/// Write a legal, enabled provider/model pair into `<root>/config`.
///
/// `baseUrl` points at the loopback controlled model service and may be swapped
/// later by rewriting the file (the suites do this to install slow answers).
/// `credentialRef` is the synthetic reference the controlled provider knows;
/// pass an unknown reference (e.g. `env:ABSENT_SYNTHETIC_KEY`) to simulate a
/// missing/revoked credential.
export function writeControlledModelConfig(root, baseUrl, credentialRef) {
  const configDir = join(root, 'config');
  mkdirSync(join(configDir, 'agents'), { recursive: true });
  writeFileSync(join(configDir, 'providers.json'), JSON.stringify({
    providers: [{
      id: CONTROLLED_PROVIDER_ID,
      name: 'Controlled OpenAI',
      apiFormat: 'openai-compatible',
      baseUrl,
      auth: { type: 'bearer', apiKeyRef: credentialRef },
      enabled: true,
    }],
  }, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(configDir, 'models.json'), JSON.stringify({
    models: [{
      id: CONTROLLED_MODEL_ID,
      providerId: CONTROLLED_PROVIDER_ID,
      apiModelId: CONTROLLED_MODEL_ID,
      name: 'Controlled organizer model',
      enabled: true,
      capabilities: { toolCall: true },
    }],
    sidekick: {
      version: 1,
      defaultModelId: CONTROLLED_MODEL_ID,
      revision: CONTROLLED_CONFIG_REVISION,
    },
  }, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(configDir, 'agents', 'organizer.json'), JSON.stringify({
    agentId: 'organizer',
    revision: CONTROLLED_CONFIG_REVISION,
    preferences: { detail: 'concise', focus: 'followups' },
    supplementalInstructions: '保留核对依据。',
  }, null, 2) + '\n', { mode: 0o600 });
  return configDir;
}

/// Repoint an existing legal configuration's credential reference.
///
/// This is the legal replacement for the old `providers[0].credentialRefs = …`
/// mutation: the capability view recomputes the status from the provider, so an
/// unknown reference reads back as `unavailable` and a known one as `available`.
export function setControlledCredentialRef(root, credentialRef) {
  const path = join(root, 'config', 'providers.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  parsed.providers[0].auth = { ...parsed.providers[0].auth, apiKeyRef: credentialRef };
  writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
}
