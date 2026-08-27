const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function responseHeaders(contentType: string): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
}

function brandedPage(content: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email preferences · Pentra</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090e;color:#edeef1;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
  body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 20% 0%,rgba(14,165,233,.12),transparent 38%),radial-gradient(circle at 90% 100%,rgba(34,211,238,.07),transparent 36%)}
  main{position:relative;width:min(100%,480px);border:1px solid rgba(255,255,255,.08);border-radius:20px;background:rgba(15,17,23,.94);padding:32px;box-shadow:0 30px 80px rgba(0,0,0,.4)}
  .brand{display:flex;align-items:center;gap:11px;font-size:18px;font-weight:750}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;border:1px solid rgba(14,165,233,.24);background:rgba(14,165,233,.1);color:#38bdf8;font-size:20px}
  .eyebrow{margin:30px 0 8px;color:#38bdf8;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;letter-spacing:-.035em;margin:0 0 10px}p{margin:0;color:#8b8fa3;font-size:14px;line-height:1.7}form{margin-top:24px}button{width:100%;border:0;border-radius:11px;background:#0ea5e9;color:white;padding:13px 18px;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:2px solid #7dd3fc;outline-offset:3px}.note{margin-top:18px;color:#565a6e;font-size:11px}
</style></head><body><main><div class="brand"><span class="mark" aria-hidden="true">◎</span><span>Pentra</span></div>${content}<p class="note">This preference applies immediately to Pentra authority outreach.</p></main></body></html>`;
}

function confirmationPage(): Response {
  return new Response(
    brandedPage('<p class="eyebrow">Email preferences</p><h1>Stop outreach emails</h1><p>Confirm that you no longer want authority outreach from this sender.</p><form method="post"><button type="submit">Unsubscribe</button></form>'),
    {
      status: 200,
      headers: responseHeaders("text/html; charset=utf-8"),
    },
  );
}

function settlementPage(recorded: boolean): Response {
  return new Response(
    brandedPage(recorded
      ? '<p class="eyebrow">Email preferences</p><h1>You are unsubscribed</h1><p>Your preference has been recorded. Pentra will suppress future outreach to this address.</p>'
      : '<p class="eyebrow">Email preferences</p><h1>We could not save that yet</h1><p>No new permission was granted. Please try again in a moment.</p><form method="post"><button type="submit">Try again</button></form>'),
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
