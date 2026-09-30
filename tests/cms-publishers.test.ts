import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  cmsConnectionComplete,
  cmsDestinationId,
  cmsUrlStructure,
  normalizedGhostAdminUrl,
  normalizedShopifyStore,
} from "../convex/lib/cmsDestinations.ts";
import {
  ghostAdminToken,
  ghostDeliveryTag,
  publishToCms,
  verifyCmsDestination,
  webflowFieldMap,
  type CmsRequest,
  type CmsSite,
} from "../convex/lib/cmsPublishers.ts";
import {
  publicationAdapterConfigHash,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
} from "../convex/lib/publicationArtifact.ts";
import { transientPublicationError } from "../convex/lib/publicationLease.ts";
import {
  expectedPublisherDestinationReceipt,
  publisherConnectionComplete,
  supportedPublisherMethod,
} from "../convex/lib/publisherProvisioning.ts";
import { publicationDestinationBlockers } from "../convex/lib/autopilotReadiness.ts";

const deliveryKey = `pentra:${"b".repeat(64)}`;
const contentHash = "a".repeat(64);
const article = {
  title: "How to plan a garden maintenance visit",
  slug: "garden-maintenance-visit",
  html: "<p>Plan the visit.</p>",
  metaTitle: "Plan a garden maintenance visit",
  metaDescription: "A checklist for planning a garden maintenance visit.",
  featuredImage: "https://cdn.example/image.png",
};

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function recorder(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const request: CmsRequest = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const { status, body } = handler(call);
    return { status, text: typeof body === "string" ? body : JSON.stringify(body) };
  };
  return { calls, request };
}

// ── Destination normalization ────────────────────────────

test("hosted platform connections normalize and derive the platform's public URL structure", () => {
  assert.equal(normalizedShopifyStore("Maple-Works.myshopify.com/admin"), "https://maple-works.myshopify.com");
  assert.equal(normalizedShopifyStore("https://maple.example"), null);
  assert.equal(normalizedGhostAdminUrl("https://blog.example/ghost/"), "https://blog.example");
  assert.equal(normalizedGhostAdminUrl("https://maple.example/journal"), "https://maple.example/journal");

  const shopify = { publishMethod: "shopify", domain: "maple.example", cmsEndpoint: "maple.myshopify.com", cmsClientId: "c".repeat(32), cmsSecret: "s".repeat(38) };
  assert.equal(cmsUrlStructure(shopify), "/blogs/news/[slug]");
  assert.equal(cmsConnectionComplete(shopify), true);
  assert.equal(cmsDestinationId(shopify), "shopify:https://maple.myshopify.com#news");
  assert.equal(cmsConnectionComplete({ ...shopify, cmsClientId: undefined }), false);
  assert.equal(cmsConnectionComplete({ ...shopify, cmsClientId: undefined, cmsSecret: `shpat_${"x".repeat(32)}` }), true);

  const webflow = { publishMethod: "webflow", domain: "www.maple.example", cmsSecret: "w".repeat(64), cmsCollection: "Journal" };
  assert.equal(cmsUrlStructure(webflow), "/journal/[slug]");
  assert.equal(cmsDestinationId(webflow), "webflow:maple.example/journal");

  const ghost = { publishMethod: "ghost", domain: "maple.example", cmsEndpoint: "https://maple.example/journal", cmsSecret: `${"1".repeat(24)}:${"2".repeat(64)}` };
  assert.equal(cmsUrlStructure(ghost), "/journal/[slug]/");
  assert.equal(cmsUrlStructure({ ...ghost, cmsEndpoint: "https://maple.ghost.io" }), "/[slug]/");
  assert.equal(cmsConnectionComplete({ ...ghost, cmsSecret: "not-a-key" }), false);
});

test("hosted platforms seal their destination and credential without changing existing GitHub seals", () => {
  const github = { domain: "maple.example", publishMethod: "github", repoOwner: "maple", repoName: "site", repoDefaultBranch: "main", urlStructure: "/blog/[slug]" };
  const config = publicationDeliveryConfig(github);
  assert.equal("cmsEndpoint" in config, false);
  assert.equal(publicationDeliveryConfigHash(config), publicationDeliveryConfigHash(publicationDeliveryConfig({ ...github })));

  const ghost = { publishMethod: "ghost", domain: "maple.example", cmsEndpoint: "https://maple.example", cmsSecret: `${"1".repeat(24)}:${"2".repeat(64)}`, urlStructure: "/[slug]/" };
  const sealed = publicationDeliveryConfig(ghost);
  assert.equal(sealed.cmsEndpoint, "https://maple.example");
  assert.equal(sealed.rendererVersion, "semantic-html-v1");
  // The sealed snapshot re-normalizes to itself (recovery re-reads it).
  assert.deepEqual(publicationDeliveryConfig(sealed), sealed);
  assert.throws(() => publicationDeliveryConfig({ ...ghost, urlStructure: "/blog/[slug]" }), /URL structure does not match/);
  const hash = publicationAdapterConfigHash(ghost);
  assert.match(hash ?? "", /^[a-f0-9]{64}$/);
  assert.notEqual(publicationAdapterConfigHash({ ...ghost, cmsSecret: `${"1".repeat(24)}:${"3".repeat(64)}` }), hash);

  assert.equal(supportedPublisherMethod("ghost"), "ghost");
  assert.equal(publisherConnectionComplete(ghost as never), true);
  const receipt = expectedPublisherDestinationReceipt({ site: { ...ghost, userId: "owner" } as never, ownerAccountKey: "owner-key", verifiedAt: 1 });
  assert.equal(receipt?.method, "ghost");
  assert.equal(receipt?.destinationId, "ghost:https://maple.example#posts");

  assert.deepEqual(publicationDestinationBlockers({ ...ghost, cmsSecret: undefined }), ["ghost_connection_incomplete"]);
  assert.deepEqual(publicationDestinationBlockers(ghost), ["publication_adapter_unverified"]);
  assert.deepEqual(publicationDestinationBlockers({ ...ghost, publicationAdapterVersion: "verified-publisher-v1", publicationAdapterConfigHash: hash, publicationAdapterVerifiedAt: 1 }), []);
});

test("read-phase platform outages are retried like GitHub and WordPress outages; failed writes are not", () => {
  assert.equal(transientPublicationError("Shopify lookup failed (HTTP 503)"), true);
  assert.equal(transientPublicationError("Webflow lookup failed (HTTP 429)"), true);
  assert.equal(transientPublicationError("Ghost lookup failed (HTTP 502)"), true);
  assert.equal(transientPublicationError("Ghost API error (503): down"), false);
  assert.equal(transientPublicationError("Shopify lookup failed (HTTP 404)"), false);
});

// ── Shopify ─────────────────────────────────────────────

const shopifySite: CmsSite = {
  publishMethod: "shopify", domain: "maple.example", siteName: "Maple Works",
  cmsEndpoint: "https://maple.myshopify.com", cmsClientId: "c".repeat(32), cmsSecret: "s".repeat(38),
};
const shopifyUrl = "https://maple.example/blogs/news/garden-maintenance-visit";

function shopifyServer(options: { scope?: string; primaryHost?: string; existing?: Record<string, unknown>[]; createErrors?: unknown[] } = {}) {
  let created = 0;
  const server = recorder(({ url, body, headers }) => {
    if (url === "https://maple.myshopify.com/admin/oauth/access_token") {
      const form = new URLSearchParams(body);
      assert.equal(form.get("grant_type"), "client_credentials");
      assert.equal(form.get("client_id"), shopifySite.cmsClientId);
      return { status: 200, body: { access_token: "shpat_synthetic_token_value", scope: options.scope ?? "read_content,write_content", expires_in: 86399 } };
    }
    assert.equal(url, "https://maple.myshopify.com/admin/api/2026-07/graphql.json");
    assert.ok(headers["X-Shopify-Access-Token"]);
    const { query, variables } = JSON.parse(body!);
    if (query.includes("PentraDestination")) {
      assert.equal(variables.blogQuery, "handle:news");
      return { status: 200, body: { data: { shop: { primaryDomain: { host: options.primaryHost ?? "www.maple.example" }, myshopifyDomain: "maple.myshopify.com" },
        blogs: { nodes: [{ id: "gid://shopify/Blog/1", handle: "news" }] } } } };
    }
    if (query.includes("PentraArticle")) return { status: 200, body: { data: { articles: { nodes: options.existing ?? [] } } } };
    assert.match(query, /PentraCreateArticle/);
    created += 1;
    const input = variables.article;
    assert.equal(input.blogId, "gid://shopify/Blog/1");
    assert.equal(input.handle, "garden-maintenance-visit");
    assert.equal(input.isPublished, true);
    assert.equal(input.body, article.html);
    assert.deepEqual(input.image, { url: article.featuredImage, altText: article.title });
    assert.ok(input.metafields.some((m: { namespace: string; key: string; value: string }) => m.namespace === "pentra" && m.key === "delivery_key" && m.value === deliveryKey));
    assert.ok(input.metafields.some((m: { namespace: string; key: string }) => m.namespace === "global" && m.key === "description_tag"));
    return { status: 200, body: { data: { articleCreate: options.createErrors?.length
      ? { article: null, userErrors: options.createErrors }
      : { article: { id: "gid://shopify/Article/9", handle: input.handle, isPublished: true, blog: { id: input.blogId } }, userErrors: [] } } } };
  });
  return { ...server, created: () => created };
}

test("Shopify verification exchanges the Dev Dashboard credentials and proves blog, permission and domain", async () => {
  const ok = shopifyServer();
  assert.deepEqual(await verifyCmsDestination(shopifySite, "/blogs/news/[slug]", ok.request), { method: "shopify", publicHost: "maple.example", collectionId: "gid://shopify/Blog/1" });
  await assert.rejects(verifyCmsDestination(shopifySite, "/blogs/news/[slug]", shopifyServer({ scope: "read_content" }).request), /write_content/);
  await assert.rejects(verifyCmsDestination(shopifySite, "/blogs/news/[slug]", shopifyServer({ primaryHost: "other-store.example" }).request), /primary domain is other-store\.example, but this Pentra website is maple\.example/);
  const legacy = shopifyServer();
  await verifyCmsDestination({ ...shopifySite, cmsClientId: undefined, cmsSecret: `shpat_${"x".repeat(32)}` }, "/blogs/news/[slug]", legacy.request);
  assert.equal(legacy.calls.some((call) => call.url.endsWith("/oauth/access_token")), false);
});

test("Shopify publishes once, confirms its own retry and never overwrites another article", async () => {
  const fresh = shopifyServer();
  let mutations = 0;
  const receipt = await publishToCms({ site: shopifySite, article, deliveryKey, contentHash, publicUrl: shopifyUrl, urlStructure: "/blogs/news/[slug]",
    hadPriorAttempt: false, beforeExternalMutation: async () => { mutations += 1; }, request: fresh.request });
  assert.deepEqual({ method: receipt.method, externalId: receipt.externalId, url: receipt.url, status: receipt.status }, { method: "shopify", externalId: "gid://shopify/Article/9", url: shopifyUrl, status: "published" });
  assert.equal(mutations, 1);
  assert.equal(fresh.created(), 1);

  const ours = shopifyServer({ existing: [{ id: "gid://shopify/Article/9", handle: "garden-maintenance-visit", isPublished: true, blog: { id: "gid://shopify/Blog/1" }, metafield: { value: deliveryKey } }] });
  const retry = await publishToCms({ site: shopifySite, article, deliveryKey, contentHash, publicUrl: shopifyUrl, urlStructure: "/blogs/news/[slug]",
    hadPriorAttempt: true, beforeExternalMutation: async () => { throw new Error("must not write"); }, request: ours.request });
  assert.equal(retry.externalId, "gid://shopify/Article/9");
  assert.equal(ours.created(), 0);

  const theirs = shopifyServer({ existing: [{ id: "gid://shopify/Article/2", handle: "garden-maintenance-visit", isPublished: true, blog: { id: "gid://shopify/Blog/1" }, metafield: null }] });
  await assert.rejects(publishToCms({ site: shopifySite, article, deliveryKey, contentHash, publicUrl: shopifyUrl, urlStructure: "/blogs/news/[slug]",
    hadPriorAttempt: false, beforeExternalMutation: async () => { throw new Error("must not write"); }, request: theirs.request }), /belongs to a different publication/);
  assert.equal(theirs.created(), 0);

  const rejected = shopifyServer({ createErrors: [{ code: "INVALID", field: ["handle"], message: "Handle has already been taken" }] });
  await assert.rejects(publishToCms({ site: shopifySite, article, deliveryKey, contentHash, publicUrl: shopifyUrl, urlStructure: "/blogs/news/[slug]",
    hadPriorAttempt: false, beforeExternalMutation: async () => {}, request: rejected.request }), /Shopify rejected the article: Handle has already been taken/);

  const down = recorder(() => ({ status: 503, body: { errors: "unavailable" } }));
  await assert.rejects(publishToCms({ site: shopifySite, article, deliveryKey, contentHash, publicUrl: shopifyUrl, urlStructure: "/blogs/news/[slug]",
    hadPriorAttempt: false, beforeExternalMutation: async () => { throw new Error("must not write"); }, request: down.request }), (error: Error) => transientPublicationError(error.message));
});

// ── Webflow ─────────────────────────────────────────────

const webflowSite: CmsSite = { publishMethod: "webflow", domain: "maple.example", cmsSecret: "w".repeat(64), cmsCollection: "blog" };
const webflowUrl = "https://maple.example/blog/garden-maintenance-visit";
const webflowFields = [
  { slug: "name", type: "PlainText", isRequired: true, displayName: "Name" },
  { slug: "slug", type: "PlainText", isRequired: true, displayName: "Slug" },
  { slug: "post-body", type: "RichText", isRequired: false, displayName: "Post body" },
  { slug: "post-summary", type: "PlainText", isRequired: false, displayName: "Post summary" },
  { slug: "main-image", type: "Image", isRequired: false, displayName: "Main image" },
];

function webflowServer(options: { fields?: unknown[]; existing?: Record<string, unknown>[] } = {}) {
  let created = 0;
  const server = recorder(({ url, method, body, headers }) => {
    assert.equal(headers.Authorization, `Bearer ${webflowSite.cmsSecret}`);
    if (url === "https://api.webflow.com/v2/sites") return { status: 200, body: { sites: [
      { id: "site-other", shortName: "other", customDomains: [{ id: "d0", url: "other.example" }] },
      { id: "site-1", shortName: "maple-works", customDomains: [{ id: "d1", url: "www.maple.example" }] }] } };
    if (url === "https://api.webflow.com/v2/sites/site-1/collections") return { status: 200, body: { collections: [{ id: "col-1", slug: "blog", displayName: "Blog Posts" }] } };
    if (url === "https://api.webflow.com/v2/collections/col-1") return { status: 200, body: { id: "col-1", slug: "blog", fields: options.fields ?? webflowFields } };
    if (url.startsWith("https://api.webflow.com/v2/collections/col-1/items?")) return { status: 200, body: { items: options.existing ?? [], pagination: { total: 0 } } };
    assert.equal(url, "https://api.webflow.com/v2/collections/col-1/items/live");
    assert.equal(method, "POST");
    created += 1;
    const payload = JSON.parse(body!);
    assert.deepEqual(payload.fieldData, { name: article.title, slug: article.slug, "post-body": article.html, "post-summary": article.metaDescription,
      "main-image": { url: article.featuredImage, alt: article.title } });
    return { status: 202, body: { id: "item-1", isDraft: false, fieldData: payload.fieldData } };
  });
  return { ...server, created: () => created };
}

test("Webflow maps collection fields and refuses collections Pentra cannot fill", () => {
  assert.deepEqual(webflowFieldMap(webflowFields), { body: "post-body", summary: "post-summary", image: "main-image" });
  assert.throws(() => webflowFieldMap([...webflowFields, { slug: "category", type: "Reference", isRequired: true, displayName: "Category" }]), /required fields Pentra can't fill: Category/);
  assert.throws(() => webflowFieldMap(webflowFields.filter((field) => field.type !== "RichText")), /no rich text field/);
});

test("Webflow publishes a live item on the matching site, confirms its own retry and never overwrites", async () => {
  assert.deepEqual(await verifyCmsDestination(webflowSite, "/blog/[slug]", webflowServer().request), { method: "webflow", publicHost: "maple.example", collectionId: "col-1" });
  await assert.rejects(verifyCmsDestination({ ...webflowSite, domain: "unrelated.example" }, "/blog/[slug]", webflowServer().request), /can't reach a site published on unrelated\.example/);

  const fresh = webflowServer();
  let mutations = 0;
  const receipt = await publishToCms({ site: webflowSite, article, deliveryKey, contentHash, publicUrl: webflowUrl, urlStructure: "/blog/[slug]",
    hadPriorAttempt: false, beforeExternalMutation: async () => { mutations += 1; }, request: fresh.request });
  assert.equal(receipt.externalId, "item-1");
  assert.equal(receipt.url, webflowUrl);
  assert.equal(mutations, 1);

  const existing = [{ id: "item-1", isDraft: false, fieldData: { name: article.title, slug: article.slug } }];
  const retry = webflowServer({ existing });
  const confirmed = await publishToCms({ site: webflowSite, article, deliveryKey, contentHash, publicUrl: webflowUrl, urlStructure: "/blog/[slug]",
    hadPriorAttempt: true, beforeExternalMutation: async () => { throw new Error("must not write"); }, request: retry.request });
  assert.equal(confirmed.externalId, "item-1");
  assert.equal(retry.created(), 0);
  // Without Pentra's own prior attempt, an item at the address belongs to the owner.
  await assert.rejects(publishToCms({ site: webflowSite, article, deliveryKey, contentHash, publicUrl: webflowUrl, urlStructure: "/blog/[slug]",
    hadPriorAttempt: false, beforeExternalMutation: async () => { throw new Error("must not write"); }, request: webflowServer({ existing }).request }), /belongs to a different publication/);
});

// ── Ghost ───────────────────────────────────────────────

const ghostId = "6".repeat(24), ghostSecret = "7".repeat(64);
const ghostSite: CmsSite = { publishMethod: "ghost", domain: "maple.example", cmsEndpoint: "https://maple.ghost.io", cmsSecret: `${ghostId}:${ghostSecret}` };
const ghostUrl = "https://maple.example/garden-maintenance-visit/";

function verifyGhostJwt(authorization: string) {
  const token = authorization.replace(/^Ghost /, "");
  const [header, payload, signature] = token.split(".");
  const expected = createHmac("sha256", Buffer.from(ghostSecret, "hex")).update(`${header}.${payload}`).digest("base64url");
  assert.equal(signature, expected);
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT", kid: ghostId });
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.aud, "/admin/");
  assert.equal(claims.exp - claims.iat, 300);
}

function ghostServer(options: { siteUrl?: string; existing?: Record<string, unknown> | null } = {}) {
  let created = 0;
  const server = recorder(({ url, method, body, headers }) => {
    verifyGhostJwt(headers.Authorization);
    assert.equal(headers["Accept-Version"], "v5.0");
    const path = url.replace("https://maple.ghost.io/ghost/api/admin", "");
    if (path === "/site/") return { status: 200, body: { site: { url: options.siteUrl ?? "https://maple.example/", title: "Maple Works" } } };
    if (path === "/posts/?limit=1&fields=id") return { status: 200, body: { posts: [] } };
    if (path.startsWith("/posts/slug/garden-maintenance-visit/")) {
      return options.existing ? { status: 200, body: { posts: [options.existing] } } : { status: 404, body: { errors: [{ type: "NotFoundError" }] } };
    }
    assert.equal(path, "/posts/?source=html");
    assert.equal(method, "POST");
    created += 1;
    const post = JSON.parse(body!).posts[0];
    assert.equal(post.status, "published");
    assert.deepEqual(post.tags, [{ name: ghostDeliveryTag(deliveryKey) }]);
    assert.equal(post.feature_image, article.featuredImage);
    return { status: 201, body: { posts: [{ id: "post-1", slug: post.slug, status: "published", url: ghostUrl }] } };
  });
  return { ...server, created: () => created };
}

test("Ghost Admin API tokens are short-lived HS256 JWTs signed with the key's secret", () => {
  verifyGhostJwt(`Ghost ${ghostAdminToken(`${ghostId}:${ghostSecret}`)}`);
  assert.throws(() => ghostAdminToken("not:a-key"), /id:secret/);
  assert.equal(ghostDeliveryTag(deliveryKey), `#pentra-${"b".repeat(64)}`);
});

test("Ghost verifies the public site, publishes with a private delivery tag and never overwrites", async () => {
  assert.deepEqual(await verifyCmsDestination(ghostSite, "/[slug]/", ghostServer().request), { method: "ghost", publicHost: "maple.example", collectionId: "posts" });
  await assert.rejects(verifyCmsDestination(ghostSite, "/[slug]/", ghostServer({ siteUrl: "https://maple.example/journal/" }).request), /serves posts under \/journal/);
  await assert.rejects(verifyCmsDestination(ghostSite, "/[slug]/", ghostServer({ siteUrl: "https://elsewhere.example/" }).request), /site address is elsewhere\.example/);

  const fresh = ghostServer();
  let mutations = 0;
  const receipt = await publishToCms({ site: ghostSite, article, deliveryKey, contentHash, publicUrl: ghostUrl, urlStructure: "/[slug]/",
    hadPriorAttempt: false, beforeExternalMutation: async () => { mutations += 1; }, request: fresh.request });
  assert.deepEqual({ externalId: receipt.externalId, url: receipt.url, method: receipt.method }, { externalId: "post-1", url: ghostUrl, method: "ghost" });
  assert.equal(mutations, 1);

  const ours = ghostServer({ existing: { id: "post-1", slug: article.slug, status: "published", tags: [{ name: ghostDeliveryTag(deliveryKey) }] } });
  const retry = await publishToCms({ site: ghostSite, article, deliveryKey, contentHash, publicUrl: ghostUrl, urlStructure: "/[slug]/",
    hadPriorAttempt: true, beforeExternalMutation: async () => { throw new Error("must not write"); }, request: ours.request });
  assert.equal(retry.externalId, "post-1");
  assert.equal(ours.created(), 0);

  const theirs = ghostServer({ existing: { id: "post-0", slug: article.slug, status: "published", tags: [{ name: "Gardening" }] } });
  await assert.rejects(publishToCms({ site: ghostSite, article, deliveryKey, contentHash, publicUrl: ghostUrl, urlStructure: "/[slug]/",
    hadPriorAttempt: true, beforeExternalMutation: async () => { throw new Error("must not write"); }, request: theirs.request }), /belongs to a different publication/);
  assert.equal(theirs.created(), 0);
});
