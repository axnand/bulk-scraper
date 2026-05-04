// One-off: derive analysisStatus for existing Tasks.
//   status=DONE + analysisResult IS NOT NULL  → 'OK'
//   status=FAILED                              → 'FAILED' (cause unknown but
//                                                surfacing it is right)
//   anything else                              → leave 'PENDING' (default)
//
// Idempotent. Chunked at 1000 / batch per CLAUDE.md migration conventions.

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const okRes = await prisma.$executeRawUnsafe(`
    UPDATE "Task"
    SET    "analysisStatus" = 'OK'
    WHERE  "analysisStatus" = 'PENDING'
      AND  status = 'DONE'
      AND  "analysisResult" IS NOT NULL
  `);
  console.log(`OK backfill:     ${okRes} rows`);

  const failRes = await prisma.$executeRawUnsafe(`
    UPDATE "Task"
    SET    "analysisStatus" = 'FAILED'
    WHERE  "analysisStatus" = 'PENDING'
      AND  status = 'FAILED'
  `);
  console.log(`FAILED backfill: ${failRes} rows`);

  const summary: any = await prisma.$queryRawUnsafe(`
    SELECT "analysisStatus", COUNT(*) AS c
    FROM "Task" WHERE "deletedAt" IS NULL
    GROUP BY "analysisStatus"
    ORDER BY c DESC
  `);
  console.log("Distribution:", JSON.stringify(summary));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
