from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_BINARY = ROOT_DIR / "cpp_core" / "build" / "agv-path-planner"


class PlannerClientError(RuntimeError):
    pass


class PlannerTimeoutError(PlannerClientError):
    pass


class PlannerClient:
    def __init__(self, binary_path: Path = DEFAULT_BINARY, timeout_seconds: float = 8.0) -> None:
        self.binary_path = binary_path
        self.timeout_seconds = timeout_seconds

    def is_ready(self) -> bool:
        return self.binary_path.is_file() and self.binary_path.stat().st_mode & 0o111 != 0

    def plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.is_ready():
            raise PlannerClientError("C++ 核心尚未构建，请先运行 cmake --build cpp_core/build")
        try:
            process = subprocess.run(
                [str(self.binary_path)],
                input=json.dumps(payload, ensure_ascii=False),
                text=True,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise PlannerTimeoutError("路径规划超时，请降低地图复杂度或 CBS 搜索上限") from error

        try:
            result = json.loads(process.stdout)
        except json.JSONDecodeError as error:
            raise PlannerClientError("C++ 核心返回了无法解析的结果") from error
        if process.returncode != 0:
            raise PlannerClientError(result.get("message", "C++ 核心执行失败"))
        return result

