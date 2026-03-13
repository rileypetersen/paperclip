import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { accessApi } from "../api/access";
import { ApiError } from "../api/client";
import { dashboardApi } from "../api/dashboard";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { createIssueDetailLocationState } from "../lib/issueDetailBreadcrumb";
import { StatusIcon } from "../components/StatusIcon";
import { PriorityIcon } from "../components/PriorityIcon";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ApprovalCard } from "../components/ApprovalCard";
import { StatusBadge } from "../components/StatusBadge";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Inbox as InboxIcon,
  AlertTriangle,
  ArrowUpRight,
  XCircle,
  X,
  RotateCcw,
} from "lucide-react";
import { Identity } from "../components/Identity";
import { PageTabBar } from "../components/PageTabBar";
import type { HeartbeatRun, Issue, JoinRequest } from "@paperclipai/shared";
import {
  ACTIONABLE_APPROVAL_STATUSES,
  getBlockedIssues,
  getLatestFailedRunsByAgent,
  getRecentTouchedIssues,
  getUnassignedIssues,
  isBlockedIssue,
  isUnassignedIssue,
  normalizeTimestamp,
  type InboxTab,
  saveLastInboxTab,
} from "../lib/inbox";
import { useDismissedInboxItems } from "../hooks/useInboxBadge";

type InboxCategoryFilter =
  | "everything"
  | "approvals_requests"
  | "failures_alerts"
  | "activity_issues"
  | "blocked_issues"
  | "unassigned_issues";
type InboxApprovalFilter = "all" | "actionable" | "resolved";
type SectionKey =
  | "activity_issues"
  | "approvals_requests"
  | "failures_alerts"
  | "blocked_issues"
  | "unassigned_issues";

const RUN_SOURCE_LABELS: Record<string, string> = {
  timer: "Scheduled",
  assignment: "Assignment",
  on_demand: "Manual",
  automation: "Automation",
};
const ACTIONABLE_INBOX_ISSUE_STATUSES = "backlog,todo,in_progress,in_review,blocked";
const PRIORITY_ORDER: Record<Issue["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function firstNonEmptyLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const line = value.split("\n").map((chunk) => chunk.trim()).find(Boolean);
  return line ?? null;
}

function runFailureMessage(run: HeartbeatRun): string {
  return firstNonEmptyLine(run.error) ?? firstNonEmptyLine(run.stderrExcerpt) ?? "Run exited with an error.";
}

function readIssueIdFromRun(run: HeartbeatRun): string | null {
  const context = run.contextSnapshot;
  if (!context) return null;

  const issueId = context["issueId"];
  if (typeof issueId === "string" && issueId.length > 0) return issueId;

  const taskId = context["taskId"];
  if (typeof taskId === "string" && taskId.length > 0) return taskId;

  return null;
}

function compareIssuesByPriorityThenOldest(a: Issue, b: Issue): number {
  const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (priorityDiff !== 0) return priorityDiff;
  return normalizeTimestamp(a.updatedAt) - normalizeTimestamp(b.updatedAt);
}

function compareBlockedIssues(a: Issue, b: Issue): number {
  const awaitingDiff = Number(Boolean(b.isUnreadForMe)) - Number(Boolean(a.isUnreadForMe));
  if (awaitingDiff !== 0) return awaitingDiff;
  return compareIssuesByPriorityThenOldest(a, b);
}

function mergeTouchedIssueContext(issues: Issue[], touchedIssues: Issue[]): Issue[] {
  const touchedById = new Map(touchedIssues.map((issue) => [issue.id, issue]));
  return issues.map((issue) => {
    const touched = touchedById.get(issue.id);
    if (!touched) return issue;
    return {
      ...issue,
      myLastTouchAt: touched.myLastTouchAt ?? issue.myLastTouchAt,
      lastExternalCommentAt: touched.lastExternalCommentAt ?? issue.lastExternalCommentAt,
      isUnreadForMe: touched.isUnreadForMe ?? issue.isUnreadForMe,
    };
  });
}

function issueAssigneeSummary(issue: Issue, agentName: (id: string | null) => string | null): string {
  if (issue.assigneeAgentId) return `Assigned to ${agentName(issue.assigneeAgentId) ?? "agent"}`;
  if (issue.assigneeUserId) return "Assigned to board";
  return "No assignee";
}

function IssueAttentionRow({
  issue,
  issueLinkState,
  agentName,
  markRead,
  isFading,
  isLive,
}: {
  issue: Issue;
  issueLinkState: unknown;
  agentName: (id: string | null) => string | null;
  markRead: (id: string) => void;
  isFading: boolean;
  isLive?: boolean;
}) {
  const awaitingResponse = Boolean(issue.isUnreadForMe) && !isFading;
  const unassigned = isUnassignedIssue(issue);
  const lastCommentSummary = issue.lastExternalCommentAt
    ? `new comment ${timeAgo(issue.lastExternalCommentAt)}`
    : null;

  return (
    <Link
      key={issue.id}
      to={`/issues/${issue.identifier ?? issue.id}`}
      state={issueLinkState}
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-3 px-3 py-3 no-underline text-inherit transition-colors hover:bg-accent/50 sm:px-4",
        awaitingResponse && "bg-accent/20",
      )}
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center pt-0.5">
        {(awaitingResponse || isFading) ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              markRead(issue.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                markRead(issue.id);
              }
            }}
            className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-blue-500/20"
            aria-label="Mark as read"
          >
            <span
              className={cn(
                "block h-2 w-2 rounded-full bg-blue-600 transition-opacity duration-300 dark:bg-blue-400",
                isFading ? "opacity-0" : "opacity-100",
              )}
            />
          </span>
        ) : (
          <span className="inline-flex h-4 w-4" aria-hidden="true" />
        )}
      </span>

      <span className="inline-flex shrink-0 pt-0.5"><PriorityIcon priority={issue.priority} /></span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-xs font-mono text-muted-foreground">
            {issue.identifier ?? issue.id.slice(0, 8)}
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-0.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
              </span>
              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">Live</span>
            </span>
          )}
          <span className="min-w-0 flex-1 text-sm font-medium">
            <span className="line-clamp-2 min-w-0 sm:line-clamp-1 sm:block sm:truncate">
              {issue.title}
            </span>
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {isBlockedIssue(issue) && (
            <Badge variant="destructive" className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]">
              Blocked
            </Badge>
          )}
          {awaitingResponse && (
            <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]">
              Awaiting response
            </Badge>
          )}
          {unassigned && (
            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]">
              Unassigned
            </Badge>
          )}
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {[issueAssigneeSummary(issue, agentName), lastCommentSummary ?? `updated ${timeAgo(issue.updatedAt)}`]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>

      <span className="hidden shrink-0 self-center text-xs text-muted-foreground sm:block">
        updated {timeAgo(issue.updatedAt)}
      </span>
    </Link>
  );
}

function FailedRunCard({
  run,
  issueById,
  agentName: linkedAgentName,
  issueLinkState,
  onDismiss,
}: {
  run: HeartbeatRun;
  issueById: Map<string, Issue>;
  agentName: string | null;
  issueLinkState: unknown;
  onDismiss: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const issueId = readIssueIdFromRun(run);
  const issue = issueId ? issueById.get(issueId) ?? null : null;
  const sourceLabel = RUN_SOURCE_LABELS[run.invocationSource] ?? "Manual";
  const displayError = runFailureMessage(run);

  const retryRun = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      const context = run.contextSnapshot as Record<string, unknown> | null;
      if (context) {
        if (typeof context.issueId === "string" && context.issueId) payload.issueId = context.issueId;
        if (typeof context.taskId === "string" && context.taskId) payload.taskId = context.taskId;
        if (typeof context.taskKey === "string" && context.taskKey) payload.taskKey = context.taskKey;
      }
      const result = await agentsApi.wakeup(run.agentId, {
        source: "on_demand",
        triggerDetail: "manual",
        reason: "retry_failed_run",
        payload,
      });
      if (!("id" in result)) {
        throw new Error("Retry was skipped because the agent is not currently invokable.");
      }
      return result;
    },
    onSuccess: (newRun) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(run.companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(run.companyId, run.agentId) });
      navigate(`/agents/${run.agentId}/runs/${newRun.id}`);
    },
  });

  return (
    <div className="group relative overflow-hidden rounded-xl border border-red-500/30 bg-gradient-to-br from-red-500/10 via-card to-card p-4">
      <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-red-500/10 blur-2xl" />
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-2 top-2 z-10 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="relative space-y-3">
        {issue ? (
          <Link
            to={`/issues/${issue.identifier ?? issue.id}`}
            state={issueLinkState}
            className="block truncate text-sm font-medium transition-colors hover:text-foreground no-underline text-inherit"
          >
            <span className="font-mono text-muted-foreground mr-1.5">
              {issue.identifier ?? issue.id.slice(0, 8)}
            </span>
            {issue.title}
          </Link>
        ) : (
          <span className="block text-sm text-muted-foreground">
            {run.errorCode ? `Error code: ${run.errorCode}` : "No linked issue"}
          </span>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-red-500/20 p-1.5">
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              </span>
              {linkedAgentName ? (
                <Identity name={linkedAgentName} size="sm" />
              ) : (
                <span className="text-sm font-medium">Agent {run.agentId.slice(0, 8)}</span>
              )}
              <StatusBadge status={run.status} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {sourceLabel} run failed {timeAgo(run.createdAt)}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5"
              onClick={() => retryRun.mutate()}
              disabled={retryRun.isPending}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {retryRun.isPending ? "Retrying…" : "Retry"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5"
              asChild
            >
              <Link to={`/agents/${run.agentId}/runs/${run.id}`}>
                Open run
                <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm">
          {displayError}
        </div>

        <div className="text-xs">
          <span className="font-mono text-muted-foreground">run {run.id.slice(0, 8)}</span>
        </div>

        {retryRun.isError && (
          <div className="text-xs text-destructive">
            {retryRun.error instanceof Error ? retryRun.error.message : "Failed to retry run"}
          </div>
        )}
      </div>
    </div>
  );
}

export function Inbox() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [allCategoryFilter, setAllCategoryFilter] = useState<InboxCategoryFilter>("everything");
  const [allApprovalFilter, setAllApprovalFilter] = useState<InboxApprovalFilter>("all");
  const { dismissed, dismiss } = useDismissedInboxItems();

  const pathSegment = location.pathname.split("/").pop() ?? "needs-action";
  const tab: InboxTab =
    pathSegment === "all" || pathSegment === "unread" ? pathSegment : "needs-action";
  const issueLinkState = useMemo(
    () =>
      createIssueDetailLocationState(
        "Inbox",
        `${location.pathname}${location.search}${location.hash}`,
      ),
    [location.pathname, location.search, location.hash],
  );

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Inbox" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    saveLastInboxTab(tab);
  }, [tab]);

  const {
    data: approvals,
    isLoading: isApprovalsLoading,
    error: approvalsError,
  } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const {
    data: joinRequests = [],
    isLoading: isJoinRequestsLoading,
  } = useQuery({
    queryKey: queryKeys.access.joinRequests(selectedCompanyId!),
    queryFn: async () => {
      try {
        return await accessApi.listJoinRequests(selectedCompanyId!, "pending_approval");
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          return [];
        }
        throw err;
      }
    },
    enabled: !!selectedCompanyId,
    retry: false,
  });

  const { data: dashboard, isLoading: isDashboardLoading } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues, isLoading: isIssuesLoading } = useQuery({
    queryKey: queryKeys.issues.listInboxActionable(selectedCompanyId!),
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        status: ACTIONABLE_INBOX_ISSUE_STATUSES,
      }),
    enabled: !!selectedCompanyId,
  });
  const {
    data: touchedIssuesRaw = [],
    isLoading: isTouchedIssuesLoading,
  } = useQuery({
    queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId!),
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        touchedByUserId: "me",
        status: "backlog,todo,in_progress,in_review,blocked,done",
      }),
    enabled: !!selectedCompanyId,
  });

  const { data: heartbeatRuns, isLoading: isRunsLoading } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const touchedIssues = useMemo(() => getRecentTouchedIssues(touchedIssuesRaw), [touchedIssuesRaw]);
  const unreadTouchedIssues = useMemo(
    () => touchedIssues.filter((issue) => issue.isUnreadForMe),
    [touchedIssues],
  );
  const actionableIssues = useMemo(
    () => mergeTouchedIssueContext(issues ?? [], touchedIssuesRaw),
    [issues, touchedIssuesRaw],
  );
  const blockedIssues = useMemo(
    () => getBlockedIssues(actionableIssues).sort(compareBlockedIssues),
    [actionableIssues],
  );
  const unassignedIssues = useMemo(
    () =>
      getUnassignedIssues(actionableIssues)
        .filter((issue) => !isBlockedIssue(issue))
        .sort(compareIssuesByPriorityThenOldest),
    [actionableIssues],
  );

  const agentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of actionableIssues) map.set(issue.id, issue);
    return map;
  }, [actionableIssues]);

  const failedRuns = useMemo(
    () => getLatestFailedRunsByAgent(heartbeatRuns ?? []).filter((r) => !dismissed.has(`run:${r.id}`)),
    [heartbeatRuns, dismissed],
  );

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of heartbeatRuns ?? []) {
      if (run.status !== "running" && run.status !== "queued") continue;
      const issueId = readIssueIdFromRun(run);
      if (issueId) ids.add(issueId);
    }
    return ids;
  }, [heartbeatRuns]);

  const allApprovals = useMemo(
    () =>
      [...(approvals ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [approvals],
  );

  const actionableApprovals = useMemo(
    () => allApprovals.filter((approval) => ACTIONABLE_APPROVAL_STATUSES.has(approval.status)),
    [allApprovals],
  );

  const filteredAllApprovals = useMemo(() => {
    if (allApprovalFilter === "all") return allApprovals;

    return allApprovals.filter((approval) => {
      const isActionable = ACTIONABLE_APPROVAL_STATUSES.has(approval.status);
      return allApprovalFilter === "actionable" ? isActionable : !isActionable;
    });
  }, [allApprovals, allApprovalFilter]);

  const agentName = (id: string | null) => {
    if (!id) return null;
    return agentById.get(id) ?? null;
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const approveJoinMutation = useMutation({
    mutationFn: (joinRequest: JoinRequest) =>
      accessApi.approveJoinRequest(selectedCompanyId!, joinRequest.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.access.joinRequests(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve join request");
    },
  });

  const rejectJoinMutation = useMutation({
    mutationFn: (joinRequest: JoinRequest) =>
      accessApi.rejectJoinRequest(selectedCompanyId!, joinRequest.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.access.joinRequests(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject join request");
    },
  });

  const [fadingOutIssues, setFadingOutIssues] = useState<Set<string>>(new Set());

  const invalidateInboxIssueQueries = () => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId) });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: string) => issuesApi.markRead(id),
    onMutate: (id) => {
      setFadingOutIssues((prev) => new Set(prev).add(id));
    },
    onSuccess: () => {
      invalidateInboxIssueQueries();
    },
    onSettled: (_data, _error, id) => {
      setTimeout(() => {
        setFadingOutIssues((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 300);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async (issueIds: string[]) => {
      await Promise.all(issueIds.map((issueId) => issuesApi.markRead(issueId)));
    },
    onMutate: (issueIds) => {
      setFadingOutIssues((prev) => {
        const next = new Set(prev);
        for (const issueId of issueIds) next.add(issueId);
        return next;
      });
    },
    onSuccess: () => {
      invalidateInboxIssueQueries();
    },
    onSettled: (_data, _error, issueIds) => {
      setTimeout(() => {
        setFadingOutIssues((prev) => {
          const next = new Set(prev);
          for (const issueId of issueIds) next.delete(issueId);
          return next;
        });
      }, 300);
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={InboxIcon} message="Select a company to view inbox." />;
  }

  const hasRunFailures = failedRuns.length > 0;
  const showAggregateAgentError = !!dashboard && dashboard.agents.error > 0 && !hasRunFailures && !dismissed.has("alert:agent-errors");
  const showBudgetAlert =
    !!dashboard &&
    dashboard.costs.monthBudgetCents > 0 &&
    dashboard.costs.monthUtilizationPercent >= 80 &&
    !dismissed.has("alert:budget");
  const hasAlerts = showAggregateAgentError || showBudgetAlert;
  const hasBlockedIssues = blockedIssues.length > 0;
  const hasUnassignedIssues = unassignedIssues.length > 0;
  const hasJoinRequests = joinRequests.length > 0;
  const showApprovalsRequestsCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "approvals_requests";
  const showFailuresAlertsCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "failures_alerts";
  const showActivityCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "activity_issues";
  const showBlockedCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "blocked_issues";
  const showUnassignedCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "unassigned_issues";

  const approvalsToRender = tab === "all" ? filteredAllApprovals : actionableApprovals;
  const showApprovalsRequestsSection = tab === "needs-action"
    ? actionableApprovals.length > 0 || hasJoinRequests
    : tab === "unread"
      ? actionableApprovals.length > 0 || hasJoinRequests
      : showApprovalsRequestsCategory && (filteredAllApprovals.length > 0 || hasJoinRequests);
  const showFailuresAlertsSection = tab === "needs-action"
    ? hasRunFailures || hasAlerts
    : tab === "unread"
      ? hasRunFailures || hasAlerts
      : showFailuresAlertsCategory && (hasRunFailures || hasAlerts);
  const showBlockedSection = tab === "needs-action"
    ? hasBlockedIssues
    : tab === "all"
      ? showBlockedCategory && hasBlockedIssues
      : false;
  const showUnassignedSection = tab === "needs-action"
    ? hasUnassignedIssues
    : tab === "all"
      ? showUnassignedCategory && hasUnassignedIssues
      : false;
  const showActivitySection = tab === "all"
    ? showActivityCategory && touchedIssues.length > 0
    : tab === "unread"
      ? unreadTouchedIssues.length > 0
      : false;
  const activityIssues = tab === "all" ? touchedIssues : unreadTouchedIssues;

  const visibleSections = [
    showApprovalsRequestsSection ? "approvals_requests" : null,
    showFailuresAlertsSection ? "failures_alerts" : null,
    showBlockedSection ? "blocked_issues" : null,
    showUnassignedSection ? "unassigned_issues" : null,
    showActivitySection ? "activity_issues" : null,
  ].filter((key): key is SectionKey => key !== null);

  const allLoaded =
    !isJoinRequestsLoading &&
    !isApprovalsLoading &&
    !isDashboardLoading &&
    !isIssuesLoading &&
    !isTouchedIssuesLoading &&
    !isRunsLoading;

  const showSeparatorBefore = (key: SectionKey) => visibleSections.indexOf(key) > 0;
  const unreadIssueIds = unreadTouchedIssues
    .filter((issue) => !fadingOutIssues.has(issue.id))
    .map((issue) => issue.id);
  const canMarkAllRead = tab === "unread" && unreadIssueIds.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(value) => navigate(`/inbox/${value}`)}>
          <PageTabBar
            items={[
              {
                value: "needs-action",
                label: "Needs Action",
              },
              { value: "unread", label: "Unread" },
              { value: "all", label: "All" },
            ]}
          />
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          {canMarkAllRead && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => markAllReadMutation.mutate(unreadIssueIds)}
              disabled={markAllReadMutation.isPending}
            >
              {markAllReadMutation.isPending ? "Marking…" : "Mark all as read"}
            </Button>
          )}

          {tab === "all" && (
            <>
            <Select
              value={allCategoryFilter}
              onValueChange={(value) => setAllCategoryFilter(value as InboxCategoryFilter)}
            >
              <SelectTrigger className="h-8 w-[170px] text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="everything">All categories</SelectItem>
                <SelectItem value="approvals_requests">Approvals &amp; requests</SelectItem>
                <SelectItem value="failures_alerts">Failures &amp; alerts</SelectItem>
                <SelectItem value="activity_issues">Issue activity</SelectItem>
                <SelectItem value="blocked_issues">Blocked issues</SelectItem>
                <SelectItem value="unassigned_issues">Unassigned issues</SelectItem>
              </SelectContent>
            </Select>

            {showApprovalsRequestsCategory && (
              <Select
                value={allApprovalFilter}
                onValueChange={(value) => setAllApprovalFilter(value as InboxApprovalFilter)}
              >
                <SelectTrigger className="h-8 w-[170px] text-xs">
                  <SelectValue placeholder="Approval status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All approval statuses</SelectItem>
                  <SelectItem value="actionable">Needs action</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            )}
            </>
          )}
        </div>
      </div>

      {approvalsError && <p className="text-sm text-destructive">{approvalsError.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {!allLoaded && visibleSections.length === 0 && (
        <PageSkeleton variant="inbox" />
      )}

      {allLoaded && visibleSections.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          message={
            tab === "unread"
              ? "No new inbox items."
              : tab === "needs-action"
                ? "No items need action."
                : "No inbox items match these filters."
          }
        />
      )}

      {showApprovalsRequestsSection && (
        <>
          {showSeparatorBefore("approvals_requests") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Approvals &amp; Requests
            </h3>
            <div className="grid gap-3">
              {approvalsToRender.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  requesterAgent={
                    approval.requestedByAgentId
                      ? (agents ?? []).find((a) => a.id === approval.requestedByAgentId) ?? null
                      : null
                  }
                  onApprove={() => approveMutation.mutate(approval.id)}
                  onReject={() => rejectMutation.mutate(approval.id)}
                  detailLink={`/approvals/${approval.id}`}
                  isPending={approveMutation.isPending || rejectMutation.isPending}
                />
              ))}
              {joinRequests.map((joinRequest) => (
                <div key={joinRequest.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {joinRequest.requestType === "human"
                          ? "Human join request"
                          : `Agent join request${joinRequest.agentName ? `: ${joinRequest.agentName}` : ""}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        requested {timeAgo(joinRequest.createdAt)} from IP {joinRequest.requestIp}
                      </p>
                      {joinRequest.requestEmailSnapshot && (
                        <p className="text-xs text-muted-foreground">
                          email: {joinRequest.requestEmailSnapshot}
                        </p>
                      )}
                      {joinRequest.adapterType && (
                        <p className="text-xs text-muted-foreground">adapter: {joinRequest.adapterType}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={approveJoinMutation.isPending || rejectJoinMutation.isPending}
                        onClick={() => rejectJoinMutation.mutate(joinRequest)}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={approveJoinMutation.isPending || rejectJoinMutation.isPending}
                        onClick={() => approveJoinMutation.mutate(joinRequest)}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {showFailuresAlertsSection && (
        <>
          {showSeparatorBefore("failures_alerts") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Failures &amp; Alerts
            </h3>
            <div className="grid gap-3">
              {failedRuns.map((run) => (
                <FailedRunCard
                  key={run.id}
                  run={run}
                  issueById={issueById}
                  agentName={agentName(run.agentId)}
                  issueLinkState={issueLinkState}
                  onDismiss={() => dismiss(`run:${run.id}`)}
                />
              ))}
            </div>

            {hasAlerts && (
              <div className="mt-3 divide-y divide-border border border-border">
                {showAggregateAgentError && (
                  <div className="group/alert relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
                    <Link
                      to="/agents"
                      className="flex flex-1 cursor-pointer items-center gap-3 no-underline text-inherit"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      <span className="text-sm">
                        <span className="font-medium">{dashboard!.agents.error}</span>{" "}
                        {dashboard!.agents.error === 1 ? "agent has" : "agents have"} errors
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => dismiss("alert:agent-errors")}
                      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/alert:opacity-100"
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {showBudgetAlert && (
                  <div className="group/alert relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
                    <Link
                      to="/costs"
                      className="flex flex-1 cursor-pointer items-center gap-3 no-underline text-inherit"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
                      <span className="text-sm">
                        Budget at{" "}
                        <span className="font-medium">{dashboard!.costs.monthUtilizationPercent}%</span>{" "}
                        utilization this month
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => dismiss("alert:budget")}
                      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/alert:opacity-100"
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {showBlockedSection && (
        <>
          {showSeparatorBefore("blocked_issues") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Blocked Issues
            </h3>
            <div className="divide-y divide-border border border-border">
              {blockedIssues.map((issue) => (
                <IssueAttentionRow
                  key={issue.id}
                  issue={issue}
                  issueLinkState={issueLinkState}
                  agentName={agentName}
                  markRead={(id) => markReadMutation.mutate(id)}
                  isFading={fadingOutIssues.has(issue.id)}
                  isLive={liveIssueIds.has(issue.id)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {showUnassignedSection && (
        <>
          {showSeparatorBefore("unassigned_issues") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Unassigned Issues
            </h3>
            <div className="divide-y divide-border border border-border">
              {unassignedIssues.map((issue) => (
                <IssueAttentionRow
                  key={issue.id}
                  issue={issue}
                  issueLinkState={issueLinkState}
                  agentName={agentName}
                  markRead={(id) => markReadMutation.mutate(id)}
                  isFading={fadingOutIssues.has(issue.id)}
                  isLive={liveIssueIds.has(issue.id)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {showActivitySection && (
        <>
          {showSeparatorBefore("activity_issues") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {tab === "all" ? "Issue Activity" : "Unread Activity"}
            </h3>
            <div className="divide-y divide-border border border-border">
              {activityIssues.map((issue) => {
                const isUnread = issue.isUnreadForMe && !fadingOutIssues.has(issue.id);
                const isFading = fadingOutIssues.has(issue.id);
                return (
                  <Link
                    key={issue.id}
                    to={`/issues/${issue.identifier ?? issue.id}`}
                    state={issueLinkState}
                    className="flex min-w-0 cursor-pointer items-start gap-2 px-3 py-3 no-underline text-inherit transition-colors hover:bg-accent/50 sm:items-center sm:gap-3 sm:px-4"
                  >
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center self-center">
                      {(isUnread || isFading) ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            markReadMutation.mutate(issue.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              markReadMutation.mutate(issue.id);
                            }
                          }}
                          className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-blue-500/20"
                          aria-label="Mark as read"
                        >
                          <span
                            className={`block h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400 transition-opacity duration-300 ${
                              isFading ? "opacity-0" : "opacity-100"
                            }`}
                          />
                        </span>
                      ) : (
                        <span className="inline-flex h-4 w-4" aria-hidden="true" />
                      )}
                    </span>

                    <span className="inline-flex shrink-0 self-center"><PriorityIcon priority={issue.priority} /></span>
                    <span className="inline-flex shrink-0 self-center"><StatusIcon status={issue.status} /></span>
                    <span className="shrink-0 self-center text-xs font-mono text-muted-foreground">
                      {issue.identifier ?? issue.id.slice(0, 8)}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="line-clamp-2 min-w-0 sm:line-clamp-1 sm:block sm:truncate">
                        {issue.title}
                      </span>
                    </span>
                    <span className="hidden shrink-0 self-center text-xs text-muted-foreground sm:block">
                      {issue.lastExternalCommentAt
                        ? `commented ${timeAgo(issue.lastExternalCommentAt)}`
                        : `updated ${timeAgo(issue.updatedAt)}`}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
