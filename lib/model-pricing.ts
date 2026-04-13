/**
 * Model Pricing Table
 *
 * Prices are in USD per 1,000,000 tokens (input / output).
 * Last updated: April 2025. Always verify at each provider's pricing page
 * before billing decisions — prices change frequently.
 *
 * Models not listed here will show "pricing unknown" in the UI.
 */

export interface ModelPricing {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ── OpenAI ──────────────────────────────────────────────────────
  "gpt-4.1":             { input: 2.00,  output: 8.00  },
  "gpt-4.1-mini":        { input: 0.40,  output: 1.60  },
  "gpt-4o":              { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":         { input: 0.15,  output: 0.60  },
  "o4-mini":             { input: 1.10,  output: 4.40  },
  "o3-mini":             { input: 1.10,  output: 4.40  },
  "o3":                  { input: 10.00, output: 40.00 },

  // ── Anthropic Claude ────────────────────────────────────────────
  "claude-opus-4-6":              { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6":            { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5-20251001":    { input: 0.80,  output: 4.00  },
  // Legacy Claude 3.x (still used via Bedrock etc.)
  "claude-3-5-sonnet-20241022":   { input: 3.00,  output: 15.00 },
  "claude-3-5-haiku-20241022":    { input: 0.80,  output: 4.00  },
  "claude-3-opus-20240229":       { input: 15.00, output: 75.00 },
  "claude-3-haiku-20240307":      { input: 0.25,  output: 1.25  },

  // ── Google Gemini ───────────────────────────────────────────────
  "gemini-2.5-pro-preview-03-25":   { input: 1.25,  output: 10.00 },
  "gemini-2.5-flash-preview-04-17": { input: 0.075, output: 0.30  },
  "gemini-2.0-flash":               { input: 0.10,  output: 0.40  },
  "gemini-1.5-pro":                 { input: 1.25,  output: 5.00  },
  "gemini-1.5-flash":               { input: 0.075, output: 0.30  },

  // ── Groq ────────────────────────────────────────────────────────
  "llama-3.3-70b-versatile":  { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant":     { input: 0.05, output: 0.08 },
  "gemma2-9b-it":             { input: 0.20, output: 0.20 },

  // ── Mistral ─────────────────────────────────────────────────────
  "mistral-large-latest":   { input: 2.00, output: 6.00 },
  "mistral-small-latest":   { input: 0.20, output: 0.60 },
  "open-mixtral-8x22b":     { input: 2.00, output: 6.00 },
  "open-mixtral-8x7b":      { input: 0.70, output: 0.70 },

  // ── DeepSeek ────────────────────────────────────────────────────
  "deepseek-chat":      { input: 0.27, output: 1.10 },
  "deepseek-reasoner":  { input: 0.55, output: 2.19 },

  // ── Together AI ─────────────────────────────────────────────────
  "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo": { input: 0.88, output: 0.88 },
  "mistralai/Mixtral-8x7B-Instruct-v0.1":         { input: 0.60, output: 0.60 },

  // ── AWS Bedrock ─────────────────────────────────────────────────
  "anthropic.claude-3-5-sonnet-20241022-v2:0": { input: 3.00,  output: 15.00 },
  "anthropic.claude-3-5-haiku-20241022-v1:0":  { input: 0.80,  output: 4.00  },
  "meta.llama3-70b-instruct-v1:0":             { input: 0.99,  output: 0.99  },
  "mistral.mistral-large-2402-v1:0":           { input: 4.00,  output: 12.00 },
  "amazon.nova-pro-v1:0":                      { input: 0.80,  output: 3.20  },
  "amazon.nova-lite-v1:0":                     { input: 0.06,  output: 0.24  },
  "amazon.nova-micro-v1:0":                    { input: 0.035, output: 0.14  },
};

/**
 * Estimate API cost for a single call.
 * Returns null when the model has no known pricing.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): { inputCost: number; outputCost: number; totalCost: number } | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const inputCost  = (inputTokens  / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

/** Format a dollar amount to a readable string, auto-scaling precision. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  if (usd < 1)      return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
