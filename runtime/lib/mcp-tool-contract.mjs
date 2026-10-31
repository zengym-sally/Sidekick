import { createHash } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const modelToolName = (serverId, name) => `mcp_${createHash('sha256').update(`${serverId}\0${name}`).digest('hex').slice(0, 56)}`;

export function canonicalArguments(value) {
  const fail = () => { throw new Error('MCP_ARGUMENT_INVALID'); };
  let nodes = 0;
  function sort(input, depth) {
    if (++nodes > 4096 || depth > 64) fail();
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(item => sort(item, depth + 1));
    if (object(input) && [Object.prototype, null].includes(Object.getPrototypeOf(input))) return Object.fromEntries(Object.keys(input).sort().map(key => [key, sort(input[key], depth + 1)]));
    fail();
  }
  if (!object(value)) fail();
  const json = JSON.stringify(sort(value, 0));
  if (Buffer.byteLength(json) > 65536) fail();
  return json;
}

export function checkArguments(raw, validated) {
  const json = canonicalArguments(raw);
  if (json !== canonicalArguments(validated)) throw new Error('MCP_ARGUMENT_INVALID');
  return json;
}

export function checkMcpResult(result, sensitive = [], previousBytes = 0) {
  const fail = () => { throw new Error('MCP_RESULT_INVALID'); };
  if (!object(result) || !Array.isArray(result.content) || Object.keys(result).some(key => !['content', 'structuredContent', 'isError', '_meta'].includes(key))) fail();
  if (result.isError !== undefined && typeof result.isError !== 'boolean') fail();
  if (result.structuredContent !== undefined && !object(result.structuredContent)) fail();
  if (result._meta !== undefined && !object(result._meta)) fail();
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > 262144 || bytes + previousBytes > 524288) fail();
  function privateValue(value) {
    if (typeof value === 'string') return sensitive.some(secret => secret && value.includes(secret));
    if (Array.isArray(value)) return value.some(privateValue);
    return object(value) && Object.entries(value).some(([key, item]) => privateValue(key) || privateValue(item));
  }
  if (privateValue(result)) throw new Error('MCP_PRIVATE_OUTPUT');
  const content = result.content.map(block => {
    if (!object(block)) fail();
    if (block.type === 'text') {
      if (typeof block.text !== 'string') fail();
      return { type: 'text', text: block.text };
    }
    if (['image', 'audio'].includes(block.type)) {
      if (typeof block.data !== 'string' || typeof block.mimeType !== 'string') fail();
    } else if (block.type === 'resource_link') {
      if (typeof block.uri !== 'string' || typeof block.name !== 'string') fail();
    } else if (block.type === 'resource') {
      if (!object(block.resource) || typeof block.resource.uri !== 'string' || (typeof block.resource.text !== 'string' && typeof block.resource.blob !== 'string')) fail();
    } else fail();
    return { type: 'text', text: JSON.stringify(block) };
  });
  if (result.structuredContent !== undefined) content.push({ type: 'text', text: JSON.stringify(result.structuredContent) });
  return { result, content, isError: result.isError === true, bytes };
}
