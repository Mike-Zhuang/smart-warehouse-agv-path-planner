import type { PlannerRequest, SampleMap } from "./types";

async function parseResponse(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail ?? body.message ?? "请求失败");
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
