import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/pricing",
  "/contact",
  "/legal(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/autopilot(.*)",
  "/sitemap.xml",
  "/robots.txt",
  "/blog(.*)",
  // Allow any /<prefix>/<slug> article paths through
]);

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  const { pathname, searchParams } = request.nextUrl;

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
    "analytics", "backlinks",
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
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
