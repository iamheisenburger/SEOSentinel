import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export async function getOwnedSite(siteId: string) {
  const { userId, getToken } = await auth();
  if (!userId) return null;

  const token = await getToken({ template: "convex" });
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!token || !convexUrl) return null;

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  return client.query(api.sites.get, {
    siteId: siteId as Id<"sites">,
  });
}
