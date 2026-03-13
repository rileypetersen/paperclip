# Two-Way Discord Thread Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two-way Discord integration — Paperclip notifications create threads, board member replies route back as issue comments.

**Architecture:** New `"discord"` notification provider using discord.js gateway. Outbound: embed → thread per issue, reused across notification types, @mentions board members. Inbound: `messageCreate` listener routes replies to issue comments. Thread-issue mappings persisted in DB. Provider structured as a class with start/stop/reload lifecycle.

**Tech Stack:** TypeScript, discord.js, Drizzle ORM, Express, React, Zod

**Spec:** `docs/superpowers/specs/2026-03-13-discord-two-way-integration-design.md`

---

## Chunk 1: Shared Constants, Config Schema, and DB Migration

### Task 1: Add "discord" to NOTIFICATION_PROVIDERS

**Files:**
- Modify: `packages/shared/src/constants.ts:176`

- [ ] **Step 1: Update the constant**

```typescript
// packages/shared/src/constants.ts line 176
// Before:
export const NOTIFICATION_PROVIDERS = ["disabled", "command", "webhook"] as const;

// After:
export const NOTIFICATION_PROVIDERS = ["disabled", "command", "webhook", "discord"] as const;
```

- [ ] **Step 2: Build shared package**

Run: `cd packages/shared && pnpm run build`
Expected: clean build

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "feat: add discord to NOTIFICATION_PROVIDERS"
```

### Task 2: Add discord config to notifications schema

**Files:**
- Modify: `packages/shared/src/config-schema.ts:99-112`

- [ ] **Step 1: Add discordConfigSchema and update notificationsConfigSchema**

```typescript
// packages/shared/src/config-schema.ts — add before notificationsConfigSchema:

export const discordUserMappingSchema = z.object({
  discordUserId: z.string().min(1),
  paperclipUserId: z.string().min(1),
});

export const discordConfigSchema = z.object({
  channelId: z.string().min(1),
  userMappings: z.array(discordUserMappingSchema).min(1),
});
```

Then add `discord: discordConfigSchema.optional(),` to `notificationsConfigSchema` after `webhookUrl`:

```typescript
export const notificationsConfigSchema = z.object({
  provider: z.enum(NOTIFICATION_PROVIDERS).default("disabled"),
  boardEmails: z.array(z.string().email()).default([]),
  webhookUrl: z.string().url().optional(),
  discord: discordConfigSchema.optional(),
  command: notificationsCommandConfigSchema.default({
    args: [],
  }),
  stalledThresholdMinutes: z.number().int().min(1).max(7 * 24 * 60).default(240),
  stalledCooldownMinutes: z.number().int().min(1).max(30 * 24 * 60).default(1440),
});
```

- [ ] **Step 2: Add cross-field validation for discord provider**

In `paperclipConfigSchema`'s `superRefine` callback, after the webhook validation block:

```typescript
    if (value.notifications.provider === "discord" && !value.notifications.discord) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "notifications.discord config is required when provider is discord",
        path: ["notifications", "discord"],
      });
    }
```

- [ ] **Step 3: Build shared package**

Run: `cd packages/shared && pnpm run build`
Expected: clean build

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/config-schema.ts
git commit -m "feat: add discord config schema with cross-field validation"
```

### Task 3: Create discord_thread_mappings DB table

**Files:**
- Create: `packages/db/src/schema/discord_thread_mappings.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// packages/db/src/schema/discord_thread_mappings.ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { issues } from "./issues.js";

export const discordThreadMappings = pgTable("discord_thread_mappings", {
  threadId: text("thread_id").primaryKey(),
  issueId: text("issue_id").notNull().references(() => issues.id),
  channelMessageId: text("channel_message_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Export from schema index**

Add to `packages/db/src/schema/index.ts`:

```typescript
export { discordThreadMappings } from "./discord_thread_mappings.js";
```

- [ ] **Step 3: Generate migration**

Run: `cd packages/db && pnpm run generate`
Expected: new migration file in `src/migrations/` for `discord_thread_mappings` table

- [ ] **Step 4: Build db package**

Run: `cd packages/db && pnpm run build`
Expected: clean build

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/discord_thread_mappings.ts packages/db/src/schema/index.ts packages/db/src/migrations/
git commit -m "feat: add discord_thread_mappings table and migration"
```

---

## Chunk 2: Server Config and Provider Interface

### Task 4: Add discord to server NotificationsConfig and resolver

**Files:**
- Modify: `server/src/config.ts:34-43` (interface) and `server/src/config.ts:92-140` (resolver)

- [ ] **Step 1: Write failing test**

Add to `server/src/__tests__/notification-config.test.ts`:

```typescript
it("resolves discord provider with config from file and bot token from env", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-notifications-config-"));
  const configPath = path.join(tempDir, "config.json");
  process.env.PAPERCLIP_CONFIG = configPath;
  process.env.PAPERCLIP_DISCORD_BOT_TOKEN = "test-bot-token-123";
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
      provider: "discord",
      boardEmails: [],
      discord: {
        channelId: "123456789",
        userMappings: [{ discordUserId: "111", paperclipUserId: "user-1" }],
      },
      command: { args: [] },
      stalledThresholdMinutes: 240,
      stalledCooldownMinutes: 1440,
    },
  });

  const config = resolveNotificationsConfig();
  expect(config.provider).toBe("discord");
  expect(config.discord).toEqual({
    botToken: "test-bot-token-123",
    channelId: "123456789",
    userMappings: [{ discordUserId: "111", paperclipUserId: "user-1" }],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/notification-config.test.ts`
Expected: FAIL — `discord` not in config

- [ ] **Step 3: Update NotificationsConfig interface**

```typescript
// server/src/config.ts — update the interface:
export interface NotificationsConfig {
  provider: NotificationProvider;
  boardEmails: string[];
  webhookUrl: string | undefined;
  discord: {
    botToken: string | undefined;
    channelId: string;
    userMappings: Array<{ discordUserId: string; paperclipUserId: string }>;
  } | undefined;
  command: {
    path: string | undefined;
    args: string[];
  };
  stalledThresholdMinutes: number;
  stalledCooldownMinutes: number;
}
```

- [ ] **Step 4: Update resolveNotificationsConfig**

After the `webhookUrl` resolution block, add:

```typescript
  const discordBotToken = process.env.PAPERCLIP_DISCORD_BOT_TOKEN?.trim() || undefined;
  const fileDiscord = fileNotifications?.discord;
  const discord = fileDiscord
    ? {
        botToken: discordBotToken,
        channelId: fileDiscord.channelId,
        userMappings: [...fileDiscord.userMappings],
      }
    : undefined;
```

Add `discord` to the return object after `webhookUrl`.

- [ ] **Step 5: Update existing test assertions**

Add `discord: undefined` to the "is disabled by default" and "reads threshold and cooldown" test assertions.

Also add `delete process.env.PAPERCLIP_DISCORD_BOT_TOKEN;` to the cleanup block in the "is disabled by default" test.

- [ ] **Step 6: Run tests**

Run: `cd server && npx vitest run src/__tests__/notification-config.test.ts`
Expected: PASS — all tests

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/__tests__/notification-config.test.ts
git commit -m "feat: add discord to NotificationsConfig and resolver"
```

### Task 5: Extend NotificationDeliveryProvider return type

**Files:**
- Modify: `server/src/services/notifications.ts:74-77`

- [ ] **Step 1: Update the deliver() return type**

```typescript
// server/src/services/notifications.ts — update the interface:
export interface NotificationDeliveryProvider {
  provider: NotificationProviderType;
  deliver(notification: BoardNotificationPayload): Promise<
    | { ok: true; metadata?: Record<string, string> }
    | { ok: false; error: string }
  >;
}
```

- [ ] **Step 2: Run notification tests to verify nothing breaks**

Run: `cd server && npx vitest run src/__tests__/notifications.test.ts`
Expected: PASS — all existing tests still pass (metadata is optional)

- [ ] **Step 3: Commit**

```bash
git add server/src/services/notifications.ts
git commit -m "feat: extend deliver() return type with optional metadata"
```

---

## Chunk 3: Install discord.js and Create Discord Provider

### Task 6: Install discord.js dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install discord.js**

Run: `cd server && pnpm add discord.js`

- [ ] **Step 2: Verify it installed**

Run: `cd server && node -e "require('discord.js')"`
Expected: no error

- [ ] **Step 3: Commit**

```bash
git add server/package.json pnpm-lock.yaml
git commit -m "chore: add discord.js dependency to server"
```

### Task 7: Create DiscordNotificationProvider class

**Files:**
- Create: `server/src/services/discord-provider.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write unit test for provider shape**

Add to `server/src/__tests__/notifications.test.ts`:

```typescript
describe("DiscordNotificationProvider", () => {
  it("exports the class with correct shape", async () => {
    const { DiscordNotificationProvider } = await import("../services/discord-provider.ts");
    expect(DiscordNotificationProvider).toBeDefined();
    expect(typeof DiscordNotificationProvider).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/notifications.test.ts -t "DiscordNotificationProvider"`
Expected: FAIL — module not found

- [ ] **Step 3: Create the provider file**

```typescript
// server/src/services/discord-provider.ts
import {
  Client,
  GatewayIntentBits,
  type TextChannel,
  type ThreadChannel,
  type Message,
  EmbedBuilder,
  Options,
} from "discord.js";
import type { Db } from "@paperclipai/db";
import { discordThreadMappings } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import type { BoardNotificationPayload, BoardNotificationKind, NotificationDeliveryProvider } from "./notifications.js";
import { logger } from "../middleware/logger.js";

interface DiscordProviderConfig {
  botToken: string;
  channelId: string;
  userMappings: Array<{ discordUserId: string; paperclipUserId: string }>;
}

interface DiscordProviderDeps {
  db: Db;
  onInboundComment: (issueId: string, body: string, userId: string) => Promise<void>;
}

const NOTIFICATION_COLORS: Record<BoardNotificationKind, number> = {
  board_assigned: 0x5865f2,
  board_blocked: 0xed4245,
  board_stalled: 0xfee75c,
  board_question: 0x57f287,
};

function buildMentionPrefix(userMappings: Array<{ discordUserId: string }>): string {
  return userMappings.map((m) => `<@${m.discordUserId}>`).join(" ");
}

function buildThreadName(identifier: string, title: string): string {
  const name = `[${identifier}] ${title}`;
  return name.length > 100 ? name.slice(0, 97) + "..." : name;
}

export class DiscordNotificationProvider implements NotificationDeliveryProvider {
  provider = "discord" as const;
  private client: Client | null = null;
  private config: DiscordProviderConfig;
  private deps: DiscordProviderDeps;
  private started = false;

  constructor(config: DiscordProviderConfig, deps: DiscordProviderDeps) {
    this.config = config;
    this.deps = deps;
  }

  async start(): Promise<void> {
    if (this.started) return;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      makeCache: Options.cacheWithLimits({
        MessageManager: 0,
        GuildMemberManager: 0,
        PresenceManager: 0,
      }),
    });

    this.client.on("messageCreate", (message) => this.handleInboundMessage(message));

    this.client.on("error", (err) => {
      logger.error({ err }, "discord gateway error");
    });

    await this.client.login(this.config.botToken);
    this.started = true;
    logger.info("discord notification provider connected");
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.started = false;
      logger.info("discord notification provider disconnected");
    }
  }

  updateConfig(config: DiscordProviderConfig): void {
    this.config = config;
  }

  async deliver(notification: BoardNotificationPayload): Promise<
    | { ok: true; metadata?: Record<string, string> }
    | { ok: false; error: string }
  > {
    if (!this.client) {
      return { ok: false, error: "Discord client not connected" };
    }

    try {
      const channel = await this.client.channels.fetch(this.config.channelId);
      if (!channel || !("send" in channel)) {
        return { ok: false, error: `Channel ${this.config.channelId} not found or not a text channel` };
      }
      const textChannel = channel as TextChannel;
      const mentionPrefix = buildMentionPrefix(this.config.userMappings);

      // Check for existing thread for this issue
      const existing = await this.deps.db
        .select()
        .from(discordThreadMappings)
        .where(eq(discordThreadMappings.issueId, notification.issue.id))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (existing) {
        // Post follow-up in existing thread
        const thread = await this.client.channels.fetch(existing.threadId) as ThreadChannel | null;
        if (thread && "send" in thread) {
          const embed = this.buildEmbed(notification);
          await thread.send({ content: mentionPrefix, embeds: [embed] });
          return { ok: true, metadata: { threadId: existing.threadId, channelMessageId: existing.channelMessageId } };
        }
        // Thread gone — fall through to create new one
      }

      // Create new thread
      const embed = this.buildEmbed(notification);
      const message = await textChannel.send({ content: mentionPrefix, embeds: [embed] });
      const threadName = buildThreadName(notification.issue.identifier, notification.issue.title);
      const thread = await message.startThread({ name: threadName });

      // Persist mapping
      await this.deps.db
        .insert(discordThreadMappings)
        .values({
          threadId: thread.id,
          issueId: notification.issue.id,
          channelMessageId: message.id,
        })
        .onConflictDoNothing();

      return { ok: true, metadata: { threadId: thread.id, channelMessageId: message.id } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private buildEmbed(notification: BoardNotificationPayload): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`[${notification.kind}] ${notification.issue.identifier} ${notification.issue.title}`)
      .setDescription(notification.trigger.reason)
      .setURL(notification.issue.url)
      .setColor(NOTIFICATION_COLORS[notification.kind] ?? 0x5865f2)
      .addFields(
        { name: "Company", value: notification.company.name, inline: true },
        { name: "Status", value: notification.issue.status, inline: true },
      )
      .setFooter({ text: "Paperclip Board Notification" });
  }

  private async handleInboundMessage(message: Message): Promise<void> {
    // Ignore bot's own messages
    if (message.author.id === this.client?.user?.id) return;

    // Only process messages in threads
    if (!message.channel.isThread()) return;

    // Skip attachment-only messages
    if (!message.content.trim()) return;

    // Lookup thread mapping
    const mapping = await this.deps.db
      .select()
      .from(discordThreadMappings)
      .where(eq(discordThreadMappings.threadId, message.channel.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!mapping) return;

    // Lookup user
    const userMapping = this.config.userMappings.find(
      (m) => m.discordUserId === message.author.id,
    );
    if (!userMapping) return;

    // Post comment
    try {
      await this.deps.onInboundComment(
        mapping.issueId,
        message.content,
        userMapping.paperclipUserId,
      );
      await message.react("✅");
    } catch (err) {
      logger.error({ err, threadId: message.channel.id, issueId: mapping.issueId }, "failed to route discord reply to issue comment");
      await message.react("❌").catch(() => {});
      await message.reply(`Failed to post comment: ${err instanceof Error ? err.message : "unknown error"}`).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: Export from services index**

Add to `server/src/services/index.ts`:

```typescript
export { DiscordNotificationProvider } from "./discord-provider.js";
```

- [ ] **Step 5: Run tests**

Run: `cd server && npx vitest run src/__tests__/notifications.test.ts`
Expected: PASS

- [ ] **Step 6: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add server/src/services/discord-provider.ts server/src/services/index.ts server/src/__tests__/notifications.test.ts
git commit -m "feat: create DiscordNotificationProvider with outbound threads and inbound comment routing"
```

---

## Chunk 4: Server Integration — Lifecycle, Hot-Reload, and Instance Routes

### Task 8: Wire Discord provider into server startup and hot-reload

**Files:**
- Modify: `server/src/index.ts:477-510`

- [ ] **Step 1: Import DiscordNotificationProvider and discordThreadMappings**

Add to imports in `server/src/index.ts`:

```typescript
import { DiscordNotificationProvider } from "./services/discord-provider.js";
```

And add `discordThreadMappings` to the `@paperclipai/db` import.

- [ ] **Step 2: Update initial provider creation**

Replace the `initialWebhookProvider` block with logic that handles both webhook and discord:

```typescript
  let discordProvider: DiscordNotificationProvider | null = null;
  const initialProvider = (() => {
    if (config.notifications.provider === "webhook" && config.notifications.webhookUrl) {
      return createWebhookNotificationProvider(config.notifications.webhookUrl);
    }
    if (config.notifications.provider === "discord" && config.notifications.discord?.botToken) {
      discordProvider = new DiscordNotificationProvider(
        {
          botToken: config.notifications.discord.botToken,
          channelId: config.notifications.discord.channelId,
          userMappings: config.notifications.discord.userMappings,
        },
        {
          db: db as any,
          onInboundComment: async (issueId, body, userId) => {
            const svc = (await import("./services/issues.js")).issueService(db as any);
            await svc.addComment(issueId, body, { userId });
          },
        },
      );
      return discordProvider;
    }
    return undefined;
  })();
```

Update `notificationRef.current` creation to use `initialProvider`.

- [ ] **Step 3: Start Discord provider after server starts**

After the `server.listen()` callback, add:

```typescript
  if (discordProvider) {
    void discordProvider.start().catch((err) => {
      logger.error({ err }, "failed to start discord notification provider");
    });
  }
```

- [ ] **Step 4: Update reloadNotificationConfig for Discord lifecycle**

```typescript
  function reloadNotificationConfig() {
    const newConfig = resolveNotificationsConfig();
    let provider: NotificationDeliveryProvider | undefined;

    if (newConfig.provider === "webhook" && newConfig.webhookUrl) {
      // Stop old discord if running
      if (discordProvider) {
        void discordProvider.stop();
        discordProvider = null;
      }
      provider = createWebhookNotificationProvider(newConfig.webhookUrl);
    } else if (newConfig.provider === "discord" && newConfig.discord?.botToken) {
      if (discordProvider) {
        // Update config without reconnecting
        discordProvider.updateConfig({
          botToken: newConfig.discord.botToken,
          channelId: newConfig.discord.channelId,
          userMappings: newConfig.discord.userMappings,
        });
        provider = discordProvider;
      } else {
        discordProvider = new DiscordNotificationProvider(
          {
            botToken: newConfig.discord.botToken,
            channelId: newConfig.discord.channelId,
            userMappings: newConfig.discord.userMappings,
          },
          {
            db: dbRef,
            onInboundComment: async (issueId, body, userId) => {
              const svc = (await import("./services/issues.js")).issueService(dbRef);
              await svc.addComment(issueId, body, { userId });
            },
          },
        );
        void discordProvider.start().catch((err) => {
          logger.error({ err }, "failed to start discord notification provider on reload");
        });
        provider = discordProvider;
      }
    } else {
      // Shutting down discord
      if (discordProvider) {
        void discordProvider.stop();
        discordProvider = null;
      }
    }

    notificationRef.current = createNotificationService({
      db: dbRef,
      config: newConfig,
      provider,
      authPublicBaseUrl: config.authPublicBaseUrl,
      runtimeBaseUrl: runtimeApiUrl,
    });
    logger.info("notification service reloaded with new config");
  }
```

- [ ] **Step 5: Add shutdown cleanup**

Find the existing `process.on("SIGTERM")` or `process.on("SIGINT")` handler (or the server close callback). Add:

```typescript
  if (discordProvider) {
    void discordProvider.stop();
  }
```

- [ ] **Step 6: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: wire Discord provider lifecycle into server startup and hot-reload"
```

### Task 9: Add Discord connection status to instance routes

**Files:**
- Modify: `server/src/routes/instance.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Add getDiscordStatus to instance route opts**

In `server/src/app.ts`, add to opts type:

```typescript
    getDiscordStatus?: () => { connected: boolean };
```

Pass it through to `instanceRoutes`.

- [ ] **Step 2: Add GET /instance/notifications/discord-status endpoint**

In `server/src/routes/instance.ts`, add a new route:

```typescript
  router.get("/instance/notifications/discord-status", (_req, res) => {
    if (!opts.getDiscordStatus) {
      res.json({ connected: false, provider: "not-discord" });
      return;
    }
    res.json(opts.getDiscordStatus());
  });
```

- [ ] **Step 3: Pass getDiscordStatus from index.ts**

In the `createApp` call in `server/src/index.ts`:

```typescript
    getDiscordStatus: () => ({
      connected: discordProvider?.started ?? false,
    }),
```

Note: expose `started` as a public getter on `DiscordNotificationProvider` (add `get isConnected(): boolean { return this.started; }` to the class).

- [ ] **Step 4: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/instance.ts server/src/app.ts server/src/index.ts server/src/services/discord-provider.ts
git commit -m "feat: add Discord connection status endpoint"
```

### Task 10: Update notifications test helpers for discord field

**Files:**
- Modify: `server/src/__tests__/notifications.test.ts`

- [ ] **Step 1: Add discord: undefined to makeConfig helper**

In `makeConfig`, add `discord: undefined` to the `base` object (same as `webhookUrl: undefined`).

- [ ] **Step 2: Run all notification tests**

Run: `cd server && npx vitest run src/__tests__/notifications.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/notifications.test.ts
git commit -m "test: add discord field to notification test helpers"
```

---

## Chunk 5: UI — Discord Config Fields

### Task 11: Update UI API client and query keys

**Files:**
- Modify: `ui/src/api/notifications.ts`

- [ ] **Step 1: Update NotificationsConfig type**

```typescript
// ui/src/api/notifications.ts — update the interface:
export interface NotificationsConfig {
  provider: "disabled" | "command" | "webhook" | "discord";
  boardEmails: string[];
  webhookUrl?: string;
  discord?: {
    channelId: string;
    userMappings: Array<{ discordUserId: string; paperclipUserId: string }>;
  };
  command: { path?: string; args: string[] };
  stalledThresholdMinutes: number;
  stalledCooldownMinutes: number;
}
```

Add Discord status API call:

```typescript
  discordStatus: () => api.get<{ connected: boolean }>("/instance/notifications/discord-status"),
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/api/notifications.ts
git commit -m "feat: add discord fields to notifications API client"
```

### Task 12: Add Discord config UI to InstanceSettings

**Files:**
- Modify: `ui/src/pages/InstanceSettings.tsx`

- [ ] **Step 1: Add "discord" to the provider radio buttons**

Update the provider array:

```typescript
{(["disabled", "webhook", "discord", "command"] as const).map((p) => (
```

- [ ] **Step 2: Add Discord config section**

After the webhook URL section and before the command section, add:

```tsx
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
```

- [ ] **Step 3: Update handleSave to include discord config**

```typescript
  const handleSave = () => {
    const payload = { ...form };
    if (payload.provider !== "webhook") delete (payload as any).webhookUrl;
    if (payload.provider !== "discord") delete (payload as any).discord;
    saveMutation.mutate(payload);
  };
```

- [ ] **Step 4: Update form default state to include discord**

```typescript
  const [form, setForm] = useState<NotificationsConfig>({
    provider: "disabled",
    boardEmails: [],
    webhookUrl: "",
    discord: { channelId: "", userMappings: [] },
    command: { path: "", args: [] },
    stalledThresholdMinutes: 240,
    stalledCooldownMinutes: 1440,
  });
```

- [ ] **Step 5: Build UI**

Run: `cd ui && pnpm run build`
Expected: clean build

- [ ] **Step 6: Commit**

```bash
git add ui/src/pages/InstanceSettings.tsx
git commit -m "feat: add Discord config section to Instance Settings UI"
```

---

## Chunk 6: Integration Verification

### Task 13: Full build and test verification

- [ ] **Step 1: Run all server tests**

Run: `cd server && npx vitest run`
Expected: PASS — all tests

- [ ] **Step 2: Run shared package build**

Run: `cd packages/shared && pnpm run build`
Expected: clean

- [ ] **Step 3: Run server type check**

Run: `cd server && npx tsc --noEmit`
Expected: clean

- [ ] **Step 4: Run UI build**

Run: `cd ui && pnpm run build`
Expected: clean

- [ ] **Step 5: Run DB migration**

Run: `cd server && npx tsx src/index.ts` (or `pnpm dev`)
Expected: migration applied, `discord_thread_mappings` table created

- [ ] **Step 6: Verify instance notification endpoints**

```bash
# GET current config
curl -s http://localhost:3100/api/instance/notifications | python3 -m json.tool

# Discord status
curl -s http://localhost:3100/api/instance/notifications/discord-status | python3 -m json.tool
```

- [ ] **Step 7: Verify UI**

Open `http://localhost:3100`, navigate to Instance Settings. Verify:
- Discord radio button appears in Notifications section
- Selecting Discord shows Channel ID, User Mappings, and env var note
- Add/remove user mapping rows work
- Save persists config

### Task 14: End-to-end Discord test (requires Discord bot setup)

- [ ] **Step 1: Create Discord application and bot**

1. Go to https://discord.com/developers/applications
2. Create new application
3. Go to Bot section, create bot, copy token
4. Enable MESSAGE CONTENT intent in Bot settings
5. Generate invite URL with permissions: Send Messages, Create Public Threads, Read Message History, Add Reactions
6. Invite bot to your server

- [ ] **Step 2: Set env var and configure**

```bash
export PAPERCLIP_DISCORD_BOT_TOKEN="your-bot-token"
```

In Instance Settings UI, set provider to Discord, enter channel ID, add your user mapping.

- [ ] **Step 3: Test notification**

Click "Send test notification" in Instance Settings. Verify:
- Embed appears in the Discord channel
- Thread is created on the embed
- You are @mentioned

- [ ] **Step 4: Test reply routing**

Reply in the Discord thread with a message. Verify:
- Bot reacts with ✅
- Comment appears on the test issue in Paperclip UI

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: two-way Discord thread integration — bot provider, thread mapping, reply routing"
```
