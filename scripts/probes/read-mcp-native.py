import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
from urllib.parse import quote

if len(sys.argv) != 3 or not re.fullmatch(r'[a-z0-9-]+', sys.argv[2]):
    raise SystemExit('Expected evidence directory and a lowercase stage name.')
evidence = Path(sys.argv[1]).resolve()
launch = json.loads((evidence / 'owned-launch.json').read_text())
root = Path(launch['root'])
nonce = launch['nonce']
if not re.fullmatch(r'[0-9a-f]{48}', nonce) or root.resolve() != root or (root / '.p6-native-verification').read_text() != nonce:
    raise SystemExit('The owned native root could not be verified.')
for path, mode in [(root, 0o700), (root / '.s33-root-scope.json', 0o600), (root / 'workspace/data/sidekick.sqlite', 0o600)]:
    info = path.lstat()
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != mode or path.is_symlink() or path.is_file() and info.st_nlink != 1:
        raise SystemExit('An owned path lost its private identity.')
path = root / 'workspace/data/sidekick.sqlite'
connection = sqlite3.connect('file:' + quote(str(path), safe='/') + '?mode=ro', uri=True)
connection.row_factory = sqlite3.Row
connection.execute('PRAGMA query_only=ON')
connection.execute('BEGIN')
counts = {table: connection.execute('SELECT count(*) FROM ' + table).fetchone()[0] for table in ['sources', 'candidates', 'todos', 'todo_events', 'todo_sources', 'runs', 'agent_runs', 'tool_calls']}
agent_runs = [dict(row) for row in connection.execute('SELECT * FROM agent_runs ORDER BY created_at_ms,id')]
calls = [dict(row) for row in connection.execute('SELECT * FROM tool_calls ORDER BY created_at_ms,id')]
for row in agent_runs:
    for key in ['snapshot_json', 'input_json', 'result_json']:
        value = row.pop(key)
        row[key[:-5]] = json.loads(value) if value else None
schema = connection.execute('PRAGMA user_version').fetchone()[0]
foreign_keys = [list(row) for row in connection.execute('PRAGMA foreign_key_check')]
quick_check = connection.execute('PRAGMA quick_check').fetchone()[0]
connection.rollback()
connection.close()
def events(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
service = events(root / 'service.jsonl')
model = events(Path(launch['modelLog']))
processes = []
for event in service:
    if event.get('type') != 'pid':
        continue
    result = subprocess.run(['/bin/ps', '-p', str(event['pid']), '-o', 'stat=,command='], text=True, capture_output=True, check=False)
    text = result.stdout.strip()
    processes.append({'pid': event['pid'], 'role': event['role'], 'present': bool(text), 'sameOwnedIdentity': str(root / 'service.jsonl') in text, 'state': text.split()[0] if text else None})
configuration = root / 'workspace/mcp/servers.json'
summary = {'stage': sys.argv[2], 'layer': 'read-only SQLite and owned synthetic service/model; GUI observations are separate', 'counts': counts, 'schemaVersion': schema, 'foreignKeyViolations': foreign_keys, 'quickCheck': quick_check, 'agentRuns': agent_runs, 'toolCalls': calls, 'serviceEvents': service, 'modelEvents': model, 'ownedServiceProcesses': processes, 'configurationSha256': hashlib.sha256(configuration.read_bytes()).hexdigest() if configuration.exists() else None, 'configuration': json.loads(configuration.read_text()) if configuration.exists() else None}
(evidence / 'native' / (sys.argv[2] + '-readback.json')).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'stage': sys.argv[2], 'counts': counts, 'agents': [(row['purpose'], row['status'], row['error_code']) for row in agent_runs], 'calls': [(row['tool_name'], row['send_state'], row['response_category']) for row in calls], 'serviceCalls': sum(row.get('type') == 'call' for row in service), 'modelRequests': len(model), 'quickCheck': quick_check, 'foreignKeyViolations': len(foreign_keys)}, ensure_ascii=False))
