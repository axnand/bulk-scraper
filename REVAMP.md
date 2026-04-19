# Bulk Scraper — Revamp Execution Plan

**Read this entire file before writing a single line of code.**
This is a self-contained build spec. Every file to create, every file to modify, every command to run is listed here in order. Do not deviate unless you hit a technical blocker, in which case solve it minimally and continue.

---

## What This App Is

A Next.js 16 (App Router) recruitment tool. Recruiters paste LinkedIn URLs → the app scrapes profiles via Unipile API → AI scores each candidate against a Job Description → results export to Google Sheets or XLSX.

Current state: functional but ugly. One home page with a textarea + job history list. One job results page. One settings page. All dark-themed, Tailwind v4.

**Goal of this revamp:** Migrate ALL existing functionality into a new professional UI structure. No features removed. No backend logic changed. The processing engine, scoring system, AI adapter, export system — all untouched. This is purely a UI restructure + two small schema additions + two new API routes.

**Out of scope for this revamp:** resume upload, PDF parsing, ZIP upload, `hiringStage`, `location` fields on jobs. Those are future iterations.

---

## Tech Stack (existing)

- Next.js 16.2.1, App Router, React 19, TypeScript 5
- Tailwind CSS v4 (CSS-first config — `@import "tailwindcss"` in globals.css, NO tailwind.config.js)
- Prisma 5.22.0, PostgreSQL (Neon)
- shadcn 4.3.0 is in devDependencies but **not yet initialized** (no components.json, no components/ui/, no lib/utils.ts)
- Dark theme throughout (`bg-neutral-950`)

---

## Existing File Map (what matters)

```
app/
  layout.tsx                    ← root layout, currently has max-w-4xl wrapper to REMOVE
  page.tsx                      ← home page (URL textarea + job history list) — REPLACE
  jobs/[jobId]/page.tsx         ← job results page — REPLACE
  settings/page.tsx             ← settings page — MOVE into sidebar layout
  api/
    jobs/route.ts               ← GET list + POST create — MODIFY
    jobs/[jobId]/route.ts       ← GET single job status — MODIFY (add PUT)
    jobs/[jobId]/results/route.ts ← GET full results — MODIFY
    jobs/[jobId]/cancel/route.ts  ← pause/resume/cancel — UNTOUCHED
    jobs/[jobId]/export/route.ts  ← sheet + xlsx export — UNTOUCHED
    process-tasks/route.ts      ← processing engine — UNTOUCHED
    cron/process-tasks/route.ts ← safety net cron — UNTOUCHED
    accounts/route.ts           ← UNTOUCHED
    accounts/[id]/route.ts      ← UNTOUCHED
    accounts/test/route.ts      ← UNTOUCHED
    ai-providers/route.ts       ← UNTOUCHED
    ai-providers/test/route.ts  ← UNTOUCHED
    jd-templates/route.ts       ← UNTOUCHED
    jd-templates/[id]/route.ts  ← UNTOUCHED
    evaluation-configs/route.ts ← UNTOUCHED
    evaluation-configs/[id]/route.ts ← UNTOUCHED
    prompt-templates/route.ts   ← UNTOUCHED
    prompt-templates/[id]/route.ts ← UNTOUCHED
    settings/route.ts           ← UNTOUCHED
    settings/default-prompt/route.ts ← UNTOUCHED
    preview-prompt/route.ts     ← UNTOUCHED
    sheet-integrations/route.ts ← UNTOUCHED
    sheet-integrations/[id]/route.ts ← UNTOUCHED
    proxy-image/route.ts        ← UNTOUCHED
    extension/config/route.ts   ← UNTOUCHED
lib/
  prisma.ts       ← UNTOUCHED
  config.ts       ← UNTOUCHED
  analyzer.ts     ← UNTOUCHED
  ai-adapter.ts   ← UNTOUCHED
  sheets.ts       ← UNTOUCHED
  trigger.ts      ← UNTOUCHED
  model-pricing.ts ← UNTOUCHED
  validators.ts   ← UNTOUCHED
  services/
    account.service.ts  ← UNTOUCHED
    unipile.service.ts  ← UNTOUCHED
prisma/
  schema.prisma   ← MODIFY (add 2 fields to Job)
```

---

## Step 1 — Prisma Schema Changes

Open `prisma/schema.prisma`. Find the `Job` model. Add two fields:

```prisma
model Job {
  id             String   @id @default(cuid())
  status         String   @default("PENDING")
  totalTasks     Int
  processedCount Int      @default(0)
  successCount   Int      @default(0)
  failedCount    Int      @default(0)
  config         String?  @db.Text
  createdAt      DateTime @default(now())
  tasks          Task[]

  // ADD THESE TWO:
  title          String   @default("Untitled Requisition")
  department     String   @default("")
}
```

Do not touch any other model. Run:

```bash
npx prisma migrate dev --name "add_job_title_department"
```

Then run:

```bash
npx prisma generate
```

---

## Step 2 — shadcn Init

Run these commands in order:

```bash
npx shadcn@latest init
```

When prompted:
- Style: **Default**
- Base color: **Slate**  
- CSS variables: **Yes**

Then install components:

```bash
npx shadcn@latest add button card badge input textarea dialog tabs dropdown-menu separator scroll-area tooltip select switch label
```

After this you will have:
- `components/ui/` directory with all component files
- `lib/utils.ts` with the `cn()` helper
- `components.json` config file
- Updated `app/globals.css` with CSS variable definitions

**Critical step after shadcn init:** Open `app/globals.css`. Find the `.dark` block (or `:root` block). Ensure the background variable matches the existing dark theme. Add/update:

```css
.dark {
  --background: 0 0% 4%;        /* matches #0a0a0a (neutral-950) */
  --foreground: 0 0% 95%;
  --card: 0 0% 6%;
  --card-foreground: 0 0% 95%;
  --border: 0 0% 14%;
  --input: 0 0% 10%;
  --primary: 239 84% 67%;       /* indigo-500 */
  --primary-foreground: 0 0% 100%;
  --muted: 0 0% 10%;
  --muted-foreground: 0 0% 45%;
  --accent: 0 0% 10%;
  --accent-foreground: 0 0% 95%;
  --ring: 239 84% 67%;
}
```

---

## Step 3 — Root Layout Overhaul

Replace `app/layout.tsx` entirely:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bulk Scraper",
  description: "Recruitment intelligence platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        {children}
      </body>
    </html>
  );
}
```

Key changes: removed `max-w-4xl mx-auto p-8` wrapper, added `class="dark"` to `<html>`, swapped `bg-neutral-950 text-neutral-50` for CSS variable equivalents.

---

## Step 4 — Create Sidebar Components

Create `components/layout/Sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Jobs", icon: Briefcase },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 border-r border-border bg-card flex flex-col z-30">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground text-xs font-bold">BS</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Bulk Scraper</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recruitment Engine</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

Create `components/layout/AppShell.tsx`:

```tsx
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-56 min-h-screen overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
```

---

## Step 5 — Route Group Setup

Create `app/(app)/layout.tsx`:

```tsx
import { AppShell } from "@/components/layout/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

Now move pages into the route group by creating new files (the old files will be replaced in later steps):
- New home: `app/(app)/page.tsx`
- New job detail: `app/(app)/jobs/[jobId]/page.tsx`
- New settings: `app/(app)/settings/page.tsx`

The old `app/page.tsx`, `app/jobs/[jobId]/page.tsx`, `app/settings/page.tsx` must be **deleted** once the new ones are created so Next.js doesn't have a routing conflict. Delete them only after the new files are working.

---

## Step 6 — Update API Routes

### 6a. Update `app/api/jobs/route.ts`

**GET handler changes:** Add `title` and `department` to the select and return:

Find the `prisma.job.findMany` call. Add `title: true, department: true` to the `select` (or just remove the select to return all fields). Ensure the response includes these two fields per job.

**POST handler changes:**

Current POST reads `urls`, `jobDescription`, `aiModel`, etc. from the body and requires `urls` to be present. Make the following changes:

1. Read `title` and `department` from body (with defaults)
2. Make `urls` **optional** — if absent or empty string, `validUrls` is an empty array and `totalTasks` is 0
3. Pass `title` and `department` to `prisma.job.create`
4. Copy `title` into `config.jdTitle` so the Chrome extension still works

The relevant section of the POST handler should look like:

```typescript
const {
  urls = "",
  title = "Untitled Requisition",
  department = "",
  jobDescription,
  jdTitle,
  // ... rest of existing destructuring unchanged
} = await req.json();

// Use title as canonical name; fall back to jdTitle for backwards compat
const jobTitle = title || jdTitle || "Untitled Requisition";

// Make URL parsing optional
const { valid: validUrls, invalid: invalidUrls } = urls?.trim()
  ? parseAndValidateUrls(urls)
  : { valid: [], invalid: [] };

// In prisma.job.create, add:
// title: jobTitle,
// department: department || "",
// And in config JSON, set jdTitle: jobTitle (keep existing behaviour)
```

The `after()` trigger should only fire if `validUrls.length > 0`.

### 6b. Update `app/api/jobs/[jobId]/route.ts`

This file currently has a `GET` handler. Add a `PUT` handler to the same file:

```typescript
export async function PUT(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const { jobId } = params;
    const body = await req.json();

    // Top-level job fields
    const jobUpdate: any = {};
    if (body.title !== undefined) jobUpdate.title = body.title;
    if (body.department !== undefined) jobUpdate.department = body.department;

    // Config fields — merge into existing config JSON
    const configFields = [
      "jobDescription", "scoringRules", "customScoringRules",
      "aiModel", "aiProviderId", "sheetWebAppUrl", "minScoreThreshold",
      "promptRole", "promptGuidelines", "criticalInstructions",
      "builtInRuleDescriptions", "jdTitle",
    ];

    const hasConfigUpdate = configFields.some(f => body[f] !== undefined);

    if (hasConfigUpdate) {
      const existing = await prisma.job.findUnique({
        where: { id: jobId },
        select: { config: true },
      });
      const existingConfig = existing?.config ? JSON.parse(existing.config) : {};
      const newConfig = { ...existingConfig };
      configFields.forEach(f => {
        if (body[f] !== undefined) newConfig[f] = body[f];
      });
      // Keep jdTitle in sync with title
      if (body.title) newConfig.jdTitle = body.title;
      jobUpdate.config = JSON.stringify(newConfig);
    }

    const updated = await prisma.job.update({
      where: { id: jobId },
      data: jobUpdate,
    });

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}
```

### 6c. Update `app/api/jobs/[jobId]/results/route.ts`

In the `GET` handler, add `title` and `department` to the job select query and include them in the response object.

### 6d. Create `app/api/jobs/[jobId]/add-candidates/route.ts`

This is a new file. It adds LinkedIn URLs to an existing job and triggers processing.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAndValidateUrls } from "@/lib/validators";
import { triggerProcessing } from "@/lib/trigger";

export async function POST(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const { jobId } = params;
    const { urls } = await req.json();

    if (!urls?.trim()) {
      return NextResponse.json({ error: "No URLs provided" }, { status: 400 });
    }

    // Verify job exists and get its config
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, config: true, totalTasks: true },
    });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const { valid: validUrls, invalid: invalidUrls } = parseAndValidateUrls(urls);
    if (validUrls.length === 0) {
      return NextResponse.json({ error: "No valid LinkedIn URLs found", invalidUrls }, { status: 400 });
    }

    // Batch insert tasks
    const BATCH_SIZE = 100;
    for (let i = 0; i < validUrls.length; i += BATCH_SIZE) {
      await prisma.task.createMany({
        data: validUrls.slice(i, i + BATCH_SIZE).map(url => ({
          jobId,
          url,
          status: "PENDING",
        })),
        skipDuplicates: true,
      });
    }

    // Update job totalTasks and set to PROCESSING
    await prisma.job.update({
      where: { id: jobId },
      data: {
        totalTasks: { increment: validUrls.length },
        status: "PROCESSING",
      },
    });

    after(async () => {
      await triggerProcessing();
    });

    return NextResponse.json({
      added: validUrls.length,
      invalidUrls,
    });
  } catch (error) {
    console.error("[add-candidates]", error);
    return NextResponse.json({ error: "Failed to add candidates" }, { status: 500 });
  }
}
```

---

## Step 7 — Jobs Page (Active Requisitions)

Create `app/(app)/page.tsx`. This is the main jobs dashboard — replaces the old home page entirely.

**Data it fetches:** `GET /api/jobs?page=1&limit=100`

**What it renders:**
- Top bar: "Active Requisitions" heading + subtitle + search input (right-aligned)
- Grid/List toggle buttons
- Grid of JobCards
- A "+ Open New Requisition" dashed card at the end
- OpenRequisitionModal (dialog, hidden until triggered)

**Behaviour:**
- Search filters cards client-side by `job.title` and `job.department`
- Clicking a card navigates to `/jobs/[jobId]`
- Clicking the dashed card opens the modal
- Modal submits `POST /api/jobs { title, department }` → on success redirects to `/jobs/[jobId]`
- Polls `GET /api/jobs` every 5s if any job has status PROCESSING or PENDING

Full implementation:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { JobCard } from "@/components/jobs/JobCard";

interface Job {
  id: string;
  title: string;
  department: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
}

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [creating, setCreating] = useState(false);

  async function fetchJobs() {
    try {
      const res = await fetch("/api/jobs?page=1&limit=100");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJobs();
  }, []);

  // Poll while any job is active
  useEffect(() => {
    const hasActive = jobs.some(j => j.status === "PROCESSING" || j.status === "PENDING");
    if (!hasActive) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs]);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, department: newDepartment }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/jobs/${data.jobId}`);
      }
    } finally {
      setCreating(false);
    }
  }

  const filtered = jobs.filter(j => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return j.title.toLowerCase().includes(q) || j.department.toLowerCase().includes(q);
  });

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Active Requisitions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage candidate pipelines across open roles.
          </p>
        </div>
        <Button onClick={() => setShowNewModal(true)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          Add Candidates
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search requisitions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="ml-auto flex items-center gap-1 border border-border rounded-lg p-1">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("grid")}
            className="h-7 w-7 p-0"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
            className="h-7 w-7 p-0"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className={viewMode === "grid"
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          : "space-y-3"
        }>
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      ) : (
        <div className={viewMode === "grid"
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          : "space-y-3"
        }>
          {filtered.map(job => (
            <JobCard
              key={job.id}
              job={job}
              viewMode={viewMode}
              onClick={() => router.push(`/jobs/${job.id}`)}
            />
          ))}

          {/* New Requisition Card */}
          <button
            onClick={() => setShowNewModal(true)}
            className={`${viewMode === "grid" ? "h-48" : "h-16"} border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:border-primary/50 hover:bg-primary/5 transition-colors group`}
          >
            <div className="h-9 w-9 rounded-full border-2 border-border group-hover:border-primary/50 flex items-center justify-center transition-colors">
              <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">Open New Requisition</p>
              <p className="text-xs text-muted-foreground/60">Configure JD and scoring rules</p>
            </div>
          </button>
        </div>
      )}

      {/* New Requisition Modal */}
      <Dialog open={showNewModal} onOpenChange={setShowNewModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Open New Requisition</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Job Title <span className="text-destructive">*</span></Label>
              <Input
                id="req-title"
                placeholder="e.g. Senior Sales AE"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-dept">Department</Label>
              <Input
                id="req-dept"
                placeholder="e.g. Sales, Engineering"
                value={newDepartment}
                onChange={e => setNewDepartment(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewModal(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newTitle.trim()}>
              {creating ? "Creating..." : "Create Requisition"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

---

## Step 8 — JobCard Component

Create `components/jobs/JobCard.tsx`:

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  title: string;
  department: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  PENDING:    { label: "Pending",    className: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  PROCESSING: { label: "Processing", className: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  COMPLETED:  { label: "Completed",  className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  FAILED:     { label: "Failed",     className: "bg-rose-500/15 text-rose-400 border-rose-500/25" },
  PAUSED:     { label: "Paused",     className: "bg-violet-500/15 text-violet-400 border-violet-500/25" },
  CANCELLED:  { label: "Cancelled",  className: "bg-neutral-500/15 text-neutral-400 border-neutral-500/25" },
};

export function JobCard({ job, viewMode, onClick }: { job: Job; viewMode: "grid" | "list"; onClick: () => void }) {
  const statusCfg = statusConfig[job.status] || statusConfig.PENDING;
  const pending = job.totalTasks - job.processedCount;

  if (viewMode === "list") {
    return (
      <Card
        className="cursor-pointer hover:border-primary/40 transition-colors"
        onClick={onClick}
      >
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground truncate">{job.title}</p>
            {job.department && <p className="text-xs text-muted-foreground truncate">{job.department}</p>}
          </div>
          <Badge variant="outline" className={cn("text-xs shrink-0", statusCfg.className)}>
            {statusCfg.label}
          </Badge>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Pipeline</p>
            <p className="text-sm font-bold text-foreground">{job.totalTasks} <span className="font-normal text-muted-foreground">total</span></p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">{pending > 0 ? pending : 0}</span>
            <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">{job.successCount}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="cursor-pointer hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/5 group"
      onClick={onClick}
    >
      <CardContent className="p-5 flex flex-col h-full gap-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-foreground leading-snug line-clamp-2 flex-1">{job.title}</p>
          <Badge variant="outline" className={cn("text-[10px] shrink-0 uppercase tracking-wide", statusCfg.className)}>
            {statusCfg.label}
          </Badge>
        </div>

        {job.department && (
          <p className="text-xs text-muted-foreground">{job.department}</p>
        )}

        <div className="mt-auto pt-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Pipeline</p>
          <div className="flex items-center justify-between">
            <p className="text-xl font-bold text-foreground">
              {job.totalTasks} <span className="text-sm font-normal text-muted-foreground">total</span>
            </p>
            <div className="flex gap-1.5">
              <span className="inline-flex items-center justify-center h-7 min-w-[28px] px-2 rounded-full bg-amber-500/15 text-amber-400 text-xs font-bold border border-amber-500/20">
                {Math.max(0, job.totalTasks - job.processedCount)}
              </span>
              <span className="inline-flex items-center justify-center h-7 min-w-[28px] px-2 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-bold border border-emerald-500/20">
                {job.successCount}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Step 9 — Job Detail Page

Create `app/(app)/jobs/[jobId]/page.tsx`. This is the big one. It replaces the current `app/jobs/[jobId]/page.tsx` with a tabbed layout.

**Structure:**
- Page-level header: job title, back button, "Add Candidates" button
- shadcn `Tabs` with two tabs: Candidates | Dashboard
- Candidates tab: all existing profile card functionality (copy from old page)
- Dashboard tab: all existing Advanced Config panel functionality (copy from old home page)

The page fetches:
- `GET /api/jobs/[jobId]/results` — for candidates + job config
- `GET /api/sheet-integrations` — for sheet picker in candidates tab and dashboard tab
- `GET /api/ai-providers` — for model selector in dashboard tab
- `GET /api/jd-templates` — for dashboard tab
- `GET /api/evaluation-configs` — for dashboard tab

Key state:
- `data` — full job results (tasks, config, title, department)
- `polling` — 3s interval while job is PROCESSING/PENDING/PAUSED
- `expandedTask` — which profile card is open
- `search` — candidate name filter
- `selectMode` + `selectedIds` — export selection
- All the advanced config state from the old home page (scoringRules, customScoringRules, jobDescription, promptRole, criticalInstructions, promptGuidelines, builtInRuleDescriptions, aiModel, aiProviderId, jdTemplates, evaluationConfigs, etc.)

Config state loads from `data.config` (the job's stored config JSON) rather than AppSettings. Saves via `PUT /api/jobs/[jobId]` (the new route from Step 6b).

**The Add Candidates dropdown behavior:**
- "Add Manually" → small dialog with a single LinkedIn URL input → `POST /api/jobs/[jobId]/add-candidates { urls }`
- "Bulk Add" → `BulkAddModal` (see Step 10) → same endpoint

Here is the full page. It is long — implement it completely:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronLeft, UserPlus, Users, LayoutDashboard, Plus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { estimateCost, formatCost } from "@/lib/model-pricing";
import { DEFAULT_RULE_PROMPTS, DEFAULT_CRITICAL_INSTRUCTIONS } from "@/lib/analyzer";

// ── Sub-components (inline for now, can be extracted later) ─────────
import { CandidatesTab } from "@/components/jobs/CandidatesTab";
import { DashboardTab } from "@/components/jobs/DashboardTab";
import { BulkAddModal } from "@/components/jobs/BulkAddModal";
import { AddManuallyModal } from "@/components/jobs/AddManuallyModal";

// ── Types ────────────────────────────────────────────────────────────
interface TaskResult {
  id: string;
  url: string;
  status: string;
  result: any;
  analysisResult: any;
  errorMessage: string | null;
  retryCount: number;
}

interface JobResults {
  id: string;
  title: string;
  department: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  config?: any;
  tasks: TaskResult[];
}

const JOB_STATUSES: Record<string, string> = {
  PENDING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  PROCESSING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  COMPLETED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  FAILED: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  PAUSED: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  CANCELLED: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
};

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [data, setData] = useState<JobResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);

  async function fetchResults() {
    try {
      const res = await fetch(`/api/jobs/${jobId}/results`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchResults();
    const interval = setInterval(() => {
      if (data && ["PROCESSING", "PENDING", "PAUSED"].includes(data.status)) {
        fetchResults();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [jobId, data?.status]);

  async function handleJobAction(action: "pause" | "resume" | "cancel") {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const json = await res.json();
        setData(prev => prev ? { ...prev, status: json.status } : prev);
      }
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 space-y-4 animate-pulse">
        <div className="h-8 bg-card rounded w-1/3" />
        <div className="h-4 bg-card rounded w-1/2" />
        <div className="h-64 bg-card rounded" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <Link href="/" className="text-primary text-sm hover:underline flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" /> Back
        </Link>
        <p className="text-muted-foreground mt-4">Job not found.</p>
      </div>
    );
  }

  const statusCls = JOB_STATUSES[data.status] || JOB_STATUSES.PENDING;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top Header */}
      <div className="border-b border-border px-8 py-4 flex items-center gap-4 shrink-0 bg-background">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-foreground truncate">{data.title}</h1>
            <Badge variant="outline" className={cn("text-xs uppercase tracking-wide shrink-0", statusCls)}>
              {data.status}
            </Badge>
          </div>
          {data.department && (
            <p className="text-xs text-muted-foreground mt-0.5">{data.department}</p>
          )}
        </div>

        {/* Job control buttons */}
        {["PENDING", "PROCESSING", "PAUSED"].includes(data.status) && (
          <div className="flex gap-2 shrink-0">
            {data.status === "PAUSED" ? (
              <Button size="sm" variant="outline" onClick={() => handleJobAction("resume")} disabled={actionLoading}
                className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                Resume
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => handleJobAction("pause")} disabled={actionLoading}
                className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10">
                Pause
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => handleJobAction("cancel")} disabled={actionLoading}
              className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10">
              Cancel
            </Button>
          </div>
        )}

        {/* Add Candidates */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-2 shrink-0">
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

      {/* Tabs */}
      <Tabs defaultValue="candidates" className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border px-8 shrink-0 bg-background">
          <TabsList className="bg-transparent h-auto p-0 gap-0">
            <TabsTrigger
              value="candidates"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground px-4 py-3 text-sm font-medium text-muted-foreground gap-2"
            >
              <Users className="h-4 w-4" />
              Candidates
              <Badge variant="secondary" className="ml-1 text-xs">{data.successCount}</Badge>
            </TabsTrigger>
            <TabsTrigger
              value="dashboard"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground px-4 py-3 text-sm font-medium text-muted-foreground gap-2"
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="candidates" className="flex-1 overflow-y-auto m-0 p-8">
          <CandidatesTab data={data} jobId={jobId} onRefresh={fetchResults} />
        </TabsContent>

        <TabsContent value="dashboard" className="flex-1 overflow-y-auto m-0 p-8">
          <DashboardTab jobId={jobId} initialConfig={data.config} />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <BulkAddModal
        open={showBulkAdd}
        onClose={() => setShowBulkAdd(false)}
        jobId={jobId}
        onSuccess={fetchResults}
      />
      <AddManuallyModal
        open={showManualAdd}
        onClose={() => setShowManualAdd(false)}
        jobId={jobId}
        onSuccess={fetchResults}
      />
    </div>
  );
}
```

---

## Step 10 — CandidatesTab Component

Create `components/jobs/CandidatesTab.tsx`.

This component contains ALL the existing profile card UI from the old `app/jobs/[jobId]/page.tsx`. Copy the `ProfileCard`, `ExpandableList`, `Field`, `StatCard` components from the old file. The `CandidatesTab` component wraps them with the search, select-to-export toolbar, floating export bar, and sheet URL modal — all exactly as they exist today.

**What to copy from the old file:**
- `ProfileCard` component (lines ~527–968 of the old page)
- `Field` component
- `StatCard` component  
- `ExpandableList` component
- All export logic (`runExport`, `handleJobAction`, select mode state)
- Sheet integrations loading
- The floating export bar
- The sheet URL modal

**Props it receives:**
```typescript
interface CandidatesTabProps {
  data: JobResults;        // full job results including tasks
  jobId: string;
  onRefresh: () => void;  // called after pause/resume/cancel to update parent
}
```

The only behavioral change: the job action buttons (pause/resume/cancel) are now in the page header, not inside this tab. This component just handles candidate display, search, and export.

---

## Step 11 — DashboardTab Component

Create `components/jobs/DashboardTab.tsx`.

This component contains ALL the Advanced Configuration panel content from the old `app/page.tsx`. Copy all the config state and UI:

**What to copy from the old `app/page.tsx`:**
- All scoring rule toggles (the `SCORING_RULE_DEFS` constant and the 7 toggle UI)
- Per-rule description overrides (the expandable textarea sections)
- Custom scoring rules CRUD (the add form + list)
- JD template selector + inline edit
- Evaluation config selector + inline editor
- Preview Prompt button + modal
- AI model/provider selector
- Google Sheets integration (saved sheets + URL input)
- Min score threshold slider
- Job description textarea
- All associated state and handlers

**Key difference from old home page:** Instead of submitting a new job on "submit", ALL saves go to `PUT /api/jobs/[jobId]`. The component auto-saves each section independently (like JD description saves when you click a "Save" button, scoring rules save when you toggle).

**Props:**
```typescript
interface DashboardTabProps {
  jobId: string;
  initialConfig: any;  // the job's config JSON object (already parsed)
}
```

**Initial state loading:** On mount, read `initialConfig` and populate:
- `jobDescription` from `initialConfig.jobDescription`
- `scoringRules` from `initialConfig.scoringRules`
- `customScoringRules` from `initialConfig.customScoringRules`
- `aiModel` from `initialConfig.aiModel`
- `aiProviderId` from `initialConfig.aiProviderId`
- `promptRole` from `initialConfig.promptRole`
- `criticalInstructions` from `initialConfig.criticalInstructions`
- `promptGuidelines` from `initialConfig.promptGuidelines`
- `builtInRuleDescriptions` from `initialConfig.builtInRuleDescriptions`
- `sheetWebAppUrl` from `initialConfig.sheetWebAppUrl`
- `minScoreThreshold` from `initialConfig.minScoreThreshold`

**Save function:**
```typescript
async function saveConfig(patch: Partial<ConfigState>) {
  await fetch(`/api/jobs/${jobId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
```

---

## Step 12 — BulkAddModal Component

Create `components/jobs/BulkAddModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onClose: () => void;
  jobId: string;
  onSuccess: () => void;
}

export function BulkAddModal({ open, onClose, jobId, onSuccess }: Props) {
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ added: number; invalidUrls: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!urls.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/add-candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to add candidates");
      } else {
        setResult(json);
        setUrls("");
        onSuccess();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setUrls("");
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Add Candidates</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Future: Document upload zone goes here */}
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center opacity-40 cursor-not-allowed">
            <p className="text-sm text-muted-foreground">Document upload (PDF/DOCX/ZIP)</p>
            <p className="text-xs text-muted-foreground mt-1">Coming soon</p>
          </div>

          <div className="space-y-1.5">
            <Label>LinkedIn URLs <span className="text-muted-foreground font-normal">(one per line)</span></Label>
            <Textarea
              placeholder={"https://linkedin.com/in/username...\nhttps://linkedin.com/in/another..."}
              value={urls}
              onChange={e => setUrls(e.target.value)}
              rows={8}
              className="font-mono text-xs resize-none"
            />
          </div>

          {result && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-400">
              Added {result.added} candidate{result.added !== 1 ? "s" : ""} to the pipeline.
              {result.invalidUrls?.length > 0 && (
                <p className="text-xs text-amber-400 mt-1">{result.invalidUrls.length} invalid URLs skipped.</p>
              )}
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-400">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || !urls.trim()}>
            {loading ? "Processing..." : "Upload & Process"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Step 13 — AddManuallyModal Component

Create `components/jobs/AddManuallyModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onClose: () => void;
  jobId: string;
  onSuccess: () => void;
}

export function AddManuallyModal({ open, onClose, jobId, onSuccess }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/add-candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: url }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to add candidate");
      } else {
        setUrl("");
        onSuccess();
        onClose();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => { if (!loading) { setUrl(""); setError(null); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Candidate</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>LinkedIn URL</Label>
            <Input
              placeholder="https://linkedin.com/in/username"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || !url.trim()}>
            {loading ? "Adding..." : "Add Candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Step 14 — Settings Page Migration

Create `app/(app)/settings/page.tsx`. 

Copy the **entire contents** of the existing `app/settings/page.tsx` into this file. No logic changes. The only difference is it now renders inside the sidebar layout automatically because of the route group.

---

## Step 15 — Cleanup

Delete these old files (only after verifying the new ones work):
- `app/page.tsx`
- `app/jobs/[jobId]/page.tsx`
- `app/settings/page.tsx`

---

## Step 16 — Final Checks

1. Run `npx prisma generate` to ensure Prisma client is current
2. Run `npm run build` and fix any TypeScript errors
3. Test the full flow:
   - Open `/` — see jobs grid
   - Click "Open New Requisition" — modal opens, create job → redirects to `/jobs/[jobId]`
   - On job detail, click "Add Candidates" → "Bulk Add" → paste URLs → submit
   - Watch Candidates tab populate in real-time
   - Open Dashboard tab — see JD config, scoring rules, etc.
   - Export works (select mode → Download XLSX or Export to Sheet)
   - `/settings` loads correctly with sidebar

---

## Key Invariants — Do Not Break These

- `app/api/process-tasks/route.ts` — DO NOT TOUCH. The entire processing engine, `processOneTask`, `processLoop`, `triggerProcessing`, all Unipile + AI + sheet logic is here. Any bug here breaks the entire platform.
- `lib/analyzer.ts` — DO NOT TOUCH. The scoring engine.
- `lib/ai-adapter.ts` — DO NOT TOUCH.
- `lib/sheets.ts` — DO NOT TOUCH.
- `GET /api/extension/config` — DO NOT TOUCH. The Chrome extension reads this.
- The `AppSettings` table always has exactly one row with `id = "global"`. Never insert a second row.
- `POST /api/jobs` must still work with the old payload shape (the Chrome extension may call it). The new `title`/`department` fields are purely additive; all old fields still work.

---

## What Is NOT In This Revamp

- Resume PDF/DOCX upload and parsing — future
- ZIP file upload — future
- `hiringStage` field on Job — future
- `location` field on Job — future
- `ResumeUpload` model — future
- Settings page redesign — future
- Mobile responsive sidebar — future

---

## Summary of Files to Create/Modify

**Create (new files):**
- `components/layout/Sidebar.tsx`
- `components/layout/AppShell.tsx`
- `app/(app)/layout.tsx`
- `app/(app)/page.tsx`
- `app/(app)/jobs/[jobId]/page.tsx`
- `app/(app)/settings/page.tsx`
- `components/jobs/JobCard.tsx`
- `components/jobs/CandidatesTab.tsx`
- `components/jobs/DashboardTab.tsx`
- `components/jobs/BulkAddModal.tsx`
- `components/jobs/AddManuallyModal.tsx`
- `app/api/jobs/[jobId]/add-candidates/route.ts`

**Modify (existing files):**
- `prisma/schema.prisma` — add `title`, `department` to Job
- `app/layout.tsx` — remove width wrapper, add `class="dark"`
- `app/api/jobs/route.ts` — accept title/department in POST, return in GET
- `app/api/jobs/[jobId]/route.ts` — add PUT handler
- `app/api/jobs/[jobId]/results/route.ts` — return title/department

**Delete (after new files confirmed working):**
- `app/page.tsx`
- `app/jobs/[jobId]/page.tsx`
- `app/settings/page.tsx`
