import { createHmac } from "node:crypto";

/** The visitor's IP as Vercel reports it (its edge sets x-real-ip and the
 * first x-forwarded-for entry). */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** A free-check visitor for one UTC day: an HMAC of the IP and the day, so
 * the daily limit works without storing an IP or linking one day to the next. */
export function freeCheckVisitor(ip: string, now: number, secret: string): string {
  const day = new Date(now).toISOString().slice(0, 10);
  return createHmac("sha256", secret).update(`pentra-free-check-visitor:${day}:${ip}`).digest("hex");
}
