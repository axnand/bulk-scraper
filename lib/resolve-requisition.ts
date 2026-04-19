import { prisma } from "@/lib/prisma";

const SHORT_CODE_RE = /^JD-[A-Z0-9]{8}$/i;

export async function resolveRequisitionId(param: string): Promise<string> {
  if (SHORT_CODE_RE.test(param)) {
    const prefix = param.slice(3).toLowerCase();
    const row = await prisma.requisition.findFirst({
      where: { id: { startsWith: prefix } },
      select: { id: true },
    });
    if (row) return row.id;
  }
  return param;
}
