// Custom error classes for Unipile API responses
export class RateLimitError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number = 60000) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ServerError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ServerError";
    this.statusCode = statusCode;
  }
}

export class ClientError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ClientError";
    this.statusCode = statusCode;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * Extract LinkedIn public identifier from a URL.
 * e.g. "https://www.linkedin.com/in/johndoe?foo=bar" → "johndoe"
 */
export function extractIdentifier(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Match /in/{identifier} pattern
    const match = parsed.pathname.match(/^\/in\/([^\/\?]+)/);
    if (match && match[1]) {
      return match[1].replace(/\/$/, ""); // remove trailing slash
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch a LinkedIn profile via the Unipile REST API.
 *
 * @param unipileAccountId - The Unipile account_id (not our DB id)
 * @param identifier - LinkedIn public identifier (e.g., "satyanadella")
 * @param accountDsn - Per-account Unipile DSN (falls back to env)
 * @param accountApiKey - Per-account Unipile API key (falls back to env)
 * @returns Parsed profile JSON
 * @throws RateLimitError | ServerError | ClientError | NetworkError
 */
export async function fetchProfile(
  unipileAccountId: string,
  identifier: string,
  accountDsn?: string,
  accountApiKey?: string
): Promise<any> {
  const rawDsn = accountDsn || process.env.UNIPILE_DSN;
  const dsn = rawDsn && !rawDsn.startsWith("http") ? `https://${rawDsn}` : rawDsn;
  const apiKey = accountApiKey || process.env.UNIPILE_API_KEY;

  if (!dsn || !apiKey) {
    throw new Error("Unipile DSN and API key must be provided (via account or environment)");
  }

  const url = `${dsn}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(unipileAccountId)}&linkedin_sections=*`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      throw new RateLimitError(
        `Rate limited for account ${unipileAccountId}`,
        retryMs
      );
    }

    if (response.status >= 500) {
      const body = await response.text().catch(() => "Unknown server error");
      throw new ServerError(
        `Unipile server error: ${response.status} - ${body}`,
        response.status
      );
    }

    if (response.status >= 400) {
      const body = await response.text().catch(() => "Unknown client error");
      throw new ClientError(
        `Unipile client error: ${response.status} - ${body}`,
        response.status
      );
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    // Re-throw our custom errors
    if (
      error instanceof RateLimitError ||
      error instanceof ServerError ||
      error instanceof ClientError
    ) {
      throw error;
    }

    // Network/timeout errors
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      throw new NetworkError(`Request timed out for ${identifier}`);
    }

    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND" || error.cause) {
      throw new NetworkError(`Network error fetching ${identifier}: ${error.message}`);
    }

    // Unknown errors
    throw new NetworkError(`Unexpected error fetching ${identifier}: ${error.message}`);
  }
}
