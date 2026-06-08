import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the warehouse editor and switches display mode", () => {
    render(<App />);
    expect(screen.getByText("仓库网格地图")).toBeTruthy();
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe("https://github.com/Mike-Zhuang/smart-warehouse-agv-path-planner");
    const filingLink = screen.getByRole("link", { name: "沪ICP备2026015123号" });
    expect(filingLink.getAttribute("href")).toBe("https://beian.miit.gov.cn/");
    expect(filingLink.querySelector("img")).toBeNull();
    expect(screen.queryByText("C++ CORE ONLINE")).toBeNull();
    expect(screen.queryByText("DATA STRUCTURES × PATH PLANNING")).toBeNull();
    expect(screen.queryByText("SMART WAREHOUSE AGV PATH PLANNER · C++ CORE / FASTAPI / REACT")).toBeNull();
    expect(screen.getByRole("button", { name: "图标" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "图标" }));
    expect(screen.getByRole("button", { name: "数字" })).toBeTruthy();
  });

  it("switches to the 3D warehouse view and edits through the fallback picking layer", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "3D 仓库" }));
    expect(await screen.findByLabelText("Three.js 3D 仓库视图")).toBeTruthy();
    expect(await screen.findByLabelText("3D 仓库备用视图")).toBeTruthy();
    expect(screen.getByText("重置视角")).toBeTruthy();
    expect(screen.queryByText("模型：程序化仓库资产；可替换为 CC BY / CC0 GLB 模型")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /2 障碍/ }));
    fireEvent.click(await screen.findByTitle("3D [1, 0]"));
    fireEvent.click(screen.getByRole("button", { name: "2D 平面" }));
    expect(screen.getByTitle("[1, 0] 障碍")).toBeTruthy();
  });

  it("sets CBS task points from the 3D fallback picking layer", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.click(screen.getByRole("button", { name: "3D 仓库" }));
    fireEvent.click(await screen.findByTitle("3D [2, 0]"));
    expect(screen.getByText("S1")).toBeTruthy();
    expect(document.querySelector(".point-select-hint strong")?.textContent).toBe("目标点");
    fireEvent.click(await screen.findByTitle("3D [2, 1]"));
    expect(screen.getByText("T1")).toBeTruthy();
  });

  it("shows robots and search expansion data in the 3D fallback view", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true, message: "Round trip path found", totalCost: 2, totalExpandedCount: 2,
          fullPath: [[0, 0], [0, 1], [0, 0]],
          outbound: { found: true, message: "Path found", path: [[0, 0], [0, 1]], pathCost: 1, expandedCount: 1, expandedOrder: [[0, 0]], searchTrace: [{ point: [0, 0], gCost: 0, hCost: 1, fCost: 1 }] },
          returnTrip: { found: true, message: "Path found", path: [[0, 1], [0, 0]], pathCost: 1, expandedCount: 1, expandedOrder: [[0, 1]], searchTrace: [{ point: [0, 1], gCost: 0, hCost: 1, fCost: 1 }] },
        }),
      }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(screen.getByText("路线方向")).toBeTruthy());
    expect(screen.getByText("路径长度")).toBeTruthy();
    expect(screen.getByText("搜索节点数")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "3D 仓库" }));
    const expandedCell = await screen.findByTitle("3D [0, 0]");
    expect(expandedCell.getAttribute("data-expansion")).toBe("true");
    expect(within(expandedCell).getByText("01")).toBeTruthy();
  });

  it("renders directional route markers after planning", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true, message: "Round trip path found", totalCost: 4, totalExpandedCount: 4,
          fullPath: [[5, 5], [4, 5], [3, 6], [3, 7], [4, 8], [5, 8], [6, 7], [6, 6], [5, 5]],
          outbound: { found: true, message: "Path found", path: [[5, 5], [4, 5], [3, 6], [3, 7], [4, 8]], pathCost: 8, expandedCount: 1, expandedOrder: [[5, 5]], searchTrace: [{ point: [5, 5], gCost: 0, hCost: 7, fCost: 7 }] },
          returnTrip: { found: true, message: "Path found", path: [[4, 8], [5, 8], [6, 7], [6, 6], [5, 5]], pathCost: 8, expandedCount: 0, expandedOrder: [], searchTrace: [] },
        }),
      }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(screen.getByText("路线方向")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "立即显示完整路线" }));
    expect(document.querySelectorAll(".route-marker").length).toBeGreaterThan(0);
    const directions = Array.from(document.querySelectorAll("[data-direction]")).map((marker) => marker.getAttribute("data-direction"));
    expect(new Set(directions)).toEqual(new Set(["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"]));
    expect(screen.getByText("算法观察")).toBeTruthy();
    expect(screen.getByText("f = g + h")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "曲线" }));
    expect(screen.getByLabelText("曲线路径")).toBeTruthy();
  });

  it("shows CBS onboarding guide", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    expect(screen.getByText("CBS 多车怎么用？")).toBeTruthy();
    expect(screen.getByText("一键加载交叉口示例")).toBeTruthy();
  });

  it("shows CBS start and target markers while editing", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.mouseDown(screen.getByTitle("[1, 0] 通道"));
    expect(within(screen.getByTitle("[1, 0] 通道")).getByText("S1")).toBeTruthy();
    expect(document.querySelector(".point-select-hint strong")?.textContent).toBe("目标点");
    fireEvent.mouseDown(screen.getByTitle("[1, 1] 通道"));
    expect(within(screen.getByTitle("[1, 1] 通道")).getByText("T1")).toBeTruthy();
  });

  it("allows painting obstacles while editing the CBS warehouse grid", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑仓库底图" }));
    fireEvent.click(screen.getByRole("button", { name: /2 障碍/ }));
    fireEvent.mouseDown(screen.getByTitle("[1, 0] 通道"));
    expect(screen.getByTitle("[1, 0] 障碍")).toBeTruthy();
  });

  it("keeps CBS robot endpoints safe from manual and random obstacles", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑仓库底图" }));
    fireEvent.click(screen.getByRole("button", { name: /2 障碍/ }));
    fireEvent.mouseDown(screen.getByTitle("[0, 0] 通道"));
    expect(screen.getByText("不能在已有 AGV 起点或目标点上绘制货架或障碍物")).toBeTruthy();
    expect(screen.getByTitle("[0, 0] 通道")).toBeTruthy();
    fireEvent.click(screen.getByText("随机障碍"));
    expect(screen.getByTitle("[0, 0] 通道")).toBeTruthy();
    expect(screen.getByTitle("[0, 1] 通道")).toBeTruthy();
  });

  it("renders backend object errors as readable messages", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ detail: [{ loc: ["body", "grid"], msg: "地图不能为空" }] }) }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(screen.getByText("body.grid: 地图不能为空")).toBeTruthy());
    expect(screen.queryByText("[object Object]")).toBeNull();
  });

  it("rejects CBS task points on shelves", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /1 货架/ }));
    fireEvent.mouseDown(screen.getByTitle("[1, 0] 通道"));
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.mouseDown(screen.getByTitle("[1, 0] 货架"));
    expect(screen.getByText("AGV 起点或目标点不能设置在货架或障碍物上")).toBeTruthy();
  });

  it("adds a round-trip AGV and starts editing its loading point", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    const idInput = screen.getByLabelText("agv-02 编号");
    const row = idInput.closest(".robot-row");
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByRole("checkbox").hasAttribute("checked")).toBe(true);
    expect(document.querySelector(".point-select-hint strong")?.textContent).toBe("起点");
  });

  it("renders a pause marker for CBS waiting actions", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true, message: "Conflict-free paths found", totalCost: 3, resolvedConflictCount: 1,
          robots: [{ id: "agv-01", timeline: [[0, 0], [0, 0], [0, 1]], pathCost: 2, returnStartTimeStep: null }],
        }),
      }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(screen.getByText("多车轨迹")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "立即显示完整路线" }));
    expect(document.querySelector('[data-direction="wait"]')).toBeTruthy();
  });

  it("shows optional Manhattan heatmap values", () => {
    render(<App />);
    expect(document.querySelector(".heatmap-value")).toBeNull();
    const heatmapToggle = screen.getByRole("checkbox", { name: "显示曼哈顿热力层" });
    fireEvent.click(heatmapToggle);
    expect(document.querySelector(".heatmap-value")?.textContent).toMatch(/^h\d+$/);
    expect(document.querySelectorAll(".grid-cell .heatmap-value .heatmap-value")).toHaveLength(0);
    fireEvent.click(heatmapToggle);
    expect(document.querySelector(".heatmap-value")).toBeNull();
    fireEvent.click(heatmapToggle);
    expect(document.querySelectorAll(".grid-cell .heatmap-value").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".grid-cell .heatmap-value .heatmap-value")).toHaveLength(0);
  });

  it("keeps return expansion visible when it overlaps outbound expansion", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true, message: "Round trip path found", totalCost: 2, totalExpandedCount: 2,
          fullPath: [[0, 0], [0, 1], [0, 0]],
          outbound: { found: true, message: "Path found", path: [[0, 0], [0, 1]], pathCost: 1, expandedCount: 1, expandedOrder: [[0, 0]], searchTrace: [{ point: [0, 0], gCost: 0, hCost: 1, fCost: 1 }] },
          returnTrip: { found: true, message: "Path found", path: [[0, 1], [0, 0]], pathCost: 1, expandedCount: 1, expandedOrder: [[0, 0]], searchTrace: [{ point: [0, 0], gCost: 1, hCost: 0, fCost: 1 }] },
        }),
      }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(document.querySelector('[data-expansion-phase="return"]')).toBeTruthy());
    const cell = screen.getByTitle("[0, 0] 通道");
    expect(cell.querySelector('[data-expansion-phase="outbound"]')).toBeTruthy();
    expect(cell.querySelector('[data-expansion-phase="return"]')).toBeTruthy();
    expect(cell.querySelector(".return-expansion.current-expansion")).toBeTruthy();
  });

  it("uses separate outbound and return colors for each CBS robot", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true, message: "Conflict-free paths found", totalCost: 4, resolvedConflictCount: 1,
          robots: [
            { id: "agv-01", timeline: [[0, 0], [0, 1], [0, 0]], pathCost: 2, returnStartTimeStep: 1 },
            { id: "agv-02", timeline: [[1, 0], [1, 1], [1, 0]], pathCost: 2, returnStartTimeStep: 1 },
          ],
        }),
      }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(screen.getByText("多车轨迹")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "立即显示完整路线" }));
    const colors = new Set(Array.from(document.querySelectorAll<HTMLElement>(".route-marker")).map((marker) => marker.style.color));
    expect(colors).toEqual(new Set(["rgb(118, 185, 0)", "rgb(53, 84, 0)", "rgb(91, 168, 255)", "rgb(23, 79, 145)"]));
  });
});
