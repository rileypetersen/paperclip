#!/usr/bin/env node

import { spawn } from "node:child_process";

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

function toBase64Url(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildRawMessage(payload, fromName, fromEmail) {
  const to = payload.recipients.join(", ");
  const raw = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${payload.email.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    payload.email.text,
  ].join("\r\n");
  return toBase64Url(raw);
}

async function main() {
  const input = await readStdin();
  const payload = JSON.parse(input);
  const fromEmail = process.env.PAPERCLIP_NOTIFICATION_FROM_EMAIL?.trim();
  const fromName = process.env.PAPERCLIP_NOTIFICATION_FROM_NAME?.trim() || "Paperclip";

  if (!fromEmail) {
    throw new Error("PAPERCLIP_NOTIFICATION_FROM_EMAIL is required");
  }
  if (!Array.isArray(payload.recipients) || payload.recipients.length === 0) {
    throw new Error("Notification payload must include at least one recipient");
  }

  const raw = buildRawMessage(payload, fromName, fromEmail);

  await new Promise((resolve, reject) => {
    const child = spawn(
      "gws",
      [
        "gmail",
        "users",
        "messages",
        "send",
        "--params",
        '{"userId":"me"}',
        "--json",
        JSON.stringify({ raw }),
      ],
      { stdio: ["ignore", "inherit", "pipe"] },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(stderr.trim() || `gws exited with code ${code ?? "unknown"}`));
    });
  });
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
