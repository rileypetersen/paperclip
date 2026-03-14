---
name: create-agent-adapter
description: >
  Use this skill to build, debug, or modify a Paperclip agent adapter. Use when
  adding support for a new AI tool (e.g., "make Paperclip work with Gemini/GPT/
  Llama"), creating an adapter package from scratch, debugging adapter execution
  or session codec issues, or understanding how adapters connect Paperclip to
  agent runtimes. Covers required TypeScript interfaces, server/UI/CLI module
  structure, registration points, and conventions from existing adapters. NOT
  for hiring agents (use paperclip-create-agent) or general Paperclip API
  usage (use paperclip).
---

# Creating a Paperclip Agent Adapter

An adapter bridges Paperclip's orchestration layer to a specific AI agent runtime (Claude Code, Codex CLI, a custom process, an HTTP endpoint, etc.). Each adapter is a self-contained package that provides implementations for **three consumers**: the server, the UI, and the CLI.

---

## 1. Architecture Overview

```
packages/adapters/<name>/
  src/
    index.ts            # Shared metadata (type, label, models, agentConfigurationDoc)
    server/
      index.ts          # Server exports: execute, sessionCodec, parse helpers
      execute.ts        # Core execution logic (AdapterExecutionContext -> AdapterExecutionResult)
      parse.ts          # Stdout/result parsing for the agent's output format
    ui/
      index.ts          # UI exports: parseStdoutLine, buildConfig
      parse-stdout.ts   # Line-by-line stdout -> TranscriptEntry[] for the run viewer
      build-config.ts   # CreateConfigValues -> adapterConfig JSON for agent creation form
    cli/
      index.ts          # CLI exports: formatStdoutEvent
      format-event.ts   # Colored terminal output for `paperclipai run --watch`
  package.json
  tsconfig.json
```

Three separate registries consume adapter modules:

| Registry | Location | Interface |
|----------|----------|-----------|
| Server | `server/src/adapters/registry.ts` | `ServerAdapterModule` |
| UI | `ui/src/adapters/registry.ts` | `UIAdapterModule` |
| CLI | `cli/src/adapters/registry.ts` | `CLIAdapterModule` |

For full type definitions of all interfaces, read [references/interfaces.md](references/interfaces.md).

---

## 2. Step-by-Step: Creating a New Adapter

### 2.1 Create the Package

```
packages/adapters/<name>/
  package.json
  tsconfig.json
  src/
    index.ts
    server/index.ts
    server/execute.ts
    server/parse.ts
    ui/index.ts
    ui/parse-stdout.ts
    ui/build-config.ts
    cli/index.ts
    cli/format-event.ts
```

**package.json** — must use the four-export convention:

```json
{
  "name": "@paperclipai/adapter-<name>",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server/index.ts",
    "./ui": "./src/ui/index.ts",
    "./cli": "./src/cli/index.ts"
  },
  "dependencies": {
    "@paperclipai/adapter-utils": "workspace:*",
    "picocolors": "^1.1.1"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

### 2.2 Root `index.ts` — Adapter Metadata

This file is imported by **all three** consumers (server, UI, CLI). Keep it dependency-free (no Node APIs, no React).

```ts
export const type = "my_agent";        // snake_case, globally unique
export const label = "My Agent (local)";

export const models = [
  { id: "model-a", label: "Model A" },
  { id: "model-b", label: "Model B" },
];

export const agentConfigurationDoc = `# my_agent agent configuration
...document all config fields here...
`;
```

**Required exports:**
- `type` — the adapter type key, stored in `agents.adapter_type`
- `label` — human-readable name for the UI
- `models` — available model options for the agent creation form
- `agentConfigurationDoc` — markdown describing all `adapterConfig` fields (used by LLM agents configuring other agents)

**Writing `agentConfigurationDoc` as routing logic:**

Write it as **routing logic**, not marketing copy. Include concrete "use when" and "don't use when" guidance so an LLM can decide whether this adapter is appropriate for a given task. Adding explicit negative cases improves adapter selection accuracy.

### 2.3 Server Module

The server module is the most important part — it handles execution, output parsing, session management, and environment diagnostics.

For complete implementation details, code examples, environment variable tables, and server-utils helpers, read [references/server-module.md](references/server-module.md).

### 2.4 UI Module

The UI module provides transcript parsing for the run viewer, config building for the agent form, and React config field components.

For implementation details, component patterns, and TranscriptEntry kinds reference, read [references/ui-cli-modules.md](references/ui-cli-modules.md).

### 2.5 CLI Module

The CLI module pretty-prints agent stdout for `paperclipai run --watch`.

For implementation details, read the CLI section in [references/ui-cli-modules.md](references/ui-cli-modules.md).

---

## 3. Registration Checklist

After creating the adapter package, register it in all three consumers:

### 3.1 Server Registry (`server/src/adapters/registry.ts`)

```ts
import { execute as myExecute, sessionCodec as mySessionCodec } from "@paperclipai/adapter-my-agent/server";
import { agentConfigurationDoc as myDoc, models as myModels } from "@paperclipai/adapter-my-agent";

const myAgentAdapter: ServerAdapterModule = {
  type: "my_agent",
  execute: myExecute,
  sessionCodec: mySessionCodec,
  models: myModels,
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: myDoc,
};

// Add to the adaptersByType map
const adaptersByType = new Map<string, ServerAdapterModule>(
  [..., myAgentAdapter].map((a) => [a.type, a]),
);
```

### 3.2 UI Registry (`ui/src/adapters/registry.ts`)

```ts
import { myAgentUIAdapter } from "./my-agent";

const adaptersByType = new Map<string, UIAdapterModule>(
  [..., myAgentUIAdapter].map((a) => [a.type, a]),
);
```

With `ui/src/adapters/my-agent/index.ts`:

```ts
import type { UIAdapterModule } from "../types";
import { parseMyAgentStdoutLine } from "@paperclipai/adapter-my-agent/ui";
import { MyAgentConfigFields } from "./config-fields";
import { buildMyAgentConfig } from "@paperclipai/adapter-my-agent/ui";

export const myAgentUIAdapter: UIAdapterModule = {
  type: "my_agent",
  label: "My Agent",
  parseStdoutLine: parseMyAgentStdoutLine,
  ConfigFields: MyAgentConfigFields,
  buildAdapterConfig: buildMyAgentConfig,
};
```

### 3.3 CLI Registry (`cli/src/adapters/registry.ts`)

```ts
import { printMyAgentStreamEvent } from "@paperclipai/adapter-my-agent/cli";

const myAgentCLIAdapter: CLIAdapterModule = {
  type: "my_agent",
  formatStdoutEvent: printMyAgentStreamEvent,
};

// Add to the adaptersByType map
```

---

## 4. Session Management

Sessions allow agents to maintain conversation context across runs. **Design for long runs from the start.** An agent working on an issue may be woken dozens of times — each wake should resume the existing conversation.

**Key concepts:**
- `sessionParams` is an opaque `Record<string, unknown>` stored in the DB per task
- The adapter's `sessionCodec` handles serialize/deserialize/getDisplayId
- **cwd-aware resume**: skip resuming if the session was created in a different cwd
- **Unknown session retry**: if resume fails with "session not found", retry fresh and return `clearSession: true`

**Pattern** (from both claude-local and codex-local):

```ts
const canResumeSession =
  runtimeSessionId.length > 0 &&
  (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
const sessionId = canResumeSession ? runtimeSessionId : null;

// ... run attempt ...

// If resume failed with unknown session, retry fresh
if (sessionId && !proc.timedOut && exitCode !== 0 && isUnknownSessionError(output)) {
  const retry = await runAttempt(null);
  return toResult(retry, { clearSessionOnMissingSession: true });
}
```

If the agent runtime supports context compaction or conversation compression, lean on it. Adapters that support session resume get compaction for free.

---

## 5. Conventions and Patterns

### Naming
- Adapter type: `snake_case` (e.g. `claude_local`, `codex_local`)
- Package name: `@paperclipai/adapter-<kebab-name>`
- Package directory: `packages/adapters/<kebab-name>/`

### Config Parsing
- Never trust `config` values directly — always use `asString`, `asNumber`, etc.
- Provide sensible defaults for every optional field
- Document all fields in `agentConfigurationDoc`

### Prompt Templates
- Support `promptTemplate` for every run
- Use `renderTemplate()` with the standard variable set
- Default prompt: `"You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work."`

### Error Handling
- Differentiate timeout vs process error vs parse failure
- Always populate `errorMessage` on failure
- Include raw stdout/stderr in `resultJson` when parsing fails

### Logging
- Call `onLog("stdout", ...)` and `onLog("stderr", ...)` for all process output
- Call `onMeta(...)` before spawning to record invocation details
- Use `redactEnvForLogs()` when including env in meta

### Paperclip Skills Injection

Paperclip ships shared skills (in `skills/`) that agents need at runtime. Each adapter must make these skills discoverable **without polluting the agent's working directory**.

Injection strategies (in order of preference):

1. **tmpdir + flag** (like claude-local) — create a tmpdir, symlink skills in, pass `--add-dir <tmpdir>`, clean up after. Zero side effects.
2. **global config dir** (like codex-local) — symlink into the runtime's global skills directory. Skip existing entries.
3. **env var** — point an environment variable at the repo's `skills/` directory.
4. **prompt injection** — include skill content in the prompt template. Uses tokens but avoids filesystem side effects.

**Skills as loaded procedures, not prompt bloat.** The agent sees skill metadata (name + description) in its context, but only loads the full SKILL.md when it invokes a skill. Do not inline skill content in `agentConfigurationDoc` or prompt templates.

**Explicit vs. fuzzy skill invocation.** For mandatory procedures (e.g. reporting status via Paperclip API), use explicit instructions in the prompt template. Fuzzy routing is fine for exploratory tasks but unreliable for mandatory procedures.

---

## 6. Security

For security considerations including trust boundaries, secret injection, network access controls, and process isolation, read [references/security.md](references/security.md).

---

## 7. Testing

Create tests in `server/src/__tests__/<adapter-name>-adapter.test.ts`. Test:

1. **Output parsing** — feed sample stdout through your parser, verify structured output
2. **Unknown session detection** — verify the `is<Agent>UnknownSessionError` function
3. **Config building** — verify `buildConfig` produces correct adapterConfig from form values
4. **Session codec** — verify serialize/deserialize round-trips

---

## 8. Minimal Adapter Checklist

- [ ] `packages/adapters/<name>/package.json` with four exports (`.`, `./server`, `./ui`, `./cli`)
- [ ] Root `index.ts` with `type`, `label`, `models`, `agentConfigurationDoc`
- [ ] `server/execute.ts` implementing `AdapterExecutionContext -> AdapterExecutionResult`
- [ ] `server/test.ts` implementing `AdapterEnvironmentTestContext -> AdapterEnvironmentTestResult`
- [ ] `server/parse.ts` with output parser and unknown-session detector
- [ ] `server/index.ts` exporting `execute`, `testEnvironment`, `sessionCodec`, parse helpers
- [ ] `ui/parse-stdout.ts` with `StdoutLineParser` for the run viewer
- [ ] `ui/build-config.ts` with `CreateConfigValues -> adapterConfig` builder
- [ ] `ui/src/adapters/<name>/config-fields.tsx` React component for agent form
- [ ] `ui/src/adapters/<name>/index.ts` assembling the `UIAdapterModule`
- [ ] `cli/format-event.ts` with terminal formatter
- [ ] `cli/index.ts` exporting the formatter
- [ ] Registered in `server/src/adapters/registry.ts`
- [ ] Registered in `ui/src/adapters/registry.ts`
- [ ] Registered in `cli/src/adapters/registry.ts`
- [ ] Added to workspace in root `pnpm-workspace.yaml` (if not already covered by glob)
- [ ] Tests for parsing, session codec, and config building
