// Real-shaped frame builders for the MCP begin/closed pairing regression
// (MAYNE-24). The shapes are read from the production runtime sources, not
// invented:
//   runtime/lib/mcp-trial.mjs  call_begin   -> control.request('call_begin',
//     { ...identity, serverId, callId, input: { id, modelCallId, modelName,
//       configurationRevision, schemaSha256, argumentsJson } })
//   runtime/lib/mcp-trial.mjs  call_response -> control.request('call_response',
//     { ...identity, serverId, callId, result })   <-- NO input, NO modelCallId
//   runtime/lib/mcp-control.mjs the wire envelope adds
//     { type: 'mcp', action, ...body, requestId, runId, hostNonce }
// A response therefore never repeats the begin's `modelCallId`: the closure
// must associate by the single-call identity (serverId + callId) and reuse the
// persisted begin's callKey — never by service alone and never FIFO.
//
// Inputs only: builders and the golden control replay. No assertions live
// here.

import { readFileSync } from 'node:fs';

/// The fencing pair the golden control's live frames carry; the remaining
/// golden frames are foreign (stale runId or forged nonce) and must be
/// replayed with their own fencing so the production fence can drop them.
const GOLDEN_LIVE = { runId: 'run_aaa', hostNonce: '1'.repeat(48) };

export function mcpBegin({ requestId, serverId, callId, modelCallId, modelName }) {
  return {
    type: 'mcp', action: 'call_begin', requestId, serverId, callId,
    input: {
      id: callId,
      modelCallId,
      modelName: modelName ?? `mcp_${serverId}_tool`,
      configurationRevision: 'rev-7',
      schemaSha256: 'a'.repeat(64),
      argumentsJson: '{"q":"synthetic"}',
    },
  };
}

export function mcpResponse({ requestId, serverId, callId }) {
  return {
    type: 'mcp', action: 'call_response', requestId, serverId, callId,
    result: { content: [{ type: 'text', text: 'synthetic tool output' }] },
  };
}

/// The extract result frame that stages the task outcome after the scripted
/// side-effect frames have landed.
export function extractResultFrame() {
  return {
    type: 'result',
    data: {
      candidates: [{
        fields: { title: '整理接入清单', kind: 'action', owner: '我', priority: 'high', tags: [], due: null, followup: null },
        evidence: '我负责整理接入清单',
        dueExpression: null,
        followupExpression: null,
      }],
    },
  };
}

/// The golden control replay: real captured runtime frames from the frozen
/// P-3 evidence pack (sha256 35d7b97e…, registered in the receipts decision
// review rounds). Live frames are re-fenced by the worker; foreign frames
// keep their own fencing (`keepFence`) and must record nothing.
export function loadGoldenFrames() {
  const url = new URL('./mcp-pairing-golden-frames.jsonl', import.meta.url);
  return readFileSync(url, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .map((frame) => {
      const live = frame.runId === GOLDEN_LIVE.runId && frame.hostNonce === GOLDEN_LIVE.hostNonce;
      return live ? frame : { ...frame, keepFence: true };
    });
}
