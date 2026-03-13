# Notification Settings UI

Instance-level notification configuration with webhook support, exposed through the Instance Settings UI.

## Problem

The notification system exists on the backend (board_assigned, board_blocked, board_question, board_stalled events) but is only configurable via environment variables. There is no UI. This means board-assigned tasks are invisible to the user unless they actively check the Paperclip dashboard — leading to agents idling overnight because the board didn't know tasks were waiting.

## Solution

1. Add a webhook notification provider (Discord/Slack-ready)
2. Add API endpoints to read/write the instance config file's `notifications` section
3. Add a "Notifications" section to Instance Settings UI
4. Fix the `boardEmails`/`recipients` guard so webhook-only configs work

## Architecture

**No DB migration. No per-company config. No schema changes.**

The config file system already has:
- A `notifications` section in the config schema (`packages/shared/src/config-schema.ts`)
- `readConfig()` / `writeConfig()` in `cli/src/config/store.ts`
- The server reads config at startup via `readConfigFile()` in `server/src/config-file.ts`

We add `"webhook"` as a provider, expose read/write of the notifications config via API, and build a UI on Instance Settings.

**Config hot-reload:** The notification service uses a mutable ref pattern. `notificationService` is wrapped in `{ current: notificationService }` so consumers access it via `notificationRef.current`. After the UI saves config, the server re-reads the config file, creates a new notification service, and swaps `notificationRef.current`. No server restart required. Consumers that hold the ref (issue routes, stalled-work timer) automatically see the new service.

## Webhook Provider

New provider: `createWebhookNotificationProvider()`.

POSTs to the configured `webhookUrl`. Detects Discord webhook URLs (`discord.com/api/webhooks/`) and formats as Discord embeds:

```typescript
// Discord format
{
  embeds: [{
    title: `[${kind}] ${identifier} ${title}`,
    description: reason,
    url: issueUrl,
    color: kindToColor(kind),  // 0xED4245 blocked, 0xFEE75C stalled, 0x5865F2 assigned, 0x57F287 question
    fields: [
      { name: "Company", value: companyName, inline: true },
      { name: "Status", value: status, inline: true },
    ],
    footer: { text: "Paperclip Board Notification" },
  }]
}
```

Non-Discord URLs receive the raw `BoardNotificationPayload` as JSON with `Content-Type: application/json`.

All webhook requests use a 10-second timeout via `AbortSignal.timeout(10000)` and a try/catch around the fetch call to handle network errors (DNS failure, connection refused).

```typescript
export function createWebhookNotificationProvider(webhookUrl: string): NotificationDeliveryProvider {
  return {
    provider: "webhook",
    async deliver(notification) {
      try {
        const isDiscord = webhookUrl.includes("discord.com/api/webhooks/");
        const body = isDiscord ? formatDiscordPayload(notification) : notification;
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          return { ok: false, error: `Webhook returned ${response.status}` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
```

The existing `CommandNotificationProvider` interface is renamed to `NotificationDeliveryProvider` since it now covers webhook and command providers. The interface shape is unchanged — only the name.

## Recipients Guard Fix

Currently `sendNotification()` (line 340 of notifications.ts) returns early if `recipients.length === 0`. This blocks webhook-only configs where `boardEmails` is empty (reasonable — you're using Discord, not email). Fix: skip the recipients check when provider is `"webhook"`.

```typescript
// Before:
if (input.config.provider === "disabled" || recipients.length === 0 || !baseUrl) {
  return false;
}

// After:
if (input.config.provider === "disabled" || !baseUrl) {
  return false;
}
if (recipients.length === 0 && input.config.provider !== "webhook") {
  return false;
}
```

## Instance Settings UI

New "Notifications" section on `InstanceSettings.tsx`, added below the existing Heartbeats section. Also add "Notifications" to the `InstanceSidebar.tsx` nav.

### Fields

- **Provider** — radio group: Disabled / Webhook / Command
- **Conditional on provider:**
  - Webhook: "Webhook URL" — text input, helper text "Paste a Discord or Slack webhook URL"
  - Command: "Command path" + "Arguments" inputs
- **Board notification emails** (shown when provider is not disabled) — comma-separated input, optional for webhook
- **Stalled work thresholds** (shown when provider is not disabled):
  - "Alert when board tasks are inactive for" — number input (minutes), default 240
  - "Don't re-alert for" — number input (minutes), default 1440
- **Save button** — saves config and triggers hot-reload
- **Test button** — "Send test notification" to verify config works (shown after save when provider is not disabled)

### API Endpoints

Two new instance-level routes:

**`GET /api/instance/notifications`** — reads config file, returns the `notifications` section. No auth needed beyond instance access (same as `/api/instance/scheduler-heartbeats`).

**`PATCH /api/instance/notifications`** — validates body against `notificationsConfigSchema` (extended with `webhookUrl`), reads full config file, merges the notifications section, writes config file back, triggers hot-reload of the notification service. Returns updated config.

**`POST /api/instance/notifications/test`** — sends a synthetic `board_assigned` notification through the currently configured provider. Returns `{ ok: true }` or `{ ok: false, error: string }`.

## Server Changes

### 1. Add "webhook" to NOTIFICATION_PROVIDERS

In `packages/shared/src/constants.ts`, add `"webhook"` to the `NOTIFICATION_PROVIDERS` array. This flows through to `config-schema.ts` automatically since it uses the constant.

### 2. Extend notifications config schema

In `packages/shared/src/config-schema.ts`, add `webhookUrl` to `notificationsConfigSchema`:

```typescript
export const notificationsConfigSchema = z.object({
  provider: z.enum(NOTIFICATION_PROVIDERS).default("disabled"),
  boardEmails: z.array(z.string().email()).default([]),
  webhookUrl: z.string().url().optional(),  // NEW
  command: notificationsCommandConfigSchema.default({ args: [] }),
  stalledThresholdMinutes: z.number().int().min(1).max(7 * 24 * 60).default(240),
  stalledCooldownMinutes: z.number().int().min(1).max(30 * 24 * 60).default(1440),
});
```

### 3. Webhook provider function

New `createWebhookNotificationProvider()` in `server/src/services/notifications.ts` (see code above).

### 4. Config hot-reload via mutable ref

The notification service is currently created as a `const` and captured by closure in two places:
1. Issue routes (via `createApp` -> `issueRoutes`)
2. The `setInterval` stalled-work timer

To support hot-reload without restart, wrap in a mutable ref:

```typescript
// server/src/index.ts
const notificationRef = { current: createNotificationService({ ... }) };
```

All consumers access `notificationRef.current` instead of `notificationService` directly. The PATCH endpoint swaps the ref:

```typescript
function reloadNotificationConfig() {
  const fileConfig = readConfigFile();
  const newConfig = resolveNotificationsConfig(fileConfig?.notifications);
  notificationRef.current = createNotificationService({ db, config: newConfig, ... });
}
```

This requires updating `issueRoutes` to accept the ref (or a getter function like `() => notificationRef.current`) and the `setInterval` callback to dereference through the ref.

### 5. Update `resolveNotificationsConfig()` and `NotificationsConfig` in `server/src/config.ts`

Add `webhookUrl?: string` to the `NotificationsConfig` interface. Update `resolveNotificationsConfig()` to:
- Read `webhookUrl` from file config (and `PAPERCLIP_NOTIFICATIONS_WEBHOOK_URL` env var for parity)
- Return it in the config object
- When provider is `"webhook"`, the notification service construction code uses `createWebhookNotificationProvider(config.webhookUrl)` instead of `createCommandNotificationProvider()`.

### 6. Instance notification routes

New route file `server/src/routes/instance.ts` (not agents.ts — that file is already massive). Three endpoints: GET, PATCH, POST test. The route factory needs: `db`, config file path, and a `reloadNotificationConfig` callback.

`@paperclipai/cli` is NOT a server dependency. Add `writeConfigFile()` alongside the existing `readConfigFile()` in `server/src/config-file.ts`. Must handle:
- Creating `.backup` before overwriting (same as CLI's writeConfig)
- Setting `0o600` permissions
- Rejecting writes when `readConfigFile()` returns null due to parse errors (don't silently overwrite a malformed config — return an error to the UI)

The test endpoint fabricates a synthetic notification with the first real company from the DB (query `companies` table, `LIMIT 1`). Uses a fresh provider built from current config rather than the potentially-stale service instance.

Add cross-field validation to `notificationsConfigSchema`: if `provider === "webhook"`, `webhookUrl` is required.

## Out of Scope

- Per-company notification config (single instance, single company)
- Per-agent notification preferences
- Notification history UI (activity log already records sent/failed)
- Email provider (no email delivery implementation exists)
- Native Slack app integration (webhook covers Slack incoming webhooks)
- DB migration

## Security Notes

- Webhook URLs are an SSRF vector but only instance admins (trusted) can configure them via the UI. Accepted risk.
- Test endpoint should not be spammable — one test per 10 seconds (simple in-memory cooldown).

## Files Changed

- `packages/shared/src/constants.ts` — add `"webhook"` to `NOTIFICATION_PROVIDERS`
- `packages/shared/src/config-schema.ts` — add `webhookUrl` to `notificationsConfigSchema`
- `server/src/services/notifications.ts` — rename `CommandNotificationProvider` to `NotificationDeliveryProvider`, add `createWebhookNotificationProvider()`, fix recipients guard
- `server/src/services/index.ts` — update re-export for renamed interface
- `server/src/config.ts` — handle `"webhook"` provider in `resolveNotificationsConfig()`
- `server/src/config-file.ts` — add `writeConfigFile()` function
- `server/src/index.ts` — add `reloadNotificationConfig()` for hot-reload
- `server/src/routes/instance.ts` — new file: GET/PATCH/POST notification config endpoints
- `server/src/routes/index.ts` — register instance routes
- `server/src/__tests__/notifications.test.ts` — update renamed interface, add webhook provider tests
- `server/src/__tests__/notification-config.test.ts` — add webhook provider config test
- `ui/src/pages/InstanceSettings.tsx` — Notifications section (same page, below Heartbeats)
- `ui/src/components/InstanceSidebar.tsx` — add Notifications nav anchor
- `ui/src/api/` — add notifications API client (queryKeys + fetch functions)
