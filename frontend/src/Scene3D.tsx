import React, { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CellType, Grid, Mode, Point, RobotTaskMarker } from "./types";
import { pointKey } from "./grid-utils";

type RoutePhase = "outbound" | "return" | "trail";
type CameraPreset = "iso" | "top" | "side";

export interface SceneRoute3D {
  key: string;
  points: Point[];
  phase: RoutePhase;
  robotIndex?: number;
}

export interface RobotPosition3D {
  id: string;
  point: Point;
  robotIndex?: number;
  phase?: RoutePhase;
  waiting?: boolean;
}

export interface ExpansionState3D {
  outbound: boolean;
  returning: boolean;
  currentPhase: "outbound" | "return" | null;
}

interface Scene3DProps {
  grid: Grid;
  rows: number;
  cols: number;
  mode: Mode;
  selectedRobot: string;
  taskMarkers: RobotTaskMarker[];
  robots: RobotPosition3D[];
  routes: SceneRoute3D[];
  expansions: Map<string, ExpansionState3D>;
  robotColors: readonly (readonly [string, string])[];
  onCellClick: (point: Point) => void;
}

const FLOOR_COLOR = "#f4f4f4";
const WALL_COLOR = "#1a1a1a";
const OBSTACLE_COLOR = "#7d1a1a";
const ACCENT_COLOR = "#76b900";

const CAMERA_PRESETS: Record<CameraPreset, [number, number, number]> = {
  iso: [12, 16, 18],
  top: [0, 26, 0.1],
  side: [18, 10, 0],
};

function hasWebGlSupport() {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

function toScenePosition([row, col]: Point, height = 0): [number, number, number] {
  return [col + 0.5, height, row + 0.5];
}

function compactRobotId(id: string) {
  return id.replace("agv-", "");
}

function cellLabel(cell: CellType) {
  return ["通道", "货架", "障碍", "装卸区", "目标货架"][cell];
}

class SceneCanvasErrorBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("3D 仓库视图渲染失败，已切换到备用视图", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SceneRenderErrorFallback(props: Scene3DProps) {
  return <Scene3DFallback {...props} message="3D 渲染异常，已自动切换到备用点选层。请刷新页面；如果仍然出现，请把控制台错误发给我。" />;
}

function CameraRig({ preset, rows, cols }: { preset: CameraPreset; rows: number; cols: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const target = new THREE.Vector3(cols / 2, 0, rows / 2);
    const offset = CAMERA_PRESETS[preset];
    camera.position.set(target.x + offset[0], offset[1], target.z + offset[2]);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }, [camera, cols, preset, rows]);
  return null;
}

function NativeOrbitControls({ rows, cols }: { rows: number; cols: number }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new ThreeOrbitControls(camera, gl.domElement);
    controls.target.set(cols / 2, 0, rows / 2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 7;
    controls.maxDistance = 55;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.update();
    let frameId = 0;
    const tick = () => {
      controls.update();
      frameId = window.requestAnimationFrame(tick);
    };
    tick();
    return () => {
      window.cancelAnimationFrame(frameId);
      controls.dispose();
    };
  }, [camera, cols, gl, rows]);
  return null;
}

function WarehouseFloor({ rows, cols }: { rows: number; cols: number }) {
  const rowLines = useMemo(() => Array.from({ length: rows + 1 }, (_, row) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.025, row), new THREE.Vector3(cols, 0.025, row)]);
    const material = new THREE.LineBasicMaterial({ color: "#c9c9c9" });
    return { key: `row-${row}`, object: new THREE.Line(geometry, material) };
  }), [cols, rows]);
  const colLines = useMemo(() => Array.from({ length: cols + 1 }, (_, col) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(col, 0.025, 0), new THREE.Vector3(col, 0.025, rows)]);
    const material = new THREE.LineBasicMaterial({ color: "#c9c9c9" });
    return { key: `col-${col}`, object: new THREE.Line(geometry, material) };
  }), [cols, rows]);
  return <group>
    <mesh position={[cols / 2, -0.04, rows / 2]} receiveShadow>
      <boxGeometry args={[cols + 0.4, 0.04, rows + 0.4]} />
      <meshStandardMaterial color="#e5e5e5" roughness={0.9} />
    </mesh>
    {rowLines.map((line) => <primitive key={line.key} object={line.object} />)}
    {colLines.map((line) => <primitive key={line.key} object={line.object} />)}
  </group>;
}

function Tile({ cell, point, markers, selected, expansion, onCellClick }: {
  cell: CellType;
  point: Point;
  markers: RobotTaskMarker[];
  selected: boolean;
  expansion: ExpansionState3D | null;
  onCellClick: (point: Point) => void;
}) {
  const [x, , z] = toScenePosition(point);
  const clickCell = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    onCellClick(point);
  };

  return <group position={[x, 0, z]} onPointerDown={clickCell}>
    <mesh receiveShadow name={`tile-${pointKey(point)}`}>
      <boxGeometry args={[0.96, 0.035, 0.96]} />
      <meshStandardMaterial color={cell === 0 ? FLOOR_COLOR : "#dedede"} roughness={0.85} />
    </mesh>
    {expansion && <ExpansionOverlay expansion={expansion} />}
    {cell === 1 && <RackModel />}
    {cell === 2 && <ObstacleModel />}
    {cell === 3 && <LoadingPad />}
    {cell === 4 && <TargetPad />}
    {selected && <SelectionRing />}
    {markers.map((marker, index) => <TaskMarkerModel key={`${marker.robotId}-${marker.role}`} selected={marker.selected} index={index} role={marker.role} />)}
  </group>;
}

function TaskMarkerModel({ selected, index, role }: { selected: boolean; index: number; role: "start" | "target" }) {
  const color = selected ? ACCENT_COLOR : "#ffffff";
  return <group position={[-0.28 + index * 0.28, 0.82, -0.28]}>
    <mesh>
      <cylinderGeometry args={[0.12, 0.12, 0.05, 18]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
    <mesh position={[0, 0.08, 0]}>
      {role === "target" ? <torusGeometry args={[0.1, 0.025, 8, 24]} /> : <coneGeometry args={[0.1, 0.2, 18]} />}
      <meshStandardMaterial color="#111111" roughness={0.5} />
    </mesh>
  </group>;
}

function ExpansionOverlay({ expansion }: { expansion: ExpansionState3D }) {
  return <group position={[0, 0.045, 0]}>
    {expansion.outbound && <mesh>
      <planeGeometry args={[0.82, 0.82]} />
      <meshBasicMaterial color={ACCENT_COLOR} transparent opacity={expansion.currentPhase === "outbound" ? 0.62 : 0.28} side={THREE.DoubleSide} />
    </mesh>}
    {expansion.returning && <mesh rotation={[0, 0, Math.PI / 4]} position={[0, 0.006, 0]}>
      <planeGeometry args={[0.58, 0.58]} />
      <meshBasicMaterial color="#111111" transparent opacity={expansion.currentPhase === "return" ? 0.58 : 0.32} side={THREE.DoubleSide} />
    </mesh>}
    {expansion.currentPhase && <mesh position={[0, 0.014, 0]}>
      <ringGeometry args={[0.38, 0.48, 36]} />
      <meshBasicMaterial color={expansion.currentPhase === "return" ? "#111111" : ACCENT_COLOR} side={THREE.DoubleSide} />
    </mesh>}
  </group>;
}

function RackModel() {
  return <group position={[0, 0.08, 0]} name="rack-model">
    <mesh castShadow position={[0, 0.05, 0]}>
      <boxGeometry args={[0.86, 0.1, 0.7]} />
      <meshStandardMaterial color="#303030" roughness={0.55} />
    </mesh>
    {[0.25, 0.55, 0.85].map((height) => <mesh key={height} castShadow position={[0, height, 0]}>
      <boxGeometry args={[0.88, 0.06, 0.74]} />
      <meshStandardMaterial color="#b8b8b8" metalness={0.25} roughness={0.45} />
    </mesh>)}
    {[-0.36, 0.36].flatMap((x) => [-0.28, 0.28].map((z) => <mesh key={`${x}-${z}`} castShadow position={[x, 0.48, z]}>
      <boxGeometry args={[0.06, 0.94, 0.06]} />
      <meshStandardMaterial color="#1d1d1d" roughness={0.5} />
    </mesh>))}
    {[-0.18, 0.18].map((x) => <mesh key={x} castShadow position={[x, 0.36, 0]}>
      <boxGeometry args={[0.2, 0.18, 0.58]} />
      <meshStandardMaterial color="#8d1b1f" roughness={0.7} />
    </mesh>)}
  </group>;
}

function ObstacleModel() {
  return <group position={[0, 0.08, 0]} rotation={[0, Math.PI / 8, 0]} name="obstacle-model">
    <mesh castShadow position={[-0.14, 0.22, 0.05]}>
      <boxGeometry args={[0.48, 0.42, 0.48]} />
      <meshStandardMaterial color={OBSTACLE_COLOR} roughness={0.8} />
    </mesh>
    <mesh castShadow position={[0.18, 0.42, -0.12]}>
      <boxGeometry args={[0.36, 0.36, 0.42]} />
      <meshStandardMaterial color="#a45b24" roughness={0.82} />
    </mesh>
    <mesh castShadow position={[0, 0.05, 0]}>
      <boxGeometry args={[0.72, 0.08, 0.72]} />
      <meshStandardMaterial color="#5c3a1e" roughness={0.85} />
    </mesh>
  </group>;
}

function LoadingPad() {
  return <group position={[0, 0.055, 0]} name="loading-pad">
    <mesh>
      <boxGeometry args={[0.82, 0.08, 0.82]} />
      <meshStandardMaterial color="#050505" roughness={0.7} />
    </mesh>
    <mesh position={[0, 0.05, 0]}>
      <ringGeometry args={[0.32, 0.39, 36]} />
      <meshBasicMaterial color={ACCENT_COLOR} side={THREE.DoubleSide} />
    </mesh>
  </group>;
}

function TargetPad() {
  return <group position={[0, 0.07, 0]} name="target-pad">
    <mesh>
      <cylinderGeometry args={[0.36, 0.36, 0.08, 32]} />
      <meshStandardMaterial color={ACCENT_COLOR} roughness={0.6} />
    </mesh>
    <mesh position={[0, 0.08, 0]}>
      <torusGeometry args={[0.28, 0.03, 8, 32]} />
      <meshBasicMaterial color="#111111" />
    </mesh>
    <mesh position={[0, 0.38, 0]}>
      <coneGeometry args={[0.12, 0.24, 24]} />
      <meshStandardMaterial color="#111111" roughness={0.55} />
    </mesh>
  </group>;
}

function SelectionRing() {
  return <mesh position={[0, 0.07, 0]}>
    <ringGeometry args={[0.46, 0.53, 36]} />
    <meshBasicMaterial color={ACCENT_COLOR} side={THREE.DoubleSide} />
  </mesh>;
}

function RobotModel({ robot, robotColors }: { robot: RobotPosition3D; robotColors: readonly (readonly [string, string])[] }) {
  const robotIndex = robot.robotIndex ?? 0;
  const color = robotColors[robotIndex % robotColors.length][robot.phase === "return" ? 1 : 0];
  return <group position={toScenePosition(robot.point, 0.16)} name="scene3d-robot" data-robot-id={robot.id}>
    <mesh castShadow position={[0, 0.16, 0]}>
      <boxGeometry args={[0.62, 0.24, 0.48]} />
      <meshStandardMaterial color={color} roughness={0.45} metalness={0.12} />
    </mesh>
    <mesh castShadow position={[0.16, 0.34, 0]}>
      <boxGeometry args={[0.26, 0.18, 0.36]} />
      <meshStandardMaterial color="#101010" roughness={0.45} />
    </mesh>
    <mesh castShadow position={[-0.32, 0.14, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.08, 0.08, 0.08, 18]} />
      <meshStandardMaterial color="#050505" />
    </mesh>
    <mesh castShadow position={[-0.32, 0.14, 0.16]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.08, 0.08, 0.08, 18]} />
      <meshStandardMaterial color="#050505" />
    </mesh>
    <mesh castShadow position={[0.34, 0.14, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.08, 0.08, 0.08, 18]} />
      <meshStandardMaterial color="#050505" />
    </mesh>
    <mesh castShadow position={[0.34, 0.14, 0.16]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.08, 0.08, 0.08, 18]} />
      <meshStandardMaterial color="#050505" />
    </mesh>
    {robot.waiting && <mesh position={[0, 0.74, 0]}>
      <boxGeometry args={[0.08, 0.22, 0.04]} />
      <meshBasicMaterial color="#111111" />
    </mesh>}
    <mesh position={[0, 0.58, 0]}>
      <sphereGeometry args={[0.12, 18, 18]} />
      <meshBasicMaterial color={color} />
    </mesh>
  </group>;
}

function RouteLine({ route, robotColors }: { route: SceneRoute3D; robotColors: readonly (readonly [string, string])[] }) {
  const color = route.robotIndex === undefined
    ? (route.phase === "return" ? "#000000" : ACCENT_COLOR)
    : robotColors[route.robotIndex % robotColors.length][route.phase === "return" ? 1 : 0];
  const line = useMemo(() => {
    const points = route.points
      .filter((point, index) => index === 0 || pointKey(point) !== pointKey(route.points[index - 1]))
      .map((point) => new THREE.Vector3(...toScenePosition(point, 0.12)));
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, linewidth: 4 }),
    );
  }, [color, route.points]);
  if (route.points.length < 2) return null;
  return <primitive object={line} />;
}

function SceneCanvas(props: Scene3DProps & { preset: CameraPreset }) {
  const selectedKeys = new Set(props.taskMarkers.filter((marker) => marker.selected).map((marker) => pointKey(marker.point)));
  const cameraPosition = CAMERA_PRESETS[props.preset];
  const cameraTarget: [number, number, number] = [props.cols / 2, 0, props.rows / 2];

  return <Canvas className="scene3d-canvas" camera={{ position: [cameraTarget[0] + cameraPosition[0], cameraPosition[1], cameraTarget[2] + cameraPosition[2]], fov: 42 }} shadows>
    <color attach="background" args={["#f7f7f7"]} />
    <CameraRig preset={props.preset} rows={props.rows} cols={props.cols} />
    <NativeOrbitControls rows={props.rows} cols={props.cols} />
    <ambientLight intensity={0.82} />
    <directionalLight position={[props.cols / 2 + 5, 14, props.rows / 2 + 8]} intensity={1.18} castShadow />
    <group position={[-props.cols / 2, 0, -props.rows / 2]}>
      <WarehouseFloor rows={props.rows} cols={props.cols} />
      {props.routes.map((route) => <RouteLine key={route.key} route={route} robotColors={props.robotColors} />)}
      {props.grid.flatMap((row, rowIndex) => row.map((cell, colIndex) => {
        const point: Point = [rowIndex, colIndex];
        const key = pointKey(point);
        return <Tile key={key} cell={cell} point={point}
          markers={props.taskMarkers.filter((marker) => pointKey(marker.point) === key)}
          selected={selectedKeys.has(key)}
          expansion={props.expansions.get(key) ?? null}
          onCellClick={props.onCellClick} />;
      }))}
      {props.robots.map((robot) => <RobotModel key={robot.id} robot={robot} robotColors={props.robotColors} />)}
    </group>
  </Canvas>;
}

function Scene3DFallback({ message, ...props }: Scene3DProps & { message: string }) {
  return <div className="scene3d-fallback" role="region" aria-label="3D 仓库备用视图">
    <p>{message}</p>
    <div className="scene3d-fallback-grid" style={{ gridTemplateColumns: `repeat(${props.cols}, minmax(20px, 1fr))` }}>
      {props.grid.flatMap((row, rowIndex) => row.map((cell, colIndex) => {
        const point: Point = [rowIndex, colIndex];
        const key = pointKey(point);
        const markers = props.taskMarkers.filter((marker) => pointKey(marker.point) === key);
        const robots = props.robots.filter((robot) => pointKey(robot.point) === key);
        return <button key={key} title={`3D [${point.join(", ")}]`} onClick={() => props.onCellClick(point)} data-cell={cell} data-expansion={props.expansions.has(key) ? "true" : "false"}>
          <span>{cell} {cellLabel(cell)}</span>
          {markers.map((marker) => <i key={`${marker.robotId}-${marker.role}`}>{marker.label}</i>)}
          {robots.map((robot) => <b key={robot.id}>{compactRobotId(robot.id)}</b>)}
        </button>;
      }))}
    </div>
  </div>;
}

export function Scene3D(props: Scene3DProps) {
  const [preset, setPreset] = useState<CameraPreset>("iso");
  return <section className="scene3d-shell" aria-label="Three.js 3D 仓库视图">
    <div className="scene3d-head">
      <b>3D WAREHOUSE</b>
      <span>{props.mode === "multi" ? `当前 AGV：${props.selectedRobot}` : "单车仓库视图"} · 点击地砖可编辑</span>
    </div>
    <div className="scene3d-view-controls" aria-label="3D 视角控制">
      <button className={preset === "iso" ? "active" : ""} onClick={() => setPreset("iso")}>重置视角</button>
      <button className={preset === "top" ? "active" : ""} onClick={() => setPreset("top")}>俯视</button>
      <button className={preset === "side" ? "active" : ""} onClick={() => setPreset("side")}>斜视</button>
    </div>
    {hasWebGlSupport()
      ? <SceneCanvasErrorBoundary fallback={<SceneRenderErrorFallback {...props} />}><SceneCanvas key={preset} {...props} preset={preset} /></SceneCanvasErrorBoundary>
      : <Scene3DFallback {...props} message="浏览器没有创建 WebGL 上下文，已切换到备用 3D 点选层。请检查浏览器硬件加速或 WebGL 设置。" />}
    <div className="scene3d-credit">模型：程序化仓库资产；可替换为 CC BY / CC0 GLB 模型</div>
  </section>;
}
