/** Hosted website platforms Pentra publishes to through each platform's own
 * official API: Shopify (Admin GraphQL, blog articles), Webflow (CMS API v2)
 * and Ghost (Admin API). This module is pure and isolate-safe: it only
 * normalizes the stored connection and derives the destination identity and
 * the public URL structure. Network calls live in cmsPublishers.ts. */

export const API_CMS_METHODS = ["shopify", "webflow", "ghost"] as const;
export type ApiCmsMethod = (typeof API_CMS_METHODS)[number];

export const CMS_PLATFORM_LABELS: Record<ApiCmsMethod, string> = {
  shopify: "Shopify",
  webflow: "Webflow",
  ghost: "Ghost",
};

/** Defaults owners rarely need to change: Shopify's default blog is "news",
 * a Webflow blog collection is usually "blog". */
export const CMS_DEFAULT_COLLECTION: Record<ApiCmsMethod, string | undefined> = {
  shopify: "news",
  webflow: "blog",
  ghost: undefined,
};

export type CmsConnection = {
  publishMethod?: string;
  method?: string;
  domain?: string;
  cmsEndpoint?: string;
  cmsClientId?: string;
  cmsSecret?: string;
  cmsCollection?: string;
};

export function isApiCmsMethod(value: unknown): value is ApiCmsMethod {
  return typeof value === "string" &&
    (API_CMS_METHODS as readonly string[]).includes(value);
}

function methodOf(site: CmsConnection): string {
  return site.publishMethod ?? site.method ?? "github";
}

function httpsUrl(value?: string): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** A Shopify store is addressed by its permanent *.myshopify.com admin host;
 * the public storefront domain is confirmed from the API at verification. */
export function normalizedShopifyStore(value?: string): string | null {
  const url = httpsUrl(value);
  if (!url || (url.pathname !== "/" && url.pathname !== "/admin" && url.pathname !== "/admin/")) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(host) ? `https://${host}` : null;
}

/** Ghost's Admin API lives under the site URL (optionally a subdirectory). */
export function normalizedGhostAdminUrl(value?: string): string | null {
  const url = httpsUrl(value);
  if (!url) return null;
  const path = url.pathname.replace(/\/ghost(?:\/.*)?$/i, "").replace(/\/+$/, "");
  if (path && !/^(?:\/[A-Za-z0-9][A-Za-z0-9_-]*){1,3}$/.test(path)) return null;
  return `https://${url.hostname.toLowerCase()}${path}`;
}

export function normalizedCmsCollection(value?: string): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  return trimmed && /^[a-z0-9][a-z0-9-]{0,99}$/.test(trimmed) ? trimmed : null;
}

export function cmsEndpoint(site: CmsConnection): string | null {
  const method = methodOf(site);
  if (method === "shopify") return normalizedShopifyStore(site.cmsEndpoint);
  if (method === "ghost") return normalizedGhostAdminUrl(site.cmsEndpoint);
  if (method === "webflow") return "https://api.webflow.com";
  return null;
}

export function cmsCollection(site: CmsConnection): string | null {
  const method = methodOf(site);
  if (!isApiCmsMethod(method)) return null;
  if (method === "ghost") return "posts";
  return normalizedCmsCollection(site.cmsCollection ?? CMS_DEFAULT_COLLECTION[method]);
}

/** Shopify accepts a Dev Dashboard app's Client ID + Client secret (exchanged
 * for a 24-hour token on every use) or an older custom app's Admin API access
 * token (shpat_…). Webflow takes a site API token; Ghost an Admin API key. */
export function cmsCredentialValid(site: CmsConnection): boolean {
  const method = methodOf(site);
  const secret = site.cmsSecret?.trim() ?? "";
  if (method === "shopify") {
    if (/^shpat_[A-Za-z0-9_-]{16,}$/.test(secret)) return true;
    return /^[A-Za-z0-9_-]{16,128}$/.test(site.cmsClientId?.trim() ?? "") &&
      /^[A-Za-z0-9_-]{16,256}$/.test(secret);
  }
  if (method === "webflow") return /^[A-Za-z0-9_.-]{20,512}$/.test(secret);
  if (method === "ghost") return /^[a-f0-9]{24}:[a-f0-9]{64}$/i.test(secret);
  return false;
}

export function cmsConnectionComplete(site: CmsConnection): boolean {
  return isApiCmsMethod(methodOf(site)) && Boolean(cmsEndpoint(site)) &&
    Boolean(cmsCollection(site)) && cmsCredentialValid(site);
}

function siteHost(domain?: string): string | null {
  const url = httpsUrl(domain);
  return url ? url.hostname.toLowerCase().replace(/^www\./, "") : null;
}

/** Stable, secret-free identity of the destination (store, blog or
 * collection). A change of any part is a different destination. */
export function cmsDestinationId(site: CmsConnection): string | undefined {
  const method = methodOf(site);
  if (!cmsConnectionComplete(site)) return undefined;
  const collection = cmsCollection(site)!;
  if (method === "webflow") {
    const host = siteHost(site.domain);
    return host ? `webflow:${host}/${collection}` : undefined;
  }
  return `${method}:${cmsEndpoint(site)}#${collection}`;
}

/** The public URL pattern each platform serves articles at. Pentra's live
 * check and every receipt use exactly this pattern. */
export function cmsUrlStructure(site: CmsConnection): string | null {
  const method = methodOf(site);
  const collection = cmsCollection(site);
  if (!collection) return null;
  if (method === "shopify") return `/blogs/${collection}/[slug]`;
  if (method === "webflow") return `/${collection}/[slug]`;
  if (method === "ghost") {
    const endpoint = cmsEndpoint(site);
    const host = siteHost(site.domain);
    if (!endpoint) return null;
    const url = new URL(endpoint);
    // A Ghost install in a subdirectory of the public domain serves posts
    // under that subdirectory; a separate admin host serves them at the root.
    const prefix = host && url.hostname.replace(/^www\./, "") === host ? url.pathname.replace(/\/+$/, "") : "";
    return `${prefix}/[slug]/`;
  }
  return null;
}

/** Non-secret connection fields plus the credential material, for the
 * adapter configuration seal (the caller hashes the credential). */
export function cmsAdapterSealInput(site: CmsConnection): {
  method: ApiCmsMethod;
  endpoint: string;
  collection: string;
  clientId?: string;
  credential: string;
} | undefined {
  const method = methodOf(site);
  if (!isApiCmsMethod(method) || !cmsConnectionComplete(site)) return undefined;
  const clientId = method === "shopify" && !site.cmsSecret!.trim().startsWith("shpat_")
    ? site.cmsClientId!.trim()
    : undefined;
  return {
    method,
    endpoint: cmsEndpoint(site)!,
    collection: cmsCollection(site)!,
    ...(clientId ? { clientId } : {}),
    credential: site.cmsSecret!.trim(),
  };
}

/** Human setup steps shown next to each connection form. */
export const CMS_SETUP_STEPS: Record<ApiCmsMethod, string[]> = {
  shopify: [
    "In your Shopify admin go to Settings → Apps → Develop apps → Build apps in Dev Dashboard, and click Create app (name it Pentra).",
    "For the App URL enter https://pentra.dev. Under Access, enter the scopes read_content,write_content, then click Release.",
    "Open the app's Installs section and click Install app on your store.",
    "In the app's Settings, copy the Client ID and Client secret into Pentra. (An older custom app's Admin API access token starting with shpat_ also works.)",
    "Enter your store's myshopify.com address and the blog to publish to (Shopify's default blog is \"news\").",
  ],
  webflow: [
    "In Webflow, open Site settings → Apps & integrations → API access and generate a site API token with CMS read and write and Sites read access.",
    "Enter the token and the slug of your blog collection (the part of the address before each post, for example \"blog\" in yoursite.com/blog/post-name).",
    "Your Webflow site must be published on the same domain as this Pentra website.",
  ],
  ghost: [
    "In Ghost Admin, open Settings → Integrations → Add custom integration and name it Pentra.",
    "Copy the Admin API key and the API URL into Pentra.",
  ],
};
