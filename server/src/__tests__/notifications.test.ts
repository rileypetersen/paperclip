import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

function mockDb(): Db {
  const chainable: any = {
    select: () => chainable,
    from: () => chainable,
    where: () => chainable,
    orderBy: () => chainable,
    limit: () => chainable,
    then: (resolve: (v: any) => void) => Promise.resolve([]).then(resolve),
  };
  return chainable as Db;
}
import type { NotificationsConfig } from "../config.ts";
import {
  createCommandNotificationProvider,
  createNotificationService,
  parseBoardNotificationMarker,
  type BoardNotificationPayload,
  type NotificationDeliveryProvider,
  type CompanyNotificationSummary,
  type IssueNotificationSnapshot,
  type NotificationRepository,
} from "../services/notifications.ts";

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

const { logActivity } = await import("../services/activity-log.js");

function makeConfig(overrides?: Partial<NotificationsConfig>): NotificationsConfig {
  const command = {
    path: process.execPath,
    args: [],
    ...(overrides?.command ?? {}),
  };
  const base: NotificationsConfig = {
    provider: "command",
    boardEmails: ["board@example.com"],
    webhookUrl: undefined,
    discord: undefined,
    command,
    stalledThresholdMinutes: 240,
    stalledCooldownMinutes: 1440,
  };
  return { ...base, ...overrides, command };
}

function makeCompany(overrides?: Partial<CompanyNotificationSummary>): CompanyNotificationSummary {
  return {
    id: "company-1",
    name: "Acme",
    issuePrefix: "ACM",
    ...overrides,
  };
}

function makeIssue(overrides?: Partial<IssueNotificationSnapshot>): IssueNotificationSnapshot {
  return {
    id: "issue-1",
    companyId: "company-1",
    identifier: "ACM-1",
    title: "Board follow-up",
    status: "todo",
    assigneeUserId: "user-1",
    updatedAt: new Date("2026-03-12T10:00:00.000Z"),
    ...overrides,
  };
}

function createRepository(options?: {
  company?: CompanyNotificationSummary;
  staleIssues?: Array<IssueNotificationSnapshot & { company: CompanyNotificationSummary }>;
}) {
  const company = options?.company ?? makeCompany();
  const latestSentAt = new Map<string, Date>();
  const staleIssues = options?.staleIssues ?? [];

  const repository: NotificationRepository = {
    getCompany: async () => company,
    getLatestSentAt: async ({ notificationId }) => latestSentAt.get(notificationId) ?? null,
    listStalledBoardIssues: async ({ now, thresholdMinutes }) =>
      staleIssues.filter(
        (issue) =>
          new Date(issue.updatedAt).getTime() <= now.getTime() - thresholdMinutes * 60_000,
      ),
  };

  return {
    repository,
    latestSentAt,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseBoardNotificationMarker", () => {
  it("matches BOARD-QUESTION at line start", () => {
    expect(parseBoardNotificationMarker("  BOARD-QUESTION: Need approval\nmore detail")).toEqual(
      expect.objectContaining({
        kind: "board_question",
        summaryLine: "Need approval",
      }),
    );
  });

  it("matches BOARD-BLOCKED case-insensitively", () => {
    expect(parseBoardNotificationMarker(" \tboard-blocked: waiting on credentials")).toEqual(
      expect.objectContaining({
        kind: "board_blocked",
        summaryLine: "waiting on credentials",
      }),
    );
  });

  it("ignores plain question marks", () => {
    expect(parseBoardNotificationMarker("Can the board review this?")).toBeNull();
  });
});

describe("createCommandNotificationProvider", () => {
  it("passes JSON on stdin", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-command-provider-"));
    const outputPath = path.join(tempDir, "payload.json");
    const scriptPath = path.join(tempDir, "capture.mjs");
    fs.writeFileSync(
      scriptPath,
      [
        "import fs from 'node:fs';",
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { input += chunk; });",
        "process.stdin.on('end', () => {",
        `  fs.writeFileSync(${JSON.stringify(outputPath)}, input);`,
        "});",
      ].join("\n"),
    );

    const provider = createCommandNotificationProvider(
      makeConfig({
        command: {
          path: process.execPath,
          args: [scriptPath],
        },
      }),
    );

    const result = await provider.deliver({
      kind: "board_assigned",
      notificationId: "board_assigned:issue-1:2026-03-12T10:00:00.000Z",
      company: makeCompany(),
      issue: {
        id: "issue-1",
        identifier: "ACM-1",
        title: "Board follow-up",
        status: "todo",
        url: "http://runtime/issues/issue-1",
      },
      recipients: ["board@example.com"],
      trigger: {
        detectedAt: "2026-03-12T10:00:00.000Z",
        reason: "Issue ACM-1 was assigned to the Board.",
      },
      email: {
        subject: "subject",
        text: "body",
      },
    });

    expect(result).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual(
      expect.objectContaining({
        kind: "board_assigned",
        recipients: ["board@example.com"],
      }),
    );
  });
});

describe("notification service triggers", () => {
  function createProvider(
    impl?: (notification: BoardNotificationPayload) => Promise<{ ok: true } | { ok: false; error: string }>,
  ): NotificationDeliveryProvider & { sent: BoardNotificationPayload[] } {
    const sent: BoardNotificationPayload[] = [];
    return {
      provider: "command",
      sent,
      async deliver(notification) {
        sent.push(notification);
        if (impl) return impl(notification);
        return { ok: true };
      },
    };
  }

  it("sends once when created with assigneeUserId", async () => {
    const provider = createProvider();
    const { repository, latestSentAt } = createRepository();
    let activityTime = new Date("2026-03-12T10:00:00.000Z");
    vi.mocked(logActivity).mockImplementation(async (_db, input) => {
      if (input.action === "notification.sent" && input.details?.notificationId) {
        latestSentAt.set(String(input.details.notificationId), activityTime);
      }
    });

    const service = createNotificationService({
      db: mockDb(),
      config: makeConfig(),
      repository,
      provider,
      runtimeBaseUrl: "http://runtime",
    });

    await service.notifyIssueCreated(makeIssue());

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.kind).toBe("board_assigned");
    expect(vi.mocked(logActivity)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "notification.sent" }),
    );
  });

  it("sends once when reassigned to a user and ignores unrelated edits", async () => {
    const provider = createProvider();
    const { repository } = createRepository();
    const service = createNotificationService({
      db: mockDb(),
      config: makeConfig(),
      repository,
      provider,
      runtimeBaseUrl: "http://runtime",
    });

    await service.notifyIssueUpdated({
      before: makeIssue({ assigneeUserId: null }),
      after: makeIssue({ assigneeUserId: "user-1" }),
    });
    await service.notifyIssueUpdated({
      before: makeIssue({ assigneeUserId: "user-1", title: "Old title" }),
      after: makeIssue({ assigneeUserId: "user-1", title: "New title" }),
    });

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.kind).toBe("board_assigned");
  });

  it("sends blocked notification only on status transition", async () => {
    const provider = createProvider();
    const { repository } = createRepository();
    const service = createNotificationService({
      db: mockDb(),
      config: makeConfig(),
      repository,
      provider,
      runtimeBaseUrl: "http://runtime",
    });

    await service.notifyIssueUpdated({
      before: makeIssue({ status: "in_progress" }),
      after: makeIssue({ status: "blocked" }),
    });
    await service.notifyIssueUpdated({
      before: makeIssue({ status: "blocked" }),
      after: makeIssue({ status: "blocked" }),
    });

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.kind).toBe("board_blocked");
  });

  it("sends question and blocker marker notifications", async () => {
    const provider = createProvider();
    const { repository } = createRepository();
    const service = createNotificationService({
      db: mockDb(),
      config: makeConfig(),
      repository,
      provider,
      runtimeBaseUrl: "http://runtime",
    });

    await service.notifyIssueComment({
      issue: makeIssue(),
      comment: {
        id: "comment-1",
        body: "BOARD-QUESTION: Can you approve this?",
        authorAgentId: "agent-1",
        authorUserId: null,
      },
    });
    await service.notifyIssueComment({
      issue: makeIssue(),
      comment: {
        id: "comment-2",
        body: "  board-blocked: Need API credentials",
        authorAgentId: "agent-1",
        authorUserId: null,
      },
    });
    await service.notifyIssueComment({
      issue: makeIssue(),
      comment: {
        id: "comment-3",
        body: "Can the board help?",
        authorAgentId: "agent-1",
        authorUserId: null,
      },
    });

    expect(provider.sent.map((item) => item.kind)).toEqual([
      "board_question",
      "board_blocked",
      "issue_comment",
    ]);
  });

  it("uses auth public base URL when configured and runtime URL otherwise", async () => {
    const provider = createProvider();
    const runtimeProvider = createProvider();
    const { repository } = createRepository();
    const publicService = createNotificationService({
      db: mockDb(),
      config: makeConfig(),
      repository,
      provider,
      authPublicBaseUrl: "https://paperclip.example.com",
      runtimeBaseUrl: "http://runtime",
    });
    const runtimeService = createNotificationService({
      db: mockDb(),
      config: makeConfig(),
      repository,
      provider: runtimeProvider,
      runtimeBaseUrl: "http://runtime",
    });

    await publicService.notifyIssueCreated(makeIssue({ id: "issue-public" }));
    await runtimeService.notifyIssueCreated(makeIssue({ id: "issue-runtime" }));

    expect(provider.sent[0]?.issue.url).toBe("https://paperclip.example.com/issues/issue-public");
    expect(runtimeProvider.sent[0]?.issue.url).toBe("http://runtime/issues/issue-runtime");
  });

  it("logs failure and keeps route-like sends non-fatal", async () => {
    const provider = createProvider(async () => ({ ok: false, error: "command failed" }));
    const { repository } = createRepository();
    const service = createNotificationService({
      db: mockDb(),
      config: makeConfig(),
      repository,
      provider,
      runtimeBaseUrl: "http://runtime",
    });

    await expect(service.notifyIssueCreated(makeIssue())).resolves.toBeUndefined();
    expect(vi.mocked(logActivity)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "notification.failed",
        details: expect.objectContaining({ error: "command failed" }),
      }),
    );
  });
});

describe("notification service stalled work scheduling", () => {
  it("sends for stale issues, skips fresh ones, honors cooldown, and resends after cooldown", async () => {
    const staleIssue = makeIssue({
      id: "issue-stale",
      updatedAt: new Date("2026-03-12T06:00:00.000Z"),
    });
    const freshIssue = makeIssue({
      id: "issue-fresh",
      updatedAt: new Date("2026-03-12T09:30:00.000Z"),
    });
    const provider = {
      provider: "command",
      sent: [] as BoardNotificationPayload[],
      async deliver(notification: BoardNotificationPayload) {
        this.sent.push(notification);
        return { ok: true } as const;
      },
    };
    const { repository, latestSentAt } = createRepository({
      staleIssues: [
        { ...staleIssue, company: makeCompany() },
        { ...freshIssue, company: makeCompany() },
      ],
    });
    let activityTime = new Date("2026-03-12T10:00:00.000Z");
    vi.mocked(logActivity).mockImplementation(async (_db, input) => {
      if (input.action === "notification.sent" && input.details?.notificationId) {
        latestSentAt.set(String(input.details.notificationId), activityTime);
      }
    });

    const service = createNotificationService({
      db: mockDb(),
      config: makeConfig({
        stalledThresholdMinutes: 240,
        stalledCooldownMinutes: 60,
      }),
      repository,
      provider,
      runtimeBaseUrl: "http://runtime",
    });

    const first = await service.tickBoardStalledIssues(new Date("2026-03-12T10:00:00.000Z"));
    activityTime = new Date("2026-03-12T10:30:00.000Z");
    const second = await service.tickBoardStalledIssues(new Date("2026-03-12T10:30:00.000Z"));
    activityTime = new Date("2026-03-12T11:30:00.000Z");
    const third = await service.tickBoardStalledIssues(new Date("2026-03-12T11:30:00.000Z"));

    expect(first).toEqual({ checked: 1, sent: 1, skipped: 0 });
    expect(second).toEqual({ checked: 1, sent: 0, skipped: 1 });
    expect(third).toEqual({ checked: 1, sent: 1, skipped: 0 });
    expect(provider.sent.filter((item) => item.kind === "board_stalled")).toHaveLength(2);
  });

  it("keeps scheduler passes alive when one stalled notification fails and issue updates reset staleness", async () => {
    const staleIssue = makeIssue({
      id: "issue-fails",
      updatedAt: new Date("2026-03-12T05:00:00.000Z"),
    });
    const secondIssue = makeIssue({
      id: "issue-succeeds",
      updatedAt: new Date("2026-03-12T04:30:00.000Z"),
    });
    const provider: NotificationDeliveryProvider = {
      provider: "command",
      async deliver(notification) {
        if (notification.issue.id === "issue-fails") {
          return { ok: false, error: "bridge down" };
        }
        return { ok: true };
      },
    };
    const { repository } = createRepository({
      staleIssues: [
        { ...staleIssue, company: makeCompany() },
        { ...secondIssue, company: makeCompany() },
      ],
    });
    const service = createNotificationService({
      db: mockDb(),
      config: makeConfig({
        stalledThresholdMinutes: 240,
        stalledCooldownMinutes: 60,
      }),
      repository,
      provider,
      runtimeBaseUrl: "http://runtime",
    });

    const first = await service.tickBoardStalledIssues(new Date("2026-03-12T10:00:00.000Z"));

    expect(first).toEqual({ checked: 2, sent: 1, skipped: 1 });
    expect(vi.mocked(logActivity)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "notification.failed" }),
    );

    const updatedRepo = createRepository({
      staleIssues: [],
    });
    const updatedService = createNotificationService({
      db: mockDb(),
      config: makeConfig({
        stalledThresholdMinutes: 240,
        stalledCooldownMinutes: 60,
      }),
      repository: updatedRepo.repository,
      provider,
      runtimeBaseUrl: "http://runtime",
    });
    const second = await updatedService.tickBoardStalledIssues(new Date("2026-03-12T10:10:00.000Z"));
    expect(second).toEqual({ checked: 0, sent: 0, skipped: 0 });
  });
});

describe("createWebhookNotificationProvider", () => {
  it("returns correct shape with webhook provider type", async () => {
    const { createWebhookNotificationProvider } = await import("../services/notifications.ts");
    const provider = createWebhookNotificationProvider("https://example.com/webhook");
    expect(provider.provider).toBe("webhook");
    expect(typeof provider.deliver).toBe("function");
  });
});

describe("webhook notification with empty boardEmails", () => {
  it("sends webhook notification even with empty boardEmails", async () => {
    const provider: NotificationDeliveryProvider = {
      provider: "webhook",
      deliver: vi.fn().mockResolvedValue({ ok: true }),
    };
    const config = makeConfig({ provider: "webhook", boardEmails: [] });
    const { repository } = createRepository();
    const svc = createNotificationService({
      db: mockDb(),
      config,
      provider,
      repository,
      runtimeBaseUrl: "http://localhost:3100",
    });
    await svc.notifyIssueCreated(makeIssue({ assigneeUserId: "local-board" }));
    expect(provider.deliver).toHaveBeenCalled();
  });
});
