//! HTTP router for the Web backend host. Zero-dependency `node:http` server:
//! `/api` routes under the frozen `web-api/1` session/CSRF/Origin rules, and
//! everything else is same-origin static content.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { ManualItemsService, ServiceError, CONTRACT_VERSION } from './manual-items-service.mjs';
import { ApplicationSettingsService } from './application-settings-service.mjs';
import { AGENT_IDS } from './config-store.mjs';
import { SessionStore, SessionError } from './session-store.mjs';
import { SseHub } from './sse-hub.mjs';
import { serveStatic } from './static-files.mjs';
import { buildModelSnapshot } from './model-snapshot.mjs';

/// The agent roles wired in THIS slice: only `organizer` (frozen text-intake
/// contract §5.3; tracker/advisor configuration is W2+). The config-store
/// keeps the three-role domain reserve untouched — this gate only decides
/// what this slice's HTTP face serves, so a known-but-unwired role is
/// accurately unavailable instead of silently manufacturing a default draft.
const WIRED_AGENT_IDS = ['organizer'];

const STATUS_BY_CODE = {
  validation_failed: 400,
  unknown_task_type: 400,
  unknown_role: 400,
  config_revision_unknown: 400,
  time_review_required: 400,
  result_range_invalid: 400,
  not_found: 404,
  unauthenticated: 401,
  pair_code_invalid: 401,
  pair_rate_limited: 429,
  csrf_invalid: 403,
  origin_rejected: 403,
  item_not_found: 404,
  task_not_found: 404,
  source_not_found: 404,
  candidate_not_found: 404,
  preview_not_found: 404,
  operation_not_found: 404,
  result_not_found: 404,
  result_range_unsatisfiable: 416,
  credential_ref_unsavable: 422,
  plain_credential: 422,
  version_conflict: 409,
  state_conflict: 409,
  idempotency_conflict: 409,
  exit_unconfirmed: 409,
  config_revision_change_not_allowed: 409,
  intake_closed: 503,
  backend_unavailable: 503,
  invalid_model_config: 500,
  invalid_agent_config: 500,
  model_not_configured: 500,
  credential_unavailable: 500,
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
  const match = /^\/api\/manual-items\/([^/]+)(?:\/(complete|reopen|history|sources))?$/.exec(pathname);
  if (match) {
    const [, itemId, action] = match;
    if (!action) {
      if (method === 'GET') return { name: 'items-get', itemId };
      if (method === 'PUT') return { name: 'items-update', itemId };
      if (method === 'DELETE') return { name: 'items-delete', itemId };
    }
    if (action === 'complete' && method === 'POST') return { name: 'items-complete', itemId };
    if (action === 'reopen' && method === 'POST') return { name: 'items-reopen', itemId };
    if (action === 'history' && method === 'GET') return { name: 'items-history', itemId };
    if (action === 'sources' && method === 'GET') return { name: 'items-sources', itemId };
  }

  // Text intake: sources, candidates, previews, batch sign-off.
  if (pathname === '/api/text-sources' && method === 'POST') return { name: 'text-sources-create' };
  if (pathname === '/api/text-sources' && method === 'GET') return { name: 'text-sources-list' };
  const sourceMatch = /^\/api\/text-sources\/([^/]+)(?:\/(candidates))?$/.exec(pathname);
  if (sourceMatch) {
    const [, sourceId, action] = sourceMatch;
    if (!action && method === 'GET') return { name: 'text-source-get', sourceId };
    if (action === 'candidates' && method === 'GET') return { name: 'text-source-candidates', sourceId };
  }
  const previewMatch = /^\/api\/candidates\/([^/]+)\/previews\/([^/]+)\/apply$/.exec(pathname);
  if (previewMatch && method === 'POST') {
    return { name: 'candidate-preview-apply', candidateId: previewMatch[1], runId: previewMatch[2] };
  }
  const candidateMatch = /^\/api\/candidates\/([^/]+)(?:\/(edits|discard|revisions))?$/.exec(pathname);
  if (candidateMatch) {
    const [, candidateId, action] = candidateMatch;
    if (!action && method === 'GET') return { name: 'candidate-get', candidateId };
    if (action === 'edits' && method === 'POST') return { name: 'candidate-edit', candidateId };
    if (action === 'discard' && method === 'POST') return { name: 'candidate-discard', candidateId };
    if (action === 'revisions' && method === 'POST') return { name: 'candidate-revision', candidateId };
  }
  if (pathname === '/api/sign-offs' && method === 'POST') return { name: 'sign-offs' };

  // Task queue: submit/query/cancel/retry/resolve/result.
  if (pathname === '/api/tasks' && method === 'POST') return { name: 'tasks-create' };
  if (pathname === '/api/tasks' && method === 'GET') return { name: 'tasks-list' };
  const taskMatch = /^\/api\/tasks\/([^/]+)(?:\/(result|cancel|retry|resolve))?$/.exec(pathname);
  if (taskMatch) {
    const [, taskId, action] = taskMatch;
    if (!action && method === 'GET') return { name: 'task-get', taskId };
    if (action === 'result' && method === 'GET') return { name: 'task-result', taskId };
    if (action === 'cancel' && method === 'POST') return { name: 'task-cancel', taskId };
    if (action === 'retry' && method === 'POST') return { name: 'task-retry', taskId };
    if (action === 'resolve' && method === 'POST') return { name: 'task-resolve', taskId };
  }
  if (pathname === '/api/settings/agent-concurrency' && method === 'GET') return { name: 'concurrency-read' };
  if (pathname === '/api/settings/agent-concurrency' && method === 'PUT') return { name: 'concurrency-write' };
  if (pathname === '/api/snapshot' && method === 'GET') return { name: 'snapshot' };

  // Configuration and provider capability.
  if (pathname === '/api/models' && method === 'GET') return { name: 'models-read' };
  if (pathname === '/api/models' && method === 'PUT') return { name: 'models-write' };
  const agentMatch = /^\/api\/agents\/([^/]+)(?:\/reset)?$/.exec(pathname);
  if (agentMatch) {
    const [, agentId] = agentMatch;
    const isReset = pathname.endsWith('/reset');
    if (isReset && method === 'POST') return { name: 'agent-reset', agentId };
    if (!isReset && method === 'GET') return { name: 'agent-read', agentId };
    if (!isReset && method === 'PUT') return { name: 'agent-write', agentId };
  }
  if (pathname === '/api/providers' && method === 'GET') return { name: 'providers' };
  return null;
}

export class HttpServer {
  constructor({
    service,
    sessions,
    sse,
    staticRoot,
    root,
    expectedHost,
    applicationSettings,
    taskService = null,
    textIntake = null,
    configStore = null,
    scheduler = null,
  }) {
    this.service = service;
    this.sessions = sessions;
    this.sse = sse;
    this.staticRoot = staticRoot;
    this.root = root;
    this.expectedHost = expectedHost;
    this.applicationSettings = applicationSettings;
    this.taskService = taskService;
    this.textIntake = textIntake;
    this.configStore = configStore;
    this.scheduler = scheduler;
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
    // A thrown error may carry no message at all (e.g. a `notFound()` raised
    // without one): `Error.message` is then the empty string, which a
    // nullish fallback would pass through. The frozen envelope always
    // carries a non-empty human-readable message.
    const rawMessage = error?.message;
    const message = typeof rawMessage === 'string' && rawMessage ? rawMessage : '服务错误。';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    const body = {
      contractVersion: CONTRACT_VERSION,
      status,
      error: { code: codeFor(error), message },
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
      case 'items-sources':
        return this.itemsSources(req, res, route.itemId);
      case 'text-sources-create':
        return this.textSourcesCreate(req, res);
      case 'text-sources-list':
        return this.textSourcesList(req, res, url);
      case 'text-source-get':
        return this.textSourceGet(req, res, route.sourceId);
      case 'text-source-candidates':
        return this.textSourceCandidates(req, res, route.sourceId, url);
      case 'candidate-get':
        return this.candidateGet(req, res, route.candidateId);
      case 'candidate-edit':
        return this.candidateEdit(req, res, route.candidateId);
      case 'candidate-discard':
        return this.candidateDiscard(req, res, route.candidateId);
      case 'candidate-revision':
        return this.candidateRevision(req, res, route.candidateId);
      case 'candidate-preview-apply':
        return this.candidatePreviewApply(req, res, route.candidateId, route.runId);
      case 'sign-offs':
        return this.signOffs(req, res);
      case 'tasks-create':
        return this.tasksCreate(req, res);
      case 'tasks-list':
        return this.tasksList(req, res, url);
      case 'task-get':
        return this.taskGet(req, res, route.taskId);
      case 'task-result':
        return this.taskResult(req, res, route.taskId, url);
      case 'task-cancel':
        return this.taskCancel(req, res, route.taskId);
      case 'task-retry':
        return this.taskRetry(req, res, route.taskId);
      case 'task-resolve':
        return this.taskResolve(req, res, route.taskId);
      case 'concurrency-read':
        return this.concurrencyRead(req, res);
      case 'concurrency-write':
        return this.concurrencyWrite(req, res);
      case 'snapshot':
        return this.snapshot(req, res);
      case 'models-read':
        return this.modelsRead(req, res);
      case 'models-write':
        return this.modelsWrite(req, res);
      case 'agent-read':
        return this.agentRead(req, res, route.agentId);
      case 'agent-write':
        return this.agentWrite(req, res, route.agentId);
      case 'agent-reset':
        return this.agentReset(req, res, route.agentId);
      case 'providers':
        return this.providers(req, res);
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

  async events(req, res) {
    this.requireSession(req);
    // The reconnect legitimacy check runs against the REAL instance
    // high-watermark (`task_events` MAX(cursor), the same value
    // `/api/snapshot` reports): a token in a cursor gap left by an
    // unbroadcast transition is not a token claiming future events.
    const watermark = await this.taskService.readHighWatermark();
    this.sse.addClient(req, res, { watermark });
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

  /// Source traceability for a signed-off item (registered narrow read
  /// endpoint): `{sourceId, candidateId, evidence, association, createdAt,
  /// anchorAt, excerpt}` with ISO UTC millisecond times, `association` limited
  /// to `new|manual_link`, and an at-most-200-character excerpt. A missing or
  /// unreadable item is 404 `item_not_found`; an item with no sources is a
  /// 200 empty array. No SQL, local path or secret is ever returned.
  async itemsSources(req, res, itemId) {
    this.requireSession(req);
    await this.service.getItem(itemId);
    const rows = await this.taskService.query(
      `SELECT s.source_id,s.candidate_id,s.evidence,s.association,s.created_at_ms,t.anchor_at_ms,t.raw_text
        FROM manual_item_sources s JOIN text_sources t ON t.source_id=s.source_id
        WHERE s.item_id=? ORDER BY s.created_at_ms ASC`,
      [itemId],
    );
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      sources: rows.map((row) => ({
        sourceId: row[0],
        candidateId: row[1],
        evidence: row[2],
        association: row[3],
        createdAt: new Date(row[4]).toISOString(),
        anchorAt: new Date(row[5]).toISOString(),
        excerpt: String(row[6] ?? '').slice(0, 200),
      })),
    });
  }

  async textSourcesCreate(req, res) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const result = await this.textIntake.submitSource(body.operationId, body.input ?? {});
    this.sendJson(res, result.reused ? 200 : 200, {
      contractVersion: CONTRACT_VERSION,
      replayed: result.reused,
      reused: result.reused,
      source: result.source,
      task: result.task,
    });
  }

  async textSourcesList(req, res, url) {
    this.requireSession(req);
    const result = await this.textIntake.listSources({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      sources: result.sources,
      nextCursor: result.nextCursor,
    });
  }

  async textSourceGet(req, res, sourceId) {
    this.requireSession(req);
    const result = await this.textIntake.getSource(sourceId);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, ...result });
  }

  async textSourceCandidates(req, res, sourceId, url) {
    this.requireSession(req);
    const result = await this.textIntake.listCandidates(sourceId, {
      status: url.searchParams.get('status') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, ...result });
  }

  async candidateGet(req, res, candidateId) {
    this.requireSession(req);
    const candidate = await this.textIntake.getCandidate(candidateId);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, candidate });
  }

  async candidateEdit(req, res, candidateId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const candidate = await this.textIntake.editCandidate(
      candidateId,
      body.operationId,
      body.expectedVersion,
      body.input,
      Boolean(body.timeReviewed),
    );
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, candidate });
  }

  async candidateDiscard(req, res, candidateId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const candidate = await this.textIntake.discardCandidate(candidateId, body.operationId, body.expectedVersion);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, candidate });
  }

  async candidateRevision(req, res, candidateId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const task = await this.textIntake.requestRevision(candidateId, body.operationId, body.instruction);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, task });
  }

  async candidatePreviewApply(req, res, candidateId, runId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const candidate = await this.textIntake.applyPreview(candidateId, runId, body.operationId, body.expectedVersion);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, candidate });
  }

  async signOffs(req, res) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const result = await this.textIntake.signOff(body.operationId, body.choices);
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      replayed: result.replayed,
      items: result.items,
    });
  }

  /// A connection-test task is submitted by the client naming a configured
  /// model (`input.modelId`, the frozen DTO); the server derives the immutable
  /// snapshot at submit time so the worker always runs a provider/model pair
  /// the configuration itself produced (otherwise the runtime rejects it as
  /// RUNTIME_PROTOCOL).
  ///
  /// RS-1 closure (ZCode forensics `b72c4b9`): the snapshot is ALWAYS
  /// server-derived. A client-carried raw `snapshot`/`skills` is neither
  /// executed nor persisted as trusted — the only client influence on a run is
  /// naming one of the configured models, resolved server-side through the
  /// configuration store (an unknown name resolves to nothing, like a missing
  /// default). An unconfigured model keeps the established semantics: the task
  /// is queued without a snapshot and fails at run time instead of being
  /// rejected at intake.
  async snapshotForTest(body) {
    if (body.type !== 'test') return body.input ?? {};
    const input = body.input ?? {};
    const { snapshot: _clientSnapshot, skills: _clientSkills, ...rest } = input;
    if (!this.configStore) return rest;
    try {
      const snapshot = await buildModelSnapshot({
        configStore: this.configStore,
        agentId: 'organizer',
        profile: {},
        modelId: rest.modelId ?? null,
      });
      return { ...rest, snapshot };
    } catch {
      return rest;
    }
  }

  async tasksCreate(req, res) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const input = await this.snapshotForTest(body);
    const result = await this.taskService.submit({
      operationId: body.operationId,
      type: body.type,
      role: body.role,
      input,
    });
    this.sendJson(res, result.status, {
      contractVersion: CONTRACT_VERSION,
      replayed: result.replayed,
      taskId: result.task.taskId,
      state: result.task.state,
      version: result.task.version,
      queuePosition: result.task.queuePosition,
      task: result.task,
    });
  }

  async tasksList(req, res, url) {
    this.requireSession(req);
    const result = await this.taskService.list({
      state: url.searchParams.get('state') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      tasks: result.tasks,
      nextCursor: result.nextCursor,
    });
  }

  async taskGet(req, res, taskId) {
    this.requireSession(req);
    const task = await this.taskService.get(taskId);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, task });
  }

  async taskResult(req, res, taskId, url) {
    this.requireSession(req);
    const result = await this.taskService.readResult(taskId, {
      offset: url.searchParams.get('offset') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    this.sendJson(res, 200, result);
  }

  async taskCancel(req, res, taskId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const result = await this.taskService.cancel(taskId, body.expectedVersion);
    if (result.task.state === 'cancelling') void this.scheduler?.cancelRunning(taskId);
    this.sendJson(res, result.status, { contractVersion: CONTRACT_VERSION, task: result.task });
  }

  async taskRetry(req, res, taskId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    // Frozen §4.5: a changed `configRevision` is the explicit "run again with
    // the fixed configuration" signal. The immutable run snapshot is
    // re-resolved from the configuration at retry time and travels with the
    // retry, so the NEXT attempt actually uses the new configuration; an
    // unchanged revision keeps the original snapshot (a configuration edit
    // while the task waits never affects it).
    let snapshot;
    if (body.configRevision !== undefined && body.configRevision !== null && this.textIntake) {
      const current = await this.taskService.get(taskId);
      if (body.configRevision !== current.configRevision) {
        snapshot = await this.textIntake.snapshotFor();
      }
    }
    const task = await this.taskService.retry(taskId, body.expectedVersion, body.configRevision, { snapshot });
    this.sendJson(res, 202, { contractVersion: CONTRACT_VERSION, task });
  }

  async taskResolve(req, res, taskId) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const current = await this.taskService.get(taskId);
    // R6-M-3 / frozen §3.4: resuming a `needs_review` task with a staged
    // outcome commits the ORIGINAL staged outcome and publishes the staged
    // candidates, instead of discarding them by re-queueing. R8-M-1: the
    // dedicated path is entered only through its frozen gates — a running or
    // cancelling attempt, an unverified exit or a stale recovery item version
    // is refused with the contract 409 by `commitStagedResume` itself, so no
    // force flag can defeat them. The epoch fence is intentionally not applied
    // because recovery may run in a new instance. The §4.5 receipt ACK list is
    // forwarded EXACTLY AS PROVIDED to both entries — the same gate, the same
    // field, no handler-side pre-validation and no coalescing: an omitted key
    // keeps the service empty-list default, while an explicit `null` reaches
    // the shared shape gate and answers `validation_failed` like any other
    // non-array value.
    if (body.decision === 'resume' && current.resultPendingExit
        && (current.type === 'extract' || current.type === 'revise')) {
      const committed = await this.textIntake.commitStagedResume(
        taskId, current.attemptId, body.expectedVersion, body.acknowledgedReceipts,
      );
      this.sendJson(res, 202, { contractVersion: CONTRACT_VERSION, task: committed });
      return;
    }
    const task = await this.taskService.resolve(
      taskId,
      body.expectedVersion,
      body.decision,
      body.acknowledgedReceipts,
    );
    this.sendJson(res, 202, { contractVersion: CONTRACT_VERSION, task });
  }

  async concurrencyRead(req, res) {
    this.requireSession(req);
    const snapshot = await this.taskService.readConcurrency();
    this.sendJson(res, 200, snapshot);
  }

  async concurrencyWrite(req, res) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const { snapshot, cursor } = await this.taskService.writeConcurrency(body.agentConcurrency, body.expectedVersion);
    // Frozen web-api/1 §5: the committed change broadcasts `settings.changed`.
    // Post-commit and best-effort: a disconnected client or a closing stream
    // never rolls back the committed setting — the event row is already
    // durable and clients compensate through `/api/snapshot`.
    this.sse.broadcastSettingsChanged({
      objectId: 'agentConcurrency',
      objectVersion: snapshot.version,
      agentConcurrency: snapshot.agentConcurrency,
      cursor,
    });
    this.sendJson(res, 200, snapshot);
  }

  async snapshot(req, res) {
    this.requireSession(req);
    // The real high watermark is read FIRST: every event committed after this
    // read carries a higher cursor and reaches the client through the replay
    // after it resubscribes (frozen §6 compensation rule).
    const highWatermark = await this.taskService.readHighWatermark();
    // Frozen §6 full-volume semantics: the snapshot carries the authoritative
    // state of ALL events up to the watermark, so the whole task set is
    // paged through — the list page size must never silently truncate it.
    // The normal list endpoint keeps its pagination unchanged.
    const tasks = [];
    let cursor;
    for (;;) {
      const page = await this.taskService.list({ limit: 200, cursor });
      tasks.push(...page.tasks);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    // Frozen §6.1 member 4: the nested settings block is the normative CAS
    // source; it is read from the SAME settings row as the concurrency
    // endpoint, and the compatible top-level mirror (member 5) must agree.
    const concurrency = await this.taskService.readConcurrency();
    // Frozen §6.1 member 6: the workspace block.
    const workspace = this.workspaceBlock(req);
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      epoch: this.sse.epoch,
      highWatermark,
      generatedAt: new Date().toISOString(),
      lastEventId: `${this.sse.epoch}:${highWatermark}`,
      settings: {
        agentConcurrency: concurrency.agentConcurrency,
        version: concurrency.version,
      },
      agentConcurrency: concurrency.agentConcurrency,
      workspace,
      tasks,
    });
  }

  /// Frozen §6.1 member 6 workspace block (local mode). The current root is the
  /// backend root; its stable id is derived from the path (never a secret), and
  /// the capabilities come from the SAME session as the workspace endpoint.
  workspaceBlock(req) {
    const session = this.requireSession(req);
    const id = `root_${createHash('sha256').update(this.root).digest('hex').slice(0, 12)}`;
    return {
      mode: 'local',
      currentRoot: { id, label: '默认工作根' },
      capabilities: session.capabilities ?? [],
      recovery: null,
    };
  }

  async modelsRead(req, res) {
    this.requireSession(req);
    // Frozen W1 contract §5.3: GET /api/models answers the FLAT shape
    // `{providers, models, defaultModelId, revision}` — no `configuration`
    // envelope. Credential reference status is not part of this shape; it is
    // exposed by GET /api/providers (frozen §7).
    const configuration = await this.configStore.readModelConfiguration();
    this.sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      providers: configuration?.providers.providers ?? [],
      models: configuration?.models.models ?? [],
      defaultModelId: configuration?.defaultModelId ?? '',
      revision: configuration?.revision ?? '',
    });
  }

  async modelsWrite(req, res) {
    this.requireWrite(req);
    const body = await jsonBody(req);
    const result = await this.configStore.writeModelConfiguration(body.input ?? {}, body.expectedRevision);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, ...result });
  }

  /// A wired agent role passes. A KNOWN-but-unwired role (tracker/advisor) is
  /// accurately unavailable in this slice — 404 `not_found`, never a
  /// manufactured default draft. An identifier outside the fixed role set
  /// falls through to the config store's own validation (400
  /// `validation_failed`), which stays the unknown-identifier answer.
  requireWiredAgent(agentId) {
    if (WIRED_AGENT_IDS.includes(agentId)) return;
    if (!AGENT_IDS.includes(agentId)) return;
    throw new ServiceError('not_found', '该智能体角色不在本切片接线范围内。');
  }

  async agentRead(req, res, agentId) {
    this.requireSession(req);
    this.requireWiredAgent(agentId);
    const configuration = await this.configStore.readAgent(agentId);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, configuration });
  }

  async agentWrite(req, res, agentId) {
    this.requireWrite(req);
    this.requireWiredAgent(agentId);
    const body = await jsonBody(req);
    const input = body.input ?? body;
    const result = await this.configStore.writeAgent(agentId, input, body.expectedRevision ?? input.expectedRevision);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, ...result });
  }

  async agentReset(req, res, agentId) {
    this.requireWrite(req);
    this.requireWiredAgent(agentId);
    const body = await jsonBody(req);
    const result = await this.configStore.resetAgent(agentId, body.expectedRevision);
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, ...result });
  }

  async providers(req, res) {
    this.requireSession(req);
    const providers = await this.configStore.listProviders();
    this.sendJson(res, 200, { contractVersion: CONTRACT_VERSION, providers });
  }
}
