export function applyProbeEvent(state, event, expected) {
  let action;
  try { action = JSON.parse(event.action_value); } catch { return 'invalid'; }
  if (!action || typeof action !== 'object' || typeof event.event_id !== 'string' || !event.event_id) return 'invalid';
  if (event.operator_id !== expected.operator || event.message_id !== expected.message || action.probe !== 'sidekick-s0') return 'unrelated';
  if (state.events.includes(event.event_id)) return 'duplicate';
  const item = state.items[action.todoId];
  if (!item || item.version !== action.version) return 'stale';
  if (!['complete', 'snooze'].includes(action.action)) return 'invalid';
  if (action.action === 'complete') item.status = 'completed';
  else item.reminderAt = expected.now + 3600000;
  item.version += 1;
  state.events.push(event.event_id);
  return action.action;
}
