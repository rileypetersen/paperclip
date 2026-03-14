# Agent Reflection System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject recent run history and contextual reflection prompts into agent execution context before each heartbeat run.

**Architecture:** `buildReflection()` function inside `heartbeatService()` closure queries last 5 completed runs, classifies behavioral patterns, and sets `context.reflection`. The claude_local adapter appends this to the prompt via string concatenation.

**Tech Stack:** TypeScript, Drizzle ORM, existing heartbeat service and claude_local adapter.

**Spec:** `docs/superpowers/specs/2026-03-14-agent-reflection-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/src/services/heartbeat.ts` | Modify | Add `buildReflection()` function inside `heartbeatService()` closure. Call it in `executeRun()` during context assembly. |
| `packages/adapters/claude-local/src/server/execute.ts` | Modify | Append `context.reflection` to prompt after template resolution. |

---

## Chunk 1: Build Reflection Function and Wire It Up

### Task 1: Add `buildReflection()` to heartbeat service

**Files:**
- Modify: `server/src/services/heartbeat.ts`

- [ ] **Step 1: Add the `buildReflection` function**

Inside `heartbeatService(db: Db)`, after the existing helper functions (`getAgent`, `getRun`, etc. — around line 473), add:

```typescript
  async function buildReflection(agentId: string, companyId: string): Promise<string | null> {
    try {
      const recentRuns = await db
        .select({
          status: heartbeatRuns.status,
          exitCode: heartbeatRuns.exitCode,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          resultJson: heartbeatRuns.resultJson,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.agentId, agentId),
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ["succeeded", "failed"]),
          ),
        )
        .orderBy(desc(heartbeatRuns.finishedAt))
        .limit(5);

      if (recentRuns.length === 0) return null;

      const now = Date.now();
      const lines = recentRuns.slice(0, 3).map((run, i) => {
        const ago = run.finishedAt ? formatTimeAgo(now - run.finishedAt.getTime()) : "unknown";
        const summary = extractRunSummary(run.resultJson);
        const cost = extractRunCost(run.resultJson);
        const duration = run.startedAt && run.finishedAt
          ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
          : "unknown";
        const costStr = cost !== null ? `$${cost.toFixed(2)}` : "n/a";
        const statusLabel = run.status === "succeeded" ? "Succeeded" : "Failed";
        return `${i + 1}. [${ago}] ${statusLabel}: "${summary}". ${costStr}, ${duration}.`;
      });

      const prompt = classifyPattern(recentRuns);

      return `## Your Recent Run History\n${lines.join("\n")}\n\nBefore acting, reflect: ${prompt}`;
    } catch (err) {
      logger.warn({ err, agentId }, "Failed to build reflection, continuing without it");
      return null;
    }
  }

  function extractRunSummary(resultJson: Record<string, unknown> | null): string {
    if (!resultJson) return "No summary recorded";
    const text = resultJson.result ?? resultJson.summary ?? resultJson.message;
    if (typeof text !== "string") return "No summary recorded";
    return text.length > 120 ? text.slice(0, 117) + "..." : text;
  }

  function extractRunCost(resultJson: Record<string, unknown> | null): number | null {
    if (!resultJson) return null;
    for (const key of ["total_cost_usd", "cost_usd", "costUsd"] as const) {
      const val = resultJson[key];
      if (typeof val === "number" && val > 0) return val;
    }
    return null;
  }

  function formatTimeAgo(ms: number): string {
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function formatDuration(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    return remainSecs > 0 ? `${mins}m${remainSecs}s` : `${mins}m`;
  }

  function classifyPattern(
    runs: { status: string; exitCode: number | null; resultJson: Record<string, unknown> | null }[],
  ): string {
    const last3 = runs.slice(0, 3);
    if (last3.length < 3) return "What could you do to make the most progress right now?";

    // 1. Errors
    if (last3.some((r) => r.status === "failed" || (r.exitCode !== null && r.exitCode !== 0))) {
      return "What went wrong? What would you do differently to avoid this failure?";
    }

    const summaries = last3.map((r) => extractRunSummary(r.resultJson).toLowerCase());

    // 2. Repeated blocker
    const blockedCount = summaries.filter((s) => s.includes("blocked") || s.includes("waiting for")).length;
    if (blockedCount >= 2) {
      return "What are you assuming you cannot do, that you actually can? How could you work around this blocker?";
    }

    // 3. Idle / no work
    const idleKeywords = ["no assignments", "nothing to do", "clean exit", "no work"];
    const idleCount = summaries.filter((s) => idleKeywords.some((kw) => s.includes(kw))).length;
    if (idleCount >= 2) {
      return "How could you be more proactive? What work could you create, propose, or pick up without being asked?";
    }

    // 4. Rising cost (requires 5 runs with valid cost data)
    if (runs.length >= 5) {
      const costOf = (r: { resultJson: Record<string, unknown> | null }) => extractRunCost(r.resultJson);
      const recent3Costs = last3.map(costOf).filter((c): c is number => c !== null);
      const older2Costs = runs.slice(3, 5).map(costOf).filter((c): c is number => c !== null);
      if (recent3Costs.length === 3 && older2Costs.length === 2) {
        const avgRecent = recent3Costs.reduce((a, b) => a + b, 0) / 3;
        const avgOlder = older2Costs.reduce((a, b) => a + b, 0) / 2;
        if (avgOlder > 0 && avgRecent > 2 * avgOlder) {
          return "How could you achieve the same result more efficiently?";
        }
      }
    }

    // 5. Productive streak
    if (last3.every((r) => r.status === "succeeded")) {
      return "What could you have done even better? What opportunities did you miss?";
    }

    // 6. Default
    return "What could you do to make the most progress right now?";
  }
```

- [ ] **Step 2: Call `buildReflection` in `executeRun()` during context assembly**

In `executeRun()`, after the workspace context enrichment block (after line 1254 where `context.projectId` is set, before the session resolution at line 1256), add:

```typescript
    // Reflection: inject recent run history and contextual prompt
    context.reflection = await buildReflection(agent.id, agent.companyId);
```

- [ ] **Step 3: Verify the server compiles**

Run: `cd /Users/rileypetersen/paperclip && pnpm build` (or the project's build command)
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/heartbeat.ts
git commit -m "feat: add buildReflection() to heartbeat service

Queries last 5 completed runs, classifies behavioral pattern
(errors, blocked, idle, rising cost, productive), and injects
contextual reflection prompt into execution context."
```

---

### Task 2: Append reflection to prompt in claude_local adapter

**Files:**
- Modify: `packages/adapters/claude-local/src/server/execute.ts`

- [ ] **Step 1: Change `prompt` from `const` to `let`**

At line 366 in `execute.ts`, change:

```typescript
  const prompt = renderTemplate(promptTemplate, {
```

to:

```typescript
  let prompt = renderTemplate(promptTemplate, {
```

- [ ] **Step 2: Append reflection to prompt**

After the `renderTemplate` call (after line 374, before `buildClaudeArgs` at line 376), add:

```typescript
  const reflection = typeof context.reflection === "string" ? context.reflection : null;
  if (reflection) {
    prompt = prompt + "\n\n" + reflection;
  }
```

- [ ] **Step 3: Verify the server compiles**

Run: `cd /Users/rileypetersen/paperclip && pnpm build`
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/adapters/claude-local/src/server/execute.ts
git commit -m "feat: inject reflection into claude_local agent prompt

Appends context.reflection (built by heartbeat service) to the
agent prompt so it's the last thing the agent reads before acting."
```

---

### Task 3: Manual verification

- [ ] **Step 1: Restart the Paperclip server**

Use the `paperclip-restart` skill or manually restart the server process.

- [ ] **Step 2: Trigger a heartbeat run for one agent**

Invoke a heartbeat manually for an agent that has prior run history (e.g., Erlich or Jian-Yang) via the dashboard UI or API:

```bash
curl -X POST "http://localhost:3100/api/agents/<AGENT_ID>/heartbeat/invoke"
```

- [ ] **Step 3: Verify reflection in context snapshot**

After the run completes, fetch it via API and confirm `contextSnapshot.reflection` is populated:

```bash
curl -s "http://localhost:3100/api/companies/<COMPANY_ID>/heartbeat-runs?limit=1" | python3 -m json.tool
```

Look for: `"reflection": "## Your Recent Run History\n1. [...]"` in the `contextSnapshot` field.

- [ ] **Step 4: Commit the verification (if any adjustments were needed)**

If no changes were needed, this step is a no-op. If minor adjustments were made during verification, commit them.
