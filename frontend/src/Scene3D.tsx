import React, { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { CellType, Grid, Mode, Point, RobotTaskMarker } from "./types";
import { pointKey } from "./grid-utils";

type RoutePhase = "outbound" | "return" | "trail";

export interface SceneRoute3D {
  key: string;
  points: Point[];
  phase: RoutePhase;
  robotIndex?: number;
}

export interface RobotPosition3D {
  id: string;
  point: Point;
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
  robotColors: readonly (readonly [string, string])[];
  onCellClick: (point: Point) => void;
}

const CELL_COLOR: Record<CellType, string> = {
  0: "#f3f3f3",
  1: "#1a1a1a",
  2: "#650b0b",
  3: "#111111",
  4: "#76b900",
};

const MODEL_PATHS = {
  rack: "/models/rack.glb",
  obstacle: "/models/obstacle.glb",
  agv: "/models/agv.glb",
};

function hasWebGlSupport() {
  if (typeof window === "undefined") return false;
  if (!("WebGLRenderingContext" in window)) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
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

function ModelBox({ path, fallbackColor, scale = [1, 1, 1] }: {
  path: string;
  fallbackColor: string;
  scale?: [number, number, number];
}) {
  return <ModelErrorBoundary fallback={<FallbackBox color={fallbackColor} scale={scale} />}>
    <Suspense fallback={<FallbackBox color={fallbackColor} scale={scale} />}>
      <LoadedModel path={path} scale={scale} />
    </Suspense>
  </ModelErrorBoundary>;
}

function LoadedModel({ path, scale }: { path: string; scale: [number, number, number] }) {
  const { scene } = useGLTF(path);
  const clonedScene = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={clonedScene} scale={scale} />;
}

function FallbackBox({ color, scale }: { color: string; scale: [number, number, number] }) {
  return <mesh scale={scale}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color={color} roughness={0.8} />
  </mesh>;
}

class ModelErrorBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // 模型缺失时使用几何体兜底，避免 3D 页面整块崩溃。
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Tile({ cell, point, markers, robots, selected, onCellClick }: {
  cell: CellType;
  point: Point;
  markers: RobotTaskMarker[];
  robots: RobotPosition3D[];
  selected: boolean;
  onCellClick: (point: Point) => void;
}) {
  const [x, , z] = toScenePosition(point);
  const tileColor = cell === 0 ? CELL_COLOR[0] : "#dadada";
  const clickCell = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    onCellClick(point);
  };

  return <group position={[x, 0, z]} onPointerDown={clickCell}>
    <mesh receiveShadow>
      <boxGeometry args={[0.96, 0.04, 0.96]} />
      <meshStandardMaterial color={tileColor} roughness={0.9} />
    </mesh>
    {cell === 1 && <group position={[0, 0.68, 0]}><ModelBox path={MODEL_PATHS.rack} fallbackColor={CELL_COLOR[1]} scale={[1, 1, 1]} /></group>}
    {cell === 2 && <group position={[0, 0.34, 0]}><ModelBox path={MODEL_PATHS.obstacle} fallbackColor={CELL_COLOR[2]} scale={[1, 1, 1]} /></group>}
    {cell === 3 && <LoadingPad />}
    {cell === 4 && <TargetPad />}
    {markers.map((marker, index) => (
      <Html key={`${marker.robotId}-${marker.role}`} position={[-0.32 + index * 0.3, 0.76, -0.32]} center>
        <span className={`scene3d-label ${marker.selected ? "selected" : ""}`}>{marker.label}</span>
      </Html>
    ))}
    {selected && <mesh position={[0, 0.08, 0]}>
      <ringGeometry args={[0.48, 0.53, 32]} />
      <meshBasicMaterial color="#76b900" side={THREE.DoubleSide} />
    </mesh>}
    {robots.map((robot, index) => <RobotModel key={robot.id} robot={robot} index={index} />)}
  </group>;
}

function LoadingPad() {
  return <group position={[0, 0.06, 0]}>
    <mesh>
      <boxGeometry args={[0.82, 0.08, 0.82]} />
      <meshStandardMaterial color="#050505" roughness={0.7} />
    </mesh>
    <mesh position={[0, 0.05, 0]}>
      <ringGeometry args={[0.32, 0.38, 32]} />
      <meshBasicMaterial color="#76b900" side={THREE.DoubleSide} />
    </mesh>
  </group>;
}

function TargetPad() {
  return <group position={[0, 0.08, 0]}>
    <mesh>
      <cylinderGeometry args={[0.36, 0.36, 0.08, 32]} />
      <meshStandardMaterial color="#76b900" roughness={0.6} />
    </mesh>
    <Html position={[0, 0.36, 0]} center><span className="scene3d-label selected">T</span></Html>
  </group>;
}

function RobotModel({ robot, index }: { robot: RobotPosition3D; index: number }) {
  return <group position={[0, 0.32 + index * 0.03, 0]}>
    <ModelBox path={MODEL_PATHS.agv} fallbackColor="#111111" scale={[1, 1, 1]} />
    <Html position={[0, 0.48, 0]} center>
      <span className="scene3d-robot-label">{compactRobotId(robot.id)}</span>
    </Html>
  </group>;
}

function RouteLine({ route, robotColors }: { route: SceneRoute3D; robotColors: readonly (readonly [string, string])[] }) {
  const color = route.robotIndex === undefined
    ? (route.phase === "return" ? "#000000" : "#76b900")
    : robotColors[route.robotIndex % robotColors.length][route.phase === "return" ? 1 : 0];
  const line = useMemo(() => {
    const points = route.points
      .filter((point, index) => index === 0 || pointKey(point) !== pointKey(route.points[index - 1]))
      .map((point) => new THREE.Vector3(...toScenePosition(point, 0.11)));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, linewidth: 3 });
    return new THREE.Line(geometry, material);
  }, [color, route.points]);
  if (route.points.length < 2) return null;
  return <primitive object={line} />;
}

function SceneCanvas(props: Scene3DProps) {
  const selectedKeys = new Set(props.taskMarkers.filter((marker) => marker.selected).map((marker) => pointKey(marker.point)));
  return <Canvas className="scene3d-canvas" camera={{ position: [props.cols / 2, 16, props.rows + 8], fov: 45 }} shadows>
    <color attach="background" args={["#f7f7f7"]} />
    <ambientLight intensity={0.75} />
    <directionalLight position={[6, 12, 5]} intensity={1.1} castShadow />
    <gridHelper args={[Math.max(props.rows, props.cols) + 2, Math.max(props.rows, props.cols) + 2, "#cccccc", "#eeeeee"]} position={[props.cols / 2, 0.02, props.rows / 2]} />
    <group position={[-props.cols / 2, 0, -props.rows / 2]}>
      {props.routes.map((route) => <RouteLine key={route.key} route={route} robotColors={props.robotColors} />)}
      {props.grid.flatMap((row, rowIndex) => row.map((cell, colIndex) => {
        const point: Point = [rowIndex, colIndex];
        const key = pointKey(point);
        return <Tile key={key} cell={cell} point={point}
          markers={props.taskMarkers.filter((marker) => pointKey(marker.point) === key)}
          robots={props.robots.filter((robot) => pointKey(robot.point) === key)}
          selected={selectedKeys.has(key)}
          onCellClick={props.onCellClick} />;
      }))}
    </group>
    <OrbitControls target={[0, 0, 0]} minDistance={8} maxDistance={60} maxPolarAngle={Math.PI / 2.15} />
  </Canvas>;
}

function Scene3DFallback(props: Scene3DProps) {
  return <div className="scene3d-fallback" role="region" aria-label="3D 仓库备用视图">
    <p>当前测试环境不支持 WebGL，这里使用备用 3D 点选层。浏览器中会显示 Three.js 仓库场景。</p>
    <div className="scene3d-fallback-grid" style={{ gridTemplateColumns: `repeat(${props.cols}, minmax(20px, 1fr))` }}>
      {props.grid.flatMap((row, rowIndex) => row.map((cell, colIndex) => {
        const point: Point = [rowIndex, colIndex];
        const key = pointKey(point);
        const markers = props.taskMarkers.filter((marker) => pointKey(marker.point) === key);
        const robots = props.robots.filter((robot) => pointKey(robot.point) === key);
        return <button key={key} title={`3D [${point.join(", ")}]`} onClick={() => props.onCellClick(point)} style={{ background: CELL_COLOR[cell] }}>
          <span>{cell}</span>
          {markers.map((marker) => <i key={`${marker.robotId}-${marker.role}`}>{marker.label}</i>)}
          {robots.map((robot) => <b key={robot.id}>{compactRobotId(robot.id)}</b>)}
        </button>;
      }))}
    </div>
  </div>;
}

export function Scene3D(props: Scene3DProps) {
  return <section className="scene3d-shell" aria-label="Three.js 3D 仓库视图">
    <div className="scene3d-head">
      <b>3D WAREHOUSE</b>
      <span>{props.mode === "multi" ? `当前 AGV：${props.selectedRobot}` : "单车仓库视图"} · 点击地砖可编辑</span>
    </div>
    {hasWebGlSupport() ? <SceneCanvas {...props} /> : <Scene3DFallback {...props} />}
  </section>;
}
