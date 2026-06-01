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
        samples = get_sample_maps()
        self.assertEqual(len(samples), 3)
        for sample in samples:
            request = PlannerRequest(**sample["request"])
            self.assertEqual(len(request.grid), 20)
            self.assertTrue(all(len(row) == 15 for row in request.grid))

    def test_sample_map_results(self) -> None:
        samples = {sample["id"]: sample["request"] for sample in get_sample_maps()}
        no_path = plan(PlannerRequest(**samples["no-path"]))
        self.assertFalse(no_path["success"])

        cbs = plan(PlannerRequest(**samples["cbs-crossing"]))
        self.assertTrue(cbs["success"])
        self.assertGreater(cbs["resolvedConflictCount"], 0)
        self.assertTrue(any(
            timeline[index] == timeline[index - 1]
            for robot in cbs["robots"]
            for timeline in [robot["timeline"]]
            for index in range(1, len(timeline))
        ))

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
