import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOwnedSite } from "@/lib/owned-site";
import { createOAuthState } from "@/lib/oauth-state";

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GitHub OAuth not configured" }, { status: 500 });
  }

  const siteId = req.nextUrl.searchParams.get("siteId") || "";
  if (!siteId || !(await getOwnedSite(siteId))) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // State is authenticated and binds the provider, owner, site, nonce and
  // expiry. The HttpOnly cookie additionally correlates this browser flow.
  let state: string;
  try {
    state = createOAuthState({ provider: "github", siteId, userId });
  } catch {
    return NextResponse.json(
      { error: "GitHub OAuth state signing is not configured" },
      { status: 500 },
    );
  }

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
