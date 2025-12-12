import { ConvexReactClient } from "convex/react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!url) {
  // Avoid hard-failing builds; in production this must be set.
  console.warn(
    "NEXT_PUBLIC_CONVEX_URL is not set. Convex client will use a local fallback.",
  );
}

export const convex = new ConvexReactClient(url ?? "http://localhost:3210");


