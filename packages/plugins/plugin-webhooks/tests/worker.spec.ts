import { describe, expect, it, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import type { WebhooksPluginConfig } from "../src/config.js";

// The harness ctx.http.fetch calls real fetch — mock it globally
vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

const BASE_CONFIG: WebhooksPluginConfig = {
  endpoints: [
    {
      url: "https://example.com/webhook",
      secretRef: "MY_WEBHOOK_SECRET",
      label: "Main Hook",
      events: ["issueCreated"],
      enabled: true,
    },
  ],
  stalledThresholdMinutes: 60,
  budgetThresholdPercent: 80,
};

async function setupHarness(config: WebhooksPluginConfig = BASE_CONFIG) {
  const harness = createTestHarness({ manifest, config });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

describe("worker setup", () => {
  it("logs initialized message after setup", async () => {
    const harness = await setupHarness();
    const infoLogs = harness.logs.filter((l) => l.level === "info");
    expect(infoLogs.some((l) => l.message.includes("initialized"))).toBe(true);
  });
});

describe("event routing", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("sends webhook when issue.created fires with matching endpoint", async () => {
    const harness = await setupHarness();

    await harness.emit("issue.created", {
      id: "issue-1",
      title: "Fix the bug",
      status: "todo",
      priority: "high",
    });

    expect(fetch).toHaveBeenCalled();
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://example.com/webhook");
  });

  it("sends correct event body for issue.created", async () => {
    const harness = await setupHarness();

    await harness.emit("issue.created", {
      id: "issue-1",
      title: "Fix the bug",
      status: "todo",
      priority: "high",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.event).toBe("issue.created");
    expect(body.data.issue.id).toBe("issue-1");
    expect(body.data.issue.title).toBe("Fix the bug");
  });

  it("does NOT call fetch when no endpoint matches the event", async () => {
    vi.mocked(fetch).mockClear();

    const config: WebhooksPluginConfig = {
      ...BASE_CONFIG,
      endpoints: [
        {
          url: "https://example.com/webhook",
          secretRef: "MY_WEBHOOK_SECRET",
          label: "Comments Only",
          events: ["issueCommented"], // only subscribed to comments
          enabled: true,
        },
      ],
    };
    const harness = await setupHarness(config);

    await harness.emit("issue.created", {
      id: "issue-1",
      title: "New issue",
      status: "todo",
      priority: "medium",
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when endpoint is disabled", async () => {
    vi.mocked(fetch).mockClear();

    const config: WebhooksPluginConfig = {
      ...BASE_CONFIG,
      endpoints: [
        {
          url: "https://example.com/webhook",
          secretRef: "MY_WEBHOOK_SECRET",
          events: ["issueCreated"],
          enabled: false, // disabled
        },
      ],
    };
    const harness = await setupHarness(config);

    await harness.emit("issue.created", { id: "issue-1", title: "New issue", status: "todo", priority: "medium" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes issue.comment.created to issueCommented endpoint", async () => {
    vi.mocked(fetch).mockClear();

    const config: WebhooksPluginConfig = {
      ...BASE_CONFIG,
      endpoints: [
        {
          url: "https://example.com/comments",
          secretRef: "MY_WEBHOOK_SECRET",
          label: "Comments Hook",
          events: ["issueCommented"],
          enabled: true,
        },
      ],
    };
    const harness = await setupHarness(config);

    await harness.emit("issue.comment.created", {
      issueId: "issue-1",
      body: "A comment",
      authorName: "Alice",
      authorType: "user",
    });

    expect(fetch).toHaveBeenCalled();
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://example.com/comments");
  });
});

describe("stalled state reset", () => {
  it("resets stalled state when issue.updated fires", async () => {
    const harness = await setupHarness();

    // Pre-seed a stalled state on an issue
    await harness.ctx.state.set(
      { scopeKind: "issue", scopeId: "issue-42", stateKey: "stalled" },
      { stalledSince: "2026-03-01T00:00:00.000Z", alertedAt: "2026-03-01T01:00:00.000Z" },
    );

    await harness.emit(
      "issue.updated",
      { id: "issue-42", status: "in_progress" },
      { entityId: "issue-42" },
    );

    const stalledState = harness.getState({ scopeKind: "issue", scopeId: "issue-42", stateKey: "stalled" });
    expect(stalledState).toEqual({ stalledSince: null, alertedAt: null });
  });

  it("resets stalled state when issue.comment.created fires", async () => {
    const harness = await setupHarness();

    await harness.ctx.state.set(
      { scopeKind: "issue", scopeId: "issue-99", stateKey: "stalled" },
      { stalledSince: "2026-03-01T00:00:00.000Z", alertedAt: "2026-03-01T01:00:00.000Z" },
    );

    await harness.emit(
      "issue.comment.created",
      { issueId: "issue-99", body: "Let me check this" },
      { entityId: "issue-99" },
    );

    const stalledState = harness.getState({ scopeKind: "issue", scopeId: "issue-99", stateKey: "stalled" });
    expect(stalledState).toEqual({ stalledSince: null, alertedAt: null });
  });
});

describe("budget event handling", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  const BUDGET_CONFIG: WebhooksPluginConfig = {
    endpoints: [
      {
        url: "https://example.com/budget",
        secretRef: "MY_BUDGET_SECRET",
        label: "Budget Hook",
        events: ["budgetThresholdHit"],
        enabled: true,
      },
    ],
    stalledThresholdMinutes: 60,
    budgetThresholdPercent: 80,
  };

  it("fires webhook when budget threshold is crossed", async () => {
    const harness = await setupHarness(BUDGET_CONFIG);

    // Send cost events that sum to > 80% of $100.00 budget (= $80.00 = 8000 cents)
    await harness.emit("cost_event.created", { amountCents: 8500 });

    expect(fetch).toHaveBeenCalled();
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://example.com/budget");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.event).toBe("budget.threshold_hit");
    expect(body.data.budget).toBeTruthy();
    expect(body.data.budget.percentUsed).toBeGreaterThanOrEqual(80);
  });

  it("does NOT fire webhook when budget threshold is not yet crossed", async () => {
    const harness = await setupHarness(BUDGET_CONFIG);

    // Only 50% of $100.00 spent
    await harness.emit("cost_event.created", { amountCents: 5000 });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("accumulates spend across multiple cost events before firing", async () => {
    const harness = await setupHarness(BUDGET_CONFIG);

    // Two events each at 45% — should fire on second event after cumulative 90%
    await harness.emit("cost_event.created", { amountCents: 4500 });
    expect(fetch).not.toHaveBeenCalled();

    await harness.emit("cost_event.created", { amountCents: 4500 });
    expect(fetch).toHaveBeenCalled();
  });

  it("only fires budget webhook once even if more cost events arrive", async () => {
    const harness = await setupHarness(BUDGET_CONFIG);

    await harness.emit("cost_event.created", { amountCents: 9000 }); // 90% → fires
    vi.mocked(fetch).mockClear();

    await harness.emit("cost_event.created", { amountCents: 500 }); // already alerted
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("data handlers", () => {
  it("delivery-log returns entries array", async () => {
    const harness = await setupHarness();
    const result = await harness.getData<{ entries: unknown[] }>("delivery-log");
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it("config data handler returns current config", async () => {
    const harness = await setupHarness();
    const result = await harness.getData("config");
    expect(result).toMatchObject({
      endpoints: BASE_CONFIG.endpoints,
      stalledThresholdMinutes: BASE_CONFIG.stalledThresholdMinutes,
      budgetThresholdPercent: BASE_CONFIG.budgetThresholdPercent,
    });
  });

  it("delivery-log reflects entries after event delivery", async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
    const harness = await setupHarness();

    await harness.emit("issue.created", {
      id: "issue-1",
      title: "Log test",
      status: "todo",
      priority: "medium",
    });

    const result = await harness.getData<{ entries: Array<{ event: string; success: boolean }> }>("delivery-log");
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].event).toBe("issue.created");
    expect(result.entries[0].success).toBe(true);
  });
});

describe("action handlers", () => {
  it("clear-delivery-log clears the log", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
    const harness = await setupHarness();

    // Generate a log entry
    await harness.emit("issue.created", { id: "i1", title: "T", status: "todo", priority: "low" });

    let logResult = await harness.getData<{ entries: unknown[] }>("delivery-log");
    expect(logResult.entries.length).toBeGreaterThan(0);

    const clearResult = await harness.performAction<{ ok: boolean }>("clear-delivery-log");
    expect(clearResult.ok).toBe(true);

    logResult = await harness.getData<{ entries: unknown[] }>("delivery-log");
    expect(logResult.entries).toHaveLength(0);
  });

  it("send-test sends to the first endpoint and returns success", async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
    const harness = await setupHarness();

    const result = await harness.performAction<{ ok: boolean; entry?: { event: string } }>("send-test", {
      endpointIndex: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.entry?.event).toBe("test");
  });

  it("send-test returns error when endpoint index is out of range", async () => {
    const harness = await setupHarness();

    const result = await harness.performAction<{ ok: boolean; error?: string }>("send-test", {
      endpointIndex: 99,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

describe("onValidateConfig", () => {
  it("returns ok: true for a valid config", async () => {
    const result = await plugin.definition.onValidateConfig!(BASE_CONFIG);
    expect(result.ok).toBe(true);
    expect(result.errors ?? []).toHaveLength(0);
  });

  it("returns ok: false for config with invalid URL", async () => {
    const badConfig: WebhooksPluginConfig = {
      ...BASE_CONFIG,
      endpoints: [
        {
          url: "not-a-url",
          secretRef: "SECRET",
          events: ["issueCreated"],
          enabled: true,
        },
      ],
    };
    const result = await plugin.definition.onValidateConfig!(badConfig);
    expect(result.ok).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it("returns ok: false for non-HTTPS URL", async () => {
    const badConfig: WebhooksPluginConfig = {
      ...BASE_CONFIG,
      endpoints: [
        {
          url: "http://example.com/webhook",
          secretRef: "SECRET",
          events: ["issueCreated"],
          enabled: true,
        },
      ],
    };
    const result = await plugin.definition.onValidateConfig!(badConfig);
    expect(result.ok).toBe(false);
  });

  it("returns ok: false for out-of-range stalledThresholdMinutes", async () => {
    const badConfig: WebhooksPluginConfig = {
      ...BASE_CONFIG,
      stalledThresholdMinutes: 5, // below minimum of 15
    };
    const result = await plugin.definition.onValidateConfig!(badConfig);
    expect(result.ok).toBe(false);
  });

  it("returns warning for no endpoints configured", async () => {
    const emptyConfig: WebhooksPluginConfig = {
      endpoints: [],
      stalledThresholdMinutes: 60,
      budgetThresholdPercent: 80,
    };
    const result = await plugin.definition.onValidateConfig!(emptyConfig);
    expect(result.ok).toBe(true);
    expect(result.warnings?.length).toBeGreaterThan(0);
  });
});

describe("onHealth", () => {
  it("returns ok status", async () => {
    const result = await plugin.definition.onHealth!();
    expect(result.status).toBe("ok");
  });
});
