import { NextResponse } from "next/server";
import { getCreditBalance } from "@/lib/airscale";

export const dynamic = "force-dynamic";

export async function GET() {
  const credits = await getCreditBalance();
  return NextResponse.json({ credits });
}
