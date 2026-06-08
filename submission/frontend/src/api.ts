import type { PlannerRequest, SampleMap } from "./types";

function formatErrorDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (item && typeof item === "object" && "msg" in item) {
        const location = "loc" in item && Array.isArray(item.loc) ? item.loc.join(".") : "";
        return `${location ? `${location}: ` : ""}${String(item.msg)}`;
      }
      return formatErrorDetail(item);
    }).join("；");
  }
  if (detail && typeof detail === "object") {
    if ("message" in detail) return formatErrorDetail(detail.message);
    if ("msg" in detail) return formatErrorDetail(detail.msg);
    return JSON.stringify(detail);
  }
  return "请求失败";
}

async function parseResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(formatErrorDetail(body.detail ?? body.message ?? body));
  return body;
}

export async function fetchSamples(): Promise<SampleMap[]> {
  return parseResponse(await fetch("/api/sample-maps"));
}

export async function runPlanner(request: PlannerRequest) {
  return parseResponse(
    await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}
