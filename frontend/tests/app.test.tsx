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
    expect(screen.getByText("WAREHOUSE GRID")).toBeTruthy();
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe("https://github.com/Mike-Zhuang/smart-warehouse-agv-path-planner");
    expect(screen.queryByText("SMART WAREHOUSE AGV PATH PLANNER · C++ CORE / FASTAPI / REACT")).toBeNull();
    expect(screen.getByRole("button", { name: "图标" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "图标" }));
    expect(screen.getByRole("button", { name: "数字" })).toBeTruthy();
  });

  it("renders directional route markers after planning", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true, message: "Round trip path found", totalCost: 4, totalExpandedCount: 4,
          fullPath: [[5, 5], [4, 5], [3, 6], [3, 7], [4, 8], [5, 8], [6, 7], [6, 6], [5, 5]],
          outbound: { found: true, message: "Path found", path: [[5, 5], [4, 5], [3, 6], [3, 7], [4, 8]], pathCost: 8, expandedCount: 0, expandedOrder: [] },
          returnTrip: { found: true, message: "Path found", path: [[4, 8], [5, 8], [6, 7], [6, 6], [5, 5]], pathCost: 8, expandedCount: 0, expandedOrder: [] },
        }),
      }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(screen.getByText("路线方向")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "立即显示完整路线" }));
    expect(document.querySelectorAll(".route-marker").length).toBeGreaterThan(0);
    const directions = Array.from(document.querySelectorAll("[data-direction]")).map((marker) => marker.getAttribute("data-direction"));
    expect(new Set(directions)).toEqual(new Set(["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"]));
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
          robots: [{ id: "agv-01", timeline: [[0, 0], [0, 0], [0, 1]], pathCost: 2 }],
        }),
      }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(screen.getByText("多车轨迹")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "立即显示完整路线" }));
    expect(document.querySelector('[data-direction="wait"]')).toBeTruthy();
  });
});
