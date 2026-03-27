import { NextResponse } from "next/server";
import { getAccountStats } from "@/lib/services/account.service";

export async function GET() {
  try {
    const accounts = await getAccountStats();
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("Error fetching account stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
