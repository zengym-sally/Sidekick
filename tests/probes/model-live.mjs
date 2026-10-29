import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = process.env.SIDEKICK_MODEL_ENV;
if (!config) throw new Error('Set SIDEKICK_MODEL_ENV to the explicitly selected private model configuration file');
const directory = process.env.SIDEKICK_BUNDLE_DIR || fileURLToPath(new URL('../../build/s0-runtime/', import.meta.url));
const result = spawnSync(join(directory, 'node'), [join(directory, 'probe.mjs'), '--model-env', resolve(config)], {
  env: { PATH: '/usr/bin:/bin' }, stdio: 'inherit', timeout: 130000,
});
process.exit(result.status ?? 1);
