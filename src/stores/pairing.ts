//! Pairing-session state and the manual-item SSE subscription.
//!
//! The store owns the pairing code entry, the session check and the in-process
//! `item.changed` hint stream. Item frames are hints only: every subscribe,
//! reconnect and `stream.reset` triggers a read-back refresh (W1 contract §5).

import { ref } from 'vue';
import { defineStore } from 'pinia';
import { WebApiClient, getWebApiClient } from '../lib/web-api-client.ts';

export function createPairing(client: WebApiClient = getWebApiClient()) {
  const ready = ref(false);
  const paired = ref(false);
  const busy = ref(false);
  const code = ref('');
  const error = ref('');
  let source: EventSource | null = null;
  let started = false;
  let onItemChanged: () => void = () => {};

  function setOnItemChanged(handler: () => void) {
    onItemChanged = handler;
  }

  function subscribe() {
    if (source || typeof EventSource === 'undefined') return;
    source = new EventSource('/api/events', { withCredentials: true });
    for (const event of ['stream.ready', 'stream.reset', 'item.changed']) {
      source.addEventListener(event, () => onItemChanged());
    }
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
    if (source) source.close();
    source = null;
  }

  /// The shared client cleared its CSRF token: drop the pairing state, close
  /// the hint stream and show the gate again.
  function handleSessionLost() {
    paired.value = false;
    ready.value = true;
    error.value = '';
    dispose();
  }

  return { ready, paired, busy, code, error, start, pair, dispose, setOnItemChanged, handleSessionLost };
}

export const usePairing = defineStore('pairing', () => createPairing());
