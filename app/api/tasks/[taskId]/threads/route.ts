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
//
// Actions:
//   { action: "resume_siblings", threadId: string }
//     Resume paused sibling threads (caller passes the REPLIED thread's id
//     as `threadId` so it's skipped). Use after the recruiter has read the
//     reply but doesn't want the other channels to stay paused.
//
//   { action: "dismiss_reply", threadId: string }            (P2 #4 / EC-7.2)
//     Reverse a webhook-driven REPLIED that turned out to be an out-of-office
//     auto-responder, signature line, or other false positive. Flips the
//     REPLIED thread back to ACTIVE with a fresh send slot, resumes its
//     paused siblings, and re-runs the stage rollup so task.stage correctly
//     re-derives from non-REPLIED state. Without this, OOO replies leave
//     task.stage stuck at REPLIED forever.
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
      await recomputeTaskStage(taskId, { source: "MANUAL" });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "dismiss_reply") {
      if (!body.threadId) {
        return NextResponse.json({ error: "threadId required for dismiss_reply" }, { status: 400 });
      }
      // Verify the thread is on this task and currently REPLIED — refuse
      // otherwise so the recruiter can't dismiss a thread that isn't
      // actually in the replied state.
      const thread = await prisma.channelThread.findUnique({
        where: { id: body.threadId },
        select: { id: true, taskId: true, status: true },
      });
      if (!thread || thread.taskId !== taskId) {
        return NextResponse.json({ error: "Thread not found on this task" }, { status: 404 });
      }
      if (thread.status !== "REPLIED") {
        return NextResponse.json(
          { error: `Thread is in state ${thread.status}, not REPLIED — nothing to dismiss` },
          { status: 422 },
        );
      }

      // Flip REPLIED → ACTIVE on the dismissed thread (24h cool-down before
      // it tries to send anything new, so the recruiter can change their
      // mind). Then resume paused siblings.
      const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.channelThread.update({
        where: { id: body.threadId },
        data: {
          status: "ACTIVE",
          nextActionAt: oneDayFromNow,
          // Clear the last-inbound marker so the WA 24h-window check (P1 #39)
          // treats this thread as having had no real inbound message yet.
          // (We're explicitly saying "that wasn't a real reply.")
          lastInboundAt: null,
        },
      });
      await resumeSiblingThreads(taskId, body.threadId);
      await recomputeTaskStage(taskId, { source: "MANUAL" });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (err) {
    console.error("[Threads] POST failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
