import collections
import json
import pathlib

directory = pathlib.Path(__file__).resolve().parent / 'processes-final'
snapshots = collections.defaultdict(list)
raw = collections.Counter()
for path in sorted(directory.glob('*.json')):
    value = json.loads(path.read_text())
    records = value.get('records', [])
    for record in records:
        if 'method' in record:
            raw[record['method']] += 1
    snapshots[value['isolatedApp']].append((path.name, records))
independent = collections.Counter()
prefixes = []
for app, values in snapshots.items():
    name, longest = max(values, key=lambda item: len(item[1]))
    for shorter_name, records in values:
        assert records == longest[:len(records)], (app, shorter_name, name)
        if records and shorter_name != name:
            prefixes.append({'snapshot': shorter_name, 'containedIn': name, 'records': len(records)})
    for record in longest:
        if 'method' in record:
            independent[record['method']] += 1
assert raw['tools/call'] == independent['tools/call'] == 0
print(json.dumps({'rawSnapshotMethods': dict(raw), 'deduplicatedMethods': dict(independent), 'policy': 'group by isolatedApp; validate cumulative snapshot prefixes and count the longest snapshot once; retain multiplicity inside each log', 'containedSnapshots': prefixes}, indent=2))
