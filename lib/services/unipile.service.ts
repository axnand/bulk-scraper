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
  const startTime = Date.now(); // Start time logging

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

    const duration = Date.now() - startTime; // Calculate duration
    console.log(`Unipile fetchProfile took ${duration}ms`); // Log duration

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
      throw new ServerError(`Unipile server error: ${response.status} - ${body}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error during Unipile fetchProfile: ${error.message}`);
    throw error;
  }
}

function resolveDsnAndKey(accountDsn?: string, accountApiKey?: string) {
  const rawDsn = accountDsn || process.env.UNIPILE_DSN;
  const dsn = rawDsn && !rawDsn.startsWith("http") ? `https://${rawDsn}` : rawDsn;
  const apiKey = accountApiKey || process.env.UNIPILE_API_KEY;
  if (!dsn || !apiKey) {
    throw new Error("Unipile DSN and API key must be provided (via account or environment)");
  }
  return { dsn, apiKey };
}

async function postJson<T>(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<T> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      throw new RateLimitError("Rate limited by Unipile", retryMs);
    }

    if (response.status >= 500) {
      const text = await response.text().catch(() => "Unknown server error");
      throw new ServerError(`Unipile server error: ${response.status} - ${text}`, response.status);
    }

    if (response.status >= 400) {
      const text = await response.text().catch(() => "Unknown client error");
      throw new ClientError(`Unipile client error: ${response.status} - ${text}`, response.status);
    }

    return (await response.json()) as T;
  } catch (error: any) {
    if (
      error instanceof RateLimitError ||
      error instanceof ServerError ||
      error instanceof ClientError
    ) {
      throw error;
    }
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      throw new NetworkError("Request to Unipile timed out");
    }
    throw new NetworkError(`Network error calling Unipile: ${error.message}`);
  }
}

/**
 * Send a LinkedIn connection invitation.
 * Unipile: POST /api/v1/users/invite
 */
export async function sendInvitation(params: {
  accountId: string;
  providerUserId: string;
  message?: string;
  accountDsn?: string;
  accountApiKey?: string;
}): Promise<{ invitationId: string }> {
  const { dsn, apiKey } = resolveDsnAndKey(params.accountDsn, params.accountApiKey);
  const res = await postJson<{ invitation_id?: string; id?: string }>(
    `${dsn}/api/v1/users/invite`,
    apiKey,
    {
      account_id: params.accountId,
      provider_id: params.providerUserId,
      ...(params.message ? { message: params.message } : {}),
    },
  );
  return { invitationId: res.invitation_id || res.id || "" };
}

/**
 * Start a new chat with the first message.
 * Unipile: POST /api/v1/chats
 */
export async function startChat(params: {
  accountId: string;
  providerUserId: string;
  text: string;
  accountDsn?: string;
  accountApiKey?: string;
}): Promise<{ chatId: string; messageId: string }> {
  const { dsn, apiKey } = resolveDsnAndKey(params.accountDsn, params.accountApiKey);
  const res = await postJson<{
    chat_id?: string;
    id?: string;
    message_id?: string;
  }>(`${dsn}/api/v1/chats`, apiKey, {
    account_id: params.accountId,
    attendees_ids: [params.providerUserId],
    text: params.text,
  });
  return {
    chatId: res.chat_id || res.id || "",
    messageId: res.message_id || "",
  };
}

/**
 * Send a follow-up message in an existing chat.
 * Unipile: POST /api/v1/chats/{chatId}/messages
 */
export async function sendChatMessage(params: {
  accountId: string;
  chatId: string;
  text: string;
  accountDsn?: string;
  accountApiKey?: string;
}): Promise<{ messageId: string }> {
  const { dsn, apiKey } = resolveDsnAndKey(params.accountDsn, params.accountApiKey);
  const res = await postJson<{ id?: string; message_id?: string }>(
    `${dsn}/api/v1/chats/${encodeURIComponent(params.chatId)}/messages`,
    apiKey,
    {
      account_id: params.accountId,
      text: params.text,
    },
  );
  return { messageId: res.message_id || res.id || "" };
}
