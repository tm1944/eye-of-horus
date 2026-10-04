"""Score hazards from a population grid without the network or a database."""

import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from jobs.ingest.exposure import (  # noqa: E402
    impact_class,
    impact_score,
    intensity,
    people_in_radius,
    score_hazard,
    tile_index,
    tiles_covering,
)


class ExposureTests(unittest.TestCase):
    def test_netherlands_tile_matches_the_published_index(self):
        self.assertEqual(tile_index(52.0, 5.0), (4, 19))
        from jobs.ingest.exposure import tile_bounds
        west, south, east, north = tile_bounds(10, 30)
        self.assertAlmostEqual(west, 109.99208292, places=4)
        self.assertAlmostEqual(north, -0.90041646, places=4)
        self.assertAlmostEqual(east - west, 10.0, places=4)
        self.assertAlmostEqual(north - south, 10.0, places=4)
        self.assertEqual(tile_index(-5.0, 115.0), (10, 30))

    def test_circle_across_the_antimeridian_reads_both_sides(self):
        tiles = tiles_covering(0.0, -179.5, 80.0)
        self.assertIn((9, 1), tiles)
        self.assertIn((9, 36), tiles)

    def test_population_sum_keeps_nearby_cells_and_drops_nodata(self):
        # 0.01° cells. The point sits on the center cell. Orthogonal neighbors
        # are about 1.1 km away; diagonals are about 1.5 km and stay outside.
        grid = np.zeros((5, 5))
        grid[2, 2] = 1000
        grid[1, 2] = 10
        grid[3, 2] = 10
        grid[2, 1] = -200
        grid[2, 3] = 10
        grid[1, 1] = 999
        grid[1, 3] = 999
        grid[3, 1] = 999
        grid[3, 3] = 999
        transform = (0.01, 0.0, 10.0, 0.0, -0.01, 20.0)
        total = people_in_radius(grid, transform, 1.3, 19.975, 10.025)
        self.assertEqual(total, 1030)

    def test_class_thresholds_and_sparse_cap(self):
        self.assertEqual(impact_class(0, 10_000), "Low")
        self.assertEqual(impact_class(24.9, 10_000), "Low")
        self.assertEqual(impact_class(25, 10_000), "Moderate")
        self.assertEqual(impact_class(49.9, 10_000), "Moderate")
        self.assertEqual(impact_class(50, 10_000), "High")
        self.assertEqual(impact_class(74.9, 10_000), "High")
        self.assertEqual(impact_class(75, 10_000), "Severe")
        self.assertEqual(impact_class(100, 10_000), "Severe")
        self.assertEqual(impact_class(80, 499), "Moderate")
        self.assertEqual(impact_class(80, 500), "Severe")
        self.assertEqual(impact_class(10, 0), "Low")

    def test_full_city_at_full_intensity_scores_100(self):
        self.assertAlmostEqual(impact_score(1, 5_000_000), 100)
        self.assertAlmostEqual(impact_score(1, 0), 0)

    def test_alert_level_fallback_and_preferred_measures(self):
        self.assertEqual(intensity("earthquake", {"magnitude": 4}), 0.5)
        self.assertEqual(intensity("earthquake", {"magnitude": 10}), 1.0)
        self.assertIsNone(intensity("earthquake", {}))
        self.assertEqual(intensity("wildfire", {"max_frp": 25}), 0.5)
        self.assertEqual(intensity("wildfire", {"max_frp": None, "alert_level": "Red"}), 1.0)
        self.assertIsNone(intensity("wildfire", {}))
        self.assertEqual(intensity("flood", {"alert_level": "Orange"}), 0.6)
        self.assertEqual(intensity("volcano", {"alert_level": "green"}), 0.25)
        self.assertEqual(intensity("cyclone", {"max_wind_kmh": 100, "alert_level": "Red"}), 0.5)
        self.assertEqual(intensity("cyclone", {"alert_level": "Green"}), 0.25)
        self.assertIsNone(intensity("drought", {"alert_level": "Red"}))

    def test_score_uses_the_radius_and_cites_ghsl(self):
        scored = score_hazard("flood", {"alert_level": "Red"}, 5_000_000, 40)
        self.assertIsNotNone(scored)
        assert scored is not None
        self.assertEqual(scored["people_exposed"], 5_000_000)
        self.assertEqual(scored["radius_km"], 40)
        self.assertEqual(scored["impact_class"], "Severe")
        self.assertEqual(scored["exposure_source"], "JRC GHSL GHS-POP R2023A")
        self.assertTrue(math.isclose(scored["impact_score"], 100))
        self.assertIsNone(score_hazard("earthquake", {}, 1000, 50))
