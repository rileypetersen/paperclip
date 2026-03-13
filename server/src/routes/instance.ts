import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import { notificationsConfigSchema } from "@paperclipai/shared";
import type { NotificationDeliveryProvider } from "../services/notifications.js";
import { createWebhookNotificationProvider, createCommandNotificationProvider } from "../services/notifications.js";
import { readConfigFile, writeConfigFile } from "../config-file.js";
import type { NotificationsConfig } from "../config.js";
import { logger } from "../middleware/logger.js";

let lastTestAt = 0;

export function instanceRoutes(
  db: Db,
  opts: {
    reloadNotificationConfig: () => void;
    getNotificationsConfig: () => NotificationsConfig;
    getDiscordStatus?: () => { connected: boolean };
  },
) {
  const router = Router();

  // GET /instance/notifications — read current config
  router.get("/instance/notifications", (_req, res) => {
    const config = opts.getNotificationsConfig();
    res.json(config);
  });

  // GET /instance/notifications/discord-status
  router.get("/instance/notifications/discord-status", (_req, res) => {
    if (!opts.getDiscordStatus) {
      res.json({ connected: false, provider: "not-discord" });
      return;
    }
    res.json(opts.getDiscordStatus());
  });

  // PATCH /instance/notifications — update config
  router.patch("/instance/notifications", async (req, res) => {
    const fileConfig = readConfigFile();
    if (!fileConfig) {
      res.status(500).json({ error: "Cannot read config file. Fix or create config before updating." });
      return;
    }

    const parsed = notificationsConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid notification config", issues: parsed.error.issues });
      return;
    }

    fileConfig.notifications = parsed.data;
    fileConfig.$meta.updatedAt = new Date().toISOString();

    try {
      writeConfigFile(fileConfig);
    } catch (err) {
      logger.error({ err }, "failed to write config file");
      res.status(500).json({ error: "Failed to write config file" });
      return;
    }

    opts.reloadNotificationConfig();
    res.json(parsed.data);
  });

  // POST /instance/notifications/test — send test notification
  router.post("/instance/notifications/test", async (_req, res) => {
    const now = Date.now();
    if (now - lastTestAt < 10_000) {
      res.status(429).json({ error: "Please wait 10 seconds between test notifications" });
      return;
    }
    lastTestAt = now;

    const config = opts.getNotificationsConfig();
    if (config.provider === "disabled") {
      res.status(400).json({ error: "Notifications are disabled" });
      return;
    }

    // Build provider from current config
    let provider: NotificationDeliveryProvider;
    if (config.provider === "webhook" && config.webhookUrl) {
      provider = createWebhookNotificationProvider(config.webhookUrl);
    } else if (config.provider === "command") {
      provider = createCommandNotificationProvider(config);
    } else {
      res.status(400).json({ error: `Provider "${config.provider}" is not configured` });
      return;
    }

    // Get first company for realistic test data
    const companyRow = await db
      .select({ id: companies.id, name: companies.name, issuePrefix: companies.issuePrefix })
      .from(companies)
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const companyName = companyRow?.name ?? "Test Company";
    const prefix = companyRow?.issuePrefix ?? "TEST";

    const result = await provider.deliver({
      kind: "board_assigned",
      notificationId: `test:${Date.now()}`,
      company: {
        id: companyRow?.id ?? "test",
        name: companyName,
        issuePrefix: prefix,
      },
      issue: {
        id: "test",
        identifier: `${prefix}-0`,
        title: "Test notification from Paperclip",
        status: "todo",
        url: "#",
      },
      recipients: config.boardEmails,
      trigger: {
        detectedAt: new Date().toISOString(),
        reason: "Test notification sent from Instance Settings",
      },
      email: {
        subject: `[Paperclip] Test notification`,
        text: `This is a test notification from Paperclip Instance Settings.`,
      },
    });

    res.json(result);
  });

  return router;
}
