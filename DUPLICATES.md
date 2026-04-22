# Duplicate Detection — Implementation Plan

## What to build

Persistent duplicate detection for LinkedIn URLs and resume PDFs with a resolve UI.
Backend detection already works (returns `duplicates[]` from runs/upload-profiles APIs) but UI silently drops it and nothing is persisted.

---

## Phase 1 — Data Model

### Add `DuplicatePair` to `prisma/schema.prisma`

```prisma
model DuplicatePair {
  id            String   @id @default(cuid())
  requisitionId String
  taskAId       String
  taskBId       String
  kind          String   // "LINKEDIN_URL" | "RESUME_HASH"
  matchValue    String   @db.Text  // the URL or hex hash — shown in UI
  status        String   @default("PENDING") // PENDING | RESOLVED_DELETED_A | RESOLVED_DELETED_B | RESOLVED_KEPT_BOTH
  resolvedAt    DateTime?
  resolvedBy    String?
  createdAt     DateTime @default(now())

  taskA          Task        @relation("DuplicatePairA", fields: [taskAId], references: [id], onDelete: Cascade)
  taskB          Task        @relation("DuplicatePairB", fields: [taskBId], references: [id], onDelete: Cascade)
  requisition    Requisition @relation(fields: [requisitionId], references: [id], onDelete: Cascade)

  @@index([requisitionId, status])
  @@index([taskAId])
  @@index([taskBId])
}
```

Add back-relations on `Task`:
```prisma
duplicatesAsA  DuplicatePair[] @relation("DuplicatePairA")
duplicatesAsB  DuplicatePair[] @relation("DuplicatePairB")
```

Add back-relation on `Requisition`:
```prisma
duplicatePairs DuplicatePair[]
```

Create migration: `prisma/migrations/20260422000001_add_duplicate_pair/migration.sql`
```sql
CREATE TABLE "DuplicatePair" (
  "id" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "taskAId" TEXT NOT NULL,
  "taskBId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "matchValue" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuplicatePair_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "DuplicatePair" ADD CONSTRAINT "DuplicatePair_taskAId_fkey" FOREIGN KEY ("taskAId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuplicatePair" ADD CONSTRAINT "DuplicatePair_taskBId_fkey" FOREIGN KEY ("taskBId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuplicatePair" ADD CONSTRAINT "DuplicatePair_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "DuplicatePair_requisitionId_status_idx" ON "DuplicatePair"("requisitionId", "status");
CREATE INDEX "DuplicatePair_taskAId_idx" ON "DuplicatePair"("taskAId");
CREATE INDEX "DuplicatePair_taskBId_idx" ON "DuplicatePair"("taskBId");
```

Then run: `npx prisma generate` and `npx prisma migrate deploy`

---

## Phase 2 — API Changes

### 2a. Refactor `app/api/requisitions/[requisitionId]/runs/route.ts`

Replace the current inline `duplicates` array block (at the end of POST) with:

1. After creating tasks, get all DONE tasks in previous jobs of this requisition where `url IN (valid URLs)`
2. Skip any URL that already has a `RESOLVED_KEPT_BOTH` `DuplicatePair` for this requisition (user dismissed it)
3. Detect within-submission duplicates: group new tasks by url, create pairs between them too
4. Bulk `createMany` DuplicatePair rows with `kind: "LINKEDIN_URL"`, `matchValue: url`
5. Return `{ runId, totalTasks, invalidUrls?, duplicatesDetected: number }` (count only — UI fetches details separately)

### 2b. Refactor `app/api/requisitions/[requisitionId]/upload-profiles/route.ts`

Same as 2a but:
- Use `contentHash` as the match key
- `kind: "RESUME_HASH"`, `matchValue: contentHash`
- matchValue shown in UI as the filename (join through taskA/taskB `sourceFileName`)

### 2c. New: `app/api/requisitions/[requisitionId]/duplicates/route.ts`

```
GET → returns all PENDING pairs with taskA + taskB hydrated
```

Response shape:
```json
{
  "pairs": [
    {
      "id": "clxxx",
      "kind": "LINKEDIN_URL",
      "matchValue": "https://linkedin.com/in/...",
      "createdAt": "...",
      "taskA": { "id", "url", "sourceFileName", "status", "createdAt", "jobId", "analysisResult" },
      "taskB": { "id", "url", "sourceFileName", "status", "createdAt", "jobId", "analysisResult" }
    }
  ]
}
```

### 2d. New: `app/api/duplicates/[pairId]/resolve/route.ts`

```
POST body: { action: "DELETE_A" | "DELETE_B" | "KEEP_BOTH", resolvedBy?: string }
```

Logic:
- Load the DuplicatePair, get taskA and taskB with their job info
- `DELETE_A` or `DELETE_B`: delete the losing Task (cascade handles stageEvents/notes/outreachMessages), decrement job `totalTasks`, recalculate job status
- `KEEP_BOTH`: no task changes
- Update `DuplicatePair.status`, `resolvedAt`, `resolvedBy`
- Return `{ ok: true }`

---

## Phase 3 — UI

### 3a. Update `components/jobs/BulkAddModal.tsx`

- Widen `result` state type: add `duplicatesDetected?: number`
- After success, if `duplicatesDetected > 0`, show amber alert block:
  `"⚠ N duplicate candidate(s) detected"` with a **"Review now"** button
- "Review now" → call a `onDuplicatesDetected()` prop callback that the parent uses to open the drawer

### 3b. Update `components/jobs/UploadResumesModal.tsx`

Same as 3a. Don't close modal immediately if duplicates detected — show the amber block first, let user decide.

### 3c. Update `app/(app)/jobs/[jobId]/page.tsx`

- Add state: `duplicatePairs`, `drawerOpen`
- `fetchDuplicates()` function: `GET /api/requisitions/[reqId]/duplicates`
- Call `fetchDuplicates()` on mount + after `onSuccess()` callbacks + every 60s (not aggressive)
- Render amber banner just above the tabs when `duplicatePairs.length > 0`:
  ```
  ⚠  3 duplicate candidates detected — Review & resolve
  ```
  Clicking opens `<ResolveDuplicatesDrawer />`
- Pass `duplicatePairs`, `drawerOpen`, `setDrawerOpen`, and `onResolved` (re-fetches) to the drawer
- Pass `onDuplicatesDetected` prop down to `BulkAddModal` and `UploadResumesModal`

### 3d. New: `components/jobs/ResolveDuplicatesDrawer.tsx`

Uses shadcn `Sheet` (right-side panel). Structure:

```
Sheet (right, width ~720px)
  SheetHeader: "Duplicate Candidates — N to resolve"
  SheetContent (scrollable):
    for each pair:
      PairCard:
        ─────────────────────────────────────────────
        [Task A column]      ≡ same URL/hash  [Task B column]
        Name (from result JSON)              Name
        URL / filename                       URL / filename
        Added: date  Run: jobId[-6]          Added: date  Run: jobId[-6]
        Score badge (if analyzed)            Score badge
        ─────────────────────────────────────────────
        [Keep A, delete B]  [Keep B, delete A]  [Keep both — not duplicate]
        ─────────────────────────────────────────────
    Empty state: "All duplicates resolved ✓"
```

Each action button POSTs to `/api/duplicates/[pairId]/resolve` then removes the pair from local state optimistically.

Score badge: parse `analysisResult` JSON → `scorePercent`. Show green/amber/red pill.

### 3e. (Optional) Candidate card badge in `components/jobs/CandidatesTab.tsx`

If a task's `id` appears in `duplicatePairs` (either as `taskAId` or `taskBId`), show a small amber `⚠ dup` pill next to the name. Clicking it opens the drawer.

---

## Checklist

- [ ] 1.1 Add `DuplicatePair` model to schema + back-relations on Task + Requisition
- [ ] 1.2 Write migration SQL file and run `prisma migrate deploy` + `prisma generate`
- [ ] 2.1 Refactor `runs/route.ts` — persist pairs, return count
- [ ] 2.2 Refactor `upload-profiles/route.ts` — persist pairs, return count
- [ ] 2.3 New `GET /api/requisitions/[id]/duplicates` endpoint
- [ ] 2.4 New `POST /api/duplicates/[pairId]/resolve` endpoint
- [ ] 3.1 Update `BulkAddModal.tsx` — show amber alert, emit callback
- [ ] 3.2 Update `UploadResumesModal.tsx` — same
- [ ] 3.3 Update `jobs/[jobId]/page.tsx` — fetch pairs, banner, drawer state
- [ ] 3.4 Create `ResolveDuplicatesDrawer.tsx`
- [ ] 3.5 (Optional) Duplicate badge on candidate cards in `CandidatesTab.tsx`

---

## Key files

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Add DuplicatePair model |
| `prisma/migrations/20260422000001_add_duplicate_pair/migration.sql` | New |
| `app/api/requisitions/[requisitionId]/runs/route.ts` | Refactor dedup block |
| `app/api/requisitions/[requisitionId]/upload-profiles/route.ts` | Refactor dedup block |
| `app/api/requisitions/[requisitionId]/duplicates/route.ts` | New GET endpoint |
| `app/api/duplicates/[pairId]/resolve/route.ts` | New POST endpoint |
| `components/jobs/BulkAddModal.tsx` | Surface duplicatesDetected |
| `components/jobs/UploadResumesModal.tsx` | Surface duplicatesDetected |
| `app/(app)/jobs/[jobId]/page.tsx` | Banner + drawer state + fetch |
| `components/jobs/ResolveDuplicatesDrawer.tsx` | New component |
| `components/jobs/CandidatesTab.tsx` | Optional dup badge |

---

## Verification

1. Submit same LinkedIn URL twice (two separate runs, same requisition) → banner shows "1 duplicate" → drawer shows pair → "Keep A, delete B" → B gone, banner gone
2. Submit same URL twice in one `urls` textarea → within-submission pair created → resolvable
3. Upload same PDF twice (renamed) → content hash matches → pair created
4. "Keep both" → both tasks stay → re-submit same URL → no new pair (suppressed by `RESOLVED_KEPT_BOTH` check)
5. Delete task via resolve → job counters updated correctly
6. Delete requisition → cascades to all pairs
