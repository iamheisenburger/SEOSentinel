import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  findMatchingGscProperty,
  hasGscGrowthScope,
  hasOnlyGscGrowthScopes,
} from "@/lib/gsc-oauth";
import { getOwnedSite } from "@/lib/owned-site";
import { verifyOAuthState } from "@/lib/oauth-state";
import { callPentraInternal } from "@/lib/pentra-internal-api";

const OAUTH_HTTP_TIMEOUT_MS = 15_000;

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
};

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get("gsc_oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return new NextResponse(renderPage("Authorization failed. Please close this window and try again.", false), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const { userId } = await auth();
  let verifiedState: { siteId: string } | null = null;
  try {
    verifiedState = userId
      ? verifyOAuthState(state, { provider: "gsc", userId })
      : null;
  } catch {
    verifiedState = null;
  }
  if (!verifiedState) {
    return new NextResponse(renderPage("Authorization state is invalid or expired.", false), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }
  const siteId = verifiedState.siteId;
  if (!(await getOwnedSite(siteId))) {
    return new NextResponse(renderPage("Site not found.", false), {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  const clientId = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;
  const callbackUrl = req.nextUrl.origin + "/api/gsc/callback";

  if (!clientId || !clientSecret) {
    return new NextResponse(renderPage("GSC OAuth not configured.", false), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Exchange code for tokens
  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
    });
  } catch {
    return new NextResponse(renderPage("Google authorization timed out. Please reconnect.", false), {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!tokenRes.ok) {
    console.error(`GSC token exchange failed with HTTP ${tokenRes.status}`);
    return new NextResponse(renderPage("Failed to exchange authorization code.", false), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;

  if (!accessToken) {
    return new NextResponse(renderPage("Failed to get access token.", false), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const grantedScopes = typeof tokenData.scope === "string" ? tokenData.scope : "";

  if (!hasGscGrowthScope(grantedScopes)) {
    return new NextResponse(
      renderPage(
        "Search Console growth permission was not granted. Reconnect and allow Pentra to read performance data and submit your sitemap.",
        false,
      ),
      { status: 403, headers: { "Content-Type": "text/html" } },
    );
  }
  if (!hasOnlyGscGrowthScopes(grantedScopes)) {
    return new NextResponse(
      renderPage(
        "Google returned permissions outside the dedicated Search Console scope. Revoke Pentra's Google access and reconnect Search Console.",
        false,
      ),
      { status: 403, headers: { "Content-Type": "text/html" } },
    );
  }

  // Get user email
  let email = "";
  try {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
    });
    if (userRes.ok) {
      const userData = await userRes.json();
      email = userData.email || "";
    }
  } catch { /* non-critical */ }

  // Match the exact GSC property for this Pentra site. Never attach an
  // unrelated first property from a multi-site Google account.
  let gscProperty = "";
  let siteDomain = "";
  if (siteId) {
    try {
      const site = await callPentraInternal<{ domain: string }>(
        "/internal/oauth/site",
        { siteId },
      );
      siteDomain = site.domain;
    } catch {
      console.error("Failed to load the tenant site for GSC matching");
    }
  }

  if (!siteDomain) {
    return new NextResponse(renderPage("Pentra could not identify the website for this connection.", false), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    const sitesRes = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
    });
    if (!sitesRes.ok) {
      console.error(`GSC property listing failed with HTTP ${sitesRes.status}`);
      return new NextResponse(
        renderPage("Pentra could not verify Search Console access. Reconnect and allow performance reading and sitemap submission.", false),
        { status: 403, headers: { "Content-Type": "text/html" } },
      );
    }

    const sitesData = await sitesRes.json();
    gscProperty = findMatchingGscProperty(sitesData.siteEntry || [], siteDomain) || "";
  } catch {
    console.error("Failed to list GSC properties");
    return new NextResponse(renderPage("Pentra could not load your Search Console properties.", false), {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!gscProperty) {
    return new NextResponse(
      renderPage(
        `No Search Console property matching ${siteDomain} was found. Verify that exact site in Search Console, then reconnect.`,
        false,
      ),
      { status: 404, headers: { "Content-Type": "text/html" } },
    );
  }

  // Save tokens to Convex
  let saved = false;
  if (siteId) {
    try {
      await callPentraInternal("/internal/oauth/gsc", {
        siteId,
        gscAccessToken: accessToken,
        gscRefreshToken: refreshToken || undefined,
        gscProperty,
        gscEmail: email || undefined,
        gscScopes: grantedScopes,
      });
      saved = true;
    } catch {
      console.error("Failed to save the GSC connection");
    }
  }

  if (!saved) {
    const response = new NextResponse(
      renderPage(
        "Pentra verified Search Console access but could not save the tenant connection. Please reconnect.",
        false,
      ),
      { status: 502, headers: { "Content-Type": "text/html" } },
    );
    response.cookies.delete("gsc_oauth_state");
    return response;
  }

  const response = new NextResponse(
    renderPage(
      `Connected to Google Search Console! Property: ${gscProperty}`,
      true,
      email,
      true,
    ),
    { headers: { "Content-Type": "text/html" } },
  );
  response.cookies.delete("gsc_oauth_state");
  return response;
}

function renderPage(message: string, success: boolean, email?: string, autoSaved?: boolean): string {
  const icon = success ? "&#10003;" : "&#10007;";
  const color = success ? "#22C55E" : "#EF4444";
  const safeMessage = escapeHtml(message);
  const userLine = email ? `<p class="msg">Signed in as <strong style="color:#EDEEF1">${escapeHtml(email)}</strong></p>` : "";
  const subMsg = success && autoSaved ? "This window will close automatically..." : success ? "Close this window and refresh the page." : "You can close this window.";
  const closeScript = success && autoSaved ? `<script>setTimeout(function() { window.close(); }, 1500);</script>` : "";

  return `<!DOCTYPE html>
<html><head><title>Pentra - Search Console</title>
<style>
body{background:#08090E;color:#EDEEF1;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{text-align:center;padding:2rem;border-radius:1rem;border:1px solid rgba(255,255,255,0.06);background:#0F1117;max-width:400px}
.icon{font-size:2rem;margin-bottom:0.75rem}
.msg{font-size:0.9rem;color:#8B8FA3;margin-top:0.5rem}
h2{font-size:1.1rem;margin:0}
</style></head>
<body><div class="card">
<div class="icon">${icon}</div>
<h2 style="color:${color}">${safeMessage}</h2>
${userLine}
<p class="msg">${subMsg}</p>
</div>${closeScript}</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
