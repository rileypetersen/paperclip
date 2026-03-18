import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import {
  type WebhooksPluginConfig,
  type WebhookEventKey,
  validateConfig,
  getEndpointsForEvent,
  EVENT_KEY_TO_SDK,
} from "./config.js";
import { formatPayload, sdkEventToWebhookNames, WEBHOOK_NAME_TO_CONFIG_KEY, type BudgetData } from "./payload.js";
import { createDeliveryManager, type DeliveryManager } from "./delivery.js";
import { runStalledCheck, resetStalledState, type StalledDeps } from "./stalled.js";

let deliveryManager: DeliveryManager;
let ctx: PluginContext;

function getConfig(): Promise<WebhooksPluginConfig> {
  return ctx.config.get() as Promise<WebhooksPluginConfig>;
}

async function handleEvent(event: PluginEvent) {
  const config = await getConfig();
  const webhookNames = sdkEventToWebhookNames(event);

  for (const webhookName of webhookNames) {
    const configKey = WEBHOOK_NAME_TO_CONFIG_KEY[webhookName] as WebhookEventKey | undefined;
    if (!configKey) continue;

    const endpoints = getEndpointsForEvent(config, configKey);
    if (endpoints.length === 0) continue;

    const agentResolver = async (id: string | undefined) => {
      if (!id) return null;
      try {
        const agent = await ctx.agents.get(id, event.companyId);
        if (!agent) return null;
        return { id: agent.id, name: agent.name, role: agent.role ?? "unknown" };
      } catch {
        return null;
      }
    };

    const companyResolver = async (companyId: string) => {
      try {
        const company = await ctx.companies.get(companyId);
        if (!company) return null;
        return { id: company.id, name: company.name };
      } catch {
        return null;
      }
    };

    const payload = await formatPayload(event, webhookName, agentResolver, companyResolver);

    for (const endpoint of endpoints) {
      await deliveryManager.send(endpoint, payload);
    }

    await deliveryManager.flush();
  }

  // Reset stalled state on issue activity
  if (event.eventType === "issue.updated" || event.eventType === "issue.comment.created") {
    const issueId = event.entityId ?? (event.payload as Record<string, unknown>)?.issueId as string;
    if (issueId) {
      const stalledDeps: Pick<StalledDeps, "setState"> = {
        setState: async (scopeKind, scopeId, stateKey, value) => {
          await ctx.state.set({ scopeKind: scopeKind as "issue", scopeId, stateKey }, value);
        },
      };
      await resetStalledState(stalledDeps, issueId);
    }
  }
}

async function handleBudgetEvent(event: PluginEvent) {
  const config = await getConfig();
  const endpoints = getEndpointsForEvent(config, "budgetThresholdHit");
  if (endpoints.length === 0) return;

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const amountCents = Number(payload.amountCents ?? payload.amount ?? 0);

  const now = new Date();
  const monthKey = `budget-spend-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const stored = (await ctx.state.get({ scopeKind: "instance", stateKey: monthKey })) as {
    spendCents: number;
    alerted: boolean;
  } | null;

  let spendCents = stored?.spendCents ?? 0;
  let alerted = stored?.alerted ?? false;

  spendCents += amountCents;

  // Budget percentage check — uses configured threshold
  const budgetCents = 100_00; // TODO: source real budget from company/project config when available
  const percentUsed = Math.round((spendCents / budgetCents) * 100);

  if (percentUsed >= config.budgetThresholdPercent && !alerted) {
    alerted = true;

    const budgetData: BudgetData = { currentSpendCents: spendCents, budgetCents, percentUsed };
    const companyResolver = async (companyId: string) => {
      const company = await ctx.companies.get(companyId);
      return company ? { id: company.id, name: company.name } : null;
    };

    const webhookPayload = await formatPayload(
      event, "budget.threshold_hit", async () => null, companyResolver, budgetData,
    );

    for (const endpoint of endpoints) {
      await deliveryManager.send(endpoint, webhookPayload);
    }
    await deliveryManager.flush();
  }

  await ctx.state.set({ scopeKind: "instance", stateKey: monthKey }, { spendCents, alerted });
}

const plugin = definePlugin({
  async setup(context: PluginContext) {
    ctx = context;

    deliveryManager = createDeliveryManager({
      fetch: (url, init) => ctx.http.fetch(url, init),
      resolveSecret: (ref) => ctx.secrets.resolve(ref),
      getState: async (key) => ctx.state.get({ scopeKind: "instance", stateKey: key }),
      setState: async (key, value) => ctx.state.set({ scopeKind: "instance", stateKey: key }, value),
    });
    await deliveryManager.restore();

    // Subscribe to all domain events
    const sdkEvents = new Set(Object.values(EVENT_KEY_TO_SDK));
    for (const sdkEvent of sdkEvents) {
      if (sdkEvent === "cost_event.created") {
        ctx.events.on(sdkEvent, handleBudgetEvent);
      } else {
        ctx.events.on(sdkEvent, handleEvent);
      }
    }

    // Stalled detection job
    ctx.jobs.register("check-stalled", async () => {
      const config = await getConfig();
      const stalledDeps: StalledDeps = {
        getState: async (scopeKind, scopeId, stateKey) =>
          ctx.state.get({ scopeKind: scopeKind as "issue", scopeId, stateKey }) as Promise<never>,
        setState: async (scopeKind, scopeId, stateKey, value) =>
          ctx.state.set({ scopeKind: scopeKind as "issue", scopeId, stateKey }, value),
        listCompanies: async () => {
          const companies = await ctx.companies.list();
          return companies.map((c) => ({ id: c.id, name: c.name }));
        },
        listIssues: async (input) => {
          const issues = await ctx.issues.list(input);
          return issues.map((i) => ({
            id: i.id,
            title: i.title,
            status: i.status,
            priority: i.priority,
            updatedAt: i.updatedAt instanceof Date ? i.updatedAt.toISOString() : String(i.updatedAt),
            companyId: i.companyId,
          }));
        },
        listComments: async (issueId, companyId) => {
          const comments = await ctx.issues.listComments(issueId, companyId);
          return comments.map((c) => ({
            createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
          }));
        },
        onStalled: async (issue, companyId) => {
          const companyResolver = async (cid: string) => {
            const company = await ctx.companies.get(cid);
            return company ? { id: company.id, name: company.name } : null;
          };
          const fakeEvent: PluginEvent = {
            eventId: `stalled-${issue.id}`,
            eventType: "issue.updated",
            companyId,
            occurredAt: new Date().toISOString(),
            entityId: issue.id,
            entityType: "issue",
            payload: { ...issue },
          };
          const webhookPayload = await formatPayload(fakeEvent, "issue.stalled", async () => null, companyResolver);
          const staleEndpoints = getEndpointsForEvent(config, "issueStalled");
          for (const endpoint of staleEndpoints) {
            await deliveryManager.send(endpoint, webhookPayload);
          }
          await deliveryManager.flush();
        },
        now: () => new Date(),
      };
      await runStalledCheck(stalledDeps, {
        stalledThresholdMinutes: config.stalledThresholdMinutes,
        companyFilter: config.companyFilter,
      });
    });

    // UI data handlers
    ctx.data.register("delivery-log", async () => {
      return { entries: deliveryManager.getLog() };
    });

    ctx.data.register("config", async () => {
      return await ctx.config.get();
    });

    // UI action handlers
    ctx.actions.register("clear-delivery-log", async () => {
      deliveryManager.clearLog();
      await deliveryManager.flush();
      return { ok: true };
    });

    ctx.actions.register("send-test", async (params) => {
      const endpointIndex = Number(params.endpointIndex ?? 0);
      const config = await getConfig();
      const endpoint = config.endpoints[endpointIndex];
      if (!endpoint) return { ok: false, error: "Endpoint not found" };

      const testPayload = await formatPayload(
        {
          eventId: "test",
          eventType: "issue.created",
          companyId: "test",
          occurredAt: new Date().toISOString(),
          entityId: "test",
          entityType: "issue",
          payload: { id: "test", title: "Test webhook", status: "todo", priority: "medium" },
        },
        "test",
        async () => null,
        async () => ({ id: "test", name: "Test" }),
      );

      await deliveryManager.send(endpoint, testPayload);
      await deliveryManager.flush();
      const logEntries = deliveryManager.getLog();
      const lastEntry = logEntries[logEntries.length - 1];
      return { ok: lastEntry?.success ?? false, entry: lastEntry };
    });

    ctx.logger.info("Webhooks plugin initialized");
  },

  async onValidateConfig(config) {
    const result = validateConfig(config as WebhooksPluginConfig);
    return { ok: result.ok, warnings: result.warnings, errors: result.errors };
  },

  async onHealth() {
    return { status: "ok", message: "Webhooks plugin running" };
  },

  async onShutdown() {
    if (deliveryManager) {
      await deliveryManager.flush();
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
