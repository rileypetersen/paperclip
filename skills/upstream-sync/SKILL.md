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

### 1. Assess State

```bash
git fetch origin master
git log --oneline HEAD..origin/master | wc -l   # how far behind
git diff --stat HEAD origin/master               # what changed
```

If HEAD is up to date, say so and stop.

### 2. Classify Changes

Split upstream changes into three buckets:

```bash
# Files changed upstream only (safe to merge)
git diff --name-only HEAD origin/master | sort > /tmp/upstream.txt
git diff --name-only HEAD | sort > /tmp/local_modified.txt
git ls-files --others --exclude-standard | sort > /tmp/local_new.txt
cat /tmp/local_modified.txt /tmp/local_new.txt | sort -u > /tmp/local_all.txt

comm -23 /tmp/upstream.txt /tmp/local_all.txt    # safe
comm -12 /tmp/upstream.txt /tmp/local_all.txt    # conflicting
```

- **Safe** — Changed upstream, untouched locally. Apply automatically.
- **Conflicting** — Changed both upstream and locally. Needs analysis.
- **Local-only** — Your changes. Untouched by this process.

### 3. Apply Safe Changes

For safe files, check them out directly from the upstream branch:

```bash
git checkout origin/master -- <file1> <file2> ...
```

Do this in batches grouped by area (server, UI, packages, etc.) so the commit history is readable. Commit each batch:

```
upstream-sync: merge {area} changes from origin/master

Applied {N} non-conflicting upstream changes.
Files: {list}
```

### 4. Analyze Conflicts

For each conflicting file, read both versions and determine:

1. **What upstream changed** — the intent behind their diff
2. **What you changed locally** — the intent behind your diff
3. **Are they compatible?** — Do they touch the same lines/logic, or different parts of the file?

Classify each conflict as:

- **Compatible** — Changes touch different parts of the file. Can be merged with a careful manual merge. Do it and explain what you combined.
- **Incompatible but upstream is better** — Your local change is outdated or upstream's approach supersedes it. Recommend taking upstream's version.
- **Incompatible but local is intentional** — Your change is a deliberate fork customization. Recommend keeping local and skipping upstream's change.
- **Needs decision** — Both changes are substantive and the right call isn't obvious. Present both versions with context and ask.

### 5. Present Conflict Report

```markdown
## Upstream Sync Report

**Commits behind:** {N}
**Safe files merged:** {N}
**Conflicts analyzed:** {N}

### Auto-merged (compatible changes)
| File | What upstream changed | What you changed | Result |
|------|----------------------|------------------|--------|
| {path} | {description} | {description} | Merged both |

### Recommendations
| File | Recommendation | Reason |
|------|---------------|--------|
| {path} | Take upstream | Your change was a temp fix, upstream has proper solution |
| {path} | Keep local | Intentional customization for your deployment |

### Needs Decision
| File | Upstream intent | Local intent |
|------|----------------|--------------|
| {path} | {what they did} | {what you did} |
```

### 6. Apply Approved Merges

After the user approves (or for auto-merged compatible changes), commit:

```
upstream-sync: resolve conflicts from origin/master

Merged: {files}
Kept local: {files}
Took upstream: {files}
```

### 7. Handle Lockfile

`pnpm-lock.yaml` conflicts are special — don't try to manually merge. After all other changes are applied:

```bash
pnpm install
```

This regenerates the lockfile correctly. Commit it separately.

### 8. Verify

After merging, run a quick sanity check:

```bash
pnpm build        # does it compile?
pnpm test          # do tests pass?
```

If something breaks, identify which upstream change caused it and roll back that specific file.

## Principles

Never overwrite local changes without explicit approval. The user's customizations are intentional until proven otherwise.

Group commits by area so `git log` tells a clear story of what was synced and when.

If the upstream diff is large (100+ files), summarize by area first before diving into conflicts. The user needs the big picture before details.

When in doubt about a conflict, ask. A wrong merge is worse than a delayed merge.
