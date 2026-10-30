import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalog } from '../runtime/mcp-catalog.mjs';
const tool = (schema = { type: 'object', properties: { query: { type: 'string' } } }) => ({ name: 'lookup', inputSchema: schema });
test('catalog keeps schema, rejects unsupported references and duplicate names', () => {
  assert.deepEqual(normalizeCatalog([tool()]), { tools: [tool()] });
  assert.throws(() => normalizeCatalog([tool({ type: 'object', $ref: '#/secret' })]));
  assert.throws(() => normalizeCatalog([tool(), tool()]));
});
test('known referenced values in any key or string reject the entire catalog', () => {
  assert.throws(() => normalizeCatalog([{ ...tool(), description: 'synthetic-private-value' }], ['synthetic-private-value']));
});
test('budgets accept large legal catalogs and reject exact limit plus one', () => {
  const tools = Array.from({ length: 16 }, (_, i) => ({ name: `t${i}`, description: 'x'.repeat(30000), inputSchema: { type: 'object' } }));
  assert.ok(Buffer.byteLength(JSON.stringify(normalizeCatalog(tools))) > 262144);
  const prefix = Buffer.byteLength(JSON.stringify({ tools: [{ name: 'a', description: '', inputSchema: { type: 'object' } }] }));
  const exact = [{ name: 'a', description: 'x'.repeat(524288 - prefix), inputSchema: { type: 'object' } }];
  assert.equal(Buffer.byteLength(JSON.stringify(normalizeCatalog(exact))), 524288);
  exact[0].description += 'x'; assert.throws(() => normalizeCatalog(exact));
});
