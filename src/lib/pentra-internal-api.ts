function getConvexSiteUrl() {
  const explicit = process.env.CONVEX_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!cloudUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const url = new URL(cloudUrl);
  url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  return url.toString().replace(/\/$/, "");
}

export async function callPentraInternal<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const secret = process.env.PENTRA_INTERNAL_SECRET;
  if (!secret) throw new Error("PENTRA_INTERNAL_SECRET is not configured");

  const response = await fetch(`${getConvexSiteUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `Pentra internal API failed (${response.status})`);
  }
  return payload as T;
}
