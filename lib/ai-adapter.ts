/**
 * Universal AI Adapter
 *
 * Supports two provider types:
 *  - "openai-compatible" — Works with OpenAI, Gemini, Groq, Together, Mistral, DeepSeek, Ollama, etc.
 *  - "anthropic"         — Claude's Messages API
 *
 * Provider config is read from the AiProvider DB table.
 * Falls back to OPENAI_API_KEY env var when no provider is specified (backward compat).
 */

import { prisma } from "@/lib/prisma";

// ─── Types ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
  provider: string;
}

interface ProviderConfig {
  name: string;
  provider: string; // "openai-compatible" | "anthropic"
  baseUrl: string;
  apiKey: string;
}

// ─── Provider Resolution ───────────────────────────────────────────

async function resolveProvider(providerId?: string): Promise<ProviderConfig> {
  // 1. Explicit provider ID
  if (providerId) {
    const p = await prisma.aiProvider.findUnique({ where: { id: providerId } });
    if (!p) throw new Error(`AI Provider not found: ${providerId}`);
    return { name: p.name, provider: p.provider, baseUrl: p.baseUrl, apiKey: p.apiKey };
  }

  // 2. Default provider (isDefault = true)
  const defaultProvider = await prisma.aiProvider.findFirst({ where: { isDefault: true } });
  if (defaultProvider) {
    return {
      name: defaultProvider.name,
      provider: defaultProvider.provider,
      baseUrl: defaultProvider.baseUrl,
      apiKey: defaultProvider.apiKey,
    };
  }

  // 3. Fallback: env var (backward compatibility)
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    return {
      name: "OpenAI (env)",
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: envKey,
    };
  }

  throw new Error(
    "No AI provider configured. Add one via Settings or set OPENAI_API_KEY env var."
  );
}

// ─── OpenAI-Compatible Request ─────────────────────────────────────

async function openaiCompatible(
  config: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  opts: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.max_tokens ?? 2000,
    }),
  });

  if (!response.ok) {
    const errData: any = await response.json().catch(() => ({}));
    const msg = errData.error?.message || `API error (${response.status})`;
    if (response.status === 401) throw new Error(`Invalid API key for ${config.name}.`);
    if (response.status === 429) throw new Error(`Rate limit exceeded for ${config.name}. Wait and retry.`);
    if (response.status === 402) throw new Error(`Insufficient credits for ${config.name}.`);
    throw new Error(`${config.name}: ${msg}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error(`No response from ${config.name}.`);

  return {
    content,
    usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    model: result.model || model,
    provider: config.name,
  };
}

// ─── Anthropic (Claude) Request ────────────────────────────────────

async function anthropicRequest(
  config: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  opts: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/messages`;

  // Separate system message from the rest
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  const body: any = {
    model,
    max_tokens: opts.max_tokens ?? 2000,
    messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemMsg) body.system = systemMsg.content;
  if (opts.temperature != null) body.temperature = opts.temperature;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errData: any = await response.json().catch(() => ({}));
    const msg = errData.error?.message || `API error (${response.status})`;
    if (response.status === 401) throw new Error(`Invalid API key for ${config.name}.`);
    if (response.status === 429) throw new Error(`Rate limit exceeded for ${config.name}. Wait and retry.`);
    throw new Error(`${config.name}: ${msg}`);
  }

  const result = await response.json();
  const content = result.content?.[0]?.text;
  if (!content) throw new Error(`No response from ${config.name}.`);

  return {
    content,
    usage: {
      prompt_tokens: result.usage?.input_tokens || 0,
      completion_tokens: result.usage?.output_tokens || 0,
      total_tokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
    },
    model: result.model || model,
    provider: config.name,
  };
}

// ─── OpenAI-Compatible Streaming ──────────────────────────────────

async function* openaiCompatibleStream(
  config: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  opts: ChatCompletionOptions
): AsyncGenerator<string> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens ?? 1000,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errData: any = await response.json().catch(() => ({}));
    const msg = errData.error?.message || `API error (${response.status})`;
    throw new Error(`${config.name}: ${msg}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        const chunk = JSON.parse(data);
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // malformed SSE chunk — skip
      }
    }
  }
}

// ─── Anthropic Streaming ───────────────────────────────────────────

async function* anthropicStream(
  config: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  opts: ChatCompletionOptions
): AsyncGenerator<string> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/messages`;

  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  const body: any = {
    model,
    max_tokens: opts.max_tokens ?? 1000,
    stream: true,
    messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemMsg) body.system = systemMsg.content;
  if (opts.temperature != null) body.temperature = opts.temperature;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errData: any = await response.json().catch(() => ({}));
    const msg = errData.error?.message || `API error (${response.status})`;
    throw new Error(`${config.name}: ${msg}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      try {
        const chunk = JSON.parse(data);
        if (chunk.type === "content_block_delta" && chunk.delta?.text) {
          yield chunk.delta.text;
        }
      } catch {
        // skip
      }
    }
  }
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Streaming chat completion — yields text chunks as they arrive.
 * Used exclusively by the candidate chat SSE endpoint.
 * Never writes chunks to DB — caller accumulates and saves the full response.
 */
export async function* streamChatCompletion(
  messages: ChatMessage[],
  model: string,
  opts: ChatCompletionOptions = {},
  providerId?: string
): AsyncGenerator<string> {
  const config = await resolveProvider(providerId);

  switch (config.provider) {
    case "anthropic":
      yield* anthropicStream(config, model, messages, opts);
      break;
    case "openai-compatible":
    default:
      yield* openaiCompatibleStream(config, model, messages, opts);
  }
}

export async function chatCompletion(
  messages: ChatMessage[],
  model: string,
  opts: ChatCompletionOptions = {},
  providerId?: string
): Promise<ChatCompletionResult> {
  const config = await resolveProvider(providerId);

  console.log(`[AI Adapter] Using provider "${config.name}" (${config.provider}), model: ${model}`);

  switch (config.provider) {
    case "anthropic":
      return anthropicRequest(config, model, messages, opts);
    case "openai-compatible":
    default:
      return openaiCompatible(config, model, messages, opts);
  }
}
