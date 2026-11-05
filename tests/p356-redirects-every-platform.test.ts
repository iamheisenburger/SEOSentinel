/** P356 (Nov 5 2026): a merged duplicate article forwards to the kept one on every platform Pentra publishes to, not
 * only Pentra's own blog and GitHub sites on Vercel. Arshad: "it needs to be for github, wordpress, webflow, shopify, and
 * the other websites". WordPress is covered against real WordPress in tests/wordpress-connector.integration.ts. */
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { editNetlifyToml, editRedirectsFile, forwardHead, pageForwardsTo, servingHost, webhookRedirectEvent, wordpressRedirectKey } from "../convex/lib/platformRedirects.ts";
import { redirectOnCms, type CmsRedirectEntry, type CmsRequest, type CmsSite } from "../convex/lib/cmsPublishers.ts";

type Call = { url: string; method: string; body?: string };
function recorder(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const request: CmsRequest = async (url, init) => {
    const call = { url, method: init.method, body: init.body };
    calls.push(call);
    const { status, body } = handler(call);
    return { status, text: typeof body === "string" ? body : JSON.stringify(body) };
  };
  return { calls, request };
}
const pentraKey = `pentra:${"b".repeat(64)}`;

test("_redirects (Cloudflare Pages): Pentra's lines added or re-pointed in place; the owner's lines stay exactly", () => {
  const owner = "# my rules\n/old-pricing /pricing 301\n";
  const first = editRedirectsFile(owner, [{ source: "/blog/stain-2", destination: "/blog/stain" }]);
  assert.equal(first.changed, true);
  assert.equal(first.text, "# my rules\n/old-pricing /pricing 301\n# Pentra: merged duplicate article\n/blog/stain-2 /blog/stain 301\n");
  assert.equal(editRedirectsFile(first.text, [{ source: "/blog/stain-2", destination: "/blog/stain" }]).changed, false, "sending it again changes nothing");
  const moved = editRedirectsFile(first.text, [{ source: "/blog/stain-2", destination: "/blog/stain-guide" }]);
  assert.equal(moved.text, "# my rules\n/old-pricing /pricing 301\n# Pentra: merged duplicate article\n/blog/stain-2 /blog/stain-guide 301\n");
  const theirs = editRedirectsFile(owner, [{ source: "/old-pricing/", destination: "/blog/x" }, { source: "/blog/a*", destination: "/blog/b" }]);
  assert.deepEqual([theirs.changed, theirs.skipped], [false, ["/old-pricing/", "/blog/a*"]], "an owner's rule and an unsafe path are left alone");
  assert.equal(editRedirectsFile(null, [{ source: "/blog/a", destination: "/blog/b" }]).text, "# Pentra: merged duplicate article\n/blog/a /blog/b 301\n");
});

test("netlify.toml: forced 301 blocks Pentra marks, re-pointed in place; the owner's settings stay", () => {
  const owner = '[build]\n  command = "npm run build"\n';
  const first = editNetlifyToml(owner, [{ source: "/blog/stain-2", destination: "/blog/stain" }]);
  assert.match(first.text, /^\[build\]\n  command = "npm run build"\n\n# Pentra: permanent redirect for a merged duplicate article\n\[\[redirects\]\]\n  from = "\/blog\/stain-2"\n  to = "\/blog\/stain"\n  status = 301\n  force = true\n$/);
  assert.equal(editNetlifyToml(first.text, [{ source: "/blog/stain-2", destination: "/blog/stain" }]).changed, false);
  assert.match(editNetlifyToml(first.text, [{ source: "/blog/stain-2", destination: "/blog/new" }]).text, /to = "\/blog\/new"/);
  assert.deepEqual(editNetlifyToml('[[redirects]]\n  from = "/blog/stain-2/"\n  to = "/x"\n', [{ source: "/blog/stain-2", destination: "/blog/stain" }]).skipped, ["/blog/stain-2"]);
});

test("the host is read from the page's own answer: the redirect file goes where that host reads it", () => {
  assert.equal(servingHost({ "x-vercel-id": "iad1::abc", server: "Vercel" }), "vercel");
  assert.equal(servingHost({ server: "Netlify", "x-nf-request-id": "01H" }), "netlify");
  assert.equal(servingHost({ server: "GitHub.com" }), "github_pages");
  assert.equal(servingHost({ server: "cloudflare", "cf-ray": "8a-LHR" }), "cloudflare");
  assert.equal(servingHost({ server: "cloudflare" }), "other", "a page without Cloudflare's ray id isn't treated as Cloudflare");
  assert.equal(servingHost({ server: "nginx" }), "other");
});

test("webhook sites get a signed pentra.redirect.create.v1 event, signed like their article deliveries", () => {
  const secret = "s".repeat(40);
  const event = webhookRedirectEvent([{ source: "/blog/a", destination: "/blog/b" }], "maple.example", 1_793_800_000,
    (input) => createHmac("sha256", secret).update(input).digest("hex"));
  assert.deepEqual(JSON.parse(event.body), { event: "pentra.redirect.create.v1", site: "maple.example",
    redirects: [{ from: "/blog/a", to: "/blog/b", permanent: true, status: 301 }] });
  assert.equal(event.headers["X-Pentra-Signature-256"], `sha256=${createHmac("sha256", secret).update(`1793800000.${event.body}`).digest("hex")}`);
});

test("Ghost forward: an instant refresh in the post's head code, the owner's code kept, never doubled; checked by loading the page", () => {
  const target = "https://maple.example/journal/kept-guide/";
  const head = forwardHead("<script>owner()</script>", target);
  assert.equal(head, `<!-- Pentra: merged into a stronger article -->\n<meta http-equiv="refresh" content="0; url=${target}">\n<!-- /Pentra -->\n<script>owner()</script>`);
  assert.equal(forwardHead(head, target), head, "added once");
  assert.match(forwardHead(head, "https://maple.example/journal/newer/"), /url=https:\/\/maple\.example\/journal\/newer\/"[\s\S]*owner\(\)/);
  assert.equal(forwardHead(null, target).includes("owner"), false);
  const page = (refresh: string, canonical: string) => `<html><head><link rel="canonical" href="${canonical}"><meta http-equiv="refresh" content="${refresh}"></head></html>`;
  assert.equal(pageForwardsTo(page(`0; url=${target}`, target), target), true);
  assert.equal(pageForwardsTo(page(`0;URL='https://www.maple.example/journal/kept-guide'`, "/journal/kept-guide/"), target), true);
  assert.equal(pageForwardsTo(page(`5; url=${target}`, target), target), false, "a delayed refresh isn't a redirect");
  assert.equal(pageForwardsTo(page(`0; url=${target}`, "https://maple.example/journal/old-guide/"), target), false, "the kept article must be the canonical page");
  assert.equal(pageForwardsTo("<html><head></head></html>", target), false);
});

// ── Shopify ─────────────────────────────────────────────

const shopify = { publishMethod: "shopify", domain: "maple.example", cmsEndpoint: "maple.myshopify.com", cmsCollection: "news",
  cmsSecret: `shpat_${"x".repeat(32)}` } as unknown as CmsSite;
const shopifyEntry: CmsRedirectEntry = { source: "/blogs/news/old-guide", destination: "/blogs/news/kept-guide", destinationUrl: "https://maple.example/blogs/news/kept-guide" };

function shopifyStore(options: { graphql: "ok" | "denied"; rest?: "ok" | "denied"; existing?: { id: string; path: string; target: string }; pentra?: boolean }) {
  return recorder((call) => {
    if (call.url.endsWith("/graphql.json")) {
      const body = JSON.parse(call.body ?? "{}") as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("PentraDestination")) return { status: 200, body: { data: { shop: { primaryDomain: { host: "maple.example" } }, blogs: { nodes: [{ id: "gid://shopify/Blog/1", handle: "news" }] } } } };
      if (body.query.includes("query PentraArticle(")) return { status: 200, body: { data: { articles: { nodes: [{ id: "gid://shopify/Article/7", handle: "old-guide", isPublished: true,
        blog: { id: "gid://shopify/Blog/1" }, metafield: options.pentra === false ? null : { value: pentraKey } }] } } } };
      if (body.query.includes("PentraHideArticle")) return { status: 200, body: { data: { articleUpdate: { article: { id: "gid://shopify/Article/7", isPublished: false }, userErrors: [] } } } };
      if (options.graphql === "denied") return { status: 200, body: { errors: [{ message: "Access denied for urlRedirects field. Required access: `read_online_store_navigation` access scope.", extensions: { code: "ACCESS_DENIED" } }] } };
      if (body.query.includes("PentraRedirects")) return { status: 200, body: { data: { urlRedirects: { nodes: options.existing ? [options.existing] : [] } } } };
      const input = body.variables.urlRedirect as { path: string; target: string };
      const key = body.query.includes("PentraRedirectCreate") ? "urlRedirectCreate" : "urlRedirectUpdate";
      return { status: 200, body: { data: { [key]: { urlRedirect: { id: "gid://shopify/UrlRedirect/9", ...input }, userErrors: [] } } } };
    }
    if (call.url.includes("/redirects")) {
      if (options.rest === "denied") return { status: 403, body: { errors: "[API] This action requires merchant approval for write_online_store_navigation scope." } };
      if (call.method === "GET") return { status: 200, body: { redirects: options.existing ? [{ ...options.existing, id: 9 }] : [] } };
      const sent = JSON.parse(call.body ?? "{}") as { redirect: { path?: string; target: string } };
      return { status: call.method === "POST" ? 201 : 200, body: { redirect: { id: 9, path: sent.redirect.path ?? shopifyEntry.source, target: sent.redirect.target } } };
    }
    return { status: 404, body: {} };
  });
}
const queries = (calls: Call[]) => calls.map((c) => c.url.endsWith("/graphql.json") ? (JSON.parse(c.body!).query as string).match(/(?:query|mutation) (\w+)/)![1] : `${c.method} ${new URL(c.url).pathname}`);

test("Shopify: the redirect is created, then the merged article is hidden (Shopify only follows a redirect from an address with no page)", async () => {
  const store = shopifyStore({ graphql: "ok" });
  const [outcome] = await redirectOnCms(shopify, [shopifyEntry], new Set(), store.request);
  assert.deepEqual(outcome, { source: shopifyEntry.source, ok: true, mechanism: "redirect" });
  assert.deepEqual(queries(store.calls), ["PentraDestination", "PentraArticle", "PentraRedirects", "PentraRedirectCreate", "PentraHideArticle"]);
  const hide = JSON.parse(store.calls.at(-1)!.body!);
  assert.deepEqual(hide.variables, { id: "gid://shopify/Article/7", article: { isPublished: false } }, "hidden, never deleted");
});

test("Shopify without the navigation permission: the REST redirect (write_content) is used; with neither, nothing is hidden", async () => {
  const rest = shopifyStore({ graphql: "denied", rest: "ok" });
  const [outcome] = await redirectOnCms(shopify, [shopifyEntry], new Set(), rest.request);
  assert.equal(outcome.ok, true);
  assert.deepEqual(queries(rest.calls).slice(2), ["PentraRedirects", "GET /admin/api/2026-07/redirects.json", "POST /admin/api/2026-07/redirects.json", "PentraHideArticle"]);
  const none = shopifyStore({ graphql: "denied", rest: "denied" });
  const [refused] = await redirectOnCms(shopify, [shopifyEntry], new Set(), none.request);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.reason, /write_online_store_navigation/);
  assert.equal(queries(none.calls).includes("PentraHideArticle"), false, "an article whose redirect failed stays published");
});

test("Shopify: an owner's own redirect is never overwritten; one pointing at an article Pentra merged away is re-pointed", async () => {
  const theirs = shopifyStore({ graphql: "ok", existing: { id: "gid://shopify/UrlRedirect/3", path: shopifyEntry.source, target: "/pages/sale" } });
  const [kept] = await redirectOnCms(shopify, [shopifyEntry], new Set(), theirs.request);
  assert.equal(kept.ok && kept.note, "your own Shopify redirect for /blogs/news/old-guide stays as you set it");
  assert.equal(queries(theirs.calls).some((q) => q.startsWith("PentraRedirectUpdate") || q.startsWith("PentraRedirectCreate")), false);
  const stale = shopifyStore({ graphql: "ok", existing: { id: "gid://shopify/UrlRedirect/3", path: shopifyEntry.source, target: "/blogs/news/middle-guide" } });
  await redirectOnCms(shopify, [shopifyEntry], new Set(["/blogs/news/middle-guide"]), stale.request);
  assert.ok(queries(stale.calls).includes("PentraRedirectUpdate"));
});

test("Shopify: an article Pentra didn't publish is never redirected or hidden", async () => {
  const store = shopifyStore({ graphql: "ok", pentra: false });
  const [outcome] = await redirectOnCms(shopify, [shopifyEntry], new Set(), store.request);
  assert.equal(outcome.ok, false);
  assert.deepEqual(queries(store.calls), ["PentraDestination", "PentraArticle"]);
});

// ── Webflow ─────────────────────────────────────────────

const webflow = { publishMethod: "webflow", domain: "www.maple.example", cmsSecret: "w".repeat(64), cmsCollection: "journal" } as unknown as CmsSite;
const webflowEntry: CmsRedirectEntry = { source: "/journal/old-guide", destination: "/journal/kept-guide", destinationUrl: "https://www.maple.example/journal/kept-guide" };
function webflowSite(redirects: "enterprise" | "not_enterprise", existing: Array<{ id: string; fromUrl: string; toUrl: string }> = []) {
  return recorder((call) => {
    const path = new URL(call.url).pathname;
    if (path === "/v2/sites") return { status: 200, body: { sites: [{ id: "site1", shortName: "maple", customDomains: [{ url: "www.maple.example" }] }] } };
    if (path === "/v2/sites/site1/redirects") {
      if (redirects === "not_enterprise") return { status: 403, body: { message: "Forbidden: this endpoint requires an Enterprise workspace" } };
      if (call.method === "GET") return { status: 200, body: { redirects: existing } };
      return { status: 200, body: { id: "r1", ...JSON.parse(call.body!) } };
    }
    return { status: 404, body: {} };
  });
}

test("Webflow: Enterprise sites get the redirect through Webflow's API; other plans get the exact step to do by hand", async () => {
  const enterprise = webflowSite("enterprise");
  assert.deepEqual(await redirectOnCms(webflow, [webflowEntry], new Set(), enterprise.request), [{ source: webflowEntry.source, ok: true, mechanism: "redirect" }]);
  assert.deepEqual(JSON.parse(enterprise.calls.at(-1)!.body!), { fromUrl: "/journal/old-guide", toUrl: "/journal/kept-guide" });
  const [byHand] = await redirectOnCms(webflow, [webflowEntry], new Set(), webflowSite("not_enterprise").request);
  assert.equal(byHand.ok, false);
  assert.match(byHand.ok ? "" : byHand.reason, /Site settings → Publishing → 301 redirects, add \/journal\/old-guide → \/journal\/kept-guide/);
  const same = webflowSite("enterprise", [{ id: "r0", fromUrl: "/journal/old-guide", toUrl: "/journal/kept-guide/" }]);
  assert.equal((await redirectOnCms(webflow, [webflowEntry], new Set(), same.request))[0].ok, true);
  assert.equal(same.calls.some((c) => c.method !== "GET"), false, "already there: nothing written");
});

// ── Ghost ───────────────────────────────────────────────

const ghost = { publishMethod: "ghost", domain: "maple.example", cmsEndpoint: "https://maple.example/journal", cmsSecret: `${"1".repeat(24)}:${"2".repeat(64)}` } as unknown as CmsSite;
const ghostEntry: CmsRedirectEntry = { source: "/journal/old-guide/", destination: "/journal/kept-guide/", destinationUrl: "https://maple.example/journal/kept-guide/" };
function ghostSite(post: Record<string, unknown> | null, put: "ok" | "conflict" = "ok") {
  return recorder((call) => {
    const path = new URL(call.url).pathname;
    if (path.endsWith("/admin/site/")) return { status: 200, body: { site: { url: "https://maple.example/journal/" } } };
    if (path.endsWith("/admin/posts/") && call.method === "GET") return { status: 200, body: { posts: [] } };
    if (path.includes("/posts/slug/")) return post ? { status: 200, body: { posts: [post] } } : { status: 404, body: { errors: [] } };
    if (call.method === "PUT") return put === "conflict" ? { status: 409, body: { errors: [{ type: "UpdateCollisionError" }] } }
      : { status: 200, body: { posts: [{ ...post, ...JSON.parse(call.body!).posts[0] }] } };
    return { status: 404, body: {} };
  });
}
const ghostPost = { id: "p1", slug: "old-guide", status: "published", updated_at: "2026-11-01T00:00:00.000Z", canonical_url: null,
  codeinjection_head: "<script>owner()</script>", tags: [{ name: `#pentra-${"b".repeat(64)}` }] };

test("Ghost: Pentra's merged post forwards on load and names the kept article canonical, only if unedited since Pentra read it", async () => {
  const site = ghostSite(ghostPost);
  assert.deepEqual(await redirectOnCms(ghost, [ghostEntry], new Set(), site.request), [{ source: ghostEntry.source, ok: true, mechanism: "page_refresh" }]);
  const sent = JSON.parse(site.calls.at(-1)!.body!).posts[0];
  assert.equal(sent.updated_at, ghostPost.updated_at, "Ghost refuses the change if the owner edited the post meanwhile");
  assert.equal(sent.canonical_url, ghostEntry.destinationUrl);
  assert.equal(sent.codeinjection_head, forwardHead(ghostPost.codeinjection_head, ghostEntry.destinationUrl));
  assert.equal(Object.keys(sent).sort().join(","), "canonical_url,codeinjection_head,updated_at", "the post's text is never sent");
  const [changed] = await redirectOnCms(ghost, [ghostEntry], new Set(), ghostSite(ghostPost, "conflict").request);
  assert.equal(changed.ok, false);
  const notOurs = ghostSite({ ...ghostPost, tags: [{ name: "News" }] });
  const [left] = await redirectOnCms(ghost, [ghostEntry], new Set(), notOurs.request);
  assert.equal(left.ok, false);
  assert.equal(notOurs.calls.some((c) => c.method === "PUT"), false, "a post Pentra didn't publish is never changed");
});

// ── Wiring ──────────────────────────────────────────────

test("delivery covers every platform: Pentra's blog first, then the site's own platform; anything undelivered is retried weekly", () => {
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  const hosted = action.indexOf("if (HOSTED_BLOG_DOMAINS.includes(host(site.domain)))");
  assert.ok(hosted > 0 && hosted < action.indexOf("await deliverToSite(ctx, site, todo)"), "a blog Pentra renders is handled before any site write");
  for (const method of ["github", "wordpress", "webhook"]) assert.match(action, new RegExp(`method === "${method}"`));
  assert.match(action, /redirectOnCms\(full as unknown as CmsSite/, "Shopify, Webflow and Ghost through their APIs");
  assert.match(action, /probe\.host === "vercel" \? \{ candidates: \["vercel\.json"\]/);
  assert.match(action, /probe\.host === "netlify" \? \{ candidates: \["netlify\.toml"\]/);
  assert.match(action, /probe\.host === "cloudflare" \? \{ candidates: \["public\/_redirects", "static\/_redirects", "_redirects"\]/);
  assert.match(action, /row\.mechanism !== "page_refresh"\) return redirectsTo/, "a forward on load is checked as one");
  const records = readFileSync("convex/siteRedirects.ts", "utf8");
  assert.match(records, /row\.delivery === "pending" \|\| row\.delivery === "not_delivered"/, "not delivered: tried again every week");
  assert.match(records, /row\.delivery !== "pentra_blog" \? \{ delivery: "pending" as const/, "a re-pointed redirect the site holds is written again");
  assert.match(readFileSync("convex/schema.ts", "utf8"), /v\.literal\("platform"\), v\.literal\("owner"\)/);
  assert.equal(wordpressRedirectKey("/Blog/Old-Guide/"), "/blog/old-guide", "matches the WordPress plugin's own form of a path");
});

test("images for live articles: a batch stops starting images in time, no provider call outlives the action, and reasons come back", () => {
  // Nov 5 2026: the first approved run made no image: each took longer than the batch allowed and the action hit its
  // ten-minute limit before recording one.
  const action = readFileSync("convex/actions/articleImages.ts", "utf8");
  assert.match(action, /export const IMAGE_BATCH = 6;\nexport const BATCH_TIME_MS = 5 \* 60_000;/);
  assert.match(action, /if \(Date\.now\(\) - started > BATCH_TIME_MS\) break;/);
  assert.match(action, /await withArticleExecutionBudget\(async \(\) => \{/, "every provider call ends inside the action's window");
  assert.match(action, /const remaining = want - tried;/, "pages a batch didn't reach go to the next batch");
  assert.match(action, /reasons: reasons\.slice\(0, 6\)/);
});

test("P357: no AI look decides whether a generated image is used; the prompt keeps writing out instead", async () => {
  // Nov 5 2026: the two-image trial after P356 made none: the look turned away all four attempts at 40-45/100 for
  // "recognizable objects that may imply context" and "visual metaphor may mislead". Rule 2a: fix the input, never gate.
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const store = pipeline.slice(pipeline.indexOf("async function storeReviewedImage("), pipeline.indexOf("/** Generate an AI hero image for an article."));
  assert.match(store, /if \(kind === "screenshot"\) \{/, "only a screenshot is looked at");
  const { buildHeroImagePrompt, buildSupportingImagePrompt, buildMediaReviewPrompt } = await import("../convex/lib/mediaQuality.ts");
  assert.throws(() => buildMediaReviewPrompt("hero", { title: "x" }), /Only screenshots/);
  const screenshot = buildMediaReviewPrompt("screenshot", { productName: "Quillpad", domain: "quillpad.example" });
  assert.match(screenshot, /Set passed to false only if it shows one of these: .*error page.*bot challenge, or a different website\. Otherwise set passed to true\./);
  for (const prompt of [buildHeroImagePrompt({ title: "Lead scoring", niche: "sales" }),
    buildSupportingImagePrompt({ title: "Lead scoring", primaryKeyword: "lead scoring", niche: "sales", sectionHeading: "Why", visualConcept: "a funnel" })]) {
    assert.match(prompt, /Do not show paper, documents, notes, books, signs, whiteboards, sticky notes or screens/);
  }
});

test("P358: a prepared image brings the live-page repair round forward, under the round's own spacing and slot rules", async () => {
  // Nov 5 2026: 30 images were made, but the round that places them had finished clean before any existed, so the next
  // round was a week away.
  const images = readFileSync("convex/articleImages.ts", "utf8");
  assert.match(images, /status: "ready", costMicroUsd: args\.costMicroUsd, createdAt: Date\.now\(\) \}\);\n    await bringRepairForward\(ctx, args\.siteId\);/);
  assert.match(images, /contentSchedule: \{ \.\.\.schedule, relatedRepairRetryAt: now \}/);
  const { relatedRepairAllowed, RELATED_REPAIR_VERSION } = await import("../convex/lib/contentCorrection.ts");
  const now = 1_793_900_000_000;
  const site = { serviceMode: "growth_first", autopilotEnabled: true, publishMethod: "github", contentSchedule: { autopilotSelectedAt: 1, autopublishConsentAt: 1,
    nextDeadlineAt: now + 12 * 3_600_000, relatedRepairAt: now - 3 * 3_600_000, relatedRepairCleanAt: now - 3_600_000, relatedRepairCleanVersion: RELATED_REPAIR_VERSION } };
  assert.equal(relatedRepairAllowed(site as never, now), false, "a clean round rests for a week");
  assert.equal(relatedRepairAllowed({ ...site, contentSchedule: { ...site.contentSchedule, relatedRepairRetryAt: now } } as never, now), true, "an image brings it forward");
  assert.equal(relatedRepairAllowed({ ...site, contentSchedule: { ...site.contentSchedule, relatedRepairRetryAt: now, nextDeadlineAt: now + 3_600_000 } } as never, now), false,
    "never close to a publishing slot");
});
