import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GitHub OAuth not configured" }, { status: 500 });
  }

  const siteId = req.nextUrl.searchParams.get("siteId") || "";

  // State = CSRF token + siteId so callback knows which site to update
  const csrf = crypto.randomUUID();
  const state = siteId ? csrf + ":" + siteId : csrf;

  const callbackUrl = req.nextUrl.origin + "/api/github/callback";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: "repo",
    state,
  });

  const response = NextResponse.redirect("https://github.com/login/oauth/authorize?" + params);
  response.cookies.set("github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
