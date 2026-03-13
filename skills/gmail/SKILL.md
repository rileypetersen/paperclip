---
name: gmail
description: >
  Use this skill to send, read, reply to, search, or forward email via Gmail.
  Use when you need to email someone, check your inbox, reply to a message,
  forward a thread, or communicate with anyone outside Paperclip via email.
  Covers send-as aliases, inbox triage, threading, and governance rules for
  external recipients. Use whenever someone says "send an email", "check my
  inbox", "reply to that email", "email Riley about X", or any email-related
  task. NOT for Slack, issue comments, or other non-email communication.
---

# Gmail Skill

Send and receive email as your `@civ.bid` agent address using the `gws` CLI (Google Workspace CLI). Each agent has a dedicated alias (e.g., `ceo@civ.bid`, `marketing@civ.bid`) routed through Riley's Google Workspace account.

## Authentication

**No per-agent auth required.** Riley's OAuth credentials are cached at `~/.config/gws/` and shared by all local agents. The `gws` CLI picks them up automatically.

Your agent email is available via the `AGENT_EMAIL` env var (e.g., `ceo@civ.bid`). Always use this — never hard-code an email address.

If you get a 401 auth error, **do not attempt to fix it**. Post a blocked comment on your current task: "gws auth expired — Riley needs to run `gws auth login -s gmail`".

## Sending Email

Use the bundled send script for reliable RFC 2822 + base64url encoding:

```bash
skills/gmail/scripts/send-email.sh \
  --to "recipient@example.com" \
  --subject "Subject line" \
  --body "Body text here"
```

**Multiple recipients** with Cc/Bcc:

```bash
skills/gmail/scripts/send-email.sh \
  --to "alice@example.com,bob@example.com" \
  --cc "carol@example.com" \
  --bcc "dave@example.com" \
  --subject "Subject" \
  --body "Body text"
```

The script uses `AGENT_EMAIL` and `AGENT_ROLE` env vars automatically. Override with `--from` and `--role` flags.

**Raw API (for understanding):** The script builds an RFC 2822 message with From/To/Cc/Bcc/Subject headers, base64url-encodes it, and calls `gws gmail users messages send --json '{"raw": "..."}'`. Gmail sends using the matching send-as alias.

## Reading Your Inbox

Use the bundled check script for common inbox operations:

```bash
skills/gmail/scripts/check-inbox.sh              # Unread mail to you (default)
skills/gmail/scripts/check-inbox.sh --all         # All mail to you
skills/gmail/scripts/check-inbox.sh --from "riley@petersen.us"  # From specific sender
skills/gmail/scripts/check-inbox.sh --max 20      # More results
```

Or use `+triage` directly for custom queries:

```bash
gws gmail +triage --query "to:$AGENT_EMAIL" --max 10
```

Common query patterns:

| Goal | Query |
|------|-------|
| All mail to you | `to:$AGENT_EMAIL` |
| Unread only | `to:$AGENT_EMAIL is:unread` |
| From Riley | `to:$AGENT_EMAIL from:riley@petersen.us` |
| From another agent | `to:$AGENT_EMAIL from:ceo@civ.bid` |
| Recent (last 24h) | `to:$AGENT_EMAIL newer_than:1d` |
| With attachments | `to:$AGENT_EMAIL has:attachment` |
| Keyword search | `to:$AGENT_EMAIL subject:budget` |

**Reading a specific message** (use the message ID from triage output):

```bash
gws gmail users messages get --params '{"userId": "me", "id": "MESSAGE_ID"}'
```

## Replying to Email

```bash
gws gmail +reply \
  --message-id "MESSAGE_ID" \
  --body "Reply text here" \
  --from "$AGENT_EMAIL"
```

Reply-all:

```bash
gws gmail +reply-all \
  --message-id "MESSAGE_ID" \
  --body "Reply text here" \
  --from "$AGENT_EMAIL"
```

Threading is handled automatically — `In-Reply-To` and `References` headers are set by gws.

## Forwarding Email

```bash
gws gmail +forward \
  --message-id "MESSAGE_ID" \
  --to "recipient@example.com" \
  --body "FYI — see below" \
  --from "$AGENT_EMAIL"
```

## Searching Email

For advanced searches beyond `+triage`, use the raw messages list API:

```bash
gws gmail users messages list --params '{"userId": "me", "q": "to:$AGENT_EMAIL subject:invoice", "maxResults": 5}'
```

This returns message IDs. Fetch full content with `users messages get`.

## Governance Rules

### Internal emails — send freely

Internal recipients (no approval needed):

- Any `@civ.bid` address (other agents, `bids@civ.bid`)
- `riley@petersen.us` or `rileypetersen7@gmail.com` (Riley's personal addresses)

### External emails — require Paperclip approval

Any recipient NOT in the internal list above requires approval before sending. To request approval:

1. Create a Paperclip approval request describing the email (recipient, subject, purpose)
2. Wait for approval before sending
3. If the approval is denied, do not send

**Exception:** Replying to an external sender who emailed you first does NOT require approval (you're continuing an existing conversation).

### Rate limit

**Maximum 3 outbound emails per heartbeat.** If you need to send more, create a follow-up task for the next heartbeat.

### Never send

- API keys, passwords, tokens, or any credentials
- Internal URLs (localhost, staging, admin endpoints)
- Service account keys or config file contents
- Paperclip API keys or run IDs

## Email Signature

Always end outbound emails with a signature block:

```
—
{Your Role}, CivBid
{agent}@civ.bid
```

Example for CEO:

```
—
CEO, CivBid
ceo@civ.bid
```

## Heartbeat Email Workflow

On each heartbeat where you have email-related tasks or want to check for messages:

1. **Check inbox**: `gws gmail +triage --query "to:$AGENT_EMAIL is:unread" --max 10`
2. **Process messages**: Read, reply, or forward as needed
3. **Send outbound**: Compose and send any queued emails (max 3)
4. **Log activity**: Comment on relevant Paperclip tasks about email sent/received

## Cross-Agent Email

Agents can email each other at their `@civ.bid` addresses. This is useful for:

- Formal requests that need a paper trail
- Sharing information with agents who aren't on the same Paperclip task
- External-facing threads where multiple agents need visibility

For routine coordination, prefer Paperclip task comments over email.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| 401 auth error | Riley needs to run `gws auth login -s gmail` — post blocked comment |
| "Mail delivery failed" on send | Check that the recipient address is valid; verify send-as alias is configured |
| No messages in triage | Verify query syntax; try broader query without `is:unread` |
| "From address not allowed" | Send-as alias not configured for your agent address — post blocked comment |
| Message not threaded | Ensure you're using `+reply` (not `+send`) for responses |

## Full Reference

For gws CLI command details, see: `skills/gmail/references/gws-cli-reference.md`
For email routing architecture, see: `skills/gmail/references/email-routing-architecture.md`
For governance details, see: `skills/gmail/references/governance-rules.md`
