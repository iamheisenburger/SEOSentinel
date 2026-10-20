import { NextResponse } from "next/server";
import { callPentraInternal } from "@/lib/pentra-internal-api";
import { clientIp, freeCheckEmailKey, freeCheckVisitor } from "@/lib/free-check";
import { freeCheckDomain } from "../../../../convex/lib/missedSearches";
import { plausibleEmail } from "../../../../convex/lib/customerEmail";

/** How many new free checks this network has left today. */
export async function GET(request: Request) {
  const secret = process.env.PENTRA_INTERNAL_SECRET?.trim();
  if (!secret) return NextResponse.json({ remaining: null });
  try {
    const result = await callPentraInternal<{ remaining: number; paused: boolean }>("/internal/free-check",
      { op: "quota", visitor: freeCheckVisitor(clientIp(request.headers), Date.now(), secret) });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ remaining: null });
  }
}

/** The free Missed Searches Checker: start a check for a website, count a
 * signup click from a result page, or email a check's full report to the
 * address the visitor typed. No sign-in; limits and the daily spend cap live
 * in Convex (convex/freeCheck.ts). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown; event?: unknown; domain?: unknown; email?: unknown } | null;
  const event = body?.event === "signup_click" || body?.event === "email" ? body.event : "check";
  const raw = event === "check" ? body?.url : body?.domain;
  const domain = typeof raw === "string" ? freeCheckDomain(raw.slice(0, 300)) : null;
  const email = event === "email" && typeof body?.email === "string" ? plausibleEmail(body.email.slice(0, 254)) : null;
  if (event === "check" && !domain) return NextResponse.json({ error: "Enter your website address, like yourbusiness.com." }, { status: 400 });
  if (event === "email" && (!domain || !email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const secret = process.env.PENTRA_INTERNAL_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Free checks aren't available right now. Try again later." }, { status: 503 });
  const now = Date.now(), visitor = freeCheckVisitor(clientIp(request.headers), now, secret);
  if (event === "signup_click") {
    await callPentraInternal("/internal/free-check", { op: "signup_click", visitor, ...(domain ? { domain } : {}) }).catch(() => null);
    return NextResponse.json({ ok: true });
  }
  try {
    const result = event === "email"
      ? await callPentraInternal<{ status: string }>("/internal/free-check",
        { op: "email", domain, email, emailKey: freeCheckEmailKey(email!, now, secret), visitor })
      : await callPentraInternal<{ status: string; domain: string | null }>("/internal/free-check", { op: "check", domain, visitor });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: event === "email" ? "Pentra couldn't send it just now. Try again in a minute."
      : "Pentra couldn't start the check just now. Try again in a minute." }, { status: 502 });
  }
}
