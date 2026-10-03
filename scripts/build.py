"""Validate and package static games. No contributed code is executed."""
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import shutil

SLUG = re.compile(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z')
RESERVED = {'api', 'games', 'index', 'server', 'assets', 'health', 'static'}
EXTENSIONS = {'.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.ogg', '.wav', '.mp4', '.webm', '.wasm', '.txt', '.md', '.bin', '.data', '.map', '.unityweb'}
MAX_FILE = 25 * 1024 * 1024
MAX_TOTAL = 200 * 1024 * 1024


def validate(root):
    root = Path(root).resolve()
    games_path = root / 'games.json'
    if games_path.is_symlink() or not games_path.is_file() or games_path.stat().st_size > 256000:
        raise ValueError('Missing or oversized games.json')
    games = json.loads(games_path.read_text(encoding='utf-8'))
    if not isinstance(games, list) or not 1 <= len(games) <= 200:
        raise ValueError('games.json must contain 1 to 200 entries')
    seen = set()
    total = 0
    for game in games:
        if not isinstance(game, dict):
            raise ValueError('Each game must be an object')
        slug = game.get('slug', '')
        if not isinstance(slug, str) or not SLUG.fullmatch(slug) or slug in RESERVED or slug in seen:
            raise ValueError('Invalid, reserved or duplicate slug')
        seen.add(slug)
        for key, limit in [('title', 80), ('description', 300), ('category', 50), ('platform', 50), ('author', 100), ('license', 100)]:
            value = game.get(key)
            if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
                raise ValueError(f'{slug}: invalid {key}')
        folder = root / 'games' / slug
        if folder.is_symlink() or not folder.is_dir() or not folder.resolve().is_relative_to(root / 'games'):
            raise ValueError(f'{slug}: game folder is missing or unsafe')
        cover = game.get('cover')
        if not isinstance(cover, str) or '\\' in cover or not re.fullmatch(r'[A-Za-z0-9_./-]+', cover):
            raise ValueError(f'{slug}: invalid cover path')
        cover_path = PurePosixPath(cover)
        if cover_path.is_absolute() or '..' in cover_path.parts or cover_path.suffix.lower() not in {'.svg', '.png', '.jpg', '.jpeg', '.webp'}:
            raise ValueError(f'{slug}: invalid cover image')
        for required in ['index.html', 'LICENSE', cover]:
            if not (folder / required).is_file():
                raise ValueError(f'{slug}: missing {required}')
        for path in folder.rglob('*'):
            if path.is_symlink() or not path.resolve().is_relative_to(folder):
                raise ValueError(f'{slug}: symlinks and external paths are not allowed')
            if any(part.startswith('.') for part in path.relative_to(folder).parts):
                raise ValueError(f'{slug}: hidden files are not published')
            if path.is_dir():
                continue
            if not path.is_file() or (path.name != 'LICENSE' and path.suffix.lower() not in EXTENSIONS):
                raise ValueError(f'{slug}: unsupported asset {path.name}')
            size = path.stat().st_size
            if size > MAX_FILE:
                raise ValueError(f'{slug}: asset larger than 25 MiB')
            total += size
    if total > MAX_TOTAL:
        raise ValueError('Games exceed the 200 MiB catalogue budget')
    if (root / 'site').is_symlink():
        raise ValueError('Catalogue directory cannot be a symlink')
    for name in ['index.html', 'style.css', 'catalogue.js']:
        path = root / 'site' / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_FILE:
            raise ValueError('Missing or unsafe catalogue file')
    return games


def build(root, output):
    root = Path(root).resolve()
    output = Path(output).resolve()
    if output == root or root.is_relative_to(output) or output.exists():
        raise ValueError('Output must be a new directory separate from the source root')
    games = validate(root)
    public = output / 'public'
    public.mkdir(parents=True)
    for name in ['index.html', 'style.css', 'catalogue.js']:
        shutil.copyfile(root / 'site' / name, public / name)
    (public / 'games.json').write_text(json.dumps(games, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for game in games:
        shutil.copytree(root / 'games' / game['slug'], public / game['slug'])
    return games


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    games = build(args.root, args.output) if args.output else validate(args.root)
    print(f'Validated {len(games)} game(s)')
