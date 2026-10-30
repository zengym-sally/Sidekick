import collections
import datetime
import hashlib
import json
import pathlib

evidence = pathlib.Path(__file__).resolve().parent
root = evidence.parents[2]
before = json.loads((evidence / 'inputs-before.json').read_text())
changed = [p for p, sha in before['files'].items()
           if hashlib.sha256((root / p).read_bytes()).hexdigest() != sha]
assert not changed, changed
(evidence / 'inputs-after.json').write_text(json.dumps({
    'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'checked': len(before['files']), 'changed': changed,
    'policy': 'all recorded tracked product, test, script, dependency and brand bytes unchanged'
}, indent=2) + '\n')
snapshots = collections.defaultdict(list)
raw = collections.Counter()
paths = sorted((evidence / 'processes-full-check').glob('*.json'))
for path in paths:
    value = json.loads(path.read_text())
    records = value.get('records', [])
    raw.update(r['method'] for r in records if 'method' in r)
    snapshots[value['isolatedApp']].append((path.name, records))
independent = collections.Counter()
prefixes = []
for app, values in snapshots.items():
    name, longest = max(values, key=lambda item: len(item[1]))
    for shorter_name, records in values:
        assert records == longest[:len(records)], (app, shorter_name, name)
        if records and shorter_name != name:
            prefixes.append({'snapshot': shorter_name, 'containedIn': name, 'records': len(records)})
    independent.update(r['method'] for r in longest if 'method' in r)
assert raw['tools/call'] == independent['tools/call'] == 0
summary = {'layer': 'P2 discovery snapshots only; legacy full-check calls are separate',
           'snapshots': len(paths), 'isolatedApps': len(snapshots),
           'rawSnapshotMethods': dict(raw), 'deduplicatedMethods': dict(independent),
           'toolsCall': 0, 'containedSnapshots': prefixes,
           'policy': 'group by isolatedApp; validate cumulative prefixes; count the longest once; retain multiplicity within each log'}
(evidence / 'process-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'sourceInputsUnchanged': len(before['files']), 'discovery': summary}, indent=2))
