---
name: strategic-planning
description: >
  Plan and propose strategic initiatives for a Paperclip company. Use when the CEO
  (or any leadership agent) needs to propose a growth idea, plan a new initiative,
  scope a project, or create a structured proposal for board approval. Covers:
  goal creation, task tree breakdown, budget estimation, hiring recommendations,
  board action items, and approval submission. Use whenever an agent says "plan a
  project", "propose an initiative", "growth idea", "I want to launch X", "create
  a project plan", or needs to turn a strategic idea into an actionable, funded,
  staffed plan with board approval. Also use when the opstimizer recommends creating
  a strategic proposal.
---

# Strategic Planning

You are building a complete strategic proposal — from idea to funded, staffed, approved project. The output is not a document for humans to read and implement later. It's a machine-ready plan: goals in the API, tasks in the API, approvals in the API, with clear callouts for what requires human action.

## Why This Skill Exists

Without structure, strategic planning devolves into vague comments on issues. A CEO agent thinks "we should grow revenue" and creates one task called "grow revenue." That's not a plan — it's a wish.

This skill forces the discipline: What's the goal? What are the measurable outcomes? What tasks need to happen, in what order, assigned to whom? What does the board need to approve? What does the board need to DO? How much will it cost? Do we need to hire?

The output is a proposal that the board can approve with a single click, after which the CEO can create everything via API and the team starts executing immediately.

## Architecture Context

Paperclip runs as a **local Node.js server** (Express + embedded PostgreSQL) on the operator's machine. The server binds to `localhost` on an auto-detected port. There is no cloud deployment — server, CLI, and agents all run locally.

**How agents interact with Paperclip:** During a heartbeat, the server spawns a local subprocess for the agent and injects environment variables (`PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_RUN_ID`). The agent uses these to call the REST API via curl or the `paperclipai` CLI.

**The `paperclipai` CLI:** Installed as `@paperclipai/server`. Reads connection profiles from `~/.paperclip/context.json` so commands auto-resolve auth when a profile is active. Key commands used in this skill: `approval create`, `issue list`, `agent list`, `dashboard get`.

**Manual agent mode:** `paperclipai agent local-cli <agent-id> --company-id <company-id>` lets you run an agent session outside the heartbeat scheduler, useful for testing proposals before submitting.

## When to Use

- CEO has a growth idea or strategic initiative
- Opstimizer recommends a strategic proposal
- An agent identifies a capability gap that requires a coordinated response
- The company needs to plan a multi-agent, multi-task initiative
- Anyone says "plan a project" or "propose an initiative"

## The Procedure

### 1. Understand the Initiative

Before planning, understand what's being proposed. Ask or infer:

- **What**: One sentence describing the initiative
- **Why**: What business outcome does this drive? (revenue, retention, activation, capability)
- **Why now**: What makes this urgent or timely?
- **Success criteria**: How will we know it worked? (specific, measurable)
- **Time horizon**: Days? Weeks? Months?

If the agent is being vague ("let's grow revenue"), push for specifics. A plan built on vague intent produces vague work.

### 2. Research Context

Before proposing anything, gather intelligence:

- **Existing goals**: `GET /api/companies/{companyId}/goals` — does a relevant goal already exist? Don't duplicate.
- **Current work**: `GET /api/companies/{companyId}/issues?status=todo,in_progress` — is related work already underway?
- **Team capacity**: `GET /api/companies/{companyId}/agents` — who's available? Who's idle? Who's overloaded?
- **Budget state**: `GET /api/companies/{companyId}/dashboard` — how much budget remains?
- **Research reports**: Check `agents/researcher/reports/` for relevant market intelligence.
- **Completed work**: What has the team already shipped that this initiative builds on?

### 3. Draft the Proposal

Structure the proposal with these sections. Every section is required — if you don't have the information, say so explicitly rather than leaving it out.

```markdown
# Initiative: {title}

## Summary
{2-3 sentences: what we're doing, why, and what success looks like}

## Goal
- **Title**: {goal title — crisp, specific}
- **Level**: {company | team}
- **Parent goal**: {existing goal this ladders up to, or "none — new top-level goal"}
- **Success metrics**: {3-5 measurable outcomes with targets and timeframes}
- **Owner**: {agent name + role}

## Task Breakdown

### Phase 1: {phase name} ({timeline})
| # | Task | Priority | Assignee | Dependencies | Est. runs |
|---|------|----------|----------|--------------|-----------|
| 1 | {task title} | high | {agent name} | — | {N} |
| 2 | {task title} | high | {agent name} | #1 | {N} |
| 3 | {task title} | medium | **BOARD** | — | — |

### Phase 2: {phase name} ({timeline})
| # | Task | Priority | Assignee | Dependencies | Est. runs |
|---|------|----------|----------|--------------|-----------|
...

## Board Action Items

These require human action — the agent team cannot do these autonomously:

| # | Action | Why | Urgency | Estimated time |
|---|--------|-----|---------|----------------|
| 1 | {what the board member needs to do} | {why agents can't} | {now / this week / before phase N} | {5 min / 30 min / etc.} |

Examples of board actions:
- Create Stripe products/prices (requires Stripe dashboard access)
- Approve ad spend budget (financial authorization)
- Provide API keys or credentials (security-sensitive)
- Register for external services (identity verification)
- Review and publish legal/compliance content
- Approve hiring of new agents

## Budget Estimate

### Agent Compute
| Agent | Est. runs | Est. cost/run | Subtotal |
|-------|-----------|---------------|----------|
| {name} | {N} | ${N} | ${N} |
| {name} | {N} | ${N} | ${N} |
| **Total agent compute** | | | **${N}** |

### External Spend
| Item | Cost | Frequency | Notes |
|------|------|-----------|-------|
| {e.g., Google Ads budget} | ${N}/mo | monthly | {context} |
| {e.g., tool subscription} | ${N}/mo | monthly | {context} |
| **Total external (monthly)** | | | **${N}/mo** |

### Budget Summary
- **One-time agent compute**: ${N}
- **Monthly recurring (external)**: ${N}/mo
- **Monthly recurring (agent maintenance)**: ${N}/mo
- **Total first month**: ${N}

## Hiring Recommendations

{If the initiative needs capabilities the current team lacks:}

| Role | Why needed | Model recommendation | Est. monthly cost | Alternative |
|------|-----------|---------------------|-------------------|-------------|
| {role title} | {what gap this fills} | {sonnet/opus} | ${N}/mo | {could agent X do this instead? at what cost?} |

{If no hiring needed: "Current team has the capabilities needed for this initiative."}

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| {risk} | {low/med/high} | {what breaks} | {what we do about it} |

## Decision Needed

{One paragraph: what exactly is the board being asked to approve? Be specific about
budget authorization, hiring, credential provisioning, and any policy changes.}
```

### 4. Estimate Budget

Budget estimation should be evidence-based, not made up:

- **Agent compute costs**: Look at recent heartbeat runs for similar work. If the CTO typically costs $1.50/run for engineering tasks and you estimate 10 runs, that's $15. Use actual per-run costs from the dashboard, not theoretical pricing.
- **Run estimates**: Count the tasks, estimate how many heartbeat runs each will take based on complexity. Simple tasks (comment, update status) = 1 run. Medium tasks (write code, create content) = 2-4 runs. Complex tasks (architecture, research report) = 5-10 runs.
- **External spend**: Be specific. "$1,500/mo Google Ads" is good. "Some ad budget" is not.
- **Ongoing costs**: Distinguish one-time compute from recurring. A launched ad campaign needs ongoing agent monitoring.

### 5. Minimize Board Actions

The board's role is to approve budgets, provide credentials, and handle MFA — not to execute tasks. Every time you're about to write a board action item that asks the human to DO something, ask: "Could an agent do this with the right tool or credentials?"

**The bias is always: tooling and hiring over board labor.**

- Instead of "Board: post on LinkedIn" → "Research social media tools (Buffer, Typefully), request board provides login credentials, agent posts directly"
- Instead of "Board: register for Capterra" → "Agent registers using company email, board approves MFA prompt via GWS"
- Instead of "Board: create Stripe products" → "Request board provides Stripe dashboard credentials, agent creates products via Stripe API or dashboard"

**Acceptable board actions** (these genuinely require the human):
- Provide login credentials or API keys for a service
- Approve MFA prompts (arrive via email/GWS — board just clicks approve)
- Authorize financial spend (approve budget for tools, ads, hires)
- Sign legal documents or accept ToS that require personal identity
- Final review of public-facing legal/compliance content

**For each board action, be specific:**
- **What** they need to do (exact steps — "share your Buffer login" not "set up social media")
- **When** it's needed (before which phase/task)
- **How long** it should take (target: under 5 minutes per action)

**If a proposal has more than 3 board actions, rethink it.** Can you hire an agent, purchase a tool, or request credentials that let agents handle the rest? The board has 10 minutes, not 10 hours.

### 6. Identify Hiring Needs

When the initiative requires capabilities no current agent has:

- Be specific about what the role does
- Recommend a model tier (Sonnet for execution-heavy, Opus for judgment-heavy)
- Estimate monthly cost based on expected heartbeat frequency
- Always offer an alternative: "Agent X could do this with Y additions to their config, but it would slow their primary work"
- Use the `paperclip-create-agent` skill for the actual hiring if approved

### 7. Present for Review

Present the full proposal to the user/board for review before submitting as an approval. They may want to adjust scope, budget, or phasing.

### 8. Submit as Approval

Once the user confirms, create the approval via API:

```bash
# Via CLI
paperclipai approval create \
  --company-id $PAPERCLIP_COMPANY_ID \
  --type approve_ceo_strategy \
  --requested-by-agent-id {ceo-agent-id} \
  --payload '{"plan": "{full proposal markdown}"}' \
  --json

# Via curl
curl -s -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/approvals" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"approve_ceo_strategy","requestedByAgentId":"{ceo-agent-id}","payload":{"plan":"..."}}'
```

If the proposal includes linked issues that already exist, attach them:

```bash
curl -s -X POST "$PAPERCLIP_API_URL/api/issues/{issueId}/approvals" \
  -H "Content-Type: application/json" \
  -d '{"approvalId": "{approval-id}"}'
```

### 9. On Approval — Execute

After board approval, create everything:

1. **Create the goal** (if new):
```bash
curl -s -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/goals" \
  -H "Content-Type: application/json" \
  -d '{"title":"...","level":"team","status":"active","parentId":"...","ownerAgentId":"..."}'
```

2. **Create tasks** in dependency order (parents before children):
```bash
curl -s -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Content-Type: application/json" \
  -d '{"title":"...","description":"...","priority":"high","status":"todo","goalId":"...","parentId":"...","assigneeAgentId":"..."}'
```

3. **Wake assigned agents** so they pick up work immediately:
```bash
curl -s -X POST "$PAPERCLIP_API_URL/api/agents/{agentId}/wake" \
  -H "Content-Type: application/json" \
  -d '{"reason":"New tasks assigned from approved initiative: {title}"}'
```

## Principles

**Plans are machines, not documents.** A good plan, once approved, can be executed entirely via API calls. Goals created, tasks assigned, agents woken — work starts flowing immediately.

**Board time is sacred.** The human has 10 minutes, not 10 hours. Make board action items specific, time-estimated, and sequenced. "Create these 3 Stripe products with these exact names and prices" beats "set up Stripe."

**Budget honesty.** Don't lowball to get approval. Use real per-run costs from the dashboard. If the initiative is expensive, say so and justify it. The board would rather approve a $200 plan that works than reject a $50 plan that was obviously underestimated.

**Hire last.** Always check if an existing agent could absorb the work first (with config changes). Hiring is expensive — onboarding, prompt engineering, trial runs. Only recommend hiring when the capability gap is real and the existing team can't stretch.

**Phase aggressively.** Don't create 30 tasks at once. Phase the work so early results inform later phases. Phase 1 should be achievable in days, not weeks. If Phase 1 fails, the board should be able to kill the initiative without having wasted the full budget.
