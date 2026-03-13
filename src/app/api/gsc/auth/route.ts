import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GSC_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GSC OAuth not configured" }, { status: 500 });
  }

  const siteId = req.nextUrl.searchParams.get("siteId") || "";

  // State = CSRF token + siteId so callback knows which site to update
  const csrf = crypto.randomUUID();
  const state = siteId ? csrf + ":" + siteId : csrf;

  const callbackUrl = req.nextUrl.origin + "/api/gsc/callback";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/webmasters.readonly openid email",
    access_type: "offline",
    prompt: "consent", // Force consent to get refresh token
    state,
  });

  const response = NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params);
  response.cookies.set("gsc_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
