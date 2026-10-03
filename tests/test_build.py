import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('build', Path(__file__).resolve().parents[1] / 'scripts/build.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'repo'
        self.game = self.root / 'games/demo'
        self.game.mkdir(parents=True)
        (self.root / 'site').mkdir()
        for name in ['index.html', 'style.css', 'catalogue.js']:
            (self.root / 'site' / name).write_text('catalogue')
        for name in ['index.html', 'cover.svg', 'LICENSE']:
            (self.game / name).write_text('asset')
        self.row = dict(slug='demo', title='Demo', description='Tap game', category='Puzzle', platform='Mobile', cover='cover.svg', author='example', license='MIT')
        self.manifest([self.row])

    def tearDown(self):
        self.temp.cleanup()

    def manifest(self, rows):
        (self.root / 'games.json').write_text(json.dumps(rows))

    def test_packaged_urls_match_manifest_and_source_not_executed(self):
        (self.root / 'dangerous.py').write_text("raise RuntimeError('must not execute')")
        destination = Path(self.temp.name) / 'build'
        builder.build(self.root, destination)
        self.assertTrue((destination / 'public/demo/index.html').is_file())
        self.assertFalse((destination / 'public/dangerous.py').exists())
        self.assertEqual(json.loads((destination / 'public/games.json').read_text())[0]['slug'], 'demo')

    def test_reject_duplicate_or_reserved_or_traversal_slugs(self):
        for slug in ['../outside', '/root', 'api', 'UPPER', 'bad slug']:
            self.manifest([{**self.row, 'slug': slug}])
            with self.assertRaises(ValueError):
                builder.validate(self.root)
        self.manifest([self.row, self.row])
        with self.assertRaises(ValueError):
            builder.validate(self.root)

    def test_reject_missing_entry_cover_and_license(self):
        for name in ['index.html', 'cover.svg', 'LICENSE']:
            path = self.game / name
            data = path.read_text()
            path.unlink()
            with self.assertRaises(ValueError):
                builder.validate(self.root)
            path.write_text(data)

    def test_cover_cannot_leave_game_or_be_a_url(self):
        for cover in ['../cover.svg', 'https://example.com/x.svg', '/x.svg', 'cover.js']:
            self.manifest([{**self.row, 'cover': cover}])
            with self.assertRaises(ValueError):
                builder.validate(self.root)

    def test_reject_hidden_server_files_and_symlinks(self):
        for name in ['.env', 'upload.py']:
            path = self.game / name
            path.write_text('not a public asset')
            with self.assertRaises(ValueError):
                builder.validate(self.root)
            path.unlink()
        link = self.game / 'external.svg'
        try:
            link.symlink_to(self.root / 'games.json')
        except OSError:
            return  # Windows may require symlink privilege; Linux CI checks this.
        with self.assertRaises(ValueError):
            builder.validate(self.root)

    def test_reject_large_assets_without_overwriting_a_build(self):
        path = self.game / 'large.bin'
        with path.open('wb') as stream:
            stream.truncate(builder.MAX_FILE + 1)
        with self.assertRaises(ValueError):
            builder.validate(self.root)
        path.unlink()
        destination = Path(self.temp.name) / 'existing'
        destination.mkdir()
        with self.assertRaises(ValueError):
            builder.build(self.root, destination)


if __name__ == '__main__':
    unittest.main()
