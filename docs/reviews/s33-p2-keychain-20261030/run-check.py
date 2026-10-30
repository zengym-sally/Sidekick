import datetime
import json
import os
import pathlib
import shlex
import subprocess
import sys

evidence = pathlib.Path(__file__).resolve().parent
root = evidence.parents[2]
label, *command = sys.argv[1:]
assert label.replace('-', '').isalnum() and command
raw = evidence / 'raw'
raw.mkdir(exist_ok=True)
path = raw / (label + '.log')
assert not path.exists(), 'Use a fresh label; never overwrite evidence'
env = os.environ.copy()
env.pop('SIDEKICK_DISCOVERY_EVIDENCE', None)
if label == '90-final-p2':
    target = evidence / 'processes-final'
    assert not target.exists()
    env['SIDEKICK_DISCOVERY_EVIDENCE'] = str(target)
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
with path.open('x') as output:
    output.write('COMMAND ' + shlex.join(command) + '\nSTART_UTC ' + start + '\n')
    output.flush()
    result = subprocess.run(command, cwd=root, env=env, stdout=output, stderr=subprocess.STDOUT)
    output.write('\nEXIT_CODE ' + str(result.returncode) + '\n')
summary_path = evidence / 'checks.json'
summary = json.loads(summary_path.read_text()) if summary_path.exists() else []
summary.append({'label': label, 'command': command, 'startedUtc': start,
                'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'exitCode': result.returncode, 'log': str(path.relative_to(root))})
summary_path.write_text(json.dumps(summary, indent=2) + '\n')
print(label + ' exit=' + str(result.returncode), flush=True)
raise SystemExit(result.returncode)
