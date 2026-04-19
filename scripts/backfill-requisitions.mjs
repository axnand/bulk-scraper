// Backfill: creates Requisitions from existing Jobs that have no requisitionId.
// Groups jobs by their title+department (or config.jdTitle) and creates one
// Requisition per unique role, linking all its runs to it.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.job.findMany({
    where: { requisitionId: null },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${jobs.length} orphaned jobs to backfill.`);
  if (jobs.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Group by normalised title
  const groups = new Map(); // key → { title, department, config, jobs[] }
  for (const job of jobs) {
    const config = job.config ? JSON.parse(job.config) : {};
    const title = (config.jdTitle || job.title || "Untitled Role").trim();
    const department = (job.department || config.department || "").trim();
    const key = `${title}__${department}`.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { title, department, config: job.config, jobs: [] });
    }
    groups.get(key).jobs.push(job);
  }

  console.log(`Creating ${groups.size} requisition(s)…`);

  for (const [, group] of groups) {
    // Pick latest job's config as the requisition's canonical config
    const latestJob = group.jobs.at(-1);
    const req = await prisma.requisition.create({
      data: {
        title: group.title,
        department: group.department,
        config: latestJob.config,
      },
    });

    await prisma.job.updateMany({
      where: { id: { in: group.jobs.map(j => j.id) } },
      data: { requisitionId: req.id },
    });

    console.log(`  → Requisition "${req.title}" (${req.id}) ← ${group.jobs.length} run(s)`);
  }

  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
