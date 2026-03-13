#!/usr/bin/env bash
# One-time setup for gws CLI Gmail access
# Run this as Riley (not as an agent)

set -euo pipefail

echo "=== gws CLI Gmail Setup ==="
echo ""

# 1. Check gws is installed
if ! command -v gws &>/dev/null; then
  echo "Installing gws CLI..."
  npm install -g @googleworkspace/cli
else
  echo "gws CLI already installed: $(gws --version)"
fi

# 2. Check auth status
echo ""
echo "Checking auth status..."
AUTH_METHOD=$(gws auth status --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('auth_method','none'))" 2>/dev/null || echo "none")

if [ "$AUTH_METHOD" = "none" ]; then
  echo ""
  echo "No credentials found. Setting up auth..."
  echo ""
  echo "Step 1: Run gws auth setup (requires gcloud CLI)"
  echo "  gws auth setup --login"
  echo ""
  echo "  OR if you already have a GCP project with Gmail API enabled:"
  echo "  gws auth login -s gmail"
  echo ""
  echo "Step 2: Verify with a test triage:"
  echo "  gws gmail +triage --max 3"
  echo ""
  read -p "Press Enter to run 'gws auth login -s gmail' now, or Ctrl-C to do it manually... "
  gws auth login -s gmail
else
  echo "Auth method: $AUTH_METHOD — already configured!"
fi

# 3. Verify Gmail access
echo ""
echo "Testing Gmail access..."
if gws gmail +triage --max 1 --format json &>/dev/null; then
  echo "Gmail access confirmed!"
else
  echo "Gmail access failed. Check auth with: gws auth status"
  exit 1
fi

# 4. Test send-as aliases
echo ""
echo "Checking send-as aliases..."
echo "To verify agent aliases work, try a dry-run send:"
echo "  gws gmail +send --to riley@petersen.us --subject 'Test from CEO' --body 'Test' --from ceo@civ.bid --dry-run"
echo ""

echo "=== Setup Complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. Google Workspace Admin: Add ceo@, marketing@, engineering@ as aliases on riley@petersen.us"
echo "  2. Gmail Settings: Add send-as addresses for each alias"
echo "  3. Gmail Filters: Create filters to auto-label by To: address"
echo "  4. Cloudflare Email Routing: Add forwarding rules for each agent address → riley@petersen.us"
echo "  5. Set AGENT_EMAIL env var in each agent's adapter config"
