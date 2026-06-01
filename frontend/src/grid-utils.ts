import type { CellType, Grid, PlannerRequest, Point, RobotTask } from "./types";

export const DEFAULT_ROWS = 20;
export const DEFAULT_COLS = 15;

export function createGrid(rows = DEFAULT_ROWS, cols = DEFAULT_COLS): Grid {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0 as CellType));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

export function paintCell(grid: Grid, point: Point, cellType: CellType, singleMode = true): Grid {
  const next = cloneGrid(grid);
  const [row, col] = point;
  if (!next[row]?.[col] && next[row]?.[col] !== 0) return next;
  if (singleMode && (cellType === 3 || cellType === 4)) {
    for (const cells of next) {
      for (let index = 0; index < cells.length; index += 1) {
        if (cells[index] === cellType) cells[index] = 0;
      }
    }
  }
  next[row][col] = cellType;
  return next;
}

export function resizeGrid(grid: Grid, rows: number, cols: number): Grid {
  const next = createGrid(rows, cols);
  for (let row = 0; row < Math.min(rows, grid.length); row += 1) {
    for (let col = 0; col < Math.min(cols, grid[0]?.length ?? 0); col += 1) {
      next[row][col] = grid[row][col];
    }
  }
  return next;
}

export function randomizeObstacles(grid: Grid, random = Math.random): Grid {
  return grid.map((row) =>
    row.map((cell) => (cell === 0 && random() < 0.16 ? 2 : cell) as CellType),
  );
}

export function exportRequest(request: PlannerRequest): string {
  return JSON.stringify(request, null, 2);
}

export function importRequest(text: string): PlannerRequest {
  const parsed = JSON.parse(text) as PlannerRequest;
  if (!Array.isArray(parsed.grid) || !parsed.grid.length || !Array.isArray(parsed.grid[0])) {
    throw new Error("JSON 中缺少有效 grid");
  }
  return parsed;
}

export function updateRobotPoint(robots: RobotTask[], robotId: string, field: "start" | "target", point: Point): RobotTask[] {
  return robots.map((robot) => (robot.id === robotId ? { ...robot, [field]: point } : robot));
}

export function pointKey(point: Point): string {
  return `${point[0]}-${point[1]}`;
}
