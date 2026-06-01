from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException

from backend.planner_client import PlannerClient, PlannerClientError, PlannerTimeoutError
from backend.schemas import PlannerRequest


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "cpp_core" / "data"
app = FastAPI(title="智能仓储机器人路径规划接口", version="1.0.0")
planner_client = PlannerClient()


def load_json(filename: str) -> dict[str, Any]:
    return json.loads((DATA_DIR / filename).read_text(encoding="utf-8"))


def sample_maps() -> list[dict[str, Any]]:
    return [
        {"id": "warehouse-default", "name": "默认仓库", "description": "20 × 15 标准仓库地图。", "request": load_json("sample-map.json")},
        {"id": "no-path", "name": "无解地图", "description": "目标货架被包围，用于验证失败提示。", "request": load_json("no-path-map.json")},
        {
            "id": "cbs-crossing", "name": "多车交叉口", "description": "两辆 AGV 在中心点发生冲突，CBS 会安排等待。",
            "request": {
                "mode": "multi", "algorithm": "cbs", "allowDiagonal": False, "preventCornerCutting": True,
                "grid": [[1, 0, 1], [0, 0, 0], [1, 0, 1]],
                "robots": [
                    {"id": "agv-01", "start": [1, 0], "target": [1, 2], "roundTrip": False},
                    {"id": "agv-02", "start": [0, 1], "target": [2, 1], "roundTrip": False},
                ],
            },
        },
    ]


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "cppCoreReady": planner_client.is_ready()}


@app.get("/api/sample-maps")
def get_sample_maps() -> list[dict[str, Any]]:
    return sample_maps()


@app.post("/api/plan")
def plan(request: PlannerRequest) -> dict[str, Any]:
    try:
        return planner_client.plan(request.model_dump())
    except PlannerTimeoutError as error:
        raise HTTPException(status_code=504, detail=str(error)) from error
    except PlannerClientError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

