import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/test
 * Tests Unipile API connectivity with the provided credentials.
 * Body: { dsn, apiKey, accountId }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dsn, apiKey, accountId } = body;

    if (!dsn || !apiKey || !accountId) {
      return NextResponse.json(
        { error: "dsn, apiKey, and accountId are required." },
        { status: 400 }
      );
    }

    // Make a lightweight test call to Unipile API
    // We'll use the /api/v1/accounts endpoint to just verify connectivity
    const normalizedDsn = dsn.startsWith("http") ? dsn : `https://${dsn}`;
    const testUrl = `${normalizedDsn}/api/v1/accounts/${encodeURIComponent(accountId)}`;

    const response = await fetch(testUrl, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({
        success: false,
        error: "Invalid API key — authentication failed.",
        statusCode: response.status,
      });
    }

    if (response.status >= 500) {
      return NextResponse.json({
        success: false,
        error: `Unipile server error (${response.status}). The service may be down.`,
        statusCode: response.status,
      });
    }

    if (response.status === 404) {
      return NextResponse.json({
        success: false,
        error: "Account ID not found on this Unipile instance. Check your Account ID and DSN.",
        statusCode: response.status,
      });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return NextResponse.json({
        success: false,
        error: `Unexpected response (${response.status}): ${errorText.slice(0, 200)}`,
        statusCode: response.status,
      });
    }

    // Success — connection is valid
    const data = await response.json().catch(() => null);
    return NextResponse.json({
      success: true,
      message: "Connection successful! Credentials are valid.",
      accountInfo: data ? {
        provider: data.provider || "linkedin",
        status: data.status || "unknown",
      } : undefined,
    });
  } catch (error: any) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return NextResponse.json({
        success: false,
        error: "Connection timed out. Check your DSN endpoint.",
      });
    }

    return NextResponse.json({
      success: false,
      error: `Connection failed: ${error.message}`,
    });
  }
}
