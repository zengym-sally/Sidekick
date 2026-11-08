//! HTTP router for the Web backend host. Zero-dependency `node:http` server:
//! `/api` routes under the frozen `web-api/1` session/CSRF/Origin rules, and
//! everything else is same-origin static content.

import http from 'node:http';
import { ManualItemsService, ServiceError, CONTRACT_VERSION } from './manual-items-service.mjs';
import { ApplicationSettingsService } from './application-settings-service.mjs';
import { SessionStore, SessionError } from './session-store.mjs';
import { SseHub } from './sse-hub.mjs';
import { serveStatic } from './static-files.mjs';

const STATUS_BY_CODE = {
  validation_failed: 400,
  unauthenticated: 401,
  pair_code_invalid: 401,
  pair_rate_limited: 429,
  csrf_invalid: 403,
  origin_rejected: 403,
  item_not_found: 404,
  version_conflict: 409,
  state_conflict: 409,
  idempotency_conflict: 409,
  internal_error: 500,
};

function statusFor(error) {
  if (error instanceof ServiceError || error instanceof SessionError) {
    return STATUS_BY_CODE[error.code] ?? 500;
  }
  return 500;
}

function codeFor(error) {
  if (error instanceof ServiceError || error instanceof SessionError) return error.code;
  return 'internal_error';
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ServiceError('validation_failed', '请求体过大。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(new ServiceError('internal_error', '读取请求体失败。')));
  });
}

async function jsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ServiceError('validation_failed', '请求体必须是 JSON。');
  }
}

function matchRoute(method, pathname) {
  if (pathname === '/api/pair' && method === 'POST') return { name: 'pair' };
  if (pathname === '/api/session' && method === 'GET') return { name: 'session-get' };
  if (pathname === '/api/session' && method === 'DELETE') return { name: 'session-delete' };
  if (pathname === '/api/events' && method === 'GET') return { name: 'events' };
  if (pathname === '/api/workspace' && method === 'GET') return { name: 'workspace' };
  if (pathname === '/api/settings/application' && method === 'GET') return { name: 'settings-read' };
  if (pathname === '/api/settings/application' && method === 'PUT') return { name: 'settings-write' };
  if (pathname === '/api/manual-items') {
    if (method === 'GET') return { name: 'items-list' };
    if (method === 'POST') return { name: 'items-create' };
  }
  const match = /^\/api\/manual-items\/([^/]+)(?:\/(complete|reopen|history))?$/.exec(pathname);
  if (!match) return null;
  const [, itemId, action] = match;
  if (!action) {
    if (method === 'GET') return { name: 'items-get', itemId };
    if (method === 'PUT') return { name: 'items-update', itemId };
    if (method === 'DELETE') return { name: 'items-delete', itemId };
  }
  if (action === 'complete' && method === 'POST') return { name: 'items-complete', itemId };
  if (action === 'reopen' && method === 'POST') return { name: 'items-reopen', itemId };
  if (action === 'history' && method === 'GET') return { name: 'items-history', itemId };
  return null;
}

export class HttpServer {
  constructor({ service, sessions, sse, staticRoot, root, expectedHost, applicationSettings }) {
    this.service = service;
    this.sessions = sessions;
    this.sse = sse;
    this.staticRoot = staticRoot;
    this.root = root;
    this.expectedHost = expectedHost;
    this.applicationSettings = applicationSettings;
    this.server = null;
  }

  listen(port) {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => resolve(this.server.address().port));
    });
  }

  close() {
    if (!this.server) return Promise.resolve();
    const server = this.server;
    this.server = null;
    return new Promise((resolve) => server.close(() => resolve()));
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);
      const route = matchRoute(req.method, url.pathname);
      if (route) {
        await this.dispatch(req, res, route, url);
        return;
      }
      serveStatic(req, res, { staticRoot: this.staticRoot });
    } catch (error) {
      this.sendError(res, error);
    }
  }

  sendError(res, error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = statusFor(error);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    const body = {
      contractVersion: CONTRACT_VERSION,
      status,
      error: { code: codeFor(error), message: error.message ?? '服务错误。' },
    };
    if (error instanceof ServiceError && error.details !== undefined) {
      body.error.details = error.details;
    }
    res.end(JSON.stringify(body));
  }

  sendJson(res, status, payload, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(payload));
  }

  requireSession(req) {
    const token = SessionStore.sessionToken(req);
    const session = this.sessions.session(token);
    if (!session) throw new ServiceError('unauthenticated', '未认证或会话已过期。');
    return session;
  }

  requireWrite(req) {
    const session = this.requireSession(req);
    const csrf = req.headers['x-csrf-token'];
    if (!csrf || csrf !== session.csrfToken) {
      throw new ServiceError('csrf_invalid', 'CSRF 校验失败。');
    }
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (host !== this.expectedHost || origin !== `http://${this.expectedHost}`) {
      throw new ServiceError('origin_rejected', '请求来源不被接受。');
    }
    return session;
  }

  async dispatch(req, res, route, url) {
    switch (route.name) {
      case 'pair':
        return this.pair(req, res);
      case 'session-get':
        return this.sessionGet(req, res);
      case 'session-delete':
        return this.sessionDelete(req, res);
      case 'events':
        return this.events(req, res);
      case 'workspace':
        return this.workspace(req, res, url);
      case 'settings-read':
        return this.settingsRead(req, res);
      case 'settings-write':
        return this.settingsWrite(req, res);
      case 'items-list':
        return this.itemsList(req, res, url);
      case 'items-create':
        return this.itemsCreate(req, res);
      case 'items-get':
        return this.itemsGet(req, res, route.itemId);
      case 'items-update':
        return this.itemsUpdate(req, res, route.itemId);
      case 'items-delete':
        return this.itemsDelete(req, res, route.itemId);
      case 'items-complete':
        return this.itemsComplete(req, res, route.itemId);
      case 'items-reopen':
        return this.itemsReopen(req, res, route.itemId);
      case 'items-history':
        return this.itemsHistory(req, res, route.itemId, url);
      default:
        throw new ServiceError('not_found', '接口不存在。');
    }
  }

  async pair(req, res) {
    const body = await jsonBody(req);
    // The standard wire field is `pairingCode`; no alias fallback, so a client
    // sending a different name fails instead of silently pairing (2026-11-08
    // interface ruling).
    const result = this.sessions.pair(body.pairingCode);
    this.sendJson(
      res,
      200,
      {
        contractVersion: CONTRACT_VERSION,
        session: { capabilities: result.capabilities },
        csrfToken: result.csrfToken,
      },
      { 'Set-Cookie': SessionStore.serializeSessionCookie(result.token) },
    );
  }

  sessionGet(req, res) {
    const session = this.requireSession(req);
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      session: { capabilities: session.capabilities },
      csrfToken: session.csrfToken,
    });
  }

  sessionDelete(req, res) {
    const token = SessionStore.sessionToken(req);
    this.sessions.revoke(token);
    this.sendJson(
      res,
      200,
      { contractVersion: CONTRACT_VERSION, revoked: true },
      { 'Set-Cookie': SessionStore.serializeClearCookie() },
    );
  }

  events(req, res) {
    this.requireSession(req);
    this.sse.addClient(req, res);
  }

  workspace(req, res) {
    const session = this.requireSession(req);
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      root: this.root,
      deployment: 'local',
      needsSetup: false,
      pendingRoot: null,
      capabilities: session.capabilities,
      targets: [],
    });
  }

  async settingsRead(req, res) {
    this.requireSession(req);
    const snapshot = await this.applicationSettings.read();
    this.sendJson(res, 200, snapshot);
  }

  async settingsWrite(req, res) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    if (typeof body.timeZone !== 'string') {
      throw new ServiceError('validation_failed', 'timeZone 无效。');
    }
    if (typeof body.expectedVersion !== 'number') {
      throw new ServiceError('validation_failed', 'expectedVersion 无效。');
    }
    const snapshot = await this.applicationSettings.write(body.timeZone, body.expectedVersion);
    this.sendJson(res, 200, snapshot);
  }

  async itemsList(req, res, url) {
    this.requireSession(req);
    const result = await this.service.listItems({
      status: url.searchParams.get('status') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      items: result.items,
      nextCursor: result.nextCursor,
    });
  }

  async itemsCreate(req, res) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    if (typeof body.operationId !== 'string' || !body.operationId.trim()) {
      throw new ServiceError('validation_failed', 'operationId 无效。');
    }
    const result = await this.service.createItem(body.operationId, body.input);
    this.sse.broadcastItemChanged(result.item);
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      replayed: result.replayed,
      item: result.item,
    });
  }

  async itemsGet(req, res, itemId) {
    this.requireSession(req);
    const item = await this.service.getItem(itemId);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, item });
  }

  async itemsUpdate(req, res, itemId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    if (typeof body.operationId !== 'string' || !body.operationId.trim()) {
      throw new ServiceError('validation_failed', 'operationId 无效。');
    }
    if (typeof body.expectedVersion !== 'number') {
      throw new ServiceError('validation_failed', 'expectedVersion 无效。');
    }
    const result = await this.service.updateItem(itemId, body.operationId, body.expectedVersion, body.input);
    this.sse.broadcastItemChanged(result.item);
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      replayed: result.replayed,
      item: result.item,
    });
  }

  async itemsDelete(req, res, itemId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    if (typeof body.operationId !== 'string' || !body.operationId.trim()) {
      throw new ServiceError('validation_failed', 'operationId 无效。');
    }
    if (typeof body.expectedVersion !== 'number') {
      throw new ServiceError('validation_failed', 'expectedVersion 无效。');
    }
    const result = await this.service.deleteItem(itemId, body.operationId, body.expectedVersion);
    this.sse.broadcastItemChanged(result.item);
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      replayed: result.replayed,
      item: result.item,
    });
  }

  async itemsComplete(req, res, itemId) {
    return this.transition(req, res, itemId, 'complete');
  }

  async itemsReopen(req, res, itemId) {
    return this.transition(req, res, itemId, 'reopen');
  }

  async transition(req, res, itemId, action) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    if (typeof body.operationId !== 'string' || !body.operationId.trim()) {
      throw new ServiceError('validation_failed', 'operationId 无效。');
    }
    if (typeof body.expectedVersion !== 'number') {
      throw new ServiceError('validation_failed', 'expectedVersion 无效。');
    }
    const result = action === 'complete'
      ? await this.service.completeItem(itemId, body.operationId, body.expectedVersion)
      : await this.service.reopenItem(itemId, body.operationId, body.expectedVersion);
    this.sse.broadcastItemChanged(result.item);
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      replayed: result.replayed,
      item: result.item,
    });
  }

  async itemsHistory(req, res, itemId, url) {
    this.requireSession(req);
    const result = await this.service.history(itemId, {
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      events: result.events,
      nextCursor: result.nextCursor,
    });
  }
}
