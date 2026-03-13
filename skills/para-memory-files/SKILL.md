---
name: para-memory-files
description: >
  Use this skill to store, retrieve, update, or organize persistent knowledge
  using file-based PARA memory. Use when someone says "remember this", "what do
  you know about X", "save this fact", "update your memory", "run weekly
  synthesis", or asks you to recall past context. Covers: creating YAML-based
  knowledge entities, writing daily notes, running weekly synthesis to consolidate
  knowledge, searching memory via qmd, and managing memory decay. Use whenever
  information needs to persist beyond the current conversation — even if the user
  doesn't say "memory" explicitly.
---

# PARA Memory Files

Persistent, file-based memory organized by Tiago Forte's PARA method. Three layers: a knowledge graph, daily notes, and tacit knowledge. All paths are relative to `$AGENT_HOME`.

## Three Memory Layers

### Layer 1: Knowledge Graph (`$AGENT_HOME/life/` -- PARA)

Entity-based storage. Each entity gets a folder with two tiers:

1. `summary.md` -- quick context, load first.
2. `items.yaml` -- atomic facts, load on demand.

```text
$AGENT_HOME/life/
  projects/          # Active work with clear goals/deadlines
    <name>/
      summary.md
      items.yaml
  areas/             # Ongoing responsibilities, no end date
    people/<name>/
    companies/<name>/
  resources/         # Reference material, topics of interest
    <topic>/
  archives/          # Inactive items from the other three
  index.md
```

**PARA rules:**

- **Projects** -- active work with a goal or deadline. Move to archives when complete.
- **Areas** -- ongoing (people, companies, responsibilities). No end date.
- **Resources** -- reference material, topics of interest.
- **Archives** -- inactive items from any category.

**Fact rules:**

- Save durable facts immediately to `items.yaml`.
- Weekly: rewrite `summary.md` from active facts.
- Never delete facts. Supersede instead (`status: superseded`, add `superseded_by`).
- When an entity goes inactive, move its folder to `$AGENT_HOME/life/archives/`.

For the atomic fact YAML schema and memory decay rules, see [references/schemas.md](references/schemas.md).

### Layer 2: Daily Notes (`$AGENT_HOME/memory/YYYY-MM-DD.md`)

Raw timeline of events -- the "when" layer.

- Write continuously during conversations.
- Extract durable facts to Layer 1 during heartbeats.

### Layer 3: Tacit Knowledge (`$AGENT_HOME/MEMORY.md`)

How the user operates -- patterns, preferences, lessons learned.

- Not facts about the world; facts about the user.
- Update whenever you learn new operating patterns.

## When to Create an Entity

- Mentioned 3+ times, OR
- Direct relationship to the user (family, coworker, partner, client), OR
- Significant project or company in the user's life.
- Otherwise, note it in daily notes until the threshold is met.

## Common Patterns

### Creating a New Entity

1. Decide the PARA category: `projects/`, `areas/people/`, `areas/companies/`, or `resources/`.
2. Create the folder: `mkdir -p $AGENT_HOME/life/<category>/<entity-name>/`
3. Write `summary.md` with a one-paragraph overview.
4. Write `items.yaml` with the initial facts (use the schema from `references/schemas.md`).
5. Update `$AGENT_HOME/life/index.md` with a link to the new entity.

### Superseding a Fact

When a fact becomes outdated (e.g., someone changes jobs):

1. Find the old fact in `items.yaml` by its `id`.
2. Set `status: superseded` and `superseded_by: <new-fact-id>`.
3. Add the new fact with `status: active` and a fresh `id`.
4. Do NOT delete the old fact -- the history is valuable for context.

### Handling Decay

Facts decay in retrieval priority so stale info does not crowd out recent context:

- **Hot** (accessed in last 7 days) -- include prominently in `summary.md`.
- **Warm** (8-30 days ago) -- include at lower priority.
- **Cold** (30+ days or never accessed) -- omit from `summary.md`. Still in `items.yaml`, retrievable on demand.
- High `access_count` resists decay -- frequently used facts stay warm longer.

When a fact is used in conversation, bump `access_count` and set `last_accessed` to today. Accessing a cold fact reheats it.

## Weekly Synthesis Procedure

Run this procedure once per week (typically during a scheduled heartbeat):

**Step 1 -- Gather active entities.** List all non-archived entity folders in `$AGENT_HOME/life/`.

**Step 2 -- Sort facts by recency tier.** For each entity, read `items.yaml` and classify each active fact as hot, warm, or cold based on `last_accessed` and `access_count`.

**Step 3 -- Rewrite summaries.** For each entity with changed facts:
- Write hot facts prominently at the top of `summary.md`.
- Include warm facts at lower priority.
- Omit cold facts (they remain in `items.yaml`).
- Include a "Last synthesized: YYYY-MM-DD" line at the bottom.

**Step 4 -- Archive inactive entities.** If an entity has zero hot or warm facts AND no activity in 60+ days, move its folder to `$AGENT_HOME/life/archives/`.

**Step 5 -- Update index.** Rebuild `$AGENT_HOME/life/index.md` to reflect any moves or new entities.

**Step 6 -- Reindex for search.** Run `qmd index $AGENT_HOME` to update the search index with current content.

## Memory Recall -- Use qmd

Use `qmd` rather than grepping files:

```bash
qmd query "what happened at Christmas"   # Semantic search with reranking
qmd search "specific phrase"              # BM25 keyword search
qmd vsearch "conceptual question"         # Pure vector similarity
```

### When to Use Each Mode

| Mode | Best for | Example |
|------|----------|---------|
| `query` | General recall with mixed relevance signals | "what happened at Christmas" |
| `search` | Exact phrases or known terminology | "ACME contract renewal" |
| `vsearch` | Conceptual/thematic questions | "times the user was frustrated" |

### Reindexing Triggers

Run `qmd index $AGENT_HOME` after:
- Weekly synthesis completes
- Bulk entity creation or archival
- Manual request from the user
- Any time search results seem stale

Index your personal folder: `qmd index $AGENT_HOME`

Vectors + BM25 + reranking finds things even when the wording differs.

## Memory vs. Communication

Not everything belongs in memory files. Choose the right persistence mechanism:

| What | Where | Why |
|------|-------|-----|
| Durable facts about entities | `life/` PARA folders | Survives across all sessions, searchable |
| What happened today | `memory/YYYY-MM-DD.md` | Timeline record, extracted to Layer 1 later |
| User patterns and preferences | `MEMORY.md` | Informs how you work with the user |
| Task-specific status updates | Paperclip issue comments | Visible to other agents and board users |
| Coordination with other agents | Paperclip task comments or email | Shared context, audit trail |
| Plans and proposals | `plans/` at project root | Accessible to all agents, not personal memory |
| Lessons about tools/skills | `AGENTS.md`, `TOOLS.md`, or skill files | Operational knowledge, not personal memory |

## Write It Down -- No Mental Notes

Memory does not survive session restarts. Files do.

- Want to remember something -> WRITE IT TO A FILE.
- "Remember this" -> update `$AGENT_HOME/memory/YYYY-MM-DD.md` or the relevant entity file.
- Learn a lesson -> update AGENTS.md, TOOLS.md, or the relevant skill file.
- Make a mistake -> document it so future-you does not repeat it.
- On-disk text files are always better than holding it in temporary context.

## Planning

Keep plans in timestamped files in `plans/` at the project root (outside personal memory so other agents can access them). Use `qmd` to search plans. Plans go stale -- if a newer plan exists, do not confuse yourself with an older version. If you notice staleness, update the file to note what it is supersededBy.
