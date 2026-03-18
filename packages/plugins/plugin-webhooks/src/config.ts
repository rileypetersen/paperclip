/** Event config keys that map to SDK events or plugin jobs. */
export const VALID_EVENT_KEYS = [
  "issueCreated",
  "issueUpdated",
  "issueCommented",
  "issueStalled",
  "agentRunFailed",
  "agentStatusChanged",
  "approvalCreated",
  "approvalDecided",
  "budgetThresholdHit",
] as const;

export type WebhookEventKey = (typeof VALID_EVENT_KEYS)[number];

export interface WebhookEndpoint {
  url: string;
  secretRef: string;
  label?: string;
  events: WebhookEventKey[];
  enabled: boolean;
}

export interface WebhooksPluginConfig {
  endpoints: WebhookEndpoint[];
  stalledThresholdMinutes: number;
  budgetThresholdPercent: number;
  companyFilter?: string;
}

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

const validEventKeySet = new Set<string>(VALID_EVENT_KEYS);

export function validateConfig(config: WebhooksPluginConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < config.endpoints.length; i++) {
    const ep = config.endpoints[i];
    const label = ep.label || `Endpoint ${i + 1}`;

    try {
      const parsed = new URL(ep.url);
      if (parsed.protocol !== "https:") {
        errors.push(`${label}: URL must use HTTPS (got ${parsed.protocol})`);
      }
    } catch {
      errors.push(`${label}: Invalid URL`);
    }

    for (const key of ep.events) {
      if (!validEventKeySet.has(key)) {
        errors.push(`${label}: Unknown event key "${key}"`);
      }
    }
  }

  if (config.stalledThresholdMinutes < 15 || config.stalledThresholdMinutes > 10080) {
    errors.push(`stalledThresholdMinutes must be between 15 and 10080 (got ${config.stalledThresholdMinutes})`);
  }
  if (config.budgetThresholdPercent < 1 || config.budgetThresholdPercent > 100) {
    errors.push(`budgetThresholdPercent must be between 1 and 100 (got ${config.budgetThresholdPercent})`);
  }

  if (config.endpoints.length === 0) {
    warnings.push("No webhook endpoints configured — no webhooks will be sent");
  }

  const allEvents = config.endpoints.flatMap((ep) => ep.events);
  if (config.endpoints.length > 0 && allEvents.length === 0) {
    warnings.push("No event types selected on any endpoint — no webhooks will fire");
  }

  return { ok: errors.length === 0, warnings, errors };
}

/** Maps config event keys to the SDK event types they subscribe to. */
export const EVENT_KEY_TO_SDK: Record<string, string> = {
  issueCreated: "issue.created",
  issueUpdated: "issue.updated",
  issueCommented: "issue.comment.created",
  agentRunFailed: "agent.run.failed",
  agentStatusChanged: "agent.status_changed",
  approvalCreated: "approval.created",
  approvalDecided: "approval.decided",
  budgetThresholdHit: "cost_event.created",
};

/** Returns the set of SDK event types needed for the given config. */
export function getRequiredSubscriptions(config: WebhooksPluginConfig): Set<string> {
  const subscriptions = new Set<string>();
  for (const ep of config.endpoints) {
    if (!ep.enabled) continue;
    for (const key of ep.events) {
      const sdk = EVENT_KEY_TO_SDK[key];
      if (sdk) subscriptions.add(sdk);
    }
  }
  return subscriptions;
}

/** Returns endpoints that are enabled and subscribe to the given event key. */
export function getEndpointsForEvent(config: WebhooksPluginConfig, eventKey: WebhookEventKey): WebhookEndpoint[] {
  return config.endpoints.filter((ep) => ep.enabled && ep.events.includes(eventKey));
}

/** Default config values. */
export const DEFAULT_CONFIG: WebhooksPluginConfig = {
  endpoints: [],
  stalledThresholdMinutes: 240,
  budgetThresholdPercent: 80,
};
