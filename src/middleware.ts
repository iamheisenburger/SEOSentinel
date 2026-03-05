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
]);

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  const { pathname, searchParams } = request.nextUrl;

  // Signed-in users hitting landing page → dashboard
  if (userId && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Signed-in users on /sign-in → dashboard (no reason to be here)
  if (userId && pathname.startsWith("/sign-in")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Signed-in users on /sign-up WITH a paid plan param → let them through
  // so Clerk's forceRedirectUrl sends them to /settings/billing
  // Only redirect to dashboard if there's NO plan context
  if (userId && pathname.startsWith("/sign-up") && !searchParams.get("plan")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
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
