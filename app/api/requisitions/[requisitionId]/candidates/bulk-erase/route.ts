// ─── GDPR bulk hard-erasure endpoint ─────────────────────────────────────────
//
// POST /api/requisitions/:requisitionId/candidates/bulk-erase
//
// Permanently deletes the requested Task rows (and all their children via
// ON DELETE CASCADE) from the database. This is the ONLY place hard-deletion
// of Task rows is allowed — all other code paths use soft-delete.
//
// Cascade map (Prisma schema → all children erased automatically):
//   Task → DuplicatePair, OutreachMessage, ChannelThread → ThreadMessage,
//           StageEvent, Note, CandidateContact, ScoreOverride
//
// CandidateProfile is NOT a cascade child of Task; it is shared across
// requisitions. This endpoint deletes a CandidateProfile only when the
// erased tasks are its *last* referencing tasks (orphan check).
//
// Before any deletion we write one GdprErasure audit row containing a JSON
// snapshot of (taskId, url, name, stage). The audit row is written in the
// same transaction as the deletion so it can never be missing.
//
// Idempotency: deleting a task that no longer exists is silently ignored.
// The audit row always reflects what was actually deleted.
//
// Body: { taskIds: string[] }   (max 200)
// Response 200: { erased: number }
// Response 400: bad input
// Response 500: internal error

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_ERASE_SIZE = 200;

export async function POST(
  req: NextRequest,
) {
  try {
    const body = await req.json();
    const { taskIds } = body as { taskIds?: unknown };

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json({ error: "taskIds must be a non-empty array" }, { status: 400 });
    }
    if (taskIds.length > MAX_ERASE_SIZE) {
      return NextResponse.json(
        { error: `Maximum ${MAX_ERASE_SIZE} tasks per erase request` },
        { status: 400 },
      );
    }
    if (!taskIds.every((id): id is string => typeof id === "string" && id.length > 0)) {
      return NextResponse.json({ error: "taskIds must be an array of non-empty strings" }, { status: 400 });
    }

    // Snapshot before deletion — intentionally use findMany (not the filtered
    // client extension) so we also capture soft-deleted rows if present.
    const tasks = await prisma.$queryRaw<
      Array<{ id: string; url: string | null; stage: string; result: string | null }>
    >`
      SELECT id, url, stage, result
      FROM "Task"
      WHERE id = ANY(${taskIds}::text[])
    `;

    const snapshot = tasks.map(t => {
      let name = "Unknown";
      try {
        if (t.result) {
          const p = JSON.parse(t.result);
          const n = [p.first_name, p.last_name].filter(Boolean).join(" ");
          if (n) name = n;
        }
      } catch { /* ignore */ }
      return { taskId: t.id, url: t.url, name, stage: t.stage };
    });

    // Collect candidateProfileIds so we can orphan-check after deletion.
    const profileIds = await prisma.$queryRaw<Array<{ candidateProfileId: string }>>`
      SELECT DISTINCT "candidateProfileId"
      FROM "Task"
      WHERE id = ANY(${taskIds}::text[])
        AND "candidateProfileId" IS NOT NULL
    `;
    const profileIdSet = profileIds.map(r => r.candidateProfileId);

    // Single transaction: audit row + hard-delete.
    // CandidateProfile orphan cleanup runs after — it's idempotent and can
    // tolerate being outside the tx (worst case: an orphaned profile lingers
    // until the next erase request for the same candidate).
    await prisma.$transaction(async tx => {
      // Write audit record first.
      await tx.$executeRaw`
        INSERT INTO "GdprErasure" (id, "taskCount", "snapshotJson")
        VALUES (
          gen_random_uuid()::text,
          ${tasks.length},
          ${JSON.stringify(snapshot)}::text
        )
      `;

      // Delete tasks — cascades to all child tables automatically.
      await tx.$executeRaw`
        DELETE FROM "Task"
        WHERE id = ANY(${taskIds}::text[])
      `;
    });

    // Orphan check: delete CandidateProfile rows that are no longer referenced
    // by any Task (including soft-deleted ones — a soft-deleted task still
    // "owns" the profile for audit purposes until it too is erased).
    if (profileIdSet.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "CandidateProfile"
        WHERE id = ANY(${profileIdSet}::text[])
          AND NOT EXISTS (
            SELECT 1 FROM "Task"
            WHERE "candidateProfileId" = "CandidateProfile".id
          )
      `;
    }

    return NextResponse.json({ erased: tasks.length });
  } catch (err) {
    console.error("[bulk-erase] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
