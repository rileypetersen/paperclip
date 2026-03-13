# Notification Settings UI

Per-company notification configuration with webhook support, exposed through the Company Settings UI.

## Problem

The notification system exists on the backend (board_assigned, board_blocked, board_question, board_stalled events) but is only configurable via environment variables. There is no UI. This means board-assigned tasks are invisible to the user unless they actively check the Paperclip dashboard — leading to agents idling overnight because the board didn't know tasks were waiting.

## Solution

1. Move notification config from env vars to a per-company DB column
2. Add a webhook notification provider (Discord/Slack-ready)
3. Add a "Notifications" section to Company Settings

## Data Model

Add `notification_config` JSONB column to the `companies` table (nullable). Null means "use instance-level env var defaults."

```typescript
// packages/db/src/schema/companies.ts
notificationConfig: jsonb("notification_config").$type<{
  provider: "disabled" | "webhook" | "command";
  boardEmails: string[];
  webhookUrl: string | null;
  command?: { path: string; args: string[] };
  stalledThresholdMinutes: number;   // default 240
  stalledCooldownMinutes: number;    // default 1440
}>()
```

Note: `"email"` is removed from provider options. The existing codebase has no email delivery implementation — only `"command"` and `"disabled"`. Adding email delivery is out of scope. If email is needed later, it can be added as a provider.

### Config Resolution

When sending a notification, the service loads the company's `notificationConfig` from DB. If null, falls back to instance-level config from env vars (current behavior preserved). **Company config fully overrides instance config** — there is no merging. If a company has `notificationConfig` set, its `provider`, `boardEmails`, `webhookUrl`, and thresholds are used as-is. Instance-level env vars are only consulted when the column is null.

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

All webhook requests use a 10-second timeout via `AbortSignal.timeout(10000)` to prevent hanging connections from blocking the notification pipeline.

## Company Settings UI

New "Notifications" section on `CompanySettings.tsx`, placed between "Hiring" and "Danger Zone". Follows existing section card pattern.

### Fields

- **Provider** — radio group: Disabled / Webhook / Command
- **Conditional on provider:**
  - Webhook: "Webhook URL" — text input, helper text "Paste a Discord or Slack webhook URL"
  - Command: "Command path" + "Arguments" inputs
- **Stalled work thresholds** (shown when provider is not disabled):
  - "Alert when board tasks are inactive for" — number input (minutes), default 240
  - "Don't re-alert for" — number input (minutes), default 1440
- **Test button** — "Send test notification" to verify config works

### API

- `PATCH /api/companies/:companyId` — extended to accept `notificationConfig` in body (existing route, no new route for CRUD)
- `POST /api/companies/:companyId/notifications/test` — new endpoint, sends a sample `board_assigned` payload through the configured provider, returns `{ ok: true }` or `{ ok: false, error: string }`

## Server Changes

### 1. Migration

```sql
ALTER TABLE companies ADD COLUMN notification_config JSONB;
```

### 2. Webhook provider

New function in `server/src/services/notifications.ts`:

```typescript
export function createWebhookNotificationProvider(webhookUrl: string): NotificationDeliveryProvider {
  return {
    provider: "webhook",
    async deliver(notification) {
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
    },
  };
}
```

Note: The existing `CommandNotificationProvider` interface is renamed to `NotificationDeliveryProvider` since it now covers webhook and command providers. The interface shape is unchanged — only the name.

### 3. Per-company config resolution

Modify `sendNotification()` in `createNotificationService()` to:
1. Load company row (already done — `loadCompany()`)
2. If company has `notificationConfig`, use it to create a provider for this notification
3. If null, use the instance-level provider (current behavior)

This is a small change — the company is already loaded for every notification. We just read an extra column and conditionally override the provider.

### 4. Company update validator

Extend the existing company PATCH validator in `packages/shared/src/validators/company.ts` (Zod schema). Add:

```typescript
const notificationConfigSchema = z.object({
  provider: z.enum(["disabled", "webhook", "command"]),
  boardEmails: z.array(z.string().email()).default([]),
  webhookUrl: z.string().url().nullable().default(null),
  command: z.object({
    path: z.string(),
    args: z.array(z.string()),
  }).optional(),
  stalledThresholdMinutes: z.number().int().min(1).default(240),
  stalledCooldownMinutes: z.number().int().min(1).default(1440),
});
```

Add `notificationConfig: notificationConfigSchema.nullable().optional()` to `updateCompanySchema`.

### 5. Test notification endpoint

`POST /api/companies/:companyId/notifications/test`

Uses `assertBoard(req)` and `assertCompanyAccess(req, companyId)` for authorization (same pattern as other company routes).

Creates a synthetic `board_assigned` notification payload with placeholder data ("Test notification from Paperclip") and delivers it through the company's configured provider. Returns the delivery result.

## Out of Scope

- Per-agent notification preferences
- Notification history UI (activity log already records sent/failed)
- Budget management UI
- Issue prefix editing UI
- Native Slack app integration (webhook covers Slack incoming webhooks)

## Security Notes

- Webhook URLs are an SSRF vector but only board users (trusted) can configure them. Accepted risk for now — only board-authenticated users can set the URL.
- Webhook URL validation requires `https://` or `http://` scheme via the Zod `.url()` validator.

## Files Changed

- `packages/shared/src/constants.ts` — add `"webhook"` to `NOTIFICATION_PROVIDERS`
- `packages/shared/src/validators/company.ts` — add `notificationConfigSchema`, extend `updateCompanySchema`
- `packages/db/src/schema/companies.ts` — add `notificationConfig` JSONB column (add `jsonb` import)
- `packages/db/drizzle/` — new migration
- `server/src/services/notifications.ts` — rename `CommandNotificationProvider` to `NotificationDeliveryProvider`, add webhook provider, per-company config resolution
- `server/src/services/index.ts` — update re-export for renamed provider
- `server/src/__tests__/notifications.test.ts` — update references to renamed interface, add webhook provider tests
- `server/src/routes/companies.ts` — test notification endpoint
- `server/src/config.ts` — add `"webhook"` to provider type references
- `ui/src/pages/CompanySettings.tsx` — Notifications section
