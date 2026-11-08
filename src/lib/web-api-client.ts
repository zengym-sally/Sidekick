//! HTTP transport for the Web backend (`web-api/1`).
//!
//! The browser talks to the same-origin backend host: session cookie plus CSRF
//! token on writes, frozen error envelope, and `operationId`/`expectedVersion`
//! carried through to the manual-item endpoints. The domain logic in
//! `src/domain/todos.ts` stays untouched.

import type { Todo, TodoInput, TodoEvent, TimePoint, WorkspaceInfo } from '../domain/todos.ts';

export interface WirePoint {
  at: string;
  timeZone: string;
  localText: string;
  precision: 'minute' | 'day';
}

export interface WireItem {
  contractVersion: 'web-api/1';
  itemId: string;
  title: string;
  kind: 'action' | 'followup';
  owner: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'completed' | 'deleted';
  due: WirePoint | null;
  followup: WirePoint | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  version: number;
  source: 'manual';
}

interface WireWorkspace {
  root: string | null;
  needsSetup: boolean;
  pendingRoot: string | null;
  capabilities: string[];
}

type Backend = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export class WebApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'WebApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const CONTRACT_VERSION = 'web-api/1';

export function toWirePoint(point: { atMs: number; timeZone: string; localText: string; precision?: 'day' } | null): WirePoint | null {
  if (!point) return null;
  return {
    at: new Date(point.atMs).toISOString(),
    timeZone: point.timeZone,
    localText: point.localText,
    precision: point.precision ?? 'minute',
  };
}

/// The domain `TimePoint.precision` is optional and only ever `'day'`; the wire
/// always carries an explicit `'minute'`/`'day'`. Map `'minute'` back to the
/// domain default (`undefined`) and keep an explicit `'day'`.
export function toDomainPoint(point: WirePoint): TimePoint {
  return {
    atMs: Date.parse(point.at),
    timeZone: point.timeZone,
    localText: point.localText,
    precision: point.precision === 'day' ? 'day' : undefined,
  };
}

export function toWireInput(input: TodoInput) {
  return {
    title: input.title,
    kind: input.kind,
    owner: input.owner,
    priority: input.priority,
    due: toWirePoint(input.due),
    followup: toWirePoint(input.followup),
    tags: input.tags,
  };
}

export function fromWireItem(item: WireItem): Todo {
  return {
    id: item.itemId,
    data: {
      title: item.title,
      kind: item.kind,
      owner: item.owner,
      priority: item.priority,
      due: item.due ? toDomainPoint(item.due) : null,
      followup: item.followup ? toDomainPoint(item.followup) : null,
      tags: item.tags,
    },
    status: item.status,
    createdAtMs: Date.parse(item.createdAt),
    updatedAtMs: Date.parse(item.updatedAt),
    completedAtMs: item.completedAt ? Date.parse(item.completedAt) : null,
    deletedAtMs: item.deletedAt ? Date.parse(item.deletedAt) : null,
    version: item.version,
    // This slice is manual-only: the frozen 002 DDL CHECK pins source to
    // 'manual', so the wire value maps straight onto the domain's manual kind.
    // Later slices extend the union without widening this wire type.
    source: 'manual',
  };
}

export function fromWireEvent(event: {
  operationId: string;
  action: string;
  occurredAt: string;
  before: WireItem | null;
  after: WireItem;
}): TodoEvent {
  return {
    operationId: event.operationId,
    action: event.action,
    occurredAtMs: Date.parse(event.occurredAt),
    before: event.before ? fromWireItem(event.before) : null,
    after: fromWireItem(event.after),
  };
}

export interface SessionInfo {
  capabilities: string[];
  csrfToken: string;
}

export interface ApplicationSettingsSnapshot {
  contractVersion: 'web-api/1';
  settings: { timeZone: string };
  version: number;
  warning: string | null;
}

export class WebApiClient {
  private baseUrl: string;
  private csrfToken = '';

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getCsrfToken() {
    return this.csrfToken;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Host: window.location.host };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') {
      headers.Origin = window.location.origin;
      if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | null;
      throw new WebApiError(
        envelope?.error?.code ?? 'internal_error',
        response.status,
        envelope?.error?.message ?? '操作暂未完成，请重试。',
        envelope?.error?.details,
      );
    }
    return payload;
  }

  async pair(pairingCode: string): Promise<SessionInfo> {
    const payload = await this.request('POST', '/api/pair', { pairingCode }) as { session?: { capabilities?: string[] }; csrfToken?: string };
    const capabilities = payload.session?.capabilities ?? [];
    const csrfToken = payload.csrfToken ?? '';
    this.csrfToken = csrfToken;
    return { capabilities, csrfToken };
  }

  async readSession(): Promise<SessionInfo | null> {
    const payload = await this.request('GET', '/api/session') as { session?: { capabilities?: string[] }; csrfToken?: string };
    const csrfToken = payload.csrfToken ?? '';
    this.csrfToken = csrfToken;
    return { capabilities: payload.session?.capabilities ?? [], csrfToken };
  }

  async logout(): Promise<void> {
    await this.request('DELETE', '/api/session');
    this.csrfToken = '';
  }

  async listItems(): Promise<Todo[]> {
    const payload = await this.request('GET', '/api/manual-items?status=all') as { items?: WireItem[] };
    return (payload.items ?? []).map(fromWireItem);
  }

  async createItem(operationId: string, input: TodoInput): Promise<Todo> {
    const payload = await this.request('POST', '/api/manual-items', { operationId, input: toWireInput(input) }) as { item: WireItem };
    return fromWireItem(payload.item);
  }

  async updateItem(itemId: string, expectedVersion: number, operationId: string, input: TodoInput): Promise<Todo> {
    const payload = await this.request('PUT', `/api/manual-items/${itemId}`, {
      operationId,
      expectedVersion,
      input: toWireInput(input),
    }) as { item: WireItem };
    return fromWireItem(payload.item);
  }

  async setCompleted(itemId: string, expectedVersion: number, operationId: string, completed: boolean): Promise<Todo> {
    const payload = await this.request('POST', `/api/manual-items/${itemId}/${completed ? 'complete' : 'reopen'}`, {
      operationId,
      expectedVersion,
    }) as { item: WireItem };
    return fromWireItem(payload.item);
  }

  async deleteItem(itemId: string, expectedVersion: number, operationId: string): Promise<Todo> {
    const payload = await this.request('DELETE', `/api/manual-items/${itemId}`, {
      operationId,
      expectedVersion,
    }) as { item: WireItem };
    return fromWireItem(payload.item);
  }

  async history(itemId: string): Promise<TodoEvent[]> {
    const payload = await this.request('GET', `/api/manual-items/${itemId}/history`) as { events?: unknown[] };
    return (payload.events ?? []).map((event) => fromWireEvent(event as {
      operationId: string; action: string; occurredAt: string; before: WireItem | null; after: WireItem;
    }));
  }

  /// Read the application settings snapshot. The backend supplies the OS
  /// default timezone at version 0 when nothing has been saved, so a fresh
  /// install still has a consistent value.
  async readApplicationSettings(): Promise<ApplicationSettingsSnapshot> {
    const payload = await this.request('GET', '/api/settings/application') as {
      settings?: { timeZone?: string };
      version?: number;
    };
    return {
      contractVersion: CONTRACT_VERSION,
      settings: { timeZone: payload.settings?.timeZone ?? '' },
      version: payload.version ?? 0,
      warning: null,
    };
  }

  /// Write the application timezone with an atomic compare-and-set on the
  /// version from the last successful read.
  async writeApplicationSettings(timeZone: string, expectedVersion: number): Promise<ApplicationSettingsSnapshot> {
    const payload = await this.request('PUT', '/api/settings/application', { timeZone, expectedVersion }) as {
      settings?: { timeZone?: string };
      version?: number;
      warning?: string | null;
    };
    return {
      contractVersion: CONTRACT_VERSION,
      settings: { timeZone: payload.settings?.timeZone ?? timeZone },
      version: payload.version ?? expectedVersion + 1,
      warning: payload.warning ?? null,
    };
  }

  async workspace(): Promise<WorkspaceInfo> {
    const payload = await this.request('GET', '/api/workspace') as Partial<WireWorkspace>;
    return {
      needsSetup: Boolean(payload.needsSetup),
      root: payload.root ?? null,
      defaultRoot: payload.root ?? '',
      pendingRoot: payload.pendingRoot ?? null,
    };
  }

  asBackend(): Backend {
    return async (command: string, args: Record<string, unknown> = {}) => {
      switch (command) {
        case 'workspace_info':
          return this.workspace();
        case 'initialize_workspace':
          return this.workspace();
        case 'list_todos':
          return this.listItems();
        case 'create_todo':
          return this.createItem(args.operationId as string, args.input as TodoInput);
        case 'update_todo':
          return this.updateItem(args.id as string, args.expectedVersion as number, args.operationId as string, args.input as TodoInput);
        case 'set_todo_completed':
          return this.setCompleted(args.id as string, args.expectedVersion as number, args.operationId as string, Boolean(args.completed));
        case 'delete_todo':
          return this.deleteItem(args.id as string, args.expectedVersion as number, args.operationId as string);
        case 'todo_history':
          return this.history(args.id as string);
        case 'todo_source_links':
          return [];
        case 'open_workspace_directory':
          return null;
        default:
          throw new WebApiError('unsupported_command', 500, `不支持的命令：${command}`);
      }
    };
  }
}

let sharedClient: WebApiClient | null = null;

/// The one production client: pairing/session establish the CSRF token, and the
/// manual-item and application-settings writes reuse it. Tests and fixtures may
/// still construct or inject their own client.
export function getWebApiClient(): WebApiClient {
  if (!sharedClient) sharedClient = new WebApiClient();
  return sharedClient;
}
