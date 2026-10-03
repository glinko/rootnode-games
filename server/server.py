"""Static game hosting and durable shared level catalogue (Python stdlib)."""
import argparse
import base64
import json
import math
import os
from pathlib import Path
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

API = '/api/hungry-balls/levels'
LOCK = Lock()


def validate(row):
    if not isinstance(row, dict) or not re.fullmatch(r'[A-Za-z0-9-]{1,80}', str(row.get('id', ''))):
        raise ValueError('Invalid level id')
    data = row.get('level')
    if not isinstance(data, dict) or any(data.get(k) != v for k, v in [('version', 1), ('width', 390), ('height', 700), ('cell', 3)]):
        raise ValueError('Invalid format')
    encoded = data.get('terrain')
    if not isinstance(encoded, str) or len(encoded) != 5072 or len(base64.b64decode(encoded, validate=True)) != 3803:
        raise ValueError('Invalid terrain')
    def number(v, lo, hi):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
            raise ValueError('Invalid coordinates or size')
        return v
    def circle(v, lo, hi, fixed=None):
        if not isinstance(v, dict):
            raise ValueError('Invalid object')
        r = fixed if fixed else number(v.get('r'), lo, hi)
        result = {'x': number(v.get('x'), r, 390-r), 'y': number(v.get('y'), r, 700-r)}
        if not fixed:
            result['r'] = r
        return result
    result = {'version': 1, 'width': 390, 'height': 700, 'cell': 3, 'terrain': encoded,
              'name': str(data.get('name', ''))[:48].strip() or 'Мой уровень', 'hero': circle(data.get('hero'), 9, 36)}
    for key, limit, lo, hi, fixed in [('targets', 20, 9, 36, None), ('rocks', 16, 12, 34, None),
                                     ('bombs', 12, 0, 0, 13), ('lasers', 12, 0, 0, 13), ('hives', 4, 0, 0, 24)]:
        values = data.get(key)
        if not isinstance(values, list) or len(values) > limit:
            raise ValueError('Invalid object list')
        result[key] = []
        for v in values:
            obj = circle(v, lo, hi, fixed)
            if key == 'lasers':
                if v.get('direction') not in ['left', 'right', 'up', 'down']:
                    raise ValueError('Invalid laser')
                obj['direction'] = v['direction']
            if key == 'hives':
                obj['r'] = 24
            result[key].append(obj)
    if not result['targets']:
        raise ValueError('Level requires an enemy')
    return {'id': row['id'], 'level': result}


def run(root, store, host, port):
    store.parent.mkdir(parents=True, exist_ok=True)
    def read():
        return json.loads(store.read_text(encoding='utf-8')) if store.exists() else []
    def write(rows):
        temp = store.with_suffix('.next')
        with temp.open('w', encoding='utf-8') as file:
            json.dump(rows, file, ensure_ascii=False, allow_nan=False)
            file.flush()
            os.fsync(file.fileno())
        temp.replace(store)
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)
        def reply(self, status, data):
            payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        def same_origin(self):
            origin = self.headers.get('Origin')
            scheme = self.headers.get('X-Forwarded-Proto', 'http')
            return not origin or origin == scheme + '://' + self.headers.get('Host', '')
        def do_GET(self):
            if self.path.split('?')[0] == API:
                with LOCK:
                    self.reply(200, read())
            else:
                super().do_GET()
        def do_POST(self):
            if self.path != API:
                self.reply(404, {'error': 'Not found'})
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 200000 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Invalid request size or type')
                payload = self.rfile.read(size)
                if not self.same_origin():
                    self.reply(403, {'error': 'Origin rejected'})
                    return
                row = validate(json.loads(payload))
                with LOCK:
                    rows = read()
                    previous = next((i for i, v in enumerate(rows) if v['id'] == row['id']), None)
                    if previous is None:
                        if len(rows) >= 200:
                            raise ValueError('Catalogue full')
                        rows.append(row)
                    else:
                        rows[previous] = row
                    write(rows)
                self.reply(200, row)
            except (ValueError, TypeError, KeyError) as error:
                self.reply(400, {'error': str(error)})
        def do_DELETE(self):
            identifier = self.path.removeprefix(API + '/')
            if not self.path.startswith(API + '/') or not re.fullmatch(r'[A-Za-z0-9-]{1,80}', identifier):
                self.reply(404, {'error': 'Not found'})
                return
            if not self.same_origin():
                self.reply(403, {'error': 'Origin rejected'})
                return
            with LOCK:
                write([row for row in read() if row['id'] != identifier])
            self.reply(200, {'deleted': identifier})
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--store', type=Path, required=True)
    parser.add_argument('--host', default='192.168.88.15')
    parser.add_argument('--port', type=int, default=8088)
    args = parser.parse_args()
    run(args.root.resolve(), args.store.resolve(), args.host, args.port)
