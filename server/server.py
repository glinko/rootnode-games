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
CLOCKSHIFT_API = '/api/clockshift/levels'
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
              'name': str(data.get('name', ''))[:48].strip() or 'My level', 'hero': circle(data.get('hero'), 9, 36)}
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


def _clock_number(value, lo, hi, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError('Invalid ClockShift number')
    if integer and int(value) != value:
        raise ValueError('ClockShift grid coordinates must be integers')
    return int(value) if integer else float(value)


def _clock_id(value, prefix=''):
    value = str(value or '')
    if prefix and not value.startswith(prefix):
        raise ValueError('Invalid ClockShift object id')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value):
        raise ValueError('Invalid ClockShift object id')
    return value


def _clock_segment(value, identifier):
    if not isinstance(value, dict):
        raise ValueError('Invalid ClockShift segment')
    result = {'id': _clock_id(value.get('id'), identifier)}
    for key in ('x1', 'y1', 'x2', 'y2'):
        result[key] = _clock_number(value.get(key), -4 if key.startswith('x') else -3, 5 if key.startswith('x') else 4, integer=True)
    if result['x1'] == result['x2'] and result['y1'] == result['y2']:
        raise ValueError('ClockShift segment cannot be empty')
    return result


def _clock_circle(value, identifier, radius, limits):
    if not isinstance(value, dict):
        raise ValueError('Invalid ClockShift free object')
    result = {'id': _clock_id(value.get('id'), identifier)}
    result['x'] = _clock_number(value.get('x'), limits[0], limits[1])
    result['y'] = _clock_number(value.get('y'), limits[2], limits[3])
    result['radius'] = _clock_number(value.get('radius', radius), .05, .5)
    return result


def validate_clockshift(row):
    """Validate the public ClockShift authoring schema without executing it."""
    if not isinstance(row, dict):
        raise ValueError('Invalid ClockShift request')
    identifier = str(row.get('id', ''))
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', identifier) or identifier.startswith('training_'):
        raise ValueError('Invalid or reserved ClockShift level id')
    data = row.get('level')
    if not isinstance(data, dict) or data.get('schemaVersion') != 1:
        raise ValueError('Unsupported ClockShift level schema')
    bounds = data.get('bounds')
    expected = {'minX': -4, 'minY': -3, 'maxX': 5, 'maxY': 4}
    if not isinstance(bounds, dict) or any(bounds.get(key) != value for key, value in expected.items()):
        raise ValueError('ClockShift levels must use the standard 9x7 grid')
    nodes = data.get('nodes')
    if not isinstance(nodes, list) or not 2 <= len(nodes) <= 63:
        raise ValueError('ClockShift levels need 2 to 63 hinges')
    node_ids = set(); coordinates = set(); clean_nodes = []
    for item in nodes:
        if not isinstance(item, dict):
            raise ValueError('Invalid ClockShift hinge')
        node_id = _clock_id(item.get('id'), 'n')
        x = _clock_number(item.get('x'), -4, 5, integer=True); y = _clock_number(item.get('y'), -3, 4, integer=True)
        if node_id in node_ids or (x, y) in coordinates:
            raise ValueError('Duplicate ClockShift hinge')
        node_ids.add(node_id); coordinates.add((x, y)); clean_nodes.append({'id': node_id, 'x': x, 'y': y})
    player = data.get('player')
    if not isinstance(player, dict) or str(player.get('pivotId')) not in node_ids:
        raise ValueError('ClockShift player must use an existing hinge')
    clean_player = {
        'pivotId': str(player['pivotId']),
        'initialAngleDeg': _clock_number(player.get('initialAngleDeg', -45), -360, 360),
        'omegaDegSigned': _clock_number(player.get('omegaDegSigned', 90), -360, 360),
        'charges': _clock_number(player.get('charges', 1), 0, 9, integer=True)
    }
    exit_id = str(data.get('exitNodeId', ''))
    if exit_id not in node_ids:
        raise ValueError('ClockShift exit must use an existing hinge')
    clean = {'schemaVersion': 1, 'id': identifier, 'title': str(data.get('title', 'Community level'))[:80].strip() or 'Community level',
             'bounds': expected, 'nodes': clean_nodes, 'player': clean_player, 'exitNodeId': exit_id, 'gravity': {'x': 0, 'y': 0}}
    clean['walls'] = [_clock_segment(item, 'wall') for item in (data.get('walls') or [])]
    clean['doors'] = [_clock_segment(item, 'door') for item in (data.get('doors') or [])]
    clean['bumpers'] = []
    for item in (data.get('bumpers') or []):
        bumper = _clock_segment(item, 'bumper')
        bumper['normalX'] = _clock_number(item.get('normalX', 0), -1, 1); bumper['normalY'] = _clock_number(item.get('normalY', 0), -1, 1)
        clean['bumpers'].append(bumper)
    clean['spikes'] = []
    for item in (data.get('spikes') or []):
        spike = _clock_circle(item, 'spike_', .13, (-3.85, 4.85, -2.85, 3.85)); spike['radius'] = _clock_number(item.get('radius', .13), .05, .5); clean['spikes'].append(spike)
    clean['bonuses'] = []
    for item in (data.get('bonuses') or []):
        bonus = _clock_circle(item, 'bonus_', .13, (-3.85, 4.85, -2.85, 3.85)); bonus['radius'] = _clock_number(item.get('radius', .13), .05, .5); bonus['chargesAdded'] = _clock_number(item.get('chargesAdded', 1), 1, 9, integer=True); clean['bonuses'].append(bonus)
    clean['enemies'] = []
    for item in (data.get('enemies') or []):
        if not isinstance(item, dict) or str(item.get('pivotId')) not in node_ids:
            raise ValueError('ClockShift enemy must use an existing hinge')
        enemy = {'id': _clock_id(item.get('id'), 'enemy_'), 'pivotId': str(item['pivotId']), 'initialAngleDeg': _clock_number(item.get('initialAngleDeg', -45), -360, 360), 'omegaDegSigned': _clock_number(item.get('omegaDegSigned', 90), -360, 360)}
        path = item.get('pathNodeIds')
        if path is not None:
            if not isinstance(path, list) or len(path) > 63 or any(str(node) not in node_ids for node in path): raise ValueError('Invalid ClockShift enemy path')
            enemy['pathNodeIds'] = [str(node) for node in path]; enemy['pathSpeed'] = _clock_number(item.get('pathSpeed', 1), .05, 10)
        clean['enemies'].append(enemy)
    clean['switches'] = []
    door_ids = {item['id'] for item in clean['doors']}
    for item in (data.get('switches') or []):
        switch = _clock_circle(item, 'switch_', .2, (-3.85, 4.85, -2.85, 3.85)); switch['radius'] = _clock_number(item.get('radius', .2), .08, .5)
        links = item.get('doorIds') or []
        if not isinstance(links, list) or any(str(link) not in door_ids for link in links): raise ValueError('Invalid ClockShift switch link')
        switch['doorIds'] = [str(link) for link in links]; switch['initialOn'] = bool(item.get('initialOn', False)); clean['switches'].append(switch)
    clean['teleporters'] = []
    for item in (data.get('teleporters') or []):
        teleporter = _clock_circle(item, 'teleport_', .2, (-3.85, 4.85, -2.85, 3.85)); teleporter['radius'] = _clock_number(item.get('radius', .2), .08, .5); teleporter['linkId'] = _clock_id(item.get('linkId'), 'pair_'); clean['teleporters'].append(teleporter)
    for key, limit in [('walls', 32), ('doors', 16), ('bumpers', 16), ('spikes', 24), ('bonuses', 24), ('enemies', 16), ('switches', 16), ('teleporters', 16)]:
        if len(clean[key]) > limit: raise ValueError('Too many ClockShift ' + key)
    return {'id': identifier, 'level': clean}


def run(root, store, clockshift_store, host, port):
    store.parent.mkdir(parents=True, exist_ok=True); clockshift_store.parent.mkdir(parents=True, exist_ok=True)
    def read(path):
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
    def write(path, rows):
        temp = path.with_suffix('.next')
        with temp.open('w', encoding='utf-8') as file:
            json.dump(rows, file, ensure_ascii=False, allow_nan=False)
            file.flush()
            os.fsync(file.fileno())
        temp.replace(path)
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
                    self.reply(200, read(store))
            elif self.path.split('?')[0] == CLOCKSHIFT_API:
                with LOCK:
                    self.reply(200, read(clockshift_store))
            else:
                super().do_GET()
        def do_POST(self):
            if self.path not in (API, CLOCKSHIFT_API):
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
                row = validate(json.loads(payload)) if self.path == API else validate_clockshift(json.loads(payload))
                target_store = store if self.path == API else clockshift_store
                with LOCK:
                    rows = read(target_store)
                    previous = next((i for i, v in enumerate(rows) if v['id'] == row['id']), None)
                    if previous is None:
                        if len(rows) >= 200:
                            raise ValueError('Catalogue full')
                        rows.append(row)
                    else:
                        rows[previous] = row
                    write(target_store, rows)
                self.reply(200, row)
            except (ValueError, TypeError, KeyError) as error:
                self.reply(400, {'error': str(error)})
        def do_DELETE(self):
            api = CLOCKSHIFT_API if self.path.startswith(CLOCKSHIFT_API + '/') else API
            identifier = self.path.removeprefix(api + '/')
            if not self.path.startswith(api + '/') or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', identifier):
                self.reply(404, {'error': 'Not found'})
                return
            if not self.same_origin():
                self.reply(403, {'error': 'Origin rejected'})
                return
            with LOCK:
                target_store = clockshift_store if api == CLOCKSHIFT_API else store
                write(target_store, [row for row in read(target_store) if row['id'] != identifier])
            self.reply(200, {'deleted': identifier})
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--store', type=Path, required=True)
    parser.add_argument('--clockshift-store', type=Path)
    parser.add_argument('--host', default='192.168.88.15')
    parser.add_argument('--port', type=int, default=8088)
    args = parser.parse_args()
    run(args.root.resolve(), args.store.resolve(), (args.clockshift_store or args.store.with_name('clockshift-levels.json')).resolve(), args.host, args.port)
