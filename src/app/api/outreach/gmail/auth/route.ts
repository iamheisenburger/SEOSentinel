import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOwnedSite } from "@/lib/owned-site";
import { createOAuthState } from "@/lib/oauth-state";
import {
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
} from "@/lib/outreach-gmail";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const siteId = req.nextUrl.searchParams.get("siteId") || "";
  if (!siteId || !(await getOwnedSite(siteId))) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  const clientId = process.env.OUTREACH_GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Outreach Google OAuth is not configured" }, { status: 500 });
  }

  let state: string;
  try {
    state = createOAuthState({ provider: "gmail_outreach", siteId, userId });
  } catch {
    return NextResponse.json({ error: "Google OAuth state signing is not configured" }, { status: 500 });
  }

  // Outreach uses a distinct Google client and redirect so its Gmail scopes
  // token can never inherit Search Console permissions (or vice versa).
  const callbackUrl = `${req.nextUrl.origin}/api/outreach/gmail/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: `${GMAIL_SEND_SCOPE} ${GMAIL_READONLY_SCOPE} openid email`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  );
  response.cookies.set("outreach_gmail_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
