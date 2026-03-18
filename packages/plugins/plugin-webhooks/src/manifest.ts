import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.plugin-webhooks",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Webhooks",
  description: "Outbound webhook delivery for Paperclip platform events",
  author: "Paperclip AI",
  categories: ["connector", "automation"],
  capabilities: [
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "issues.read",
    "issue.comments.read",
    "agents.read",
    "companies.read",
    "secrets.read-ref",
    "http.outbound",
    "jobs.schedule",
    "instance.settings.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui/",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      endpoints: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            secretRef: { type: "string" },
            label: { type: "string" },
            events: { type: "array", items: { type: "string" } },
            enabled: { type: "boolean" },
          },
          required: ["url", "events", "enabled"],
        },
        default: [],
      },
      stalledThresholdMinutes: { type: "number", default: 240, minimum: 15, maximum: 10080 },
      budgetThresholdPercent: { type: "number", default: 80, minimum: 1, maximum: 100 },
      companyFilter: { type: "string" },
    },
    required: ["endpoints", "stalledThresholdMinutes", "budgetThresholdPercent"],
  },
  jobs: [
    {
      jobKey: "check-stalled",
      displayName: "Check Stalled Issues",
      description: "Scans active issues for stalled activity and fires webhooks when threshold is exceeded",
      schedule: "*/5 * * * *",
    },
  ],
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: "paperclipai.webhooks.settings",
        displayName: "Webhooks",
        exportName: "WebhooksSettings",
      },
    ],
    launchers: [],
  },
};

export default manifest;
