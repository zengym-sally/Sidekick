const bytes = value => Buffer.byteLength(JSON.stringify(value));
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'default', 'title', 'description', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties']);
const fail = () => { throw new Error('MCP_CATALOG_INVALID'); };
export function checkSchema(root) {
  let nodes = 0;
  function walk(value, depth) {
    if (++nodes > 4096 || depth > 64) fail();
    if (Array.isArray(value)) for (const item of value) walk(item, depth + 1);
    else if (object(value)) for (const item of Object.values(value)) walk(item, depth + 1);
  }
  walk(root, 0);
  function schema(s) {
    if (!object(s)) fail();
    for (const key of Object.keys(s)) if (!allowed.has(key)) fail();
    if (s.type !== undefined && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(s.type)) fail();
    if (s.properties !== undefined) { if (!object(s.properties)) fail(); for (const v of Object.values(s.properties)) schema(v); }
    if (s.required !== undefined && (!Array.isArray(s.required) || !s.required.every(x => typeof x === 'string') || new Set(s.required).size !== s.required.length)) fail();
    if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') schema(s.additionalProperties);
    if (s.items !== undefined) schema(s.items);
    for (const k of ['title', 'description', 'pattern']) if (s[k] !== undefined && typeof s[k] !== 'string') fail();
    if (s.pattern !== undefined) { try { new RegExp(s.pattern, 'u'); } catch { fail(); } }
    if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) fail();
    for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']) if (s[k] !== undefined && (typeof s[k] !== 'number' || !Number.isFinite(s[k]) || (k === 'multipleOf' && s[k] <= 0))) fail();
    for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']) if (s[k] !== undefined && (!Number.isSafeInteger(s[k]) || s[k] < 0)) fail();
    if (s.uniqueItems !== undefined && typeof s.uniqueItems !== 'boolean') fail();
  }
  if (!object(root) || root.type !== 'object' || bytes(root) > 32768) fail();
  schema(root);
}
export function normalizeCatalog(tools, sensitive = []) {
  if (!Array.isArray(tools) || tools.length > 64) fail();
  const names = new Set();
  const normalized = tools.map(t => {
    if (!object(t) || typeof t.name !== 'string' || !t.name || Buffer.byteLength(t.name) > 256 || /[\p{Cc}]/u.test(t.name) || names.has(t.name)) fail();
    names.add(t.name); checkSchema(t.inputSchema);
    if (t.description !== undefined && typeof t.description !== 'string') fail();
    return { name: t.name, ...(t.description === undefined ? {} : { description: t.description }), inputSchema: t.inputSchema };
  });
  const result = { tools: normalized };
  if (bytes(result) > 524288) fail();
  function privateValue(v) {
    if (typeof v === 'string') return sensitive.some(s => s && v.includes(s));
    if (Array.isArray(v)) return v.some(privateValue);
    return object(v) && Object.entries(v).some(([k, x]) => privateValue(k) || privateValue(x));
  }
  if (privateValue(result)) throw new Error('MCP_PRIVATE_OUTPUT');
  return result;
}
