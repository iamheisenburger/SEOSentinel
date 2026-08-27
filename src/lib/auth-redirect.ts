const DEFAULT_AUTH_DESTINATION = "/dashboard";

const PAID_PLANS = new Set(["starter", "pro", "scale"]);
const BILLING_INTERVALS = new Set(["monthly", "annual"]);

function paidPlanDestination(
  plan: string | null,
  billing: string | null,
): string | null {
  if (!plan || !PAID_PLANS.has(plan)) return null;

  const params = new URLSearchParams({ plan });
  if (billing && BILLING_INTERVALS.has(billing)) {
    params.set("billing", billing);
  }

  return `/upgrade?${params.toString()}`;
}

/**
 * Return only a same-site path after authentication. Middleware writes a
 * relative path, but same-origin absolute URLs are accepted for old links
 * created before that boundary was tightened.
 */
export function safeAuthDestination(raw: string | null): string {
  if (!raw) return DEFAULT_AUTH_DESTINATION;

  try {
    const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(raw);
    const parsed = new URL(raw, "https://pentra.dev");

    if (isAbsolute && parsed.origin !== "https://pentra.dev") {
      return DEFAULT_AUTH_DESTINATION;
    }

    if (
      parsed.pathname.startsWith("/sign-in") ||
      parsed.pathname.startsWith("/sign-up")
    ) {
      return DEFAULT_AUTH_DESTINATION;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }
}

export function postAuthDestination({
  redirectUrl,
  plan,
  billing,
}: {
  redirectUrl: string | null;
  plan: string | null;
  billing: string | null;
}): string {
  return paidPlanDestination(plan, billing) ?? safeAuthDestination(redirectUrl);
}

export function authCounterpartUrl(
  route: "/sign-in" | "/sign-up",
  {
    redirectUrl,
    plan,
    billing,
  }: {
    redirectUrl: string | null;
    plan: string | null;
    billing: string | null;
  },
): string {
  const params = new URLSearchParams();

  if (redirectUrl) params.set("redirect_url", redirectUrl);
  if (plan && (plan === "free" || PAID_PLANS.has(plan))) {
    params.set("plan", plan);
  }
  if (billing && BILLING_INTERVALS.has(billing)) {
    params.set("billing", billing);
  }

  const query = params.toString();
  return query ? `${route}?${query}` : route;
}
