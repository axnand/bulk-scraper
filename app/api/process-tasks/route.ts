import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Processing is handled by the persistent worker service (worker.ts) via pg-boss.
// This endpoint is kept as a no-op stub so any stale references don't 404.
export async function POST() {
  return NextResponse.json({ message: "Processing is handled by the worker service" });
}
