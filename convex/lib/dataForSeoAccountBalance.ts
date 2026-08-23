"use node";

/**
 * Fail-closed funding check for DataForSEO-backed work.
 *
 * DataForSEO documents GET /v3/appendix/user_data as free and exposes the
 * account's remaining USD balance at tasks[0].result[0].money.balance:
 * https://docs.dataforseo.com/v3/appendix-user-data/
 *
 * This is deliberately separate from Pentra's atomic reservation ledger. The
 * ledger limits what Pentra may attempt; this check only proves that the
 * provider reported enough money immediately before an execution. It cannot
 * eliminate the provider-side TOCTOU window, so paid endpoints must still
 * handle HTTP 402 and other provider failures without claiming funds were
 * guaranteed.
 */

export const DATAFORSEO_USER_DATA_ENDPOINT =
  "https://api.dataforseo.com/v3/appendix/user_data";
export const DATAFORSEO_BALANCE_PREFLIGHT_TIMEOUT_MS = 5_000;

export type DataForSeoBalanceFailureCode =
  | "credentials_missing"
  | "timeout"
  | "network_error"
  | "http_error"
  | "provider_error"
  | "invalid_response"
  | "insufficient_balance";

export class DataForSeoBalancePreflightError extends Error {
  readonly code: DataForSeoBalanceFailureCode;

  constructor(code: DataForSeoBalanceFailureCode) {
    super(`DataForSEO account balance preflight failed (${code})`);
    this.name = "DataForSeoBalancePreflightError";
    this.code = code;
  }
}

export function isDataForSeoBalancePreflightError(
  error: unknown,
): error is DataForSeoBalancePreflightError {
  return error instanceof DataForSeoBalancePreflightError;
}

type BalanceResponse = {
  status_code?: unknown;
  tasks?: Array<{
    status_code?: unknown;
    result?: Array<{
      money?: { balance?: unknown };
    }>;
  }>;
};

export function parseDataForSeoBalanceMicroUsd(payload: unknown): number {
  if (!payload || typeof payload !== "object") {
    throw new DataForSeoBalancePreflightError("invalid_response");
  }
  const response = payload as BalanceResponse;
  if (response.status_code !== 20_000) {
    throw new DataForSeoBalancePreflightError("provider_error");
  }
  const task = response.tasks?.[0];
  if (!task || task.status_code !== 20_000) {
    throw new DataForSeoBalancePreflightError("provider_error");
  }
  const balance = task.result?.[0]?.money?.balance;
  if (typeof balance !== "number" || !Number.isFinite(balance)) {
    throw new DataForSeoBalancePreflightError("invalid_response");
  }
  // Floor rather than round: a fractional micro-dollar must never be treated
  // as provider money that is actually available.
  return Math.floor(balance * 1_000_000);
}

type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export async function assertDataForSeoAccountBalance(
  requiredMicroUsd: number,
  options: {
    fetch?: FetchLike;
    login?: string;
    password?: string;
    timeoutMs?: number;
  } = {},
): Promise<{ availableMicroUsd: number; requiredMicroUsd: number }> {
  if (!Number.isSafeInteger(requiredMicroUsd) || requiredMicroUsd <= 0) {
    throw new Error("DataForSEO balance requirement must be a positive integer");
  }
  const login = options.login ?? process.env.DATAFORSEO_LOGIN;
  const password = options.password ?? process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new DataForSeoBalancePreflightError("credentials_missing");
  }
  const request = options.fetch ?? fetch;
  const timeoutMs = Math.max(
    1,
    Math.min(
      options.timeoutMs ?? DATAFORSEO_BALANCE_PREFLIGHT_TIMEOUT_MS,
      DATAFORSEO_BALANCE_PREFLIGHT_TIMEOUT_MS,
    ),
  );
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await request(DATAFORSEO_USER_DATA_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
    throw new DataForSeoBalancePreflightError(
      name === "AbortError" || name === "TimeoutError"
        ? "timeout"
        : "network_error",
    );
  }
  if (!response.ok) {
    // Never read or relay the response body: it can contain account-specific
    // diagnostics. HTTP status is intentionally collapsed to a stable code.
    throw new DataForSeoBalancePreflightError("http_error");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DataForSeoBalancePreflightError("invalid_response");
  }
  const availableMicroUsd = parseDataForSeoBalanceMicroUsd(payload);
  if (availableMicroUsd < requiredMicroUsd) {
    throw new DataForSeoBalancePreflightError("insufficient_balance");
  }
  return { availableMicroUsd, requiredMicroUsd };
}
