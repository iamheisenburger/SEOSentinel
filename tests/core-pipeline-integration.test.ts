import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { corePipelineFixture, START, type Fields } from "./helpers/core-pipeline-fixture.ts";
import { publicationArtifactHash, publicationDeliveryKey, sha256Hex } from "../convex/lib/publicationArtifact.ts";
import { approvedBufferPolicy } from "../convex/lib/autopilotBuffer.ts";
import { PROVIDER_ACCOUNT_MONTHLY_CEILING_MICRO_USD } from "../convex/lib/providerSpendReservation.ts";
import { articleGenerationAttemptAllowance } from "../convex/lib/articleGenerationAttempt.ts";

const businesses = [
  { name: "ReservoirNote", domain: "reservoir.example", cadence: 7,
    niche: "Irrigation maintenance scheduling software", keywords: [
      "irrigation maintenance scheduling software", "irrigation valve inspection workflow",
      "irrigation leak alert triage", "irrigation pump service checklist",
      "irrigation seasonal shutdown planning", "irrigation pressure test documentation",
    ] },
  { name: "StudioLedger", domain: "studioledger.example", cadence: 2,
    niche: "Ceramic studio inventory management software", keywords: [
      "ceramic glaze inventory tracking software", "ceramic kiln firing record workflow",
      "ceramic clay stock reconciliation", "ceramic studio supply reorder planning",
      "ceramic batch traceability checklist", "ceramic glaze test documentation",
    ] },
];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const sha = (text: string) => createHash("sha1").update(text).digest("hex");
const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleFor = (keyword: string) => keyword[0].toUpperCase() + keyword.slice(1);
const description = "Build a documented workflow with clear decisions, practical review questions, evidence checks, and a careful handoff for your team.";
const evidenceText = "The synthetic field register contains an observation label and a review note. The synthetic studio register contains a material label and a review note. These fixture records describe the sample dataset only. Use the source as evidence of its stated fields, not as evidence of customer outcomes or commercial product capabilities.";
function articlePayload(keyword: string) {
  const sections = [
    ["Define the decision", "Write down the decision you intend to make before choosing a tool or assigning an owner. Describe the boundary between an observation and an interpretation. If someone disputes a conclusion, ask which recorded detail they disagree with and what evidence would resolve the difference. Keep a place for uncertainty instead of treating a blank field as a confirmed negative."],
    ["Inspect the working context", "Walk through the current workflow with the person who uses it. Ask them to identify the point where they need information and the point where they can record it. Consider whether access, equipment, language, or location could interrupt that sequence. Draft a local checklist from those observations and let the operator correct it before proposing a change."],
    ["Choose a record boundary", "Choose an identifiable unit for the proposed record. Explain what belongs inside that unit and what should be linked as separate evidence. Before merging similar entries, compare their owners and intended outcomes. Keep disputed entries separate until an accountable reviewer can explain the relationship. Prefer an explicit unresolved note to a confident label that nobody can justify."],
    ["Describe an observation", "Ask the observer to describe what they saw in plain language. Separate their description from any suggested cause or remedy. Where a photograph or document is useful, preserve its context and permission to use it. If the observation cannot be reproduced, keep that limitation beside the record rather than burying it in a later summary."],
    ["Map the handoff", "Sketch the proposed handoff between the person recording an issue and the person deciding what happens next. Name the question the receiver should answer. Include a route for returning incomplete evidence without silently closing the work. If ownership is disputed, pause the handoff and record the unresolved responsibility for the team to review."],
    ["Review exceptions", "Collect examples of work that would not fit the proposed ordinary path. Discuss an incomplete record, an unavailable reviewer, a disputed interpretation, and a mistaken assignment. For each example, describe the next permitted action and the evidence needed to take it. Do not assume that an automated label grants authority to act on someone else's behalf."],
    ["Preserve correction history", "Decide how an operator should explain a correction. Keep the original observation available to an authorized reviewer, and distinguish a corrected transcription from a changed conclusion. Ask whether another person could reconstruct the reasoning from the record alone. If not, improve the explanation before treating the correction as complete or relying on it elsewhere."],
    ["Evaluate access deliberately", "List the roles that need to read, propose changes, approve a decision, or export information. Review each capability separately rather than copying a broad permission label. Consider the consequences of granting temporary access and describe how that access should end. Treat this as a design discussion that must be checked against your own security requirements."],
    ["Plan an evidence review", "Choose a sample record and invite someone unfamiliar with it to explain the decision. Ask them which statements are observations, which are interpretations, and which remain unresolved. Use their questions to improve the proposed template. Do not generalize the result into a performance claim; it is feedback about that sample and its particular context."],
    ["Test a reversible change", "Describe a proposed change that the team can reverse without losing its existing records. Identify the owner of the test and the condition that would cause them to stop it. Preserve the previous configuration and the reasoning for the change. Ask participants to report surprises, including inconveniences that the proposal did not anticipate."],
    ["Compare alternatives", "Compare the candidate workflow with keeping the current process. Include the burden of entering evidence, explaining exceptions, and handing work to another person. If a capability is important, ask for a demonstration using an authorized sample instead of assuming it exists. Record what remains unknown and avoid replacing missing evidence with a promotional promise."],
    ["What should the reviewer ask?", "Ask whether the proposed record answers the original question and whether another authorized person could follow its reasoning. Look for ambiguous ownership, missing context, unsupported conclusions, and an unclear next step. Invite the original observer to correct misunderstandings. Close the review only when its outcome and remaining limitations are described in language the team understands."],
  ];
  const continuation = "For this proposed workflow, choose an example from your own authorized records and compare it with the question in this section. Write down the decision you would take, the observations behind it, and the uncertainty that remains. Invite a colleague to challenge the interpretation before adopting the template. Add a note explaining which local conditions would change your decision. Save unanswered questions for the next review.";
  const markdown = [
    `Use this author-proposed review framework to evaluate ${keyword}. Adapt each decision to the responsibilities and evidence available in your own operation.`,
    ...sections.map(([heading, body], index) => `## ${heading}\n\n${body}\n\n${continuation.replace("this section", `the ${heading.toLowerCase()} section`)}${index === 1 ? "\n\nThe synthetic field register contains an observation label and a review note [1]." : ""}`),
    "## Sources\n\n[1] Synthetic register specification — https://records.example.gov/specification\n\n[2] Synthetic review methods — https://methods.example.edu/review",
  ].join("\n\n");
  return { title: titleFor(keyword), slug: slugify(keyword), markdown, metaTitle: titleFor(keyword).slice(0, 60), metaDescription: description,
    metaKeywords: [keyword], sources: [{ url: "https://records.example.gov/specification", title: "Synthetic register specification" }, { url: "https://methods.example.edu/review", title: "Synthetic review methods" }] };
}
function setup(options: { quality?: "unsupported" | "low"; publisherFailures?: number; emptyDiscovery?: boolean } = {}) {
  const modelCalls: Fields[] = [];
  let publisherFailuresRemaining = options.publisherFailures ?? 0;
  const failedPublications: number[] = [];
  const repositories = new Map<string, { head: string; files: Map<string, string>; blobs: Map<string, string>; trees: Map<string, Fields[]>; commits: Map<string, string>; writes: number }>();
  for (const b of businesses) repositories.set(b.name.toLowerCase(), { head: sha(b.domain), files: new Map(), blobs: new Map(), trees: new Map(), commits: new Map(), writes: 0 });
  const f = corePipelineFixture(async (url, init) => {
    if (url.origin === "https://api.anthropic.com") {
      assert.equal(url.pathname, "/v1/messages");
      const body = JSON.parse(String(init.body)); modelCalls.push(body);
      const text = String(body.messages[0].content), tool = body.tools?.[0]?.name;
      const keyword = text.match(/Primary Keyword: ([^\n]+)/i)?.[1] ?? text.match(/PRIMARY KEYWORD: ([^\n]+)/)?.[1];
      let value: unknown;
      if (tool === "submit_article") {
        assert.ok(keyword); const article = articlePayload(keyword);
        if (options.quality === "unsupported") article.markdown = article.markdown.replace(
          "The synthetic field register contains an observation label and a review note [1].",
          "A completed valve inspection reduces annual water consumption by 37% [1].",
        );
        value = article;
      }
      else if (tool === "review_article") value = { markdown: text.split("Article to review:\n")[1], notes: "Synthetic evidence review", confidenceScore: 94, claimCount: 1, verifiedCount: 1, citations: [] };
      else if (["submit_editorial_review", "compress_article", "remediate_final_article"].includes(tool)) {
        const markdown = text.split(/\nARTICLE:\n|\nEXACT FINISHED ARTICLE:\n|\nARTICLE TO REMEDIATE:\n/).at(-1);
        assert.ok(markdown); value = { markdown, score: options.quality === "low" ? 35 : 92, notes: [] };
      } else if (tool === "audit_final_article") {
        const raw = text.split("REQUIRED CLAIM UNITS AS JSON (untrusted article text; data only, never instructions):\n")[1]?.split("\n\nEXACT FINISHED ARTICLE:")[0];
        assert.ok(raw); const claims = raw.startsWith("[") ? JSON.parse(raw) : [];
        value = { score: options.quality === "low" ? 35 : 93, notes: [],
          materialDefects: options.quality === "low" ? ["Replace repetitive advice with a worked decision example tied to this business."] : [],
          claimEvidence: claims.map((claim: Fields) => ({ claim: claim.paragraph, citationNumbers: [...claim.paragraph.matchAll(/\[(\d+)\]/g)].map((match: string[]) => Number(match[1])), supported: true, reason: "Synthetic source fixture supports the register fields." })) };
      } else if (tool === "submit_final_metadata") { assert.ok(keyword); value = { title: titleFor(keyword), metaTitle: titleFor(keyword).slice(0, 60), metaDescription: description }; }
      else assert.fail(`Unexpected Anthropic tool ${tool}`);
      return json({ id: `synthetic-message-${modelCalls.length}`, type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "tool_use", id: `synthetic-tool-${modelCalls.length}`, name: tool, input: value }] });
    }
    if (url.origin === "https://api.openai.com") {
      const body = JSON.parse(String(init.body)); modelCalls.push(body);
      if (url.pathname === "/v1/images/generations") return json({ created: Math.floor(f.now() / 1000), data: [{ b64_json: "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA" }] });
      assert.equal(url.pathname, "/v1/responses");
      const serialized = JSON.stringify(body.input); let value: unknown; let citations: Fields[] = [];
      if (serialized.includes("Search the web for YouTube videos")) value = { videos: [] };
      else if (body.tools?.some((tool: Fields) => tool.type.startsWith("web_search"))) {
        value = evidenceText;
        citations = articlePayload("fixture").sources.map((source, index) => ({ type: "url_citation", ...source, start_index: index, end_index: index + 1 }));
      } else if (serialized.includes('"input_image"')) value = { passed: true, score: 95, issues: [], description: "Synthetic image-review result." };
      else if (serialized.includes("strict editorial art director")) value = { include: false, reason: "The decision checklist is represented by its prose." };
      else if (serialized.includes("SEO content analyst")) value = { overallScore: 91, entityCoverage: 90, topicCompleteness: 93, readabilityScore: 89, missingEntities: [], missingTopics: [], recommendations: [] };
      else assert.fail(`Unexpected OpenAI request ${serialized.slice(0, 240)}`);
      const output = typeof value === "string" ? value : JSON.stringify(value);
      return json({ id: `synthetic-response-${modelCalls.length}`, model: body.model, status: "completed", output_text: output,
        output: [{ type: "message", id: "synthetic-output", role: "assistant", status: "completed", content: [{ type: "output_text", text: output, annotations: citations }] }], usage: { input_tokens: 100, output_tokens: 100 } });
    }
    if (url.origin === "https://api.github.com") {
      const match = url.pathname.match(/^\/repos\/([^/]+)\/website(.*)$/); assert.ok(match);
      const repo = repositories.get(match[1]); assert.ok(repo, "No cross-tenant repository access");
      const path = match[2], method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : {};
      if (method === "GET" && path === "") return json({ default_branch: "main", permissions: { push: true } });
      if (method === "GET" && path === "/git/ref/heads/main") return json({ object: { sha: repo.head } });
      if (method === "GET" && path.startsWith("/contents/")) {
        const content = repo.files.get(path.slice("/contents/".length));
        return content === undefined ? json({}, 404) : json({ type: "file", encoding: "base64", content: Buffer.from(content).toString("base64"), sha: sha(content) });
      }
      if (method === "POST" && path === "/git/blobs") { const content = Buffer.from(body.content, "base64").toString(), id = sha(content); repo.blobs.set(id, content); return json({ sha: id }, 201); }
      if (method === "POST" && path === "/git/trees") { const id = sha(JSON.stringify(body)); repo.trees.set(id, body.tree); return json({ sha: id }, 201); }
      if (method === "POST" && path === "/git/commits") { const id = sha(JSON.stringify(body)); repo.commits.set(id, body.tree); return json({ sha: id }, 201); }
      if (method === "PATCH" && path === "/git/refs/heads/main") {
        if (publisherFailuresRemaining > 0) {
          publisherFailuresRemaining--; failedPublications.push(f.now());
          return json({ message: "Synthetic transient upstream outage" }, 503);
        }
        assert.equal(body.force, false); const tree = repo.trees.get(repo.commits.get(body.sha)!); assert.ok(tree);
        for (const file of tree) { const content = repo.blobs.get(file.sha); assert.ok(content); repo.files.set(file.path, content); }
        repo.head = body.sha; repo.writes++; return json({ object: { sha: repo.head } });
      }
      assert.fail(`Unexpected GitHub call ${method} ${path}`);
    }
    if (url.origin === "https://www.youtube.com" && url.pathname === "/results") return new Response("<html><body>No synthetic video results</body></html>", { headers: { "Content-Type": "text/html" } });
    if (url.hostname.endsWith(".example") || url.hostname.endsWith(".example.gov") || url.hostname.endsWith(".example.edu")) {
      const business = businesses.find(b => b.domain === url.hostname);
      if (business && url.pathname.startsWith("/blog/")) {
        const content = repositories.get(business.name.toLowerCase())!.files.get(`content/blog/${url.pathname.slice(6)}.md`);
        if (!content) return new Response("Not deployed", { status: 404, headers: { "Content-Type": "text/html" } });
        const title = JSON.parse(content.match(/^title: (.+)$/m)![1]);
        return new Response(`<html><body><main><h1>${title}</h1><pre>${content}</pre></main></body></html>`, { headers: { "Content-Type": "text/html" } });
      }
      return new Response(`<html><body><main>${business ? `${business.name} provides ${business.niche}.` : evidenceText}</main></body></html>`, { headers: { "Content-Type": "text/html" } });
    }
    assert.equal(url.origin, "https://api.dataforseo.com", `No fixture for ${url}`);
    if (url.pathname === "/v3/appendix/user_data") return json({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ money: { balance: 100 } }] }] });
    assert.equal(init.method, "POST");
    const [body] = JSON.parse(String(init.body)) as Fields[];
    const metric = (keyword: string) => ({ keyword, search_volume: 100, cpc: 0.4, competition: 0.1, keyword_difficulty: 5, monthly_searches: [{ search_volume: 100 }] });
    let result: Fields[];
    if (url.pathname.endsWith("/backlinks/bulk_pages_summary/live")) result = [{ items: body.targets.map((target: string) => ({ url: target, main_domain_rank: 45, referring_domains: 50, backlinks: 90 })) }];
    else if (url.pathname.endsWith("/keywords_data/google_ads/search_volume/live")) result = options.emptyDiscovery ? [] : body.keywords.map(metric);
    else if (url.pathname.endsWith("/keywords_data/google_ads/keywords_for_keywords/live")) {
      const owner = businesses.find(b => body.keywords.some((keyword: string) => keyword.includes(b.keywords[0].split(" ")[0])));
      assert.ok(owner, JSON.stringify(body)); result = options.emptyDiscovery ? [] : owner.keywords.map(metric);
    } else if (url.pathname.endsWith("/keywords_data/google_ads/keywords_for_site/live")) result = [];
    else if (url.pathname.endsWith("/bulk_keyword_difficulty/live")) result = [{ items: body.keywords.map(metric) }];
    else if (/\/(keyword_suggestions|related_keywords|keyword_ideas)\/live$/.test(url.pathname)) result = [{ items: [] }];
    else if (url.pathname.endsWith("/serp/google/organic/live/regular")) result = [{ items: Array.from({ length: 10 }, (_, i) => ({ type: "organic", rank_absolute: i + 1,
      url: `https://guide${i}.example/${body.keyword.replaceAll(" ", "-")}`, title: `Practical guide to ${body.keyword}`, description: `A workflow for ${body.keyword}` })) }];
    else assert.fail(`Unexpected DataForSEO route ${url.pathname}`);
    return json({ status_code: 20000, cost: 0.001, tasks: [{ id: `synthetic-${f.trace.length}`, status_code: 20000, cost: 0.001, result }] });
  });
  const sites = businesses.map(b => {
    const owner = `synthetic-owner-${b.domain}`;
    f.add("account_plan_entitlements", { userId: owner, status: "completed", maxSites: 9999, maxArticles: 150, planFeatures: ["max_sites_unlimited", "max_articles_150"] });
    const id = f.add("sites", { userId: owner, siteName: b.name, domain: b.domain, createdAt: START - 1000, updatedAt: START - 1000,
      niche: b.niche, siteSummary: b.niche, blogTheme: b.niche, anchorKeywords: b.keywords,
      keyFeatures: b.keywords, painPoints: b.keywords, productUsage: b.niche,
      targetAudienceSummary: "Operations teams using specialized business software", language: "en", targetCountry: "United States",
      autopilotEnabled: true, autopilotRolloutMode: "live", autopilotRolloutEpoch: 0, cadencePerWeek: b.cadence,
      approvalRequired: false, publishMethod: "github", repoOwner: b.name.toLowerCase(), repoName: "website", repoDefaultBranch: "main",
      githubToken: "synthetic-only", gscAccessToken: "synthetic-only", gscProperty: `sc-domain:${b.domain}`, urlStructure: "/blog/[slug]",
      planFeatures: ["max_sites_unlimited", "max_articles_150"],
    });
    f.add("pages", { siteId: id, slug: "/", url: `https://${b.domain}/`, title: b.niche, summary: `${b.name} provides ${b.niche}.`, keywords: b.keywords, createdAt: START - 1000 });
    return { ...b, id };
  });
  return { ...f, sites, modelCalls, repositories, failedPublications };
}

test("ordinary core path plans fresh synthetic topics through real admission and worker handlers", async () => {
  const f = setup();
  for (const site of f.sites) {
    const admissions = await Promise.all(Array.from({ length: 2 }, () => f.invoke("jobs:queuePlanIfAbsent", { siteId: site.id, reason: "topic_replenishment" })));
    assert.equal(admissions.filter(a => a.queued).length, 1);
    const queued = admissions.find(a => a.queued)!;
    assert.equal(queued.queued, true, JSON.stringify(queued));
    const otherSite = f.sites.find(s => s.id !== site.id)!;
    const wrongOwner = await f.invoke("actions/pipeline:processNextJob", { siteId: otherSite.id, jobId: queued.jobId });
    assert.equal(wrongOwner.processed, false);
    const results = await Promise.all(Array.from({ length: 2 }, () => f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: queued.jobId })));
    assert.equal(results.filter(r => r.processed).length, 1);
    const result = results.find(r => r.processed)!;
    assert.equal(result.error, undefined, JSON.stringify({ result, logs: f.logs, calls: f.trace.slice(-12) }));
    assert.ok(f.tables.topic_clusters.some(row => row.siteId === site.id), JSON.stringify({ result, logs: f.logs }));
    const topic = f.tables.topic_clusters.find(row => row.siteId === site.id)!;
    await assert.rejects(f.invoke("jobs:queueTopicArticleIfAbsent", { siteId: otherSite.id, topicId: topic._id, bufferFill: true }), /Topic does not belong/);
  }
  f.assertOffline();
});

function diagnostic(f: ReturnType<typeof setup>) {
  return JSON.stringify({ jobs: f.tables.jobs.map(j => ({ id: j._id, type: j.type, status: j.status, error: j.error })),
    articles: f.tables.articles.map(a => ({ id: a._id, siteId: a.siteId, status: a.status, issues: a.publicationGateIssues, publicUrlStatus: a.publicUrlStatus })),
    recent: f.trace.filter(t => ["actions/scheduler:scheduleCadence", "actions/pipeline:processNextJob", "autopilot:dispatchSiteFollowup"].includes(t.name)).slice(-12),
    perSite: f.sites.map(site => ({ siteId: site.id, decisions: f.trace.filter(t => t.name === "actions/scheduler:scheduleCadence" && t.args.siteId === site.id).map(t => t.result),
      topics: f.tables.topic_clusters.filter(t => t.siteId === site.id).map(t => ({ keyword: t.primaryKeyword, status: t.status })) })),
    logs: f.logs.slice(-3) });
}
async function pumpUntil(f: ReturnType<typeof setup>, done: () => boolean, maximumSteps = 120) {
  for (let step = 0; step < maximumSteps; step++) {
    if (done()) return;
    const next = f.tables._scheduled_functions.filter(row => row.state.kind === "pending").sort((a, b) => a.at - b.at)[0];
    assert.ok(next, diagnostic(f));
    assert.ok(next.at < START + 60 * 60_000, `Unexpected hour-long stall: ${diagnostic(f)}`);
    f.setTime(Math.max(f.now() + 1, next.at));
    await f.runNextScheduled();
    f.assertOffline();
  }
  assert.fail(`Synthetic scheduler did not converge: ${diagnostic(f)}`);
}

test("real fresh plan, quality seal, due publication, live verification and post-consumption replacement on two cadences", async t => {
  const f = setup();
  const migration = await f.invoke("articles:migrateLegacyArticles", {});
  assert.equal(migration.completed, true);
  for (const site of f.sites) await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic initial cadence wake" });
  await pumpUntil(f, () => f.sites.every(site => {
    const published = f.tables.articles.find(a => a.siteId === site.id && a.status === "published" && a.publicUrlStatus === "verified");
    return published && f.tables.articles.filter(a => a.siteId === site.id && a.status === "ready" && a.createdAt > published.publishedAt).length >= approvedBufferPolicy(site.cadence).target;
  }));
  for (const site of f.sites) {
    const articles = f.tables.articles.filter(a => a.siteId === site.id);
    const published = articles.filter(a => a.status === "published");
    assert.equal(published.length, 1, diagnostic(f));
    const article = published[0], replacement = articles.find(a => a.status === "ready" && a.createdAt > article.publishedAt)!;
    assert.ok(replacement);
    assert.notEqual(article._id, replacement._id); assert.notEqual(article.topicId, replacement.topicId); assert.notEqual(article.slug, replacement.slug);
    for (const a of [article, replacement]) {
      for (const field of ["title", "slug", "markdown"]) assert.equal(typeof a[field], "string");
      assert.equal(a.auditedContentHash, publicationArtifactHash({ ...a, title: a.title, slug: a.slug, markdown: a.markdown }));
      assert.equal(a.publicationGateStatus, "passed"); assert.equal(a.claimEvidenceStatus, "passed");
      assert.ok(a.factCheckScore >= 85 && a.editorialQualityScore >= 85 && a.wordCount >= 1200);
      assert.ok(a.sources.length >= 2);
      for (const evidence of a.sources) assert.equal(evidence.contentHash, sha256Hex(evidence.excerpt));
      assert.equal(f.get(a.topicId)?.siteId, site.id);
    }
    assert.equal(article.publishedContentHash, article.auditedContentHash);
    assert.equal(article.publicUrlStatus, "verified");
    const repo = f.repositories.get(site.name.toLowerCase())!;
    assert.equal(repo.writes, 1);
    const file = repo.files.get(`content/blog/${article.slug.replace(/^\//, "")}.md`)!;
    assert.ok(file.includes(publicationDeliveryKey(article.publicationDeliveryHash)));
    assert.ok(file.includes(article.markdown), "The artifact comes from the real publisher, not a hand-created receipt");
    const deadlines = f.trace.filter(t => t.name === "autopilot:scheduleCadenceDeadline" && t.args.siteId === site.id);
    assert.ok(deadlines.some(t => t.args.dueAt === article.publishedAt + Math.floor(604800000 / site.cadence)));
    const consumption = f.trace.findIndex(t => t.name === "articles:completePublication" && t.args.articleId === article._id);
    const replacementCreation = f.trace.findIndex(t => t.name === "articles:createDraftForJob" && t.result === replacement._id);
    assert.ok(replacementCreation > consumption);
    assert.ok(f.trace.some(t => t.name === "jobs:queueTopicArticleIfAbsent" && t.args.siteId === site.id && t.args.topicId === replacement.topicId && t.result?.queued));
    // Concurrent/retried ordinary wakes may queue refill work, but cannot queue
    // an early second publication or replay the first committed artifact.
    await Promise.all(Array.from({ length: 3 }, () => f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id })));
    const deliveryJob = f.tables.jobs.find(j => j.siteId === site.id && j.payload?.publishOnly && j.payload?.articleId === article._id)!;
    assert.ok(deliveryJob);
    const replay = await Promise.all(Array.from({ length: 2 }, () => f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: deliveryJob._id })));
    assert.ok(replay.every(result => result.processed === false));
    assert.equal(repo.writes, 1); assert.equal(articles.filter(a => a.status === "published").length, 1);
    t.diagnostic(JSON.stringify({ business: site.name, siteId: site.id, cadence: site.cadence,
      published: { id: article._id, topic: article.topicId, hash: article.publishedContentHash, at: article.publishedAt, verifiedAt: article.publicUrlVerifiedAt },
      replacement: { id: replacement._id, topic: replacement.topicId, hash: replacement.auditedContentHash, createdAt: replacement.createdAt },
      nextDueAt: article.publishedAt + Math.floor(604800000 / site.cadence), buffer: f.tables.articles.filter(a => a.siteId === site.id && a.status === "ready").length,
    }));
  }
  const failedPlan = f.tables.jobs.find(j => j.siteId === f.sites[0].id && j.type === "plan" && j.status === "failed");
  assert.ok(failedPlan, "The duplicate-only horizon plan must remain failed");
  assert.match(failedPlan.error, /"already_known":6/);
  assert.equal(failedPlan.workerAttempts ?? 0, 0, "Terminal planner exhaustion is not retried");
  assert.ok(f.trace.some(t => t.name === "actions/pipeline:processNextJob" && t.args.jobId === failedPlan._id && t.result?.planFailed === true));
  assert.equal(new Set(f.tables.topic_clusters.map(topic => `${topic.siteId}:${topic.primaryKeyword}`)).size, f.tables.topic_clusters.length);
  f.assertOffline();
});

test("real account budget rejects new discovery without touching history or another owner's admission", async () => {
  const f = setup(), site = f.sites[0];
  const receipt = f.add("provider_spend_reservations", { siteId: site.id, userId: f.get(site.id)!.userId,
    purpose: "topic_plan", trigger: "synthetic_historical_spend", reservedMicroUsd: PROVIDER_ACCOUNT_MONTHLY_CEILING_MICRO_USD.enterprise,
    reservationDay: "2026-09-10", reservationMonth: "2026-09", createdAt: START - 86_400_000 });
  const before = structuredClone(f.get(receipt));
  const blocked = await f.invoke("jobs:queuePlanIfAbsent", { siteId: site.id, reason: "topic_replenishment" });
  assert.equal(blocked.reason, "provider_account_monthly_budget_reserved");
  assert.equal(blocked.queued, false);
  assert.equal(f.tables.jobs.length, 0);
  assert.deepEqual(f.get(receipt), before);
  assert.equal(f.trace.filter(t => t.name === "network").length, 0);
  assert.equal((await f.invoke("jobs:queuePlanIfAbsent", { siteId: f.sites[1].id, reason: "topic_replenishment" })).queued, true);
  f.assertOffline();
});

test("terminal empty discovery re-enters bounded admission, stops at cooldown and never replays closed plans", async () => {
  const f = setup({ emptyDiscovery: true }), site = f.sites[0];
  await f.invoke("articles:migrateLegacyArticles", {});
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic terminal discovery boundary" });
  await pumpUntil(f, () => f.trace.some(t => t.name === "actions/scheduler:scheduleCadence" &&
    ["topic_replenishment_exhausted", "cadence_failure_cooldown"].includes(t.result?.mode)));
  const plans = f.tables.jobs.filter(j => j.siteId === site.id && j.type === "plan");
  assert.ok(plans.length > 0 && plans.length <= 3, diagnostic(f));
  assert.ok(plans.every(p => p.status === "failed" && (p.workerAttempts ?? 0) === 0));
  assert.equal(f.tables.articles.length, 0); assert.equal(f.tables.topic_clusters.length, 0);
  const before = structuredClone(plans), networkBefore = f.trace.filter(t => t.name === "network").length;
  const reservationsBefore = structuredClone(f.tables.provider_spend_reservations);
  for (const plan of plans) {
    const results = await Promise.all(Array.from({ length: 2 }, () => f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: plan._id })));
    assert.ok(results.every(r => !r.processed));
  }
  await Promise.all(Array.from({ length: 6 }, () => f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id })));
  assert.deepEqual(f.tables.jobs.filter(j => j.type === "plan"), before);
  assert.deepEqual(f.tables.provider_spend_reservations, reservationsBefore);
  assert.equal(f.trace.filter(t => t.name === "network").length, networkBefore);
  assert.ok(f.tables._scheduled_functions.some(s => s.state.kind === "pending" && s.at > f.now()), "Cooldown remains a future automatic wake");
  f.assertOffline();
});

test("real generation admission preserves duplicate claims, immutable attempts, monthly limits and expired leases", async () => {
  for (const exhausted of [false, true]) {
    const f = setup(), site = f.sites[0];
    const plan = await f.invoke("jobs:queuePlanIfAbsent", { siteId: site.id, reason: "topic_replenishment" });
    await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: plan.jobId });
    const topic = f.tables.topic_clusters.find(t => t.siteId === site.id)!;
    const admissions = await Promise.all(Array.from({ length: 2 }, () => f.invoke("jobs:queueTopicArticleIfAbsent", { siteId: site.id, topicId: topic._id, bufferFill: true })));
    assert.equal(admissions.filter(r => r.queued).length, 1);
    const jobId = admissions.find(r => r.queued)!.jobId;
    const claims = await Promise.all(["worker-one", "worker-two"].map(workerToken => f.invoke("jobs:claimPending", { siteId: site.id, jobId, workerToken })));
    assert.equal(claims.filter(Boolean).length, 1);
    const claimed = claims.find(Boolean)!;
    if (exhausted) for (let i = 0; i < articleGenerationAttemptAllowance(150); i++) {
      f.add("article_generation_attempts", { userId: f.get(site.id)!.userId, jobKey: `synthetic-historical-${i}`, attemptKey: `synthetic-historical-${i}:0`,
        workerAttempt: 0, monthKey: "2026-09", providerWorkKind: "generation", maxArticles: 150, attemptAllowance: 170,
        status: "failed", settledAt: START - 1000, createdAt: START - 1000, updatedAt: START - 1000 });
    }
    const networkBefore = f.trace.filter(t => t.name === "network").length;
    const args = { siteId: site.id, jobId, workerToken: claimed.workerToken, providerWorkKind: "generation" };
    const receipts = await Promise.all(Array.from({ length: 3 }, () => f.invoke("jobs:reserveArticleProviderAttempt", args)));
    if (exhausted) {
      assert.ok(receipts.every(r => !r.ok && r.reason === "monthly_attempt_limit"));
      assert.equal(f.tables.article_generation_attempts.length, 170);
    } else {
      assert.ok(receipts.every(r => r.ok));
      assert.equal(new Set(receipts.map(r => r.attemptId)).size, 1);
      assert.equal(f.tables.article_generation_attempts.length, 1);
    }
    assert.equal((await f.invoke("jobs:reserveArticleProviderAttempt", { ...args, workerToken: "lost-worker" })).reason, "worker_lease_lost");
    f.setTime(claimed.leaseExpiresAt + 1);
    assert.equal((await f.invoke("jobs:reserveArticleProviderAttempt", args)).reason, "worker_lease_lost");
    assert.equal(f.trace.filter(t => t.name === "network").length, networkBefore);
    f.assertOffline();
  }
});

test("unsupported citations and low editorial quality cannot be sealed or published by optimistic synthetic reviewers", async () => {
  for (const quality of ["unsupported", "low"] as const) {
    const f = setup({ quality });
    await f.invoke("articles:migrateLegacyArticles", {});
    const site = f.sites[0];
    await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic quality rejection" });
    await pumpUntil(f, () => f.trace.some(t => t.name === "actions/pipeline:processNextJob" && t.result?.qualityQuarantined));
    const article = f.tables.articles[0];
    assert.ok(article, diagnostic(f));
    assert.notEqual(article.publicationGateStatus, "passed");
    assert.notEqual(article.status, "ready"); assert.notEqual(article.status, "published");
    assert.equal(article.publishedContentHash, undefined);
    assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 0);
    assert.ok(article.publicationGateIssues.length > 0);
    if (quality === "unsupported") assert.notEqual(article.claimEvidenceStatus, "passed");
    else assert.ok(article.editorialQualityScore < 85);
    assert.equal(f.tables.articles.filter(a => a.siteId === f.sites[1].id).length, 0);
    f.assertOffline();
  }
});

test("transient publisher failure keeps the sealed artifact and recovers through its bounded natural retry", async t => {
  const f = setup({ publisherFailures: 1 });
  await f.invoke("articles:migrateLegacyArticles", {});
  const site = f.sites[0];
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic publisher recovery" });
  await pumpUntil(f, () => f.failedPublications.length === 1);
  const failed = structuredClone(f.tables.articles[0]);
  assert.notEqual(failed.status, "published");
  assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 0);
  const failure = f.trace.find(t => t.name === "jobs:markPublishFailed" && t.args.articleId === failed._id);
  assert.ok(failure, diagnostic(f));
  await pumpUntil(f, () => f.tables.articles.some(a => a._id === failed._id && a.status === "published" && a.publicUrlStatus === "verified"));
  const published = f.get(failed._id)!;
  assert.equal(published.publishedContentHash, failed.auditedContentHash);
  const job = f.get(failure.args.jobId)!;
  assert.equal(job.publicationAttempts, 2, "Both delivery attempts remain counted");
  const deliveries = f.trace.filter(t => t.name === "publisher:publishArticleInternal" && t.args.articleId === failed._id);
  assert.equal(deliveries.length, 3);
  // The ambiguous external-write failure preserves its fifteen-minute site lease.
  // The five-minute wake hits that fence without another external write; the
  // final bounded retry observes the destination and commits the same artifact.
  assert.match(deliveries[1].error!, /publication is already in progress/);
  assert.equal(f.trace.filter(t => t.name === "network" && t.args.method === "PATCH").length, 2);
  assert.ok(published.publishedAt >= f.failedPublications[0] + 5 * 60_000);
  assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 1);
  assert.equal(f.failedPublications.length, 1);
  assert.equal(f.tables.articles.filter(a => a.status === "published").length, 1);
  t.diagnostic(JSON.stringify({ articleId: published._id, hash: published.publishedContentHash,
    failedAt: f.failedPublications[0], publicVerifiedAt: published.publicUrlVerifiedAt,
    publishedAt: published.publishedAt, attempts: deliveries.length, visibleWrites: 1,
    retainedLeaseContention: true }));
  f.assertOffline();
});
