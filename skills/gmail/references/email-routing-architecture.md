# Email Routing Architecture

## Overview

CivBid uses two separate email paths: Cloudflare Email Routing for receiving, and Google Workspace (Gmail API) for sending.

## Inbound Flow

```
Sender → civ.bid MX (Cloudflare)
  │
  ├── bids@civ.bid → Cloudflare Email Worker → POST /api/email-ingest
  │   (bid packet ingestion — existing pipeline, do not modify)
  │
  ├── test-*@civ.bid → Cloudflare Email Worker → KV storage (1hr TTL)
  │   (E2E test addresses)
  │
  ├── ceo@civ.bid → Cloudflare Email Routing → riley@petersen.us
  │   (Gmail filter auto-labels: paperclip/ceo)
  │
  ├── marketing@civ.bid → Cloudflare Email Routing → riley@petersen.us
  │   (Gmail filter auto-labels: paperclip/marketing)
  │
  ├── engineering@civ.bid → Cloudflare Email Routing → riley@petersen.us
  │   (Gmail filter auto-labels: paperclip/engineering)
  │
  └── *@civ.bid (catch-all) → Email Worker → silently dropped
```

### Key Points

- Cloudflare Email Routing evaluates per-address forwarding rules BEFORE the catch-all email worker
- Agent addresses are forwarded to Riley's Gmail, where filters auto-label by To: address
- The `bids@civ.bid` pipeline is completely separate and must not be modified
- Test addresses (`test-*@civ.bid`) go to the email worker for KV storage

## Outbound Flow

```
Agent heartbeat
  → gws gmail +send --from {agent}@civ.bid
  → Gmail API (OAuth2, Riley's account)
  → Gmail SMTP servers
  → Recipient
```

### Key Points

- Agents send via Gmail API using Riley's OAuth credentials
- `--from` flag sets the send-as alias (e.g., `ceo@civ.bid`)
- SPF/DKIM handled by Google Workspace (civ.bid is a verified domain)
- Replies thread correctly via Gmail's `In-Reply-To` headers

## DNS Records (civ.bid)

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| MX | civ.bid | Cloudflare Email Routing | Inbound mail delivery |
| TXT | civ.bid | v=spf1 ... | SPF (includes Google + Cloudflare) |
| CNAME | google._domainkey.civ.bid | ... | DKIM for Google Workspace |
| TXT | _dmarc.civ.bid | v=DMARC1; p=none | DMARC monitoring |
| MX | mail.civ.bid | Resend SMTP | Outbound transactional (Supabase Auth) |

## Important Boundaries

- **Resend** (`mail.civ.bid`): Transactional email only (auth confirmations, notifications). Separate subdomain.
- **Gmail** (`civ.bid`): Agent communication. Via Google Workspace + gws CLI.
- **Cloudflare Email Worker** (`bids@civ.bid`): Bid packet ingestion. Existing pipeline.
- These three systems are independent and should not be mixed.
