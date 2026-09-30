"use node";
/** Official-API publication adapters for hosted website platforms: Shopify
 * (Admin GraphQL blog articles), Webflow (CMS API v2 collection items) and
 * Ghost (Admin API posts).
 *
 * Contract shared by every adapter (the same as the WordPress REST adapter):
 * - verify(): read-only. Proves the credential works, that it may publish,
 *   and that the platform serves this exact Pentra website (public host).
 * - publish(): reads the destination first. An article Pentra already
 *   delivered under this exact delivery key is confirmed, never duplicated;
 *   any other article at the address is never overwritten. Only then is
 *   beforeExternalMutation() called and the article created.
 * - Every receipt URL is the Pentra-derived public URL, so the live check,
 *   the receipt and the platform agree on one address.
 * Network access is injected (CmsRequest) so the public-address pinning of
 * safeRequestPublicHttps applies in production and tests use fixtures. */
import { createHmac } from "node:crypto";
import {
  type ApiCmsMethod,
  cmsCollection,
  cmsEndpoint,
  CMS_PLATFORM_LABELS,
  type CmsConnection,
  isApiCmsMethod,
} from "./cmsDestinations.ts";
import {
  type PublicationReceipt,
  validatePublicationReceipt,
} from "./publicationReceipts.ts";

export const SHOPIFY_ADMIN_API_VERSION = "2026-07";
export const GHOST_ACCEPT_VERSION = "v5.0";

export type CmsRequest = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text: string }>;

export type CmsSite = CmsConnection & {
  domain: string;
  siteName?: string;
};

export type CmsArticle = {
  title: string;
  slug: string;
  html: string;
  metaTitle?: string;
  metaDescription?: string;
  featuredImage?: string;
};

export type CmsVerification = {
  method: ApiCmsMethod;
  publicHost: string;
  collectionId: string;
};

function label(method: ApiCmsMethod) {
  return CMS_PLATFORM_LABELS[method];
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

export function pentraSiteHost(domain: string): string {
  return normalizeHost(domain);
}

function json(text: string, what: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new Error(`${what} returned an unreadable response`);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Read-phase failures carry "lookup failed … (HTTP n)" so a platform that is
 * briefly down or rate limiting is retried for about a day, while a failed
 * write keeps the ordinary three-attempt limit. */
function readFailure(method: ApiCmsMethod, status: number): Error {
  return new Error(`${label(method)} lookup failed (HTTP ${status})`);
}

function assertSafeSlug(slug: string, method: ApiCmsMethod): string {
  const clean = slug.replace(/^\//, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean) || clean.length > 255) {
    throw new Error(`Article slug is unsafe for ${label(method)} publication`);
  }
  return clean;
}

function plainText(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function httpsImage(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function receipt(args: {
  method: ApiCmsMethod;
  deliveryKey: string;
  contentHash: string;
  externalId: string;
  url: string;
}): PublicationReceipt {
  return validatePublicationReceipt({
    method: args.method,
    deliveryKey: args.deliveryKey,
    contentHash: args.contentHash,
    externalId: args.externalId,
    url: args.url,
    status: "published",
    receivedAt: Date.now(),
  });
}

// ── Shopify ─────────────────────────────────────────────

const SHOPIFY_DELIVERY_NAMESPACE = "pentra";
const SHOPIFY_DELIVERY_KEY = "delivery_key";

async function shopifyAccessToken(site: CmsSite, request: CmsRequest): Promise<string> {
  const store = cmsEndpoint(site);
  const secret = site.cmsSecret?.trim() ?? "";
  if (!store || !secret) throw new Error("Shopify credentials are incomplete");
  if (secret.startsWith("shpat_")) return secret;
  const clientId = site.cmsClientId?.trim();
  if (!clientId) throw new Error("Shopify credentials are incomplete");
  const response = await request(`${store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: secret }).toString(),
  });
  if (response.status === 429 || response.status >= 500) throw readFailure("shopify", response.status);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Shopify connection check failed (${response.status}): check the app's Client ID and secret and that the app is installed on this store`);
  }
  const body = json(response.text, "Shopify");
  const token = typeof body.access_token === "string" ? body.access_token : "";
  if (!token) throw new Error("Shopify did not return an access token");
  const scopes = typeof body.scope === "string" ? body.scope.split(/[,\s]+/) : [];
  // articleCreate accepts either scope.
  if (!scopes.includes("write_content") && !scopes.includes("write_online_store_pages")) {
    throw new Error("Shopify app cannot publish posts: give it the write_content permission and release it again");
  }
  return token;
}

async function shopifyGraphql(
  site: CmsSite,
  token: string,
  query: string,
  variables: Record<string, unknown>,
  request: CmsRequest,
  phase: "read" | "write",
): Promise<Record<string, unknown>> {
  const store = cmsEndpoint(site)!;
  const response = await request(`${store}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (phase === "read" && (response.status === 429 || response.status >= 500)) throw readFailure("shopify", response.status);
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Shopify connection check failed (${response.status}): the app's access was rejected`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Shopify API error (${response.status})`);
  }
  const body = json(response.text, "Shopify");
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.length) {
    const throttled = errors.some((error) => record(record(error)?.extensions)?.code === "THROTTLED");
    if (throttled && phase === "read") throw readFailure("shopify", 429);
    const message = errors.map((error) => String(record(error)?.message ?? "error")).join("; ").slice(0, 200);
    if (/access denied|scope/i.test(message)) {
      throw new Error("Shopify app cannot publish posts: give it the read_content and write_content permissions");
    }
    throw new Error(`Shopify API error: ${message}`);
  }
  const data = record(body.data);
  if (!data) throw new Error("Shopify returned no data");
  return data;
}

const SHOPIFY_CONTEXT_QUERY = `query PentraDestination($blogQuery: String!) {
  shop { primaryDomain { host } myshopifyDomain }
  blogs(first: 5, query: $blogQuery) { nodes { id handle } }
}`;

async function shopifyContext(site: CmsSite, token: string, request: CmsRequest) {
  const handle = cmsCollection(site)!;
  const data = await shopifyGraphql(site, token, SHOPIFY_CONTEXT_QUERY, { blogQuery: `handle:${handle}` }, request, "read");
  const shop = record(data.shop);
  const primaryHost = String(record(shop?.primaryDomain)?.host ?? "");
  if (!primaryHost) throw new Error("Shopify did not return the store's domain");
  const blogs = (record(data.blogs)?.nodes as unknown[] | undefined) ?? [];
  const blog = blogs.map(record).find((node) => node?.handle === handle);
  if (!blog || typeof blog.id !== "string") {
    throw new Error(`Shopify store has no blog with the handle "${handle}". Create it under Online Store → Blog posts → Manage blogs, or enter the handle of an existing blog.`);
  }
  return { publicHost: normalizeHost(primaryHost), blogId: blog.id };
}

const SHOPIFY_LOOKUP_QUERY = `query PentraArticle($query: String!) {
  articles(first: 10, query: $query) {
    nodes {
      id handle title isPublished
      blog { id }
      metafield(namespace: "${SHOPIFY_DELIVERY_NAMESPACE}", key: "${SHOPIFY_DELIVERY_KEY}") { value }
    }
  }
}`;

const SHOPIFY_CREATE_MUTATION = `mutation PentraCreateArticle($article: ArticleCreateInput!) {
  articleCreate(article: $article) {
    article { id handle isPublished blog { id } }
    userErrors { code field message }
  }
}`;

async function verifyShopify(site: CmsSite, request: CmsRequest): Promise<CmsVerification> {
  const token = await shopifyAccessToken(site, request);
  const context = await shopifyContext(site, token, request);
  assertPublicHost("shopify", context.publicHost, site.domain, "primary domain");
  return { method: "shopify", publicHost: context.publicHost, collectionId: context.blogId };
}

async function publishShopify(args: PublishArgs): Promise<PublicationReceipt> {
  const { site, article, request } = args;
  const slug = assertSafeSlug(article.slug, "shopify");
  const token = await shopifyAccessToken(site, request);
  const context = await shopifyContext(site, token, request);
  assertPublicHost("shopify", context.publicHost, site.domain, "primary domain");
  const lookup = await shopifyGraphql(site, token, SHOPIFY_LOOKUP_QUERY, { query: `handle:${slug}` }, request, "read");
  const existing = (((record(lookup.articles)?.nodes as unknown[] | undefined) ?? []).map(record))
    .filter((node) => node?.handle === slug && record(node?.blog)?.id === context.blogId);
  if (existing.length > 1) throw new Error("Shopify returned an ambiguous article lookup");
  if (existing.length === 1) {
    const node = existing[0]!;
    if (record(node.metafield)?.value !== args.deliveryKey || node.isPublished !== true) {
      throw new Error("Shopify blog already has an article at this address that belongs to a different publication");
    }
    return receipt({ method: "shopify", deliveryKey: args.deliveryKey, contentHash: args.contentHash, externalId: String(node.id), url: args.publicUrl });
  }

  await args.beforeExternalMutation();
  const image = httpsImage(article.featuredImage);
  const metafields = [
    { namespace: SHOPIFY_DELIVERY_NAMESPACE, key: SHOPIFY_DELIVERY_KEY, type: "single_line_text_field", value: args.deliveryKey },
    { namespace: "global", key: "title_tag", type: "single_line_text_field", value: plainText(article.metaTitle ?? article.title, 255) },
    ...(article.metaDescription
      // Shopify's SEO metafields are both single_line_text_field; any other type is rejected.
      ? [{ namespace: "global", key: "description_tag", type: "single_line_text_field", value: plainText(article.metaDescription, 320) }]
      : []),
  ];
  const created = await shopifyGraphql(site, token, SHOPIFY_CREATE_MUTATION, {
    article: {
      blogId: context.blogId,
      title: article.title,
      handle: slug,
      body: article.html,
      ...(article.metaDescription ? { summary: `<p>${escapeHtml(plainText(article.metaDescription, 500))}</p>` } : {}),
      isPublished: true,
      author: { name: plainText(site.siteName?.trim() || "Editorial team", 100) },
      ...(image ? { image: { url: image, altText: plainText(article.title, 200) } } : {}),
      metafields,
    },
  }, request, "write");
  const result = record(created.articleCreate);
  const userErrors = (result?.userErrors as unknown[] | undefined) ?? [];
  if (userErrors.length) {
    const message = userErrors.map((error) => String(record(error)?.message ?? "error")).join("; ").slice(0, 200);
    throw new Error(`Shopify rejected the article: ${message}`);
  }
  const node = record(result?.article);
  if (!node || typeof node.id !== "string" || node.handle !== slug || node.isPublished !== true ||
    record(node.blog)?.id !== context.blogId) {
    throw new Error("Shopify did not confirm the exact published article address");
  }
  return receipt({ method: "shopify", deliveryKey: args.deliveryKey, contentHash: args.contentHash, externalId: node.id, url: args.publicUrl });
}

// ── Webflow ─────────────────────────────────────────────

const WEBFLOW_API = "https://api.webflow.com/v2";

type WebflowFieldMap = { body: string; summary?: string; image?: string };

function webflowHeaders(site: CmsSite): Record<string, string> {
  return { Authorization: `Bearer ${site.cmsSecret!.trim()}`, "accept-version": "2.0.0" };
}

async function webflowGet(site: CmsSite, path: string, request: CmsRequest): Promise<Record<string, unknown>> {
  const response = await request(`${WEBFLOW_API}${path}`, { method: "GET", headers: webflowHeaders(site) });
  if (response.status === 429 || response.status >= 500) throw readFailure("webflow", response.status);
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Webflow connection check failed (${response.status}): the API token was rejected or lacks CMS and Sites access`);
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`Webflow connection check failed (${response.status})`);
  return json(response.text, "Webflow");
}

function webflowSiteHosts(siteRecord: Record<string, unknown>): string[] {
  const domains = ((siteRecord.customDomains as unknown[] | undefined) ?? [])
    .map((domain) => String(record(domain)?.url ?? ""))
    .filter(Boolean)
    .map(normalizeHost);
  const shortName = typeof siteRecord.shortName === "string" ? siteRecord.shortName : "";
  return shortName ? [...domains, `${shortName.toLowerCase()}.webflow.io`] : domains;
}

/** Pick the collection fields Pentra writes. Name and slug are built in; the
 * article body must go to a rich text field; a required field Pentra cannot
 * fill would make every create fail, so it fails verification instead. */
export function webflowFieldMap(fields: unknown[]): WebflowFieldMap {
  const list = fields.map(record).filter(Boolean) as Record<string, unknown>[];
  const slugOf = (field: Record<string, unknown>) => String(field.slug ?? "");
  const byType = (type: string) => list.filter((field) => field.type === type);
  const prefer = (candidates: Record<string, unknown>[], pattern: RegExp) =>
    candidates.find((field) => pattern.test(slugOf(field))) ?? candidates[0];
  const body = prefer(byType("RichText"), /body|content|post|article/);
  if (!body) throw new Error("Webflow collection has no rich text field for the article body");
  const summary = byType("PlainText").find((field) => /summary|excerpt|description|intro/.test(slugOf(field)));
  const image = prefer(byType("Image"), /main|thumbnail|cover|hero|featured|image/);
  const filled = new Set(["name", "slug", slugOf(body), summary && slugOf(summary), image && slugOf(image)].filter(Boolean));
  const missing = list.filter((field) => field.isRequired === true && !filled.has(slugOf(field)));
  if (missing.length) {
    throw new Error(`Webflow collection has required fields Pentra can't fill: ${missing.map((field) => String(field.displayName ?? field.slug)).join(", ")}. Make them optional in the collection settings.`);
  }
  return { body: slugOf(body), ...(summary ? { summary: slugOf(summary) } : {}), ...(image ? { image: slugOf(image) } : {}) };
}

async function webflowContext(site: CmsSite, request: CmsRequest) {
  const expected = pentraSiteHost(site.domain);
  const sites = ((await webflowGet(site, "/sites", request)).sites as unknown[] | undefined ?? []).map(record)
    .filter(Boolean) as Record<string, unknown>[];
  const match = sites.find((candidate) => webflowSiteHosts(candidate).includes(expected));
  if (!match || typeof match.id !== "string") {
    const seen = sites.flatMap(webflowSiteHosts).slice(0, 4).join(", ") || "none";
    throw new Error(`Webflow token can't reach a site published on ${expected} (it reaches: ${seen})`);
  }
  const slug = cmsCollection(site)!;
  const collections = ((await webflowGet(site, `/sites/${encodeURIComponent(match.id)}/collections`, request)).collections as unknown[] | undefined ?? [])
    .map(record).filter(Boolean) as Record<string, unknown>[];
  const collection = collections.find((candidate) => candidate.slug === slug);
  if (!collection || typeof collection.id !== "string") {
    throw new Error(`Webflow site has no CMS collection with the slug "${slug}"`);
  }
  const details = await webflowGet(site, `/collections/${encodeURIComponent(collection.id)}`, request);
  const fields = webflowFieldMap((details.fields as unknown[] | undefined) ?? []);
  return { publicHost: expected, collectionId: collection.id, fields };
}

async function verifyWebflow(site: CmsSite, request: CmsRequest): Promise<CmsVerification> {
  const context = await webflowContext(site, request);
  return { method: "webflow", publicHost: context.publicHost, collectionId: context.collectionId };
}

async function publishWebflow(args: PublishArgs): Promise<PublicationReceipt> {
  const { site, article, request } = args;
  const slug = assertSafeSlug(article.slug, "webflow");
  const context = await webflowContext(site, request);
  const found = await webflowGet(site, `/collections/${encodeURIComponent(context.collectionId)}/items?slug=${encodeURIComponent(slug)}&limit=2`, request);
  const items = ((found.items as unknown[] | undefined) ?? []).map(record)
    .filter((item) => record(item?.fieldData)?.slug === slug) as Record<string, unknown>[];
  if (items.length > 1) throw new Error("Webflow returned an ambiguous item lookup");
  if (items.length === 1) {
    // Webflow items carry no private metadata, so only Pentra's own earlier,
    // still-unconfirmed attempt with the identical title is accepted as ours.
    const item = items[0];
    if (!args.hadPriorAttempt || record(item.fieldData)?.name !== article.title || item.isDraft === true || item.isArchived === true) {
      throw new Error("Webflow collection already has an item at this address that belongs to a different publication");
    }
    return receipt({ method: "webflow", deliveryKey: args.deliveryKey, contentHash: args.contentHash, externalId: String(item.id), url: args.publicUrl });
  }

  await args.beforeExternalMutation();
  const image = httpsImage(article.featuredImage);
  const fieldData: Record<string, unknown> = {
    name: article.title,
    slug,
    [context.fields.body]: article.html,
  };
  if (context.fields.summary && article.metaDescription) fieldData[context.fields.summary] = plainText(article.metaDescription, 256);
  if (context.fields.image && image) fieldData[context.fields.image] = { url: image, alt: plainText(article.title, 200) };
  const response = await request(`${WEBFLOW_API}/collections/${encodeURIComponent(context.collectionId)}/items/live`, {
    method: "POST",
    headers: { ...webflowHeaders(site), "Content-Type": "application/json" },
    body: JSON.stringify({ isArchived: false, isDraft: false, fieldData }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webflow API error (${response.status}): ${response.text.slice(0, 200)}`);
  }
  const item = json(response.text, "Webflow");
  if (typeof item.id !== "string" || record(item.fieldData)?.slug !== slug || item.isDraft === true) {
    throw new Error("Webflow did not confirm the exact published item address");
  }
  return receipt({ method: "webflow", deliveryKey: args.deliveryKey, contentHash: args.contentHash, externalId: item.id, url: args.publicUrl });
}

// ── Ghost ───────────────────────────────────────────────

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Ghost Admin API tokens: a 5-minute HS256 JWT signed with the key's hex
 * secret, key id in the header, audience /admin/. */
export function ghostAdminToken(adminKey: string, nowMs = Date.now()): string {
  const [id, secret] = adminKey.trim().split(":");
  if (!id || !secret || !/^[a-f0-9]{24}$/i.test(id) || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error("Ghost Admin API key is not in the id:secret format");
  }
  const iat = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }));
  const payload = base64Url(JSON.stringify({ iat, exp: iat + 300, aud: "/admin/" }));
  const signature = base64Url(createHmac("sha256", Buffer.from(secret, "hex")).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

function ghostHeaders(site: CmsSite): Record<string, string> {
  return { Authorization: `Ghost ${ghostAdminToken(site.cmsSecret!)}`, "Accept-Version": GHOST_ACCEPT_VERSION };
}

async function ghostGet(site: CmsSite, path: string, request: CmsRequest, allowNotFound = false): Promise<Record<string, unknown> | null> {
  const response = await request(`${cmsEndpoint(site)}/ghost/api/admin${path}`, { method: "GET", headers: ghostHeaders(site) });
  if (allowNotFound && response.status === 404) return null;
  if (response.status === 429 || response.status >= 500) throw readFailure("ghost", response.status);
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Ghost connection check failed (${response.status}): the Admin API key was rejected`);
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`Ghost connection check failed (${response.status})`);
  return json(response.text, "Ghost");
}

/** An internal (#-prefixed, never shown to readers) tag carries the delivery
 * key so a retried create is recognised as Pentra's own post. */
export function ghostDeliveryTag(deliveryKey: string): string {
  const hash = deliveryKey.replace(/^pentra:/, "");
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid Ghost delivery key");
  return `#pentra-${hash}`;
}

async function ghostContext(site: CmsSite, request: CmsRequest) {
  const siteInfo = record((await ghostGet(site, "/site/", request))?.site);
  const url = typeof siteInfo?.url === "string" ? siteInfo.url : "";
  if (!url) throw new Error("Ghost did not return the site address");
  // /site/ is public; proving the key needs an authenticated read.
  await ghostGet(site, "/posts/?limit=1&fields=id", request);
  const parsed = new URL(url);
  return { publicHost: normalizeHost(parsed.hostname), publicPath: parsed.pathname.replace(/\/+$/, "") };
}

async function verifyGhost(site: CmsSite, request: CmsRequest, urlStructure: string): Promise<CmsVerification> {
  const context = await ghostContext(site, request);
  assertPublicHost("ghost", context.publicHost, site.domain, "site address");
  const expectedPrefix = urlStructure.replace(/\/\[slug\]\/?$/, "");
  if (context.publicPath !== expectedPrefix) {
    throw new Error(`Ghost serves posts under ${context.publicPath || "/"}; enter the Admin API URL as https://${context.publicHost}${context.publicPath}`);
  }
  return { method: "ghost", publicHost: context.publicHost, collectionId: "posts" };
}

async function publishGhost(args: PublishArgs): Promise<PublicationReceipt> {
  const { site, article, request } = args;
  const slug = assertSafeSlug(article.slug, "ghost");
  await verifyGhost(site, request, args.urlStructure);
  const tag = ghostDeliveryTag(args.deliveryKey);
  const found = await ghostGet(site, `/posts/slug/${encodeURIComponent(slug)}/?include=tags&fields=id,slug,status,title`, request, true);
  const existing = found ? record(((found.posts as unknown[] | undefined) ?? [])[0]) : null;
  if (existing) {
    const tags = ((existing.tags as unknown[] | undefined) ?? []).map((entry) => record(entry)?.name);
    if (!tags.includes(tag) || existing.status !== "published" || existing.slug !== slug) {
      throw new Error("Ghost site already has a post at this address that belongs to a different publication");
    }
    return receipt({ method: "ghost", deliveryKey: args.deliveryKey, contentHash: args.contentHash, externalId: String(existing.id), url: args.publicUrl });
  }

  await args.beforeExternalMutation();
  const image = httpsImage(article.featuredImage);
  const response = await request(`${cmsEndpoint(site)}/ghost/api/admin/posts/?source=html`, {
    method: "POST",
    headers: { ...ghostHeaders(site), "Content-Type": "application/json" },
    body: JSON.stringify({ posts: [{
      title: article.title,
      slug,
      html: article.html,
      status: "published",
      tags: [{ name: tag }],
      meta_title: plainText(article.metaTitle ?? article.title, 300),
      ...(article.metaDescription ? {
        custom_excerpt: plainText(article.metaDescription, 300),
        meta_description: plainText(article.metaDescription, 500),
      } : {}),
      ...(image ? { feature_image: image, feature_image_alt: plainText(article.title, 191) } : {}),
    }] }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ghost API error (${response.status}): ${response.text.slice(0, 200)}`);
  }
  const post = record(((json(response.text, "Ghost").posts as unknown[] | undefined) ?? [])[0]);
  if (!post || typeof post.id !== "string" || post.slug !== slug || post.status !== "published") {
    throw new Error("Ghost did not confirm the exact published post address");
  }
  return receipt({ method: "ghost", deliveryKey: args.deliveryKey, contentHash: args.contentHash, externalId: post.id, url: args.publicUrl });
}

// ── Shared entry points ─────────────────────────────────

function assertPublicHost(method: ApiCmsMethod, platformHost: string, domain: string, what: string) {
  const expected = pentraSiteHost(domain);
  if (normalizeHost(platformHost) !== expected) {
    throw new Error(`${label(method)} ${what} is ${platformHost}, but this Pentra website is ${expected}. Connect the ${label(method)} store or site that serves ${expected}.`);
  }
}

type PublishArgs = {
  site: CmsSite;
  article: CmsArticle;
  deliveryKey: string;
  contentHash: string;
  publicUrl: string;
  urlStructure: string;
  hadPriorAttempt: boolean;
  beforeExternalMutation: () => Promise<void>;
  request: CmsRequest;
};

export async function verifyCmsDestination(
  site: CmsSite,
  urlStructure: string,
  request: CmsRequest,
): Promise<CmsVerification> {
  const method = site.publishMethod;
  if (!isApiCmsMethod(method)) throw new Error("Not a hosted-platform publishing destination");
  if (method === "shopify") return verifyShopify(site, request);
  if (method === "webflow") return verifyWebflow(site, request);
  return verifyGhost(site, request, urlStructure);
}

export async function publishToCms(args: PublishArgs): Promise<PublicationReceipt> {
  const method = args.site.publishMethod;
  if (!isApiCmsMethod(method)) throw new Error("Not a hosted-platform publishing destination");
  if (method === "shopify") return publishShopify(args);
  if (method === "webflow") return publishWebflow(args);
  return publishGhost(args);
}
