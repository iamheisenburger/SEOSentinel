import { headers } from "next/headers";

/** Pentra Answers (Nov 2026): a customer's hosted answers address is always answers.<their domain>
 * (convex/lib/answerPublishing.ts validHostedDomain), so a request is recognized by its host alone. */
export function isHostedAnswersHost(host: string | null | undefined): boolean {
  const bare = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
  return bare.startsWith("answers.") && bare.split(".").length >= 3 && !/\.vercel\.app$/.test(bare);
}

/** The host the visitor asked for (the proxy's forwarded host first), lowercased, without www or a port. */
export async function requestHost(): Promise<string> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  return (forwarded || requestHeaders.get("host") || "").toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
}
