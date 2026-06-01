from __future__ import annotations

import unittest
from subprocess import TimeoutExpired
from unittest.mock import patch

from pydantic import ValidationError

from backend.app import get_sample_maps, health, plan
from backend.planner_client import PlannerClient, PlannerTimeoutError
from backend.schemas import PlannerRequest


class BackendApiTests(unittest.TestCase):
    def test_health(self) -> None:
        self.assertTrue(health()["cppCoreReady"])

    def test_sample_maps(self) -> None:
        self.assertEqual(len(get_sample_maps()), 3)

    def test_single_robot_plan(self) -> None:
        result = plan(PlannerRequest(mode="single", algorithm="astar", roundTrip=True, grid=[[3, 0], [0, 4]]))
        self.assertTrue(result["success"])
        self.assertEqual(result["totalCost"], 4)

    def test_compare_plan(self) -> None:
        result = plan(PlannerRequest(mode="single", algorithm="compare", roundTrip=False, grid=[[3, 0], [0, 4]]))
        self.assertEqual(result["astar"]["pathCost"], result["dijkstra"]["pathCost"])

    def test_cbs_plan(self) -> None:
        result = plan(PlannerRequest(
            mode="multi", algorithm="cbs", allowDiagonal=False,
            grid=[[1, 0, 1], [0, 0, 0], [1, 0, 1]],
            robots=[
                {"id": "agv-01", "start": [1, 0], "target": [1, 2], "roundTrip": False},
                {"id": "agv-02", "start": [0, 1], "target": [2, 1], "roundTrip": False},
            ],
        ))
        self.assertTrue(result["success"])
        self.assertGreater(result["resolvedConflictCount"], 0)

    def test_invalid_grid(self) -> None:
        with self.assertRaises(ValidationError):
            PlannerRequest(mode="single", algorithm="astar", grid=[[3, 9], [0, 4]])

    def test_planner_timeout(self) -> None:
        with patch("backend.planner_client.subprocess.run", side_effect=TimeoutExpired("planner", 1)):
            with self.assertRaises(PlannerTimeoutError):
                PlannerClient(timeout_seconds=1).plan({"mode": "single"})


if __name__ == "__main__":
    unittest.main()
