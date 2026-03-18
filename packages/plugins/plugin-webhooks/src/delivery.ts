import { createHmac } from "node:crypto";
import type { WebhookEndpoint } from "./config.js";
import type { WebhookPayload } from "./payload.js";

export interface DeliveryEntry {
  id: string;
  timestamp: string;
  event: string;
  endpointLabel: string;
  httpStatus: number | null;
  responseTimeMs: number;
  success: boolean;
  errorMessage?: string;
  retried: boolean;
}

interface DeliveryLog {
  entries: DeliveryEntry[];
}

const MAX_LOG_ENTRIES = 200;
const MAX_PENDING_PER_ENDPOINT = 50;
const MAX_INFLIGHT_PER_ENDPOINT = 5;
const RETRY_DELAY_MS = 5000;

export interface DeliveryDeps {
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;
  resolveSecret: (secretRef: string) => Promise<string>;
  getState: (key: string) => Promise<unknown>;
  setState: (key: string, value: unknown) => Promise<void>;
}

export interface DeliveryManager {
  send(endpoint: WebhookEndpoint, payload: WebhookPayload): Promise<void>;
  getLog(): DeliveryEntry[];
  clearLog(): void;
  flush(): Promise<void>;
  restore(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDeliveryManager(deps: DeliveryDeps): DeliveryManager {
  const log: DeliveryEntry[] = [];
  const inflight = new Map<string, number>();
  const pending = new Map<string, number>();

  function addLogEntry(entry: DeliveryEntry) {
    log.push(entry);
    while (log.length > MAX_LOG_ENTRIES) {
      log.shift();
    }
  }

  function getInflight(url: string): number {
    return inflight.get(url) ?? 0;
  }

  async function doSend(endpoint: WebhookEndpoint, payload: WebhookPayload, isRetry: boolean): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "PaperclipWebhooks/1.0",
      "X-Paperclip-Event": payload.event,
      "X-Paperclip-Delivery": payload.deliveryId,
    };

    if (endpoint.secretRef) {
      const secret = await deps.resolveSecret(endpoint.secretRef);
      const hmac = createHmac("sha256", secret).update(body).digest("hex");
      headers["X-Paperclip-Signature"] = `sha256=${hmac}`;
    }

    const start = Date.now();
    let httpStatus: number | null = null;
    let success = false;
    let errorMessage: string | undefined;

    inflight.set(endpoint.url, getInflight(endpoint.url) + 1);
    try {
      const response = await deps.fetch(endpoint.url, { method: "POST", headers, body });
      httpStatus = response.status;
      success = response.ok;
      if (!success) errorMessage = `HTTP ${response.status}`;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Unknown error";
    } finally {
      inflight.set(endpoint.url, Math.max(0, getInflight(endpoint.url) - 1));
    }

    const elapsed = Date.now() - start;
    addLogEntry({
      id: payload.deliveryId + (isRetry ? "-retry" : ""),
      timestamp: new Date().toISOString(),
      event: payload.event,
      endpointLabel: endpoint.label || endpoint.url,
      httpStatus,
      responseTimeMs: elapsed,
      success,
      errorMessage,
      retried: isRetry,
    });

    // Retry once on 5xx
    if (!success && !isRetry && httpStatus !== null && httpStatus >= 500) {
      await delay(RETRY_DELAY_MS);
      await doSend(endpoint, payload, true);
    }
  }

  return {
    async send(endpoint, payload) {
      if (getInflight(endpoint.url) >= MAX_INFLIGHT_PER_ENDPOINT) {
        addLogEntry({
          id: payload.deliveryId,
          timestamp: new Date().toISOString(),
          event: payload.event,
          endpointLabel: endpoint.label || endpoint.url,
          httpStatus: null,
          responseTimeMs: 0,
          success: false,
          errorMessage: "Concurrency limit reached (5 in-flight)",
          retried: false,
        });
        return;
      }

      const currentPending = pending.get(endpoint.url) ?? 0;
      if (currentPending >= MAX_PENDING_PER_ENDPOINT) {
        addLogEntry({
          id: payload.deliveryId,
          timestamp: new Date().toISOString(),
          event: payload.event,
          endpointLabel: endpoint.label || endpoint.url,
          httpStatus: null,
          responseTimeMs: 0,
          success: false,
          errorMessage: "Queue overflow: exceeded 50 pending deliveries",
          retried: false,
        });
        return;
      }

      pending.set(endpoint.url, currentPending + 1);
      try {
        await doSend(endpoint, payload, false);
      } finally {
        pending.set(endpoint.url, Math.max(0, (pending.get(endpoint.url) ?? 1) - 1));
      }
    },

    getLog() {
      return [...log];
    },

    clearLog() {
      log.length = 0;
    },

    async flush() {
      const data: DeliveryLog = { entries: [...log] };
      await deps.setState("delivery-log", data);
    },

    async restore() {
      const data = (await deps.getState("delivery-log")) as DeliveryLog | null;
      if (data?.entries) {
        log.length = 0;
        log.push(...data.entries);
      }
    },
  };
}
