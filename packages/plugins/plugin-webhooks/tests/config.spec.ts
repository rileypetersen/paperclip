import { describe, expect, it } from "vitest";
import { validateConfig, getEndpointsForEvent, getRequiredSubscriptions, type WebhooksPluginConfig } from "../src/config.js";

function validConfig(overrides: Partial<WebhooksPluginConfig> = {}): WebhooksPluginConfig {
  return {
    endpoints: [
      {
        url: "https://example.com/webhook",
        secretRef: "secret-uuid-1",
        label: "Test",
        events: ["issueCreated"],
        enabled: true,
      },
    ],
    stalledThresholdMinutes: 240,
    budgetThresholdPercent: 80,
    ...overrides,
  };
}

describe("validateConfig", () => {
  it("accepts a valid config", () => {
    const result = validateConfig(validConfig());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects http:// URLs", () => {
    const result = validateConfig(
      validConfig({
        endpoints: [
          { url: "http://example.com/hook", secretRef: "s1", events: ["issueCreated"], enabled: true },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/HTTPS/i);
  });

  it("rejects invalid event keys", () => {
    const result = validateConfig(
      validConfig({
        endpoints: [
          { url: "https://example.com/hook", secretRef: "s1", events: ["madeUpEvent" as any], enabled: true },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/madeUpEvent/);
  });

  it("rejects stalledThresholdMinutes below 15", () => {
    const result = validateConfig(validConfig({ stalledThresholdMinutes: 5 }));
    expect(result.ok).toBe(false);
  });

  it("rejects stalledThresholdMinutes above 10080", () => {
    const result = validateConfig(validConfig({ stalledThresholdMinutes: 20000 }));
    expect(result.ok).toBe(false);
  });

  it("rejects budgetThresholdPercent below 1", () => {
    const result = validateConfig(validConfig({ budgetThresholdPercent: 0 }));
    expect(result.ok).toBe(false);
  });

  it("rejects budgetThresholdPercent above 100", () => {
    const result = validateConfig(validConfig({ budgetThresholdPercent: 101 }));
    expect(result.ok).toBe(false);
  });

  it("warns when no endpoints configured", () => {
    const result = validateConfig(validConfig({ endpoints: [] }));
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/endpoint/i);
  });

  it("warns when all events are unchecked across all endpoints", () => {
    const result = validateConfig(
      validConfig({
        endpoints: [
          { url: "https://example.com/hook", secretRef: "s1", events: [], enabled: true },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => /event/i.test(w))).toBe(true);
  });

  it("accepts config with multiple endpoints", () => {
    const result = validateConfig(
      validConfig({
        endpoints: [
          { url: "https://a.com/hook", secretRef: "s1", events: ["issueCreated"], enabled: true },
          { url: "https://b.com/hook", secretRef: "s2", label: "Slack", events: ["agentRunFailed"], enabled: false },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts endpoint with empty secretRef", () => {
    const result = validateConfig(
      validConfig({
        endpoints: [
          { url: "https://a.com/hook", secretRef: "", events: ["issueCreated"], enabled: true },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("getEndpointsForEvent", () => {
  it("returns only enabled endpoints that subscribe to the event", () => {
    const config = validConfig({
      endpoints: [
        { url: "https://a.com", secretRef: "", events: ["issueCreated", "issueUpdated"], enabled: true },
        { url: "https://b.com", secretRef: "", events: ["issueCreated"], enabled: false },
        { url: "https://c.com", secretRef: "", events: ["agentRunFailed"], enabled: true },
      ],
    });
    const result = getEndpointsForEvent(config, "issueCreated");
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://a.com");
  });

  it("returns empty array when no endpoints match", () => {
    const config = validConfig({ endpoints: [] });
    expect(getEndpointsForEvent(config, "issueCreated")).toHaveLength(0);
  });
});

describe("getRequiredSubscriptions", () => {
  it("returns SDK event types for enabled endpoints", () => {
    const config = validConfig({
      endpoints: [
        { url: "https://a.com", secretRef: "", events: ["issueCreated", "agentRunFailed"], enabled: true },
        { url: "https://b.com", secretRef: "", events: ["issueCreated"], enabled: false },
      ],
    });
    const subs = getRequiredSubscriptions(config);
    expect(subs.has("issue.created")).toBe(true);
    expect(subs.has("agent.run.failed")).toBe(true);
    expect(subs.size).toBe(2);
  });

  it("skips issueStalled (not an SDK event)", () => {
    const config = validConfig({
      endpoints: [
        { url: "https://a.com", secretRef: "", events: ["issueStalled"], enabled: true },
      ],
    });
    const subs = getRequiredSubscriptions(config);
    expect(subs.size).toBe(0);
  });
});
