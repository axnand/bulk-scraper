// ─── Phase 6 #27 backfill ────────────────────────────────────────────────────
//
// One-off script. Idempotent — safe to re-run.
//
// 1. Populates CandidateProfile.canonicalLinkedinUrl from .linkedinUrl for
//    every row where canonical is null and the URL canonicalizes.
//
// 2. For every CandidateProfile sharing the same canonicalLinkedinUrl, picks
//    the most-recently-scraped row as the canonical winner. Other rows stay
//    in place (they are still referenced by historical AnalysisRecords); the
//    winner is what new Task links should point at.
//
// 3. For every Task that has no candidateProfileId yet, canonicalizes its
//    .url and links to the canonical winner if one exists.
//
// Run: `npm run worker:backfill-candidates` (after adding the script entry)
// or directly: `npx tsx scripts/backfill-candidate-identity.ts`.
//
// Chunked at 500 rows per batch to avoid long-running statements per the
// migration conventions in CLAUDE.md.

import { PrismaClient } from "@prisma/client";
import { canonicalizeLinkedinUrl } from "../lib/canonicalize-url";

const prisma = new PrismaClient();
const BATCH_SIZE = 500;

async function backfillCandidateProfileCanonical(): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;
  let cursor: string | undefined;

  while (true) {
    const rows: { id: string; linkedinUrl: string }[] = await prisma.candidateProfile.findMany({
      where: { canonicalLinkedinUrl: null },
      select: { id: true, linkedinUrl: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    for (const r of rows) {
      const canonical = canonicalizeLinkedinUrl(r.linkedinUrl);
      if (!canonical) {
        skipped++;
        continue;
      }
      await prisma.candidateProfile.update({
        where: { id: r.id },
        data: { canonicalLinkedinUrl: canonical },
      });
      updated++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { updated, skipped };
}

// For a given canonical URL, return the id of the row we'll treat as the
// canonical winner (most recent scrapedAt).
async function pickCanonicalWinners(): Promise<Map<string, string>> {
  // Group by canonicalLinkedinUrl, pick max scrapedAt per group.
  const winners = await prisma.$queryRawUnsafe<{ canonical: string; id: string }[]>(`
    SELECT DISTINCT ON ("canonicalLinkedinUrl")
      "canonicalLinkedinUrl" AS canonical,
      "id" AS id
    FROM "CandidateProfile"
    WHERE "canonicalLinkedinUrl" IS NOT NULL
    ORDER BY "canonicalLinkedinUrl", "scrapedAt" DESC
  `);

  const map = new Map<string, string>();
  for (const w of winners) map.set(w.canonical, w.id);
  return map;
}

async function backfillTaskCandidateProfileId(winners: Map<string, string>): Promise<{ linked: number; skipped: number }> {
  let linked = 0;
  let skipped = 0;
  let cursor: string | undefined;

  while (true) {
    const rows: { id: string; url: string }[] = await prisma.task.findMany({
      where: { candidateProfileId: null, deletedAt: null },
      select: { id: true, url: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    for (const r of rows) {
      const canonical = canonicalizeLinkedinUrl(r.url);
      if (!canonical) {
        skipped++;
        continue;
      }
      const winnerId = winners.get(canonical);
      if (!winnerId) {
        skipped++;
        continue;
      }
      await prisma.task.update({
        where: { id: r.id },
        data: { candidateProfileId: winnerId },
      });
      linked++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { linked, skipped };
}

async function main() {
  console.log("[backfill-candidate-identity] Pass 1 — CandidateProfile.canonicalLinkedinUrl");
  const pass1 = await backfillCandidateProfileCanonical();
  console.log(`[backfill-candidate-identity] Pass 1 done: updated=${pass1.updated} skipped=${pass1.skipped}`);

  console.log("[backfill-candidate-identity] Pass 2 — collecting canonical winners");
  const winners = await pickCanonicalWinners();
  console.log(`[backfill-candidate-identity] ${winners.size} canonical URLs with winner profile`);

  console.log("[backfill-candidate-identity] Pass 3 — Task.candidateProfileId");
  const pass3 = await backfillTaskCandidateProfileId(winners);
  console.log(`[backfill-candidate-identity] Pass 3 done: linked=${pass3.linked} skipped=${pass3.skipped}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[backfill-candidate-identity] FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
