/**
 * Pure helper functions for building agent run reflections.
 * Extracted from heartbeat.ts for testability.
 */

export function extractRunSummary(resultJson: Record<string, unknown> | null): string {
  if (!resultJson) return "No summary recorded";
  const text = resultJson.result ?? resultJson.summary ?? resultJson.message;
  if (typeof text !== "string") return "No summary recorded";
  return text.length > 120 ? text.slice(0, 117) + "..." : text;
}

export function extractRunCost(resultJson: Record<string, unknown> | null): number | null {
  if (!resultJson) return null;
  for (const key of ["total_cost_usd", "cost_usd", "costUsd"] as const) {
    const val = resultJson[key];
    if (typeof val === "number" && val > 0) return val;
  }
  return null;
}

export function formatTimeAgo(ms: number): string {
  if (ms <= 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return remainSecs > 0 ? `${mins}m${remainSecs}s` : `${mins}m`;
}

export function classifyPattern(
  runs: { status: string; exitCode: number | null; resultJson: Record<string, unknown> | null }[],
): string {
  const last3 = runs.slice(0, 3);
  if (last3.length < 3) return "What could you do to make the most progress right now?";

  // 1. Errors
  if (last3.some((r) => r.status === "failed")) {
    return "What went wrong? What would you do differently to avoid this failure?";
  }

  const summaries = last3.map((r) => extractRunSummary(r.resultJson).toLowerCase());

  // 2. Repeated blocker
  const blockedCount = summaries.filter((s) => s.includes("blocked") || s.includes("waiting for")).length;
  if (blockedCount >= 2) {
    return "What are you assuming you cannot do, that you actually can? How could you work around this blocker?";
  }

  // 3. Idle / no work
  const idleKeywords = ["no assignments", "nothing to do", "clean exit", "no work"];
  const idleCount = summaries.filter((s) => idleKeywords.some((kw) => s.includes(kw))).length;
  if (idleCount >= 2) {
    return "How could you be more proactive? What work could you create, propose, or pick up without being asked?";
  }

  // 4. Rising cost (requires 5 runs with valid cost data)
  if (runs.length >= 5) {
    const costOf = (r: { resultJson: Record<string, unknown> | null }) => extractRunCost(r.resultJson);
    const recent3Costs = last3.map(costOf).filter((c): c is number => c !== null);
    const older2Costs = runs.slice(3, 5).map(costOf).filter((c): c is number => c !== null);
    if (recent3Costs.length === 3 && older2Costs.length === 2) {
      const avgRecent = recent3Costs.reduce((a, b) => a + b, 0) / 3;
      const avgOlder = older2Costs.reduce((a, b) => a + b, 0) / 2;
      if (avgOlder > 0 && avgRecent > 2 * avgOlder) {
        return "How could you achieve the same result more efficiently?";
      }
    }
  }

  // 5. Productive streak
  if (last3.every((r) => r.status === "succeeded")) {
    return "What could you have done even better? What opportunities did you miss?";
  }

  // 6. Default
  return "What could you do to make the most progress right now?";
}
