import { ConvexReactClient } from "convex/react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!url && process.env.NODE_ENV === "production") {
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Set it to your Convex deployment URL.",
  );
}

export const convex = new ConvexReactClient(
  url ?? "http://localhost:3210",
);



