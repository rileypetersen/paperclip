import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/error-handler.js";

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({}));
const mockHeartbeatService = vi.hoisted(() => ({}));
const mockIssueApprovalService = vi.hoisted(() => ({}));
const mockIssueService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(),
  resolveAdapterConfigForRuntime: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  accessService: () => mockAccessService,
  approvalService: () => mockApprovalService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  secretService: () => mockSecretService,
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", agentRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("GET /agents/:id/config-files", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-agent-config-files-"));
    mockAgentService.getById.mockReset();
    mockAccessService.canUser.mockReset();
    mockAccessService.hasPermission.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns readable agent config files from the instructions directory", async () => {
    await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# Agent\n");
    await fs.writeFile(path.join(tempDir, "SOUL.md"), "# Soul\n");
    await fs.writeFile(path.join(tempDir, "HEARTBEAT.md"), "# Heartbeat\n");

    mockAgentService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      adapterConfig: {
        instructionsFilePath: path.join(tempDir, "AGENTS.md"),
      },
    });

    const app = createApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: false,
      companyIds: [],
    });

    const res = await request(app).get("/api/agents/11111111-1111-4111-8111-111111111111/config-files");

    expect(res.status).toBe(200);
    expect(res.body.instructionsFilePath).toBe(path.join(tempDir, "AGENTS.md"));
    expect(res.body.directoryPath).toBe(tempDir);
    expect(res.body.files).toHaveLength(3);
    expect(res.body.files.map((file: { label: string }) => file.label)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "HEARTBEAT.md",
    ]);
  });

  it("returns an empty list when the agent has no instructions path", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      adapterConfig: {},
    });

    const app = createApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: false,
      companyIds: [],
    });

    const res = await request(app).get("/api/agents/11111111-1111-4111-8111-111111111111/config-files");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      instructionsFilePath: null,
      directoryPath: null,
      files: [],
    });
  });

  it("rejects board users without company access", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      adapterConfig: {},
    });

    const app = createApp({
      type: "board",
      source: "session",
      isInstanceAdmin: false,
      userId: "user-1",
      companyIds: [],
    });

    const res = await request(app).get("/api/agents/11111111-1111-4111-8111-111111111111/config-files");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("User does not have access to this company");
  });
});
