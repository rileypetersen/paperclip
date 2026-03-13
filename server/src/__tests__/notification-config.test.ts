import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNotificationsConfig } from "../config.ts";

const ORIGINAL_ENV = { ...process.env };

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveNotificationsConfig", () => {
  it("is disabled by default", () => {
    delete process.env.PAPERCLIP_CONFIG;
    delete process.env.PAPERCLIP_NOTIFICATIONS_PROVIDER;
    delete process.env.PAPERCLIP_BOARD_NOTIFICATION_EMAILS;
    delete process.env.PAPERCLIP_STALLED_WORK_THRESHOLD_MINUTES;
    delete process.env.PAPERCLIP_STALLED_WORK_COOLDOWN_MINUTES;
    delete process.env.PAPERCLIP_NOTIFICATIONS_WEBHOOK_URL;

    expect(resolveNotificationsConfig()).toEqual({
      provider: "disabled",
      boardEmails: [],
      webhookUrl: undefined,
      command: {
        path: undefined,
        args: [],
      },
      stalledThresholdMinutes: 240,
      stalledCooldownMinutes: 1440,
    });
  });

  it("parses board email list from env", () => {
    process.env.PAPERCLIP_BOARD_NOTIFICATION_EMAILS =
      "board@example.com, ops@example.com, board@example.com";

    expect(resolveNotificationsConfig().boardEmails).toEqual([
      "board@example.com",
      "ops@example.com",
    ]);
  });

  it("reads threshold and cooldown from config file with env overrides", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-notifications-config-"));
    const configPath = path.join(tempDir, "config.json");
    process.env.PAPERCLIP_CONFIG = configPath;
    writeJson(configPath, {
      $meta: {
        version: 1,
        updatedAt: "2026-03-12T00:00:00.000Z",
        source: "configure",
      },
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: "~/.paperclip/instances/default/db",
        embeddedPostgresPort: 54329,
        backup: {
          enabled: true,
          intervalMinutes: 60,
          retentionDays: 30,
          dir: "~/.paperclip/instances/default/data/backups",
        },
      },
      logging: {
        mode: "file",
        logDir: "~/.paperclip/instances/default/logs",
      },
      server: {
        deploymentMode: "local_trusted",
        exposure: "private",
        host: "127.0.0.1",
        port: 3100,
        allowedHostnames: [],
        serveUi: true,
      },
      notifications: {
        provider: "command",
        boardEmails: ["board@example.com"],
        command: {
          path: "/tmp/send-board-email",
          args: ["--flag"],
        },
        stalledThresholdMinutes: 30,
        stalledCooldownMinutes: 120,
      },
    });
    process.env.PAPERCLIP_STALLED_WORK_THRESHOLD_MINUTES = "45";

    expect(resolveNotificationsConfig()).toEqual({
      provider: "command",
      boardEmails: ["board@example.com"],
      webhookUrl: undefined,
      command: {
        path: "/tmp/send-board-email",
        args: ["--flag"],
      },
      stalledThresholdMinutes: 45,
      stalledCooldownMinutes: 120,
    });
  });

  it("resolves webhook provider with webhookUrl from config file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-notifications-config-"));
    const configPath = path.join(tempDir, "config.json");
    process.env.PAPERCLIP_CONFIG = configPath;
    writeJson(configPath, {
      $meta: {
        version: 1,
        updatedAt: "2026-03-13T00:00:00.000Z",
        source: "configure",
      },
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: "~/.paperclip/instances/default/db",
        embeddedPostgresPort: 54329,
        backup: {
          enabled: true,
          intervalMinutes: 60,
          retentionDays: 30,
          dir: "~/.paperclip/instances/default/data/backups",
        },
      },
      logging: { mode: "file", logDir: "~/.paperclip/instances/default/logs" },
      server: {
        deploymentMode: "local_trusted",
        exposure: "private",
        host: "127.0.0.1",
        port: 3100,
        allowedHostnames: [],
        serveUi: true,
      },
      notifications: {
        provider: "webhook",
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        boardEmails: [],
        command: { args: [] },
        stalledThresholdMinutes: 60,
        stalledCooldownMinutes: 720,
      },
    });

    const config = resolveNotificationsConfig();
    expect(config.provider).toBe("webhook");
    expect(config.webhookUrl).toBe("https://discord.com/api/webhooks/123/abc");
    expect(config.stalledThresholdMinutes).toBe(60);
  });

  it("resolves webhookUrl from env var", () => {
    process.env.PAPERCLIP_NOTIFICATIONS_PROVIDER = "webhook";
    process.env.PAPERCLIP_NOTIFICATIONS_WEBHOOK_URL = "https://hooks.slack.com/test";

    const config = resolveNotificationsConfig();
    expect(config.provider).toBe("webhook");
    expect(config.webhookUrl).toBe("https://hooks.slack.com/test");
  });
});
