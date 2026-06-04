import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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

interface ThreeContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  warehouseGroup: THREE.Group;
  floorMeshes: THREE.Mesh[];
  frameId: number;
  resizeObserver: ResizeObserver | null;
}

const FLOOR_COLOR = "#f4f4f4";
const WALL_COLOR = "#1a1a1a";
const OBSTACLE_COLOR = "#7d1a1a";
const ACCENT_COLOR = "#76b900";
const CAMERA_PRESETS: Record<CameraPreset, [number, number, number]> = {
  iso: [12, 16, 18],
  top: [0, 28, 0.1],
  side: [18, 10, 0.1],
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

function compactRobotId(id: string) {
  return id.replace("agv-", "");
}

function cellLabel(cell: CellType) {
  return ["通道", "货架", "障碍", "装卸区", "目标货架"][cell];
}

function scenePosition([row, col]: Point, height = 0) {
  return new THREE.Vector3(col + 0.5, height, row + 0.5);
}

function getRobotColor(robotColors: readonly (readonly [string, string])[], robotIndex: number, phase: RoutePhase = "outbound") {
  const palette = robotColors.length > 0 ? robotColors : [[ACCENT_COLOR, "#000000"] as const];
  const colors = palette[robotIndex % palette.length] ?? palette[0];
  return colors[phase === "return" ? 1 : 0] ?? ACCENT_COLOR;
}

function applyCameraPreset(context: ThreeContext, preset: CameraPreset) {
  const offset = CAMERA_PRESETS[preset];
  context.camera.position.set(offset[0], offset[1], offset[2]);
  context.camera.lookAt(0, 0, 0);
  context.controls.target.set(0, 0, 0);
  context.controls.update();
}

function createMaterial(color: string, options: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...options });
}

function createBox(size: [number, number, number], position: [number, number, number], color: string, options: THREE.MeshStandardMaterialParameters = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), createMaterial(color, options));
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createFlatPlane(size: [number, number], point: Point, color: string, opacity: number, height: number) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size[0], size[1]),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(scenePosition(point, height));
  return mesh;
}

function createTextSprite(text: string, color = "#000000", background = "#ffffff") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#000000";
    context.lineWidth = 5;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fillStyle = color;
    context.font = "bold 30px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.62, 0.31, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function createRackModel() {
  const group = new THREE.Group();
  group.add(createBox([0.86, 0.1, 0.7], [0, 0.13, 0], "#303030"));
  [0.32, 0.62, 0.92].forEach((height) => {
    group.add(createBox([0.88, 0.06, 0.74], [0, height, 0], "#b8b8b8", { metalness: 0.25, roughness: 0.45 }));
  });
  [-0.36, 0.36].forEach((x) => {
    [-0.28, 0.28].forEach((z) => group.add(createBox([0.06, 0.94, 0.06], [x, 0.52, z], "#1d1d1d")));
  });
  [-0.18, 0.18].forEach((x) => group.add(createBox([0.2, 0.18, 0.58], [x, 0.42, 0], "#8d1b1f")));
  return group;
}

function createObstacleModel() {
  const group = new THREE.Group();
  group.rotation.y = Math.PI / 8;
  group.add(createBox([0.72, 0.08, 0.72], [0, 0.08, 0], "#5c3a1e"));
  group.add(createBox([0.48, 0.42, 0.48], [-0.14, 0.32, 0.05], OBSTACLE_COLOR));
  group.add(createBox([0.36, 0.36, 0.42], [0.18, 0.52, -0.12], "#a45b24"));
  return group;
}

function createLoadingPad() {
  const group = new THREE.Group();
  group.add(createBox([0.82, 0.08, 0.82], [0, 0.08, 0], "#050505"));
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.035, 8, 36),
    new THREE.MeshBasicMaterial({ color: ACCENT_COLOR }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.14;
  group.add(ring);
  return group;
}

function createTargetPad() {
  const group = new THREE.Group();
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 32), createMaterial(ACCENT_COLOR));
  cylinder.position.y = 0.1;
  group.add(cylinder);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 32), new THREE.MeshBasicMaterial({ color: "#111111" }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.16;
  group.add(ring);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 24), createMaterial("#111111"));
  cone.position.y = 0.42;
  cone.castShadow = true;
  group.add(cone);
  return group;
}

function createSelectionRing(point: Point) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 8, 48), new THREE.MeshBasicMaterial({ color: ACCENT_COLOR }));
  ring.rotation.x = Math.PI / 2;
  ring.position.copy(scenePosition(point, 0.12));
  return ring;
}

function createTaskMarker(marker: RobotTaskMarker, index: number) {
  const group = new THREE.Group();
  group.position.copy(scenePosition(marker.point, 0.88));
  group.position.x += -0.28 + index * 0.28;
  group.position.z -= 0.28;

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.05, 18),
    createMaterial(marker.selected ? ACCENT_COLOR : "#ffffff"),
  );
  group.add(base);

  const iconGeometry = marker.role === "target"
    ? new THREE.TorusGeometry(0.1, 0.025, 8, 24)
    : new THREE.ConeGeometry(0.1, 0.2, 18);
  const icon = new THREE.Mesh(iconGeometry, createMaterial("#111111"));
  icon.position.y = 0.12;
  if (marker.role === "target") icon.rotation.x = Math.PI / 2;
  group.add(icon);

  const label = createTextSprite(marker.label, "#000000", marker.selected ? ACCENT_COLOR : "#ffffff");
  label.position.y = 0.38;
  group.add(label);
  return group;
}

function createExpansionOverlay(point: Point, expansion: ExpansionState3D) {
  const group = new THREE.Group();
  if (expansion.outbound) {
    group.add(createFlatPlane([0.82, 0.82], point, ACCENT_COLOR, expansion.currentPhase === "outbound" ? 0.62 : 0.28, 0.065));
  }
  if (expansion.returning) {
    const returning = createFlatPlane([0.58, 0.58], point, "#111111", expansion.currentPhase === "return" ? 0.58 : 0.32, 0.075);
    returning.rotation.z = Math.PI / 4;
    group.add(returning);
  }
  if (expansion.currentPhase) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.44, 0.025, 8, 40),
      new THREE.MeshBasicMaterial({ color: expansion.currentPhase === "return" ? "#111111" : ACCENT_COLOR }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(scenePosition(point, 0.1));
    group.add(ring);
  }
  return group;
}

function createTile(point: Point, cell: CellType) {
  const color = cell === 0 ? FLOOR_COLOR : "#dedede";
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.035, 0.96), createMaterial(color, { roughness: 0.85 }));
  mesh.position.copy(scenePosition(point, 0));
  mesh.receiveShadow = true;
  mesh.userData.point = point;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: "#c9c9c9" }),
  );
  edges.position.copy(mesh.position);
  edges.position.y += 0.02;
  const group = new THREE.Group();
  group.add(mesh, edges);
  return { group, mesh };
}

function createRobotModel(robot: RobotPosition3D, robotColors: readonly (readonly [string, string])[]) {
  const robotIndex = robot.robotIndex ?? 0;
  const color = getRobotColor(robotColors, robotIndex, robot.phase ?? "outbound");
  const group = new THREE.Group();
  group.position.copy(scenePosition(robot.point, 0.18));
  group.name = "scene3d-robot";
  group.userData.robotId = robot.id;

  group.add(createBox([0.62, 0.24, 0.48], [0, 0.16, 0], color, { metalness: 0.12, roughness: 0.45 }));
  group.add(createBox([0.26, 0.18, 0.36], [0.16, 0.34, 0], "#101010", { roughness: 0.45 }));

  [-0.32, 0.34].forEach((x) => {
    [-0.16, 0.16].forEach((z) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 18), createMaterial("#050505"));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.14, z);
      wheel.castShadow = true;
      group.add(wheel);
    });
  });

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 18), new THREE.MeshBasicMaterial({ color }));
  beacon.position.set(0, 0.58, 0);
  group.add(beacon);

  const label = createTextSprite(compactRobotId(robot.id), color === "#000000" ? "#ffffff" : "#000000", color);
  label.position.set(0, 0.9, 0);
  group.add(label);

  if (robot.waiting) {
    const waitLabel = createTextSprite("Ⅱ", "#000000", "#ffffff");
    waitLabel.position.set(0, 1.25, 0);
    group.add(waitLabel);
  }
  return group;
}

function createRouteLine(route: SceneRoute3D, robotColors: readonly (readonly [string, string])[]) {
  const uniquePoints = route.points.filter((point, index) => index === 0 || pointKey(point) !== pointKey(route.points[index - 1]));
  if (uniquePoints.length < 2) return null;
  const color = route.robotIndex === undefined
    ? (route.phase === "return" ? "#000000" : ACCENT_COLOR)
    : getRobotColor(robotColors, route.robotIndex, route.phase);
  const geometry = new THREE.BufferGeometry().setFromPoints(uniquePoints.map((point) => scenePosition(point, 0.16)));
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
}

function hasGeometry(object: THREE.Object3D): object is THREE.Object3D & { geometry: THREE.BufferGeometry } {
  const candidate = object as THREE.Object3D & { geometry?: unknown };
  return candidate.geometry instanceof THREE.BufferGeometry;
}

function hasMaterial(object: THREE.Object3D): object is THREE.Object3D & { material: THREE.Material | THREE.Material[] } {
  const candidate = object as THREE.Object3D & { material?: unknown };
  return candidate.material instanceof THREE.Material || Array.isArray(candidate.material);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (hasGeometry(child)) child.geometry.dispose();
    if (hasMaterial(child)) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function rebuildWarehouse(context: ThreeContext, props: Scene3DProps) {
  disposeObject(context.warehouseGroup);
  context.warehouseGroup.clear();
  context.floorMeshes = [];
  context.warehouseGroup.position.set(-props.cols / 2, 0, -props.rows / 2);

  const base = createBox([props.cols + 0.4, 0.04, props.rows + 0.4], [props.cols / 2, -0.04, props.rows / 2], "#e5e5e5", { roughness: 0.9 });
  base.castShadow = false;
  context.warehouseGroup.add(base);

  const selectedKeys = new Set(props.taskMarkers.filter((marker) => marker.selected).map((marker) => pointKey(marker.point)));
  const markersByPoint = new Map<string, RobotTaskMarker[]>();
  props.taskMarkers.forEach((marker) => {
    const key = pointKey(marker.point);
    markersByPoint.set(key, [...(markersByPoint.get(key) ?? []), marker]);
  });

  props.grid.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const point: Point = [rowIndex, colIndex];
      const key = pointKey(point);
      const { group, mesh } = createTile(point, cell);
      context.floorMeshes.push(mesh);
      context.warehouseGroup.add(group);

      const cellGroup = new THREE.Group();
      cellGroup.position.copy(scenePosition(point, 0));
      if (cell === 1) cellGroup.add(createRackModel());
      if (cell === 2) cellGroup.add(createObstacleModel());
      if (cell === 3) cellGroup.add(createLoadingPad());
      if (cell === 4) cellGroup.add(createTargetPad());
      context.warehouseGroup.add(cellGroup);

      const expansion = props.expansions.get(key);
      if (expansion) context.warehouseGroup.add(createExpansionOverlay(point, expansion));
      if (selectedKeys.has(key)) context.warehouseGroup.add(createSelectionRing(point));
      (markersByPoint.get(key) ?? []).forEach((marker, index) => context.warehouseGroup.add(createTaskMarker(marker, index)));
    });
  });

  props.routes.forEach((route) => {
    const line = createRouteLine(route, props.robotColors);
    if (line) context.warehouseGroup.add(line);
  });
  props.robots.forEach((robot) => context.warehouseGroup.add(createRobotModel(robot, props.robotColors)));
}

function createThreeContext(container: HTMLDivElement, props: Scene3DProps, preset: CameraPreset, onFailure: (message: string) => void): ThreeContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f7f7f7");

  const camera = new THREE.PerspectiveCamera(42, Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1), 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.domElement.className = "scene3d-canvas";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 55;
  controls.maxPolarAngle = Math.PI / 2.05;

  const warehouseGroup = new THREE.Group();
  scene.add(warehouseGroup);
  scene.add(new THREE.AmbientLight("#ffffff", 0.82));
  const sun = new THREE.DirectionalLight("#ffffff", 1.18);
  sun.position.set(5, 14, 8);
  sun.castShadow = true;
  scene.add(sun);

  const context: ThreeContext = { scene, camera, renderer, controls, warehouseGroup, floorMeshes: [], frameId: 0, resizeObserver: null };
  applyCameraPreset(context, preset);
  rebuildWarehouse(context, props);

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  context.resizeObserver = new ResizeObserver(resize);
  context.resizeObserver.observe(container);

  const renderLoop = () => {
    controls.update();
    renderer.render(scene, camera);
    context.frameId = window.requestAnimationFrame(renderLoop);
  };
  renderLoop();

  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    onFailure("浏览器 WebGL 上下文丢失，已切换到备用 3D 点选层。请刷新页面或减少同时打开的 3D 页面。");
  });
  return context;
}

function destroyThreeContext(context: ThreeContext, container: HTMLDivElement | null) {
  window.cancelAnimationFrame(context.frameId);
  context.resizeObserver?.disconnect();
  context.controls.dispose();
  disposeObject(context.warehouseGroup);
  context.scene.clear();
  context.renderer.dispose();
  if (container?.contains(context.renderer.domElement)) container.removeChild(context.renderer.domElement);
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
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(() => (
    hasWebGlSupport() ? null : "浏览器没有创建 WebGL 上下文，已切换到备用 3D 点选层。请检查浏览器硬件加速或 WebGL 设置。"
  ));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef<ThreeContext | null>(null);
  const propsRef = useRef(props);

  propsRef.current = props;

  useEffect(() => {
    if (fallbackMessage || !containerRef.current) return undefined;
    try {
      const context = createThreeContext(containerRef.current, propsRef.current, preset, setFallbackMessage);
      contextRef.current = context;
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const onPointerDown = (event: PointerEvent) => {
        const rect = context.renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, context.camera);
        const hit = raycaster.intersectObjects(context.floorMeshes, false)[0];
        const point = hit?.object.userData.point;
        if (Array.isArray(point) && point.length === 2) propsRef.current.onCellClick([Number(point[0]), Number(point[1])]);
      };
      context.renderer.domElement.addEventListener("pointerdown", onPointerDown);
      return () => {
        context.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        destroyThreeContext(context, containerRef.current);
        contextRef.current = null;
      };
    } catch (error) {
      console.error("3D 仓库视图初始化失败，已切换到备用视图", error);
      setFallbackMessage("3D 渲染初始化失败，已自动切换到备用点选层。请刷新页面；如果仍然出现，请把控制台错误发给我。");
      return undefined;
    }
  }, [fallbackMessage, preset]);

  useEffect(() => {
    const context = contextRef.current;
    if (!context || fallbackMessage) return;
    try {
      rebuildWarehouse(context, props);
    } catch (error) {
      console.error("3D 仓库视图刷新失败，已切换到备用视图", error);
      setFallbackMessage("3D 渲染刷新失败，已自动切换到备用点选层。请刷新页面；如果仍然出现，请把控制台错误发给我。");
    }
  }, [props.grid, props.rows, props.cols, props.mode, props.selectedRobot, props.taskMarkers, props.robots, props.routes, props.expansions, props.robotColors, fallbackMessage]);

  useEffect(() => {
    const context = contextRef.current;
    if (context) applyCameraPreset(context, preset);
  }, [preset]);

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
    {fallbackMessage
      ? <Scene3DFallback {...props} message={fallbackMessage} />
      : <div ref={containerRef} className="scene3d-canvas" role="presentation" />}
    <div className="scene3d-credit">模型：程序化仓库资产；可替换为 CC BY / CC0 GLB 模型</div>
  </section>;
}
