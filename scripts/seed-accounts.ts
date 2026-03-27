/**
 * Seed script to add Unipile accounts to the database.
 *
 * Usage:
 *   tsx scripts/seed-accounts.ts --accountId "xxx" --name "Account 1"
 *   tsx scripts/seed-accounts.ts   (interactive — uses hardcoded defaults below)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);

  let accountId: string | undefined;
  let name: string = "";

  // Parse CLI args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--accountId" && args[i + 1]) {
      accountId = args[i + 1];
      i++;
    }
    if (args[i] === "--name" && args[i + 1]) {
      name = args[i + 1];
      i++;
    }
  }

  if (!accountId) {
    console.log("No --accountId provided. Seeding default test accounts...\n");

    // Default accounts for testing — replace with your real Unipile account IDs
    const defaults = [
      { accountId: "2mX6H957Q-OmTsxD6K1t7A", name: "Account 1" },
    ];

    for (const acc of defaults) {
      const existing = await prisma.account.findUnique({
        where: { accountId: acc.accountId },
      });

      if (existing) {
        console.log(`  ⏭ Account "${acc.name}" (${acc.accountId}) already exists, skipping.`);
      } else {
        await prisma.account.create({
          data: {
            accountId: acc.accountId,
            name: acc.name,
            status: "ACTIVE",
          },
        });
        console.log(`  ✓ Created account "${acc.name}" (${acc.accountId})`);
      }
    }
  } else {
    // Single account from CLI
    const existing = await prisma.account.findUnique({
      where: { accountId },
    });

    if (existing) {
      console.log(`Account "${accountId}" already exists.`);
    } else {
      await prisma.account.create({
        data: {
          accountId,
          name: name || accountId,
          status: "ACTIVE",
        },
      });
      console.log(`✓ Created account "${name || accountId}" (${accountId})`);
    }
  }

  // List all accounts
  console.log("\nAll accounts:");
  const all = await prisma.account.findMany({
    select: { id: true, accountId: true, name: true, status: true, dailyCount: true },
  });
  console.table(all);
}

main()
  .catch((err) => {
    console.error("Seed error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
