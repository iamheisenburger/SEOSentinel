import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GSC_READONLY_SCOPE } from "@/lib/gsc-oauth";
import { getOwnedSite } from "@/lib/owned-site";
import { createOAuthState } from "@/lib/oauth-state";

export async function GET(req: NextRequest) {
  const clientId = process.env.GSC_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GSC OAuth not configured" }, { status: 500 });
  }

  const siteId = req.nextUrl.searchParams.get("siteId") || "";
  if (!siteId || !(await getOwnedSite(siteId))) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let state: string;
  try {
    state = createOAuthState({ provider: "gsc", siteId, userId });
  } catch {
    return NextResponse.json(
      { error: "GSC OAuth state signing is not configured" },
      { status: 500 },
    );
  }

  const callbackUrl = req.nextUrl.origin + "/api/gsc/callback";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: `${GSC_READONLY_SCOPE} openid email`,
    access_type: "offline",
    prompt: "consent", // Force consent to get refresh token
    include_granted_scopes: "true",
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
