"use client";

import { useState, useEffect } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronRight, UserPlus, Users, LayoutDashboard, SlidersHorizontal, Settings2,
  Plus, Upload, Pause, Play, XCircle, Building2, Calendar, History,
} from "lucide-react";
import { CandidatesTab } from "@/components/jobs/CandidatesTab";
import { DashboardTab } from "@/components/jobs/DashboardTab";
import { ScoringRulesTab } from "@/components/jobs/ScoringRulesTab";
import { JdDescriptionTab } from "@/components/jobs/JdDescriptionTab";
import { HistoryTab } from "@/components/jobs/HistoryTab";
import { BulkAddModal } from "@/components/jobs/BulkAddModal";
import { AddManuallyModal } from "@/components/jobs/AddManuallyModal";

interface RunSummary {
  id: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
}

interface TaskResult {
  id: string;
  url: string;
  status: string;
  result: any;
  analysisResult: any;
  errorMessage: string | null;
  retryCount: number;
  runId?: string;
  runIndex?: number;
  addedAt?: string;
}

interface RequisitionDetail {
  id: string;
  title: string;
  department: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  config: any;
  runs: RunSummary[];
}

interface CombinedView {
  id: string;
  title: string;
  department: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
  config: any;
  tasks: TaskResult[];
  runs: RunSummary[];
  activeRun: RunSummary | null;
}

const ACTIVE_RUN_STATUSES = new Set(["PENDING", "PROCESSING", "PAUSED"]);

function formatCreated(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function combine(
  requisition: RequisitionDetail,
  tasks: TaskResult[]
): CombinedView {
  const successCount = tasks.filter(t => t.status === "DONE").length;
  const failedCount = tasks.filter(t => t.status === "FAILED").length;
  const activeRun = requisition.runs.find(r => ACTIVE_RUN_STATUSES.has(r.status)) || null;

  return {
    id: requisition.id,
    title: requisition.title,
    department: requisition.department,
    status: activeRun?.status || (requisition.runs[0]?.status ?? "IDLE"),
    totalTasks: tasks.length,
    processedCount: successCount + failedCount,
    successCount,
    failedCount,
    createdAt: requisition.createdAt,
    config: requisition.config,
    tasks,
    runs: requisition.runs,
    activeRun,
  };
}

const VALID_TABS = new Set(["candidates", "history", "dashboard", "rules", "jd"]);

export default function RequisitionDetailPage() {
  const { jobId: requisitionId } = useParams<{ jobId: string }>();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam && VALID_TABS.has(tabParam) ? tabParam : "candidates";
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [data, setData] = useState<CombinedView | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);

  useEffect(() => {
    if (tabParam && VALID_TABS.has(tabParam)) {
      setActiveTab(tabParam);
      router.replace(pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  async function fetchAll() {
    try {
      const [reqRes, candRes] = await Promise.all([
        fetch(`/api/requisitions/${requisitionId}`),
        fetch(`/api/requisitions/${requisitionId}/candidates`),
      ]);
      if (!reqRes.ok) {
        setData(null);
        return;
      }
      const requisition: RequisitionDetail = await reqRes.json();
      const candPayload = candRes.ok ? await candRes.json() : { tasks: [] };
      setData(combine(requisition, candPayload.tasks || []));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisitionId]);

  useEffect(() => {
    if (!data?.activeRun) return;
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.activeRun?.id, data?.activeRun?.status, requisitionId]);

  async function handleRunActionById(runId: string, action: "pause" | "resume" | "cancel") {
    setActionLoading(true);
    try {
      await fetch(`/api/jobs/${runId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchAll();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRunAction(action: "pause" | "resume" | "cancel") {
    if (!data?.activeRun) return;
    await handleRunActionById(data.activeRun.id, action);
  }

  if (loading) {
    return (
      <div className="p-8 space-y-4 animate-pulse">
        <div className="h-4 bg-muted rounded w-48" />
        <div className="h-8 bg-card rounded w-1/3" />
        <div className="h-4 bg-card rounded w-1/2" />
        <div className="h-64 bg-card rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <Link href="/" className="text-primary text-sm hover:underline">← Back to roles</Link>
        <p className="text-muted-foreground mt-4">Role not found.</p>
      </div>
    );
  }

  const jdCode = `JD-${data.id.slice(0, 8).toUpperCase()}`;
  const activeRun = data.activeRun;
  const activeRunPct = activeRun && activeRun.totalTasks > 0
    ? Math.round((activeRun.processedCount / activeRun.totalTasks) * 100)
    : 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Hero Header */}
      <div className="border-b border-border px-8 pt-5 pb-4 shrink-0 bg-background space-y-3">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">Roles</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="font-mono text-foreground">{jdCode}</span>
        </div>

        {/* Title row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground leading-tight">{data.title}</h1>
              {activeRun && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 gap-1.5"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Run {activeRun.status === "PROCESSING" ? "Running" : activeRun.status} · {activeRunPct}%
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
              {data.department && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  {data.department}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Created {formatCreated(data.createdAt)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {data.runs.length} run{data.runs.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Run control buttons — shown whenever there is an active run */}
            {activeRun && (
              <>
                {activeRun.status === "PAUSED" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRunAction("resume")}
                    disabled={actionLoading}
                    className="gap-1.5"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRunAction("pause")}
                    disabled={actionLoading}
                    className="gap-1.5"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRunAction("cancel")}
                  disabled={actionLoading}
                  className="gap-1.5 text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              </>
            )}

            {/* Add Candidates */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  Add Candidates
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setShowManualAdd(true)} className="gap-2 cursor-pointer">
                  <Plus className="h-4 w-4" />
                  Add Manually
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowBulkAdd(true)} className="gap-2 cursor-pointer">
                  <Upload className="h-4 w-4" />
                  Bulk Add
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border px-8 shrink-0 bg-background">
          <TabsList className="bg-transparent h-auto p-0 gap-0">
            <TabsTrigger
              value="candidates"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground px-4 py-3 text-sm font-medium text-muted-foreground gap-2 h-11"
            >
              <Users className="h-4 w-4" />
              Candidates
              <Badge variant="secondary" className="ml-1 text-xs">{data.successCount}</Badge>
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground px-4 py-3 text-sm font-medium text-muted-foreground gap-2 h-11"
            >
              <History className="h-4 w-4" />
              History
              <Badge variant="secondary" className="ml-1 text-xs">{data.runs.length}</Badge>
            </TabsTrigger>
            <TabsTrigger
              value="dashboard"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground px-4 py-3 text-sm font-medium text-muted-foreground gap-2 h-11"
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value="rules"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground px-4 py-3 text-sm font-medium text-muted-foreground gap-2 h-11"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Scoring Rules
            </TabsTrigger>
            <TabsTrigger
              value="jd"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground px-4 py-3 text-sm font-medium text-muted-foreground gap-2 h-11"
            >
              <Settings2 className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="candidates" className="flex-1 overflow-y-auto m-0 p-8">
          <CandidatesTab data={data} requisitionId={requisitionId} onRefresh={fetchAll} />
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-y-auto m-0 p-8">
          <HistoryTab
            runs={data.runs}
            onRunAction={handleRunActionById}
            actionLoading={actionLoading}
          />
        </TabsContent>

        <TabsContent value="dashboard" className="flex-1 overflow-y-auto m-0 p-8">
          <DashboardTab data={data} />
        </TabsContent>

        <TabsContent value="rules" forceMount className="flex-1 overflow-y-auto m-0 p-8 data-[state=inactive]:hidden">
          <ScoringRulesTab requisitionId={requisitionId} initialConfig={data.config} onSaved={fetchAll} />
        </TabsContent>

        <TabsContent value="jd" forceMount className="flex-1 overflow-y-auto m-0 p-8 data-[state=inactive]:hidden">
          <JdDescriptionTab
            requisitionId={requisitionId}
            initialConfig={data.config}
            initialTitle={data.title}
            onSaved={fetchAll}
          />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <BulkAddModal
        open={showBulkAdd}
        onClose={() => setShowBulkAdd(false)}
        requisitionId={requisitionId}
        onSuccess={fetchAll}
      />
      <AddManuallyModal
        open={showManualAdd}
        onClose={() => setShowManualAdd(false)}
        requisitionId={requisitionId}
        onSuccess={fetchAll}
      />
    </div>
  );
}
