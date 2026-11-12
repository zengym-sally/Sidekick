//! Credential reference resolution.
//!
//! A credential never enters the queue, SQLite, argv, configuration, a log line
//! or SSE: the task stores only a reference, and the secret is resolved
//! immediately before the worker starts and injected over the worker's private
//! stdin.
//!
//! This slice implements the controlled in-memory provider only: a fixed set of
//! synthetic references injected programmatically (tests, controlled model
//! service). The production OS provider (macOS Keychain / Linux env) is a
//! separate authorization and is deliberately not implemented here. Resolving a
//! real host environment variable is likewise out of scope for this round.

import { ServiceError } from './manual-items-service.mjs';

export const CREDENTIAL_STATUSES = ['available', 'missing', 'unavailable'];

/// A provider holds a fixed set of references. `secrets` maps a reference to a
/// synthetic value; a reference that is known but has no value is `missing`.
export class ControlledCredentialProvider {
  constructor({ secrets = new Map(), knownRefs = null } = {}) {
    this.secrets = new Map(secrets);
    this.knownRefs = knownRefs ? new Set(knownRefs) : null;
  }

  set(ref, value) {
    this.secrets.set(ref, value);
  }

  delete(ref) {
    this.secrets.delete(ref);
  }

  async status(ref) {
    if (!ref || typeof ref !== 'string') return { status: 'unavailable', detail: '引用无效。' };
    if (this.secrets.has(ref)) {
      const value = this.secrets.get(ref);
      if (typeof value === 'string' && value) return { status: 'available' };
      return { status: 'missing', detail: '引用存在但暂无可用值。' };
    }
    if (this.knownRefs && this.knownRefs.has(ref)) {
      return { status: 'missing', detail: '引用尚未保存。' };
    }
    return { status: 'unavailable', detail: '未注册的凭据引用。' };
  }

  async resolve(ref) {
    const status = await this.status(ref);
    if (status.status !== 'available') {
      throw new ServiceError('credential_unavailable', '缺少可用的模型密钥。');
    }
    return this.secrets.get(ref);
  }
}

export function createCredentialProvider(options = {}) {
  // The only provider this slice ships: in-memory controlled injection. The
  // production OS provider is intentionally absent until separately authorized.
  return new ControlledCredentialProvider(options);
}
