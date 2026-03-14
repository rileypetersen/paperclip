# Agent Self-Improvement Roadmap — Deferred Items

**Date:** 2026-03-14
**Context:** Phase 1 (reflection injection) is live. These are items discussed during design that were deferred for future phases.

---

## Phase 2: Coaching Agent

An always-on agent that reads run data and reflections across all agents, converses with the board (Riley) via Discord, and proposes config/prompt changes via the approval system.

- Runs on a slower heartbeat cadence (daily)
- Reads `contextSnapshot.reflection` from all agents' recent runs via API
- Discusses observations with Riley: "Agent X keeps hitting the same blocker, I think because..."
- Riley confirms/corrects the coach's analysis
- Coach proposes specific changes (approval request or config patch)
- Coach tracks whether changes helped in subsequent cycles
- Replaces the manually-invoked opstimizer skill with an autonomous agent

**Discord is the recommended conversation channel** — two-way sync already exists.

## Phase 3: Formalize What Works

Extract patterns from coaching conversations into automated evals and policies.

- Define measurable outcomes per agent role (PRs merged, cycle time, task completion rate)
- Auto-approve low-risk changes (prompt tweaks) while keeping high-risk ones gated
- Shift Riley's role from hands-on steering to policy-setting

---

## Deferred Design Decisions

### Capability Awareness Prompts (Out of Scope for Phase 1)

Update agent HEARTBEAT.md/SOUL.md files to remind agents of capabilities they may underutilize:

- **Browser access:** Agents can use the browser to research, verify, and complete tasks directly — not just write code.
- **CEO escalation path:** If an agent needs credentials, accounts, or access they don't have, they should create a request for the CEO who can submit it for board approval.

These belong in standing instructions (always present), not in the reflection system (contextual). The reflection prompt challenges agents to think differently; capability awareness tells them what tools they have.

### End-of-Run Reflection (Considered, Deferred)

Instead of injecting history + questions at run start, have agents reflect at the end of each run and store a compact self-assessment for the next run.

**Why deferred:**
- Current approach is reliable (built from data that always exists, even if agent crashes)
- End-of-run reflection depends on agent compliance (may not produce one)
- Needs infrastructure for parsing/storing reflection output (no structured place for it yet)
- Current prompts are behavioral nudges (~150 tokens), not tasks that waste agent time

**When to revisit:** If agents start spending significant tokens explicitly "answering" reflection questions instead of working, or when the coaching agent (Phase 2) provides a structured place to store and evaluate reflection quality.

### Per-Task Reflection Scoping (Considered, Deferred)

Scope reflection to "your last 3 runs on this task" instead of "your last 3 runs overall." Would prevent irrelevant reflections when an agent switches between unrelated tasks.

**Why deferred:**
- Task assignment happens during the run, not before — we don't know which task the agent will work on when reflection is built
- Current prompts are behavioral (idle, stuck, productive), not task-specific
- Irrelevant prompts are low-harm — agent ignores what doesn't apply
- CivBid agents currently work on the same tasks across multiple heartbeats, so cross-task noise is rare

**When to revisit:** When agents start working on more diverse, rapidly-switching tasks.

### Database Index for Reflection Query (Deferred)

The `buildReflection` query filters on `(agentId, companyId, status)` and orders by `finishedAt DESC`. No index covers this exactly. With 394 runs total this is negligible, but on a busy system it would be a hot-path concern.

**When to revisit:** When total heartbeat_runs exceeds ~10k or query latency becomes measurable.

---

## What's Live Now (Phase 1)

- `buildReflection()` in `server/src/services/heartbeat.ts` — queries last 5 completed runs, classifies pattern, builds contextual reflection prompt
- `context.reflection` injected during `executeRun()` context assembly
- claude_local adapter appends `context.reflection` to agent prompt
- 6 pattern classifications: errors, repeated blocker, idle/no-work, rising cost, productive streak, default
- Reflection persisted in `contextSnapshot` (queryable via API)
