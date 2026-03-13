import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

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

  const colonIdx = state.indexOf(":");
  const siteId = colonIdx > -1 ? state.substring(colonIdx + 1) : "";

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
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("GSC token exchange failed:", errText);
    return new NextResponse(renderPage("Failed to exchange authorization code.", false), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;

  if (!accessToken) {
    return new NextResponse(renderPage("Failed to get access token.", false), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Get user email
  let email = "";
  try {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userRes.ok) {
      const userData = await userRes.json();
      email = userData.email || "";
    }
  } catch { /* non-critical */ }

  // Auto-detect GSC property for this site
  let gscProperty = "";
  try {
    const sitesRes = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (sitesRes.ok) {
      const sitesData = await sitesRes.json();
      const entries = sitesData.siteEntry || [];

      // Try to find a matching property for the site's domain
      // We need the site domain from Convex — get it via the siteId
      let siteDomain = "";
      if (siteId) {
        try {
          const site = await convex.query(api.sites.get, { siteId: siteId as any });
          if (site) siteDomain = site.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
        } catch { /* non-critical */ }
      }

      if (siteDomain) {
        // Match domain property (sc-domain:) or URL-prefix property
        for (const entry of entries) {
          const url = (entry.siteUrl || "").toLowerCase();
          const cleanUrl = url.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
          if (cleanUrl === siteDomain) {
            gscProperty = entry.siteUrl;
            break;
          }
        }
      }

      // If no match, use the first available property
      if (!gscProperty && entries.length > 0) {
        gscProperty = entries[0].siteUrl || "";
      }
    }
  } catch (e) {
    console.error("Failed to list GSC properties:", e);
  }

  // Save tokens to Convex
  let saved = false;
  if (siteId) {
    try {
      await convex.mutation(api.sites.setGscToken, {
        siteId,
        gscAccessToken: accessToken,
        gscRefreshToken: refreshToken || undefined,
        gscProperty: gscProperty || undefined,
        gscEmail: email || undefined,
      });
      saved = true;
    } catch (e) {
      console.error("Failed to save GSC token to Convex:", e);
    }
  }

  const msg = saved
    ? `Connected to Google Search Console!${gscProperty ? ` Property: ${gscProperty}` : ""}`
    : "Connected! Close this window and refresh Settings.";

  const response = new NextResponse(renderPage(msg, true, email, saved), {
    headers: { "Content-Type": "text/html" },
  });
  response.cookies.delete("gsc_oauth_state");
  return response;
}

function renderPage(message: string, success: boolean, email?: string, autoSaved?: boolean): string {
  const icon = success ? "&#10003;" : "&#10007;";
  const color = success ? "#22C55E" : "#EF4444";
  const userLine = email ? `<p class="msg">Signed in as <strong style="color:#EDEEF1">${email}</strong></p>` : "";
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
<h2 style="color:${color}">${message}</h2>
${userLine}
<p class="msg">${subMsg}</p>
</div>${closeScript}</body></html>`;
}
