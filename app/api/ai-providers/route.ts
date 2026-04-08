import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ─── GET: List all providers (API keys masked) ─────────────────────

export async function GET() {
  try {
    const providers = await prisma.aiProvider.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      providers.map((p) => ({
        ...p,
        apiKey: p.apiKey.slice(0, 8) + "..." + p.apiKey.slice(-4),
        models: JSON.parse(p.models),
      }))
    );
  } catch (error) {
    console.error("Error listing AI providers:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST: Create a new provider ───────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.name || !body.provider || !body.baseUrl || !body.apiKey) {
      return NextResponse.json(
        { error: "Missing required fields: name, provider, baseUrl, apiKey" },
        { status: 400 }
      );
    }

    const models = body.models || [];
    if (!Array.isArray(models) || models.length === 0) {
      return NextResponse.json(
        { error: "At least one model name is required" },
        { status: 400 }
      );
    }

    // If this is set as default, unset other defaults
    if (body.isDefault) {
      await prisma.aiProvider.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const provider = await prisma.aiProvider.create({
      data: {
        name: body.name,
        provider: body.provider,
        baseUrl: body.baseUrl.replace(/\/+$/, ""),
        apiKey: body.apiKey,
        models: JSON.stringify(models),
        isDefault: body.isDefault || false,
      },
    });

    return NextResponse.json({
      ...provider,
      apiKey: provider.apiKey.slice(0, 8) + "..." + provider.apiKey.slice(-4),
      models: JSON.parse(provider.models),
    });
  } catch (error) {
    console.error("Error creating AI provider:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PUT: Update a provider ────────────────────────────────────────

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ error: "Missing provider id" }, { status: 400 });
    }

    const updateData: any = {};
    if (body.name != null) updateData.name = body.name;
    if (body.provider != null) updateData.provider = body.provider;
    if (body.baseUrl != null) updateData.baseUrl = body.baseUrl.replace(/\/+$/, "");
    if (body.apiKey != null) updateData.apiKey = body.apiKey;
    if (body.models != null) updateData.models = JSON.stringify(body.models);

    if (body.isDefault === true) {
      await prisma.aiProvider.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      updateData.isDefault = true;
    } else if (body.isDefault === false) {
      updateData.isDefault = false;
    }

    const provider = await prisma.aiProvider.update({
      where: { id: body.id },
      data: updateData,
    });

    return NextResponse.json({
      ...provider,
      apiKey: provider.apiKey.slice(0, 8) + "..." + provider.apiKey.slice(-4),
      models: JSON.parse(provider.models),
    });
  } catch (error) {
    console.error("Error updating AI provider:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE: Remove a provider ─────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing provider id" }, { status: 400 });
    }

    await prisma.aiProvider.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting AI provider:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
