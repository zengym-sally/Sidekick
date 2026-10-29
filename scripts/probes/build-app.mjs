import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { release } from 'node:os';

const env = { ...process.env };
if (process.platform === 'darwin' && Number(release().split('.')[0]) >= 26) {
  if (env.RUSTC_WRAPPER) throw new Error('An existing RUSTC_WRAPPER must be reviewed before chaining wrappers.');
  const wrapper = resolve('scripts/probes/rustc-host-macro.py');
  chmodSync(wrapper, 0o755);
  env.RUSTC_WRAPPER = wrapper;
  console.log('Applying the S0 host proc-macro workaround; target application deployment settings remain intact.');
}
const result = spawnSync(resolve('node_modules/.bin/tauri'), ['build', '--bundles', 'app'], { env, stdio: 'inherit' });
process.exit(result.status ?? 1);
