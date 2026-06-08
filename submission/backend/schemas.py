from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Point = tuple[int, int]


class MultiRobotLimits(BaseModel):
    maxRobots: int = Field(default=8, ge=1, le=16)
    maxHighLevelNodes: int = Field(default=10000, ge=1, le=100000)
    maxTimeSteps: int = Field(default=300, ge=1, le=2000)


class RobotTask(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    start: Point
    target: Point
    roundTrip: bool = True


class PlannerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["single", "multi"] = "single"
    algorithm: Literal["astar", "dijkstra", "compare", "cbs"] = "astar"
    roundTrip: bool = True
    allowDiagonal: bool = True
    preventCornerCutting: bool = True
    grid: list[list[int]]
    robots: list[RobotTask] = Field(default_factory=list)
    options: MultiRobotLimits = Field(default_factory=MultiRobotLimits)

    @model_validator(mode="after")
    def validate_request(self) -> "PlannerRequest":
        if not self.grid or not self.grid[0]:
            raise ValueError("地图不能为空")
        width = len(self.grid[0])
        if any(len(row) != width for row in self.grid):
            raise ValueError("地图每一行必须拥有相同长度")
        if any(cell not in range(5) for row in self.grid for cell in row):
            raise ValueError("地图元素只能是 0、1、2、3、4")

        if self.mode == "single":
            if self.algorithm == "cbs":
                raise ValueError("单车模式不支持 CBS")
            if sum(cell == 3 for row in self.grid for cell in row) != 1:
                raise ValueError("单车模式必须设置唯一装卸区")
            if sum(cell == 4 for row in self.grid for cell in row) != 1:
                raise ValueError("单车模式必须设置唯一目标货架")
        else:
            if self.algorithm != "cbs":
                raise ValueError("多车模式必须使用 CBS")
            if not self.robots:
                raise ValueError("多车模式至少需要一辆 AGV")
            if len(self.robots) > self.options.maxRobots:
                raise ValueError("AGV 数量超过 maxRobots")
            self.validate_robot_points()
        return self

    def validate_robot_points(self) -> None:
        rows = len(self.grid)
        cols = len(self.grid[0])
        ids = set()
        for robot in self.robots:
            if robot.id in ids:
                raise ValueError("AGV 编号不能重复")
            ids.add(robot.id)
            for row, col in (robot.start, robot.target):
                if not (0 <= row < rows and 0 <= col < cols):
                    raise ValueError("AGV 起点或目标点超出地图范围")
                if self.grid[row][col] in (1, 2):
                    raise ValueError("AGV 起点或目标点不能位于货架或障碍物")

