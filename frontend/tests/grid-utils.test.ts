import { describe, expect, it } from "vitest";
import { createGrid, exportRequest, importRequest, paintCell, randomizeObstacles, resizeGrid, updateRobotPoint } from "../src/grid-utils";

describe("grid utils", () => {
  it("creates and resizes grids", () => {
    const grid = createGrid(2, 3);
    expect(grid).toHaveLength(2);
    expect(resizeGrid(grid, 3, 4)).toHaveLength(3);
  });

  it("keeps loading area and target unique in single mode", () => {
    let grid = createGrid(2, 2);
    grid = paintCell(grid, [0, 0], 3);
    grid = paintCell(grid, [1, 1], 3);
    expect(grid[0][0]).toBe(0);
    expect(grid[1][1]).toBe(3);
  });

  it("randomizes only empty cells", () => {
    const grid = [[3, 0], [1, 4]] as const;
    expect(randomizeObstacles(grid.map((row) => [...row]), () => 0)).toEqual([[3, 2], [1, 4]]);
  });

  it("exports and imports request json", () => {
    const request = { mode: "single", algorithm: "astar", roundTrip: true, allowDiagonal: true, preventCornerCutting: true, grid: [[3, 4]] } as import("../src/types").PlannerRequest;
    expect(importRequest(exportRequest(request))).toEqual(request);
  });

  it("updates selected robot point", () => {
    const robots = [{ id: "agv-01", start: [0, 0] as [number, number], target: [1, 1] as [number, number], roundTrip: false }];
    expect(updateRobotPoint(robots, "agv-01", "target", [2, 2])[0].target).toEqual([2, 2]);
  });
});
