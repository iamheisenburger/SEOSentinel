/** Claude Haiku 5.5 bills a prompt above 100K tokens at five times its list
 * rates ($0.50/$2.50 per million tokens instead of $0.10/$0.50). Web research
 * with three searches crosses it (P150, Oct 21 2026), so its ceiling and its
 * receipt use the long-prompt rates; other models are billed flat. */
export const LONG_PROMPT_TOKENS = 100_000;
export const LONG_PROMPT_MULTIPLIER = 5;

export function promptRates(price: { model: string; inputMicroUsdPerToken: number; outputMicroUsdPerToken: number }, promptTokens: number) {
  const multiplier = /haiku-5-5/.test(price.model) && promptTokens > LONG_PROMPT_TOKENS ? LONG_PROMPT_MULTIPLIER : 1;
  return { input: price.inputMicroUsdPerToken * multiplier, output: price.outputMicroUsdPerToken * multiplier };
}
