# Skill-Creator Treatment — Remaining Work

## What's Done

- **Phase 1 (Structure)**: All 9 skills restructured. `create-agent-adapter` split from 719→322 lines + 4 reference files. `para-memory-files` expanded. `gmail` got bundled scripts. `paperclip` self-test moved to references.
- **Phase 2 (Evals)**: All 9 `evals/evals.json` created (2-3 test prompts + assertions each). Iteration 1 benchmarks complete for all 9 (5 showed skill value, 4 had baseline contamination).
- **Phase 3 (Descriptions + Packaging)**: All 9 descriptions manually optimized with imperative phrasing, cross-skill NOT clauses, and natural trigger phrases. All 9 packaged in `dist/*.skill`. Trigger eval sets (`evals/eval_set.json`, 20 queries each) created.

## What's Outstanding

### 1. Automated Trigger Rate Validation (BLOCKED)

**What**: Run `scripts/run-description-optimization.sh` to measure and iteratively optimize trigger rates for all 9 skill descriptions.

**Blocker**: `claude -p` hangs indefinitely when `.claude/commands/*.md` files exist (Claude Code v2.1.74 on this machine). The `run_eval.py` script creates temporary command files then runs `claude -p`, which never returns. This was confirmed not to be an extra-usage issue — the hang reproduces on normal usage. The same workflow reportedly works on a different machine.

**To unblock**, try one of:
- [ ] Update Claude Code to a newer version and retest
- [ ] Run on a different machine where `claude -p` + command files works
- [ ] File a bug with Claude Code team about pipe mode hanging with commands/ files

**Once unblocked**, run:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
./scripts/run-description-optimization.sh
# Or one skill at a time:
./scripts/run-description-optimization.sh para-memory-files
```

Results land in `skills/*/evals/trigger-optimization/` with HTML reports.

### 2. Eval Iteration 2 (Decontaminated Baselines)

**What**: Re-run Phase 2c benchmarks with isolated worktrees so baselines can't discover skill files. 4 of 9 baselines were contaminated (paperclip, create-agent-adapter, release, paperclip-restart).

**How**:
- Use `isolation: "worktree"` for baseline agents
- Remove skill files from worktree before running baseline
- Pre-seed PARA directories for `para-memory-files` so with-skill demonstrates in-place updates

### 3. Cleanup

- [ ] Delete accidentally-created CTO agent from eval baseline: `id: 4086acae-a53a-4978-94f3-69bac8120044`
- [ ] Install and configure qmd (Obsidian semantic search CLI — Riley has paid account)
- [ ] Decide whether to commit `dist/*.skill` files or add to `.gitignore`
- [ ] Clean up ephemeral workspace dirs: `skills/*-workspace/` (do NOT commit)

## Key Files

| File | Purpose |
|------|---------|
| `skills/*/SKILL.md` | Skill definitions with optimized descriptions |
| `skills/*/evals/evals.json` | Output quality evals (Phase 2) |
| `skills/*/evals/eval_set.json` | Trigger rate evals (Phase 3) — 20 queries each |
| `scripts/run-description-optimization.sh` | Standalone trigger optimization runner |
| `dist/*.skill` | Packaged skill bundles (9 files) |
| `skills/*-workspace/iteration-1/` | Phase 2c eval results (ephemeral) |

## Memory Reference

Full history: `~/.claude/projects/-Users-rileypetersen-paperclip/memory/project_skill_creator_treatment.md`
