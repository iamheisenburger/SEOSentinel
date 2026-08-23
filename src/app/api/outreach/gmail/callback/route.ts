import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOwnedSite } from "@/lib/owned-site";
import { verifyOAuthState } from "@/lib/oauth-state";
import {
  hasGmailSendScope,
  hasOnlyGmailOutboundScopes,
  normalizeMailDomain,
  secondaryGmailSenderIssues,
} from "@/lib/outreach-gmail";
import { verifyGoogleWorkspaceDns } from "@/lib/outreach-dns";
import { callPentraInternal } from "@/lib/pentra-internal-api";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export async function handleOutreachGmailCallback(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get("outreach_gmail_oauth_state")?.value;
  if (!code || !state || state !== storedState) {
    return page("Google authorization failed. Close this window and try again.", false, 400);
  }

  const { userId } = await auth();
  let verified: { siteId: string } | null = null;
  try {
    verified = userId
      ? verifyOAuthState(state, { provider: "gmail_outreach", userId })
      : null;
  } catch {
    verified = null;
  }
  if (!verified) return page("Authorization state is invalid or expired.", false, 400);
  const siteId = verified.siteId;
  const site = await getOwnedSite(siteId);
  if (!site) return page("Site not found.", false, 404);

  const clientId = process.env.OUTREACH_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.OUTREACH_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return page("Google OAuth is not configured.", false, 500);
  }
  const callbackUrl = `${req.nextUrl.origin}${req.nextUrl.pathname}`;
  let tokenData: TokenResponse;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) {
      return page("Google could not complete the mailbox connection.", false, 502);
    }
    tokenData = (await tokenResponse.json()) as TokenResponse;
  } catch {
    return page("Google could not complete the mailbox connection.", false, 502);
  }
  if (!tokenData.access_token) {
    return page("Google did not return a mailbox access token.", false, 400);
  }

  const scopes = tokenData.scope || "";
  if (!hasGmailSendScope(scopes)) {
    return page("Gmail send permission was not granted.", false, 403);
  }
  if (!hasOnlyGmailOutboundScopes(scopes)) {
    return page(
      "Google returned a legacy mailbox-read or unrelated permission. Revoke Pentra's Google access, then reconnect so the outreach mailbox grants send-only access.",
      false,
      403,
    );
  }

  let email = "";
  let emailVerified = false;
  try {
    const userInfo = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (userInfo.ok) {
      const payload = (await userInfo.json()) as {
        email?: string;
        email_verified?: boolean;
      };
      email = payload.email || "";
      emailVerified = payload.email_verified === true;
    }
  } catch {
    // The identity check below remains fail-closed.
  }
  if (!email || !emailVerified) {
    return page("Google did not verify the sending mailbox identity.", false, 403);
  }

  const senderIssues = secondaryGmailSenderIssues({
    siteDomain: site.domain,
    fromEmail: email,
  });
  if (senderIssues.length > 0) return page(senderIssues.join(" "), false, 409);

  const senderDomain = normalizeMailDomain(email.split("@")[1] || "");
  const dns = await verifyGoogleWorkspaceDns({ senderDomain, dkimSelector: "google" });
  try {
    const result = await callPentraInternal<{
      ready: boolean;
      inboundReady: boolean;
    }>(
      "/internal/oauth/outreach-gmail",
      {
        siteId,
        fromEmail: email,
        oauthAccessToken: tokenData.access_token,
        oauthRefreshToken: tokenData.refresh_token,
        oauthExpiresAt:
          typeof tokenData.expires_in === "number"
            ? Date.now() + tokenData.expires_in * 1_000
            : undefined,
        oauthScopes: scopes,
        senderDomain,
        dkimSelector: dns.dkimSelector,
        dnsCheckedAt: dns.checkedAt,
        spfVerified: dns.spf,
        dkimVerified: dns.dkim,
        dmarcVerified: dns.dmarc,
      },
    );
    const message = result.ready && result.inboundReady
      ? "Gmail connected. The inbox is ready in approval mode with signed inbound handling."
      : result.ready
        ? "Gmail connected in approval mode. Before any prospect message can be released, use Backlinks to send the fixed-recipient bounce-routing canary and wait for its signed hard-DSN receipt."
      : `Gmail connected, but sending remains blocked. ${
          dns.issues.length > 0
            ? dns.issues.join(" ")
            : "Add the sender name and physical mailing address in Pentra."
        }`;
    const response = page(
      message,
      true,
      200,
      result.ready && result.inboundReady,
    );
    response.cookies.delete("outreach_gmail_oauth_state");
    return response;
  } catch {
    return page("Pentra could not save the verified mailbox connection.", false, 502);
  }
}

export async function GET(req: NextRequest) {
  return handleOutreachGmailCallback(req);
}

function page(message: string, success: boolean, status: number, ready = false) {
  const color = success ? "#22c55e" : "#ef4444";
  const safeMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pentra Gmail</title></head><body style="margin:0;background:#090b10;color:#edeef1;font:15px system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;padding:32px;text-align:center"><div style="font-size:36px;color:${color}">${success ? "✓" : "×"}</div><h1>Outreach mailbox</h1><p style="line-height:1.6;color:#a7aabd">${safeMessage}</p><a href="/backlinks" style="color:#38bdf8">Return to Backlinks</a></main><script>try{window.opener?.postMessage({type:"pentra-outreach-oauth",success:${success},ready:${ready}},window.location.origin)}catch{}${success ? "setTimeout(()=>window.close(),1800)" : ""}</script></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
