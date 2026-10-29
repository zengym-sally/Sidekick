import ctypes
import json
import os
from pathlib import Path
import subprocess
import tempfile

with tempfile.TemporaryDirectory(prefix='sidekick-toolchain-') as directory:
    root = Path(directory)
    source = root / 'macro.rs'
    source.write_text('extern crate proc_macro; use proc_macro::TokenStream; #[proc_macro] pub fn probe(input: TokenStream) -> TokenStream { input }\n')
    wrapper = Path(__file__).resolve().parents[2] / 'scripts/probes/rustc-host-macro.py'
    results = []
    for name, configured, wrapped in [('configured', True, False), ('host', False, False), ('wrapped', True, True)]:
        env = dict(os.environ)
        env.pop('MACOSX_DEPLOYMENT_TARGET', None)
        if configured:
            env['MACOSX_DEPLOYMENT_TARGET'] = '12.0'
        output = root / (name + '.dylib')
        args = ['rustc', '--crate-name', 'sidekick_macro_probe', '--crate-type', 'proc-macro', '-C', 'strip=debuginfo', str(source), '-o', str(output)]
        if wrapped:
            args = ['python3', str(wrapper), *args]
        subprocess.run(args, check=True, env=env, capture_output=True)
        loaded, message = False, None
        try:
            ctypes.CDLL(str(output))
            loaded = True
        except OSError as error:
            message = 'mis-aligned LINKEDIT string pool' if 'mis-aligned LINKEDIT' in str(error) else 'other loader failure'
        results.append({'case': name, 'loaded': loaded, 'error': message})
    assert results[1]['loaded'] and results[2]['loaded'], results
    print(json.dumps({'status': 'passed', 'cases': results, 'workaroundNeededOnThisHost': not results[0]['loaded']}))
