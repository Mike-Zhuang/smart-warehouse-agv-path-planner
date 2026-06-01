export type CellType = 0 | 1 | 2 | 3 | 4;
export type Grid = CellType[][];
export type Point = [number, number];
export type Mode = "single" | "multi";
export type SingleAlgorithm = "astar" | "dijkstra" | "compare";
export type DisplayMode = "number" | "icon";
export type RobotPointField = "start" | "target";

export interface RobotTask {
  id: string;
  start: Point;
  target: Point;
  roundTrip: boolean;
}

export interface PlannerRequest {
  mode: Mode;
  algorithm: SingleAlgorithm | "cbs";
  roundTrip: boolean;
  allowDiagonal: boolean;
  preventCornerCutting: boolean;
  grid: Grid;
  robots?: RobotTask[];
  options?: { maxRobots: number; maxHighLevelNodes: number; maxTimeSteps: number };
}

export interface PathResult {
  found: boolean;
  message: string;
  path: Point[];
  pathCost: number;
  expandedCount: number;
  expandedOrder: Point[];
}

export interface RoundTripResult {
  success: boolean;
  message: string;
  outbound: PathResult;
  returnTrip: PathResult;
  fullPath: Point[];
  totalCost: number;
  totalExpandedCount: number;
}

export interface CompareResult {
  algorithm: "compare";
  astar: RoundTripResult | PathResult;
  dijkstra: RoundTripResult | PathResult;
}

export interface MultiRobotResult {
  success: boolean;
  message: string;
  robots: Array<{ id: string; timeline: Point[]; pathCost: number }>;
  totalCost: number;
  resolvedConflictCount: number;
}

export interface SampleMap {
  id: string;
  name: string;
  description: string;
  request: PlannerRequest;
}
