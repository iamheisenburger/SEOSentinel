import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

const PUBLIC_EXACT_ROUTES = new Set([
  "/", "/pricing", "/contact", "/beta", "/method", "/start", "/x-reply", "/api/webhooks/clerk-billing", "/api/check",
  "/api/github/callback", "/api/gsc/callback",
  "/api/outreach/gmail/callback", "/sitemap.xml", "/robots.txt",
  // P400: Pentra's backend calls this with a single-use render ticket that Convex checks (no session).
  "/api/video-render",
]);
const PUBLIC_ROUTE_PREFIXES = [
  "/legal", "/sign-in", "/sign-up", "/unsubscribe", "/blog", "/check", "/hosted-answers",
];

// Search-engine verification files in public/ (e.g. the IndexNow key) are public by design.
const PUBLIC_VERIFICATION_FILE = /^\/[a-f0-9]{32}\.txt$/;

function isPublicRoute(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  return PUBLIC_EXACT_ROUTES.has(pathname) || PUBLIC_VERIFICATION_FILE.test(pathname) || PUBLIC_ROUTE_PREFIXES.some(
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
    "pricing", "contact", "beta", "legal", "sign-in", "sign-up", "api", "_next", "blog",
    "analytics", "backlinks", "unsubscribe", "e2e-acceptance", "x-reply", "check", "method", "start", "hosted-answers",
  ]);
  const pathParts = pathname.split("/").filter(Boolean);
  // Pentra's own site uses /blog/[slug]; an unknown path there is a real 404,
  // never a copy of the blog (soft 404s waste Google's crawl of a young site).
  const host = request.nextUrl.hostname.toLowerCase().replace(/^www\./, "");
  const appHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://pentra.dev").hostname.replace(/^www\./, ""); } catch { return "pentra.dev"; } })();
  const customBlogHost = host !== appHost && host !== "pentra.dev" && host !== "localhost" && !host.endsWith(".vercel.app");
  if (customBlogHost && pathParts.length === 2 && !knownPrefixes.has(pathParts[0])) {
    // Path like /my-custom-prefix/article-slug — rewrite to blog viewer
    const rewriteUrl = new URL(`/blog/${pathParts[1]}`, request.url);
    return NextResponse.rewrite(rewriteUrl);
  }
  if (customBlogHost && pathParts.length === 1 && !knownPrefixes.has(pathParts[0])
    && pathParts[0] !== "favicon.ico" && !pathParts[0].includes(".")) {
    // Path like /my-custom-prefix — could be a blog listing for custom prefix
    const rewriteUrl = new URL("/blog", request.url);
    return NextResponse.rewrite(rewriteUrl);
  }
  if (!customBlogHost && pathParts.length > 0 && !knownPrefixes.has(pathParts[0]) && !pathParts[0].includes(".")) {
    // Not a page on Pentra's site: let Next answer 404 instead of redirecting to sign-in.
    return NextResponse.next();
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

/** Pentra Answers (Nov 2026): a customer's hosted answers address (always answers.<their domain>) serves its answer pages
 * from /hosted-answers, before Clerk: these are public pages in the customer's name. */
function hostedAnswersRewrite(request: NextRequest): NextResponse | null {
  const host = request.nextUrl.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.startsWith("answers.") || host.split(".").length < 3 || host.endsWith(".vercel.app")) return null;
  const parts = request.nextUrl.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return NextResponse.rewrite(new URL("/hosted-answers", request.url));
  if (parts.length === 1 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[0])) {
    return NextResponse.rewrite(new URL(`/hosted-answers/${parts[0]}`, request.url));
  }
  return null;
}

export default function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const hosted = hostedAnswersRewrite(request);
  if (hosted) return hosted;
  const isLocalAcceptance =
    request.headers.get("host")?.endsWith(":3100") === true;
  return isLocalAcceptance
    ? publicAcceptanceMiddleware(request)
    : clerkAppMiddleware(request, event);
}

// P296 (Nov 3 2026): Vercel paused both sites on Nov 2 for the Hobby plan's Fluid Active CPU limit. In Next 16 this proxy
// runs as a Node function, so Clerk ran on every request, bots crawling the blog and sitemap included. Public pages that
// never read the session (the blog, the sitemap, robots.txt, the legal pages, the free check's reports, text and XML files)
// no longer pass through it; the dashboard, sign-in, the API and custom blog hosts' paths still do.
export const config = {
  matcher: [
    "/((?!_next|blog(?:/|$)|check(?:/|$)|legal(?:/|$)|sitemap\\.xml|robots\\.txt|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt|xml)).*)",
    "/(api|trpc)(.*)",
  ],
};
