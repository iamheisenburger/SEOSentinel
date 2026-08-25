const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function responseHeaders(contentType: string): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function confirmationPage(): Response {
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>Email preferences</title><p>Confirm that you no longer want these emails.</p><form method=post><button type=submit>Unsubscribe</button></form>",
    {
      status: 200,
      headers: responseHeaders("text/html; charset=utf-8"),
    },
  );
}

function settlementPage(recorded: boolean): Response {
  return new Response(
    recorded
      ? "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>Email preferences</title><p>Your email preference has been recorded.</p>"
      : "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>Email preferences</title><p>We could not record your preference yet. Please try again.</p>",
    {
      status: recorded ? 200 : 503,
      headers: responseHeaders("text/html; charset=utf-8"),
    },
  );
}

export async function GET(): Promise<Response> {
  // Link scanners and previews must never mutate suppression state.
  return confirmationPage();
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const convexSiteUrl = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  let recorded = false;
  if (
    TOKEN.test(token) &&
    convexSiteUrl &&
    /^https:\/\/[a-z0-9.-]+\.convex\.site$/i.test(convexSiteUrl)
  ) {
    try {
      const response = await fetch(`${convexSiteUrl}/unsubscribe/${token}`, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      recorded = response.ok;
    } catch {
      // Keep the public response enumeration-safe. The user can submit again;
      // the Convex endpoint is idempotent and stores no raw token.
    }
  }
  return settlementPage(recorded);
}
