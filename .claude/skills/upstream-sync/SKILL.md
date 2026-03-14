---
name: upstream-sync
description: >
  Sync your local Paperclip fork with upstream changes. Use when someone says
  "pull latest changes", "sync with upstream", "what's new upstream", "merge
  from origin", "update from main repo", or when you notice the fork is behind.
  Also use during opstimizer reviews if drift is detected. Works for any fork
  that tracks an upstream remote.
---

# Upstream Sync

Safely merge upstream changes into your local fork without clobbering your customizations. Non-conflicting changes are applied automatically. Conflicting changes get analyzed and presented as recommendations.

## The Procedure

### 1. Pre-flight Checks

All of these must pass before proceeding. If any fail, explain why and stop.

```bash
# 1a. Verify upstream remote exists
git remote get-url upstream

# 1b. Verify clean worktree (no staged or unstaged changes)
git status --porcelain | grep -v '^??' | head -1
# If any output, STOP: "Commit or stash your changes first."

# 1c. Fetch latest
git fetch upstream master
```

### 2. Assess State

```bash
MERGE_BASE=$(git merge-base HEAD upstream/master)
BEHIND=$(git rev-list --count HEAD..upstream/master)
echo "Merge base: $MERGE_BASE"
echo "Commits behind: $BEHIND"
git diff --stat $MERGE_BASE upstream/master   # what upstream changed
```

If `$BEHIND` is 0, say "Already up to date" and stop.

Present a high-level summary grouped by area (server, UI, packages, db, docs, config) before proceeding.

### 3. Create Sync Branch

Always work on a branch so the sync is safely reversible:

```bash
BRANCH="upstream-sync-$(date +%Y-%m-%d)"
# If branch exists, append counter
git checkout -b "$BRANCH"
```

If anything goes wrong at any point, the user can `git checkout master && git branch -D "$BRANCH"` to abort cleanly.

### 4. Classify Changes

Compare against the **merge base** — the point where the fork diverged. This is critical: comparing against HEAD would miss committed local changes and silently overwrite them.

```bash
MERGE_BASE=$(git merge-base HEAD upstream/master)

# Files changed locally since divergence (committed work)
git diff --name-only $MERGE_BASE HEAD | sort > "$TMPDIR/local.txt"

# Files changed upstream since divergence
git diff --name-only $MERGE_BASE upstream/master | sort > "$TMPDIR/upstream.txt"

# Untracked local files (could collide with upstream additions)
git ls-files --others --exclude-standard | sort > "$TMPDIR/untracked.txt"

# Upstream additions specifically (new files that didn't exist at merge base)
git diff --diff-filter=A --name-only $MERGE_BASE upstream/master | sort > "$TMPDIR/upstream_added.txt"

# Upstream deletions
git diff --diff-filter=D --name-only $MERGE_BASE upstream/master | sort > "$TMPDIR/upstream_deleted.txt"

# Upstream renames (old -> new)
git diff --name-status -M $MERGE_BASE upstream/master | grep '^R' > "$TMPDIR/upstream_renamed.txt"

# Classify
comm -23 "$TMPDIR/upstream.txt" "$TMPDIR/local.txt" > "$TMPDIR/safe.txt"
comm -12 "$TMPDIR/upstream.txt" "$TMPDIR/local.txt" > "$TMPDIR/conflicting.txt"
```

**Then apply these filters:**

- **Remove `pnpm-lock.yaml`** from all lists — it's always regenerated, never merged.
- **Check untracked collisions**: `comm -12 "$TMPDIR/upstream_added.txt" "$TMPDIR/untracked.txt"` — if any match, move them from "safe" to "conflicting" so they aren't silently overwritten.
- **Check `.upstream-sync-skipped`** (if it exists): for each entry, compare the stored upstream commit hash against the current upstream hash for that file. Only re-surface if the file has changed since it was skipped.
- **Flag upstream renames**: if the old name appears in `local.txt` (user modified the original), flag it as a conflict requiring manual attention.

**Buckets:**

- **Safe** — Changed upstream only, no local modifications, no untracked collisions. Apply automatically.
- **Conflicting** — Changed both sides, or untracked collision, or renamed file with local edits. Needs analysis.
- **Local-only** — Your changes. Untouched by this process.

### 5. Apply Safe Changes

Split safe files by change type:

```bash
# Safe modifications/additions — checkout from upstream
git checkout upstream/master -- <file1> <file2> ...

# Safe deletions — remove the file
git rm <file1> <file2> ...
```

Batch by area (server, UI, packages/db, packages/shared, docs, config, etc.) and commit each batch:

```
upstream-sync: merge {area} changes from upstream/master

Applied {N} non-conflicting upstream changes.
Files: {list}
```

### 6. Analyze Conflicts

For each conflicting file, read both versions and determine:

1. **What upstream changed** — the intent behind their diff
2. **What you changed locally** — the intent behind your diff
3. **Are they compatible?** — Do they touch the same lines/logic, or different parts?

**Special cases to handle:**

- **Migration files** (`packages/db/src/migrations/`): If both sides added migrations with the same numeric prefix, the user will need to renumber. Flag with explicit instructions: renumber the local migration, update `meta/_journal.json`, and regenerate the snapshot.
- **Binary files**: Don't attempt to diff. Present file sizes and let the user pick.
- **Known fork-specific paths**: Docker configs (`docker-compose*.yml`, `Dockerfile`, `docker/`), `.env.example`, local scripts (`scripts/check-*.mjs`) — default recommendation is "keep local" unless the user says otherwise.
- **Renamed files**: If upstream renamed a file the user also modified, present both the rename and the content diff. The user needs to decide whether to follow the rename and port their changes.

Classify each conflict as:

- **Compatible** — Changes touch different parts of the file. Merge manually, explain what you combined.
- **Incompatible but upstream is better** — Local change is outdated or upstream supersedes it. Recommend taking upstream.
- **Incompatible but local is intentional** — Deliberate fork customization. Recommend keeping local and skipping.
- **Needs decision** — Both changes are substantive, right call isn't obvious. Present both with context and ask.

### 7. Present Conflict Report

```markdown
## Upstream Sync Report

**Merge base:** {hash} ({date})
**Commits behind:** {N}
**Safe files merged:** {N}
**Conflicts to resolve:** {N}

### Auto-applied (safe changes)
{N} files across {areas} — all committed.

### Auto-merged (compatible conflicts)
| File | Upstream change | Local change | Result |
|------|----------------|--------------|--------|
| {path} | {description} | {description} | Merged both |

### Recommendations
| File | Recommendation | Reason |
|------|---------------|--------|
| {path} | Take upstream | Local was temp fix, upstream has proper solution |
| {path} | Keep local | Intentional fork customization |

### Needs Decision
| File | Upstream intent | Local intent |
|------|----------------|--------------|
| {path} | {what they did} | {what you did} |

### Migration Conflicts (if any)
{Details on renumbering needed}

### Previously Skipped (re-surfaced)
| File | Last skipped | What changed since |
|------|-------------|-------------------|
| {path} | {date/hash} | {description} |
```

### 8. Apply Approved Merges

After the user approves, commit:

```
upstream-sync: resolve conflicts from upstream/master

Merged: {files}
Kept local: {files}
Took upstream: {files}
```

For files the user chose to skip, record them with the current upstream commit hash:

```bash
echo "{file} $(git rev-parse upstream/master)" >> .upstream-sync-skipped
```

### 9. Handle Lockfile & Dependencies

After all file changes are applied:

```bash
pnpm install
```

Commit the regenerated lockfile separately:

```
upstream-sync: regenerate pnpm-lock.yaml
```

### 10. Run Migrations

If upstream added or modified files in `packages/db/src/migrations/` or `packages/db/src/schema/`:

```bash
pnpm db:generate   # regenerate migrations if schema changed
```

If new migration files were added, the server will apply them on next startup. Restart if needed using the `paperclip-restart` skill.

### 11. Verify

```bash
pnpm build          # does it compile?
pnpm test:run       # do tests pass?
```

If something breaks, identify which upstream change caused it. Roll back that specific file:

```bash
git checkout HEAD~1 -- <file>    # revert to pre-merge state
pnpm build                       # verify fix
```

If the entire sync is unsalvageable:

```bash
git checkout master
git branch -D "$BRANCH"
```

Master is untouched. Nothing was lost.

### 12. Complete

Once verified, merge the sync branch:

```bash
git checkout master
git merge "$BRANCH"
git branch -d "$BRANCH"     # clean up
```

Ask the user if they want to push to origin.

## Principles

- **Never overwrite local changes without explicit approval.** The user's customizations are intentional until proven otherwise.
- **The merge base is the source of truth** for what "local" and "upstream" mean. Never compare against HEAD directly.
- **The sync branch is your safety net.** Master is untouched until step 12. If anything goes wrong, abort and delete the branch.
- **Group commits by area** so `git log` tells a clear story.
- **If the upstream diff is large (100+ files)**, summarize by area first. The user needs the big picture before file-level details.
- **When in doubt, ask.** A wrong merge is worse than a delayed merge.
- **Migration conflicts are special.** Never silently merge migrations — ordering matters and duplicates break the schema.
