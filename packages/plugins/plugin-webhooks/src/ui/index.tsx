import React, { useState } from "react";
import { usePluginData, usePluginAction } from "@paperclipai/plugin-sdk/ui";

interface DeliveryEntry {
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

type Tab = "settings" | "log";

export function WebhooksSettings() {
  const [activeTab, setActiveTab] = useState<Tab>("settings");

  return (
    <div style={{ padding: "16px", fontFamily: "var(--font-sans, sans-serif)" }}>
      <h2 style={{ margin: "0 0 16px" }}>Webhooks</h2>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
          Settings
        </TabButton>
        <TabButton active={activeTab === "log"} onClick={() => setActiveTab("log")}>
          Delivery Log
        </TabButton>
      </div>
      {activeTab === "settings" ? <SettingsPanel /> : <DeliveryLogPanel />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 16px",
        border: "1px solid var(--border-color, #ddd)",
        borderRadius: "4px",
        background: active ? "var(--accent-color, #0066cc)" : "transparent",
        color: active ? "#fff" : "inherit",
        cursor: "pointer",
        fontSize: "13px",
      }}
    >
      {children}
    </button>
  );
}

function SettingsPanel() {
  const { data: config, loading } = usePluginData<Record<string, unknown>>("config");
  const sendTest = usePluginAction("send-test");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; entry?: DeliveryEntry } | null>(null);

  if (loading) return <div>Loading configuration...</div>;

  const endpoints = (config?.endpoints ?? []) as Array<{
    url: string; secretRef: string; label?: string; events: string[]; enabled: boolean;
  }>;
  const stalledThreshold = config?.stalledThresholdMinutes ?? 240;
  const budgetThreshold = config?.budgetThresholdPercent ?? 80;

  async function handleTest(index: number) {
    setTestResult(null);
    setTestLoading(true);
    try {
      const result = await sendTest({ endpointIndex: index });
      setTestResult(result as { ok: boolean; entry?: DeliveryEntry });
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: "14px", margin: "0 0 12px" }}>Endpoints</h3>
      {endpoints.length === 0 ? (
        <p style={{ color: "var(--text-muted, #888)", fontSize: "13px" }}>
          No endpoints configured. Add endpoints in the plugin configuration.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-color, #ddd)" }}>
              <th style={{ padding: "8px" }}>Label</th>
              <th style={{ padding: "8px" }}>URL</th>
              <th style={{ padding: "8px" }}>Events</th>
              <th style={{ padding: "8px" }}>Enabled</th>
              <th style={{ padding: "8px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-color, #eee)" }}>
                <td style={{ padding: "8px" }}>{ep.label || `Endpoint ${i + 1}`}</td>
                <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "12px" }}>
                  {maskUrl(ep.url)}
                </td>
                <td style={{ padding: "8px" }}>{ep.events.length} event(s)</td>
                <td style={{ padding: "8px" }}>{ep.enabled ? "Yes" : "No"}</td>
                <td style={{ padding: "8px" }}>
                  <button
                    onClick={() => handleTest(i)}
                    disabled={testLoading}
                    style={{ fontSize: "12px", cursor: "pointer" }}
                  >
                    Send Test
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {testResult && (
        <div style={{
          marginTop: "8px",
          padding: "8px",
          borderRadius: "4px",
          background: testResult.ok ? "#e6f9e6" : "#fde8e8",
          fontSize: "13px",
        }}>
          {testResult.ok ? "Test delivered successfully" : `Test failed: ${testResult.entry?.errorMessage ?? "Unknown error"}`}
          {testResult.entry && ` (${testResult.entry.responseTimeMs}ms)`}
        </div>
      )}

      <h3 style={{ fontSize: "14px", margin: "24px 0 12px" }}>Global Settings</h3>
      <div style={{ fontSize: "13px" }}>
        <div style={{ marginBottom: "8px" }}>
          <strong>Stalled threshold:</strong> {String(stalledThreshold)} minutes
        </div>
        <div style={{ marginBottom: "8px" }}>
          <strong>Budget threshold:</strong> {String(budgetThreshold)}%
        </div>
      </div>
    </div>
  );
}

function DeliveryLogPanel() {
  const { data, loading, refresh } = usePluginData<{ entries: DeliveryEntry[] }>("delivery-log");
  const clearLog = usePluginAction("clear-delivery-log");

  if (loading) return <div>Loading delivery log...</div>;

  const entries = data?.entries ?? [];

  async function handleClear() {
    await clearLog({});
    refresh();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "13px", color: "var(--text-muted, #888)" }}>
          {entries.length} deliver{entries.length === 1 ? "y" : "ies"}
        </span>
        <button onClick={handleClear} style={{ fontSize: "12px", cursor: "pointer" }}>
          Clear Log
        </button>
      </div>

      {entries.length === 0 ? (
        <p style={{ color: "var(--text-muted, #888)", fontSize: "13px" }}>No deliveries yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-color, #ddd)" }}>
              <th style={{ padding: "6px" }}>Time</th>
              <th style={{ padding: "6px" }}>Event</th>
              <th style={{ padding: "6px" }}>Endpoint</th>
              <th style={{ padding: "6px" }}>Status</th>
              <th style={{ padding: "6px" }}>Duration</th>
              <th style={{ padding: "6px" }}>Retried</th>
            </tr>
          </thead>
          <tbody>
            {[...entries].reverse().map((entry) => (
              <React.Fragment key={entry.id}>
                <tr
                  style={{
                    borderBottom: entry.errorMessage ? "none" : "1px solid var(--border-color, #eee)",
                    background: entry.success ? undefined : "#fde8e8",
                  }}
                >
                  <td style={{ padding: "6px" }}>{new Date(entry.timestamp).toLocaleTimeString()}</td>
                  <td style={{ padding: "6px", fontFamily: "monospace" }}>{entry.event}</td>
                  <td style={{ padding: "6px" }}>{entry.endpointLabel}</td>
                  <td style={{ padding: "6px" }}>
                    <StatusBadge status={entry.httpStatus} success={entry.success} retried={entry.retried} />
                  </td>
                  <td style={{ padding: "6px" }}>{entry.responseTimeMs}ms</td>
                  <td style={{ padding: "6px" }}>{entry.retried ? "Yes" : ""}</td>
                </tr>
                {entry.errorMessage && (
                  <tr style={{ borderBottom: "1px solid var(--border-color, #eee)", background: "#fde8e8" }}>
                    <td colSpan={6} style={{ padding: "4px 6px 8px 24px", fontSize: "11px", color: "#b91c1c" }}>
                      {entry.errorMessage}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ status, success, retried }: { status: number | null; success: boolean; retried: boolean }) {
  const color = success ? (retried ? "#eab308" : "#22c55e") : "#ef4444";
  const label = status ? String(status) : "ERR";
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 6px",
      borderRadius: "3px",
      background: color,
      color: "#fff",
      fontSize: "11px",
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return "***";
  }
}
