/**
 * Token Counter
 *
 * Simple token counting using character-based approximation.
 * For production use, integrate tiktoken for accurate token counting.
 */

/**
 * Estimate token count using character-based approximation
 * Rule of thumb: ~4 characters per token for English text
 *
 * @param text Text to count tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // More accurate estimation considering:
  // - Spaces, punctuation (lighter weight)
  // - Code has different tokenization patterns
  const chars = text.length;
  
  // Detect if text is mostly code (has many special chars)
  const specialChars = (text.match(/[{}()[\];,.<>]/g) || []).length;
  const isCode = specialChars / chars > 0.05;
  
  // Code typically has more tokens per character due to symbols
  const charsPerToken = isCode ? 3.5 : 4;

  return Math.ceil(chars / charsPerToken);
}

/**
 * Count tokens in multiple text segments
 *
 * @param texts Array of text segments
 * @returns Total estimated token count
 */
export function estimateTokensMultiple(texts: string[]): number {
  return texts.reduce((sum, text) => sum + estimateTokens(text), 0);
}

/**
 * Calculate token savings percentage
 *
 * @param baseline Original token count
 * @param actual Compressed token count
 * @returns Savings percentage (0-100)
 */
export function calculateSavingsPercentage(baseline: number, actual: number): number {
  if (baseline === 0) return 0;
  return Math.round(((baseline - actual) / baseline) * 100);
}
