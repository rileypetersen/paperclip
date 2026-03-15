import { describe, expect, it } from "vitest";
import {
  extractRunSummary,
  extractRunCost,
  formatTimeAgo,
  formatDuration,
  classifyPattern,
} from "../services/heartbeat-reflection.ts";

describe("extractRunSummary", () => {
  it("returns fallback for null input", () => {
    expect(extractRunSummary(null)).toBe("No summary recorded");
  });

  it("returns fallback for empty object", () => {
    expect(extractRunSummary({})).toBe("No summary recorded");
  });

  it("extracts from result field", () => {
    expect(extractRunSummary({ result: "Completed task PAP-42" })).toBe("Completed task PAP-42");
  });

  it("extracts from summary field", () => {
    expect(extractRunSummary({ summary: "Reviewed 3 PRs" })).toBe("Reviewed 3 PRs");
  });

  it("extracts from message field", () => {
    expect(extractRunSummary({ message: "No work found" })).toBe("No work found");
  });

  it("prefers result over summary", () => {
    expect(extractRunSummary({ result: "A", summary: "B" })).toBe("A");
  });

  it("truncates to 120 chars", () => {
    const long = "x".repeat(200);
    const result = extractRunSummary({ result: long });
    expect(result.length).toBe(120);
    expect(result).toBe("x".repeat(117) + "...");
  });

  it("does not truncate at exactly 120", () => {
    const exact = "y".repeat(120);
    expect(extractRunSummary({ result: exact })).toBe(exact);
  });

  it("ignores non-string values", () => {
    expect(extractRunSummary({ result: 42 })).toBe("No summary recorded");
  });
});

describe("extractRunCost", () => {
  it("returns null for null input", () => {
    expect(extractRunCost(null)).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(extractRunCost({})).toBeNull();
  });

  it("extracts total_cost_usd", () => {
    expect(extractRunCost({ total_cost_usd: 0.42 })).toBe(0.42);
  });

  it("extracts cost_usd", () => {
    expect(extractRunCost({ cost_usd: 1.23 })).toBe(1.23);
  });

  it("extracts costUsd", () => {
    expect(extractRunCost({ costUsd: 0.05 })).toBe(0.05);
  });

  it("prefers total_cost_usd over others", () => {
    expect(extractRunCost({ total_cost_usd: 1, cost_usd: 2, costUsd: 3 })).toBe(1);
  });

  it("returns null for zero cost", () => {
    expect(extractRunCost({ total_cost_usd: 0 })).toBeNull();
  });

  it("returns null for negative cost", () => {
    expect(extractRunCost({ total_cost_usd: -1 })).toBeNull();
  });

  it("returns null for non-number cost", () => {
    expect(extractRunCost({ total_cost_usd: "0.42" })).toBeNull();
  });
});

describe("formatTimeAgo", () => {
  it("returns 'just now' for zero", () => {
    expect(formatTimeAgo(0)).toBe("just now");
  });

  it("returns 'just now' for negative", () => {
    expect(formatTimeAgo(-1000)).toBe("just now");
  });

  it("formats minutes", () => {
    expect(formatTimeAgo(5 * 60_000)).toBe("5m ago");
    expect(formatTimeAgo(59 * 60_000)).toBe("59m ago");
  });

  it("formats hours", () => {
    expect(formatTimeAgo(60 * 60_000)).toBe("1h ago");
    expect(formatTimeAgo(23 * 60 * 60_000)).toBe("23h ago");
  });

  it("formats days", () => {
    expect(formatTimeAgo(24 * 60 * 60_000)).toBe("1d ago");
    expect(formatTimeAgo(72 * 60 * 60_000)).toBe("3d ago");
  });
});

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("formats minutes without remainder", () => {
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("formats minutes with seconds", () => {
    expect(formatDuration(90_000)).toBe("1m30s");
    expect(formatDuration(185_000)).toBe("3m5s");
  });
});

describe("classifyPattern", () => {
  const run = (
    status: string,
    resultJson: Record<string, unknown> | null = null,
    exitCode: number | null = null,
  ) => ({ status, exitCode, resultJson });

  it("returns default for fewer than 3 runs", () => {
    expect(classifyPattern([run("succeeded"), run("succeeded")])).toBe(
      "What could you do to make the most progress right now?",
    );
  });

  it("detects failures", () => {
    const runs = [run("failed"), run("succeeded"), run("succeeded")];
    expect(classifyPattern(runs)).toContain("What went wrong?");
  });

  it("detects repeated blockers", () => {
    const runs = [
      run("succeeded", { result: "Blocked on credentials" }),
      run("succeeded", { result: "Still blocked on API key" }),
      run("succeeded", { result: "Completed other work" }),
    ];
    expect(classifyPattern(runs)).toContain("work around this blocker");
  });

  it("detects repeated idle", () => {
    const runs = [
      run("succeeded", { result: "No assignments found" }),
      run("succeeded", { result: "Nothing to do, clean exit" }),
      run("succeeded", { result: "Worked on task" }),
    ];
    expect(classifyPattern(runs)).toContain("more proactive");
  });

  it("detects rising cost with 5 runs", () => {
    const runs = [
      run("succeeded", { cost_usd: 3.0 }),
      run("succeeded", { cost_usd: 3.5 }),
      run("succeeded", { cost_usd: 4.0 }),
      run("succeeded", { cost_usd: 0.5 }),
      run("succeeded", { cost_usd: 0.6 }),
    ];
    expect(classifyPattern(runs)).toContain("more efficiently");
  });

  it("does not trigger rising cost when ratio is under 2x", () => {
    const runs = [
      run("succeeded", { cost_usd: 1.0 }),
      run("succeeded", { cost_usd: 1.0 }),
      run("succeeded", { cost_usd: 1.0 }),
      run("succeeded", { cost_usd: 0.8 }),
      run("succeeded", { cost_usd: 0.9 }),
    ];
    // Avg recent = 1.0, avg older = 0.85, ratio ~1.18 < 2
    expect(classifyPattern(runs)).not.toContain("more efficiently");
  });

  it("detects productive streak", () => {
    const runs = [
      run("succeeded", { result: "Shipped feature X" }),
      run("succeeded", { result: "Fixed bug Y" }),
      run("succeeded", { result: "Reviewed PR Z" }),
    ];
    expect(classifyPattern(runs)).toContain("even better");
  });
});
