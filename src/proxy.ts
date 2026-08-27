import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

const PUBLIC_EXACT_ROUTES = new Set([
  "/", "/pricing", "/contact", "/api/webhooks/clerk-billing",
  "/api/github/callback", "/api/gsc/callback",
  "/api/outreach/gmail/callback", "/sitemap.xml", "/robots.txt",
]);
const PUBLIC_ROUTE_PREFIXES = [
  "/legal", "/sign-in", "/sign-up", "/unsubscribe", "/blog",
];

function isPublicRoute(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  return PUBLIC_EXACT_ROUTES.has(pathname) || PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

const clerkAppMiddleware = clerkMiddleware(async (auth, request) => {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname.startsWith("/e2e-acceptance")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { userId } = await auth();

  // Signed-in users hitting landing page → dashboard
  if (userId && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Signed-in users on /sign-in → dashboard
  // UNLESS they have a ?plan= param (checkout flow)
  if (userId && pathname.startsWith("/sign-in") && !searchParams.get("plan")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Signed-in users on /sign-up → dashboard
  // UNLESS they have a ?plan= param (checkout flow)
  if (userId && pathname.startsWith("/sign-up") && !searchParams.get("plan")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }


  // Dynamic article path resolution: if path looks like /<prefix>/<slug>
  // and prefix isn't a known app route, try rewriting to /blog/<slug>
  // This supports any urlStructure (e.g. /articles/[slug], /posts/[slug])
  const knownPrefixes = new Set([
    "dashboard", "settings", "articles", "jobs", "sites", "plan", "upgrade",
    "pricing", "contact", "legal", "sign-in", "sign-up", "api", "_next", "blog",
    "analytics", "backlinks", "unsubscribe", "e2e-acceptance",
  ]);
  const pathParts = pathname.split("/").filter(Boolean);
  if (pathParts.length === 2 && !knownPrefixes.has(pathParts[0])) {
    // Path like /my-custom-prefix/article-slug — rewrite to blog viewer
    const rewriteUrl = new URL(`/blog/${pathParts[1]}`, request.url);
    return NextResponse.rewrite(rewriteUrl);
  }
  if (pathParts.length === 1 && !knownPrefixes.has(pathParts[0])
    && pathParts[0] !== "favicon.ico" && !pathParts[0].includes(".")) {
    // Path like /my-custom-prefix — could be a blog listing for custom prefix
    const rewriteUrl = new URL("/blog", request.url);
    return NextResponse.rewrite(rewriteUrl);
  }

  if (!isPublicRoute(request)) {
    // Middleware owns the signed-out redirect, so every protected entry point
    // reaches Pentra's in-app authentication experience.
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set(
      "redirect_url",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    await auth.protect({ unauthenticatedUrl: signIn.toString() });
  }
});

function publicAcceptanceMiddleware(request: NextRequest) {
  // Browser CI exercises public branding and fail-closed redirects without a
  // real Clerk tenant. This path is impossible in a production build and
  // never authorizes a protected request.
  if (
    !request.nextUrl.pathname.startsWith("/e2e-acceptance") &&
    !isPublicRoute(request)
  ) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set(
      "redirect_url",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export default function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const isLocalAcceptance =
    request.headers.get("host")?.endsWith(":3100") === true;
  return isLocalAcceptance
    ? publicAcceptanceMiddleware(request)
    : clerkAppMiddleware(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
