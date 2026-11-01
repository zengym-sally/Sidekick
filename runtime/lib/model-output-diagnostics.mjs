import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const maximum = 16384;
const fields = new Set(['changes','preview','candidates','fields','title','kind','owner','priority','tags','evidence','dueExpression','followupExpression','warnings','unresolved','due','followup','atMs','timeZone','precision','expression','ok','type','text','content','role','id']);
const reasons = new Set(['raw-type','raw-size','json','object-type','object-keys','text','kind','priority','tags','evidence','date-evidence','task-kind','changes-empty','followup','model-error','contract']);
const invalid = () => new Error('OUTPUT_DIAGNOSTIC_INVALID');

function projection(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes++;
  if (depth >= 6) return { type: 'truncated' };
  if (value === null) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string', bytes: Buffer.byteLength(value) };
  if (typeof value === 'number') return { type: 'number', finite: Number.isFinite(value) };
  if (typeof value === 'boolean') return { type: 'boolean' };
  const array = Array.isArray(value), children = array ? value : Object.entries(value);
  const result = array ? { type: 'array', length: value.length, items: [] } : { type: 'object', entryCount: children.length, entries: [] };
  for (const child of children) {
    if (budget.nodes >= 64) break;
    const truncated = budget.nodes === 63;
    const next = truncated ? (budget.nodes++, { type: 'truncated' }) : projection(array ? child : child[1], depth + 1, budget);
    if (array) result.items.push(next);
    else result.entries.push({ key: fields.has(child[0]) ? child[0] : '<redacted>', value: next });
    if (truncated) break;
  }
  return result;
}

function keys(value, allowed) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key)); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function metaValid(value) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value.runId || '') && ['extract','revise','trial'].includes(value.kind) && ['validated','rejected','unavailable'].includes(value.outcome) && (value.outcome === 'validated' ? value.reason === null : reasons.has(value.reason));
}
function shapeValid(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 64 || depth > 6 || !value || typeof value !== 'object') return false;
  if (['null','boolean','truncated','invalid-json'].includes(value.type)) return keys(value, ['type']);
  if (value.type === 'string') return keys(value, ['type','bytes']) && integer(value.bytes);
  if (value.type === 'number') return keys(value, ['type','finite']) && typeof value.finite === 'boolean';
  if (value.type === 'array') return keys(value, ['type','length','items']) && integer(value.length) && Array.isArray(value.items) && value.items.length <= value.length && value.items.every(item => shapeValid(item, depth + 1, budget));
  if (value.type === 'object') return keys(value, ['type','entryCount','entries']) && integer(value.entryCount) && Array.isArray(value.entries) && value.entries.length <= value.entryCount && value.entries.every(entry => keys(entry, ['key','value']) && (fields.has(entry.key) || entry.key === '<redacted>') && shapeValid(entry.value, depth + 1, budget));
  return false;
}
function valid(value) {
  return keys(value, ['version','runId','kind','outcome','reason','raw','canonicalShape']) && value.version === 1 && metaValid(value) && (value.raw === null || keys(value.raw, ['sha256','bytes','shape']) && /^[0-9a-f]{64}$/.test(value.raw.sha256) && integer(value.raw.bytes) && shapeValid(value.raw.shape)) && (value.canonicalShape === null || shapeValid(value.canonicalShape));
}

export function buildOutputDiagnostic(raw, metadata, canonical) {
  if (!metaValid(metadata) || raw !== null && typeof raw !== 'string') throw invalid();
  let shape;
  if (typeof raw === 'string') {
    if (raw.length > 262144) shape = { type: 'truncated' };
    else {
      try { shape = projection(JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))); }
      catch { shape = { type: 'invalid-json' }; }
    }
  }
  const result = { version: 1, runId: metadata.runId, kind: metadata.kind, outcome: metadata.outcome, reason: metadata.reason, raw: raw === null ? null : { sha256: createHash('sha256').update(raw).digest('hex'), bytes: Buffer.byteLength(raw), shape }, canonicalShape: canonical === undefined ? null : projection(canonical) };
  if (!valid(result) || Buffer.byteLength(JSON.stringify(result)) + 1 > maximum) throw invalid();
  return result;
}

function same(a, b) { return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode; }
function privateDirectory(info) { return info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o7777) === 0o700; }

export async function writeOutputDiagnostic(cwd, value) {
  if (!valid(value)) throw invalid();
  const data = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(data) > maximum || typeof cwd !== 'string' || resolve(cwd) !== cwd || await realpath(cwd) !== cwd) throw invalid();
  const before = await lstat(cwd);
  if (!privateDirectory(before)) throw invalid();
  const directory = await open(cwd, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let file;
  try {
    if (!same(before, await directory.stat())) throw invalid();
    const path = join(cwd, 'output-diagnostic.json');
    file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const initial = await file.stat();
    if (!initial.isFile() || initial.uid !== process.getuid() || initial.nlink !== 1 || (initial.mode & 0o7777) !== 0o600) throw invalid();
    await file.writeFile(data); await file.sync();
    const held = await file.stat(), linked = await lstat(path);
    if (held.nlink !== 1 || linked.nlink !== 1 || !same(initial, held) || !same(initial, linked) || !same(before, await lstat(cwd))) throw invalid();
    await directory.sync();
  } finally { await file?.close(); await directory.close(); }
}
