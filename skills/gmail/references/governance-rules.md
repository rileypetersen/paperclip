# Gmail Governance Rules

## Classification

### Internal (send freely)

Any email to these addresses requires no approval:

- `*@civ.bid` — all agent addresses and system addresses
- `riley@petersen.us` — Riley's Workspace account
- `rileypetersen7@gmail.com` — Riley's personal Gmail

### External (approval required)

Any address not in the internal list above. Before sending:

1. Create a Paperclip task or approval request with:
   - Recipient address
   - Subject line
   - Purpose/reason for the email
   - Draft body (or summary)
2. Wait for approval status
3. Send only after approval is granted

**Reply exception:** If an external sender initiated the conversation (they emailed you first), you may reply without approval. You are continuing an existing thread, not initiating cold outreach.

## Rate Limits

| Limit | Value | Scope |
|-------|-------|-------|
| Outbound per heartbeat | 3 | Per agent, per heartbeat run |
| Total daily (Gmail API) | 2,000 | Shared across all agents (Google Workspace limit) |

If you hit the per-heartbeat limit, queue remaining sends as a follow-up task.

## Prohibited Content

Never include in any email (internal or external):

- API keys, tokens, passwords, secrets
- Service account credentials or key file contents
- Internal URLs (`localhost`, staging, admin paths, Paperclip API URLs)
- Paperclip run IDs, agent IDs, or internal system identifiers
- Database connection strings or credentials
- Source code snippets containing secrets

## Approval Escalation

If unsure whether a recipient is internal or external, treat it as external and request approval. False positives are cheap; unauthorized external emails are not.

## Audit Trail

All email activity should be logged in Paperclip task comments:

- When you send an email, note the recipient and subject
- When you receive and act on an email, note the sender and action taken
- When you request approval for external email, link the approval

This creates a paper trail for governance review.
