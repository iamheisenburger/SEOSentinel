import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get("github_oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return new NextResponse(renderPage("Authorization failed. Please close this window and try again.", false), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const colonIdx = state.indexOf(":");
  const siteId = colonIdx > -1 ? state.substring(colonIdx + 1) : "";

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new NextResponse(renderPage("GitHub OAuth not configured.", false), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  if (!tokenRes.ok) {
    return new NextResponse(renderPage("Failed to exchange authorization code.", false), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    return new NextResponse(renderPage(tokenData.error_description || "Failed to get access token.", false), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  let githubUsername = "";
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
    });
    if (userRes.ok) {
      const userData = await userRes.json();
      githubUsername = userData.login || "";
    }
  } catch { /* non-critical */ }

  let saved = false;
  if (siteId) {
    try {
      await convex.mutation(api.sites.setGithubToken, { siteId, githubToken: accessToken });
      saved = true;
    } catch (e) {
      console.error("Failed to save GitHub token to Convex:", e);
    }
  }

  const msg = saved ? "Connected to GitHub!" : "Connected to GitHub! You can close this window.";

  const response = new NextResponse(renderPage(msg, true, githubUsername, saved), {
    headers: { "Content-Type": "text/html" },
  });
  response.cookies.delete("github_oauth_state");
  return response;
}

function renderPage(message: string, success: boolean, username?: string, autoSaved?: boolean): string {
  const icon = success ? "&#10003;" : "&#10007;";
  const color = success ? "#22C55E" : "#EF4444";
  const userLine = username ? `<p class="msg">Signed in as <strong style="color:#EDEEF1">@${username}</strong></p>` : "";
  const subMsg = success && autoSaved ? "This window will close automatically..." : success ? "Close this window and refresh the page." : "You can close this window.";
  const closeScript = success && autoSaved ? `<script>setTimeout(function() { window.close(); }, 1500);</script>` : "";

  return `<!DOCTYPE html>
<html><head><title>Pentra - GitHub</title>
<style>
body{background:#08090E;color:#EDEEF1;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{text-align:center;padding:2rem;border-radius:1rem;border:1px solid rgba(255,255,255,0.06);background:#0F1117;max-width:360px}
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