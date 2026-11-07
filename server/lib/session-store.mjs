//! Pairing codes, sessions and CSRF tokens for the local backend.
//!
//! The pairing code only ever lives in the POST body, never in a URL, log line
//! or metadata field. Sessions are in-memory; the browser holds an HttpOnly,
//! SameSite=Strict cookie and a CSRF token returned by `GET /api/session`.

import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'sidekick_session';
const CAPABILITIES = ['workspace.manage', 'workspace.backup'];

export class SessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

export class SessionStore {
  constructor({ pairingTtlMs = 10 * 60 * 1000, maxFailures = 5, rateWindowMs = 60 * 1000 } = {}) {
    this.pairingTtlMs = pairingTtlMs;
    this.maxFailures = maxFailures;
    this.rateWindowMs = rateWindowMs;
    this.pendingCodes = new Map();
    this.sessions = new Map();
    this.failures = [];
  }

  generatePairingCode() {
    this.pruneCodes();
    const code = randomBytes(4).toString('hex');
    this.pendingCodes.set(code, Date.now() + this.pairingTtlMs);
    return code;
  }

  pruneCodes() {
    const now = Date.now();
    for (const [code, expiresAt] of this.pendingCodes) {
      if (expiresAt <= now) this.pendingCodes.delete(code);
    }
  }

  rateLimited() {
    const now = Date.now();
    this.failures = this.failures.filter((stamp) => now - stamp < this.rateWindowMs);
    return this.failures.length >= this.maxFailures;
  }

  pair(code) {
    if (typeof code !== 'string' || !code.trim()) {
      throw new SessionError('pair_code_invalid', '配对码无效。');
    }
    if (this.rateLimited()) {
      throw new SessionError('pair_rate_limited', '配对尝试过于频繁，请稍后再试。');
    }
    const normalized = code.trim();
    const expiresAt = this.pendingCodes.get(normalized);
    this.pendingCodes.delete(normalized);
    if (!expiresAt || expiresAt < Date.now()) {
      this.failures.push(Date.now());
      throw new SessionError('pair_code_invalid', '配对码无效或已过期。');
    }
    const token = randomBytes(24).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    this.sessions.set(token, {
      csrfToken,
      capabilities: [...CAPABILITIES],
      createdAt: Date.now(),
    });
    return { token, csrfToken, capabilities: [...CAPABILITIES] };
  }

  session(token) {
    if (!token) return null;
    return this.sessions.get(token) ?? null;
  }

  revoke(token) {
    if (token) this.sessions.delete(token);
  }

  static parseCookie(header) {
    const cookies = {};
    if (!header) return cookies;
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (name) cookies[name] = decodeURIComponent(value);
    }
    return cookies;
  }

  static sessionToken(req) {
    return SessionStore.parseCookie(req.headers.cookie)[SESSION_COOKIE] ?? null;
  }

  static serializeSessionCookie(token) {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`;
  }

  static serializeClearCookie() {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
}
