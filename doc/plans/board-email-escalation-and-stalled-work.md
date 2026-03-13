# Board Email Escalation and Stalled-Work Notifications

## Summary

Implement a generic server-side notification service for Paperclip with a single v1 delivery provider: `command`. Use it to send email notifications to the Board when:

- an issue is assigned to a human board user
- a board-assigned issue becomes blocked
- an agent posts an explicit board question on a board-assigned issue
- a board-assigned issue becomes stale

Keep the feature upgrade-friendly by using instance-level config only, no UI changes, no new DB tables, and no REST API changes. Reuse the existing activity log for notification auditing and dedupe. Ship a local `gws` command bridge script in the repo so a fork can wire Gmail delivery without hard-coding Gmail into core Paperclip.

## Key Changes

### 1. Add a generic notification service and config

Add a new server notification subsystem with a provider interface and one implementation:

- Provider types:
  - `disabled`
  - `command`
- New config section in server config/env:
  - `notifications.provider`
  - `notifications.boardEmails`
  - `notifications.command.path`
  - `notifications.command.args`
  - `notifications.stalledThresholdMinutes`
  - `notifications.stalledCooldownMinutes`
- Env overrides:
  - `PAPERCLIP_NOTIFICATIONS_PROVIDER`
  - `PAPERCLIP_BOARD_NOTIFICATION_EMAILS`
  - `PAPERCLIP_NOTIFICATIONS_COMMAND`
  - `PAPERCLIP_STALLED_WORK_THRESHOLD_MINUTES`
  - `PAPERCLIP_STALLED_WORK_COOLDOWN_MINUTES`

Defaults:

- provider: `disabled`
- boardEmails: empty
- stalledThresholdMinutes: `240`
- stalledCooldownMinutes: `1440`

Board recipient routing for v1:

- Treat any issue with `assigneeUserId != null` as "assigned to the Board/human operator".
- Send all board notifications to the configured `boardEmails`.
- Do not attempt per-user email routing in v1.

Public/base URL for links:

- Use `authPublicBaseUrl` when configured.
- Otherwise fall back to the runtime server URL.
- Issue links must use the existing board route shape: `/issues/:issueId`.

### 2. Define the v1 notification contract

Create a single internal notification shape and pass it to providers. For the `command` provider:

- Invoke the configured executable once per notification.
- Pass a JSON payload on `stdin`.
- Treat exit code `0` as success, non-zero as failure.
- Do not throw from request handlers or scheduler loops if delivery fails; log activity and continue.

Required JSON payload fields:

- `kind`: `board_assigned | board_blocked | board_question | board_stalled`
- `notificationId`: deterministic dedupe id
- `company`: `{ id, name, issuePrefix }`
- `issue`: `{ id, identifier, title, status, url }`
- `recipients`: `string[]`
- `trigger`: `{ detectedAt, reason, thresholdMinutes? }`
- `comment`: optional `{ id, bodySnippet, authorType, authorId }`
- `email`: `{ subject, text }`

Subject templates:

- `board_assigned`: `[Paperclip][Board] New assignment: {identifier} {title}`
- `board_blocked`: `[Paperclip][Board] Blocked: {identifier} {title}`
- `board_question`: `[Paperclip][Board] Question: {identifier} {title}`
- `board_stalled`: `[Paperclip][Board] Stalled: {identifier} {title}`

Text body must include:

- company name
- issue identifier/title/status
- why this email was sent
- latest relevant comment snippet if present
- direct issue URL

### 3. Integrate notification triggers into existing flows

Hook notifications into current issue/comment/scheduler behavior.

Immediate triggers in issue routes/services:

- `board_assigned`
  - Fire when an issue is created with `assigneeUserId != null`
  - Fire when an issue update changes `assigneeUserId` from null/other to a non-null user id
  - Do not fire on edits that keep the same assignee
- `board_blocked`
  - Fire when an issue update changes status to `blocked` and `assigneeUserId != null`
  - Also fire when a new comment on a board-assigned issue contains the explicit marker `BOARD-BLOCKED:`
- `board_question`
  - Fire when a new comment on a board-assigned issue contains the explicit marker `BOARD-QUESTION:`

Marker rules:

- Match case-insensitively at line start after optional whitespace.
- Accept first matching line as the summary line.
- Include up to the first 280 chars of the full comment in the email snippet.
- Do not use punctuation heuristics for v1; only explicit markers trigger question/blocker emails from comments.

Stalled-work trigger in scheduler:

- Extend the existing server interval loop with `notificationService.tickBoardStalledIssues(now)`.
- Query issues where:
  - `assigneeUserId != null`
  - `status in ('todo', 'in_progress', 'blocked')`
  - `hiddenAt is null`
  - `updatedAt <= now - stalledThresholdMinutes`
- For v1, use `updatedAt` as the stall signal.
- Send `board_stalled` only if dedupe/cooldown rules allow it.

### 4. Use activity log as the dedupe and audit ledger

Do not add a new notifications table in v1. Reuse `activity_log`.

Write activity records for:

- `notification.sent`
- `notification.failed`

Use `entityType: "issue"` and `entityId: issue.id`.

Required activity details:

- `kind`
- `notificationId`
- `provider`
- `recipients`
- `commentId` if present
- `issueUpdatedAt`
- `error` on failure

Dedupe rules:

- `board_assigned`: dedupe by `issueId + kind + issueUpdatedAt`
- `board_blocked` from status change: dedupe by `issueId + kind + issueUpdatedAt`
- `board_blocked` from comment marker: dedupe by `issueId + kind + commentId`
- `board_question`: dedupe by `issueId + kind + commentId`
- `board_stalled`: dedupe by `issueId + kind + issueUpdatedAt`, but allow resend after `stalledCooldownMinutes` if the issue is still stale and `updatedAt` has not changed

### 5. Ship a local Gmail bridge and agent guidance

Add a repo-local notification bridge script for forks:

- Suggested path:
  - `scripts/notifications/send-board-email-via-gws.mjs`
- Behavior:
  - read the JSON payload from stdin
  - send one email via `gws gmail users messages send`
  - use `email.subject`, `email.text`, and `recipients`
  - exit non-zero on failure
- Script env:
  - `PAPERCLIP_NOTIFICATION_FROM_EMAIL`
  - `PAPERCLIP_NOTIFICATION_FROM_NAME`

Add lightweight agent guidance so agents know how to escalate:

- Add a small skill or doc entry instructing agents to use:
  - `BOARD-QUESTION: <one-line ask>`
  - `BOARD-BLOCKED: <one-line blocker>`
- Guidance should say:
  - use these only on issues assigned to the Board/human
  - still set issue status to `blocked` when blocked
  - include the exact action needed from the Board

## Public Interfaces and Non-Goals

Public changes:

- config schema/types gain the `notifications` section
- no REST API changes
- no UI changes
- no DB migrations in v1

Explicit non-goals for this implementation:

- no SMTP provider
- no webhook provider
- no per-user recipient resolution
- no inbox/digest UI
- no automatic email reply ingestion
- no heuristic question detection beyond explicit markers

## Test Plan

Add focused tests for:

- config parsing
  - disabled by default
  - board email list parsing
  - threshold/cooldown parsing
- command provider
  - passes JSON on stdin
  - success path logs `notification.sent`
  - failure path logs `notification.failed`
  - failures do not break route responses or scheduler passes
- assignment trigger
  - create with `assigneeUserId` sends once
  - reassignment to user sends once
  - non-assignment edits do not send
- blocked trigger
  - status transition to `blocked` sends once
  - repeat patch without change does not resend
- question/blocker marker parsing
  - `BOARD-QUESTION:` sends
  - `BOARD-BLOCKED:` sends
  - case-insensitive match works
  - plain question marks do not send
- stalled-work tick
  - stale issue past threshold sends
  - fresh issue does not send
  - repeated ticks within cooldown do not resend
  - resend after cooldown works if still stale
  - issue update resets the stall epoch
- link generation
  - uses public base URL when configured
  - falls back to runtime base URL otherwise

## Assumptions and Defaults

- Intended handoff doc path: `doc/plans/board-email-escalation-and-stalled-work.md`
- V1 treats all human-assigned issues as Board-assigned because current Paperclip product assumptions center on a single human board operator.
- Activity log is the only persistence used for notification history in v1.
- The local Gmail bridge is repo-local and optional; Paperclip core only knows about the generic `command` provider.
- This feature is intentionally scoped to emailing the Board, not general-purpose human notifications.
