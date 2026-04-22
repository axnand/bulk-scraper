import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAndValidateUrls } from "@/lib/validators";
import { enqueueTaskBatch } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const { urls } = await req.json();

    if (!urls?.trim()) {
      return NextResponse.json({ error: "No URLs provided" }, { status: 400 });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, status: true },
    });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const { valid: validUrls, invalid: invalidUrls } = parseAndValidateUrls(urls);
    if (validUrls.length === 0) {
      return NextResponse.json({ error: "No valid LinkedIn URLs found", invalidUrls }, { status: 400 });
    }

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

    await prisma.job.update({
      where: { id: jobId },
      data: {
        totalTasks: { increment: validUrls.length },
        status: "PROCESSING",
      },
    });

    const createdTasks = await prisma.task.findMany({
      where: { jobId, status: "PENDING" },
      select: { id: true, source: true },
    });
    await enqueueTaskBatch(createdTasks);

    return NextResponse.json({ added: validUrls.length, invalidUrls });
  } catch (error) {
    console.error("[add-candidates]", error);
    return NextResponse.json({ error: "Failed to add candidates" }, { status: 500 });
  }
}
