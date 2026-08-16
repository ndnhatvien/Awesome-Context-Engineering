/**
 * Pricing Configuration
 *
 * Multi-provider token pricing for cost estimation.
 * Prices are in USD per 1M tokens.
 */

export type Provider = 'anthropic' | 'openai' | 'google';

export interface ModelPricing {
  model: string;
  provider: Provider;
  inputPer1M: number; // $ per 1M input tokens
  outputPer1M: number; // $ per 1M output tokens
}

/**
 * Static pricing table (updated as of Jan 2025)
 * Source: Provider pricing pages
 */
export const PRICING_TABLE: ModelPricing[] = [
  // Anthropic Claude
  { model: 'opus', provider: 'anthropic', inputPer1M: 15, outputPer1M: 75 },
  { model: 'claude-opus-3', provider: 'anthropic', inputPer1M: 15, outputPer1M: 75 },
  { model: 'sonnet', provider: 'anthropic', inputPer1M: 3, outputPer1M: 15 },
  { model: 'claude-sonnet-3.5', provider: 'anthropic', inputPer1M: 3, outputPer1M: 15 },
  { model: 'haiku', provider: 'anthropic', inputPer1M: 0.25, outputPer1M: 1.25 },
  { model: 'claude-haiku-3', provider: 'anthropic', inputPer1M: 0.25, outputPer1M: 1.25 },

  // OpenAI GPT
  { model: 'gpt-4o', provider: 'openai', inputPer1M: 2.5, outputPer1M: 10 },
  { model: 'gpt-4o-mini', provider: 'openai', inputPer1M: 0.15, outputPer1M: 0.6 },
  { model: 'gpt-4-turbo', provider: 'openai', inputPer1M: 10, outputPer1M: 30 },
  { model: 'gpt-4', provider: 'openai', inputPer1M: 30, outputPer1M: 60 },
  { model: 'gpt-3.5-turbo', provider: 'openai', inputPer1M: 0.5, outputPer1M: 1.5 },

  // Google Gemini
  { model: 'gemini-2.0-flash', provider: 'google', inputPer1M: 0.3, outputPer1M: 1.2 },
  { model: 'gemini-1.5-pro', provider: 'google', inputPer1M: 1.25, outputPer1M: 5 },
  { model: 'gemini-1.5-flash', provider: 'google', inputPer1M: 0.075, outputPer1M: 0.3 },
];

/**
 * Get pricing for a model
 *
 * @param model Model name (e.g., 'opus', 'gpt-4o', 'gemini-1.5-pro')
 * @returns Model pricing or null if not found
 */
export function getPricing(model: string): ModelPricing | null {
  const normalized = model.toLowerCase().trim();
  return PRICING_TABLE.find((p) => p.model === normalized) || null;
}

/**
 * Calculate cost for tokens
 *
 * @param tokens Number of tokens
 * @param type Token type (input or output)
 * @param model Model name
 * @returns Cost in USD
 */
export function calculateCost(tokens: number, type: 'input' | 'output', model: string): number {
  const pricing = getPricing(model);
  if (!pricing) return 0;

  const rate = type === 'input' ? pricing.inputPer1M : pricing.outputPer1M;
  return (tokens / 1_000_000) * rate;
}

/**
 * Format cost as currency string
 *
 * @param cost Cost in USD
 * @returns Formatted string (e.g., "$1.23")
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) return '$0.00';
  return `$${cost.toFixed(2)}`;
}

/**
 * Get all available models
 *
 * @returns Array of model names
 */
export function getAvailableModels(): string[] {
  return PRICING_TABLE.map((p) => p.model);
}

/**
 * Get models by provider
 *
 * @param provider Provider name
 * @returns Array of model names
 */
export function getModelsByProvider(provider: Provider): string[] {
  return PRICING_TABLE.filter((p) => p.provider === provider).map((p) => p.model);
}
