import datetime
import json
import os
import pathlib
import secrets
import subprocess
import sys
import tempfile

evidence = pathlib.Path(__file__).resolve().parent
root = evidence.parents[2]
metadata = evidence / 'native-launch.json'
reopen = len(sys.argv) > 1 and sys.argv[1] == '--reopen'
if reopen:
    previous = json.loads(metadata.read_text())
    session_path = pathlib.Path(previous['sessionFile'])
    session = json.loads(session_path.read_text())
    width, height = map(int, sys.argv[2:4]) if len(sys.argv) == 4 else (640, 900)
    sequence = len(list(evidence.glob('native-reopen-*-launch.json'))) + 1
else:
    assert not metadata.exists(), 'Do not duplicate an existing verification session'
    base = pathlib.Path(tempfile.mkdtemp(prefix='sidekick-s33-authorized-', dir='/tmp'))
    session_path = base / 'session.json'
    session = {'app': str(base / 'app'), 'nonce': secrets.token_hex(24),
               'bundle': str(root / 'src-tauri/target/release/bundle/macos/Sidekick MCP Verify.app')}
    with os.fdopen(os.open(session_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(session, f)
    width, height = 1440, 1000
log_path = session_path.parent / (f'native-reopen-{sequence:02}.log' if reopen else 'native.log')
with os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as log:
    child = subprocess.Popen([str(pathlib.Path(session['bundle']) / 'Contents/MacOS/sidekick'),
                              '--s33-mcp-ui', session['app'], session['nonce'], str(width), str(height),
                              'controlled-upgrade-no-credentials', *(['--reopen'] if reopen else [])],
                             env={'PATH': '/usr/bin:/bin', 'TMPDIR': '/tmp'}, stdout=log, stderr=log)
record = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pid': child.pid,
          'sessionFile': str(session_path), 'app': session['app'], 'bundle': session['bundle'],
          'log': str(log_path), 'scope': 'controlled-upgrade-no-credentials',
          'requestedLogicalSize': {'width': width, 'height': height}, 'reopen': reopen,
          'environmentKeys': ['PATH', 'TMPDIR']}
target = evidence / (f'native-reopen-{sequence:02}-launch.json' if reopen else 'native-launch.json')
target.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2), flush=True)
exit_code = child.wait()
record['exitCode'] = exit_code
record['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
exit_target = target.with_name(target.stem.replace('-launch', '') + '-exit.json')
exit_target.write_text(json.dumps(record, indent=2) + '\n')
print('Native process exit=' + str(exit_code), flush=True)
