#!/usr/bin/env bash
# Check Gmail inbox using gws CLI with common triage filters.
#
# Usage:
#   check-inbox.sh                        # Unread mail to you (default)
#   check-inbox.sh --all                  # All mail to you
#   check-inbox.sh --from "riley@petersen.us"  # Mail from specific sender
#   check-inbox.sh --query "subject:budget"    # Custom query appended to base filter
#   check-inbox.sh --max 20              # Override max results (default: 10)
#
# Environment:
#   AGENT_EMAIL  - required, your @civ.bid alias (e.g. ceo@civ.bid)

set -euo pipefail

MAX=10
FILTER="is:unread"
EXTRA_QUERY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)     FILTER=""; shift ;;
    --from)    EXTRA_QUERY="${EXTRA_QUERY} from:$2"; shift 2 ;;
    --query)   EXTRA_QUERY="${EXTRA_QUERY} $2"; shift 2 ;;
    --max)     MAX="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${AGENT_EMAIL:-}" ]]; then
  echo "Error: AGENT_EMAIL env var required" >&2
  exit 1
fi

QUERY="to:${AGENT_EMAIL}"
if [[ -n "$FILTER" ]]; then
  QUERY="${QUERY} ${FILTER}"
fi
if [[ -n "$EXTRA_QUERY" ]]; then
  QUERY="${QUERY}${EXTRA_QUERY}"
fi

gws gmail +triage --query "$QUERY" --max "$MAX"
