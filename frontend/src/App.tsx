import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Box, Bot, Boxes, Download, Eraser, FastForward, Flag, Github,
  Grid3X3, Hash, Pause, Play, Plus, RefreshCw, RotateCcw, Route, Save, Settings2,
  ShieldAlert, Sparkles, Square, Target, Trash2, Upload, Warehouse,
} from "lucide-react";
import { fetchSamples, runPlanner } from "./api";
import {
  DEFAULT_COLS, DEFAULT_ROWS, createGrid, exportRequest, importRequest, paintCell,
  pointKey, randomizeObstacles, resizeGrid, updateRobotPoint,
} from "./grid-utils";
import type {
  CellType, CompareResult, DisplayMode, Grid, Mode, MultiRobotResult, PathResult,
  PathStyle, PlannerRequest, Point, RobotPointField, RobotTask, RobotTaskMarker, RoundTripResult,
  RouteDirection, SampleMap, SearchTraceEntry, SingleAlgorithm, ViewMode,
} from "./types";

const Scene3D = lazy(() => import("./Scene3D").then((module) => ({ default: module.Scene3D })));

const CELL_META = [
  { value: 0 as CellType, label: "通道", icon: Square },
  { value: 1 as CellType, label: "货架", icon: Boxes },
  { value: 2 as CellType, label: "障碍", icon: ShieldAlert },
  { value: 3 as CellType, label: "装卸区", icon: Warehouse },
  { value: 4 as CellType, label: "目标货架", icon: Target },
];

const EMPTY_SINGLE_GRID = paintCell(paintCell(createGrid(), [19, 1], 3), [2, 8], 4);
type PlannerResult = RoundTripResult | PathResult | CompareResult | MultiRobotResult;
type RoutePhase = "outbound" | "return" | "trail";
type MultiEditMode = "tasks" | "grid";
interface RouteMarker { direction: RouteDirection; phase: RoutePhase; label?: string; robotIndex?: number }
interface CurveRoute { key: string; points: Point[]; phase: RoutePhase; robotIndex?: number }
interface ExpansionState { outbound: boolean; returning: boolean; currentPhase: "outbound" | "return" | null }
type Observation = {
  kind: "single"; algorithm: SingleAlgorithm; trace?: SearchTraceEntry; target?: Point; phase: string; expanded: number; totalExpanded: number;
} | {
  kind: "multi"; id: string; point: Point; target: Point; phase: string; g: number; h: number; timeStep: number; waiting: boolean; conflicts: number;
};

const ROBOT_COLORS = [
  ["#76b900", "#355400"], ["#5ba8ff", "#174f91"], ["#ffad42", "#9b5000"], ["#b995ff", "#5e3599"],
  ["#52d4cc", "#14766f"], ["#ff7777", "#9d2929"], ["#f58bd8", "#953878"], ["#e2bf49", "#806711"],
] as const;

function manhattanDistance(first: Point, second: Point) {
  return Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1]);
}

function heatmapColor(distance: number) {
  const palette = ["#76b900", "#98cf45", "#b6de78", "#d3ecaa", "#edf7da"];
  return palette[Math.min(palette.length - 1, Math.floor(distance / 5))];
}

function timelineCost(points: Point[]) {
  return points.slice(1).reduce((cost, point, index) => {
    const previous = points[index];
    if (pointKey(point) === pointKey(previous)) return cost + 1;
    return cost + (point[0] !== previous[0] && point[1] !== previous[1] ? 2 : 1);
  }, 0);
}

function isCompareResult(result: PlannerResult | null): result is CompareResult {
  return Boolean(result && "algorithm" in result && result.algorithm === "compare");
}

function isMultiResult(result: PlannerResult | null): result is MultiRobotResult {
  return Boolean(result && "robots" in result);
}

function isRoundTripResult(result: RoundTripResult | PathResult): result is RoundTripResult {
  return "fullPath" in result;
}

function animationSource(result: PlannerResult | null): { expanded: Point[]; path: Point[] } {
  if (!result || isMultiResult(result)) return { expanded: [], path: [] };
  const selected = isCompareResult(result) ? result.astar : result;
  if (isRoundTripResult(selected)) {
    return {
      expanded: [...selected.outbound.expandedOrder, ...selected.returnTrip.expandedOrder],
      path: selected.fullPath,
    };
  }
  return { expanded: selected.expandedOrder, path: selected.path };
}

function directionBetween(from: Point, to: Point): RouteDirection {
  const row = to[0] - from[0];
  const col = to[1] - from[1];
  return new Map([
    ["-1,0", "up"], ["1,0", "down"], ["0,-1", "left"], ["0,1", "right"],
    ["-1,-1", "up-left"], ["-1,1", "up-right"], ["1,-1", "down-left"], ["1,1", "down-right"], ["0,0", "wait"],
  ] as Array<[string, RouteDirection]>).get(`${row},${col}`) ?? "wait";
}

function append_marker(markers: Map<string, RouteMarker[]>, point: Point, marker: RouteMarker) {
  const key = pointKey(point);
  markers.set(key, [...(markers.get(key) ?? []), marker]);
}

function single_route_markers(result: PlannerResult | null, visible_points: number): Map<string, RouteMarker[]> {
  const markers = new Map<string, RouteMarker[]>();
  if (!result || isMultiResult(result)) return markers;
  const selected = isCompareResult(result) ? result.astar : result;
  const path = isRoundTripResult(selected) ? selected.fullPath : selected.path;
  const outbound_segments = isRoundTripResult(selected) ? Math.max(0, selected.outbound.path.length - 1) : path.length;
  const visible = path.slice(0, visible_points);
  for (let index = 0; index + 1 < visible.length; index += 1) {
    append_marker(markers, visible[index], {
      direction: directionBetween(visible[index], visible[index + 1]),
      phase: index < outbound_segments ? "outbound" : "return",
    });
  }
  return markers;
}

function multi_route_markers(result: PlannerResult | null, frame: number): Map<string, RouteMarker[]> {
  const markers = new Map<string, RouteMarker[]>();
  if (!isMultiResult(result)) return markers;
  result.robots.forEach((robot, robotIndex) => {
    const visible = robot.timeline.slice(0, Math.min(frame + 1, robot.timeline.length));
    for (let index = 0; index + 1 < visible.length; index += 1) {
      append_marker(markers, visible[index], {
        direction: directionBetween(visible[index], visible[index + 1]),
        phase: robot.returnStartTimeStep !== null && index >= robot.returnStartTimeStep ? "return" : "outbound",
        label: robot.id.replace("agv-", ""),
        robotIndex,
      });
    }
  });
  return markers;
}

function metricResult(result: PlannerResult | null) {
  if (!result || isMultiResult(result) || isCompareResult(result)) return null;
  return isRoundTripResult(result)
    ? { success: result.success, cost: result.totalCost, expanded: result.totalExpandedCount, message: result.message }
    : { success: result.found, cost: result.pathCost, expanded: result.expandedCount, message: result.message };
}

function curvePath(points: Point[]): string {
  const centers = points.filter((point, index) => index === 0 || pointKey(point) !== pointKey(points[index - 1]))
    .map(([row, col]) => [col + 0.5, row + 0.5] as const);
  if (centers.length < 2) return "";
  if (centers.length === 2) return `M ${centers[0][0]} ${centers[0][1]} L ${centers[1][0]} ${centers[1][1]}`;
  let path = `M ${centers[0][0]} ${centers[0][1]}`;
  for (let index = 1; index < centers.length - 1; index += 1) {
    const current = centers[index];
    const next = centers[index + 1];
    path += ` Q ${current[0]} ${current[1]} ${(current[0] + next[0]) / 2} ${(current[1] + next[1]) / 2}`;
  }
  const last = centers[centers.length - 1];
  return `${path} T ${last[0]} ${last[1]}`;
}

export function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [grid, setGrid] = useState<Grid>(EMPTY_SINGLE_GRID);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [brush, setBrush] = useState<CellType>(1);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("number");
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [pathStyle, setPathStyle] = useState<PathStyle>("arrows");
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<Point | null>(null);
  const [algorithm, setAlgorithm] = useState<SingleAlgorithm>("astar");
  const [roundTrip, setRoundTrip] = useState(true);
  const [allowDiagonal, setAllowDiagonal] = useState(true);
  const [preventCornerCutting, setPreventCornerCutting] = useState(true);
  const [samples, setSamples] = useState<SampleMap[]>([]);
  const [result, setResult] = useState<PlannerResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [robots, setRobots] = useState<RobotTask[]>([
    { id: "agv-01", start: [0, 0], target: [0, 1], roundTrip: false },
  ]);
  const [selectedRobot, setSelectedRobot] = useState("agv-01");
  const [robotPointField, setRobotPointField] = useState<RobotPointField>("start");
  const [multiEditMode, setMultiEditMode] = useState<MultiEditMode>("tasks");
  const [animationIndex, setAnimationIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(40);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSamples().then((items) => {
      setSamples(items);
      const defaultSample = items.find((item) => item.id === "warehouse-default");
      if (defaultSample) loadSample(defaultSample);
    }).catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    if (!robots.some((robot) => robot.id === selectedRobot) && robots[0]) {
      setSelectedRobot(robots[0].id);
    }
  }, [robots, selectedRobot]);

  const singleAnimation = useMemo(() => animationSource(result), [result]);
  const maxTimeline = useMemo(() => isMultiResult(result)
    ? Math.max(0, ...result.robots.map((robot) => robot.timeline.length))
    : singleAnimation.expanded.length + singleAnimation.path.length, [result, singleAnimation]);

  useEffect(() => {
    if (!playing || animationIndex >= maxTimeline) {
      if (animationIndex >= maxTimeline) setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setAnimationIndex((index) => index + 1), speed);
    return () => window.clearTimeout(timer);
  }, [animationIndex, maxTimeline, playing, speed]);

  const expansionStates = useMemo(() => {
    const states = new Map<string, ExpansionState>();
    if (!result || isMultiResult(result)) return states;
    const selected = isCompareResult(result) ? result.astar : result;
    const outboundCount = isRoundTripResult(selected) ? selected.outbound.expandedOrder.length : singleAnimation.expanded.length;
    const visible = singleAnimation.expanded.slice(0, animationIndex);
    visible.forEach((point, index) => {
      const key = pointKey(point);
      const state = states.get(key) ?? { outbound: false, returning: false, currentPhase: null };
      if (index < outboundCount) state.outbound = true;
      else state.returning = true;
      states.set(key, state);
    });
    const currentIndex = Math.min(animationIndex, singleAnimation.expanded.length) - 1;
    if (currentIndex >= 0 && animationIndex <= singleAnimation.expanded.length) {
      const key = pointKey(singleAnimation.expanded[currentIndex]);
      const state = states.get(key);
      if (state) state.currentPhase = currentIndex < outboundCount ? "outbound" : "return";
    }
    return states;
  }, [animationIndex, result, singleAnimation.expanded]);

  const routeMarkers = useMemo(() => {
    if (isMultiResult(result)) return multi_route_markers(result, animationIndex);
    const visibleCount = Math.max(0, animationIndex - singleAnimation.expanded.length);
    return single_route_markers(result, visibleCount);
  }, [animationIndex, result, singleAnimation]);

  const routeEndpoints = useMemo(() => {
    if (!result || isMultiResult(result)) return new Map<string, string[]>();
    const endpoints = new Map<string, string[]>();
    const path = singleAnimation.path;
    const selected = isCompareResult(result) ? result.astar : result;
    const targetPoint = isRoundTripResult(selected) ? selected.outbound.path[selected.outbound.path.length - 1] : path[path.length - 1];
    if (path[0]) endpoints.set(pointKey(path[0]), ["S"]);
    if (targetPoint) endpoints.set(pointKey(targetPoint), [...(endpoints.get(pointKey(targetPoint)) ?? []), "T"]);
    const visibleCount = Math.max(0, animationIndex - singleAnimation.expanded.length);
    const currentPoint = path[Math.min(visibleCount - 1, path.length - 1)];
    if (currentPoint) endpoints.set(pointKey(currentPoint), [...(endpoints.get(pointKey(currentPoint)) ?? []), "●"]);
    return endpoints;
  }, [animationIndex, result, singleAnimation]);

  const currentRobots = useMemo(() => {
    if (!isMultiResult(result)) return [];
    return result.robots.map((robot) => ({
      id: robot.id,
      point: robot.timeline[Math.min(animationIndex, robot.timeline.length - 1)],
    }));
  }, [animationIndex, result]);

  const taskMarkers = useMemo(() => {
    if (mode !== "multi") return [];
    return robots.flatMap((robot, index): RobotTaskMarker[] => {
      const number = String(index + 1);
      const selected = robot.id === selectedRobot;
      return [
        { robotId: robot.id, label: `S${number}`, point: robot.start, role: "start", selected },
        { robotId: robot.id, label: `T${number}`, point: robot.target, role: "target", selected },
      ];
    });
  }, [mode, robots, selectedRobot]);

  const protectedRobotPoints = useMemo(() => (
    mode === "multi" ? robots.flatMap((robot) => [robot.start, robot.target]) : []
  ), [mode, robots]);

  const heatmapTarget = useMemo((): Point | null => {
    if (mode === "multi") {
      const selectedTask = robots.find((robot) => robot.id === selectedRobot);
      if (!selectedTask) return null;
      const plannedRobot = isMultiResult(result) ? result.robots.find((robot) => robot.id === selectedRobot) : null;
      return plannedRobot?.returnStartTimeStep !== null && plannedRobot?.returnStartTimeStep !== undefined && animationIndex >= plannedRobot.returnStartTimeStep
        ? selectedTask.start : selectedTask.target;
    }
    if (!result || isMultiResult(result)) return grid.flatMap((cells, rowIndex) => cells.map((cell, colIndex) => cell === 4 ? [rowIndex, colIndex] as Point : null)).find(Boolean) ?? null;
    const selected = isCompareResult(result) ? result.astar : result;
    if (!isRoundTripResult(selected)) return selected.path[selected.path.length - 1] ?? null;
    const expandedCount = selected.outbound.expandedOrder.length + selected.returnTrip.expandedOrder.length;
    if (animationIndex < expandedCount) {
      return animationIndex >= selected.outbound.expandedOrder.length ? selected.outbound.path[0] : selected.outbound.path[selected.outbound.path.length - 1];
    }
    const visiblePathCount = animationIndex - expandedCount;
    return visiblePathCount > selected.outbound.path.length ? selected.outbound.path[0] : selected.outbound.path[selected.outbound.path.length - 1];
  }, [animationIndex, grid, mode, result, robots, selectedRobot]);

  const curveRoutes = useMemo((): CurveRoute[] => {
    if (!result) return [];
    if (isMultiResult(result)) {
      return result.robots.flatMap((robot, robotIndex) => {
        const points = robot.timeline.slice(0, Math.min(animationIndex + 1, robot.timeline.length));
        const boundary = robot.returnStartTimeStep ?? points.length;
        return [
          { key: `${robot.id}-outbound`, points: points.slice(0, Math.min(points.length, boundary + 1)), phase: "outbound" as const, robotIndex },
          { key: `${robot.id}-return`, points: points.slice(boundary), phase: "return" as const, robotIndex },
        ];
      });
    }
    const selected = isCompareResult(result) ? result.astar : result;
    const visibleCount = Math.max(0, animationIndex - singleAnimation.expanded.length);
    const points = singleAnimation.path.slice(0, visibleCount);
    const boundary = isRoundTripResult(selected) ? selected.outbound.path.length - 1 : points.length;
    return [
      { key: "single-outbound", points: points.slice(0, Math.min(points.length, boundary + 1)), phase: "outbound" },
      { key: "single-return", points: points.slice(boundary), phase: "return" },
    ];
  }, [animationIndex, result, singleAnimation]);

  function clearResult() {
    setResult(null);
    setError("");
    setPlaying(false);
    setAnimationIndex(0);
  }

  function applyGrid(next: Grid) {
    setGrid(next);
    setRows(next.length);
    setCols(next[0]?.length ?? 0);
    clearResult();
  }

  function handleCellPaint(point: Point) {
    if (mode === "multi" && multiEditMode === "tasks") {
      const [row, col] = point;
      if (grid[row]?.[col] === 1 || grid[row]?.[col] === 2) {
        clearResult();
        setError("AGV 起点或目标点不能设置在货架或障碍物上");
        return;
      }
      setRobots((items) => updateRobotPoint(items, selectedRobot, robotPointField, point));
      if (robotPointField === "start") setRobotPointField("target");
      clearResult();
      return;
    }
    if (mode === "multi" && (brush === 1 || brush === 2) && protectedRobotPoints.some((protectedPoint) => pointKey(protectedPoint) === pointKey(point))) {
      clearResult();
      setError("不能在已有 AGV 起点或目标点上绘制货架或障碍物");
      return;
    }
    applyGrid(paintCell(grid, point, brush, mode === "single"));
  }

  function requestPayload(): PlannerRequest {
    return {
      mode,
      algorithm: mode === "single" ? algorithm : "cbs",
      roundTrip,
      allowDiagonal,
      preventCornerCutting,
      grid,
      robots: mode === "multi" ? robots : undefined,
      options: { maxRobots: 8, maxHighLevelNodes: 10000, maxTimeSteps: 300 },
    };
  }

  async function handlePlan() {
    setLoading(true);
    clearResult();
    try {
      const plannerResult = await runPlanner(requestPayload());
      setResult(plannerResult);
      setPlaying(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  function loadSample(sample: SampleMap) {
    setMode(sample.request.mode);
    setAlgorithm(sample.request.algorithm === "cbs" ? "astar" : sample.request.algorithm);
    setRoundTrip(sample.request.roundTrip ?? true);
    setAllowDiagonal(sample.request.allowDiagonal ?? true);
    setPreventCornerCutting(sample.request.preventCornerCutting ?? true);
    setRobots(sample.request.robots ?? robots);
    if (sample.request.robots?.[0]) setSelectedRobot(sample.request.robots[0].id);
    applyGrid(sample.request.grid);
  }

  function loadCbsSample() {
    const sample = samples.find((item) => item.id === "cbs-crossing");
    if (sample) loadSample(sample);
  }

  function downloadJson() {
    const blob = new Blob([exportRequest(requestPayload())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agv-map.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function uploadJson(file: File) {
    try {
      const request = importRequest(await file.text());
      loadSample({ id: "imported", name: "导入地图", description: "", request });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "JSON 导入失败");
    }
  }

  function addRobot() {
    const index = robots.length + 1;
    const robot = { id: `agv-${String(index).padStart(2, "0")}`, start: [0, 0] as Point, target: [0, 1] as Point, roundTrip: true };
    setRobots([...robots, robot]);
    setSelectedRobot(robot.id);
    setRobotPointField("start");
    clearResult();
  }

  const metrics = metricResult(result);
  const observation = useMemo(() => {
    if (!result) return null;
    if (isMultiResult(result)) {
      const robot = result.robots.find((item) => item.id === selectedRobot) ?? result.robots[0];
      const task = robots.find((item) => item.id === robot?.id);
      if (!robot || !task) return null;
      const timeStep = Math.min(animationIndex, robot.timeline.length - 1);
      const visible = robot.timeline.slice(0, timeStep + 1);
      const point = visible[visible.length - 1];
      const returning = robot.returnStartTimeStep !== null && timeStep >= robot.returnStartTimeStep;
      const target = returning ? task.start : task.target;
      return { kind: "multi" as const, id: robot.id, point, target, phase: returning ? "返程" : "去程", g: timelineCost(visible), h: manhattanDistance(point, target), timeStep, waiting: visible.length > 1 && pointKey(point) === pointKey(visible[visible.length - 2]), conflicts: result.resolvedConflictCount };
    }
    const selected = isCompareResult(result) ? result.astar : result;
    const outboundTrace = isRoundTripResult(selected) ? selected.outbound.searchTrace ?? [] : selected.searchTrace ?? [];
    const returnTrace = isRoundTripResult(selected) ? selected.returnTrip.searchTrace ?? [] : [];
    const traces = [...outboundTrace, ...returnTrace];
    const trace = traces[Math.min(animationIndex, traces.length) - 1] as SearchTraceEntry | undefined;
    const isReturning = isRoundTripResult(selected) && animationIndex > outboundTrace.length;
    const phase = animationIndex <= traces.length ? (isReturning ? "返程搜索" : "去程搜索") : "路径播放";
    const target = isRoundTripResult(selected) ? (isReturning ? selected.outbound.path[0] : selected.outbound.path[selected.outbound.path.length - 1]) : selected.path[selected.path.length - 1];
    return { kind: "single" as const, algorithm: isCompareResult(result) ? "astar" : algorithm, trace, target, phase, expanded: Math.min(animationIndex, traces.length), totalExpanded: traces.length };
  }, [algorithm, animationIndex, result, robots, selectedRobot]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="corner-square" /><Bot size={24} /><b>AGV ROUTE LAB</b></div>
        <div className="topbar-copy">智能仓储机器人路径规划系统</div>
        <a className="github-link" href="https://github.com/Mike-Zhuang/smart-warehouse-agv-path-planner" target="_blank" rel="noreferrer"><Github size={16} />GitHub</a>
        <div className="status-dot"><span /> C++ CORE ONLINE</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">DATA STRUCTURES × PATH PLANNING</p>
          <h1>仓储 AGV 路径规划<br /><span>可视化控制台</span></h1>
          <p>编辑网格地图，观察 A* 搜索展开过程，并使用 CBS 解决多机器人冲突。</p>
        </div>
        <div className="hero-stat"><strong>20 × 15</strong><span>默认仓储网格</span></div>
      </section>

      <main className="workspace">
        <aside className="panel controls-panel">
          <PanelTitle icon={Settings2} title="规划配置" />
          <div className="segmented">
            <button className={mode === "single" ? "active" : ""} onClick={() => { setMode("single"); clearResult(); }}>单车规划</button>
            <button className={mode === "multi" ? "active" : ""} onClick={() => { setMode("multi"); clearResult(); }}>CBS 多车</button>
          </div>

          {mode === "single" ? (
            <>
              <Field label="搜索算法">
                <select value={algorithm} onChange={(event) => { setAlgorithm(event.target.value as SingleAlgorithm); clearResult(); }}>
                  <option value="astar">A* 启发式搜索</option><option value="dijkstra">Dijkstra</option><option value="compare">A* / Dijkstra 对比</option>
                </select>
              </Field>
              <Check label="规划返程路线" checked={roundTrip} onChange={setRoundTrip} />
            </>
          ) : <RobotEditor robots={robots} selectedRobot={selectedRobot} field={robotPointField} onSelect={(id) => { setSelectedRobot(id); setRobotPointField("start"); clearResult(); }} onField={setRobotPointField} onChange={(items) => { setRobots(items); clearResult(); }} onAdd={addRobot} onLoadSample={loadCbsSample} />}
          {mode === "multi" && <div className="segmented multi-edit-switch">
            <button className={multiEditMode === "tasks" ? "active" : ""} onClick={() => setMultiEditMode("tasks")}>设置 AGV 任务点</button>
            <button className={multiEditMode === "grid" ? "active" : ""} onClick={() => { setMultiEditMode("grid"); if (brush === 3 || brush === 4) setBrush(2); }}>编辑仓库底图</button>
          </div>}
          <Check label="允许斜向移动" checked={allowDiagonal} onChange={setAllowDiagonal} />
          <Check label="禁止穿越墙角" checked={preventCornerCutting} onChange={setPreventCornerCutting} />
          <Check label="显示曼哈顿热力层" checked={showHeatmap} onChange={setShowHeatmap} />

          <PanelTitle icon={Grid3X3} title="地图工具" />
          <div className="size-row">
            <input type="number" min={2} max={50} value={rows} onChange={(event) => setRows(Number(event.target.value))} />
            <span>×</span>
            <input type="number" min={2} max={50} value={cols} onChange={(event) => setCols(Number(event.target.value))} />
            <button title="应用尺寸" onClick={() => applyGrid(resizeGrid(grid, rows, cols))}><Save size={16} /></button>
          </div>
          <div className="brush-grid">
            {CELL_META.map(({ value, label, icon: Icon }) => (
              <button key={value} className={brush === value ? "brush active" : "brush"} onClick={() => setBrush(value)} disabled={mode === "multi" && (multiEditMode === "tasks" || value === 3 || value === 4)}>
                <Icon size={15} /><b>{value}</b><span>{label}</span>
              </button>
            ))}
          </div>
          <div className="button-grid">
            <button onClick={() => applyGrid(randomizeObstacles(grid, Math.random, protectedRobotPoints))}><Sparkles size={16} />随机障碍</button>
            <button onClick={() => applyGrid(createGrid(rows, cols))}><Eraser size={16} />清空地图</button>
            <button onClick={clearResult}><RotateCcw size={16} />清除结果</button>
            <button onClick={downloadJson}><Download size={16} />导出 JSON</button>
            <button onClick={() => importRef.current?.click()}><Upload size={16} />导入 JSON</button>
          </div>
          <input ref={importRef} hidden type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && uploadJson(event.target.files[0])} />
          <Field label="示例地图">
            <select defaultValue="" onChange={(event) => { const sample = samples.find((item) => item.id === event.target.value); if (sample) loadSample(sample); }}>
              <option value="" disabled>选择示例</option>
              {samples.map((sample) => <option key={sample.id} value={sample.id}>{sample.name}</option>)}
            </select>
          </Field>
        </aside>

        <section className="map-section">
          <div className="map-toolbar">
            <div><b>WAREHOUSE GRID</b><span>{rows} 行 × {cols} 列</span></div>
            <div className="map-toolbar-actions"><div className="segmented compact">
              <button className={viewMode === "2d" ? "active" : ""} onClick={() => setViewMode("2d")}>2D 平面</button>
              <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")}>3D 仓库</button>
            </div><div className="segmented compact">
              <button className={displayMode === "number" ? "active" : ""} onClick={() => setDisplayMode("number")}><Hash size={15} />数字</button>
              <button className={displayMode === "icon" ? "active" : ""} onClick={() => setDisplayMode("icon")}><Box size={15} />图标</button>
            </div><div className="segmented compact path-style-switch">
              <button className={pathStyle === "arrows" ? "active" : ""} onClick={() => setPathStyle("arrows")}>箭头</button>
              <button className={pathStyle === "curves" ? "active" : ""} onClick={() => setPathStyle("curves")}>曲线</button>
              <button className={pathStyle === "both" ? "active" : ""} onClick={() => setPathStyle("both")}>组合</button>
            </div></div>
          </div>
          {viewMode === "2d" ? <div className="grid-scroll">
            <div className="warehouse-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(22px, 1fr))` }} onMouseLeave={() => { setDragging(false); setHoveredPoint(null); }} onMouseUp={() => setDragging(false)}>
              {(pathStyle === "curves" || pathStyle === "both") && <CurveOverlay routes={curveRoutes} rows={rows} cols={cols} />}
              {grid.flatMap((row, rowIndex) => row.map((cell, colIndex) => (
                <GridCell key={`${rowIndex}-${colIndex}`} cell={cell} point={[rowIndex, colIndex]} displayMode={displayMode}
                  expansion={expansionStates.get(`${rowIndex}-${colIndex}`) ?? null} routeMarkers={pathStyle === "curves" ? [] : routeMarkers.get(`${rowIndex}-${colIndex}`) ?? []}
                  routeEndpoints={routeEndpoints.get(`${rowIndex}-${colIndex}`) ?? []}
                  taskMarkers={taskMarkers.filter((marker) => pointKey(marker.point) === `${rowIndex}-${colIndex}`)}
                  robots={currentRobots.filter((robot) => pointKey(robot.point) === `${rowIndex}-${colIndex}`)}
                  heatValue={showHeatmap && heatmapTarget && cell === 0 ? manhattanDistance([rowIndex, colIndex], heatmapTarget) : null}
                  onDown={() => { setDragging(true); handleCellPaint([rowIndex, colIndex]); }}
                  onEnter={() => { setHoveredPoint([rowIndex, colIndex]); if (dragging) handleCellPaint([rowIndex, colIndex]); }} />
              )))}
            </div>
          </div> : <Suspense fallback={<div className="scene3d-loading">正在加载 3D 仓库视图...</div>}>
            <Scene3D grid={grid} rows={rows} cols={cols} mode={mode} selectedRobot={selectedRobot}
              taskMarkers={taskMarkers} robots={currentRobots} routes={curveRoutes} robotColors={ROBOT_COLORS}
              onCellClick={handleCellPaint} />
          </Suspense>}
          <div className="legend">{CELL_META.map(({ value, label }) => <span key={value}><i className={`legend-${value}`} />{value} · {label}</span>)}</div>
          {result && !isMultiResult(result) && <div className="route-legend"><b>路线方向</b><span><i className="route-outbound">→</i>去程</span><span><i className="route-return">←</i>返程</span><span><i className="search-legend-outbound" />去程搜索</span><span><i className="search-legend-return" />返程搜索</span><small>SVG 箭头支持八方向移动；重叠路线会错位显示，返程搜索使用虚线斜纹。</small></div>}
          {isMultiResult(result) && <div className="route-legend"><b>多车轨迹</b><span><i className="route-wait">Ⅱ</i>等待</span>{result.robots.map((robot, index) => <span key={robot.id}><i style={{ background: ROBOT_COLORS[index % ROBOT_COLORS.length][0] }} /><i style={{ background: ROBOT_COLORS[index % ROBOT_COLORS.length][1] }} />{robot.id} 去 / 返</span>)}<small>浅色为去程，深色为返程；箭头数字为 AGV 编号。</small></div>}
        </section>

        <aside className="panel results-panel">
          <PanelTitle icon={Route} title="规划结果" />
          <button className="primary-action" disabled={loading} onClick={handlePlan}><Play size={17} />{loading ? "计算中..." : "运行路径规划"}</button>
          {error && <div className="error-box">{error}</div>}
          {!result && !error && <div className="empty-state"><Route size={32} /><p>运行算法后，这里会显示路径指标与动画控制。</p></div>}
          {metrics && <MetricCards success={metrics.success} cost={metrics.cost} expanded={metrics.expanded} message={metrics.message} />}
          {isCompareResult(result) && <CompareCards result={result} />}
          {isMultiResult(result) && <MultiCards result={result} />}
          {result && (
            <>
              <PanelTitle icon={FastForward} title="动画控制" />
              <div className="animation-controls">
                <button aria-label={playing ? "暂停动画" : "播放动画"} title={playing ? "暂停动画" : "播放动画"} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
                <button aria-label="重新播放" title="重新播放" onClick={() => { setAnimationIndex(0); setPlaying(true); }}><RefreshCw size={16} /></button>
                <button aria-label="立即显示完整路线" title="立即显示完整路线" onClick={() => { setAnimationIndex(maxTimeline); setPlaying(false); }}><FastForward size={16} /></button>
                <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                  <option value={100}>慢速</option><option value={40}>标准</option><option value={10}>快速</option>
                </select>
              </div>
              <div className="progress-track"><span style={{ width: `${maxTimeline ? (animationIndex / maxTimeline) * 100 : 0}%` }} /></div>
              <small>帧 {Math.min(animationIndex, maxTimeline)} / {maxTimeline}</small>
            </>
          )}
          <TeachingPanel observation={observation} hoveredPoint={hoveredPoint} heatmapTarget={heatmapTarget} />
        </aside>
      </main>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: typeof Route; title: string }) {
  return <h2 className="panel-title"><Icon size={17} />{title}<span /></h2>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function GridCell({ cell, point, displayMode, expansion, routeMarkers, routeEndpoints, taskMarkers, robots, heatValue, onDown, onEnter }: {
  cell: CellType; point: Point; displayMode: DisplayMode; expansion: ExpansionState | null; routeMarkers: RouteMarker[];
  routeEndpoints: string[]; taskMarkers: RobotTaskMarker[]; robots: Array<{ id: string; point: Point }>;
  heatValue: number | null;
  onDown: () => void; onEnter: () => void;
}) {
  const Icon = CELL_META[cell].icon;
  const visibleRouteMarkers = routeMarkers.slice(-3);
  const visibleTaskMarkers = taskMarkers.slice(0, 3);
  return <button className={`grid-cell cell-${cell} ${routeMarkers.length ? "has-route" : ""}`}
    title={`[${point.join(", ")}] ${CELL_META[cell].label}`} onMouseDown={onDown} onMouseEnter={onEnter}>
    {displayMode === "number" ? cell : <Icon size={14} />}
    {heatValue !== null && <span className="heatmap-value" style={{ backgroundColor: heatmapColor(heatValue) }}>h{heatValue}</span>}
    {expansion?.outbound && <span className={`search-expansion outbound-expansion ${expansion.currentPhase === "outbound" ? "current-expansion" : ""}`} data-expansion-phase="outbound" />}
    {expansion?.returning && <span className={`search-expansion return-expansion ${expansion.currentPhase === "return" ? "current-expansion" : ""}`} data-expansion-phase="return" />}
    {visibleRouteMarkers.length > 0 && <span className="route-markers">{visibleRouteMarkers.map((marker, index) =>
      <RouteArrow key={`${marker.direction}-${index}`} marker={marker} />,
    )}{routeMarkers.length > visibleRouteMarkers.length && <i className="marker-overflow">+{routeMarkers.length - visibleRouteMarkers.length}</i>}</span>}
    {routeEndpoints.length > 0 && <span className="route-endpoints">{routeEndpoints.map((label) => <i key={label}>{label}</i>)}</span>}
    {visibleTaskMarkers.length > 0 && <span className="task-markers">{visibleTaskMarkers.map((marker) =>
      <i key={`${marker.robotId}-${marker.role}`} className={marker.selected ? "selected" : ""}>{marker.label}</i>,
    )}{taskMarkers.length > visibleTaskMarkers.length && <i>+{taskMarkers.length - visibleTaskMarkers.length}</i>}</span>}
    {robots.length > 0 && <b className="robot-token">{robots.map((robot) => robot.id.replace("agv-", "")).join("/")}</b>}
  </button>;
}

function RouteArrow({ marker }: { marker: RouteMarker }) {
  const rotation = { up: -90, down: 90, left: 180, right: 0, "up-left": -135, "up-right": -45, "down-left": 135, "down-right": 45, wait: 0 }[marker.direction];
  const color = marker.robotIndex === undefined ? undefined : ROBOT_COLORS[marker.robotIndex % ROBOT_COLORS.length][marker.phase === "return" ? 1 : 0];
  return <i className={`route-marker ${marker.phase} direction-${marker.direction}`} title={marker.label} data-direction={marker.direction} style={color ? { color, borderColor: color } : undefined}>
    {marker.robotIndex !== undefined && marker.label && <small style={{ background: color }}>{marker.label}</small>}
    {marker.direction === "wait"
      ? <svg viewBox="0 0 16 16" aria-label="等待"><path d="M5 3v10M11 3v10" /></svg>
      : <svg viewBox="0 0 16 16" style={{ transform: `rotate(${rotation}deg)` }} aria-label={marker.direction}><path d="M2 8h10M8 4l4 4-4 4" /></svg>}
  </i>;
}

function CurveOverlay({ routes, rows, cols }: { routes: CurveRoute[]; rows: number; cols: number }) {
  return <svg className="curve-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-label="曲线路径">
    {routes.map((route) => {
      const path = curvePath(route.points);
      if (!path) return null;
      const color = route.robotIndex === undefined
        ? (route.phase === "return" ? "#000" : "#76b900")
        : ROBOT_COLORS[route.robotIndex % ROBOT_COLORS.length][route.phase === "return" ? 1 : 0];
      return <path key={route.key} d={path} style={{ stroke: color }} />;
    })}
  </svg>;
}

function TeachingPanel({ observation, hoveredPoint, heatmapTarget }: { observation: Observation | null; hoveredPoint: Point | null; heatmapTarget: Point | null }) {
  return <div className="teaching-panel">
    <PanelTitle icon={Grid3X3} title="算法观察" />
    {observation?.kind === "single" && <div className="teaching-grid">
      <Metric label="阶段" value={observation.phase} /><Metric label="算法" value={observation.algorithm.toUpperCase()} />
      <Metric label="当前节点" value={observation.trace ? `[${observation.trace.point.join(", ")}]` : "-"} />
      <Metric label="目标" value={observation.target ? `[${observation.target.join(", ")}]` : "-"} />
      <Metric label="g 实际代价" value={observation.trace?.gCost ?? "-"} /><Metric label="h 曼哈顿距离" value={observation.trace?.hCost ?? "-"} />
      <Metric label="f = g + h" value={observation.trace?.fCost ?? "-"} /><Metric label="扩展进度" value={`${observation.expanded}/${observation.totalExpanded}`} />
      <small>{observation.algorithm === "dijkstra" ? "Dijkstra 不使用启发函数，因此 h = 0，f = g。" : "A* 使用 f = g + h 决定优先扩展顺序。"}</small>
    </div>}
    {observation?.kind === "multi" && <div className="teaching-grid">
      <Metric label="AGV" value={observation.id} /><Metric label="阶段" value={observation.phase} />
      <Metric label="当前位置" value={`[${observation.point.join(", ")}]`} /><Metric label="目标" value={`[${observation.target.join(", ")}]`} />
      <Metric label="时间步" value={observation.timeStep} /><Metric label="累计代价" value={observation.g} />
      <Metric label="h 曼哈顿距离" value={observation.h} /><Metric label="动作" value={observation.waiting ? "原地等待" : "移动"} />
      <small>已解决冲突：{observation.conflicts}</small>
    </div>}
    {!observation && <small>运行规划后，这里会解释当前搜索节点的 g、h 和 f。</small>}
    {hoveredPoint && heatmapTarget && <div className="hover-observation">悬浮格 [{hoveredPoint.join(", ")}]：h = {manhattanDistance(hoveredPoint, heatmapTarget)}</div>}
  </div>;
}

function MetricCards({ success, cost, expanded, message }: { success: boolean; cost: number; expanded: number; message: string }) {
  return <><div className={`result-banner ${success ? "success" : "failure"}`}>{success ? "PATH FOUND" : "NO PATH"}<small>{message}</small></div>
    <div className="metric-grid"><Metric label="总代价" value={cost} /><Metric label="扩展节点" value={expanded} /></div></>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}

function CompareCards({ result }: { result: CompareResult }) {
  const summarize = (item: RoundTripResult | PathResult) => isRoundTripResult(item)
    ? { cost: item.totalCost, expanded: item.totalExpandedCount }
    : { cost: item.pathCost, expanded: item.expandedCount };
  return <div className="compare-grid">
    {(["astar", "dijkstra"] as const).map((key) => { const item = summarize(result[key]); return <div className="compare-card" key={key}><b>{key.toUpperCase()}</b><span>代价 {item.cost}</span><span>扩展 {item.expanded}</span></div>; })}
  </div>;
}

function MultiCards({ result }: { result: MultiRobotResult }) {
  return <><div className="metric-grid"><Metric label="总代价" value={result.totalCost} /><Metric label="已解决冲突" value={result.resolvedConflictCount} /></div>
    <div className="robot-result-list">{result.robots.map((robot) => <div key={robot.id}><b>{robot.id}</b><span>{robot.pathCost} cost · {robot.timeline.length} frames</span></div>)}</div></>;
}

function RobotEditor({ robots, selectedRobot, field, onSelect, onField, onChange, onAdd, onLoadSample }: {
  robots: RobotTask[]; selectedRobot: string; field: RobotPointField; onSelect: (id: string) => void;
  onField: (field: RobotPointField) => void; onChange: (robots: RobotTask[]) => void; onAdd: () => void; onLoadSample: () => void;
}) {
  const selected = robots.find((robot) => robot.id === selectedRobot) ?? robots[0];
  return <div className="robot-editor">
    <div className="cbs-guide">
      <b>CBS 多车怎么用？</b>
      <ol><li>新增或选择一辆 AGV</li><li>选择“设置起点 / 目标”，再点击地图</li><li>完成任务表后运行规划</li></ol>
      <button onClick={onLoadSample}><ArrowRight size={14} />一键加载交叉口示例</button>
    </div>
    <div className="robot-editor-head"><b>AGV 任务表</b><button onClick={onAdd}><Plus size={15} />新增</button></div>
    {robots.map((robot) => <div className={`robot-row ${robot.id === selectedRobot ? "selected" : ""}`} key={robot.id} onClick={() => onSelect(robot.id)}>
      <Bot size={15} /><div className="robot-row-main">
        <input aria-label={`${robot.id} 编号`} value={robot.id} onChange={(event) => onChange(robots.map((item) => item === robot ? { ...item, id: event.target.value } : item))} />
        <small>S [{robot.start.join(", ")}] · T [{robot.target.join(", ")}]</small>
      </div>
      <label className="robot-round-trip" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={robot.roundTrip} onChange={(event) => onChange(robots.map((item) => item === robot ? { ...item, roundTrip: event.target.checked } : item))} />返程</label>
      <button aria-label={`删除 ${robot.id}`} disabled={robots.length === 1} onClick={(event) => { event.stopPropagation(); onChange(robots.filter((item) => item !== robot)); }}><Trash2 size={14} /></button>
    </div>)}
    {selected && <><div className="point-select-hint">正在为 <b>{selected.id}</b> 设置 <strong>{field === "start" ? "起点" : "目标点"}</strong>，请点击地图格子</div><div className="segmented compact">
      <button className={field === "start" ? "active" : ""} onClick={() => onField("start")}><Flag size={14} />设置起点</button>
      <button className={field === "target" ? "active" : ""} onClick={() => onField("target")}><Target size={14} />设置目标</button>
    </div><small>当前 {selected.id}：起点 [{selected.start.join(", ")}] · 目标 [{selected.target.join(", ")}]</small></>}
  </div>;
}
