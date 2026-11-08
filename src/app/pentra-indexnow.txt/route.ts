import { api } from "../../../convex/_generated/api";
import { convexHttp } from "@/lib/convexHttpClient";
import { isHostedAnswersHost, requestHost } from "@/lib/hosted-answers";

export const dynamic = "force-dynamic";

/** Pentra Answers (Nov 2026): a hosted answers address serves its IndexNow key here (the keyLocation Pentra submits), so
 * Bing accepts its new pages within minutes. Any other host has no such file. */
export async function GET() {
  const host = await requestHost();
  if (!isHostedAnswersHost(host)) return new Response("Not found", { status: 404 });
  try {
    // The key is served while the address is still being checked: Pentra's live check reads it through the address.
    const key = await convexHttp.query(api.answerPublish.hostedKey, { host });
    if (!key) return new Response("Not found", { status: 404 });
    return new Response(key, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  } catch {
    return new Response("Unavailable", { status: 503 });
  }
}
