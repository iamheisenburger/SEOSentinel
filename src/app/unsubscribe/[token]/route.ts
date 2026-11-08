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
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090a;color:#f7f8f8;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;padding:24px}
  main{width:min(100%,460px);border:1px solid rgba(255,255,255,.08);border-radius:14px;background:#0f1011;padding:32px}
  .brand{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600;letter-spacing:-.015em}.mark{display:grid;place-items:center;width:20px;height:20px;border-radius:5.5px;background:#f7f8f8}.mark i{display:block;width:10px;height:1.5px;border-radius:1px;background:#08090a;box-shadow:0 -3.5px 0 #08090a,0 3.5px 0 #08090a}
  .eyebrow{margin:32px 0 10px;color:#8a8f98;font:400 12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}h1{font-size:28px;line-height:34px;font-weight:500;letter-spacing:-.022em;margin:0 0 10px}p{margin:0;color:#b4b8c0;font-size:15px;line-height:24px}form{margin-top:24px}button{width:100%;height:44px;border:0;border-radius:6px;background:#f7f8f8;color:#08090a;padding:0 18px;font:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:background-color .12s cubic-bezier(.16,1,.3,1)}button:hover{background:#fff}button:focus-visible{outline:2px solid #3da5f5;outline-offset:2px}.note{margin-top:20px;color:#8a8f98;font-size:13px;line-height:20px}
</style></head><body><main><div class="brand"><span class="mark" aria-hidden="true"><i></i></span><span>Pentra</span></div>${content}<p class="note">This preference applies immediately to Pentra authority outreach.</p></main></body></html>`;
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
