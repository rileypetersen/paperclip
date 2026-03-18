import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.plugin-webhooks",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Webhooks",
  description: "Outbound webhook delivery for Paperclip platform events",
  author: "Paperclip AI",
  categories: ["integration"],
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
  jobs: [
    {
      jobKey: "check-stalled",
      displayName: "Check Stalled Issues",
      description: "Scans active issues for stalled activity and fires webhooks when threshold is exceeded",
      schedule: "*/15 * * * *",
    },
  ],
};

export default manifest;
