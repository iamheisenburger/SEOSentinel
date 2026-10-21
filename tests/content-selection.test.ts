import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeImprovement, assertUnprotectedPage, classicHtmlMarkdown, contentConnectionHash,
  confirmedContentProfileHash, parseSelectedMarkdown, selectedGitHubPath, selectedUrlMatches } from "../convex/lib/contentSelection.ts";
import { publicationDeliveryConfig } from "../convex/lib/publicationArtifact.ts";
import { verifyLiveSelectedRestoration } from "../convex/lib/publishedRevision.ts";
import { renderSafePublicationHtml } from "../convex/lib/safeMarkdownHtml.ts";

const site = { domain: "tenant.example", publishMethod: "github", repoOwner: "synthetic-owner", repoName: "website",
  repoDefaultBranch: "main", githubToken: "synthetic-only", urlStructure: "/blog/[slug]" };
const raw = '---\ntitle: "Useful customer guidance"\ncanonicalUrl: "https://tenant.example/blog/guide"\n---\n\nOriginal confirmed business facts.';
test("selected source rejects executable MDX, custom frontmatter/layouts, ambiguous metadata and escaping paths before consent", () => {
  assert.equal(parseSelectedMarkdown(raw, "https://tenant.example/blog/guide").title, "Useful customer guidance");
  for (const content of [raw + '\nimport Thing from "x"', raw + "\n<Custom />", raw + "\n{process.env.X}",
    raw.replace('title:', 'layout:'), raw.replace('title:', 'title: "Duplicate"\ntitle:'), raw.replace('title:', 'title: !unsafe\nother:')]) {
    assert.throws(() => parseSelectedMarkdown(content, "https://tenant.example/blog/guide"));
  }
  for (const path of ["../pricing.md", "content/blog/../../legal.md", "content/blog/nested/guide.mdx", "content/blog/guide.ts", "content/blog/%2e%2e.md"]) {
    assert.throws(() => selectedGitHubPath(site as never, path));
  }
  assert.equal(selectedGitHubPath(site as never, "content/blog/guide.mdx"), "guide");
});
// P143 (Oct 21 2026): the read-back rejected `<h1>` or `{}` even inside code, so an SEO article that names a
// tag in code could never be enrolled for improvement.
test("selected source treats code spans and blocks as text, and still rejects MDX in the prose", () => {
  const url = "https://tenant.example/blog/guide";
  const inCode = raw + "\n\nGive every page one `<h1>` and keep `{}` out of titles.\n\n```js\nimport x from \"y\";\nconst page = { title: \"<h1>\" };\n```\n\nDone.";
  assert.equal(parseSelectedMarkdown(inCode, url).title, "Useful customer guidance");
  for (const content of [inCode + "\n\nAn <h1> in the prose.", inCode + "\n\nA {value} in the prose.", inCode + "\n\nA <b in the prose",
    raw + "\n\nA template `{{ site.title }}` still runs in Liquid.", raw + "\n\nOne ` unmatched backtick then {danger}"]) {
    assert.throws(() => parseSelectedMarkdown(content, url), content.slice(-40));
  }
  const base = { title: "Guide", markdown: "Use one `<h1>` per page and confirm it in your template." };
  assert.ok(assertSafeImprovement(base, { ...base, markdown: base.markdown + "\n\n" + "Useful supported additional guidance ".repeat(15) }));
});
test("pricing, checkout/legal and explicitly protected pages cannot be selected", () => {
  for (const slug of ["pricing", "checkout", "privacy-policy", "terms-of-service", "legal"]) assert.throws(() => assertUnprotectedPage(slug, "Page", raw));
  assert.throws(() => assertUnprotectedPage("guide", "Guide", raw + "\npentra-protected: true"));
});
test("an article Pentra wrote is not a protected page because its title says terms or pricing", () => {
  const title = "Localized Keyword Research: Finding the Terms Local Buyers Use";
  assert.throws(() => assertUnprotectedPage("localized-keyword-research", title, raw), "a customer page with that title stays protected");
  assert.doesNotThrow(() => assertUnprotectedPage("localized-keyword-research", title, raw, { pentraCreated: true }));
  assert.doesNotThrow(() => assertUnprotectedPage("saas-pricing-pages", "SaaS Pricing Pages That Convert", raw, { pentraCreated: true }));
  // The explicit marker still protects Pentra's own article.
  assert.throws(() => assertUnprotectedPage("guide", "Guide", raw + "\npentra-protected: true", { pentraCreated: true }));
});
test("a verified article is recorded even when refresh enrollment refuses it", () => {
  const source = readFileSync("convex/contentWork.ts", "utf8");
  const verified = source.slice(source.indexOf("export async function contentWorkVerified"), source.indexOf("export async function closeContentWorkHold"));
  assert.match(verified, /try \{ await enrollVerifiedCreation\(ctx, site, article, job\); \}\s*catch/);
  assert.ok(verified.indexOf("enrollVerifiedCreation") < verified.indexOf('stage: "verified"'));
});
test("improvements preserve source/title and reject monitoring, no-op and destructive rewriting", () => {
  const base = { title: "Guide", markdown: "Original confirmed customer fact." };
  for (const next of [{ ...base }, { ...base, markdown: "Replacement prose." }, { title: "Different title", markdown: base.markdown + " word".repeat(60) }]) {
    assert.throws(() => assertSafeImprovement(base, next));
  }
  assert.ok(assertSafeImprovement(base, { ...base, markdown: base.markdown + "\n\n" + "Useful supported additional guidance ".repeat(15) }));
  assert.throws(() => assertSafeImprovement(base, { ...base, markdown: base.markdown + "Changed final sentence " + "word ".repeat(50) }));
});
test("GitHub configuration, token and business-fact changes invalidate the exact consent binding", () => {
  const original = contentConnectionHash(site as never);
  for (const change of [{ repoOwner: "another-owner" }, { repoName: "other-repo" }, { repoDefaultBranch: "release" },
    { githubToken: "changed-synthetic-only" }, { publisherConnectionGeneration: 1 }, { domain: "other.example" }]) {
    assert.notEqual(contentConnectionHash({ ...site, ...change } as never), original);
  }
  const profile = confirmedContentProfileHash(site as never);
  assert.notEqual(confirmedContentProfileHash({ ...site, pricingInfo: "Confirmed first-party terms changed" } as never), profile);
});
test("WordPress supports exact-origin selected posts/pages and conventional trailing-slash publication paths", () => {
  const wp = { ...site, publishMethod: "wordpress", wpUrl: "https://tenant.example", urlStructure: "/blog/[slug]/" };
  assert.equal(publicationDeliveryConfig(wp).urlStructure, "/blog/[slug]/");
  assert.ok(selectedUrlMatches(wp as never, "guide", "https://tenant.example/guide/"));
  for (const url of ["https://other.example/guide/", "http://tenant.example/guide/", "https://tenant.example/guide/?secret=x", "https://user:pass@tenant.example/guide/"]) assert.equal(selectedUrlMatches(wp as never, "guide", url), false);
  assert.equal(classicHtmlMarkdown("<p>Preserve <strong>confirmed facts</strong>.</p>\n<h2>Review</h2>"), "Preserve **confirmed facts**.\n\n\n\n\n## Review");
  for (const html of ['<!-- wp:paragraph --><p>Block</p>', '<div class="layout">Layout</div>', '[custom_form]', '<script>alert(1)</script>']) assert.throws(() => classicHtmlMarkdown(html));
});

test("selected restoration requires exact original metadata, canonical and complete visible prose", () => {
  const url = "https://tenant.example/guide/", next = { title: "Useful guide", slug: "guide", metaTitle: "Useful guide – Customer site", metaDescription: "",
    markdown: "Preserve the confirmed original guidance and its full visible explanation. Ask the authorized owner to review uncertainties before acting on an unsupported conclusion." };
  const base = { ...next, markdown: next.markdown + "\n\nA later addition is intentionally removed during this owner-requested rollback." };
  const html = `<html><head><title>${next.metaTitle}</title><link rel="canonical" href="${url}" /></head><body><main><h1>${next.title}</h1>${renderSafePublicationHtml(next.markdown)}</main></body></html>`;
  const verify = (markup: string) => verifyLiveSelectedRestoration({ expectedUrl: url, fetchedUrl: url, base, next, html: markup });
  verify(html);
  for (const bad of [html.replace(url, 'https://other.example/guide/'), html.replace(next.metaTitle, 'Wrong head title'),
    html.replace('</head>', '<meta name="description" content="invented" /></head>'), html.replace('confirmed original guidance', 'different guidance'),
    html.replace('<main>', '<main hidden>')]) assert.throws(() => verify(bad));
});
