import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/s3";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { sourceFileUrl: true },
  });

  if (!task?.sourceFileUrl) {
    return NextResponse.json({ error: "Resume not found for this task" }, { status: 404 });
  }

  try {
    const url = await getSignedDownloadUrl(task.sourceFileUrl);
    return NextResponse.redirect(url);
  } catch (err: any) {
    console.error(`[TaskResume] Failed to sign URL for task ${taskId}:`, err.message);
    return NextResponse.json({ error: "Failed to generate resume link" }, { status: 500 });
  }
}
