export type ArticleProviderFailureCategory =
  | "funding"
  | "authentication"
  | "authorization"
  | "model_configuration"
  | "invalid_request"
  | "transient"
  | "execution_invariant";

export type ArticleProviderFailure = {
  category: ArticleProviderFailureCategory;
  code: string;
  retryable: boolean;
  fallbackEligible: boolean;
  safeMessage: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function providerStatus(error: unknown): number | undefined {
  const outer = record(error);
  const nested = record(outer?.error);
  for (const value of [outer?.status, outer?.statusCode, nested?.status]) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return undefined;
}

function providerText(error: unknown): string {
  const outer = record(error);
  const nested = record(outer?.error);
  return [
    error instanceof Error ? error.message : String(error ?? ""),
    outer?.code,
    outer?.type,
    nested?.code,
    nested?.type,
    nested?.message,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim()
    .toLowerCase();
}

/**
 * Convert provider exceptions into a stable, non-secret execution decision.
 * Paid article work defaults terminal: only explicit transport, throttling,
 * and provider 5xx failures may replay. A primary provider's proven account
 * or model configuration failure may use an already-configured fallback in
 * the same reserved execution; ambiguous failures never fan out to a second
 * provider because the first call may already have consumed tokens.
 */
export function classifyArticleProviderFailure(
  error: unknown,
): ArticleProviderFailure {
  const status = providerStatus(error);
  const text = providerText(error);

  if (
    /credit balance is too low|insufficient (?:credit|balance|funds)|billing (?:limit|disabled|issue)|payment required|insufficient_quota|quota exceeded.*billing/.test(
      text,
    )
  ) {
    return {
      category: "funding",
      code: "article_provider_funding_unavailable",
      retryable: false,
      fallbackEligible: true,
      safeMessage: "The primary article provider has no available funded capacity.",
    };
  }
  if (
    status === 401 ||
    /invalid (?:api|x-api)[ -]?key|authentication failed|unauthorized|api key.*(?:invalid|missing)|anthropic_api_key not set|openai_api_key not set/.test(
      text,
    )
  ) {
    return {
      category: "authentication",
      code: "article_provider_authentication_failed",
      retryable: false,
      fallbackEligible: true,
      safeMessage: "The article provider rejected its configured credentials.",
    };
  }
  if (status === 403 || /permission denied|forbidden|not authorized/.test(text)) {
    return {
      category: "authorization",
      code: "article_provider_authorization_failed",
      retryable: false,
      fallbackEligible: true,
      safeMessage: "The article provider rejected the configured project authorization.",
    };
  }
  if (
    status === 404 ||
    /model (?:is )?(?:not found|unavailable|not supported|does not exist|retired)/.test(
      text,
    )
  ) {
    return {
      category: "model_configuration",
      code: "article_provider_model_unavailable",
      retryable: false,
      fallbackEligible: true,
      safeMessage: "The primary article model is unavailable for the configured project.",
    };
  }
  if (
    status === 429 ||
    (status !== undefined && status >= 500 && status <= 599) ||
    /\b(?:econnreset|econnrefused|etimedout|eai_again|enetwork)\b|socket hang up|fetch failed|network request failed|request timed out|request timeout|temporarily unavailable|service unavailable|gateway timeout|bad gateway|rate limit|overloaded/.test(
      text,
    )
  ) {
    return {
      category: "transient",
      code: "article_provider_transient_failure",
      retryable: true,
      fallbackEligible: false,
      safeMessage: "The article provider is temporarily unavailable.",
    };
  }
  if (status !== undefined && status >= 400 && status <= 499) {
    return {
      category: "invalid_request",
      code: "article_provider_request_rejected",
      retryable: false,
      fallbackEligible: false,
      safeMessage: "The article provider rejected the request contract.",
    };
  }
  return {
    category: "execution_invariant",
    code: "article_provider_execution_invariant",
    retryable: false,
    fallbackEligible: false,
    safeMessage: "Article provider execution failed without a safe replay condition.",
  };
}
