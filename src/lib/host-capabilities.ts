/// Whether the desktop native bridge is present.
///
/// In a plain browser the app runs the HTTP-backed manual path only: the
/// native-only model/agent/skill/organizer/profile entries stay disabled and
/// report an accurate "not connected" state instead of failing at startup.

export function nativeBridgeAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  return typeof internals === 'object' && internals !== null;
}
