import { ConvexReactClient } from "convex/react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!url) {
  console.warn("NEXT_PUBLIC_CONVEX_URL is not set. Convex client will be disabled.");
}

export const convex = url
  ? new ConvexReactClient(url)
  : new ConvexReactClient("http://localhost:3210");

