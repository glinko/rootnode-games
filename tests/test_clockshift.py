import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
LEVELS = ROOT / "games" / "clockshift" / "levels"


class ClockShiftAssetTests(unittest.TestCase):
    def setUp(self):
        self.levels = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(LEVELS.glob("training_*.json"))]

    def test_campaign_contains_ten_valid_schema_v1_levels(self):
        self.assertEqual(len(self.levels), 10)
        for level in self.levels:
            self.assertEqual(level["schemaVersion"], 1)
            nodes = level["nodes"]
            node_ids = {node["id"] for node in nodes}
            coordinates = {(node["x"], node["y"]) for node in nodes}
            self.assertEqual(len(node_ids), len(nodes))
            self.assertEqual(len(coordinates), len(nodes))
            self.assertIn(level["player"]["pivotId"], node_ids)
            self.assertIn(level["exitNodeId"], node_ids)
            self.assertGreater(level["bounds"]["maxX"], level["bounds"]["minX"])
            self.assertGreater(level["bounds"]["maxY"], level["bounds"]["minY"])

    def test_campaign_features_ramp_up(self):
        self.assertFalse(self.levels[0]["enemies"])
        self.assertTrue(self.levels[1]["enemies"])
        self.assertTrue(self.levels[2]["spikes"])
        self.assertTrue(self.levels[4]["bumpers"])
        self.assertTrue(self.levels[5]["doors"] and self.levels[5]["switches"])
        self.assertTrue(self.levels[6]["teleporters"])
        self.assertTrue(self.levels[9]["bumpers"])

    def test_static_game_exposes_spec_controls_and_fixed_step(self):
        source = (ROOT / "games" / "clockshift" / "game.js").read_text(encoding="utf-8")
        for token in ("CFG.step", "reversePlayer", "releasePlayer", "requestCapture", "autoCapture", "localStorage", "stepFree"):
            self.assertIn(token, source)


if __name__ == "__main__":
    unittest.main()
