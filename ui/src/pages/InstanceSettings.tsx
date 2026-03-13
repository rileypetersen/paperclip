import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, ExternalLink, Settings } from "lucide-react";
import type { InstanceSchedulerHeartbeatAgent } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { heartbeatsApi } from "../api/heartbeats";
import { notificationsApi, type NotificationsConfig } from "../api/notifications";
import { agentsApi } from "../api/agents";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { queryKeys } from "../lib/queryKeys";
import { formatDateTime, relativeTime } from "../lib/utils";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function buildAgentHref(agent: InstanceSchedulerHeartbeatAgent) {
  return `/${agent.companyIssuePrefix}/agents/${encodeURIComponent(agent.agentUrlKey)}`;
}

export function InstanceSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Heartbeats" },
    ]);
  }, [setBreadcrumbs]);

  const heartbeatsQuery = useQuery({
    queryKey: queryKeys.instance.schedulerHeartbeats,
    queryFn: () => heartbeatsApi.listInstanceSchedulerAgents(),
    refetchInterval: 15_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async (agentRow: InstanceSchedulerHeartbeatAgent) => {
      const agent = await agentsApi.get(agentRow.id, agentRow.companyId);
      const runtimeConfig = asRecord(agent.runtimeConfig) ?? {};
      const heartbeat = asRecord(runtimeConfig.heartbeat) ?? {};

      return agentsApi.update(
        agentRow.id,
        {
          runtimeConfig: {
            ...runtimeConfig,
            heartbeat: {
              ...heartbeat,
              enabled: !agentRow.heartbeatEnabled,
            },
          },
        },
        agentRow.companyId,
      );
    },
    onSuccess: async (_, agentRow) => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.schedulerHeartbeats }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(agentRow.companyId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentRow.id) }),
      ]);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update heartbeat.");
    },
  });

  const agents = heartbeatsQuery.data ?? [];
  const activeCount = agents.filter((agent) => agent.schedulerActive).length;
  const disabledCount = agents.length - activeCount;

  const grouped = useMemo(() => {
    const map = new Map<string, { companyName: string; agents: InstanceSchedulerHeartbeatAgent[] }>();
    for (const agent of agents) {
      let group = map.get(agent.companyId);
      if (!group) {
        group = { companyName: agent.companyName, agents: [] };
        map.set(agent.companyId, group);
      }
      group.agents.push(agent);
    }
    return [...map.values()];
  }, [agents]);

  if (heartbeatsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading scheduler heartbeats...</div>;
  }

  if (heartbeatsQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {heartbeatsQuery.error instanceof Error
          ? heartbeatsQuery.error.message
          : "Failed to load scheduler heartbeats."}
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Scheduler Heartbeats</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Agents with a timer heartbeat enabled across all of your companies.
        </p>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span><span className="font-semibold text-foreground">{activeCount}</span> active</span>
        <span><span className="font-semibold text-foreground">{disabledCount}</span> disabled</span>
        <span><span className="font-semibold text-foreground">{grouped.length}</span> {grouped.length === 1 ? "company" : "companies"}</span>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState
          icon={Clock3}
          message="No scheduler heartbeats match the current criteria."
        />
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <Card key={group.companyName}>
              <CardContent className="p-0">
                <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.companyName}
                </div>
                <div className="divide-y">
                  {group.agents.map((agent) => {
                    const saving = toggleMutation.isPending && toggleMutation.variables?.id === agent.id;
                    return (
                      <div
                        key={agent.id}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                      >
                        <Badge
                          variant={agent.schedulerActive ? "default" : "outline"}
                          className="shrink-0 text-[10px] px-1.5 py-0"
                        >
                          {agent.schedulerActive ? "On" : "Off"}
                        </Badge>
                        <Link
                          to={buildAgentHref(agent)}
                          className="font-medium truncate hover:underline"
                        >
                          {agent.agentName}
                        </Link>
                        <span className="hidden sm:inline text-muted-foreground truncate">
                          {humanize(agent.title ?? agent.role)}
                        </span>
                        <span className="text-muted-foreground tabular-nums shrink-0">
                          {agent.intervalSec}s
                        </span>
                        <span
                          className="hidden md:inline text-muted-foreground truncate"
                          title={agent.lastHeartbeatAt ? formatDateTime(agent.lastHeartbeatAt) : undefined}
                        >
                          {agent.lastHeartbeatAt
                            ? relativeTime(agent.lastHeartbeatAt)
                            : "never"}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5 shrink-0">
                          <Link
                            to={buildAgentHref(agent)}
                            className="text-muted-foreground hover:text-foreground"
                            title="Full agent config"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={saving}
                            onClick={() => toggleMutation.mutate(agent)}
                          >
                            {saving ? "..." : agent.heartbeatEnabled ? "Disable Timer Heartbeat" : "Enable Timer Heartbeat"}
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NotificationsSection />
    </div>
  );
}

function NotificationsSection() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.instance.notifications,
    queryFn: notificationsApi.get,
  });

  const [form, setForm] = useState<NotificationsConfig>({
    provider: "disabled",
    boardEmails: [],
    webhookUrl: "",
    discord: { channelId: "", userMappings: [] },
    command: { path: "", args: [] },
    stalledThresholdMinutes: 240,
    stalledCooldownMinutes: 1440,
  });
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (config) {
      setForm({
        ...config,
        webhookUrl: config.webhookUrl ?? "",
        command: config.command ?? { path: "", args: [] },
      });
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: notificationsApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instance.notifications });
      setTestResult(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: notificationsApi.test,
    onSuccess: (result) => setTestResult(result),
    onError: (err) => setTestResult({ ok: false, error: String(err) }),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  const handleSave = () => {
    const payload = { ...form };
    if (payload.provider !== "webhook") delete (payload as any).webhookUrl;
    if (payload.provider !== "discord") delete (payload as any).discord;
    saveMutation.mutate(payload);
  };

  return (
    <div id="notifications" className="space-y-4">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div>
          <label className="text-sm font-medium">Provider</label>
          <div className="flex gap-4 mt-1">
            {(["disabled", "webhook", "discord", "command"] as const).map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={form.provider === p}
                  onChange={() => setForm({ ...form, provider: p })}
                />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </label>
            ))}
          </div>
        </div>

        {form.provider === "webhook" && (
          <div>
            <label className="text-sm font-medium">Webhook URL</label>
            <input
              type="url"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="https://discord.com/api/webhooks/..."
              value={form.webhookUrl ?? ""}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Paste a Discord or Slack webhook URL
            </p>
          </div>
        )}

        {form.provider === "discord" && (
          <>
            <div>
              <label className="text-sm font-medium">Channel ID</label>
              <input
                type="text"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Discord channel ID"
                value={form.discord?.channelId ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    discord: {
                      ...form.discord,
                      channelId: e.target.value,
                      userMappings: form.discord?.userMappings ?? [],
                    },
                  })
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">User Mappings</label>
              <p className="text-xs text-muted-foreground mb-2">
                Map Discord user IDs to Paperclip user IDs
              </p>
              {(form.discord?.userMappings ?? []).map((mapping, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="Discord User ID"
                    value={mapping.discordUserId}
                    onChange={(e) => {
                      const mappings = [...(form.discord?.userMappings ?? [])];
                      mappings[i] = { ...mappings[i], discordUserId: e.target.value };
                      setForm({ ...form, discord: { ...form.discord!, userMappings: mappings } });
                    }}
                  />
                  <input
                    type="text"
                    className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="Paperclip User ID"
                    value={mapping.paperclipUserId}
                    onChange={(e) => {
                      const mappings = [...(form.discord?.userMappings ?? [])];
                      mappings[i] = { ...mappings[i], paperclipUserId: e.target.value };
                      setForm({ ...form, discord: { ...form.discord!, userMappings: mappings } });
                    }}
                  />
                  <button
                    className="text-sm text-red-500 hover:text-red-700 px-2"
                    onClick={() => {
                      const mappings = (form.discord?.userMappings ?? []).filter((_, j) => j !== i);
                      setForm({ ...form, discord: { ...form.discord!, userMappings: mappings } });
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="text-sm text-primary hover:underline"
                onClick={() => {
                  const mappings = [...(form.discord?.userMappings ?? []), { discordUserId: "", paperclipUserId: "" }];
                  setForm({ ...form, discord: { ...form.discord!, channelId: form.discord?.channelId ?? "", userMappings: mappings } });
                }}
              >
                + Add mapping
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Set PAPERCLIP_DISCORD_BOT_TOKEN env var before enabling
            </p>
          </>
        )}

        {form.provider === "command" && (
          <>
            <div>
              <label className="text-sm font-medium">Command path</label>
              <input
                type="text"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.command?.path ?? ""}
                onChange={(e) =>
                  setForm({ ...form, command: { ...form.command, path: e.target.value } })
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">Arguments</label>
              <input
                type="text"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="--flag1 --flag2"
                value={form.command?.args?.join(" ") ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    command: { ...form.command, args: e.target.value.split(/\s+/).filter(Boolean) },
                  })
                }
              />
            </div>
          </>
        )}

        {form.provider !== "disabled" && (
          <>
            <div>
              <label className="text-sm font-medium">Board notification emails</label>
              <input
                type="text"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="you@example.com (optional for webhook)"
                value={form.boardEmails.join(", ")}
                onChange={(e) =>
                  setForm({
                    ...form,
                    boardEmails: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Stale alert threshold (minutes)</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.stalledThresholdMinutes}
                  onChange={(e) =>
                    setForm({ ...form, stalledThresholdMinutes: Number(e.target.value) || 240 })
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium">Re-alert cooldown (minutes)</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.stalledCooldownMinutes}
                  onChange={(e) =>
                    setForm({ ...form, stalledCooldownMinutes: Number(e.target.value) || 1440 })
                  }
                />
              </div>
            </div>
          </>
        )}

        <div className="flex gap-2 pt-2">
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </button>
          {form.provider !== "disabled" && (
            <button
              className="px-4 py-2 border rounded-md text-sm font-medium disabled:opacity-50"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? "Sending..." : "Send test notification"}
            </button>
          )}
        </div>

        {saveMutation.isSuccess && (
          <p className="text-sm text-green-600">Saved and reloaded.</p>
        )}
        {saveMutation.isError && (
          <p className="text-sm text-red-600">Save failed: {String(saveMutation.error)}</p>
        )}
        {testResult && (
          <p className={`text-sm ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
            {testResult.ok ? "Test notification sent!" : `Test failed: ${testResult.error}`}
          </p>
        )}
      </div>
    </div>
  );
}
