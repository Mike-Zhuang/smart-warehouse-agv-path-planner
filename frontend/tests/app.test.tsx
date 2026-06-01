import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
          fullPath: [[19, 1], [18, 1], [19, 1]],
          outbound: { found: true, message: "Path found", path: [[19, 1], [18, 1]], pathCost: 2, expandedCount: 2, expandedOrder: [[19, 1], [18, 1]] },
          returnTrip: { found: true, message: "Path found", path: [[18, 1], [19, 1]], pathCost: 2, expandedCount: 2, expandedOrder: [[18, 1], [19, 1]] },
        }),
      }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "运行路径规划" }));
    await waitFor(() => expect(screen.getByText("路线方向")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "立即显示完整路线" }));
    expect(document.querySelectorAll(".route-marker").length).toBeGreaterThan(0);
  });

  it("shows CBS onboarding guide", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "CBS 多车" }));
    expect(screen.getByText("CBS 多车怎么用？")).toBeTruthy();
    expect(screen.getByText("一键加载交叉口示例")).toBeTruthy();
  });
});
