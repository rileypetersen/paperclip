# gws CLI Reference (v0.11)

Quick reference for the `gws` CLI Gmail commands used by Paperclip agents.

## Helper Commands (Recommended)

These are high-level convenience commands that handle formatting, encoding, and threading automatically.

### Send

**Note:** `+send` does NOT support `--from`, so it always sends as `riley@petersen.us`. To send as your agent alias, use the raw API (see "Send as Alias" under Raw API Commands below).

```bash
gws gmail +send --to <EMAILS> --subject <SUBJECT> --body <TEXT> [--cc <EMAILS>] [--bcc <EMAILS>]
```

- `--to`: Comma-separated recipient addresses (required)
- `--subject`: Email subject line (required)
- `--body`: Plain text body (required)
- `--cc`, `--bcc`: Comma-separated CC/BCC addresses
- `--dry-run`: Preview without sending

### Triage (Read Inbox)

```bash
gws gmail +triage [--query <QUERY>] [--max <N>] [--format <FMT>] [--labels]
```

- `--query`: Gmail search query (default: `is:unread`)
- `--max`: Max messages to show (default: 20)
- `--format`: Output format — `json`, `table`, `yaml`, `csv` (default: table for triage)
- `--labels`: Include label names in output
- Read-only, never modifies mailbox

### Reply

```bash
gws gmail +reply --message-id <ID> --body <TEXT> [--from <EMAIL>] [--to <EMAILS>] [--cc <EMAILS>] [--bcc <EMAILS>]
```

- `--message-id`: Gmail message ID to reply to (required)
- `--body`: Reply body text (required)
- `--from`: Send-as alias for the reply
- Auto-sets `In-Reply-To`, `References`, and `threadId`
- Quotes original message

### Reply All

```bash
gws gmail +reply-all --message-id <ID> --body <TEXT> [--from <EMAIL>] [--cc <EMAILS>] [--bcc <EMAILS>]
```

Same as `+reply` but replies to all original recipients.

### Forward

```bash
gws gmail +forward --message-id <ID> --to <EMAILS> [--from <EMAIL>] [--cc <EMAILS>] [--bcc <EMAILS>] [--body <TEXT>]
```

- `--message-id`: Message to forward (required)
- `--to`: Forward recipients (required)
- `--body`: Optional note above forwarded content

## Raw API Commands

For operations not covered by helpers.

### Send as Alias (Required for Agent Email)

Build a base64url-encoded RFC 2822 message with your agent's From address:

```bash
RAW=$(printf 'From: %s <%s>\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s' \
  "$AGENT_ROLE" "$AGENT_EMAIL" \
  "recipient@example.com" \
  "Subject line" \
  "Body text" \
  | base64 | tr '+/' '-_' | tr -d '=\n')

gws gmail users messages send \
  --params '{"userId": "me"}' \
  --json "{\"raw\": \"$RAW\"}"
```

Gmail matches the From address to a configured send-as alias and sends accordingly.

### List Messages

```bash
gws gmail users messages list --params '{"userId": "me", "q": "<gmail-search-query>", "maxResults": 10}'
```

Returns message IDs and thread IDs. Use `messages get` to fetch full content.

### Get Message

```bash
gws gmail users messages get --params '{"userId": "me", "id": "<message-id>"}'
```

Returns full message including headers, body, and attachments.

### List Labels

```bash
gws gmail users labels list --params '{"userId": "me"}'
```

### Modify Message Labels

```bash
gws gmail users messages modify --params '{"userId": "me", "id": "<message-id>"}' --json '{"addLabelIds": ["LABEL_ID"], "removeLabelIds": ["UNREAD"]}'
```

## Output Formats

All commands support `--format`:
- `json` (default for API commands) — machine-readable
- `table` (default for helpers) — human-readable
- `yaml`, `csv` — alternative formats

For programmatic parsing, always use `--format json`.

## Gmail Search Query Syntax

Used in `--query` (helpers) and `q` param (raw API):

| Operator | Example | Description |
|----------|---------|-------------|
| `from:` | `from:riley@petersen.us` | Sender |
| `to:` | `to:ceo@civ.bid` | Recipient |
| `subject:` | `subject:budget` | Subject contains |
| `is:unread` | `is:unread` | Unread messages |
| `is:starred` | `is:starred` | Starred messages |
| `has:attachment` | `has:attachment` | Has attachments |
| `newer_than:` | `newer_than:1d` | Within time period (d/m/y) |
| `older_than:` | `older_than:7d` | Older than period |
| `label:` | `label:paperclip/ceo` | Has label |
| `in:inbox` | `in:inbox` | In inbox |
| `""` | `"exact phrase"` | Exact match |
| `-` | `-from:noreply` | Exclude |
| `OR` | `from:alice OR from:bob` | Either match |

Combine operators: `to:ceo@civ.bid is:unread newer_than:1d`

## Authentication

gws reads credentials from `~/.config/gws/`. Auth is managed by Riley via `gws auth login -s gmail`. Agents should never attempt to modify auth state.

Environment variable override: `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` or `GOOGLE_APPLICATION_CREDENTIALS`.
