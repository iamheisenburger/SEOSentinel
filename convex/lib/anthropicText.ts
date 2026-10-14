/** Text from a Claude Messages response, whatever block order the model used.
 *
 * Claude Haiku 5.5 (and later models) think adaptively by default: a response
 * can start with a thinking block, so content[0] is not the answer. Thinking
 * also counts toward max_tokens, so a small limit can end the response before
 * any text. Both cases fail loudly here instead of returning an empty string. */
export function anthropicResponseText(response: {
  content: ReadonlyArray<{ type: string; text?: string }>;
  stop_reason?: string | null;
}): string {
  const text = response.content
    .flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
    .join("")
    .trim();
  if (text) return text;
  throw new Error(
    response.stop_reason === "max_tokens"
      ? "Claude reached its output limit before writing any text"
      : "Claude returned no text",
  );
}

/** Output allowance for a plain-text call. Adaptive thinking spends part of
 * max_tokens before the answer starts; only generated tokens are billed, so a
 * floor costs nothing on short answers and keeps small budgets from ending
 * the call mid-thought. */
export const PLAIN_TEXT_MIN_MAX_TOKENS = 4096;
export function plainTextMaxTokens(requested: number): number {
  return Math.max(PLAIN_TEXT_MIN_MAX_TOKENS, Math.floor(requested));
}
