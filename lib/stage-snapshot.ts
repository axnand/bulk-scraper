// ─── Stage snapshot + anomaly detection ──────────────────────────────────────
//
// P1 #34 / EC-12.5. Captures a (requisitionId, stage, count) snapshot per
// scheduled run, then compares the most recent two snapshots to detect
// large drops in any stage's count — the signature of a destructive
// migration, a runaway cron, or a mass-update gone wrong (the kind of
// incident the 2026-04-29 mass-stage-reset would have produced).
//
// Two checks per run:
//   1. Stage-count delta — alert when latest_count < (1 - threshold) * prev_count
//      for the same (requisitionId, stage) pair.
//   2. StageEvent insert spike by non-USER actor in the last 5 minutes vs the
//      24h rolling baseline — alert when the spike ratio is >= 3×.
//
// Output: alerts are returned to the caller. The cron route logs them; a
// future addition can wire to Slack / email / pagerduty.

import { prisma } from "@/lib/prisma";
import { CandidateStage } from "@prisma/client";

const DEFAULT_DROP_THRESHOLD = 0.05; // alert if stage drops by >5% day-over-day
const DEFAULT_EVENT_SPIKE_RATIO = 3; // alert if non-USER stage events 3× baseline

export interface StageSnapshotAlert {
  kind: "stage_drop" | "event_spike";
  requisitionId: string | null;
  stage: CandidateStage | null; // null on event_spike (overall)
  prevCount: number;
  currCount: number;
  dropPct?: number;
  baselineRate?: number;
  recentRate?: number;
  ratio?: number;
  message: string;
}

/**
 * Capture a fresh snapshot. Idempotent within the same `capturedAt` minute
 * thanks to the unique constraint — re-runs in the same window simply skip.
 */
export async function captureStageSnapshot(now: Date = new Date()): Promise<{ rowsInserted: number }> {
  // Truncate to whole minutes so re-runs in the same minute collapse via UNIQUE.
  const captured = new Date(Math.floor(now.getTime() / 60_000) * 60_000);

  // GROUP BY (requisitionId, stage). Job.requisitionId may be null for
  // legacy rows; preserve that as a real "null bucket".
  const rows: Array<{ requisitionId: string | null; stage: CandidateStage; c: number }> = await prisma.$queryRawUnsafe(`
    SELECT j."requisitionId" AS "requisitionId",
           t.stage           AS stage,
           COUNT(*)::int     AS c
    FROM   "Task" t
    JOIN   "Job"  j ON j.id = t."jobId"
    WHERE  t."deletedAt" IS NULL
    GROUP BY j."requisitionId", t.stage
  `);

  if (rows.length === 0) return { rowsInserted: 0 };

  // Insert with skipDuplicates so a re-run in the same minute is a no-op.
  const result = await prisma.stageSnapshot.createMany({
    data: rows.map(r => ({
      capturedAt: captured,
      requisitionId: r.requisitionId,
      stage: r.stage,
      count: r.c,
    })),
    skipDuplicates: true,
  });

  return { rowsInserted: result.count };
}

/**
 * Compare the most recent snapshot to the immediately prior one.
 * Returns alerts for any (requisitionId, stage) where the count dropped by
 * more than `threshold` (default 5%).
 */
export async function detectStageDropAnomalies(
  threshold: number = DEFAULT_DROP_THRESHOLD,
): Promise<StageSnapshotAlert[]> {
  // Latest two distinct capturedAt timestamps.
  const recent: Array<{ capturedAt: Date }> = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "capturedAt"
    FROM   "StageSnapshot"
    ORDER  BY "capturedAt" DESC
    LIMIT  2
  `);
  if (recent.length < 2) return []; // need at least one prior snapshot

  const [latestTs, prevTs] = recent;

  // Pull both windows. We compare same (requisitionId, stage) keys.
  const window: Array<{
    capturedAt: Date;
    requisitionId: string | null;
    stage: CandidateStage;
    count: number;
  }> = await prisma.$queryRawUnsafe(`
    SELECT "capturedAt", "requisitionId", "stage", "count"
    FROM   "StageSnapshot"
    WHERE  "capturedAt" IN ($1::timestamp, $2::timestamp)
  `, latestTs.capturedAt.toISOString(), prevTs.capturedAt.toISOString());

  // Build maps keyed by (requisitionId or '__null__') + ':' + stage
  const prevMap = new Map<string, number>();
  const currMap = new Map<string, number>();
  const allKeys = new Set<string>();
  function key(req: string | null, st: CandidateStage) {
    return `${req ?? "__null__"}:${st}`;
  }
  for (const row of window) {
    const k = key(row.requisitionId, row.stage);
    allKeys.add(k);
    if (row.capturedAt.getTime() === prevTs.capturedAt.getTime()) {
      prevMap.set(k, row.count);
    } else if (row.capturedAt.getTime() === latestTs.capturedAt.getTime()) {
      currMap.set(k, row.count);
    }
  }

  const alerts: StageSnapshotAlert[] = [];
  for (const k of allKeys) {
    const [reqRaw, stage] = k.split(":") as [string, CandidateStage];
    const requisitionId = reqRaw === "__null__" ? null : reqRaw;
    const prev = prevMap.get(k) ?? 0;
    const curr = currMap.get(k) ?? 0;

    if (prev === 0) continue; // can't compute %; first-time appearance

    const drop = (prev - curr) / prev;
    if (drop > threshold) {
      alerts.push({
        kind: "stage_drop",
        requisitionId,
        stage,
        prevCount: prev,
        currCount: curr,
        dropPct: drop,
        message: `Stage ${stage} count dropped ${(drop * 100).toFixed(1)}% (${prev} → ${curr})${requisitionId ? ` for requisition ${requisitionId}` : " (no requisition)"}`,
      });
    }
  }
  return alerts;
}

/**
 * Compare the StageEvent insert rate from non-USER actors over the last 5
 * minutes against the rolling 24h baseline. Alert when the recent rate is
 * `ratio`× the baseline (default 3×).
 */
export async function detectEventSpikeAnomaly(
  ratio: number = DEFAULT_EVENT_SPIKE_RATIO,
): Promise<StageSnapshotAlert[]> {
  const recent: Array<{ c: number }> = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS c
    FROM   "StageEvent"
    WHERE  actor <> 'USER'
      AND  "createdAt" > now() - interval '5 minutes'
  `);
  const baseline: Array<{ c: number }> = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS c
    FROM   "StageEvent"
    WHERE  actor <> 'USER'
      AND  "createdAt" > now() - interval '24 hours'
      AND  "createdAt" <= now() - interval '5 minutes'
  `);

  const recentCount = recent[0]?.c ?? 0;
  const baselineCount = baseline[0]?.c ?? 0;
  // Per-minute rates: 5 min recent window vs (24h - 5m) baseline window.
  const recentRate = recentCount / 5;
  const baselineRate = baselineCount / (24 * 60 - 5);

  // Avoid noisy alerts on cold start (no baseline).
  if (baselineCount < 50) return [];

  const observedRatio = baselineRate === 0 ? Infinity : recentRate / baselineRate;
  if (observedRatio < ratio) return [];

  return [
    {
      kind: "event_spike",
      requisitionId: null,
      stage: null,
      prevCount: baselineCount,
      currCount: recentCount,
      baselineRate,
      recentRate,
      ratio: observedRatio,
      message: `Non-USER StageEvent insert rate spiked ${observedRatio.toFixed(1)}× baseline (${recentRate.toFixed(2)}/min vs ${baselineRate.toFixed(2)}/min over last 24h)`,
    },
  ];
}
