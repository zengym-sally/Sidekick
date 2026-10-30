import datetime
import hashlib
import json
import os
import pathlib
import shlex
import subprocess

root = pathlib.Path(__file__).resolve().parents[3]
os.chdir(root)
evidence = root / 'docs/reviews/s33-p2-ui-20261030'
manifest = json.loads((evidence / 'review-round3-inputs.json').read_text())
for item in manifest['sourceInputs']:
    data = (root / item['path']).read_bytes()
    assert hashlib.sha256(data).hexdigest() == item['sha256'], item['path']

cargo = ['cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib']
checks = [
    ('50-final-ui-domain', ['npm', 'run', 'test:s33-ui-domain']),
    ('51-final-config-domain', ['npm', 'run', 'test:s33-config-domain']),
    ('52-final-security-domain', ['npm', 'run', 'test:s33-security-domain']),
    ('53-final-root-safety', ['npm', 'run', 'test:s33-ui-safety']),
    ('54-final-schema-store', cargo + ['mcp_schema', '--', '--test-threads=1']),
    ('55-final-config-store', cargo + ['mcp_config', '--', '--test-threads=1']),
    ('56-final-security-store', cargo + ['mcp_security', '--', '--test-threads=1']),
    ('57-final-catalog-store', cargo + ['mcp_catalog', '--', '--test-threads=1']),
    ('58-final-local-store', cargo + ['local_store::tests', '--', '--test-threads=1']),
    ('59-final-ingestion-store', cargo + ['local_store::ingestion::tests', '--', '--test-threads=1']),
    ('60-final-agent-save', cargo + ['local_store::agent_config::tests::three_agents_save_reset_and_reopen_without_business_writes', '--', '--exact', '--test-threads=1']),
    ('61-final-verification-guards', cargo + ['--features', 's33-mcp-verification,s33-mcp-ui-verification', 'verification', '--', '--test-threads=1']),
    ('62-final-types', ['npm', 'run', 'typecheck']),
    ('63-final-fmt', ['cargo', 'fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check']),
    ('64-final-clippy-default', ['cargo', 'clippy', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets', '--', '-D', 'warnings']),
    ('65-final-clippy-verification', ['cargo', 'clippy', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets', '--features', 's33-mcp-verification,s33-mcp-ui-verification', '--', '-D', 'warnings']),
    ('66-final-discovery', ['npm', 'run', 'test:s33-discovery']),
    ('67-final-verification-build', ['npm', 'run', 'build:s33-ui-verify']),
    ('68-final-ordinary-build', ['npm', 'run', 'probe:app']),
    ('69-final-artifact-exclusion', ['node', '--test', '--test-timeout=15000', 'tests/s33-ui-artifacts.test.mjs']),
]
summary = {'layer': 'serial local checks; no native GUI acceptance', 'sourceInputs': 'review-round3-inputs.json', 'checks': []}
for name, command in checks:
    path = evidence / 'raw' / (name + '.log')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    env = os.environ.copy()
    if name == '66-final-discovery':
        env['SIDEKICK_DISCOVERY_EVIDENCE'] = str(evidence / 'processes-final')
    with path.open('w') as output:
        output.write('COMMAND ' + shlex.join(command) + '\nSTART_UTC ' + started + '\n')
        output.flush()
        completed = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, env=env)
        output.write('\nEXIT_CODE ' + str(completed.returncode) + '\n')
    summary['checks'].append({'name': name, 'command': command, 'log': str(path.relative_to(root)), 'exitCode': completed.returncode, 'startedUtc': started, 'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    (evidence / 'final-checks.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(name + ' exit=' + str(completed.returncode), flush=True)
    if completed.returncode:
        raise SystemExit(completed.returncode)
for item in manifest['sourceInputs']:
    assert hashlib.sha256((root / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
print('all serial checks passed; reviewed source inputs unchanged', flush=True)
