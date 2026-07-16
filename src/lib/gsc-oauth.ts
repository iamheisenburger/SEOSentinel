export const GSC_READONLY_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";

export type GscSiteEntry = {
  siteUrl?: string;
  permissionLevel?: string;
};

export function hasGscReadonlyScope(scopes: unknown): boolean {
  if (typeof scopes !== "string") return false;
  return new Set(scopes.split(/\s+/).filter(Boolean)).has(GSC_READONLY_SCOPE);
}

export function normalizeGscDomain(value: string): string {
  const candidate = value.trim().toLowerCase().replace(/^sc-domain:/, "");
  if (!candidate) return "";

  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return url.hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return candidate
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .replace(/\.$/, "");
  }
}

export function findMatchingGscProperty(
  entries: GscSiteEntry[],
  siteDomain: string,
): string | undefined {
  const expectedDomain = normalizeGscDomain(siteDomain);
  if (!expectedDomain) return undefined;

  return entries.find(
    (entry) =>
      typeof entry.siteUrl === "string" &&
      normalizeGscDomain(entry.siteUrl) === expectedDomain,
  )?.siteUrl;
}
