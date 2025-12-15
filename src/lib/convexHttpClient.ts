import { ConvexHttpClient } from "convex/browser";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!url && process.env.NODE_ENV === "production") {
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Set it to your Convex deployment URL.",
  );
}

// HTTP client for server-side / edge calls (not React-dependent)
export const convexHttp = new ConvexHttpClient(url ?? "http://localhost:3210");






