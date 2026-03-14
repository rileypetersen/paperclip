# Server Module Details

## `server/execute.ts` — The Core

This is the most important file. It receives an `AdapterExecutionContext` and must return an `AdapterExecutionResult`.

**Required behavior:**

1. **Read config** — extract typed values from `ctx.config` using helpers (`asString`, `asNumber`, `asBoolean`, `asStringArray`, `parseObject` from `@paperclipai/adapter-utils/server-utils`)
2. **Build environment** — call `buildPaperclipEnv(agent)` then layer in `PAPERCLIP_RUN_ID`, context vars (`PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`, `PAPERCLIP_APPROVAL_ID`, `PAPERCLIP_APPROVAL_STATUS`, `PAPERCLIP_LINKED_ISSUE_IDS`), user env overrides, and auth token
3. **Resolve session** — check `runtime.sessionParams` / `runtime.sessionId` for an existing session; validate it's compatible (e.g. same cwd); decide whether to resume or start fresh
4. **Render prompt** — use `renderTemplate(template, data)` with the template variables: `agentId`, `companyId`, `runId`, `company`, `agent`, `run`, `context`
5. **Call onMeta** — emit adapter invocation metadata before spawning the process
6. **Spawn the process** — use `runChildProcess()` for CLI-based agents or `fetch()` for HTTP-based agents
7. **Parse output** — convert the agent's stdout into structured data (session id, usage, summary, errors)
8. **Handle session errors** — if resume fails with "unknown session", retry with a fresh session and set `clearSession: true`
9. **Return AdapterExecutionResult** — populate all fields the agent runtime supports

**Environment variables the server always injects:**

| Variable | Source |
|----------|--------|
| `PAPERCLIP_AGENT_ID` | `agent.id` |
| `PAPERCLIP_COMPANY_ID` | `agent.companyId` |
| `PAPERCLIP_API_URL` | Server's own URL |
| `PAPERCLIP_RUN_ID` | Current run id |
| `PAPERCLIP_TASK_ID` | `context.taskId` or `context.issueId` |
| `PAPERCLIP_WAKE_REASON` | `context.wakeReason` |
| `PAPERCLIP_WAKE_COMMENT_ID` | `context.wakeCommentId` or `context.commentId` |
| `PAPERCLIP_APPROVAL_ID` | `context.approvalId` |
| `PAPERCLIP_APPROVAL_STATUS` | `context.approvalStatus` |
| `PAPERCLIP_LINKED_ISSUE_IDS` | `context.issueIds` (comma-separated) |
| `PAPERCLIP_API_KEY` | `authToken` (if no explicit key in config) |

## `server/parse.ts` — Output Parser

Parse the agent's stdout format into structured data. Must handle:

- **Session identification** — extract session/thread ID from init events
- **Usage tracking** — extract token counts (input, output, cached)
- **Cost tracking** — extract cost if available
- **Summary extraction** — pull the agent's final text response
- **Error detection** — identify error states, extract error messages
- **Unknown session detection** — export an `is<Agent>UnknownSessionError()` function for retry logic

**Treat agent output as untrusted.** The stdout you're parsing comes from an LLM-driven process that may have executed arbitrary tool calls, fetched external content, or been influenced by prompt injection in the files it read. Parse defensively:
- Never `eval()` or dynamically execute anything from output
- Use safe extraction helpers (`asString`, `asNumber`, `parseJson`) — they return fallbacks on unexpected types
- Validate session IDs and other structured data before passing them through
- If output contains URLs, file paths, or commands, do not act on them in the adapter — just record them

## `server/index.ts` — Server Exports

```ts
export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { parseMyAgentOutput, isMyAgentUnknownSessionError } from "./parse.js";

// Session codec — required for session persistence
export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) { /* raw DB JSON -> typed params or null */ },
  serialize(params) { /* typed params -> JSON for DB storage */ },
  getDisplayId(params) { /* -> human-readable session id string */ },
};
```

## `server/test.ts` — Environment Diagnostics

Implement adapter-specific preflight checks used by the UI test button.

Minimum expectations:

1. Validate required config primitives (paths, commands, URLs, auth assumptions)
2. Return check objects with deterministic `code` values
3. Map severity consistently (`info` / `warn` / `error`)
4. Compute final status:
   - `fail` if any `error`
   - `warn` if no errors and at least one warning
   - `pass` otherwise

This operation should be lightweight and side-effect free.

## Server-Utils Helpers

Import from `@paperclipai/adapter-utils/server-utils`:

| Helper | Purpose |
|--------|---------|
| `asString(val, fallback)` | Safe string extraction |
| `asNumber(val, fallback)` | Safe number extraction |
| `asBoolean(val, fallback)` | Safe boolean extraction |
| `asStringArray(val)` | Safe string array extraction |
| `parseObject(val)` | Safe `Record<string, unknown>` extraction |
| `parseJson(str)` | Safe JSON.parse returning `Record` or null |
| `renderTemplate(tmpl, data)` | `{{path.to.value}}` template rendering |
| `buildPaperclipEnv(agent)` | Standard `PAPERCLIP_*` env vars |
| `redactEnvForLogs(env)` | Redact sensitive keys for onMeta |
| `ensureAbsoluteDirectory(cwd)` | Validate cwd exists and is absolute |
| `ensureCommandResolvable(cmd, cwd, env)` | Validate command is in PATH |
| `ensurePathInEnv(env)` | Ensure PATH exists in env |
| `runChildProcess(runId, cmd, args, opts)` | Spawn with timeout, logging, capture |
