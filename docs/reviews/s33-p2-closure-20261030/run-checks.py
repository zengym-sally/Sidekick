import datetime
import hashlib
import json
import os
import pathlib
import shlex
import subprocess

root = pathlib.Path(__file__).resolve().parents[3]
os.chdir(root)
evidence = pathlib.Path(__file__).resolve().parent
review = json.loads((evidence / 'review-inputs.json').read_text())
for item in review['changedInputs']:
    assert hashlib.sha256((root / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
assert not (evidence / 'processes-final').exists(), 'Use fresh evidence for a new run'
checks = [
    ('10-p2-aggregate', ['npm', 'run', 'check:s33-p2']),
    ('11-s1-domain', ['npm', 'run', 'test:s1-domain']),
    ('12-s2-domain', ['npm', 'run', 'test:s2-domain']),
    ('13-s31-domain', ['npm', 'run', 'test:s31-domain']),
    ('14-layout-domain', ['npm', 'run', 'test:layout-domain']),
    ('15-s32-domain', ['npm', 'run', 'test:s32-domain']),
    ('16-rust-with-one-explicit-skip', ['npm', 'run', 'test:rust-no-keychain']),
    ('17-card-domain', ['npm', 'run', 'probe:card']),
    ('18-contracts', ['npm', 'run', 'probe:contracts']),
    ('19-toolchain', ['npm', 'run', 'probe:toolchain']),
    ('20-s2-runtime', ['npm', 'run', 'test:s2-runtime']),
    ('21-s31-runtime', ['npm', 'run', 'test:s31-runtime']),
    ('22-layout-runtime', ['npm', 'run', 'test:layout-runtime']),
    ('23-s32-runtime', ['npm', 'run', 'test:s32-runtime']),
    ('24-final-resource-exclusion', ['npm', 'run', 'test:s33-ui-artifacts']),
]
summary = {'scope': 'P2 aggregate and independently permitted historical regressions; full npm check NOT executed', 'checks': []}
for name, command in checks:
    path = evidence / 'raw' / (name + '.log')
    env = os.environ.copy()
    env.pop('SIDEKICK_DISCOVERY_EVIDENCE', None)
    if name == '10-p2-aggregate':
        env['SIDEKICK_DISCOVERY_EVIDENCE'] = str(evidence / 'processes-final')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with path.open('w') as output:
        output.write('COMMAND ' + shlex.join(command) + '\nSTART_UTC ' + started + '\n')
        output.flush()
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, env=env)
        output.write('\nEXIT_CODE ' + str(result.returncode) + '\n')
    summary['checks'].append({'name': name, 'command': command, 'log': str(path.relative_to(root)), 'exitCode': result.returncode, 'startedUtc': started, 'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    (evidence / 'checks.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(name + ' exit=' + str(result.returncode), flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)
for item in review['changedInputs']:
    assert hashlib.sha256((root / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
print('all permitted serial checks passed; full check remains unexecuted', flush=True)
