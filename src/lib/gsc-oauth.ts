export const GSC_READONLY_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";
export const GSC_GROWTH_SCOPE =
  "https://www.googleapis.com/auth/webmasters";
const GOOGLE_IDENTITY_SCOPES = new Set([
  "openid",
  "email",
  "https://www.googleapis.com/auth/userinfo.email",
]);

export type GscSiteEntry = {
  siteUrl?: string;
  permissionLevel?: string;
};

export function hasGscReadonlyScope(scopes: unknown): boolean {
  if (typeof scopes !== "string") return false;
  const granted = new Set(scopes.split(/\s+/).filter(Boolean));
  return granted.has(GSC_READONLY_SCOPE) || granted.has(GSC_GROWTH_SCOPE);
}

export function hasGscGrowthScope(scopes: unknown): boolean {
  if (typeof scopes !== "string") return false;
  return new Set(scopes.split(/\s+/).filter(Boolean)).has(GSC_GROWTH_SCOPE);
}

/** Reject Gmail or unrelated sensitive permissions on a GSC connection. */
export function hasOnlyGscGrowthScopes(scopes: unknown): boolean {
  if (typeof scopes !== "string") return false;
  const granted = scopes.split(/\s+/).filter(Boolean);
  return (
    granted.includes(GSC_GROWTH_SCOPE) &&
    granted.every(
      (scope) =>
        scope === GSC_GROWTH_SCOPE ||
        scope === GSC_READONLY_SCOPE ||
        GOOGLE_IDENTITY_SCOPES.has(scope),
    )
  );
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

function exactHostname(value: string): string {
  const candidate = value.trim().toLowerCase().replace(/^sc-domain:/, "");
  if (!candidate) return "";
  try {
    const url = new URL(
      candidate.includes("://") ? candidate : `https://${candidate}`,
    );
    if (
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return "";
    }
    return url.hostname.replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function findMatchingGscProperty(
  entries: GscSiteEntry[],
  siteDomain: string,
): string | undefined {
  const expectedHost = exactHostname(siteDomain);
  if (!expectedHost) return undefined;

  // Domain properties cover every protocol and path, so prefer the exact
  // hostname property even when a URL-prefix property appears first.
  const domainProperty = entries.find((entry) => {
    if (typeof entry.siteUrl !== "string") return false;
    const candidate = entry.siteUrl.trim().toLowerCase();
    return (
      candidate.startsWith("sc-domain:") &&
      exactHostname(candidate) === expectedHost
    );
  });
  if (domainProperty?.siteUrl) return domainProperty.siteUrl;

  let expectedOrigin: string;
  try {
    const candidate = siteDomain.trim();
    expectedOrigin = new URL(
      candidate.includes("://") ? candidate : `https://${candidate}`,
    ).origin.toLowerCase();
  } catch {
    return undefined;
  }

  // A URL-prefix property is valid for the whole tenant only when it is the
  // exact root origin. A /blog/ property must never be treated as whole-site
  // coverage because it can silently exclude product and landing pages.
  return entries.find((entry) => {
    if (typeof entry.siteUrl !== "string") return false;
    const candidate = entry.siteUrl.trim();
    if (!/^https?:\/\//i.test(candidate)) return false;
    try {
      const propertyUrl = new URL(candidate);
      return (
        propertyUrl.origin.toLowerCase() === expectedOrigin &&
        propertyUrl.pathname === "/" &&
        propertyUrl.search === "" &&
        propertyUrl.hash === ""
      );
    } catch {
      return false;
    }
  })?.siteUrl;
}
