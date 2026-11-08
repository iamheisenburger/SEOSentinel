"use node";
/** Pentra Answers (Nov 2026): publishing an answer page. To the site's own blog through its existing connection (GitHub
 * with the blog's own layout, WordPress, Webflow, Shopify, Ghost, a signed webhook) or to the hosted answers address; then
 * checked live, and submitted to IndexNow and (with the owner's Search Console) Google. */
import { randomBytes, createHmac } from "node:crypto";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { answerDeliveryKey, githubAnswerFile, hostedPageUrl, indexNowRequest, publicPageUrl, urlStructureOf } from "../lib/answerPublishing";
import { renderSafePublicationHtml } from "../lib/safeMarkdownHtml";
import { safeRequestPublicHttps } from "../lib/safeOutbound";
import { publishToCms, type CmsRequest, type CmsSite } from "../lib/cmsPublishers";
import { cmsUrlStructure, isApiCmsMethod } from "../lib/cmsDestinations";
import { hostOf } from "../lib/answerEngine";

const cmsRequest: CmsRequest = async (url, init) => {
  const target = new URL(url);
  const response = await safeRequestPublicHttps(target.href, { method: init.method, expectedHost: target.hostname, headers: init.headers, body: init.body,
    maxBytes: 2_000_000, allowedContentTypes: [/^application\/json(?:;|$)/i] });
  return { status: response.status, text: response.text };
};

type Published = { url: string; target: string; receipt: Record<string, unknown> };

export const publishPage = internalAction({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const context = await ctx.runQuery(internal.answerPublish.publishContext, { pageId });
  if (!context) return;
  if (!(await ctx.runMutation(internal.answerPublish.markPublishing, { pageId }))) return;
  const { page, site, previous } = context;
  try {
    const published = await publishTo(site, page, previous);
    await ctx.runMutation(internal.answerPublish.markPublished, { pageId, url: published.url, target: published.target, receipt: JSON.stringify(published.receipt) });
    await ctx.scheduler.runAfter(published.target === "hosted" ? 5_000 : 120_000, internal.actions.answerPublish.verifyAndIndex, { pageId, attempt: 0 });
  } catch (error) {
    await ctx.runMutation(internal.answerPublish.markPublishFailed, { pageId, error: error instanceof Error ? error.message : String(error) });
  }
} });

async function publishTo(site: Doc<"sites">, page: Doc<"answer_pages">, previous: Doc<"answer_pages"> | null): Promise<Published> {
  const deliveryKey = answerDeliveryKey(page._id, page.version);
  const firstPublishedAt = previous?.publishedAt ?? Date.now();
  const forPublish = { title: page.title, slug: page.slug, metaDescription: page.metaDescription, markdown: page.markdown, sources: page.sources,
    firstPublishedAt, deliveryKey };
  const previousReceipt = previous?.publishReceipt ? safeJson(previous.publishReceipt) : null;
  const publishing = site.answers?.publishing;
  if (publishing?.target === "hosted") {
    if (!publishing.hostedDomain) throw new Error("Choose the hosted address (like answers.yourdomain.com) in Settings first.");
    if (publishing.hostedStatus !== "live") throw new Error(`${publishing.hostedDomain} isn't pointing at Pentra yet. Add the DNS record from Settings; Pentra publishes as soon as it's live.`);
    return { url: hostedPageUrl(publishing.hostedDomain, page.slug), target: "hosted", receipt: { method: "hosted", deliveryKey } };
  }
  const method = site.publishMethod ?? "manual";
  if (method === "github") return await publishToGithub(site, forPublish, previousReceipt);
  if (method === "wordpress") return await publishToWordPress(site, forPublish, previousReceipt);
  if (method === "webhook") return await publishToWebhook(site, forPublish);
  if (isApiCmsMethod(method)) {
    const structure = cmsUrlStructure(site);
    if (!structure) throw new Error("Reconnect your site's publishing in Settings: its blog collection isn't set.");
    const url = publicPageUrl(site.domain, structure, page.slug);
    const receipt = await publishToCms({ site: site as unknown as CmsSite, article: { title: page.title, slug: page.slug, html: renderSafePublicationHtml(page.markdown),
      metaTitle: page.title, metaDescription: page.metaDescription }, deliveryKey, contentHash: page.contentHash, publicUrl: url, urlStructure: structure,
      hadPriorAttempt: false, beforeExternalMutation: async () => {}, request: cmsRequest });
    return { url: receipt.url || url, target: method, receipt: { method, deliveryKey, externalId: receipt.externalId } };
  }
  throw new Error("Choose where your pages publish in Settings: connect your site (WordPress, GitHub, Webflow, Shopify, Ghost, webhook) or use answers.yourdomain.com.");
}

const safeJson = (text: string): Record<string, unknown> | null => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } };

async function githubRequest(token: string, url: string, init: { method: string; body?: unknown }) {
  const response = await fetch(url, { method: init.method, signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}) }, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
  const text = await response.text();
  return { status: response.status, json: safeJson(text) ?? {}, text };
}

/** One file committed to the repository's default branch through the Contents API: created, or updated in place when the
 * page is a rewrite (its file is the previous version's). */
async function commitFile(token: string, owner: string, repo: string, branch: string, path: string, content: string, message: string) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const existing = await githubRequest(token, `${base}?ref=${encodeURIComponent(branch)}`, { method: "GET" });
  const sha = existing.status === 200 && typeof existing.json.sha === "string" ? existing.json.sha : undefined;
  const put = await githubRequest(token, base, { method: "PUT", body: { message, branch, content: Buffer.from(content, "utf8").toString("base64"), ...(sha ? { sha } : {}) } });
  if (put.status !== 200 && put.status !== 201) throw new Error(`GitHub refused the commit (${put.status}): ${String(put.json.message ?? put.text).slice(0, 200)}`);
  const commit = (put.json.commit ?? {}) as { sha?: string; html_url?: string };
  return { sha: commit.sha ?? "", commitUrl: commit.html_url ?? "" };
}

async function publishToGithub(site: Doc<"sites">, page: Parameters<typeof githubAnswerFile>[0], previous: Record<string, unknown> | null): Promise<Published> {
  const token = site.githubToken, owner = site.repoOwner, repo = site.repoName;
  if (!token || !owner || !repo) throw new Error("Connect your GitHub repository in Settings first.");
  let branch = site.repoDefaultBranch;
  if (!branch) {
    const info = await githubRequest(token, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: "GET" });
    if (info.status !== 200) throw new Error(`GitHub didn't let Pentra read ${owner}/${repo} (${info.status}). Reconnect it in Settings.`);
    branch = typeof info.json.default_branch === "string" ? info.json.default_branch : "main";
  }
  const file = githubAnswerFile(page, site);
  const path = typeof previous?.path === "string" ? previous.path : file.path;
  const commit = await commitFile(token, owner, repo, branch, path, file.content, `Pentra answer page: ${page.title}`);
  return { url: file.url, target: "github", receipt: { method: "github", deliveryKey: page.deliveryKey, path, sha: commit.sha, commitUrl: commit.commitUrl } };
}

async function publishToWordPress(site: Doc<"sites">, page: Parameters<typeof githubAnswerFile>[0], previous: Record<string, unknown> | null): Promise<Published> {
  if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) throw new Error("Connect WordPress in Settings first (site address, user and application password).");
  const origin = new URL(/^https?:\/\//.test(site.wpUrl) ? site.wpUrl : `https://${site.wpUrl}`).origin;
  const id = typeof previous?.postId === "number" ? previous.postId : null;
  const target = new URL(`${origin}/wp-json/wp/v2/posts${id ? `/${id}` : ""}`);
  const response = await safeRequestPublicHttps(target.href, { method: "POST", expectedHost: target.hostname,
    headers: { Authorization: `Basic ${Buffer.from(`${site.wpUsername}:${site.wpAppPassword}`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: page.title, slug: page.slug, status: "publish", excerpt: page.metaDescription, content: renderSafePublicationHtml(page.markdown) }),
    maxBytes: 2_000_000, allowedContentTypes: [/^application\/json(?:;|$)/i] });
  if (response.status < 200 || response.status >= 300) throw new Error(`WordPress refused the post (${response.status}): ${response.text.slice(0, 200)}`);
  const post = safeJson(response.text) ?? {};
  const url = typeof post.link === "string" ? post.link : publicPageUrl(site.domain, urlStructureOf(site), page.slug);
  return { url, target: "wordpress", receipt: { method: "wordpress", deliveryKey: page.deliveryKey, postId: typeof post.id === "number" ? post.id : id } };
}

async function publishToWebhook(site: Doc<"sites">, page: Parameters<typeof githubAnswerFile>[0]): Promise<Published> {
  if (!site.webhookUrl || !site.webhookSecret) throw new Error("Add your webhook address and signing secret in Settings first.");
  const endpoint = new URL(site.webhookUrl);
  const structure = urlStructureOf(site);
  const url = publicPageUrl(site.domain, structure, page.slug);
  const payload = JSON.stringify({ event: "pentra.article.publish.v1", kind: "answer_page", deliveryKey: page.deliveryKey, title: page.title, slug: page.slug,
    urlPath: new URL(url).pathname, urlStructure: structure, markdown: page.markdown, html: renderSafePublicationHtml(page.markdown),
    metaDescription: page.metaDescription, date: new Date(page.firstPublishedAt).toISOString(), sources: page.sources.map((s) => ({ url: s.url, title: s.title })) });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", site.webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  const response = await safeRequestPublicHttps(endpoint.href, { method: "POST", expectedHost: endpoint.hostname,
    headers: { "Content-Type": "application/json", "Idempotency-Key": page.deliveryKey, "X-Pentra-Delivery-Key": page.deliveryKey,
      "X-Pentra-Timestamp": timestamp, "X-Pentra-Signature-256": `sha256=${signature}` }, body: payload });
  if (response.status < 200 || response.status >= 300) throw new Error(`Your webhook refused the page (${response.status}): ${response.text.slice(0, 200)}`);
  const reply = safeJson(response.text) ?? {};
  return { url: typeof reply.url === "string" && /^https:\/\//.test(reply.url) ? reply.url : url, target: "webhook", receipt: { method: "webhook", deliveryKey: page.deliveryKey } };
}

/** The page checked live (GitHub sites take a few minutes to build), then sent to IndexNow and Google. Tries for about
 * two hours; after that it says plainly it isn't live yet. */
export const verifyAndIndex = internalAction({ args: { pageId: v.id("answer_pages"), attempt: v.number() }, handler: async (ctx, { pageId, attempt }) => {
  const page = await ctx.runQuery(internal.answerPublish.pageForIndexing, { pageId });
  if (!page || !page.publishedUrl) return;
  const live = await isLive(page.publishedUrl, page.title);
  const delays = [120_000, 300_000, 600_000, 1_800_000, 3_600_000];
  if (!live) {
    if (attempt < delays.length) { await ctx.scheduler.runAfter(delays[attempt], internal.actions.answerPublish.verifyAndIndex, { pageId, attempt: attempt + 1 }); return; }
    await ctx.runMutation(internal.answerPublish.recordIndexing, { pageId, liveIssue: `Not live yet at ${page.publishedUrl}. Check that your site rebuilt after Pentra's publish.` });
    return;
  }
  const indexNow = await submitIndexNow(ctx, page.siteId, page.publishedUrl, page.target, page.site);
  const sitemap = page.target === "hosted" ? { submitted: false } : await ctx.runAction(internal.actions.gscSync.submitAnswersSitemap, { siteId: page.siteId });
  await ctx.runMutation(internal.answerPublish.recordIndexing, { pageId, ...(indexNow ? { indexNow } : {}), sitemap: sitemap.submitted });
} });

async function isLive(url: string, title: string): Promise<boolean> {
  try {
    const target = new URL(url);
    const response = await safeRequestPublicHttps(target.href, { method: "GET", expectedHost: target.hostname, maxBytes: 3_000_000,
      allowedContentTypes: [/^text\/html(?:;|$)/i] });
    const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
    const html = response.text.toLowerCase();
    return response.status === 200 && words.filter((w) => html.includes(w)).length >= Math.min(2, words.length);
  } catch { return false; }
}

/** IndexNow needs the site's key served on the same host: always so on the hosted address; on a GitHub-published site
 * Pentra commits the key file once (into public/, which Next.js, Astro and similar serve at the root). Other platforms
 * rely on Google and their own sitemaps. */
async function submitIndexNow(ctx: Pick<ActionCtx, "runMutation">, siteId: Id<"sites">, url: string, target: string,
  site: { domain: string; key: string | null; hosts: string[]; githubToken?: string; repoOwner?: string; repoName?: string; repoDefaultBranch?: string; framework?: string }):
  Promise<string | null> {
  const host = hostOf(url);
  let key = site.key;
  if (!key) { key = randomBytes(16).toString("hex"); await ctx.runMutation(internal.answerPublish.setIndexNowKey, { siteId, key }); }
  if (!site.hosts.includes(host)) {
    if (target === "hosted") await ctx.runMutation(internal.answerPublish.setIndexNowKey, { siteId, key, host });
    else if (target === "github" && site.githubToken && site.repoOwner && site.repoName && ["nextjs", "astro", undefined].includes(site.framework)) {
      try {
        await commitFile(site.githubToken, site.repoOwner, site.repoName, site.repoDefaultBranch ?? "main", `public/${key}.txt`, key, "Pentra: IndexNow key");
        await ctx.runMutation(internal.answerPublish.setIndexNowKey, { siteId, key, host });
        return "key_committed";
      } catch { return "key_not_placed"; }
    } else return null;
  }
  const keyLocation = target === "hosted" ? `https://${host}/pentra-indexnow.txt` : `https://${host}/${key}.txt`;
  const request = indexNowRequest(host, key, keyLocation, [url]);
  try {
    const response = await fetch(request.url, { method: "POST", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(request.body) });
    return response.status === 200 || response.status === 202 ? "submitted" : `refused_${response.status}`;
  } catch { return "unreachable"; }
}

/** answers.yourdomain.com: attached to Pentra's Vercel project (when Pentra holds a Vercel token), then checked until the
 * owner's DNS record points at it. */
export const attachHostedDomain = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const state = await ctx.runQuery(internal.answerPublish.hostedState, { siteId });
  if (!state) return;
  // The hosted address serves the site's IndexNow key from the start, so its first page is submitted the moment it's live.
  await ctx.runMutation(internal.answerPublish.setIndexNowKey, { siteId, key: randomBytes(16).toString("hex"), host: state.host });
  const token = process.env.VERCEL_TOKEN, project = process.env.VERCEL_PROJECT_ID, team = process.env.VERCEL_TEAM_ID;
  if (!token || !project) {
    await ctx.runMutation(internal.answerPublish.hostedDomainState, { siteId, status: "pending_dns", error: "Pentra is finishing hosted-address setup on its side." });
    return;
  }
  const qs = team ? `?teamId=${encodeURIComponent(team)}` : "";
  const add = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/domains${qs}`, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: state.host }), signal: AbortSignal.timeout(20_000) });
  if (!add.ok && add.status !== 409) {
    await ctx.runMutation(internal.answerPublish.hostedDomainState, { siteId, status: "error", error: `Pentra couldn't attach ${state.host} (${add.status}).` });
    return;
  }
  await ctx.runAction(internal.actions.answerPublish.checkHostedDomain, { siteId });
} });

export const checkHostedDomain = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const state = await ctx.runQuery(internal.answerPublish.hostedState, { siteId });
  if (!state) return;
  const token = process.env.VERCEL_TOKEN, team = process.env.VERCEL_TEAM_ID;
  if (!token) return;
  const qs = team ? `?teamId=${encodeURIComponent(team)}` : "";
  const config = await fetch(`https://api.vercel.com/v6/domains/${encodeURIComponent(state.host)}/config${qs}`, { headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000) }).then((r) => r.ok ? r.json() as Promise<{ misconfigured?: boolean }> : null).catch(() => null);
  // Live: Vercel sees the DNS record, and the address answers over HTTPS through Pentra (any non-server-error reply).
  const live = config !== null && config.misconfigured === false && await isReachable(`https://${state.host}/pentra-indexnow.txt`);
  await ctx.runMutation(internal.answerPublish.hostedDomainState, { siteId, status: live ? "live" : "pending_dns",
    ...(live ? {} : { error: `Add a CNAME record for ${state.host} pointing to cname.vercel-dns.com.` }) });
  if (live) await ctx.runMutation(internal.answerPublish.retryHostedPublishes, { siteId });
} });

async function isReachable(url: string): Promise<boolean> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15_000) }); return r.status < 500; } catch { return false; }
}
