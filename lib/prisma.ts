// NOTE: do NOT add `import "server-only"` here. This module is also imported
// by the standalone `worker.ts` Node process (via lib/queue, lib/workers,
// lib/channels) which Next's bundler classifies as neither App Router nor
// Pages Router. server-only's compile-time check then fails with
// "you are using it in the Pages Router" even though no Pages Router exists.
//
// The actual client-bundle leak (analyzer → ai-adapter → prisma) is prevented
// at the source: lib/analyzer.ts uses a dynamic `await import("@/lib/ai-adapter")`
// inside analyzeProfile so ai-adapter never reaches the client static graph.
// If Prisma starts showing up in client bundles again, fix it the same way
// (dynamic import in the bridge module) rather than adding server-only here.
import { PrismaClient } from "@prisma/client";

// Injects `deletedAt: null` into every findMany / findFirst / count on Task
// unless the caller explicitly sets `deletedAt` themselves (e.g. admin view).
// findUnique is intentionally excluded — PK lookups are deliberate, not listings.
function createPrismaClient() {
  return new PrismaClient().$extends({
    name: "task-soft-delete",
    query: {
      task: {
        findMany({ args, query }) {
          args.where = { deletedAt: null, ...(args.where as object) } as typeof args.where;
          return query(args);
        },
        findFirst({ args, query }) {
          args.where = { deletedAt: null, ...(args.where as object) } as typeof args.where;
          return query(args);
        },
        findFirstOrThrow({ args, query }) {
          args.where = { deletedAt: null, ...(args.where as object) } as typeof args.where;
          return query(args);
        },
        count({ args, query }) {
          args.where = { deletedAt: null, ...(args.where as object) } as typeof args.where;
          return query(args);
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = global as unknown as { prisma: ExtendedPrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
