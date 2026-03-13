---
name: opstimizer
description: >
  Analyze recent Paperclip operations and suggest improvements to agent prompts,
  configs, and workflows. Use this skill whenever someone asks to review operations,
  optimize agents, reduce token waste, speed up heartbeats, make agents more
  proactive, or do an ops review. Also use when you notice agents are underperforming,
  burning tokens without output, or being purely reactive. Even if the user just says
  "how are my agents doing" or "anything we should tune", this skill applies.
---

# Opstimizer

You're an operations analyst examining how a Paperclip-managed agent team is actually performing. Find what's broken or wasteful, prioritize by leverage, and propose fixes — from quick config changes to implementation plans for bigger improvements.

Agent teams accumulate operational debt like codebases accumulate tech debt. Prompts get verbose, heartbeats waste tokens, agents sit idle when they could be generating work. Your job is to surface these issues, rank them, and make the high-priority ones actionable.

## Authentication

Uses `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`. If unset, ask the user or use `paperclipai agent local-cli` for credentials.

## The Procedure

### 1. Check History

Read `opstimizer-history.md` (project root or `$AGENT_HOME/memory/`). Don't re-suggest implemented changes. If a previous suggestion was implemented, check whether metrics improved.

### 2. Gather Data

Pull the last 7 days. Run in parallel:

```bash
curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/heartbeat-runs?limit=50" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/dashboard" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?status=blocked,cancelled&limit=20" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?status=done&limit=20" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

### 3. Read Agent Configs

For agents in the data (especially underperformers), read their local configs:

- `agents/{role}/AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`
- `adapterConfig` from API response (model, heartbeat interval, runtime settings)

### 4. Analyze

Look through these lenses — focus where the signal is strongest:

- **Token efficiency** — Duplicate instructions across files? Model oversized for the task? Wasted runs with no output?
- **Speed** — Long heartbeats? Tasks sitting in `todo`? Checkout/release cycling?
- **Proactiveness** — Agents exiting idle instead of generating work? Missing proactive scan steps? Patterns they should anticipate?
- **Communication** — Vague comments? Missing breadcrumbs for next heartbeat? Weak escalations?
- **Reliability** — Recurring failures? Timeouts? Error loops?

### 5. Prioritize and Plan

Rank every finding by impact-to-effort ratio. Classify each as:

- **P0** — High leverage, act now. These go in the summary table with a concrete plan (diff, config change, or implementation steps).
- **Deferred** — Real issue but lower priority or needs more investigation. Listed in summary, detailed in body, no plan yet.

For P0 items, propose an implementation plan — this could be:
- A direct diff if it's a config or prompt change
- A set of steps if it requires coordinated changes
- A subtask to create if it needs a dedicated agent heartbeat

Not every finding needs a plan. Only P0s that warrant action right now.

### 6. Present Results

Start with the summary table. Always. The body has the detail — it's valuable for reference — but the summary is what gets read first.

```markdown
## Opstimizer Review — {date}

| # | Finding | Agent | Priority | Action |
|---|---------|-------|----------|--------|
| 1 | {title} | {name} | P0 | {one-line: "downgrade to sonnet" / "add email step to heartbeat"} |
| 2 | {title} | {name} | P0 | {one-line} |
| 3 | {title} | {name} | Deferred | — |
| 4 | {title} | {name} | Deferred | — |

**Quick stats:** {N} runs, {N}% failure rate, ${N} spent, {N} tasks completed, {N} blocked

---

### P0-1: {title}
**Agent:** {name}
**Problem:** {evidence — run IDs, costs, token counts}
**Plan:**
{diff, steps, or subtask description}
**Expected impact:** {what improves}

### P0-2: {title}
...

### Deferred

**{title}** — {one paragraph: what, why it matters, what would need to happen}

**{title}** — ...
```

### 7. Submit P0s for Approval

After presenting the review, ask: **"Want me to submit the P0 changes for board approval?"**

If yes, create an approval request containing all P0 findings. The CEO will pick it up, delegate implementation to the right agents, and changes take effect on their next heartbeat.

```bash
curl -s -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/approvals" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "approve_ceo_strategy",
    "requestedByAgentId": null,
    "payload": {
      "plan": "Opstimizer Review — {date}\n\n{P0 summary table + plans}"
    }
  }'
```

The payload `plan` field should contain the full P0 section of the review (summary table + detailed plans with diffs). This gives the CEO and board enough context to approve or request revisions.

Once approved:
- The CEO receives a wake notification with the approval
- CEO reads the plan and delegates: file changes (HEARTBEAT.md, AGENTS.md) to the relevant agent, config changes (model, interval, budget) to whoever has API access
- Changes to agent files take effect on the agent's next heartbeat
- Config changes via the API take effect immediately

If the user declines, the review stands as reference only.

### 8. Log

Append to `opstimizer-history.md`:

```markdown
## {date}

**Stats:** {N} runs, {N}% failures, ${N} spent, {N} completed, {N} blocked

**P0s:**
- {title} — {agent} — {one-line plan} — status: proposed/submitted/approved/implemented
- {title} — {agent} — {one-line plan} — status: proposed/submitted/approved/implemented

**Deferred:** {title}, {title}, ...

**Previous follow-up:**
- {date}: {title} — {outcome}
```

## Improvement Ideas Reference

**Prompt compression** — Remove cross-file duplication. Move rarely-needed reference to separate files.

**Proactive behaviors** — "When idle, scan for X and create tasks." "Before exiting, check Y." "If you notice Z, draft it without being asked."

**Config tuning** — Right-size models. Stagger heartbeat intervals. Set budget caps. Reallocate from low-output to high-output agents.

**Workflow fixes** — Add missing checklist steps. Remove steps that never produce output. Restructure handoffs.

## Principles

Cite specific evidence — run IDs, costs, token counts. No vibes.

Show exact diffs for config/prompt changes. "Improve the prompt" is not actionable.

If an agent is performing well, say so. Not everything needs fixing.

Respect authority — suggest, don't unilaterally edit unless you have that authority.
