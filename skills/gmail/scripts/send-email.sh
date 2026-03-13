#!/usr/bin/env bash
# Send an email via Gmail API using gws CLI with proper RFC 2822 + base64url encoding.
# Handles From alias (send-as), To, Cc, Bcc, and Subject.
#
# Usage:
#   send-email.sh --to "recipient@example.com" --subject "Hello" --body "Message body"
#   send-email.sh --to "a@x.com,b@x.com" --cc "c@x.com" --bcc "d@x.com" --subject "Hi" --body "Body"
#
# Environment:
#   AGENT_EMAIL  - required, your @civ.bid alias (e.g. ceo@civ.bid)
#   AGENT_ROLE   - required, your display name (e.g. "CEO")

set -euo pipefail

TO=""
CC=""
BCC=""
SUBJECT=""
BODY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)      TO="$2"; shift 2 ;;
    --cc)      CC="$2"; shift 2 ;;
    --bcc)     BCC="$2"; shift 2 ;;
    --subject) SUBJECT="$2"; shift 2 ;;
    --body)    BODY="$2"; shift 2 ;;
    --from)    AGENT_EMAIL="$2"; shift 2 ;;
    --role)    AGENT_ROLE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${AGENT_EMAIL:-}" ]]; then
  echo "Error: AGENT_EMAIL env var or --from flag required" >&2
  exit 1
fi

if [[ -z "${AGENT_ROLE:-}" ]]; then
  echo "Error: AGENT_ROLE env var or --role flag required" >&2
  exit 1
fi

if [[ -z "$TO" ]]; then
  echo "Error: --to is required" >&2
  exit 1
fi

if [[ -z "$SUBJECT" ]]; then
  echo "Error: --subject is required" >&2
  exit 1
fi

# Build RFC 2822 message
MSG="From: ${AGENT_ROLE} <${AGENT_EMAIL}>\r\nTo: ${TO}\r\n"

if [[ -n "$CC" ]]; then
  MSG="${MSG}Cc: ${CC}\r\n"
fi

if [[ -n "$BCC" ]]; then
  MSG="${MSG}Bcc: ${BCC}\r\n"
fi

MSG="${MSG}Subject: ${SUBJECT}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${BODY}"

# Base64url encode (RFC 4648 section 5)
RAW=$(printf '%b' "$MSG" | base64 | tr '+/' '-_' | tr -d '=\n')

# Send via Gmail API
gws gmail users messages send \
  --params '{"userId": "me"}' \
  --json "{\"raw\": \"$RAW\"}"
