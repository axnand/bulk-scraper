import { NextRequest, NextResponse } from "next/server";
import { resolveRequisitionId } from "@/lib/resolve-requisition";
import { pollJobInviteAcceptances } from "@/lib/channels/outreach-tick";

export const dynamic = "force-dynamic";

// ─── Cooldown ─────────────────────────────────────────────────────────────────
//
// POLL_ACCEPTANCES_COOLDOWN_SECS controls how often this endpoint can be called
// per requisition. Default: 3600 (1 hr). Set to 0 to disable during testing.
//
// Cooldown is tracked in-memory per process. This is intentional: it's a
// rate-limiter for Unipile API calls, not a durable lock. On dyno restart the
// cooldown resets, which is acceptable — it just means one extra poll cycle.

const COOLDOWN_MS = (() => {
  const raw = process.env.POLL_ACCEPTANCES_COOLDOWN_SECS;
  const secs = raw !== undefined ? parseInt(raw, 10) : 3600;
  return isNaN(secs) ? 3600 * 1000 : secs * 1000;
})();

const lastPolledAt = new Map<string, number>();

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> },
) {
  const { requisitionId: rawId } = await params;
  const requisitionId = await resolveRequisitionId(rawId);

  if (COOLDOWN_MS > 0) {
    const last = lastPolledAt.get(requisitionId) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < COOLDOWN_MS) {
      const retryAfterSecs = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return NextResponse.json(
        {
          ok: false,
          cooldown: true,
          retryAfterSecs,
          lastPolledAt: new Date(last).toISOString(),
        },
        { status: 429 },
      );
    }
  }

  lastPolledAt.set(requisitionId, Date.now());

  try {
    const accepted = await pollJobInviteAcceptances(requisitionId);
    return NextResponse.json({
      ok: true,
      accepted,
      lastPolledAt: new Date(lastPolledAt.get(requisitionId)!).toISOString(),
    });
  } catch (err: any) {
    console.error("[poll-acceptances] Error:", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
