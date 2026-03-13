#!/bin/bash
# Run the skill-creator description optimization loop for all 9 Paperclip skills.
# This script must be run OUTSIDE of a Claude Code session (not nested).
#
# Usage: ./scripts/run-description-optimization.sh [skill-name]
#   If skill-name is provided, only that skill is optimized.
#   Otherwise, all 9 skills are optimized sequentially.
#
# Prerequisites:
#   - ANTHROPIC_API_KEY must be set
#   - `claude` CLI must be on PATH
#   - `pip3 install anthropic` must have been run

set -euo pipefail

SKILL_CREATOR_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
SKILLS_DIR="$(cd "$(dirname "$0")/../skills" && pwd)"
MODEL="claude-sonnet-4-20250514"
MAX_ITERATIONS=5
RUNS_PER_QUERY=3

# Unset CLAUDECODE to allow nesting
unset CLAUDECODE 2>/dev/null || true

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set."
  echo "Export it before running: export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

SKILLS=(
  "para-memory-files"
  "paperclip-create-agent"
  "gmail"
  "release-changelog"
  "pr-report"
  "paperclip"
  "create-agent-adapter"
  "release"
  "paperclip-restart"
)

# If a specific skill was requested, only run that one
if [ -n "${1:-}" ]; then
  SKILLS=("$1")
fi

cd "$SKILL_CREATOR_DIR"

for skill in "${SKILLS[@]}"; do
  skill_path="$SKILLS_DIR/$skill"
  eval_set="$skill_path/evals/eval_set.json"
  results_dir="$skill_path/evals/trigger-optimization"

  if [ ! -f "$eval_set" ]; then
    echo "SKIP: No eval_set.json for $skill"
    continue
  fi

  echo ""
  echo "================================================================"
  echo "  Optimizing: $skill"
  echo "================================================================"
  echo ""

  python3 -m scripts.run_loop \
    --eval-set "$eval_set" \
    --skill-path "$skill_path" \
    --model "$MODEL" \
    --max-iterations "$MAX_ITERATIONS" \
    --runs-per-query "$RUNS_PER_QUERY" \
    --verbose \
    --results-dir "$results_dir" \
    2>&1 | tee "$results_dir/latest-run.log" || {
      echo "FAILED: $skill (exit code $?)"
      continue
    }

  echo ""
  echo "Done: $skill → results at $results_dir/"
done

echo ""
echo "================================================================"
echo "  All done. Check each skill's evals/trigger-optimization/ dir."
echo "================================================================"
