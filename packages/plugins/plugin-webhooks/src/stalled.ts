export interface StalledState {
  stalledSince: string | null;
  alertedAt: string | null;
}

export interface StalledIssue {
  id: string;
  title: string;
  status: string;
  priority: string;
  updatedAt: string;
  companyId: string;
}

export interface StalledDeps {
  getState: (scopeKind: string, scopeId: string, stateKey: string) => Promise<StalledState | null>;
  setState: (scopeKind: string, scopeId: string, stateKey: string, value: StalledState) => Promise<void>;
  listCompanies: () => Promise<Array<{ id: string; name: string }>>;
  listIssues: (input: { companyId: string; status: string }) => Promise<StalledIssue[]>;
  listComments: (issueId: string, companyId: string) => Promise<Array<{ createdAt: string }>>;
  onStalled: (issue: StalledIssue, companyId: string) => Promise<void>;
  now: () => Date;
}

interface StalledCheckConfig {
  stalledThresholdMinutes: number;
  companyFilter: string | undefined;
}

const ACTIVE_STATUSES = ["todo", "in_progress", "in_review", "blocked"];

export async function runStalledCheck(deps: StalledDeps, config: StalledCheckConfig): Promise<void> {
  const now = deps.now();
  const thresholdMs = config.stalledThresholdMinutes * 60 * 1000;

  let companyIds: string[];
  if (config.companyFilter) {
    companyIds = [config.companyFilter];
  } else {
    const companies = await deps.listCompanies();
    companyIds = companies.map((c) => c.id);
  }

  for (const companyId of companyIds) {
    const allIssues: StalledIssue[] = [];
    for (const status of ACTIVE_STATUSES) {
      const issues = await deps.listIssues({ companyId, status });
      allIssues.push(...issues);
    }

    for (const issue of allIssues) {
      let lastActivity = new Date(issue.updatedAt).getTime();

      const comments = await deps.listComments(issue.id, companyId);
      for (const comment of comments) {
        const commentTime = new Date(comment.createdAt).getTime();
        if (commentTime > lastActivity) lastActivity = commentTime;
      }

      const elapsed = now.getTime() - lastActivity;
      const existing = await deps.getState("issue", issue.id, "stalled") ?? { stalledSince: null, alertedAt: null };

      if (elapsed > thresholdMs) {
        const stalledSince = existing.stalledSince ?? now.toISOString();

        if (!existing.alertedAt) {
          await deps.onStalled(issue, companyId);
          await deps.setState("issue", issue.id, "stalled", {
            stalledSince,
            alertedAt: now.toISOString(),
          });
        } else if (!existing.stalledSince) {
          await deps.setState("issue", issue.id, "stalled", { ...existing, stalledSince });
        }
      } else if (existing.stalledSince) {
        await deps.setState("issue", issue.id, "stalled", { stalledSince: null, alertedAt: null });
      }
    }
  }
}

export async function resetStalledState(deps: Pick<StalledDeps, "setState">, issueId: string): Promise<void> {
  await deps.setState("issue", issueId, "stalled", { stalledSince: null, alertedAt: null });
}
