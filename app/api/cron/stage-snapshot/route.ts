// ─── Cron route: stage snapshot + anomaly detection ─────────────────────────
//
// Run once daily (or hourly — idempotent on the per-minute window). Captures
// a fresh StageSnapshot, then runs anomaly checks comparing to the prior
// snapshot. Alerts are returned in the response and logged; a future
// addition can wire this to Slack/email/PagerDuty.
//
// Vercel cron schedule (vercel.json):
//   { "path": "/api/cron/stage-snapshot", "schedule": "0 8 * * *" }
//
// Or call manually: curl -X POST https://app.example.com/api/cron/stage-snapshot

import { NextResponse } from "next/server";
import {
  captureStageSnapshot,
  detectStageDropAnomalies,
  detectEventSpikeAnomaly,
  type StageSnapshotAlert,
} from "@/lib/stage-snapshot";

export const dynamic = "force-dynamic";

export async function POST() {
  return run();
}

// Allow GET as well so the user can manually hit it from a browser to test.
export async function GET() {
  return run();
}

async function run() {
  const startedAt = new Date();
  try {
    const { rowsInserted } = await captureStageSnapshot(startedAt);

    const dropAlerts = await detectStageDropAnomalies();
    const spikeAlerts = await detectEventSpikeAnomaly();
    const alerts: StageSnapshotAlert[] = [...dropAlerts, ...spikeAlerts];

    if (alerts.length > 0) {
      // Loud structured log so any external log aggregator picks this up.
      for (const a of alerts) {
        console.error(
          JSON.stringify({
            level: "warn",
            event: "stage_snapshot_alert",
            kind: a.kind,
            requisitionId: a.requisitionId,
            stage: a.stage,
            message: a.message,
            details: a,
          }),
        );
      }
    } else {
      console.log(`[stage-snapshot] OK — captured=${rowsInserted} alerts=0`);
    }

    return NextResponse.json({
      ok: true,
      capturedAt: startedAt.toISOString(),
      rowsInserted,
      alerts,
    });
  } catch (err: any) {
    console.error("[stage-snapshot] FAILED:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
