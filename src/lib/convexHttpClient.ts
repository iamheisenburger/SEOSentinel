import { ConvexHttpClient } from "convex/browser";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

// HTTP client for server-side / edge calls (not React-dependent)
export const convexHttp = new ConvexHttpClient(url ?? "http://localhost:3210");

