import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const notes = await prisma.note.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ notes });
  } catch (error) {
    console.error("[Notes] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const { body, authorEmail } = await req.json() as { body: string; authorEmail?: string };

    if (!body?.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const note = await prisma.note.create({
      data: {
        taskId,
        body: body.trim(),
        authorEmail: authorEmail ?? "",
      },
    });

    // --- Auto Detection Logic ---
    const text = body.trim();
    const emailMatch = text.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/);
    const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    const salaryMatch = text.match(/(?:\₹|INR|Rs\.?)\s*[\d,]+(?:\.\d+)?(?:k|lakhs?|lpa|cr)?(?:\/month|\/yr)?|\b\d+(?:\.\d+)?\s*(?:lpa|k|cpa|lakh|crore)\b/i);

    const extractedEmail = emailMatch ? emailMatch[0] : null;
    const extractedPhone = phoneMatch ? phoneMatch[0] : null;
    const extractedSalary = salaryMatch ? salaryMatch[0] : null;

    if (extractedEmail || extractedPhone || extractedSalary) {
      const updateData: any = {};
      if (extractedEmail) updateData.email = extractedEmail;
      if (extractedPhone) updateData.phone = extractedPhone;
      if (extractedSalary) updateData.salary = extractedSalary;

      await prisma.candidateContact.upsert({
        where: { taskId },
        create: {
          taskId,
          ...updateData,
          source: "MANUAL",
        },
        update: {
          ...updateData,
        },
      });
    }
    // -----------------------------

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("[Notes] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
