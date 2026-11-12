//! Pairing-session state and the authoritative task/item sync subscription.
//!
//! Frozen `web-api/2` §6 (SSE rules verbatim V1) + intake contract §6.3,
//! implemented literally:
//!
//! - V2 identification: every frame payload must name `web-api/2` (§1); a V1
//!   or versionless frame is rejected outright and never drives state.
//!
//! - Transport: a same-origin fetch stream (`sse-stream.ts`), NOT native
//!   `EventSource` — the §6 compensation requires resubscribing with the
//!   snapshot's `lastEventId` as the `Last-Event-ID` request header, which
//!   `EventSource` cannot carry. The token is a header, never a URL query,
//!   and nothing is persisted: the token lives in memory only.
//! - Token discipline: the reconnect token is the last APPLIED
//!   `<epoch>:<cursor>` pair, taken from frame `id:` lines and the snapshot —
//!   never from `stream.ready` (it has no `id` line and reports the server's
//!   watermark, not what this client applied). APPLIED is stronger than
//!   "received": a frame's cursor commits only after the authoritative
//!   read-back it dispatched completed successfully, a cursor at or below the
//!   applied one is ignored outright (the token can never regress), and a
//!   frame from a foreign epoch never switches the outer epoch in place — it
//!   goes through the snapshot path like any epoch crossing.
//! - reset/epoch: a `stream.reset` frame closes the current stream, GETs
//!   `/api/snapshot`, CONSUMES it through the organizer store (the
//!   authoritative task baseline — a snapshot is never fetched and dropped),
//!   and resubscribes with the snapshot's `lastEventId`. No cross-epoch
//!   in-place merging exists anywhere on this path.
//! - Hints only: frames carry no authoritative payload into state; every
//!   frame class triggers the fenced read-backs that own the state. Only the
//!   protocol metadata (token/epoch) is retained.
//! - Read-back coverage: first subscribe and every reconnect refresh manual
//!   items AND the organizer's sources/candidates/tasks (`stream.ready` is
//!   never only a todos refresh); the queue display gets an explicit
//!   invalidation seam.
//! - 401 / session loss / dispose: the stream and every in-flight sync
//!   continuation are terminated (a fence sequence guards them), drafts in
//!   the organizer store survive, and nothing about the session (cookie/
//!   CSRF) is stored here.

import { ref } from 'vue';
import { defineStore } from 'pinia';
import { WebApiClient, getWebApiClient } from '../lib/web-api-client.ts';
import { openSseStream, SseStreamError, type SseFrame, type SseStreamHandle } from '../lib/sse-stream.ts';
import { useOrganizer } from './organizer.ts';

const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 2000;
const RESYNC_BASE_MS = 100;
const RESYNC_MAX_MS = 1000;

export function createPairing(client: WebApiClient = getWebApiClient()) {
  const ready = ref(false);
  const paired = ref(false);
  const busy = ref(false);
  const code = ref('');
  const error = ref('');
  /// The epoch the sync pipeline currently treats as authoritative. The queue
  /// display fences its reads with it: a response that started under another
  /// epoch never lands.
  const syncEpoch = ref<string | null>(null);
  let stream: SseStreamHandle | null = null;
  let started = false;
  /// Hint handlers receive the SSE event NAME only — never frame payloads.
  /// Old zero-parameter handlers stay valid; the name is additional input.
  /// A handler may return a promise (the real gate returns the authoritative
  /// read-backs); a void return stays valid. The pairing store gates the
  /// reconnect-token commit on these promises (see `commitAfter`).
  let onItemChanged: (event: string) => unknown = () => {};
  /// Queue-display invalidation seam: the pairing store notifies the mounted
  /// queue component; the authoritative task state itself lives in the
  /// organizer store and does NOT depend on this callback (an unmounted
  /// queue loses only its display refresh, never the authority).
  let onTasksInvalidated: (() => void) | null = null;
  /// Last APPLIED `<epoch>:<cursor>` reconnect token (memory only). The token
  /// is committed ONLY after the authoritative read-back a frame dispatched
  /// has completed successfully — frame arrival alone is not application.
  let token: string | null = null;
  /// Applied high-water cursor within the current epoch. It is the rejection
  /// criterion for old frames (§6: `cursor <=` applied is ignored outright)
  /// and only ever moves forward, so the reconnect token can never regress.
  let appliedCursor = 0;
  /// Fence for stream/snapshot continuations: session loss, dispose and every
  /// resync bump it, so an in-flight continuation of a superseded pipeline
  /// step can never land.
  let syncSeq = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let resyncAttempts = 0;

  function setOnItemChanged(handler: (event: string) => void) {
    onItemChanged = handler;
  }

  function setOnTasksInvalidated(handler: (() => void) | null) {
    onTasksInvalidated = handler;
  }

  function notifyTasksInvalidated(): unknown {
    return onTasksInvalidated?.();
  }

  function notify(event: string): unknown {
    return onItemChanged(event);
  }

  /// Close the stream, cancel the pending reconnect and fence every
  /// continuation that belonged to the old pipeline.
  function closeStream() {
    if (stream) {
      stream.close();
      stream = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    syncSeq += 1;
  }

  function tokenParts(value: string): { epoch: string; cursor: number } | null {
    const match = /^([^:]+):(\d+)$/.exec(value);
    if (!match) return null;
    return { epoch: match[1], cursor: Number(match[2]) };
  }

  /// §6 client rule for a frame `id:` line (`<epoch>:<cursor>`), tightened by
  /// the coordination review: apply same-epoch events ONLY — a frame from a
  /// foreign epoch never switches the outer epoch in place (an epoch crossing
  /// is announced by `stream.reset` and goes through the snapshot path, so a
  /// stray cross-epoch frame is routed there too), and a cursor at or below
  /// the applied cursor is ignored outright, so the reconnect token can never
  /// regress. Returns the accepted parts, or null when the frame is not
  /// applicable.
  function acceptFrameId(id: string): { epoch: string; cursor: number } | null {
    const parts = tokenParts(id);
    if (!parts) return null;
    if (syncEpoch.value == null) syncEpoch.value = parts.epoch;
    else if (parts.epoch !== syncEpoch.value) {
      void resync();
      return null;
    }
    if (parts.cursor <= appliedCursor) return null;
    return parts;
  }

  /// A frame is APPLIED only when the authoritative read-back it dispatched
  /// has completed successfully — arrival alone never advances the token.
  /// Every read-back is a full-state read, so one successful chain proves
  /// every event up to and including its frame's cursor; a failed chain (or a
  /// hint that ran no read-back at all) proves nothing and leaves the token
  /// conservative, so the reconnect replay re-delivers the hint instead of
  /// silently skipping past it.
  function commitAfter(reads: unknown[], cursor: number) {
    const promises = reads.filter((read): read is Promise<unknown> => read instanceof Promise);
    // No compensation ran (e.g. a progress-only hint with the event-name
    // handlers absent): nothing proved application, the token stays put.
    if (promises.length === 0) return;
    const seq = syncSeq;
    void Promise.allSettled(promises).then((outcomes) => {
      // Superseded pipeline (resync / session loss / dispose): the token is
      // owned by the snapshot or nothing, never by this frame.
      if (seq !== syncSeq) return;
      if (!outcomes.every((outcome) => outcome.status === 'fulfilled')) return;
      commitApplied(cursor);
    });
  }

  function commitApplied(cursor: number) {
    const epoch = syncEpoch.value;
    if (!epoch || cursor <= appliedCursor) return;
    appliedCursor = cursor;
    token = `${epoch}:${cursor}`;
  }

  function payloadOf(frame: SseFrame): Record<string, unknown> | null {
    try {
      return JSON.parse(frame.data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /// Frozen web-api/2 §1 (with §6: handshake/event rules verbatim V1): every
  /// SSE frame's data payload is a JSON envelope that must name `web-api/2`.
  /// A frame that does not — a V1 server, a wrong version, malformed JSON —
  /// is not application evidence and is rejected outright: no token commit,
  /// no read-back dispatch, no epoch adoption, no snapshot resync. There is
  /// no default version and no V1 compatibility path.
  function v2PayloadOf(frame: SseFrame): Record<string, unknown> | null {
    const payload = payloadOf(frame);
    if (payload === null || payload.contractVersion !== 'web-api/2') return null;
    return payload;
  }

  function handleFrame(frame: SseFrame) {
    const payload = v2PayloadOf(frame);
    if (payload === null) return;
    if (frame.event === 'stream.reset') {
      // Frozen §6: reset (epoch changed / token unresumable) requires a
      // snapshot resync — no cross-epoch in-place merge, no same-connection
      // convergence shortcut.
      void resync();
      return;
    }
    if (frame.event === 'stream.ready') {
      const nextEpoch = typeof payload?.epoch === 'string' ? payload.epoch : null;
      reconnectAttempts = 0;
      resyncAttempts = 0;
      // Defensive: a ready frame for an epoch our token does not belong to
      // means the handshake bypassed the reset path — resync anyway. The
      // outer epoch moves only AFTER that check: the applied-cursor fence in
      // `resync` compares epochs, and flipping it first would make a new
      // instance's LOW cursor look like a same-epoch old snapshot — §6 is
      // explicit that a cursor is a per-instance value, so a new instance's
      // regression is not an old event and must go through the snapshot.
      if (nextEpoch && token) {
        const parts = tokenParts(token);
        if (parts && parts.epoch !== nextEpoch) {
          void resync();
          return;
        }
      }
      if (nextEpoch) syncEpoch.value = nextEpoch;
      // First subscribe or reconnect: read-back compensation for manual
      // items AND the organizer surface (never only todos), plus the queue.
      // The handshake frame carries no cursor, so these reads are plain
      // compensation (never a token gate): failures are surfaced by the
      // owning store and consumed here.
      void Promise.resolve(notify('stream.ready')).catch(() => {});
      notifyTasksInvalidated();
      return;
    }
    // §6 client rule: same-epoch, strictly-newer frames only. An old cursor
    // is ignored outright (it can never pull the token back), and a foreign
    // epoch goes through the snapshot path. `acceptFrameId` returns null for
    // both, and for every frame without an `id:` line (hints and handshake
    // frames — they carry no cursor and never touch the token).
    const accepted = frame.id ? acceptFrameId(frame.id) : null;
    if (frame.id && !accepted) return;
    if (frame.event === 'task.changed' || frame.event === 'settings.changed') {
      commitAfter([notify(frame.event), notifyTasksInvalidated()], accepted?.cursor ?? 0);
      return;
    }
    commitAfter([notify(frame.event)], accepted?.cursor ?? 0);
  }

  /// Frozen §6 snapshot resync: consume `GET /api/snapshot` into the
  /// organizer baseline, adopt its `lastEventId` as the reconnect token and
  /// open a fresh connection carrying it in the `Last-Event-ID` header. The
  /// snapshot token is resumable by construction, so the next handshake is
  /// `stream.ready` — there is no ready -> snapshot -> resubscribe loop; the
  /// attempt pacing below only bounds a pathological reset storm.
  async function resync() {
    closeStream();
    const seq = syncSeq;
    resyncAttempts += 1;
    const delay = Math.min(RESYNC_MAX_MS, RESYNC_BASE_MS * (resyncAttempts - 1));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (seq !== syncSeq) return;
    try {
      const snapshot = await client.readSnapshot();
      if (seq !== syncSeq) return;
      // Applied-cursor fence (coordination review): a same-epoch snapshot at
      // or below the applied cursor is an old async response — consuming it
      // could only point the token backwards, so it is never consumed and the
      // subscription is restored with the committed token (whose cursor is
      // already at or ahead of the snapshot's). A cross-epoch snapshot is the
      // whole-generation replacement path and is always consumed.
      if (snapshot.epoch === syncEpoch.value && snapshot.highWatermark <= appliedCursor) {
        subscribe();
        return;
      }
      useOrganizer().applySnapshot(snapshot, syncEpoch.value);
      token = snapshot.lastEventId;
      appliedCursor = snapshot.highWatermark;
      syncEpoch.value = snapshot.epoch;
      notifyTasksInvalidated();
      // The token was already committed from the consumed snapshot, so this
      // read-back is plain compensation (never a token gate): a failure is
      // surfaced by the owning store and consumed here.
      void Promise.resolve(notify('stream.reset')).catch(() => {});
      subscribe();
    } catch {
      if (seq !== syncSeq) return;
      // A 401 on the snapshot read already flowed through the shared
      // client's session-lost path (which fences this continuation via
      // syncSeq); anything else retries through the plain reconnect path.
      scheduleReconnect();
    }
  }

  function scheduleReconnect(delayMs?: number) {
    if (reconnectTimer || !paired.value) return;
    const delay = delayMs ?? Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempts++);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (paired.value && !stream) subscribe();
    }, delay);
  }

  function subscribe() {
    if (stream) return;
    const seq = syncSeq;
    openSseStream('/api/events', {
      lastEventId: token,
      onFrame: (frame) => {
        if (seq !== syncSeq) return;
        handleFrame(frame);
      },
      onEnd: () => {
        if (seq !== syncSeq) return;
        stream = null;
        scheduleReconnect();
      },
    }).then((handle) => {
      if (seq !== syncSeq) {
        handle.close();
        return;
      }
      stream = handle;
    }).catch((reason) => {
      if (seq !== syncSeq) return;
      stream = null;
      if (reason instanceof SseStreamError && reason.status === 401) {
        handleSessionLost();
        return;
      }
      scheduleReconnect();
    });
  }

  async function start() {
    if (started) return;
    started = true;
    client.onSessionLost?.(handleSessionLost);
    try {
      const session = await client.readSession();
      if (session) {
        paired.value = true;
        subscribe();
      }
    } catch {
      // No session yet: show the pairing gate.
    } finally {
      ready.value = true;
    }
  }

  async function pair() {
    if (busy.value) return false;
    busy.value = true;
    error.value = '';
    try {
      await client.pair(code.value.trim());
      paired.value = true;
      subscribe();
      return true;
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '配对失败，请检查配对码。';
      return false;
    } finally {
      busy.value = false;
    }
  }

  function dispose() {
    closeStream();
  }

  /// The shared client cleared its CSRF token: drop the pairing state,
  /// terminate the old stream AND the old sync (the fence kills in-flight
  /// snapshot/reconnect continuations), clear the protocol metadata and show
  /// the gate again. Drafts in the organizer store are untouched.
  function handleSessionLost() {
    paired.value = false;
    ready.value = true;
    error.value = '';
    closeStream();
    token = null;
    appliedCursor = 0;
    syncEpoch.value = null;
    reconnectAttempts = 0;
    resyncAttempts = 0;
  }

  return { ready, paired, busy, code, error, syncEpoch, start, pair, dispose, setOnItemChanged, setOnTasksInvalidated, handleSessionLost };
}

export const usePairing = defineStore('pairing', () => createPairing());
