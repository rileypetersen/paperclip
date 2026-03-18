import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDeliveryManager, type DeliveryManager } from "../src/delivery.js";
import type { WebhookPayload } from "../src/payload.js";

function mockPayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event: "issue.created",
    timestamp: "2026-03-18T12:00:00.000Z",
    deliveryId: "del-1",
    instance: { id: "default" },
    company: { id: "comp-1", name: "CivBid" },
    data: { issue: null, agent: null, comment: null, approval: null, budget: null },
    ...overrides,
  };
}

describe("DeliveryManager", () => {
  let manager: DeliveryManager;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockResolve: ReturnType<typeof vi.fn>;
  let stateStore: Map<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    mockResolve = vi.fn().mockResolvedValue("test-secret-value");
    stateStore = new Map();

    manager = createDeliveryManager({
      fetch: mockFetch,
      resolveSecret: mockResolve,
      getState: async (key) => stateStore.get(key) ?? null,
      setState: async (key, value) => { stateStore.set(key, value); },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends POST with correct headers", async () => {
    const payload = mockPayload();
    await manager.send(
      { url: "https://example.com/hook", secretRef: "s1", events: ["issueCreated"], enabled: true },
      payload,
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["User-Agent"]).toBe("PaperclipWebhooks/1.0");
    expect(init.headers["X-Paperclip-Event"]).toBe("issue.created");
    expect(init.headers["X-Paperclip-Delivery"]).toBe("del-1");
  });

  it("computes HMAC-SHA256 signature when secret is configured", async () => {
    await manager.send(
      { url: "https://example.com/hook", secretRef: "s1", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Paperclip-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(mockResolve).toHaveBeenCalledWith("s1");
  });

  it("omits signature header when secretRef is empty", async () => {
    await manager.send(
      { url: "https://example.com/hook", secretRef: "", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Paperclip-Signature"]).toBeUndefined();
  });

  it("retries once on 5xx after 5s", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const sendPromise = manager.send(
      { url: "https://example.com/hook", secretRef: "", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );

    await vi.advanceTimersByTimeAsync(6000);
    await sendPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

    await manager.send(
      { url: "https://example.com/hook", secretRef: "", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not retry on timeout (fetch throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));

    await manager.send(
      { url: "https://example.com/hook", secretRef: "", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("logs deliveries to ring buffer", async () => {
    await manager.send(
      { url: "https://example.com/hook", secretRef: "", label: "Test EP", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );

    const log = manager.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].event).toBe("issue.created");
    expect(log[0].endpointLabel).toBe("Test EP");
    expect(log[0].success).toBe(true);
    expect(log[0].retried).toBe(false);
  });

  it("logs retry attempt", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const sendPromise = manager.send(
      { url: "https://example.com/hook", secretRef: "", label: "Retry EP", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );
    await vi.advanceTimersByTimeAsync(6000);
    await sendPromise;

    const log = manager.getLog();
    expect(log).toHaveLength(2);
    expect(log[1].retried).toBe(true);
    expect(log[1].success).toBe(true);
  });

  it("caps ring buffer at 200 entries", async () => {
    for (let i = 0; i < 210; i++) {
      await manager.send(
        { url: "https://example.com/hook", secretRef: "", events: ["issueCreated"], enabled: true },
        mockPayload({ deliveryId: `del-${i}` }),
      );
    }

    expect(manager.getLog()).toHaveLength(200);
  });

  it("flushes log to state and restores from state", async () => {
    await manager.send(
      { url: "https://example.com/hook", secretRef: "", label: "Persist", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );

    await manager.flush();
    expect(stateStore.has("delivery-log")).toBe(true);

    const manager2 = createDeliveryManager({
      fetch: mockFetch,
      resolveSecret: mockResolve,
      getState: async (key) => stateStore.get(key) ?? null,
      setState: async (key, value) => { stateStore.set(key, value); },
    });
    await manager2.restore();
    expect(manager2.getLog()).toHaveLength(1);
    expect(manager2.getLog()[0].endpointLabel).toBe("Persist");
  });

  it("clearLog empties the buffer", async () => {
    await manager.send(
      { url: "https://example.com/hook", secretRef: "", events: ["issueCreated"], enabled: true },
      mockPayload(),
    );
    manager.clearLog();
    expect(manager.getLog()).toHaveLength(0);
  });

  it("rejects when concurrency limit (5) is reached", async () => {
    // Make fetch hang indefinitely
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const endpoint = { url: "https://example.com/hook", secretRef: "", label: "Busy", events: ["issueCreated" as const], enabled: true };

    // Fire 5 sends (they'll hang)
    for (let i = 0; i < 5; i++) {
      manager.send(endpoint, mockPayload({ deliveryId: `del-${i}` }));
    }

    // 6th should be rejected due to concurrency
    await manager.send(endpoint, mockPayload({ deliveryId: "del-rejected" }));

    const log = manager.getLog();
    const rejected = log.find((e) => e.id === "del-rejected");
    expect(rejected).toBeDefined();
    expect(rejected!.success).toBe(false);
    expect(rejected!.errorMessage).toMatch(/concurrency/i);
  });
});
