import { NextResponse } from "next/server";
import { callPentraInternal } from "@/lib/pentra-internal-api";
import { clientIp, freeCheckVisitor } from "@/lib/free-check";
import { freeCheckDomain } from "../../../../convex/lib/missedSearches";

/** The free Missed Searches Checker: start a check for a website, or count a
 * signup click from a result page. No sign-in; limits and the daily spend cap
 * live in Convex (convex/freeCheck.ts). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown; event?: unknown; domain?: unknown } | null;
  const signupClick = body?.event === "signup_click";
  const raw = signupClick ? body?.domain : body?.url;
  const domain = typeof raw === "string" ? freeCheckDomain(raw.slice(0, 300)) : null;
  if (!signupClick && !domain) return NextResponse.json({ error: "Enter your website address, like yourbusiness.com." }, { status: 400 });
  const secret = process.env.PENTRA_INTERNAL_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Free checks aren't available right now. Try again later." }, { status: 503 });
  const visitor = freeCheckVisitor(clientIp(request.headers), Date.now(), secret);
  if (signupClick) {
    await callPentraInternal("/internal/free-check", { op: "signup_click", visitor, ...(domain ? { domain } : {}) }).catch(() => null);
    return NextResponse.json({ ok: true });
  }
  try {
    const result = await callPentraInternal<{ status: string; domain: string | null }>("/internal/free-check", { op: "check", domain, visitor });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Pentra couldn't start the check just now. Try again in a minute." }, { status: 502 });
  }
}
