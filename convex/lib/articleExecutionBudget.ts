"use node";

import { AsyncLocalStorage } from "node:async_hooks";

// Leave two minutes of the Node action's ten-minute window for checkpoint,
// settlement and scheduling. SDK transport retries must not own that window.
export const ARTICLE_EXECUTION_PROVIDER_BUDGET_MS = 8 * 60_000;
export const ARTICLE_PROVIDER_REQUEST_TIMEOUT_MS = 3 * 60_000;
const executionDeadline = new AsyncLocalStorage<number>();

export function withArticleExecutionBudget<T>(
  execute: () => Promise<T>,
  budgetMs = ARTICLE_EXECUTION_PROVIDER_BUDGET_MS,
): Promise<T> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error("Invalid article execution budget");
  }
  // Nested work cannot extend its parent's deadline; concurrent tenants have
  // independent contexts, not a process-global timer or mutable singleton.
  const deadline = Math.min(
    executionDeadline.getStore() ?? Infinity,
    Date.now() + budgetMs,
  );
  return executionDeadline.run(deadline, execute);
}

export const boundedArticleProviderFetch: typeof fetch = async (input, init) => {
  const remaining = Math.floor(Math.min(
    ARTICLE_PROVIDER_REQUEST_TIMEOUT_MS,
    (executionDeadline.getStore() ?? Infinity) - Date.now(),
  ));
  if (remaining <= 0) {
    throw new Error("Article provider request timed out: execution budget exhausted");
  }
  const signals = [AbortSignal.timeout(remaining)];
  if (init?.signal) signals.push(init.signal);
  if (input instanceof Request) signals.push(input.signal);
  // Keep the signal alive through response-body consumption, not merely until
  // headers arrive. Never use Promise.race to abandon a still-paid request.
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
};

export function articleProviderTransportOptions() {
  return {
    timeout: ARTICLE_PROVIDER_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    fetch: boundedArticleProviderFetch,
  };
}
