import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('check_ci', Path(__file__).resolve().parents[1] / 'ops/check-ci.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = 'a' * 40


class GitHubCheckTests(unittest.TestCase):
    def check(self, rows):
        with patch.object(gate.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps({'check_runs': rows}).encode())):
            gate.require_success(SHA)

    def row(self, **changes):
        return dict(name='catalogue-validation', head_sha=SHA, app={'slug': 'github-actions'}, status='completed', conclusion='success', **changes)

    def test_only_successful_expected_workflow_at_the_exact_commit_can_publish(self):
        self.check([self.row()])
        for changes in [{'status': 'in_progress'}, {'conclusion': 'failure'}, {'head_sha': 'b' * 40}, {'app': {'slug': 'other-app'}}, {'name': 'different-check'}]:
            row = self.row()
            row.update(changes)
            with self.assertRaises(RuntimeError):
                self.check([row])
        with self.assertRaises(RuntimeError):
            self.check([])

    def test_invalid_commit_never_makes_a_network_request(self):
        with patch.object(gate.urllib.request, 'urlopen') as request:
            with self.assertRaises(ValueError):
                gate.require_success('../main')
            request.assert_not_called()
