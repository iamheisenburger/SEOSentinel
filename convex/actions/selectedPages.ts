"use node";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256Hex, safeGitHubRepositoryPart, requireSafeGitHubDefaultBranch } from "../lib/publicationArtifact";
import { contentConnectionHash, confirmedContentProfileHash, selectedGitHubPath, parseSelectedMarkdown,
  selectedUrl, selectedUrlMatches, classicHtmlMarkdown, assertUnprotectedPage, contentConsentToken } from "../lib/contentSelection";
import { wordpressConditionalRequest } from "../lib/wordpressConditional";
import { safeFetchPublicText } from "../lib/safeOutbound";
import { verifyLivePublishedRevision } from "../lib/publishedRevision";
import { verifyLiveCorrectionBody } from "../lib/publishedCorrection";
import { renderSafePublicationHtml } from "../lib/safeMarkdownHtml";

const target = { siteId: v.id("sites"), path: v.optional(v.string()), wordpressId: v.optional(v.number()) };
export const revokeRemote = internalAction({ args: { siteId: v.id("sites"), pageId: v.id("pages"), version: v.number(), attempt: v.optional(v.number()) }, handler: async (ctx, args) => {
  const { attempt = 1, ...binding } = args;
  const context = await ctx.runQuery(internal.selectedPages.revocationContext, binding);
  let ok = false;
  try { if (context) { await wordpressConditionalRequest(context.site, "revoke", { id: context.resourceId, permission: context.permission }); ok = true; } } catch { /* Safe exact-page status below; never expose credentials or remote content. */ }
  await ctx.runMutation(internal.selectedPages.revocationResult, { ...binding, attempt, ok });
} });
async function renderedSnapshot(source: Awaited<ReturnType<typeof readSelectedSource>>) {
  const fetched = await safeFetchPublicText(source.url, { expectedHost: new URL(source.url).hostname, allowedContentTypes: [/^text\/html(?:;|$)/i] });
  const artifact = { title: source.title, slug: source.slug, markdown: source.markdown };
  verifyLivePublishedRevision({ expectedUrl: source.url, fetchedUrl: fetched.url, html: fetched.text, base: artifact, next: artifact, kind: "improve_snippet" });
  verifyLiveCorrectionBody({ html: fetched.text, renderedBaseParagraphs: [], renderedNext: renderSafePublicationHtml(source.markdown) });
  const head = fetched.text.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const title = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!title) throw new Error("Selected page has no verifiable rendered title");
  const meta = [...head.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]).find(tag => /\bname\s*=\s*["']description["']/i.test(tag));
  const description = meta?.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return { ...source, metaTitle: classicHtmlMarkdown(title), description: description ? classicHtmlMarkdown(description[1] ?? description[2]) : "" };
}
export async function readSelectedSource(site: Doc<"sites">, args: { path?: string; wordpressId?: number }) {
  if (site.publishMethod === "github") {
    if (!args.path || args.wordpressId !== undefined) throw new Error("Select one exact Markdown/MDX path");
    const slug = selectedGitHubPath(site, args.path), url = selectedUrl(site, slug);
    const owner = safeGitHubRepositoryPart(site.repoOwner, "owner"), repo = safeGitHubRepositoryPart(site.repoName, "repository"), branch = requireSafeGitHubDefaultBranch(site.repoDefaultBranch);
    if (!owner || !repo || !site.githubToken) throw new Error("GitHub destination is incomplete");
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${args.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, {
      headers: { Authorization: `Bearer ${site.githubToken}`, Accept: "application/vnd.github+json" }, redirect: "error", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Selected GitHub source unavailable (${response.status})`);
    const data = await response.json();
    if (data.type !== "file" || data.path !== args.path || data.encoding !== "base64" || !/^[a-f0-9]{40,64}$/.test(data.sha) || data.size > 350000 || typeof data.content !== "string") throw new Error("Unsupported selected GitHub file");
    const content = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
    const parsed = parseSelectedMarkdown(content, url); assertUnprotectedPage(slug, parsed.title, content);
    return { kind: "github" as const, path: args.path, slug, url, sourceRevision: data.sha as string,
      sourceContent: content, markdown: parsed.markdown, title: parsed.title, metaTitle: parsed.metaTitle,
      description: parsed.description, header: parsed.header };
  }
  if (site.publishMethod !== "wordpress" || args.path || !Number.isSafeInteger(args.wordpressId) || args.wordpressId! <= 0) throw new Error("Select one exact WordPress post/page ID");
  await wordpressConditionalRequest(site, "connection");
  const data = await wordpressConditionalRequest(site, "source", undefined, { id: String(args.wordpressId) });
  if (data.id !== args.wordpressId || !["post","page"].includes(data.type) || typeof data.slug !== "string" ||
    typeof data.title !== "string" || typeof data.content !== "string" || !/^[a-f0-9]{64}$/.test(data.revision) ||
    !selectedUrlMatches(site, data.slug, data.url)) throw new Error("WordPress source does not match the configured destination");
  assertUnprotectedPage(data.slug, data.title, data.content);
  return { kind: "wordpress" as const, resourceId: data.id as number, slug: data.slug as string, url: data.url as string,
    sourceRevision: data.revision as string, sourceContent: data.content as string, markdown: classicHtmlMarkdown(data.renderedContent ?? data.content),
    title: data.title as string, metaTitle: data.metadata?.title ?? data.title as string, description: data.metadata?.description ?? "" };
}
export const preview = action({ args: target, handler: async (ctx, args): Promise<{ title: string; url: string; revision: string; sourceHash: string; reviewToken: string; preview: string; supported: boolean }> => {
  const site = await ctx.runQuery(internal.selectedPages.selectionContext, { siteId: args.siteId });
  const source = await renderedSnapshot(await readSelectedSource(site, args));
  return { title: source.title, url: source.url, revision: source.sourceRevision, sourceHash: sha256Hex(source.sourceContent),
    reviewToken: contentConsentToken(site), preview: source.markdown.slice(0, 2000), supported: true };
} });
export const select = action({ args: { ...target, revision: v.string(), reviewToken: v.string(), confirm: v.boolean() }, handler: async (ctx, args): Promise<Id<"pages">> => {
  if (!args.confirm) throw new Error("Explicit selected-page permission required");
  const site = await ctx.runQuery(internal.selectedPages.selectionContext, { siteId: args.siteId });
  if (args.reviewToken !== contentConsentToken(site)) throw new Error("Business or destination changed since preview; review the current page again");
  const source = await renderedSnapshot(await readSelectedSource(site, args));
  if (source.sourceRevision !== args.revision) throw new Error("Source changed since preview; select the current version");
  let permission: string | undefined;
  if (source.kind === "wordpress") {
    // Recheck owner/current connection immediately before creating a remote grant.
    const current = await ctx.runQuery(internal.selectedPages.selectionContext, { siteId: args.siteId });
    if (contentConnectionHash(current) !== contentConnectionHash(site)) throw new Error("Selection connection changed");
    const grant = await wordpressConditionalRequest(site, "select", { id: source.resourceId, revision: source.sourceRevision, confirm: true });
    if (grant.revision !== source.sourceRevision || grant.id !== source.resourceId || !/^[a-f0-9]{64}$/.test(grant.permission)) throw new Error("WordPress selection receipt mismatch");
    permission = grant.permission;
  }
  return ctx.runMutation(internal.selectedPages.recordSelection, { siteId: site._id, connectionHash: contentConnectionHash(site),
    profileHash: confirmedContentProfileHash(site), source: { ...source, ...(permission ? { permission } : {}) } });
} });
