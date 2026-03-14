# Agent Reflection System — Design Spec

**Date:** 2026-03-14
**Status:** Approved
**Goal:** Give agents awareness of their recent performance before each heartbeat run, with contextual prompts that push toward proactive, creative problem-solving.

---

## Overview

Before each heartbeat run, the heartbeat service queries the agent's recent run history, classifies the behavioral pattern, selects a contextual reflection prompt, and injects the result into the execution context. The claude_local adapter appends this reflection to the agent's prompt so it's the last thing the agent reads before acting.

This is Phase 1 of a broader self-improvement roadmap. It requires no new infrastructure — just richer prompts built from data already collected.

---

## Architecture

```
heartbeat service (buildReflection)
  ├─ queries last 5 completed runs for this agent
  ├─ extracts summaries from resultJson
  ├─ classifies pattern (idle, blocked, errors, costly, productive)
  ├─ selects contextual reflection prompt
  ├─ builds reflection string
  └─ sets context.reflection

context assembly (executeRun, existing flow)
  └─ context.reflection persisted to contextSnapshot in DB

claude_local adapter (execute.ts)
  └─ appends context.reflection to prompt after template resolution
```

---

## Section 1: Data Assembly

A new function `buildReflection(agentId: string, companyId: string)` in `server/src/services/heartbeat.ts`. Uses the closure-scoped `db` consistent with the rest of the file (e.g., how `executeRun` accesses `db`).

**Error handling:** If the database query fails, catch the error, log a warning, and return `null`. The run proceeds without reflection — this is a non-critical enhancement and must never block agent execution.

### Input

Last 5 completed runs (`status = 'succeeded'` or `status = 'failed'`) for this agent, ordered by `finishedAt desc`. Direct Drizzle query against `heartbeatRuns` table (no existing list function covers this exact filter):

```typescript
db.select(heartbeatRunListColumns)
  .from(heartbeatRuns)
  .where(and(
    eq(heartbeatRuns.agentId, agentId),
    eq(heartbeatRuns.companyId, companyId),
    inArray(heartbeatRuns.status, ['succeeded', 'failed']),
  ))
  .orderBy(desc(heartbeatRuns.finishedAt))
  .limit(5)
```

`startedAt` and `finishedAt` are guaranteed non-null for succeeded/failed runs (set by the execution lifecycle).

### Run Summary Extraction

For each run, extract:
- **summary:** `resultJson.result` or `resultJson.summary` (the text fields already extracted by `summarizeHeartbeatRunResultJson()`)
- **status:** succeeded or failed
- **exitCode:** from the run record
- **cost:** from `resultJson`, checking fields in order: `total_cost_usd`, `cost_usd`, `costUsd`. Fall back to `null` if none present.
- **duration:** `finishedAt - startedAt`
- **relative time:** human-readable time since run finished (e.g., "2h ago")

### Pattern Classification

Checked in priority order. First match wins.

| Priority | Pattern | Detection Rule | Reflection Prompt |
|----------|---------|----------------|-------------------|
| 1 | **Errors** | Any of last 3 runs have `status === 'failed'` or non-zero `exitCode` | "What went wrong? What would you do differently to avoid this failure?" |
| 2 | **Repeated blocker** | 2+ of last 3 summaries contain "blocked" or "waiting for" | "What are you assuming you cannot do, that you actually can? How could you work around this blocker?" |
| 3 | **Idle/no-work** | 2+ of last 3 summaries contain "no assignments", "nothing to do", "clean exit", or "no work" | "How could you be more proactive? What work could you create, propose, or pick up without being asked?" |
| 4 | **Rising cost** | Average cost of last 3 runs > 2x average of runs 4-5 (requires 5 runs, and runs 4-5 must have non-null, non-zero cost data — skip this pattern otherwise) | "How could you achieve the same result more efficiently?" |
| 5 | **Productive streak** | 3 of last 3 succeeded and summaries don't match above patterns | "What could you have done even better? What opportunities did you miss?" |
| 6 | **Default** | Fewer than 3 runs, or no clear pattern | "What could you do to make the most progress right now?" |

**Implementation:** ~30 lines of `if/else` with `toLowerCase().includes()` string matching. No regex, no NLP. Deliberately naive — false positives are acceptable (a wrong coaching prompt is still useful). The coaching agent (Phase 2) handles sophisticated analysis.

### Output

A reflection string:

```
## Your Recent Run History
1. [2h ago] Succeeded: "No assignments, budget at 87%". $0.66, 1m20s.
2. [5h ago] Succeeded: "Blocked task dedup applied". $0.55, 1m4s.
3. [8h ago] Succeeded: "CIV-38 blocked waiting for board". $0.36, 54s.

Before acting, reflect: What are you assuming you cannot do, that you actually can? How could you work around this blocker?
```

Total size: ~200-500 chars. Negligible context cost.

---

## Section 2: Context Injection

During the existing context assembly phase in `executeRun()` (~line 1280 in `heartbeat.ts`), after workspace and runtime service enrichment, before the context snapshot is persisted to the database:

```typescript
context.reflection = await buildReflection(agent.id, agent.companyId, db);
```

The context object is already a `Record<string, unknown>` that gets progressively enriched. This is one more field.

Because context is persisted to `contextSnapshot` before the adapter runs, the reflection automatically ends up in the database — queryable via API, visible in the dashboard, available to the future coaching agent. No extra storage work needed.

---

## Section 3: Prompt Injection (claude_local Adapter)

In `packages/adapters/claude-local/src/server/execute.ts`, after the prompt template is resolved via `renderTemplate()` (~line 366-374). Note: the `prompt` variable is currently declared as `const` — change to `let` to allow appending.

```typescript
let prompt = renderTemplate(promptTemplate, templateVars);

// ... existing code ...

if (context.reflection) {
  prompt = prompt + "\n\n" + context.reflection;
}
```

The reflection is appended to the end of the prompt string, which is passed to Claude CLI via stdin (the `-p` flag with prompt content). This means it arrives as part of the user message, not the system prompt. Last thing the agent reads before acting.

No changes to CLI args, no new files, no new flags.

Other adapters can add the same 3-line pattern when needed. Only claude_local is implemented now since all CivBid agents use it.

---

## Section 4: Edge Cases

- **New agent (fewer than 3 runs):** Skip classification, use default prompt: "What could you do to make the most progress right now?"
- **No completed runs:** Set `context.reflection = null`. Adapter skips injection (the `if` guard handles this).
- **Missing resultJson:** Runs without summaries are included in history but show "No summary recorded" instead of a quote.
- **Concurrent runs:** Not an issue — `buildReflection` reads completed runs only, and agents have max concurrency of 1 by default.

---

## Section 5: What We're NOT Building

- **No new database tables.** Reflection lives in the existing `contextSnapshot` JSONB field.
- **No new API endpoints.** Reflection data is queryable via the existing heartbeat runs API.
- **No UI changes.** Reflection shows up in the run's context snapshot in the dashboard (already rendered as JSON).
- **No agent self-eval storage.** Agents don't write back scores or self-assessments. That's Phase 2 (coaching agent).
- **No capability awareness prompts.** That's a separate HEARTBEAT.md/SOUL.md update (recommended but out of scope).
- **No adapter changes beyond claude_local.** Other adapters get `context.reflection` for free but won't use it until the 3-line injection is added.
- **No configuration or feature flags.** Reflection is on for every agent, every run. If it causes problems, we remove it.

---

## Future Phases (Not In Scope)

- **Phase 2: Coaching Agent** — always-on agent that reads reflections across all agents, converses with board via Discord, proposes config/prompt changes via approval system.
- **Capability awareness** — update agent HEARTBEAT.md/SOUL.md files to remind agents of browser access, CEO escalation paths, and other tools they may underutilize.
- **Automated evals** — formalize patterns from coaching conversations into scoring metrics and automated prompt optimization.

---

## Files Modified

| File | Change |
|------|--------|
| `server/src/services/heartbeat.ts` | Add `buildReflection()` function (~50 lines). Call it during context assembly in `executeRun()` (~1 line). |
| `packages/adapters/claude-local/src/server/execute.ts` | Append `context.reflection` to prompt after template resolution (~3 lines). |

Total implementation: ~55 lines of code across 2 files.
