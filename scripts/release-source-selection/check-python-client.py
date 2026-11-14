"""Exercise the public API with Python's unchanged default urllib user agent.

Writes bounded status/hash receipts even on edge rejection; exits nonzero unless
all responses and optional build identity checks pass. No source data is fetched.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='https://ushso.org')
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--build-id')
    args = parser.parse_args()
    checks = []
    for path, payload in [('/api/health', None), ('/api/contract', None),
                          ('/api/catalog?limit=2', None),
                          ('/api/discover', {'question': 'hospital cost reports', 'limit': 2}),
                          ('/api/source-selection/v1/publication', None)]:
        req = urllib.request.Request(args.base.rstrip('/') + path,
            data=json.dumps(payload).encode() if payload else None,
            headers={'Content-Type': 'application/json'} if payload else {})
        row = {'path': path, 'method': req.get_method(), 'pass': False}
        try:
            try:
                response = urllib.request.urlopen(req, timeout=45)
            except urllib.error.HTTPError as exc:
                response = exc
            with response:
                data = response.read(2 * 1024 * 1024 + 1)
                row.update(status=response.status, bytes=len(data),
                           sha256=hashlib.sha256(data).hexdigest(),
                           content_type=response.headers.get('Content-Type'),
                           cf_ray=response.headers.get('CF-Ray'))
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('Response exceeded probe limit')
            body = json.loads(data)
            if not isinstance(body, dict):
                raise ValueError('Expected a JSON object')
            if path == '/api/source-selection/v1/publication':
                row['pass'] = row['status'] == 503 and body.get('status') == 'unavailable'
                row['publication'] = body
            else:
                row['pass'] = row['status'] == 200
            if path == '/api/health':
                row['build'] = body.get('build')
                row['pass'] &= body.get('status') == 'ok'
                if args.build_id:
                    build = body.get('build')
                    identity = build.get('identity') if isinstance(build, dict) else None
                    row['pass'] &= isinstance(identity, dict) and identity.get('build_id') == args.build_id
            if path == '/api/contract':
                row['pass'] &= body.get('enabled_tool_count') == 8 and body.get('read_only') is True
            if path.startswith('/api/catalog') or path == '/api/discover':
                row['pass'] &= body.get('corpus', {}).get('record_count') == 3434 and len(body.get('results', [])) == 2
        except (ValueError, OSError, TypeError, AttributeError) as exc:
            row['pass'] = False
            row['error'] = type(exc).__name__
        checks.append(row)
    receipt = {'at': datetime.now(timezone.utc).isoformat(), 'base': args.base,
               'client': 'Python urllib default User-Agent',
               'pass': all(row['pass'] for row in checks), 'checks': checks}
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    with args.receipt.open('x') as handle:
        json.dump(receipt, handle, indent=2)
        handle.write('\n')
    print(json.dumps(receipt, indent=2))
    raise SystemExit(0 if receipt['pass'] else 1)


if __name__ == '__main__':
    main()
