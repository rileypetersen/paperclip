import { describe, expect, it, vi, beforeEach } from "vitest";
import { runStalledCheck, resetStalledState, type StalledDeps } from "../src/stalled.js";

function createMockDeps(overrides: Partial<StalledDeps> = {}): StalledDeps {
  const state = new Map<string, unknown>();
  return {
    getState: vi.fn(async (scopeKind, scopeId, stateKey) => {
      return state.get(`${scopeKind}|${scopeId}|${stateKey}`) ?? null;
    }),
    setState: vi.fn(async (scopeKind, scopeId, stateKey, value) => {
      state.set(`${scopeKind}|${scopeId}|${stateKey}`, value);
    }),
    listCompanies: vi.fn(async () => [{ id: "comp-1", name: "CivBid" }]),
    listIssues: vi.fn(async () => []),
    listComments: vi.fn(async () => []),
    onStalled: vi.fn(async () => {}),
    now: () => new Date("2026-03-18T12:00:00.000Z"),
    ...overrides,
  };
}

describe("runStalledCheck", () => {
  it("fires webhook for a stalled issue", async () => {
    const fourHoursAgo = "2026-03-18T08:00:00.000Z";
    const deps = createMockDeps({
      listIssues: vi.fn(async () => [
        { id: "iss-1", title: "Stale task", status: "in_progress", priority: "high", updatedAt: fourHoursAgo, companyId: "comp-1" },
      ]),
      listComments: vi.fn(async () => []),
    });

    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });

    expect(deps.onStalled).toHaveBeenCalledOnce();
    expect(deps.onStalled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "iss-1" }),
      "comp-1",
    );
  });

  it("does not fire for an active issue", async () => {
    const fiveMinutesAgo = "2026-03-18T11:55:00.000Z";
    const deps = createMockDeps({
      listIssues: vi.fn(async () => [
        { id: "iss-1", title: "Active", status: "in_progress", priority: "high", updatedAt: fiveMinutesAgo, companyId: "comp-1" },
      ]),
    });

    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });
    expect(deps.onStalled).not.toHaveBeenCalled();
  });

  it("fires at-most-once per stall window", async () => {
    const fourHoursAgo = "2026-03-18T08:00:00.000Z";
    const deps = createMockDeps({
      listIssues: vi.fn(async () => [
        { id: "iss-1", title: "Stale", status: "todo", priority: "low", updatedAt: fourHoursAgo, companyId: "comp-1" },
      ]),
    });

    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });
    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });

    expect(deps.onStalled).toHaveBeenCalledOnce();
  });

  it("resets and re-fires after issue activity recovers and re-stalls", async () => {
    const fourHoursAgo = "2026-03-18T08:00:00.000Z";
    const deps = createMockDeps({
      listIssues: vi.fn(async () => [
        { id: "iss-1", title: "Stale", status: "in_progress", priority: "low", updatedAt: fourHoursAgo, companyId: "comp-1" },
      ]),
    });

    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });
    expect(deps.onStalled).toHaveBeenCalledOnce();

    await resetStalledState(deps, "iss-1");

    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });
    expect(deps.onStalled).toHaveBeenCalledTimes(2);
  });

  it("considers latest comment time", async () => {
    const fourHoursAgo = "2026-03-18T08:00:00.000Z";
    const tenMinutesAgo = "2026-03-18T11:50:00.000Z";
    const deps = createMockDeps({
      listIssues: vi.fn(async () => [
        { id: "iss-1", title: "Task", status: "in_progress", priority: "low", updatedAt: fourHoursAgo, companyId: "comp-1" },
      ]),
      listComments: vi.fn(async () => [
        { createdAt: tenMinutesAgo },
      ]),
    });

    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });
    expect(deps.onStalled).not.toHaveBeenCalled();
  });

  it("uses companyFilter when set", async () => {
    const deps = createMockDeps();

    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: "comp-1" });

    expect(deps.listCompanies).not.toHaveBeenCalled();
    expect(deps.listIssues).toHaveBeenCalled();
  });

  it("checks issues across all active statuses", async () => {
    const deps = createMockDeps();

    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: "comp-1" });

    const statuses = (deps.listIssues as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>).status,
    );
    expect(statuses).toContain("todo");
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("in_review");
    expect(statuses).toContain("blocked");
  });

  it("recovers stalled state when issue becomes active again", async () => {
    const fourHoursAgo = "2026-03-18T08:00:00.000Z";
    const fiveMinutesAgo = "2026-03-18T11:55:00.000Z";
    const deps = createMockDeps({
      listIssues: vi.fn(async () => [
        { id: "iss-1", title: "Task", status: "in_progress", priority: "low", updatedAt: fourHoursAgo, companyId: "comp-1" },
      ]),
    });

    // First run: stalled
    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });
    expect(deps.onStalled).toHaveBeenCalledOnce();

    // Issue gets activity
    (deps.listIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "iss-1", title: "Task", status: "in_progress", priority: "low", updatedAt: fiveMinutesAgo, companyId: "comp-1" },
    ]);

    // Second run: recovered — should clear state
    await runStalledCheck(deps, { stalledThresholdMinutes: 60, companyFilter: undefined });

    // Verify setState was called to clear the stalled state
    const setStateCalls = (deps.setState as ReturnType<typeof vi.fn>).mock.calls;
    const resetCall = setStateCalls.find(
      (call: unknown[]) => (call[2] as string) === "stalled" && (call[3] as Record<string, unknown>).stalledSince === null,
    );
    expect(resetCall).toBeDefined();
  });
});

describe("resetStalledState", () => {
  it("clears stalled state for an issue", async () => {
    const deps = createMockDeps();
    await resetStalledState(deps, "iss-1");

    expect(deps.setState).toHaveBeenCalledWith("issue", "iss-1", "stalled", {
      stalledSince: null,
      alertedAt: null,
    });
  });
});
