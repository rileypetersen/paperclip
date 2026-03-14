---
name: paperclip-restart
description: >
  Use this skill to kill and restart the running Paperclip server process. Use
  when Paperclip is unresponsive, the server is down, heartbeats are stuck,
  health checks are failing, you see connection refused or 500 errors, or after
  config changes or database migrations that require a restart. Runs an external
  shell script so it works from inside Claude Code. NOT for debugging application
  code bugs or restarting other services — only the Paperclip server process.
---

# Paperclip Restart Skill

Kills the running Paperclip server process and restarts it via an external background script. Safe to run from Claude Code.

## When to Use

- Paperclip API is unresponsive (`curl http://127.0.0.1:3100/api/health` fails)
- Heartbeats are stuck or the scheduler needs a reset
- After database migrations or server config changes
- After updating agent adapter configs that require a server restart

## How to Restart

Run the restart script. It kills existing processes, starts a new server in the background, and waits for it to be healthy.

```bash
/Users/rileypetersen/paperclip/scripts/restart-server.sh
```

For dev mode (with watch/hot-reload):

```bash
/Users/rileypetersen/paperclip/scripts/restart-server.sh --dev
```

## What It Does

1. Finds all `paperclipai run` processes via `pgrep`
2. Sends SIGTERM (graceful shutdown), waits up to 10 seconds
3. Sends SIGKILL if processes are still alive
4. Starts a new server via `nohup` (detached from Claude Code's terminal)
5. Polls the health endpoint for up to 30 seconds
6. Reports success or failure

## Verifying After Restart

After the script reports success, verify:

```bash
# Check server is responding
curl -sf http://127.0.0.1:3100/api/health

# Check agents are reachable
curl -sf http://127.0.0.1:3100/api/companies/{companyId}/agents \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

## Logs

Server output is appended to:

```
/Users/rileypetersen/paperclip/logs/server.log
```

To tail logs:

```bash
tail -f /Users/rileypetersen/paperclip/logs/server.log
```

## Troubleshooting

- **Script says server didn't respond in 30s**: Check `tail -50 /Users/rileypetersen/paperclip/logs/server.log` for errors (port conflict, DB migration failure, etc.)
- **Port already in use**: Another process may be holding port 3100. Run `lsof -ti:3100 | xargs kill` then retry.
- **Embedded postgres not starting**: The postgres child process is managed by the server — if it's orphaned, `pkill -f "embedded-postgres"` then retry.
