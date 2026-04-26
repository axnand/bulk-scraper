import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resumeSiblingThreads } from "@/lib/channels/thread-worker";
import { recomputeTaskStage } from "@/lib/channels/stage-rollup";

export const dynamic = "force-dynamic";

// GET /api/tasks/:taskId/threads — list all ChannelThreads for a task with messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    const threads = await prisma.channelThread.findMany({
      where: { taskId },
      include: {
        channel: { select: { id: true, name: true, type: true } },
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ threads });
  } catch (err) {
    console.error("[Threads] GET failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/tasks/:taskId/threads — recruiter actions on threads
// Body: { action: "resume_siblings", threadId: string }
//       Resume paused sibling threads when a reply is dismissed as off-topic
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await req.json() as { action: string; threadId?: string };

    if (body.action === "resume_siblings") {
      if (!body.threadId) {
        return NextResponse.json({ error: "threadId required for resume_siblings" }, { status: 400 });
      }
      await resumeSiblingThreads(taskId, body.threadId);
      await recomputeTaskStage(taskId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (err) {
    console.error("[Threads] POST failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
