import { randomUUID } from "node:crypto";
import type { PluginEvent } from "@paperclipai/plugin-sdk";

export interface WebhookPayload {
  event: string;
  timestamp: string;
  deliveryId: string;
  instance: { id: string };
  company: { id: string; name: string };
  data: {
    issue: { id: string; title: string; status: string; previousStatus?: string; priority: string } | null;
    agent: { id: string; name: string; role: string } | null;
    comment: { body: string; authorName: string; authorType: string } | null;
    approval: { type: string; status: string; requestedBy: string } | null;
    budget: { currentSpendCents: number; budgetCents: number; percentUsed: number } | null;
  };
}

type AgentLookup = (actorId: string | undefined) => Promise<{ id: string; name: string; role: string } | null>;
type CompanyLookup = (companyId: string) => Promise<{ id: string; name: string } | null>;

export interface BudgetData {
  currentSpendCents: number;
  budgetCents: number;
  percentUsed: number;
}

export async function formatPayload(
  event: PluginEvent,
  webhookEventName: string,
  agentLookup: AgentLookup,
  companyLookup: CompanyLookup,
  budgetData?: BudgetData,
): Promise<WebhookPayload> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const previous = (payload._previous ?? {}) as Record<string, unknown>;

  const company = await companyLookup(event.companyId);
  const agent = await agentLookup(event.actorId ?? undefined);

  const base: WebhookPayload = {
    event: webhookEventName,
    timestamp: event.occurredAt,
    deliveryId: randomUUID(),
    instance: { id: "default" },
    company: company ? { id: company.id, name: company.name } : { id: event.companyId, name: "Unknown" },
    data: {
      issue: null,
      agent: agent ? { id: agent.id, name: agent.name, role: agent.role } : null,
      comment: null,
      approval: null,
      budget: null,
    },
  };

  // Issue events
  if (webhookEventName.startsWith("issue.")) {
    base.data.issue = {
      id: String(payload.id ?? payload.issueId ?? event.entityId ?? ""),
      title: String(payload.title ?? payload.issueTitle ?? ""),
      status: String(payload.status ?? payload.issueStatus ?? ""),
      priority: String(payload.priority ?? payload.issuePriority ?? ""),
    };

    if (webhookEventName === "issue.status_changed" && previous.status) {
      base.data.issue.previousStatus = String(previous.status);
    }

    if (webhookEventName === "issue.commented") {
      base.data.comment = {
        body: String(payload.body ?? ""),
        authorName: String(payload.authorName ?? ""),
        authorType: String(payload.authorType ?? ""),
      };
    }
  }

  // Approval events
  if (webhookEventName.startsWith("approval.")) {
    base.data.approval = {
      type: String(payload.type ?? ""),
      status: String(payload.status ?? ""),
      requestedBy: String(payload.requestedBy ?? ""),
    };
  }

  // Budget events
  if (webhookEventName === "budget.threshold_hit" && budgetData) {
    base.data.budget = { ...budgetData };
  }

  // Agent events — agent is subject, not actor; look up by entityId if actor lookup returned null
  if (webhookEventName.startsWith("agent.")) {
    if (!base.data.agent && event.entityId) {
      const subject = await agentLookup(event.entityId);
      if (subject) base.data.agent = { id: subject.id, name: subject.name, role: subject.role };
    }
  }

  return base;
}

/**
 * Determines the webhook event name(s) from an SDK event.
 */
export function sdkEventToWebhookNames(event: PluginEvent): string[] {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.eventType) {
    case "issue.created":
      return ["issue.created"];
    case "issue.updated": {
      const names: string[] = [];
      if ("status" in payload) names.push("issue.status_changed");
      if ("assigneeAgentId" in payload) names.push("issue.assigned");
      if (names.length === 0) names.push("issue.updated");
      return names;
    }
    case "issue.comment.created":
      return ["issue.commented"];
    case "agent.run.failed":
      return ["agent.run.failed"];
    case "agent.status_changed":
      return ["agent.status_changed"];
    case "approval.created":
      return ["approval.created"];
    case "approval.decided":
      return ["approval.decided"];
    case "cost_event.created":
      return ["cost_event.created"];
    default:
      return [];
  }
}

/**
 * Maps webhook event names back to config event keys for endpoint filtering.
 */
export const WEBHOOK_NAME_TO_CONFIG_KEY: Record<string, string> = {
  "issue.created": "issueCreated",
  "issue.status_changed": "issueUpdated",
  "issue.assigned": "issueUpdated",
  "issue.updated": "issueUpdated",
  "issue.commented": "issueCommented",
  "issue.stalled": "issueStalled",
  "agent.run.failed": "agentRunFailed",
  "agent.status_changed": "agentStatusChanged",
  "approval.created": "approvalCreated",
  "approval.decided": "approvalDecided",
  "budget.threshold_hit": "budgetThresholdHit",
};
