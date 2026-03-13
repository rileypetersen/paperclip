import { spawn } from "node:child_process";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, companies, issues } from "@paperclipai/db";
import type { NotificationProvider as NotificationProviderType } from "@paperclipai/shared";
import type { NotificationsConfig } from "../config.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";

export type BoardNotificationKind =
  | "board_assigned"
  | "board_blocked"
  | "board_question"
  | "board_stalled";

export interface IssueNotificationSnapshot {
  id: string;
  companyId: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeUserId: string | null;
  updatedAt: Date | string;
}

export interface IssueCommentNotificationSnapshot {
  id: string;
  body: string;
  authorAgentId: string | null;
  authorUserId: string | null;
}

export interface CompanyNotificationSummary {
  id: string;
  name: string;
  issuePrefix: string;
}

export interface BoardNotificationPayload {
  kind: BoardNotificationKind;
  notificationId: string;
  company: CompanyNotificationSummary;
  issue: {
    id: string;
    identifier: string;
    title: string;
    status: string;
    url: string;
  };
  recipients: string[];
  trigger: {
    detectedAt: string;
    reason: string;
    thresholdMinutes?: number;
  };
  comment?: {
    id: string;
    bodySnippet: string;
    authorType: "agent" | "user";
    authorId: string;
  };
  email: {
    subject: string;
    text: string;
  };
}

export interface BoardMarkerMatch {
  kind: Extract<BoardNotificationKind, "board_blocked" | "board_question">;
  summaryLine: string;
  bodySnippet: string;
}

export interface NotificationDeliveryProvider {
  provider: NotificationProviderType;
  deliver(notification: BoardNotificationPayload): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface NotificationRepository {
  getCompany(companyId: string): Promise<CompanyNotificationSummary | null>;
  getLatestSentAt(input: {
    companyId: string;
    issueId: string;
    notificationId: string;
  }): Promise<Date | null>;
  listStalledBoardIssues(input: {
    now: Date;
    thresholdMinutes: number;
  }): Promise<Array<IssueNotificationSnapshot & { company: CompanyNotificationSummary }>>;
}

export interface BoardNotificationService {
  notifyIssueCreated(issue: IssueNotificationSnapshot): Promise<void>;
  notifyIssueUpdated(input: {
    before: IssueNotificationSnapshot;
    after: IssueNotificationSnapshot;
  }): Promise<void>;
  notifyIssueComment(input: {
    issue: IssueNotificationSnapshot;
    comment: IssueCommentNotificationSnapshot;
  }): Promise<void>;
  tickBoardStalledIssues(now?: Date): Promise<{ checked: number; sent: number; skipped: number }>;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function truncateSnippet(value: string, maxLength = 280): string {
  return value.trim().slice(0, maxLength);
}

export function resolveNotificationBaseUrl(input: {
  authPublicBaseUrl?: string | undefined;
  runtimeBaseUrl?: string | undefined;
}): string | null {
  return normalizeBaseUrl(input.authPublicBaseUrl) ?? normalizeBaseUrl(input.runtimeBaseUrl);
}

export function parseBoardNotificationMarker(body: string): BoardMarkerMatch | null {
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*BOARD-(QUESTION|BLOCKED):\s*(.+?)\s*$/i);
    if (!match) continue;
    return {
      kind: match[1].toUpperCase() === "QUESTION" ? "board_question" : "board_blocked",
      summaryLine: match[2].trim(),
      bodySnippet: truncateSnippet(body),
    };
  }
  return null;
}

export function buildBoardNotificationId(input: {
  kind: BoardNotificationKind;
  issueId: string;
  issueUpdatedAt: Date | string;
  commentId?: string;
}): string {
  if (input.commentId) {
    return `${input.kind}:${input.issueId}:${input.commentId}`;
  }
  return `${input.kind}:${input.issueId}:${asDate(input.issueUpdatedAt).toISOString()}`;
}

function buildNotificationReason(input: {
  kind: BoardNotificationKind;
  issue: IssueNotificationSnapshot;
  marker?: BoardMarkerMatch | null;
  thresholdMinutes?: number;
}): string {
  if (input.kind === "board_assigned") {
    return `Issue ${input.issue.identifier ?? input.issue.id} was assigned to the Board.`;
  }
  if (input.kind === "board_blocked") {
    if (input.marker) return `Board-blocked marker: ${input.marker.summaryLine}`;
    return `Issue status changed to blocked.`;
  }
  if (input.kind === "board_question") {
    return `Board question: ${input.marker?.summaryLine ?? "Action requested from the Board."}`;
  }
  return `Issue has been stale for at least ${input.thresholdMinutes ?? 0} minutes.`;
}

function buildNotificationSubject(kind: BoardNotificationKind, identifier: string, title: string): string {
  if (kind === "board_assigned") return `[Paperclip][Board] New assignment: ${identifier} ${title}`;
  if (kind === "board_blocked") return `[Paperclip][Board] Blocked: ${identifier} ${title}`;
  if (kind === "board_question") return `[Paperclip][Board] Question: ${identifier} ${title}`;
  return `[Paperclip][Board] Stalled: ${identifier} ${title}`;
}

function buildNotificationEmailText(input: {
  companyName: string;
  identifier: string;
  title: string;
  status: string;
  reason: string;
  url: string;
  comment?: BoardNotificationPayload["comment"];
}): string {
  const lines = [
    `Company: ${input.companyName}`,
    `Issue: ${input.identifier} ${input.title}`,
    `Status: ${input.status}`,
    "",
    `Why this email was sent: ${input.reason}`,
  ];

  if (input.comment) {
    lines.push("");
    lines.push(
      `Relevant comment (${input.comment.authorType} ${input.comment.authorId}): ${input.comment.bodySnippet}`,
    );
  }

  lines.push("");
  lines.push(`Open issue: ${input.url}`);
  return lines.join("\n");
}

function formatDiscordPayload(notification: BoardNotificationPayload) {
  const colorMap: Record<BoardNotificationKind, number> = {
    board_assigned: 0x5865f2,
    board_blocked: 0xed4245,
    board_stalled: 0xfee75c,
    board_question: 0x57f287,
  };
  return {
    embeds: [
      {
        title: `[${notification.kind}] ${notification.issue.identifier} ${notification.issue.title}`,
        description: notification.trigger.reason,
        url: notification.issue.url,
        color: colorMap[notification.kind] ?? 0x5865f2,
        fields: [
          { name: "Company", value: notification.company.name, inline: true },
          { name: "Status", value: notification.issue.status, inline: true },
        ],
        footer: { text: "Paperclip Board Notification" },
      },
    ],
  };
}

export function createWebhookNotificationProvider(
  webhookUrl: string,
): NotificationDeliveryProvider {
  return {
    provider: "webhook",
    async deliver(notification) {
      try {
        const isDiscord = webhookUrl.includes("discord.com/api/webhooks/");
        const body = isDiscord ? formatDiscordPayload(notification) : notification;
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          return { ok: false, error: `Webhook returned ${response.status}` };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export function createCommandNotificationProvider(config: NotificationsConfig): NotificationDeliveryProvider {
  return {
    provider: config.provider,
    async deliver(notification) {
      if (config.provider === "disabled") {
        return { ok: false, error: "Notification provider is disabled" };
      }
      if (config.provider !== "command") {
        return { ok: false, error: `Unsupported notification provider: ${config.provider}` };
      }
      if (!config.command.path) {
        return { ok: false, error: "Notification command path is not configured" };
      }

      return new Promise((resolve) => {
        const child = spawn(config.command.path!, config.command.args, {
          stdio: ["pipe", "ignore", "pipe"],
        });

        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        child.on("error", (err) => {
          resolve({ ok: false, error: err.message });
        });

        child.on("close", (code) => {
          if (code === 0) {
            resolve({ ok: true });
            return;
          }
          const message = stderr.trim() || `Notification command exited with code ${code ?? "unknown"}`;
          resolve({ ok: false, error: message });
        });

        child.stdin.end(JSON.stringify(notification));
      });
    },
  };
}

export function createDbNotificationRepository(db: Db): NotificationRepository {
  return {
    async getCompany(companyId) {
      return db
        .select({
          id: companies.id,
          name: companies.name,
          issuePrefix: companies.issuePrefix,
        })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    },

    async getLatestSentAt(input) {
      return db
        .select({ createdAt: activityLog.createdAt })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, input.companyId),
            eq(activityLog.action, "notification.sent"),
            eq(activityLog.entityType, "issue"),
            eq(activityLog.entityId, input.issueId),
            sql`${activityLog.details} ->> 'notificationId' = ${input.notificationId}`,
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(1)
        .then((rows) => rows[0]?.createdAt ?? null);
    },

    async listStalledBoardIssues(input) {
      const cutoff = new Date(input.now.getTime() - input.thresholdMinutes * 60_000);
      return db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          assigneeUserId: issues.assigneeUserId,
          updatedAt: issues.updatedAt,
          company: {
            id: companies.id,
            name: companies.name,
            issuePrefix: companies.issuePrefix,
          },
        })
        .from(issues)
        .innerJoin(companies, eq(companies.id, issues.companyId))
        .where(
          and(
            isNotNull(issues.assigneeUserId),
            inArray(issues.status, ["todo", "in_progress", "blocked"]),
            isNull(issues.hiddenAt),
            lte(issues.updatedAt, cutoff),
          ),
        )
        .orderBy(asc(issues.updatedAt));
    },
  };
}

export function createNotificationService(input: {
  db: Db;
  config: NotificationsConfig;
  runtimeBaseUrl?: string | undefined;
  authPublicBaseUrl?: string | undefined;
  provider?: NotificationDeliveryProvider;
  repository?: NotificationRepository;
}): BoardNotificationService {
  const repository = input.repository ?? createDbNotificationRepository(input.db);
  const provider = input.provider ?? createCommandNotificationProvider(input.config);
  const recipients = [...input.config.boardEmails];
  const baseUrl = resolveNotificationBaseUrl({
    authPublicBaseUrl: input.authPublicBaseUrl,
    runtimeBaseUrl: input.runtimeBaseUrl,
  });

  async function sendNotification(args: {
    kind: BoardNotificationKind;
    issue: IssueNotificationSnapshot;
    company: CompanyNotificationSummary;
    detectedAt: Date;
    reason: string;
    thresholdMinutes?: number;
    comment?: IssueCommentNotificationSnapshot;
    commentSnippet?: string;
  }) {
    if (input.config.provider === "disabled" || !baseUrl) {
      return false;
    }
    if (recipients.length === 0 && input.config.provider !== "webhook") {
      return false;
    }

    const identifier = args.issue.identifier ?? `${args.company.issuePrefix}-${args.issue.id}`;
    const notificationId = buildBoardNotificationId({
      kind: args.kind,
      issueId: args.issue.id,
      issueUpdatedAt: args.issue.updatedAt,
      commentId: args.comment?.id,
    });
    const latestSentAt = await repository.getLatestSentAt({
      companyId: args.issue.companyId,
      issueId: args.issue.id,
      notificationId,
    });

    if (latestSentAt) {
      if (args.kind !== "board_stalled") return false;
      const elapsedMinutes = (args.detectedAt.getTime() - latestSentAt.getTime()) / 60_000;
      if (elapsedMinutes < input.config.stalledCooldownMinutes) return false;
    }

    const issueUrl = `${baseUrl}/issues/${args.issue.id}`;
    const comment =
      args.comment && args.commentSnippet
        ? {
            id: args.comment.id,
            bodySnippet: args.commentSnippet,
            authorType: args.comment.authorUserId ? ("user" as const) : ("agent" as const),
            authorId: args.comment.authorUserId ?? args.comment.authorAgentId ?? "unknown",
          }
        : undefined;

    const payload: BoardNotificationPayload = {
      kind: args.kind,
      notificationId,
      company: args.company,
      issue: {
        id: args.issue.id,
        identifier,
        title: args.issue.title,
        status: args.issue.status,
        url: issueUrl,
      },
      recipients,
      trigger: {
        detectedAt: args.detectedAt.toISOString(),
        reason: args.reason,
        ...(args.thresholdMinutes ? { thresholdMinutes: args.thresholdMinutes } : {}),
      },
      ...(comment ? { comment } : {}),
      email: {
        subject: buildNotificationSubject(args.kind, identifier, args.issue.title),
        text: buildNotificationEmailText({
          companyName: args.company.name,
          identifier,
          title: args.issue.title,
          status: args.issue.status,
          reason: args.reason,
          url: issueUrl,
          comment,
        }),
      },
    };

    const result = await provider.deliver(payload);
    const details = {
      kind: args.kind,
      notificationId,
      provider: provider.provider,
      recipients,
      commentId: args.comment?.id ?? null,
      issueUpdatedAt: asDate(args.issue.updatedAt).toISOString(),
    } as Record<string, unknown>;

    if (result.ok) {
      await logActivity(input.db, {
        companyId: args.issue.companyId,
        actorType: "system",
        actorId: "notification_service",
        action: "notification.sent",
        entityType: "issue",
        entityId: args.issue.id,
        details,
      });
      return true;
    }

    logger.warn(
      {
        issueId: args.issue.id,
        notificationId,
        kind: args.kind,
        provider: provider.provider,
        error: result.error,
      },
      "board notification delivery failed",
    );

    await logActivity(input.db, {
      companyId: args.issue.companyId,
      actorType: "system",
      actorId: "notification_service",
      action: "notification.failed",
      entityType: "issue",
      entityId: args.issue.id,
      details: {
        ...details,
        error: result.error,
      },
    });
    return false;
  }

  async function loadCompany(companyId: string) {
    const company = await repository.getCompany(companyId);
    if (!company) {
      logger.warn({ companyId }, "skipping notification for missing company");
      return null;
    }
    return company;
  }

  return {
    async notifyIssueCreated(issue) {
      if (!issue.assigneeUserId) return;
      const company = await loadCompany(issue.companyId);
      if (!company) return;
      await sendNotification({
        kind: "board_assigned",
        issue,
        company,
        detectedAt: new Date(),
        reason: buildNotificationReason({ kind: "board_assigned", issue }),
      });
    },

    async notifyIssueUpdated({ before, after }) {
      const company = after.assigneeUserId ? await loadCompany(after.companyId) : null;
      if (after.assigneeUserId && after.assigneeUserId !== before.assigneeUserId && company) {
        await sendNotification({
          kind: "board_assigned",
          issue: after,
          company,
          detectedAt: new Date(),
          reason: buildNotificationReason({ kind: "board_assigned", issue: after }),
        });
      }
      if (
        after.assigneeUserId &&
        before.status !== "blocked" &&
        after.status === "blocked" &&
        company
      ) {
        await sendNotification({
          kind: "board_blocked",
          issue: after,
          company,
          detectedAt: new Date(),
          reason: buildNotificationReason({ kind: "board_blocked", issue: after }),
        });
      }
    },

    async notifyIssueComment({ issue, comment }) {
      if (!issue.assigneeUserId) return;
      const marker = parseBoardNotificationMarker(comment.body);
      if (!marker) return;
      const company = await loadCompany(issue.companyId);
      if (!company) return;
      await sendNotification({
        kind: marker.kind,
        issue,
        company,
        detectedAt: new Date(),
        reason: buildNotificationReason({
          kind: marker.kind,
          issue,
          marker,
        }),
        comment,
        commentSnippet: marker.bodySnippet,
      });
    },

    async tickBoardStalledIssues(now = new Date()) {
      const staleIssues = await repository.listStalledBoardIssues({
        now,
        thresholdMinutes: input.config.stalledThresholdMinutes,
      });

      let sent = 0;
      let skipped = 0;

      for (const staleIssue of staleIssues) {
        const delivered = await sendNotification({
          kind: "board_stalled",
          issue: staleIssue,
          company: staleIssue.company,
          detectedAt: now,
          reason: buildNotificationReason({
            kind: "board_stalled",
            issue: staleIssue,
            thresholdMinutes: input.config.stalledThresholdMinutes,
          }),
          thresholdMinutes: input.config.stalledThresholdMinutes,
        });
        if (delivered) sent += 1;
        else skipped += 1;
      }

      return {
        checked: staleIssues.length,
        sent,
        skipped,
      };
    },
  };
}
