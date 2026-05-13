import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkTask() {
  const tasks = await prisma.task.findMany({
    where: {
      id: { contains: '8hugiy' }
    }
  });
  console.log(JSON.stringify(tasks, null, 2));
}

checkTask().catch(console.error).finally(() => prisma.$disconnect());
