# Two-Way Discord Thread Integration

## Goal

Replace one-way Discord webhook notifications with a full two-way integration: Paperclip creates threads per issue in a Discord channel, and board member replies in those threads route back as issue comments.

## Architecture

### Provider Model

Add `"discord"` as a new notification provider alongside existing `"disabled"`, `"command"`, and `"webhook"`. The Discord provider uses discord.js to maintain a gateway WebSocket connection for both sending notifications and receiving replies.

### Config Schema

Extend `notificationsConfigSchema` in `packages/shared/src/config-schema.ts`:

```typescript
export const NOTIFICATION_PROVIDERS = ["disabled", "command", "webhook", "discord"] as const;

const discordConfigSchema = z.object({
  channelId: z.string().min(1),
  userMappings: z.array(z.object({
    discordUserId: z.string().min(1),
    paperclipUserId: z.string().min(1),
  })).min(1),
});

export const notificationsConfigSchema = z.object({
  provider: z.enum(NOTIFICATION_PROVIDERS).default("disabled"),
  boardEmails: z.array(z.string().email()).default([]),
  webhookUrl: z.string().url().optional(),
  discord: discordConfigSchema.optional(),
  command: notificationsCommandConfigSchema.default({ args: [] }),
  stalledThresholdMinutes: ...,
  stalledCooldownMinutes: ...,
});
```

Bot token resolved via env var `PAPERCLIP_DISCORD_BOT_TOKEN` (not stored in config file), following the same pattern as `DATABASE_URL` and other secrets. Cross-field validation: when provider is `"discord"`, both the env var and `discord` config object are required.

Server-side `NotificationsConfig` interface adds:

```typescript
discord: {
  botToken: string | undefined;
  channelId: string;
  userMappings: Array<{ discordUserId: string; paperclipUserId: string }>;
} | undefined;
```

### Database: Thread-Issue Mapping

New Drizzle schema table:

```typescript
export const discordThreadMappings = pgTable("discord_thread_mappings", {
  threadId: text("thread_id").primaryKey(),
  issueId: text("issue_id").notNull().references(() => issues.id),
  channelMessageId: text("channel_message_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

This persists the threadId→issueId mapping across restarts. No in-memory reconstruction from the Discord API needed.

### Delivery Provider Interface Change

Extend the return type of `NotificationDeliveryProvider.deliver()`:

```typescript
export interface NotificationDeliveryProvider {
  provider: NotificationProviderType;
  deliver(notification: BoardNotificationPayload): Promise<
    | { ok: true; metadata?: Record<string, string> }
    | { ok: false; error: string }
  >;
}
```

The `metadata` field is optional. The Discord provider returns `{ ok: true, metadata: { threadId, channelMessageId } }`. The notification service persists the mapping after successful delivery. Other providers ignore `metadata`.

## Outbound Flow (Notification → Discord Thread)

When a notification fires:

1. **Check for existing thread** — Query `discord_thread_mappings` for the issue ID.
2. **If thread exists** — Post the notification as a new message in the existing thread (not a new thread). This keeps one thread per issue across multiple notification types (assigned, blocked, stalled, question).
3. **If no thread exists** — Post an embed to the configured channel, create a thread on that message named `[{identifier}] {title}`, persist the mapping.

Embed format is the same as the existing `formatDiscordPayload` (color-coded by notification kind, fields for company/status, footer).

Thread naming: `[ACM-42] Fix auth bug` — identifier + title, truncated to Discord's 100-char thread name limit.

## Inbound Flow (Discord Reply → Issue Comment)

The discord.js client listens for `messageCreate` events:

1. **Filter** — Only process messages in threads that exist in the `discord_thread_mappings` table. Ignore messages from the bot itself.
2. **Lookup user** — Match `message.author.id` against `userMappings`. If no match, ignore (don't process messages from unknown Discord users).
3. **Post comment** — Call the internal issue comment creation path, attributed to the matched `paperclipUserId`.
4. **Confirm** — React with ✅ on the Discord message.
5. **Error** — If the comment creation fails (issue deleted, API error), react with ❌ and reply in-thread with a brief error message.

Attachment-only messages (no text content) are skipped silently.

## Discord Client Lifecycle

The Discord provider is structured as a class with explicit lifecycle methods:

```typescript
class DiscordNotificationProvider {
  start(config): Promise<void>    // login, set up event handlers
  stop(): Promise<void>           // client.destroy(), cleanup
  updateConfig(config): void      // update userMappings without reconnecting
  deliver(notification): Promise<...>
}
```

### Hot-Reload Behavior

When `reloadNotificationConfig()` is called:

- **Provider changed to/from "discord"** — Call `stop()` on old client, `start()` on new one.
- **Only userMappings or channelId changed** — Call `updateConfig()` without reconnecting the gateway.
- **Bot token changed** — Full `stop()` + `start()` cycle.

### Server Shutdown

`client.destroy()` is called in the existing server shutdown/cleanup sequence to close the gateway WebSocket cleanly.

### Gateway Intents

Minimal intents: `GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent`. Caching disabled for unnecessary managers (members, presences, etc.) to minimize memory footprint.

## UI Changes

Add Discord fields to the existing NotificationsSection on Instance Settings:

When provider `"discord"` is selected, show:
- Channel ID input
- User mappings (Discord User ID → Paperclip User ID), add/remove rows
- Note: "Set PAPERCLIP_DISCORD_BOT_TOKEN env var before enabling"
- Bot connection status indicator (connected/disconnected/error)

The "Send test notification" button works the same — creates a test thread to verify the full round-trip.

## Files Modified

### Shared Package
- `packages/shared/src/constants.ts` — Add "discord" to NOTIFICATION_PROVIDERS
- `packages/shared/src/config-schema.ts` — Add discordConfigSchema, cross-field validation

### Database
- New migration: `discord_thread_mappings` table
- `packages/db/src/schema.ts` — Add discordThreadMappings table definition

### Server
- `server/src/config.ts` — Add discord fields to NotificationsConfig, resolve bot token from env
- `server/src/services/notifications.ts` — Extend deliver() return type with metadata, create DiscordNotificationProvider class
- `server/src/index.ts` — Initialize/destroy Discord client, update reloadNotificationConfig for lifecycle
- `server/src/routes/instance.ts` — Add Discord connection status endpoint, handle thread mapping persistence after delivery

### UI
- `ui/src/pages/InstanceSettings.tsx` — Add Discord config fields to NotificationsSection
- `ui/src/api/notifications.ts` — Update NotificationsConfig type

## Dependencies

- `discord.js` — Added to server package. Handles gateway WebSocket, reconnection, event handling, rate limiting.

## Not In Scope

- Slash commands or Discord interactions
- Multiple channel support (single channel per instance)
- Attachment forwarding from Discord to Paperclip
- Comment source tagging in Paperclip UI (can add later)
