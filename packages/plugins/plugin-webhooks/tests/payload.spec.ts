import { describe, expect, it } from "vitest";
import { formatPayload, sdkEventToWebhookNames, WEBHOOK_NAME_TO_CONFIG_KEY } from "../src/payload.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";

function baseEvent(overrides: Partial<PluginEvent> = {}): PluginEvent {
  return {
    eventId: "evt-1",
    eventType: "issue.created",
    companyId: "comp-1",
    occurredAt: "2026-03-18T12:00:00.000Z",
    actorId: "agent-1",
    actorType: "agent",
    entityId: "issue-1",
    entityType: "issue",
    payload: {},
    ...overrides,
  };
}

describe("formatPayload", () => {
  it("formats issue.created", async () => {
    const event = baseEvent({
      eventType: "issue.created",
      payload: { id: "issue-1", title: "Fix bug", status: "todo", priority: "high", companyId: "comp-1" },
    });
    const agentLookup = async () => ({ id: "agent-1", name: "Support", role: "engineer" });
    const companyLookup = async () => ({ id: "comp-1", name: "CivBid" });

    const result = await formatPayload(event, "issue.created", agentLookup, companyLookup);

    expect(result.event).toBe("issue.created");
    expect(result.timestamp).toBe("2026-03-18T12:00:00.000Z");
    expect(result.deliveryId).toBeTruthy();
    expect(result.company.name).toBe("CivBid");
    expect(result.data.issue).toBeDefined();
    expect(result.data.issue!.title).toBe("Fix bug");
    expect(result.data.comment).toBeNull();
  });

  it("formats issue.status_changed with previousStatus", async () => {
    const event = baseEvent({
      eventType: "issue.updated",
      payload: { id: "issue-1", title: "Fix bug", status: "blocked", priority: "high", _previous: { status: "in_progress" }, companyId: "comp-1" },
    });
    const result = await formatPayload(event, "issue.status_changed",
      async () => ({ id: "agent-1", name: "Support", role: "engineer" }),
      async () => ({ id: "comp-1", name: "CivBid" }),
    );
    expect(result.event).toBe("issue.status_changed");
    expect(result.data.issue!.previousStatus).toBe("in_progress");
  });

  it("formats issue.commented with comment data", async () => {
    const event = baseEvent({
      eventType: "issue.comment.created",
      payload: { issueId: "issue-1", issueTitle: "Fix bug", issueStatus: "in_progress", issuePriority: "medium", body: "Working on it", authorName: "Support", authorType: "agent", companyId: "comp-1" },
    });
    const result = await formatPayload(event, "issue.commented", async () => null, async () => ({ id: "comp-1", name: "CivBid" }));
    expect(result.event).toBe("issue.commented");
    expect(result.data.comment).toBeDefined();
    expect(result.data.comment!.body).toBe("Working on it");
    expect(result.data.comment!.authorName).toBe("Support");
  });

  it("formats approval.created", async () => {
    const event = baseEvent({
      eventType: "approval.created",
      payload: { type: "hire", status: "pending", requestedBy: "agent-1", companyId: "comp-1" },
    });
    const result = await formatPayload(event, "approval.created",
      async () => ({ id: "agent-1", name: "CEO", role: "ceo" }),
      async () => ({ id: "comp-1", name: "CivBid" }),
    );
    expect(result.event).toBe("approval.created");
    expect(result.data.approval).toBeDefined();
    expect(result.data.approval!.type).toBe("hire");
  });

  it("formats budget.threshold_hit", async () => {
    const result = await formatPayload(
      baseEvent({ eventType: "cost_event.created", payload: { companyId: "comp-1" } }),
      "budget.threshold_hit",
      async () => null,
      async () => ({ id: "comp-1", name: "CivBid" }),
      { currentSpendCents: 8000, budgetCents: 10000, percentUsed: 80 },
    );
    expect(result.event).toBe("budget.threshold_hit");
    expect(result.data.budget).toBeDefined();
    expect(result.data.budget!.percentUsed).toBe(80);
  });

  it("sets agent to null when lookup fails", async () => {
    const event = baseEvent({
      eventType: "issue.created",
      payload: { id: "issue-1", title: "X", status: "todo", priority: "low", companyId: "comp-1" },
    });
    const result = await formatPayload(event, "issue.created", async () => null, async () => ({ id: "comp-1", name: "CivBid" }));
    expect(result.data.agent).toBeNull();
  });

  it("formats agent.status_changed using entityId for agent lookup", async () => {
    const event = baseEvent({
      eventType: "agent.status_changed",
      entityId: "agent-2",
      payload: { agentId: "agent-2", status: "offline", companyId: "comp-1" },
    });
    const agentLookup = async (id: string | undefined) => {
      if (id === "agent-2") return { id: "agent-2", name: "DevBot", role: "engineer" };
      return null;
    };
    const result = await formatPayload(event, "agent.status_changed", agentLookup, async () => ({ id: "comp-1", name: "CivBid" }));
    expect(result.data.agent).toBeDefined();
    expect(result.data.agent!.name).toBe("DevBot");
  });

  it("formats issue.stalled", async () => {
    const event = baseEvent({
      eventType: "issue.updated",
      payload: { id: "issue-1", title: "Stalled task", status: "in_progress", priority: "high", companyId: "comp-1" },
    });
    const result = await formatPayload(event, "issue.stalled", async () => null, async () => ({ id: "comp-1", name: "CivBid" }));
    expect(result.event).toBe("issue.stalled");
    expect(result.data.issue).toBeDefined();
  });

  it("falls back company name to 'Unknown' when lookup returns null", async () => {
    const event = baseEvent({
      eventType: "issue.created",
      payload: { id: "issue-1", title: "X", status: "todo", priority: "low", companyId: "comp-1" },
    });
    const result = await formatPayload(event, "issue.created", async () => null, async () => null);
    expect(result.company.name).toBe("Unknown");
    expect(result.company.id).toBe("comp-1");
  });
});

describe("sdkEventToWebhookNames", () => {
  it("maps issue.created to ['issue.created']", () => {
    expect(sdkEventToWebhookNames(baseEvent({ eventType: "issue.created" }))).toEqual(["issue.created"]);
  });

  it("maps issue.updated with status change to ['issue.status_changed']", () => {
    const event = baseEvent({ eventType: "issue.updated", payload: { status: "blocked" } });
    expect(sdkEventToWebhookNames(event)).toEqual(["issue.status_changed"]);
  });

  it("maps issue.updated with assignee change to ['issue.assigned']", () => {
    const event = baseEvent({ eventType: "issue.updated", payload: { assigneeAgentId: "agent-1" } });
    expect(sdkEventToWebhookNames(event)).toEqual(["issue.assigned"]);
  });

  it("maps issue.updated with both status and assignee to both names", () => {
    const event = baseEvent({ eventType: "issue.updated", payload: { status: "blocked", assigneeAgentId: "agent-1" } });
    const names = sdkEventToWebhookNames(event);
    expect(names).toContain("issue.status_changed");
    expect(names).toContain("issue.assigned");
  });

  it("maps issue.updated with no recognized fields to ['issue.updated']", () => {
    const event = baseEvent({ eventType: "issue.updated", payload: { description: "changed" } });
    expect(sdkEventToWebhookNames(event)).toEqual(["issue.updated"]);
  });

  it("maps issue.comment.created to ['issue.commented']", () => {
    expect(sdkEventToWebhookNames(baseEvent({ eventType: "issue.comment.created" }))).toEqual(["issue.commented"]);
  });

  it("maps agent.run.failed correctly", () => {
    expect(sdkEventToWebhookNames(baseEvent({ eventType: "agent.run.failed" }))).toEqual(["agent.run.failed"]);
  });

  it("maps approval.decided correctly", () => {
    expect(sdkEventToWebhookNames(baseEvent({ eventType: "approval.decided" }))).toEqual(["approval.decided"]);
  });

  it("returns empty for unknown events", () => {
    expect(sdkEventToWebhookNames(baseEvent({ eventType: "company.created" }))).toEqual([]);
  });
});

describe("WEBHOOK_NAME_TO_CONFIG_KEY", () => {
  it("maps all webhook event names to config keys", () => {
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["issue.created"]).toBe("issueCreated");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["issue.status_changed"]).toBe("issueUpdated");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["issue.assigned"]).toBe("issueUpdated");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["issue.commented"]).toBe("issueCommented");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["issue.stalled"]).toBe("issueStalled");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["agent.run.failed"]).toBe("agentRunFailed");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["agent.status_changed"]).toBe("agentStatusChanged");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["approval.created"]).toBe("approvalCreated");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["approval.decided"]).toBe("approvalDecided");
    expect(WEBHOOK_NAME_TO_CONFIG_KEY["budget.threshold_hit"]).toBe("budgetThresholdHit");
  });
});
