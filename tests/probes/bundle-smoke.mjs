import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = process.env.SIDEKICK_BUNDLE_DIR || fileURLToPath(new URL('../../build/s0-runtime/', import.meta.url));
const result = JSON.parse(execFileSync(join(directory, 'node'), [join(directory, 'probe.mjs'), join(directory, 'skills')], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 20000 }));
for (const field of ['read', 'bash', 'bashFindsBundledCli', 'mcpStdio', 'mcpStreamableHttp', 'mcpAgentToolRoundtrip']) assert.equal(result[field], true, field);
assert.equal(result.status, 'passed');
assert.equal(result.businessWrites, 0);
console.log(JSON.stringify(result));
