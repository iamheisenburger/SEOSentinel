import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { corePipelineFixture, START, type Fields } from "./helpers/core-pipeline-fixture.ts";
import { publicationArtifactHash, publicationDeliveryKey, sha256Hex } from "../convex/lib/publicationArtifact.ts";
import { approvedBufferPolicy, contentIntentConflicts } from "../convex/lib/autopilotBuffer.ts";
import { PROVIDER_ACCOUNT_MONTHLY_CEILING_MICRO_USD } from "../convex/lib/providerSpendReservation.ts";
import { articleGenerationAttemptAllowance } from "../convex/lib/articleGenerationAttempt.ts";
import { renderSafePublicationHtml } from "../convex/lib/safeMarkdownHtml.ts";
import { expectedPublisherDestinationReceipt } from "../convex/lib/publisherProvisioning.ts";
import { accountDeletionKey, accountDeletionTombstoneUserId } from "../convex/lib/accountDeletion.ts";

const defaultBusinesses = [
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
const blobSha = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
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
export function setup(options: { quality?: "unsupported" | "low"; publisherFailures?: number; lostCommitResponses?: number; emptyDiscovery?: boolean;
  growthFirst?: boolean; businesses?: typeof defaultBusinesses; providerFailure?: string; noPricing?: boolean; budgetMicroUsd?: number;
  longManagedPage?: boolean;
  ambiguousProviderFailure?: string; providerBarrier?: (tool: string) => Promise<void>;
  githubBeforeWrite?: () => Promise<void>; githubBeforeFence?: () => Promise<void>; selectedNoop?: boolean;
  githubReadUnavailable?: () => boolean;
  wordpress?: { username: string; password: string; transport: (url: URL, init: RequestInit) => Promise<Response> };
  failedOptionalSource?: boolean; liveCorrupt?: "canonical" | "body" | "title";
  evidence?: { sources: Array<{ url: string; title: string; text: string }>; failed?: string[]; brief?: string; competitor?: string } } = {}) {
  const modelCalls: Fields[] = [];
  const businesses = options.businesses ?? defaultBusinesses;
  let publisherFailuresRemaining = options.publisherFailures ?? 0;
  let lostCommitResponsesRemaining = options.lostCommitResponses ?? 0;
  const failedPublications: number[] = [];
  const repositories = new Map<string, { head: string; files: Map<string, string>; blobs: Map<string, string>; trees: Map<string, Fields[]>; commits: Map<string, string>;
    parents: Map<string, string>; snapshots: Map<string, Map<string, string>>; writes: number }>();
  for (const b of businesses) repositories.set(b.name.toLowerCase(), { head: sha(b.domain), files: new Map(), blobs: new Map(), trees: new Map(), commits: new Map(), parents: new Map(), snapshots: new Map(), writes: 0 });
  const f = corePipelineFixture(async (url, init) => {
    if (options.wordpress && businesses.some(b => b.domain === url.hostname) && (url.pathname === "/" || url.pathname.startsWith("/wp-json/") || url.pathname.startsWith("/blog/") || /^\/selected-[a-f0-9]+\/$/.test(url.pathname))) {
      return options.wordpress.transport(url, init);
    }
    if (url.origin === "https://api.anthropic.com") {
      assert.equal(url.pathname, "/v1/messages");
      const body = JSON.parse(String(init.body)); modelCalls.push(body);
      const text = String(body.messages[0].content), tool = body.tools?.[0]?.name;
      await options.providerBarrier?.(tool);
      if (options.ambiguousProviderFailure === tool) return new Response("{", { status: 200, headers: { "Content-Type": "application/json" } });
      if (options.providerFailure === tool) return json({ type: "error", error: { type: "overloaded_error", message: "Mocked provider failure" } }, 503);
      const keyword = text.match(/Primary Keyword: ([^\n]+)/i)?.[1] ?? text.match(/PRIMARY KEYWORD: ([^\n]+)/)?.[1];
      let value: unknown;
      if (tool === "submit_article") {
        assert.ok(keyword); const article = articlePayload(keyword);
        if (options.growthFirst && !options.quality) {
          article.markdown = article.markdown.replace("The synthetic field register contains an observation label and a review note [1].", "").split("## Sources")[0].trim();
          article.sources = [];
        }
        if (options.longManagedPage) article.markdown += "\n\n## Detailed rehearsal for an existing procedure\n\n" + [
          "Before rehearsing the procedure, agree which decisions belong to the exercise and which remain with the authorized business owner. Give participants an example that they are allowed to inspect. Ask them to distinguish source observations from proposed interpretations without guessing at missing context. Keep a separate list of questions that the exercise cannot answer. At the end, check whether the original boundaries still describe the work. Revise the exercise instructions only after the owner has considered the consequences for people who were not present.",
          "Prepare a handover record that can be understood without a private conversation with its author. Include the unresolved question, the relevant observation, the person responsible for answering, and the condition that would justify closure. Let the receiving person describe the next permitted action in their own words. If the explanation differs from the sender's intention, record the discrepancy before moving on. Use the disagreement to clarify the proposed wording rather than assigning blame or implying that silence indicates agreement with an unsupported conclusion.",
          "Consider how a participant should handle an unavailable source. Keep the missing information visible and explain why it matters to the pending decision. Avoid filling the gap with an estimate that might later be mistaken for an observed value. If the team can continue safely without the source, describe the narrower decision that is actually supported. If it cannot, identify who can obtain the missing material and how the request should be tracked. Revisit the conclusion when the authorized source becomes available.",
          "Rehearse a disputed interpretation without changing the underlying observation. Invite each participant to state which part of the record supports their reading and what would persuade them to reconsider. Preserve both explanations when the available material does not distinguish between them. Ask a reviewer to identify an appropriate reversible next action. Do not convert the exercise into a claim that the proposed process improves business performance. It demonstrates only whether the participants can describe and review this particular hypothetical disagreement in an understandable way.",
          "Walk through the proposed access boundary using role descriptions rather than real customer credentials. Ask who should be able to inspect a record, suggest a correction, approve its use, or export a copy. Treat those capabilities as separate decisions that require appropriate authorization. Include a discussion of temporary participation and what should happen when it ends. If a participant discovers that the proposed boundary is ambiguous, retain that issue for the responsible owner instead of treating an example permission label as a complete security policy.",
          "Plan how to communicate a rejected proposal. Explain which question remains unresolved, what evidence was considered, and what would make another review useful. Keep the earlier version available so a reviewer can compare the actual changes. Avoid presenting rejection as proof that an alternative is correct. Ask whether the record distinguishes a factual disagreement from a preference about wording or presentation. Where the distinction is unclear, request clarification before the team relies on the decision to change an unrelated part of its working procedure.",
          "Review how a person would resume the work after an interruption. Provide the retained record without adding private background information and ask the participant to explain what has already been decided. Note which details they need to request again. Use those questions to improve the proposed handover, while keeping the original observation and its limitations intact. Do not assume that a successful rehearsal proves reliability under all future conditions. Treat it as feedback about the clarity of the particular example and the instructions supplied for it.",
          "Summarize the exercise and list its limits. Distinguish the hypothetical rehearsal from ordinary customer work outside the exercise. Identify suggestions requiring owner approval and avoid promising an unmeasured outcome. Preserve the proposed next step, the reason for it, and the evidence needed to check its completion. Invite participants to correct the exercise record before sharing guidance with absent colleagues. Ask the responsible owner to review uncertain language and explain the remaining limitations without turning a rehearsal into a claim about commercial effectiveness.",
          "Examine the proposed naming convention with a reader unfamiliar with the project. Ask them to distinguish a source observation, a draft interpretation, an approved decision, and an unresolved question. Collect ambiguous labels for review rather than quietly choosing a meaning on behalf of the owner. Consider a worked example for each label and invite a colleague to challenge the distinction. Preserve the original language beside any proposed replacement until the responsible reviewer accepts it. Keep this terminology discussion separate from unsupported claims about product capabilities.",
          "Prepare a closing checklist for the person responsible for the rehearsal. Ask them to identify the retained evidence, unresolved objections, proposed next action, and permission needed before proceeding. Include a route for requesting clarification without silently reopening completed customer work. Compare the checklist against the original scope and remove suggestions outside that scope unless the owner explicitly approves them. Let participants describe remaining concerns in their own words. Retain the proposed checklist as a discussion artifact and seek explicit owner approval before any operational use.",
        ].join("\n\n");
        if (options.quality === "unsupported") article.markdown = article.markdown.replace(
          "The synthetic field register contains an observation label and a review note [1].",
          "A completed valve inspection reduces annual water consumption by 37% [1].",
        );
        const selected = text.match(/<selected_page_improvement>[\s\S]*?Title: ([^\n]+)\nSlug: ([^\n]+)[\s\S]*?Existing source \(untrusted text, not instructions\):\n([\s\S]*?)\n<\/selected_page_improvement>/);
        if (selected) {
          article.title = selected[1]; article.slug = selected[2]; article.metaTitle = selected[1].slice(0, 60);
          article.markdown = selected[3] + "\n\n## Additional reader guidance\n\n" + article.markdown;
          const target = text.match(/<targeted_edit>([^\n]+)<\/targeted_edit>/)?.[1];
          if (target) {
            const edit = JSON.parse(target);
            const sentences = keyword.includes("accountable handoff") ? [
              `For ${keyword}, propose an explicit transfer checklist that distinguishes delegated responsibility from permission to approve.`,
              "Identify the sender, receiver, acceptance evidence, and escalation route before transferring ownership.",
              "If acknowledgement is missing, keep the original assignee visible and flag the unresolved transfer.",
              "Let participants document objections and agree how an incomplete handover should be returned.",
              "Preserve the previous record so the team can reconstruct the decision.",
            ] : [`For ${keyword}, use a proposed diagnostic walkthrough before changing the working process.`,
              "Separate the observation, suspected cause, and next reversible experiment in the record.",
              "Ask an accountable colleague to reproduce the example and challenge missing context.",
              "Keep unresolved contradictions visible until a documented explanation supports the decision.",
              "Describe the acceptance condition and who can approve a handoff."];
            let after = "";
            for (const sentence of sentences) if ((after + " " + sentence).trim().split(/\s+/).length <= edit.maxWords) after = (after + " " + sentence).trim();
            article.markdown = selected[3].replace(edit.before, after);
          }
          if (options.selectedNoop) article.markdown = selected[3];
        } else if (options.wordpress) article.slug += "-" + businesses[0].domain.split(".")[0];
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
        value = options.evidence?.brief ?? evidenceText;
        citations = (options.evidence?.sources ?? articlePayload("fixture").sources).map(({ url, title }, index) => ({ type: "url_citation", url, title, start_index: index, end_index: index + 1 }));
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
      if (method === "GET" && options.githubReadUnavailable?.()) return json({ message: "Synthetic receipt-read outage" }, 503);
      if (method === "GET" && path === "") return json({ default_branch: "main", permissions: { push: true } });
      if (method === "GET" && path === "/git/ref/heads/main") { repo.snapshots.set(repo.head, new Map(repo.files)); return json({ object: { sha: repo.head } }); }
      if (method === "GET" && path.startsWith("/contents/")) {
        const content = (repo.snapshots.get(url.searchParams.get("ref") ?? "") ?? repo.files).get(path.slice("/contents/".length));
        return content === undefined ? json({}, 404) : json({ type: "file", path: path.slice("/contents/".length), size: Buffer.byteLength(content), encoding: "base64", content: Buffer.from(content).toString("base64"), sha: blobSha(content) });
      }
      if (method === "POST" && path === "/git/blobs") { await options.githubBeforeFence?.(); const content = Buffer.from(body.content, "base64").toString(), id = sha(content); repo.blobs.set(id, content); return json({ sha: id }, 201); }
      if (method === "POST" && path === "/git/trees") { const id = sha(JSON.stringify(body)); repo.trees.set(id, body.tree); return json({ sha: id }, 201); }
      if (method === "POST" && path === "/git/commits") { const id = sha(JSON.stringify(body)); repo.commits.set(id, body.tree); repo.parents.set(id, body.parents[0]); return json({ sha: id }, 201); }
      if (method === "PATCH" && path === "/git/refs/heads/main") {
        await options.githubBeforeWrite?.();
        if (repo.parents.get(body.sha) !== repo.head) return json({ message: "Synthetic non-fast-forward concurrent customer commit" }, 422);
        if (publisherFailuresRemaining > 0) {
          publisherFailuresRemaining--; failedPublications.push(f.now());
          return json({ message: "Synthetic transient upstream outage" }, 503);
        }
        assert.equal(body.force, false); const tree = repo.trees.get(repo.commits.get(body.sha)!); assert.ok(tree);
        for (const file of tree) { const content = repo.blobs.get(file.sha); assert.ok(content); repo.files.set(file.path, content); }
        repo.head = body.sha; repo.writes++;
        if (lostCommitResponsesRemaining > 0) {
          lostCommitResponsesRemaining--; failedPublications.push(f.now());
          return json({ message: "Synthetic response lost after the destination committed" }, 503);
        }
        return json({ object: { sha: repo.head } });
      }
      assert.fail(`Unexpected GitHub call ${method} ${path}`);
    }
    if (url.origin === "https://www.youtube.com" && url.pathname === "/results") return new Response("<html><body>No synthetic video results</body></html>", { headers: { "Content-Type": "text/html" } });
    if (url.hostname.endsWith(".example") || url.hostname.endsWith(".example.gov") || url.hostname.endsWith(".example.edu")) {
      if (options.evidence?.failed?.includes(url.href)) return new Response("Synthetic rejected capture", { status: 503 });
      const evidence = options.evidence?.sources.find(source => source.url === url.href);
      if (evidence) return new Response(`<html><main>${evidence.text}</main></html>`, { headers: { "Content-Type": "text/html" } });
      const business = businesses.find(b => b.domain === url.hostname);
      if (business && url.pathname.startsWith("/blog/")) {
        const files = repositories.get(business.name.toLowerCase())!.files;
        const content = files.get(`content/blog/${url.pathname.slice(6)}.md`) ?? files.get(`content/blog/${url.pathname.slice(6)}.mdx`);
        if (!content) return new Response("Not deployed", { status: 404, headers: { "Content-Type": "text/html" } });
        const title = JSON.parse(content.match(/^title: (.+)$/m)![1]);
        if (options.growthFirst) {
          const metaTitle = JSON.parse(content.match(/^metaTitle: (.+)$/m)![1]);
          const metaDescription = JSON.parse(content.match(/^description: (.+)$/m)![1]);
          const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
          return new Response(`<html><head><title>${options.liveCorrupt === "title" ? "Wrong title" : metaTitle}</title><meta name="description" content="${metaDescription}"><link rel="canonical" href="${options.liveCorrupt === "canonical" ? `https://${business.domain}/wrong` : url.href}"></head><body><main><h1>${title}</h1>${options.liveCorrupt === "body" ? "Unreviewed body" : renderSafePublicationHtml(body)}</main></body></html>`, { headers: { "Content-Type": "text/html" } });
        }
        return new Response(`<html><body><main><h1>${title}</h1><pre>${content}</pre></main></body></html>`, { headers: { "Content-Type": "text/html" } });
      }
      if (business && options.failedOptionalSource) return new Response("Mocked optional source unavailable", { status: 503 });
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
    else if (url.pathname.endsWith("/dataforseo_labs/google/ranked_keywords/live") && options.evidence?.competitor) result = [{ items: [] }];
    else if (url.pathname.endsWith("/bulk_keyword_difficulty/live")) result = [{ items: body.keywords.map(metric) }];
    else if (/\/(keyword_suggestions|related_keywords|keyword_ideas)\/live$/.test(url.pathname)) result = [{ items: [] }];
    else if (url.pathname.endsWith("/serp/google/organic/live/regular")) result = [{ items: Array.from({ length: 10 }, (_, i) => ({ type: "organic", rank_absolute: i + 1,
      url: `https://guide${i}.example/${body.keyword.replaceAll(" ", "-")}`, title: `Practical guide to ${body.keyword}`, description: `A workflow for ${body.keyword}` })) }];
    else assert.fail(`Unexpected DataForSEO route ${url.pathname}`);
    return json({ status_code: 20000, cost: 0.001, tasks: [{ id: `synthetic-${f.trace.length}`, status_code: 20000, cost: 0.001, result }] });
  }, options.growthFirst && !options.noPricing ? { PENTRA_CONTENT_WORK_PRICING: JSON.stringify({ model: "mocked-content-model", inputMicroUsdPerToken: 1, outputMicroUsdPerToken: 1, budgetMicroUsd: options.budgetMicroUsd ?? 500_000 }) } : {});
  const sites = businesses.map(b => {
    const owner = `synthetic-owner-${b.domain}`;
    f.add("account_plan_entitlements", { userId: owner, status: "completed", maxSites: 9999, maxArticles: 150, planFeatures: ["max_sites_unlimited", "max_articles_150"] });
    const id = f.add("sites", { userId: owner, siteName: b.name, domain: b.domain, createdAt: START - 1000, updatedAt: START - 1000,
      niche: b.niche, siteSummary: b.niche, blogTheme: b.niche, anchorKeywords: b.keywords,
      ...(options.evidence?.competitor ? { competitors: [options.evidence.competitor] } : {}),
      keyFeatures: b.keywords, painPoints: b.keywords, productUsage: b.niche,
      targetAudienceSummary: "Operations teams using specialized business software", language: "en", targetCountry: "United States",
      autopilotEnabled: true, autopilotRolloutMode: "live", autopilotRolloutEpoch: 0, cadencePerWeek: b.cadence,
      approvalRequired: false, publishMethod: "github", repoOwner: b.name.toLowerCase(), repoName: "website", repoDefaultBranch: "main",
      githubToken: "synthetic-only", gscAccessToken: "synthetic-only", gscProperty: `sc-domain:${b.domain}`, urlStructure: "/blog/[slug]",
      planFeatures: ["max_sites_unlimited", "max_articles_150"],
      ...(options.wordpress ? { publishMethod: "wordpress", wpUrl: `https://${b.domain}`, wpUsername: options.wordpress.username,
        wpAppPassword: options.wordpress.password, urlStructure: "/blog/[slug]/" } : {}),
    });
    if (!options.wordpress) f.get(id)!.publisherDestinationReceipt = expectedPublisherDestinationReceipt({ site: f.get(id)! as never,
      ownerAccountKey: accountDeletionKey(f.get(id)!.userId), verifiedAt: START });
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
export async function pumpUntil(f: ReturnType<typeof setup>, done: () => boolean, maximumSteps = 120, maximumAt = START + 60 * 60_000) {
  for (let step = 0; step < maximumSteps; step++) {
    if (done()) return;
    const next = f.tables._scheduled_functions.filter(row => row.state.kind === "pending").sort((a, b) => a.at - b.at)[0];
    assert.ok(next, diagnostic(f));
    assert.ok(next.at < maximumAt, `Unexpected virtual-time stall: ${diagnostic(f)}`);
    f.setTime(Math.max(f.now() + 1, next.at));
    await f.runNextScheduled();
    f.assertOffline();
  }
  assert.fail(`Synthetic scheduler did not converge: ${diagnostic(f)}`);
}

export const slcBusinesses = [defaultBusinesses[0],
  { name: "CedarCare", domain: "cedarcare.example", cadence: 3, niche: "Residential garden maintenance service", keywords: ["garden maintenance visit preparation", "garden pruning request checklist", "garden watering observation notes", "garden seasonal cleanup planning", "garden plant condition records", "garden service access instructions"] },
  { name: "ClayShelf", domain: "clayshelf.example", cadence: 4, niche: "Retail ceramic tableware shop", keywords: ["ceramic tableware gift selection", "ceramic dinner set storage planning", "ceramic serving dish size comparison", "ceramic glaze appearance questions", "ceramic tableware order checklist", "ceramic handmade care questions"] },
  { name: "BriefHarbor", domain: "briefharbor.example", cadence: 2, niche: "Brand design agency", keywords: ["brand design brief preparation", "brand asset handoff checklist", "brand stakeholder feedback workflow", "brand photography permission review", "brand style guide organization", "brand messaging interview questions"] },
  { name: "FieldPress", domain: "fieldpress.example", cadence: 5, niche: "Independent nature magazine publisher", keywords: ["nature magazine submission preparation", "nature interview source notes", "nature photograph permission checklist", "nature story outline review", "nature correction request workflow", "nature reading list organization"] },
];
export async function selectGrowth(f: ReturnType<typeof setup>, intervalMs = 30 * 60_000) {
  const site = f.sites[0];
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const readiness = await f.invoke("contentWork:readiness", { siteId: site.id });
  await f.invoke("contentWork:selectServiceMode", { siteId: site.id, mode: "growth_first", confirmBusinessProfile: true,
    reviewToken: readiness.reviewToken, ...(readiness.setupPending ? { authorizeAutomaticPublication: true, timezone: "America/Los_Angeles" } : {}),
    firstDeadlineAt: START + 10 * 60_000, intervalMs });
  f.setIdentity(null);
  return site;
}

// Only the test-owned empty site is removed. Billing identity and GitHub OAuth
// callbacks are synthetic; WordPress verifies against the real loopback core.
export async function createEmptyContentSite(f: ReturnType<typeof setup>) {
  const site = f.sites[0], prior = { ...f.get(site.id)! }, owner = prior.userId;
  f.tables.sites.splice(0); f.tables.pages.splice(0);
  f.setIdentity(owner);
  site.id = await f.invoke("sites:upsert", { createOnly: true, contentSetup: true, domain: site.domain, clerkUserId: owner,
    siteName: site.name, siteSummary: site.niche, niche: site.niche, blogTheme: site.niche,
    targetAudienceSummary: "Customers evaluating this business's confirmed offering", productUsage: site.niche,
    anchorKeywords: site.keywords, painPoints: site.keywords, language: "en", publishMethod: prior.publishMethod,
    autopilotEnabled: false, approvalRequired: true, inferToneNiche: false });
  assert.equal(f.get(site.id)!.autopilotEnabled, false); assert.equal(f.get(site.id)!.autopilotRolloutMode, "observe");
  assert.equal((await f.invoke("contentWork:readiness", { siteId: site.id })).destination.verified, false);
  assert.equal(f.modelCalls.length, 0); assert.equal(f.tables.jobs?.length ?? 0, 0);
  await f.invoke("sites:upsert", { id: site.id, domain: site.domain, publishMethod: prior.publishMethod,
    urlStructure: prior.urlStructure,
    ...(prior.publishMethod === "wordpress" ? { wpUrl: prior.wpUrl, wpUsername: prior.wpUsername, wpAppPassword: prior.wpAppPassword }
      : { repoOwner: prior.repoOwner, repoName: prior.repoName }) });
  if (prior.publishMethod === "wordpress") await f.invoke("publisher:verifyPublicationDestination", { siteId: site.id });
  else {
    await f.invoke("sites:setGithubTokenInternal", { siteId: site.id, githubToken: "synthetic-only", repoOwner: prior.repoOwner, repoName: prior.repoName, repoDefaultBranch: "main" });
    await f.invoke("sites:recordPublisherDestinationReceiptInternal", { siteId: site.id, receipt: expectedPublisherDestinationReceipt({
      site: f.get(site.id)! as never, ownerAccountKey: accountDeletionKey(owner), verifiedAt: f.now() }) });
  }
  assert.equal((await f.invoke("contentWork:readiness", { siteId: site.id })).destination.verified, true);
  f.setIdentity(null); return site;
}

export async function exerciseReadyPause(f: ReturnType<typeof setup>) {
  const site = f.sites[0], deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  const ready = f.tables.jobs.filter(j => j.contentWork?.stage === "ready").map(j => j._id);
  assert.equal(ready.length, 2);
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const r = await f.invoke("contentWork:readiness", { siteId: site.id });
  const jobs = JSON.stringify(f.tables.jobs), reservations = JSON.stringify(f.tables.provider_spend_reservations), calls = f.modelCalls.length;
  await f.invoke("contentWork:control", { siteId: site.id, action: "pause", reviewToken: r.reviewToken });
  f.setTime(deadline + 1);
  assert.equal((await f.invoke("contentWork:advance", { siteId: site.id })).mode, "content_paused");
  assert.equal(JSON.stringify(f.tables.jobs), jobs); assert.equal(JSON.stringify(f.tables.provider_spend_reservations), reservations);
  assert.equal(f.modelCalls.length, calls); assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
  await f.invoke("contentWork:control", { siteId: site.id, action: "resume", reviewToken: r.reviewToken });
  f.setIdentity(null);
  await pumpUntil(f, () => ready.some(id => f.get(id)!.contentWork.stage === "verified") &&
    f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 160, deadline + 3_600_000);
  const delivered = ready.map(id => f.get(id)!).find(j => j.contentWork.stage === "verified")!;
  assert.equal(delivered.contentWork.deadlineAt, deadline); assert.ok(delivered.contentWork.publishedAt > deadline);
  assert.ok(f.tables.jobs.some(j => j.contentWork?.stage === "ready" && j.createdAt > delivered.contentWork.verifiedAt));
  f.assertOffline();
  return { deadline, publishedAt: delivered.contentWork.publishedAt, verifiedAt: delivered.contentWork.verifiedAt, ready: 2 };
}

test("SLC29 synthetic empty owner journey starts preparation after explicit consent and refills after paused consumption", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await createEmptyContentSite(f);
  await selectGrowth(f);
  assert.equal(f.get(site.id)!.autopilotEnabled, true, "Explicit service consent must start preparation from the disabled empty setup");
  assert.equal(f.get(site.id)!.autopilotRolloutMode, "warm"); assert.equal(f.get(site.id)!.contentSchedule.active, false);
  assert.equal(f.get(site.id)!.contentSchedule.timezone, "America/Los_Angeles");
  await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
  await exerciseReadyPause(f);
  assert.equal(f.tables.pages.some(p => p.slug === "/"), false, "A link target is not an editable-page grant or a fabricated crawl record");
});

test("SLC29 an unreachable empty-site homepage cannot manufacture an internal-link target or quality approval", async () => {
  const f = setup({ growthFirst: true, failedOptionalSource: true, businesses: [slcBusinesses[0]] }), site = await createEmptyContentSite(f);
  await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.status === "failed" && j.contentWork?.stage === "failed"));
  assert.equal(f.get(site.id)!.contentSchedule.active, false);
  assert.equal(f.tables.articles.some(a => ["ready", "published"].includes(a.status)), false);
  assert.equal(f.tables.pages.length, 0);
  assert.ok(f.tables.articles.some(a => a.publicationQuality?.issues?.some((issue: string) => /internal link/.test(issue))) ||
    f.tables.articles.some(a => JSON.stringify(a).includes("Strict publication requires at least one internal link")));
  f.assertOffline();
});

test("SLC29 owner controls preserve ready reservations and overdue deadlines through pause/resume and closed-browser refill", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
  const deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const r = await f.invoke("contentWork:readiness", { siteId: site.id });
  const work = JSON.stringify(f.tables.jobs), reservations = JSON.stringify(f.tables.provider_spend_reservations), calls = f.modelCalls.length;
  await f.invoke("contentWork:control", { siteId: site.id, action: "pause", reviewToken: r.reviewToken });
  f.setTime(deadline + 1);
  assert.equal((await f.invoke("contentWork:advance", { siteId: site.id })).mode, "content_paused");
  assert.equal(JSON.stringify(f.tables.jobs), work); assert.equal(JSON.stringify(f.tables.provider_spend_reservations), reservations);
  assert.equal(f.modelCalls.length, calls); assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
  await f.invoke("contentWork:control", { siteId: site.id, action: "resume", reviewToken: r.reviewToken });
  await f.invoke("contentWork:control", { siteId: site.id, action: "retry", reviewToken: r.reviewToken });
  f.setIdentity(null); // The browser/session is gone; the durable scheduler owns continuation.
  await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.stage === "verified") && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  const delivered = f.tables.jobs.find(j => j.contentWork?.stage === "verified")!;
  assert.equal(delivered.contentWork.deadlineAt, deadline); assert.ok(delivered.contentWork.publishedAt > deadline);
  assert.ok(f.tables.jobs.some(j => j.createdAt > delivered.contentWork.verifiedAt));
  f.assertOffline();
});

export async function exerciseSetupReconfirmation(f: ReturnType<typeof setup>, stock = true, changeDestination?: () => Promise<void>) {
  const site = await selectGrowth(f);
  if (stock) await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
  const old = (f.tables.jobs ?? []).filter(j => j.contentWork).map(j => ({ id: j._id, articleId: j.articleId,
    markdown: j.articleId ? f.get(j.articleId)!.markdown : undefined, attempts: j.workerAttempts,
    calls: JSON.stringify(j.contentWork.providerCalls), reservation: JSON.stringify(f.get(j.providerSpendReservationId)) }));
  const schedule = { ...f.get(site.id)!.contentSchedule };
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const before = await f.invoke("contentWork:readiness", { siteId: site.id });
  await f.invoke("contentWork:control", { siteId: site.id, action: "pause", reviewToken: before.reviewToken });
  await changeDestination?.();
  await f.invoke("sites:upsert", { id: site.id, domain: site.domain,
    siteSummary: f.get(site.id)!.siteSummary + " Customers can also request a maintenance review." });
  const changed = await f.invoke("contentWork:readiness", { siteId: site.id });
  assert.equal(changed.bindingCurrent, false); assert.equal(changed.reconciliation.needed, true);
  await assert.rejects(f.invoke("contentWork:reconfirm", { siteId: site.id, reviewToken: before.reviewToken, confirm: true }), /current saved setup/);
  f.setIdentity("wrong-fixture-owner");
  await assert.rejects(f.invoke("contentWork:reconfirm", { siteId: site.id, reviewToken: changed.reviewToken, confirm: true }), /Not authorized/);
  f.setIdentity(`synthetic-owner-${site.domain}`);
  f.setTime(schedule.nextDeadlineAt + 1);
  if (!changed.destination.verified && f.get(site.id)!.publishMethod === "wordpress") {
    const stopped = await f.invoke("contentWork:reconfirm", { siteId: site.id, reviewToken: changed.reviewToken, confirm: true });
    assert.equal(stopped.status, "waiting"); assert.ok(stopped.issues.some((i: Fields) => i.code === "connection"));
    assert.equal(stopped.retired, 0);
    await f.invoke("publisher:verifyPublicationDestination", { siteId: site.id });
  }
  const concurrent = await Promise.all(Array.from({ length: 3 }, () => f.invoke("contentWork:reconfirm", { siteId: site.id, reviewToken: changed.reviewToken, confirm: true })));
  const result = concurrent.find(r => r.status === "preparing")!;
  assert.equal(concurrent.filter(r => r.status === "unchanged").length, 2);
  assert.equal(result.status, "preparing", JSON.stringify(result)); assert.equal(result.retired, old.length);
  const jobsAfter = JSON.stringify(f.tables.jobs), reservationsAfter = JSON.stringify(f.tables.provider_spend_reservations);
  assert.equal((await f.invoke("contentWork:reconfirm", { siteId: site.id, reviewToken: changed.reviewToken, confirm: true })).status, "unchanged");
  assert.equal(JSON.stringify(f.tables.jobs), jobsAfter); assert.equal(JSON.stringify(f.tables.provider_spend_reservations), reservationsAfter);
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, schedule.nextDeadlineAt);
  assert.equal(f.get(site.id)!.contentSchedule.intervalMs, schedule.intervalMs);
  assert.equal(f.get(site.id)!.contentSchedule.timezone, schedule.timezone);
  for (const previous of old) {
    const job = f.get(previous.id)!; assert.ok(job.contentWork.retiredAt);
    assert.equal(job.workerAttempts, previous.attempts); assert.equal(JSON.stringify(job.contentWork.providerCalls), previous.calls);
    assert.equal(f.get(previous.articleId)!.markdown, previous.markdown);
    assert.equal(f.get(previous.articleId)!.status, "revision");
    assert.equal(JSON.stringify(f.get(job.providerSpendReservationId)), previous.reservation);
  }
  const oldIds = new Set(old.map(j => j.id));
  f.setIdentity(null);
  await pumpUntil(f, () => f.tables.jobs?.some(j => !oldIds.has(j._id) && j.contentWork?.stage === "verified") &&
    f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 200, schedule.nextDeadlineAt + 3_600_000);
  const delivered = f.tables.jobs.find(j => !oldIds.has(j._id) && j.contentWork?.stage === "verified")!;
  assert.equal(delivered.contentWork.deadlineAt, schedule.nextDeadlineAt); assert.ok(delivered.contentWork.publishedAt > schedule.nextDeadlineAt);
  assert.ok(f.tables.jobs.some(j => j.contentWork?.stage === "ready" && j.createdAt > delivered.contentWork.verifiedAt));
  f.assertOffline();
  return { deadline: schedule.nextDeadlineAt, publishedAt: delivered.contentWork.publishedAt, verifiedAt: delivered.contentWork.verifiedAt, retired: old.length, ready: 2 };
}

// All fixtures below enter the registered content admission and worker paths.
// Three synthetic sites share one owner; the fourth is an independent tenant.
async function validationFixture(options: Parameters<typeof setup>[0] = {}) {
  const providerOptions = { ...options, growthFirst: true, businesses: slcBusinesses.slice(0, 4) };
  const f = setup(providerOptions);
  const owner = f.get(f.sites[0].id)!.userId;
  for (const site of f.sites.slice(1, 3)) {
    const row = f.get(site.id)!; row.userId = owner;
    row.publisherDestinationReceipt = expectedPublisherDestinationReceipt({ site: row as never, ownerAccountKey: accountDeletionKey(owner), verifiedAt: f.now() });
  }
  const select = async (site: typeof f.sites[number]) => {
    f.setIdentity(f.get(site.id)!.userId);
    const readiness = await f.invoke("contentWork:readiness", { siteId: site.id });
    await f.invoke("contentWork:selectServiceMode", { siteId: site.id, mode: "growth_first", confirmBusinessProfile: true,
      reviewToken: readiness.reviewToken, firstDeadlineAt: f.now() + 10 * 60_000, intervalMs: 30 * 60_000 });
    f.setIdentity(null);
  };
  for (const site of f.sites.slice(0, 2)) await select(site);
  const approval = await f.invoke("providerBudget:approveAccountMonthBudget", {
    siteId: f.sites[0].id, comparisonSiteId: f.sites[1].id, month: "2026-09", expectedBaseMonthlyCeilingMicroUsd: 28_000_000,
    monthlyCeilingMicroUsd: 32_000_000, incrementalLimitMicroUsd: 4_000_000, approvalReference: "synthetic-old-discovery-approval" });
  const args = { siteId: f.sites[0].id, comparisonSiteId: f.sites[1].id, authorizationId: approval.authorizationId,
    expectedMonthlyApprovalReference: "synthetic-old-discovery-approval", approvalReference: "synthetic-additional-validation", limitMicroUsd: 20_000_000 };
  const attach = (patch: Fields = {}) => f.invoke("providerBudget:attachCumulativeValidationBudget", { ...args, ...patch });
  const stop = () => f.invoke("providerBudget:stopCumulativeValidationBudget", { siteId: args.siteId,
    comparisonSiteId: args.comparisonSiteId, authorizationId: args.authorizationId, approvalReference: args.approvalReference });
  const admit = async (index: number) => {
    if (!f.get(f.sites[index].id)!.contentSchedule) await select(f.sites[index]);
    return f.invoke("contentWork:advance", { siteId: f.sites[index].id });
  };
  return { ...f, owner, args, attach, stop, admit, providerOptions };
}

test("SLC32 unrelated same-owner and foreign content cannot consume the exact two-site grant", async () => {
  const f = await validationFixture();
  await f.attach({ limitMicroUsd: 500_000 });
  await f.admit(2); await f.admit(3);
  for (const row of f.tables.provider_spend_reservations) assert.equal(row.validationAuthorizationId, undefined);
  assert.equal((await f.admit(0)).mode, "buffer_fill");
  const bound = f.tables.jobs.find(j => j.siteId === f.sites[0].id)!;
  assert.equal(bound.contentWork.validationAuthorizationId, f.args.authorizationId);
  assert.equal(f.get(bound.providerSpendReservationId)!.contentWorkJobId, bound._id);
  assert.equal(f.get(bound.providerSpendReservationId)!.validationAuthorizationId, f.args.authorizationId);
  const blocked = await f.admit(1);
  assert.equal(blocked.mode, "content_budget_exhausted"); assert.match(JSON.stringify(blocked), /cumulative_validation/);
  assert.match(JSON.stringify(blocked), /500000/);
  await assert.rejects(f.attach({ comparisonSiteId: f.sites[2].id, limitMicroUsd: 500_000 }), /immutable/);
  await assert.rejects(f.attach({ comparisonSiteId: f.sites[3].id, limitMicroUsd: 500_000 }), /scope/);
  f.assertOffline();
});

test("SLC32 historical unknown 28.05 stays in old account limits, not the additional validation total", async () => {
  const f = await validationFixture();
  const old = f.add("provider_spend_reservations", { siteId: f.sites[0].id, userId: f.owner, purpose: "topic_plan",
    trigger: "synthetic-prior-unknown", reservedMicroUsd: 28_050_000, createdAt: START - 86_400_000 });
  const before = JSON.stringify(f.get(old));
  await f.attach();
  assert.equal((await f.admit(0)).mode, "buffer_fill");
  assert.equal(JSON.stringify(f.get(old)), before);
  assert.equal(f.tables.provider_spend_reservations.filter(r => r.validationAuthorizationId).length, 1);
  // A further valid historical hold reaches the account cap; the new allowance
  // does not waive that independently applicable reservation.
  f.add("provider_spend_reservations", { siteId: f.sites[1].id, userId: f.owner, purpose: "topic_plan",
    trigger: "synthetic-second-prior-unknown", reservedMicroUsd: 3_450_000, createdAt: START - 86_400_000 });
  const blocked = await f.admit(1);
  assert.equal(blocked.mode, "content_budget_exhausted"); assert.match(JSON.stringify(blocked), /32000000/);
  assert.doesNotMatch(JSON.stringify(blocked), /cumulative_validation/); assert.equal(f.modelCalls.length, 0); f.assertOffline();
});

test("SLC32 ordinary legacy work stays outside validation while old incremental and fleet guards remain effective", async () => {
  const f = await validationFixture(); await f.attach({ limitMicroUsd: 500_000 });
  assert.equal((await f.invoke("jobs:queuePlanIfAbsent", { siteId: f.sites[2].id, reason: "topic_replenishment" })).queued, true);
  const legacy = f.tables.jobs.find(j => j.siteId === f.sites[2].id)!;
  assert.equal(f.get(legacy.providerSpendReservationId)!.validationAuthorizationId, undefined);
  assert.equal((await f.admit(0)).mode, "buffer_fill"); f.assertOffline();
  for (const scope of ["old_incremental", "fleet"] as const) {
    const isolated = await validationFixture(); await isolated.attach();
    isolated.add("provider_spend_reservations", { siteId: isolated.sites[scope === "fleet" ? 3 : 2].id,
      userId: scope === "fleet" ? isolated.get(isolated.sites[3].id)!.userId : isolated.owner, purpose: "topic_plan", trigger: "synthetic-valid-other-hold",
      reservedMicroUsd: scope === "fleet" ? 35_000_000 : 3_600_000, createdAt: scope === "fleet" ? START - 86_400_000 : START });
    const denied = await isolated.admit(0); assert.equal(denied.mode, "content_budget_exhausted");
    assert.equal(denied.budgetBlocker.budgetScope, scope === "old_incremental" ? "approved_incremental_window" : undefined);
    assert.equal(denied.budgetBlocker.ceilingMicroUsd, scope === "fleet" ? 35_000_000 : 4_000_000);
    assert.equal(isolated.tables.jobs.length, 0); isolated.assertOffline();
  }
});

test("SLC32 first binding rejects invalid authority, extra allowance and retroactive work adoption", async () => {
  const f = await validationFixture();
  for (const patch of [{ limitMicroUsd: 20_000_001 }, { limitMicroUsd: 0 }, { expiresAt: START },
    { expectedMonthlyApprovalReference: "not-approved" }, { comparisonSiteId: f.sites[3].id }, { approvalReference: "bad" }]) {
    await assert.rejects(f.attach(patch));
    assert.equal(f.get(f.args.authorizationId)!.cumulativeValidation, undefined);
  }
  await f.admit(0);
  await assert.rejects(f.attach(), /Reconcile existing content work/);
  assert.equal(f.get(f.args.authorizationId)!.cumulativeValidation, undefined);
  assert.equal(f.tables.provider_spend_reservations[0].validationAuthorizationId, undefined);
  const separate = await validationFixture();
  assert.equal((await separate.attach({ expiresAt: START + 7 * 86_400_000 })).created, true, "No invented 24-hour expiry");
  f.assertOffline(); separate.assertOffline();
});

test("SLC32 bound jobs cannot lose grant lineage or borrow another site's reservation before paid I/O", async () => {
  for (const change of ["job", "schedule", "reservation", "foreign_owner"] as const) {
    const f = await validationFixture(); await f.attach(); await f.admit(0);
    const job = f.tables.jobs[0], receipt = f.get(job.providerSpendReservationId)!;
    await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: "synthetic-lineage" });
    if (change === "job") delete f.get(job._id)!.contentWork.validationAuthorizationId;
    if (change === "schedule") delete f.get(job.siteId)!.contentSchedule.validationAuthorizationId;
    if (change === "reservation") receipt.contentWorkJobId = "jobs:foreign";
    if (change === "foreign_owner") f.get(job.siteId)!.userId = f.get(f.sites[3].id)!.userId;
    await assert.rejects(f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: "synthetic-lineage", key: "new-request", ceilingMicroUsd: 100 }), /validation|authority changed/);
    assert.equal(f.get(receipt._id)!.releasedAt, undefined); assert.equal(f.get(receipt._id)!.settledAt, undefined);
    assert.equal(f.modelCalls.length, 0); f.assertOffline();
  }
});

test("SLC32 concurrent real admissions and attachment retries cannot oversubscribe or restart the grant", async () => {
  const f = await validationFixture();
  const replies = await Promise.all([f.attach({ limitMicroUsd: 500_000 }), f.attach({ limitMicroUsd: 500_000 })]);
  assert.equal(replies.filter(r => r.created).length, 1);
  const results = await Promise.all([f.admit(0), f.admit(1), f.admit(0), f.admit(1)]);
  assert.equal(results.filter(r => r.mode === "buffer_fill").length, 1);
  assert.equal(f.tables.jobs.length, 1); assert.equal(f.tables.provider_spend_reservations.length, 1);
  f.restartRuntime(); f.setTime(START + 25 * 60 * 60_000);
  assert.equal((await f.attach({ limitMicroUsd: 500_000 })).approvedAt, START);
  assert.match(JSON.stringify(await f.admit(1)), /cumulative_validation/);
  await assert.rejects(f.attach({ limitMicroUsd: 500_001 }), /immutable/);
  await assert.rejects(f.attach({ limitMicroUsd: 500_000, expiresAt: f.now() + 1000 }), /immutable/);
  assert.equal(f.modelCalls.length, 0); f.assertOffline();
});

test("SLC32 stop and explicit expiry fence only bound work, permit in-flight settlement, and never renew", async t => {
  for (const lifecycle of ["stop", "expiry"] as const) await t.test(lifecycle, async () => {
    const f = await validationFixture();
    const patch = lifecycle === "expiry" ? { expiresAt: START + 1000 } : {};
    await f.attach(patch); await f.admit(0);
    const job = f.tables.jobs[0], token = "synthetic-inflight";
    await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: token });
    const call = await f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: token, key: "known-request", ceilingMicroUsd: 100 });
    if (lifecycle === "stop") { const first = await f.stop(); assert.equal(first.changed, true); assert.equal((await f.stop()).stoppedAt, first.stoppedAt); }
    else f.setTime(START + 1000);
    await f.invoke("contentWork:completeProviderCall", { jobId: job._id, workerToken: token, key: call.key, actualMicroUsd: 70, result: { fixture: true } });
    await assert.rejects(f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: token, key: "another-request", ceilingMicroUsd: 100 }), /validation (stopped|expired)/);
    await f.invoke("jobs:markFailed", { jobId: job._id, workerToken: token, error: "Synthetic stopped validation" });
    assert.equal(f.get(job.providerSpendReservationId)!.settledMicroUsd, 70);
    assert.equal(f.get(job.providerSpendReservationId)!.releasedAt, undefined);
    assert.match(JSON.stringify(await f.admit(1)), /cumulative_validation/);
    f.setTime(START + 25 * 60 * 60_000); f.restartRuntime();
    assert.equal((await f.attach(patch)).created, false);
    for (const index of [2, 3]) {
      assert.equal((await f.admit(index)).mode, "buffer_fill");
      const ordinary = f.tables.jobs.find(j => j.siteId === f.sites[index].id)!;
      await f.invoke("actions/pipeline:processNextJob", { siteId: ordinary.siteId, jobId: ordinary._id });
      await f.invoke("actions/pipeline:processNextJob", { siteId: ordinary.siteId, jobId: ordinary._id });
      assert.equal(f.get(ordinary._id)!.contentWork.stage, "ready", diagnostic(f));
      assert.equal(f.get(ordinary.providerSpendReservationId)!.settledMicroUsd, 600);
      assert.equal(f.get(ordinary.providerSpendReservationId)!.validationAuthorizationId, undefined);
    }
    f.assertOffline();
  });
});

test("SLC32 cancellation and unknown NEW costs retain the correct run charge without double settlement", async t => {
  for (const kind of ["no_io", "unknown", "known"] as const) await t.test(kind, async () => {
    const f = await validationFixture(); await f.attach({ limitMicroUsd: 500_000 }); await f.admit(0);
    const job = f.tables.jobs[0], workerToken = "synthetic-cancel";
    await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken });
    if (kind !== "no_io") {
      const call = await f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken, key: "cancelled-request", ceilingMicroUsd: 100 });
      if (kind === "known") for (let n = 0; n < 2; n++) await f.invoke("contentWork:completeProviderCall", { jobId: job._id, workerToken, key: call.key, actualMicroUsd: 70, result: { fixture: true } });
    }
    await Promise.all(Array.from({ length: 3 }, () => f.invoke("jobs:markFailed", { jobId: job._id, workerToken, error: "Synthetic cancellation" })));
    const row = f.get(job.providerSpendReservationId)!;
    assert.equal(row.releasedAt !== undefined, kind === "no_io");
    assert.equal(row.settledMicroUsd, kind === "known" ? 70 : undefined);
    const result = await f.admit(1);
    assert.equal(result.mode, kind === "no_io" ? "buffer_fill" : "content_budget_exhausted");
    if (kind !== "no_io") assert.match(JSON.stringify(result), new RegExp(`reservedMicroUsd":${kind === "known" ? 70 : 500000}`));
    assert.equal(f.get(job._id)!.contentWork.validationAuthorizationId, f.args.authorizationId); f.assertOffline();
  });
});

test("SLC32 worker restart and UTC month renewal preserve job and reservation lineage, then fresh execution settles", async () => {
  const f = await validationFixture(); await f.attach({ limitMicroUsd: 500_000 }); await f.admit(0);
  const job = f.tables.jobs[0], oldId = job.providerSpendReservationId;
  await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
  await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: "synthetic-crashed" });
  f.setTime(Date.UTC(2026, 9, 1, 0, 1)); f.restartRuntime();
  await f.invoke("providerBudget:approveAccountMonthBudget", { siteId: f.args.siteId, comparisonSiteId: f.args.comparisonSiteId,
    month: "2026-10", expectedBaseMonthlyCeilingMicroUsd: 28_000_000, monthlyCeilingMicroUsd: 32_000_000,
    incrementalLimitMicroUsd: 4_000_000, approvalReference: "synthetic-next-month-approval" });
  assert.equal((await f.attach({ limitMicroUsd: 500_000 })).approvedAt, START);
  await f.invoke("jobs:resetStuckJobs", { siteId: job.siteId, jobId: job._id, expectedWorkerToken: "synthetic-crashed" });
  await pumpUntil(f, () => f.get(job._id)!.contentWork.stage === "ready", 120, f.now() + 600_000);
  const completed = f.get(job._id)!, old = f.get(oldId)!, renewed = f.get(completed.providerSpendReservationId)!;
  assert.equal(old.settledMicroUsd, 200); assert.equal(renewed.reservedMicroUsd, 499_800); assert.equal(renewed.settledMicroUsd, 400);
  assert.equal(completed.contentWork.validationAuthorizationId, f.args.authorizationId);
  for (const row of [old, renewed]) { assert.equal(row.validationAuthorizationId, f.args.authorizationId); assert.equal(row.contentWorkJobId, job._id); }
  assert.equal(completed.contentWork.deadlineAt, START + 600_000);
  assert.equal(f.modelCalls.filter(c => c.tools[0].name === "submit_article").length, 1);
  assert.match(JSON.stringify(await f.admit(1)), /reservedMicroUsd":600/); f.assertOffline();
});

test("SLC32 known provider rejection retries the same bound job without erasing uncertain cost or minting another grant", async () => {
  const f = await validationFixture({ providerFailure: "submit_article" });
  await f.attach(); await f.admit(0);
  const job = f.tables.jobs[0], reservationId = job.providerSpendReservationId;
  await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
  assert.equal(f.get(job._id)!.contentWork.providerCalls[0].state, "rejected");
  const first = structuredClone(f.get(job._id)!.contentWork.providerCalls[0]);
  for (let attempt = 0; attempt < 3; attempt++) await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
  assert.equal(f.modelCalls.length, 1);
  f.setTime(f.get(job._id)!.nextAttemptAt); f.restartRuntime();
  await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
  const resumed = f.get(job._id)!;
  assert.equal(resumed.providerSpendReservationId, reservationId); assert.equal(resumed.contentWork.validationAuthorizationId, f.args.authorizationId);
  assert.equal(f.modelCalls.length, 2); assert.equal(resumed.contentWork.providerCalls.length, 2);
  assert.deepEqual(resumed.contentWork.providerCalls[0], first);
  assert.equal(f.get(reservationId)!.settledAt, undefined); assert.equal(f.get(reservationId)!.releasedAt, undefined);
  assert.equal(f.tables.provider_spend_reservations.length, 1); f.assertOffline();
});

async function exerciseValidationCycles(f: Awaited<ReturnType<typeof validationFixture>>, t: TestContext) {
  const active = f.sites.slice(0, 2);
  const ready = (siteId: string) => f.tables.jobs.filter(j => j.siteId === siteId && j.contentWork?.stage === "ready");
  for (const site of active) await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
  await pumpUntil(f, () => active.every(s => ready(s.id).length === 2), 240);
  for (let cycle = 0; cycle < 3; cycle++) {
    const slots = active.map(s => ({ site: s, deadline: f.get(s.id)!.contentSchedule.nextDeadlineAt }));
    f.setTime(Math.max(f.now(), slots[0].deadline - 5 * 60_000)); f.restartRuntime();
    for (const { site } of slots) await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "synthetic ordinary cycle" });
    await pumpUntil(f, () => active.every(s => f.tables.jobs.filter(j => j.siteId === s.id && j.contentWork?.stage === "verified").length === cycle + 1 && ready(s.id).length === 2), 240, slots[0].deadline + 60_000);
    for (const { site, deadline } of slots) {
      const verified = f.tables.jobs.find(j => j.siteId === site.id && j.contentWork?.stage === "verified" && j.contentWork.deadlineAt === deadline)!;
      assert.ok(verified); assert.ok(verified.contentWork.publishedAt <= deadline); assert.ok(verified.contentWork.verifiedAt >= verified.contentWork.publishedAt);
      assert.ok(ready(site.id).some(j => j.createdAt > verified.contentWork.verifiedAt));
      assert.equal(f.get(verified.articleId)!.publicUrlStatus, "verified");
      t.diagnostic(JSON.stringify({ scenario: "synthetic_validation_refill", site: site.domain, cycle: cycle + 1,
        deadline: new Date(deadline).toISOString(), publishedAt: new Date(verified.contentWork.publishedAt).toISOString(), ready: ready(site.id).length }));
    }
  }
  assert.equal(f.tables.jobs.length, 10);
  for (const job of f.tables.jobs) {
    assert.equal(job.contentWork.validationAuthorizationId, f.args.authorizationId);
    const row = f.get(job.providerSpendReservationId)!; assert.equal(row.contentWorkJobId, job._id);
    assert.equal(row.validationAuthorizationId, f.args.authorizationId); assert.equal(row.settledMicroUsd, 600);
  }
  assert.equal(f.tables.provider_spend_reservations.filter(r => r.validationAuthorizationId === f.args.authorizationId).reduce((sum, row) => sum + row.settledMicroUsd, 0), 6000);
  assert.equal(f.modelCalls.length, 30); f.assertOffline();
}

test("SLC32 both approved tenants execute, verify and refill three fixed cycles under one run", async t => {
  const f = await validationFixture(); await f.attach(); await exerciseValidationCycles(f, t);
});

const independentFunding = { scope: "additional_provider_allowance", approvalReference: "synthetic-separate-explicit-money-approval" };
function occupyOrdinaryCapacity(f: Awaited<ReturnType<typeof validationFixture>>) {
  return [
    f.add("provider_spend_reservations", { siteId: f.sites[0].id, userId: f.owner, purpose: "topic_plan", trigger: "synthetic-historical-hold", reservedMicroUsd: 28_000_000, createdAt: START - 86_400_000 }),
    f.add("provider_spend_reservations", { siteId: f.sites[1].id, userId: f.owner, purpose: "topic_plan", trigger: "synthetic-old-approved-window-hold", reservedMicroUsd: 4_000_000, createdAt: START }),
    f.add("provider_spend_reservations", { siteId: f.sites[3].id, userId: f.get(f.sites[3].id)!.userId, purpose: "topic_plan", trigger: "synthetic-foreign-ordinary-hold", reservedMicroUsd: 3_000_000, createdAt: START - 86_400_000 }),
  ];
}

test("SLC33 explicit independent funding completes both tenants' three fresh cycles/refills while legacy account and fleet capacity stay full", async t => {
  const f = await validationFixture(), oldIds = occupyOrdinaryCapacity(f);
  const original = oldIds.map(id => JSON.stringify(f.get(id)));
  await f.attach({ independentFunding });
  await exerciseValidationCycles(f, t);
  assert.deepEqual(oldIds.map(id => JSON.stringify(f.get(id))), original);
  assert.equal(f.get(f.args.authorizationId)!.cumulativeValidation.limitMicroUsd, 20_000_000);
  for (const row of f.tables.provider_spend_reservations.filter(r => r.validationAuthorizationId)) {
    assert.equal(row.independentFundingApprovalReference, independentFunding.approvalReference);
  }
  for (const index of [2, 3]) {
    const ordinary = await f.admit(index); assert.equal(ordinary.mode, "content_budget_exhausted");
    assert.equal(ordinary.budgetBlocker.ceilingMicroUsd, index === 2 ? 4_000_000 : 35_000_000);
  }
  f.setIdentity(f.owner);
  const readiness = await f.invoke("contentWork:readiness", { siteId: f.sites[0].id });
  assert.equal(readiness.funding.status, "available"); assert.equal(readiness.funding.accountAvailableMicroUsd, 0);
  assert.equal(readiness.funding.independentAllowance.totalMicroUsd, 20_000_000);
  const projection = await f.invoke("providerBudget:getSiteReservationSnapshot", { siteId: f.sites[0].id });
  assert.equal(projection.monthlyConsumedMicroUsd, 28_000_000); assert.equal(projection.independentConsumedMicroUsd, 3000);
  const audit = await f.invoke("providerBudget:getSiteReservationAudit", { siteId: f.sites[0].id });
  assert.equal(audit.monthlyConsumedMicroUsd, 28_000_000); assert.equal(audit.independentConsumedMicroUsd, 3000);
  assert.doesNotMatch(JSON.stringify(projection), /synthetic-only|githubToken|clerk|API_KEY/); f.assertOffline();
});

test("SLC33 absent or non-distinct explicit approval stays blocked and an existing run cannot be retroactively exempted", async () => {
  const f = await validationFixture(); occupyOrdinaryCapacity(f);
  for (const approvalReference of ["bad", f.args.approvalReference, f.args.expectedMonthlyApprovalReference]) {
    await assert.rejects(f.attach({ independentFunding: { ...independentFunding, approvalReference } }), /contract/);
    assert.equal(f.get(f.args.authorizationId)!.cumulativeValidation, undefined);
  }
  await f.attach(); assert.equal((await f.admit(0)).mode, "content_budget_exhausted");
  const before = JSON.stringify(f.tables.provider_spend_reservations);
  await assert.rejects(f.attach({ independentFunding }), /immutable/);
  assert.equal(JSON.stringify(f.tables.provider_spend_reservations), before); assert.equal(f.modelCalls.length, 0);
  const approved = await validationFixture(); await approved.attach({ independentFunding });
  await assert.rejects(approved.attach(), /immutable/);
  await assert.rejects(approved.attach({ independentFunding: { ...independentFunding, approvalReference: "different-explicit-reference" } }), /immutable/);
  f.assertOffline(); approved.assertOffline();
});

test("SLC33 ordinary headroom and admissions are identical before and after separate reservations, settlement and stop", async () => {
  const f = await validationFixture(); await f.admit(2); await f.admit(3);
  f.setIdentity(f.owner);
  const before = (await f.invoke("contentWork:readiness", { siteId: f.sites[2].id })).funding;
  await f.attach({ independentFunding }); await f.admit(0); await f.admit(1);
  for (const index of [0, 1]) {
    const job = f.tables.jobs.find(j => j.siteId === f.sites[index].id)!;
    for (let step = 0; step < 2; step++) await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
    assert.equal(f.get(job._id)!.contentWork.stage, "ready");
  }
  await f.stop();
  const after = (await f.invoke("contentWork:readiness", { siteId: f.sites[2].id })).funding;
  assert.deepEqual(after, before);
  assert.equal(after.independentAllowance, null); assert.equal(after.accountAvailableMicroUsd, 3_500_000);
  for (const index of [2, 3]) {
    const job = f.tables.jobs.find(j => j.siteId === f.sites[index].id)!;
    for (let step = 0; step < 2; step++) await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
    assert.equal(f.get(job._id)!.contentWork.stage, "ready"); assert.equal(f.get(job.providerSpendReservationId)!.independentFundingApprovalReference, undefined);
    assert.equal((await f.admit(index)).mode, "buffer_fill");
  }
  f.assertOffline();
});

test("SLC33 concurrent reservations reach but never exceed20 and unknown charges retain that ceiling across UTC/restart", async () => {
  const f = await validationFixture({ budgetMicroUsd: 10_000_000 }); occupyOrdinaryCapacity(f);
  const grants = await Promise.all([f.attach({ independentFunding }), f.attach({ independentFunding })]);
  assert.equal(grants.filter(g => g.created).length, 1);
  const results = await Promise.all([f.admit(0), f.admit(1), f.admit(0), f.admit(1)]);
  assert.equal(results.filter(r => r.mode === "buffer_fill").length, 2);
  const jobs = f.tables.jobs;
  assert.equal(jobs.length, 2); assert.equal(f.tables.provider_spend_reservations.filter(r => r.validationAuthorizationId).reduce((s, r) => s + r.reservedMicroUsd, 0), 20_000_000);
  for (const job of jobs) {
    await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: `uncertain-${job._id}` });
    await f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: `uncertain-${job._id}`, key: "unknown-result", ceilingMicroUsd: 100 });
  }
  f.setTime(Date.UTC(2026, 9, 1, 0, 1));
  // A cheaper NEW request fits all ordinary limits after reset. It must still
  // be rejected by the exhausted run; this cannot pass via a daily-cap denial.
  f.restartRuntime({ PENTRA_CONTENT_WORK_PRICING: JSON.stringify({ model: "mocked-content-model", inputMicroUsdPerToken: 1, outputMicroUsdPerToken: 1, budgetMicroUsd: 500_000 }) });
  await f.invoke("providerBudget:approveAccountMonthBudget", { siteId: f.args.siteId, comparisonSiteId: f.args.comparisonSiteId,
    month: "2026-10", expectedBaseMonthlyCeilingMicroUsd: 28_000_000, monthlyCeilingMicroUsd: 32_000_000,
    incrementalLimitMicroUsd: 4_000_000, approvalReference: "synthetic-renewed-ordinary-month" });
  for (const job of jobs) await f.invoke("jobs:resetStuckJobs", { siteId: job.siteId, jobId: job._id, expectedWorkerToken: `uncertain-${job._id}` });
  assert.equal((await f.attach({ independentFunding })).approvedAt, START);
  f.setIdentity(f.owner);
  const readiness = await f.invoke("contentWork:readiness", { siteId: f.sites[0].id });
  assert.equal(readiness.funding.status, "blocked"); assert.equal(readiness.funding.accountAvailableMicroUsd, 4_000_000);
  assert.equal(readiness.funding.requestedMicroUsd, 500_000);
  for (const job of jobs) {
    assert.equal(f.get(job._id)!.status, "failed");
    assert.equal(f.get(job._id)!.contentWork.budgetMicroUsd, 10_000_000);
    const r = f.get(job.providerSpendReservationId)!; assert.equal(r.settledAt, undefined); assert.equal(r.releasedAt, undefined);
    assert.equal(r.independentFundingApprovalReference, independentFunding.approvalReference);
  }
  // Keep the ordinary control's synthetic publisher verification current after
  // the month jump, so this assertion isolates financial admission.
  const ordinarySite = f.get(f.sites[2].id)!;
  ordinarySite.publisherDestinationReceipt = expectedPublisherDestinationReceipt({ site: ordinarySite as never, ownerAccountKey: accountDeletionKey(f.owner), verifiedAt: f.now() });
  assert.equal((await f.admit(2)).mode, "buffer_fill", "That same cheaper request remains admissible as ordinary third-site work");
  assert.equal(f.modelCalls.length, 0); f.assertOffline();
});

test("SLC33 UTC renewal settles only known costs and preserves the original independent funding marker", async () => {
  const f = await validationFixture(); occupyOrdinaryCapacity(f); await f.attach({ independentFunding }); await f.admit(0);
  const job = f.tables.jobs[0], oldId = job.providerSpendReservationId;
  await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
  await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: "independent-crashed" });
  f.setTime(START + 86_400_000); f.restartRuntime();
  await f.invoke("jobs:resetStuckJobs", { siteId: job.siteId, jobId: job._id, expectedWorkerToken: "independent-crashed" });
  await pumpUntil(f, () => f.get(job._id)!.contentWork.stage === "ready", 240, f.now() + 600_000);
  const resumed = f.get(job._id)!;
  const receipts = [f.get(oldId)!, f.get(resumed.providerSpendReservationId)!];
  assert.notEqual(resumed.providerSpendReservationId, oldId); assert.equal(receipts[0].settledMicroUsd, 200); assert.equal(receipts[1].settledMicroUsd, 400);
  assert.equal(receipts[1].reservedMicroUsd, 499_800);
  for (const r of receipts) { assert.equal(r.independentFundingApprovalReference, independentFunding.approvalReference); assert.equal(r.contentWorkJobId, job._id); }
  assert.equal(resumed.contentWork.deadlineAt, START + 600_000); f.assertOffline();
});

test("SLC33 explicit stop/expiry allows original settlement but cannot be removed by mode switching or reconfirmation", async t => {
  for (const lifecycle of ["stop", "expiry"] as const) await t.test(lifecycle, async () => {
    const f = await validationFixture(); const extra = lifecycle === "expiry" ? { expiresAt: START + 1000 } : {};
    await f.attach({ independentFunding, ...extra }); await f.admit(0);
    const job = f.tables.jobs[0], token = "independent-inflight";
    await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: token });
    const call = await f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: token, key: "cost-before-stop", ceilingMicroUsd: 100 });
    if (lifecycle === "stop") await f.stop(); else f.setTime(START + 1000);
    await f.invoke("contentWork:completeProviderCall", { jobId: job._id, workerToken: token, key: call.key, actualMicroUsd: 70, result: { fixture: true } });
    await assert.rejects(f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: token, key: "not-authorized", ceilingMicroUsd: 100 }), /validation (stopped|expired)/);
    await f.invoke("jobs:markFailed", { jobId: job._id, workerToken: token, error: "Synthetic validation ended" });
    assert.equal(f.get(job.providerSpendReservationId)!.settledMicroUsd, 70);
    f.setIdentity(f.owner);
    const siteId = f.sites[1].id;
    await f.invoke("contentWork:selectServiceMode", { siteId, mode: "legacy_articles", confirmBusinessProfile: false });
    await f.invoke("contentWork:selectServiceMode", { siteId, mode: "growth_first", confirmBusinessProfile: true,
      reviewToken: (await f.invoke("contentWork:readiness", { siteId })).reviewToken, firstDeadlineAt: f.now() + 600_000, intervalMs: 1_800_000 });
    assert.equal(f.get(siteId)!.contentSchedule.validationAuthorizationId, f.args.authorizationId);
    await f.invoke("sites:upsert", { id: siteId, domain: f.sites[1].domain, siteSummary: f.get(siteId)!.siteSummary + " Customers may request a review." });
    await f.invoke("contentWork:reconfirm", { siteId, reviewToken: (await f.invoke("contentWork:readiness", { siteId })).reviewToken, confirm: true });
    const denied = await f.admit(1); assert.equal(denied.mode, "content_budget_exhausted");
    assert.equal(denied.budgetBlocker.validationState, lifecycle === "stop" ? "stopped" : "expired");
    assert.equal((await f.attach({ independentFunding, ...extra })).approvedAt, START);
    assert.equal((await f.admit(2)).mode, "buffer_fill"); assert.equal((await f.admit(3)).mode, "buffer_fill");
    assert.equal(f.modelCalls.length, 0); f.assertOffline();
  });
});

test("SLC33 run-ID or funding-reference omission cannot escape persisted provider lineage", async () => {
  for (const omit of ["job", "schedule", "reservation", "funding_reference", "all_job_receipt_scope"] as const) {
    const f = await validationFixture(); await f.attach({ independentFunding }); await f.admit(0);
    const job = f.tables.jobs[0], r = f.get(job.providerSpendReservationId)!;
    await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: "scope-omission" });
    if (omit === "job") delete f.get(job._id)!.contentWork.validationAuthorizationId;
    if (omit === "schedule") delete f.get(job.siteId)!.contentSchedule.validationAuthorizationId;
    if (omit === "reservation") delete r.validationAuthorizationId;
    if (omit === "funding_reference") delete r.independentFundingApprovalReference;
    if (omit === "all_job_receipt_scope") {
      delete f.get(job._id)!.contentWork.validationAuthorizationId;
      delete r.validationAuthorizationId; delete r.independentFundingApprovalReference;
    }
    await assert.rejects(f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: "scope-omission", key: "new-call", ceilingMicroUsd: 100 }), /validation/);
    if (omit === "reservation") await assert.rejects(f.admit(1), /funding receipt/);
    if (omit === "funding_reference") assert.equal((await f.admit(1)).budgetBlocker.validationState, "invalid");
    assert.equal(f.modelCalls.length, 0); assert.equal(f.get(r._id)!.releasedAt, undefined); f.assertOffline();
  }
});

test("SLC33 independent authorization retains provider-health cooldown and strict per-request ceilings", async () => {
  const f = await validationFixture(); occupyOrdinaryCapacity(f); await f.attach({ independentFunding });
  f.add("provider_spend_reservations", { siteId: f.sites[0].id, userId: f.owner, purpose: "topic_plan", trigger: "synthetic-wallet-health",
    reservedMicroUsd: 100, createdAt: START, releasedAt: START, releaseReason: "provider_balance_insufficient" });
  assert.equal((await f.admit(0)).budgetBlocker.reason, "provider_account_preflight_cooling_down");
  f.setTime(START + 300_001); assert.equal((await f.admit(0)).mode, "buffer_fill");
  const job = f.tables.jobs[0]; await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: "priced-request" });
  await assert.rejects(f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: "priced-request", key: "too-much", ceilingMicroUsd: 500_001 }), /budget exhausted/);
  assert.equal(f.modelCalls.length, 0); f.assertOffline();
});

test("SLC33 real transient provider recovery retains the independent receipt and the unresolved rejection ceiling", async () => {
  const f = await validationFixture({ providerFailure: "submit_article" }); occupyOrdinaryCapacity(f);
  await f.attach({ independentFunding }); await f.admit(0);
  const job = f.tables.jobs[0], id = job.providerSpendReservationId;
  await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
  assert.equal(f.get(job._id)!.contentWork.providerCalls[0].state, "rejected");
  assert.equal(f.modelCalls.length, 1);
  f.providerOptions.providerFailure = undefined;
  f.setTime(f.get(job._id)!.nextAttemptAt); f.restartRuntime();
  for (let i = 0; i < 2; i++) await f.invoke("actions/pipeline:processNextJob", { siteId: job.siteId, jobId: job._id });
  const recovered = f.get(job._id)!;
  assert.equal(recovered.contentWork.stage, "ready"); assert.equal(f.modelCalls.length, 4);
  assert.equal(recovered.providerSpendReservationId, id); assert.equal(recovered.contentWork.recoveryAttempts, 1);
  assert.equal(f.get(id)!.independentFundingApprovalReference, independentFunding.approvalReference);
  assert.equal(f.get(id)!.settledAt, undefined); assert.equal(f.get(id)!.releasedAt, undefined);
  assert.equal(recovered.contentWork.providerCalls[0].actualMicroUsd, undefined); f.assertOffline();
});

test("SLC33 copied run scope on third/foreign sites and incomplete run inventory fail closed before provider I/O", async () => {
  for (const index of [2, 3]) {
    const f = await validationFixture(); await f.attach({ independentFunding }); await f.admit(index);
    const job = f.tables.jobs.find(j => j.siteId === f.sites[index].id)!;
    f.get(job.siteId)!.contentSchedule.validationAuthorizationId = f.args.authorizationId;
    const r = f.get(job.providerSpendReservationId)!;
    f.get(job._id)!.contentWork.validationAuthorizationId = f.args.authorizationId;
    r.validationAuthorizationId = f.args.authorizationId; r.independentFundingApprovalReference = independentFunding.approvalReference;
    await f.invoke("jobs:claimPending", { siteId: job.siteId, jobId: job._id, workerToken: "copied-scope" });
    await assert.rejects(f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: "copied-scope", key: "foreign-call", ceilingMicroUsd: 100 }), /scope changed/);
    assert.equal(f.modelCalls.length, 0); f.assertOffline();
  }
  const f = await validationFixture(); await f.attach({ independentFunding }); await f.admit(0);
  const job = f.tables.jobs[0];
  for (let i = 0; i < 5000; i++) f.add("provider_spend_reservations", { siteId: job.siteId, userId: f.owner, purpose: "content_work",
    contentWorkJobId: job._id, validationAuthorizationId: f.args.authorizationId, independentFundingApprovalReference: independentFunding.approvalReference,
    trigger: "synthetic-incomplete-history", reservedMicroUsd: 1, createdAt: START });
  assert.equal((await f.admit(1)).budgetBlocker.validationState, "incomplete"); assert.equal(f.modelCalls.length, 0); f.assertOffline();
});

test("SLC33 deleted-account financial tombstones retain independent scope without blocking ordinary foreign capacity", async () => {
  const f = await validationFixture(); await f.attach({ independentFunding }); await f.admit(0);
  const row = f.tables.provider_spend_reservations[0];
  // Exact existing deletion scrub shape; raw owner/site are intentionally gone.
  row.userId = accountDeletionTombstoneUserId(accountDeletionKey(f.owner)); delete row.siteId;
  assert.equal((await f.admit(3)).mode, "buffer_fill");
  assert.equal(f.get(row._id)!.reservedMicroUsd, 500_000); assert.equal(f.get(row._id)!.releasedAt, undefined); f.assertOffline();
});

test("SLC32 exact revision and replacement call envelope stays in the original run and work budget", async t => {
  const f = await validationFixture({ quality: "low", budgetMicroUsd: 2_000_000 }); await f.attach();
  f.setIdentity(f.owner);
  const second = f.sites[1].id;
  await f.invoke("contentWork:control", { siteId: second, action: "pause", reviewToken: (await f.invoke("contentWork:readiness", { siteId: second })).reviewToken });
  f.setIdentity(null);
  await f.invoke("actions/scheduler:scheduleCadence", { siteId: f.sites[0].id });
  await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.stage === "failed"));
  const job = f.tables.jobs[0];
  assert.equal(f.tables.jobs.length, 1); assert.equal(job.contentWork.revisions, 2); assert.equal(job.contentWork.replacements, 1);
  assert.equal(job.contentWork.validationAuthorizationId, f.args.authorizationId); assert.equal(f.tables.provider_spend_reservations.length, 1);
  assert.equal(f.get(job.providerSpendReservationId)!.settledMicroUsd, job.contentWork.providerCalls.length * 200);
  assert.equal(job.contentWork.providerCalls.length, 12);
  assert.deepEqual(f.modelCalls.map(c => c.tools[0].name), ["submit_article", "review_article", "audit_final_article",
    "remediate_final_article", "review_article", "audit_final_article", "remediate_final_article", "review_article", "audit_final_article",
    "submit_article", "review_article", "audit_final_article"]);
  assert.equal(f.tables.articles.some(a => a.status === "published" || a.publicationGateStatus === "passed"), false);
  t.diagnostic(JSON.stringify({ scenario: "offline_pricing_envelope", model: "mocked-content-model", calls: f.modelCalls.map(c => ({
    tool: c.tools[0].name, inputBound: Buffer.byteLength(JSON.stringify(c)) + 8192, outputBound: c.max_tokens })) }));
  f.assertOffline();
});

test("SLC31 exact-site release projection exposes readiness without credentials or another fixture tenant", async () => {
  const f = setup({ growthFirst: true, businesses: slcBusinesses.slice(0, 2) }), site = f.sites[0];
  f.get(site.id)!.gscRefreshToken = "sensitive-fixture-refresh-value";
  const result = await f.invoke("autopilot:getOperatorSnapshot", { siteId: site.id, includeContentPreflight: true });
  assert.equal(result.site.siteId, site.id); assert.equal(result.contentPreflight.domain, site.domain);
  assert.equal(result.contentPreflight.serviceMode, "legacy_articles"); assert.equal(result.contentPreflight.schedule, null);
  assert.equal(result.contentPreflight.revisionInventoryComplete, true);
  assert.doesNotMatch(JSON.stringify(result), /sensitive-fixture|githubToken|gscRefreshToken|wpAppPassword/);
  assert.ok(!JSON.stringify(result).includes(f.sites[1].domain)); assert.equal(f.modelCalls.length, 0);
  assert.ok(!f.trace.some(t => t.name === "network")); f.assertOffline();
});

test("SLC30 explicit changed-setup confirmation retires stale seals and reaches fresh late delivery/refill", async t => {
  for (const stock of [false, true]) await t.test(stock ? "two ready" : "empty stock", async () => {
    t.diagnostic(JSON.stringify(await exerciseSetupReconfirmation(setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), stock)));
  });
});

test("SLC30 pending, running and uncertain provider work retain their history through changed-setup recovery", async t => {
  for (const state of ["pending", "cancelled_by_settings", "running", "uncertain_provider"]) await t.test(state, async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
    await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
    const original = f.tables.jobs.find(j => j.contentWork)!, reservationId = original.providerSpendReservationId;
    if (state !== "pending") assert.ok(await f.invoke("jobs:claimPending", { siteId: site.id, jobId: original._id, workerToken: "fixture-held-worker" }));
    if (state === "uncertain_provider") await f.invoke("contentWork:beginProviderCall", { jobId: original._id, workerToken: "fixture-held-worker", key: "fixture-unknown-result", ceilingMicroUsd: 100 });
    const held = JSON.stringify(f.get(reservationId));
    f.setIdentity(`synthetic-owner-${site.domain}`);
    if (["running", "uncertain_provider"].includes(state)) {
      // Persisted legacy/callback checkpoint: binding changed while its old
      // worker lease still exists. Normal upsert cancellation is tested apart.
      f.get(site.id)!.siteSummary += " Customers may request a review.";
    } else await f.invoke("sites:upsert", { id: site.id, domain: site.domain, siteSummary: f.get(site.id)!.siteSummary + " Customers may request a review." });
    const request = { siteId: site.id, reviewToken: (await f.invoke("contentWork:readiness", { siteId: site.id })).reviewToken, confirm: true };
    let result = await f.invoke("contentWork:reconfirm", request);
    if (["running", "uncertain_provider"].includes(state)) {
      assert.equal(result.status, "waiting"); assert.ok(result.issues.some((i: Fields) => i.code === "worker"));
      assert.equal(f.get(original._id)!.contentWork.retiredAt, undefined); assert.equal(JSON.stringify(f.get(reservationId)), held);
      f.setTime(f.get(original._id)!.leaseExpiresAt + 1);
      await f.invoke("jobs:resetStuckJobs", { siteId: site.id, jobId: original._id, expectedWorkerToken: "fixture-held-worker" });
      result = await f.invoke("contentWork:reconfirm", request);
    }
    assert.equal(result.status, "preparing", JSON.stringify(result));
    const retired = f.get(original._id)!; assert.ok(retired.contentWork.retiredAt);
    if (state === "uncertain_provider") {
      assert.equal(JSON.stringify(f.get(reservationId)), held); assert.equal(retired.contentWork.providerCalls[0].state, "started");
    } else assert.ok(f.get(reservationId)!.releasedAt, "Only a proven never-started provider envelope closes through normal terminal accounting");
    assert.equal(f.modelCalls.length, 0);
    f.setIdentity(null);
    await pumpUntil(f, () => f.tables.jobs.some(j => j._id !== original._id && j.contentWork?.stage === "verified") &&
      f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 220, f.now() + 3_600_000);
    assert.equal(f.get(original._id)!.contentWork.retiredAt, retired.contentWork.retiredAt);
    f.assertOffline();
  });
});

export async function rotateFixtureGithub(f: ReturnType<typeof setup>, owner = f.get(f.sites[0].id)!.repoOwner) {
  const site = f.sites[0];
  await f.invoke("sites:setGithubTokenInternal", { siteId: site.id, githubToken: "synthetic-rotated-only", repoOwner: owner, repoName: "website", repoDefaultBranch: "main" });
  await f.invoke("sites:recordPublisherDestinationReceiptInternal", { siteId: site.id, receipt: expectedPublisherDestinationReceipt({
    site: f.get(site.id)! as never, ownerAccountKey: accountDeletionKey(`synthetic-owner-${site.domain}`), verifiedAt: f.now() }) });
}

test("SLC30 changed GitHub credentials and repository require fresh seals and actual replenishment", async t => {
  for (const destination of [false, true]) await t.test(destination ? "repository" : "credentials", async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
    await exerciseSetupReconfirmation(f, true, async () => {
      const owner = f.sites[0].name.toLowerCase(), nextOwner = destination ? owner + "-new" : owner;
      // Synthetic replacement repo serves the same owned fixture website.
      if (destination) f.repositories.set(nextOwner, f.repositories.get(owner)!);
      if (destination) await f.invoke("sites:upsert", { id: f.sites[0].id, domain: f.sites[0].domain, repoOwner: nextOwner, repoName: "website" });
      await rotateFixtureGithub(f, nextOwner);
    });
  });
});

export async function exerciseReceiptSetup(f: ReturnType<typeof setup>, selectedPageId?: string, rotate?: () => Promise<void>) {
  const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.stage === "verify"));
  const delivered = f.tables.jobs.find(j => j.contentWork?.stage === "verify")!, before = structuredClone(delivered);
  const receipts = JSON.stringify(selectedPageId ? f.get(delivered.contentWork.revisionId)!.receipt : f.get(delivered.articleId)!.publicationReceipt);
  const oldJobs = new Set(f.tables.jobs.map(j => j._id)), calls = f.modelCalls.length;
  f.setIdentity(`synthetic-owner-${site.domain}`);
  if (selectedPageId) await f.invoke("selectedPages:revoke", { siteId: site.id, pageId: selectedPageId });
  const revokedVersion = selectedPageId ? f.get(selectedPageId)!.editable.version : null;
  await rotate?.();
  await f.invoke("sites:upsert", { id: site.id, domain: site.domain, siteSummary: f.get(site.id)!.siteSummary + " Owner-confirmed follow-up service." });
  const request = { siteId: site.id, reviewToken: (await f.invoke("contentWork:readiness", { siteId: site.id })).reviewToken, confirm: true };
  const waiting = await f.invoke("contentWork:reconfirm", request);
  assert.equal(waiting.status, "waiting"); assert.ok(waiting.issues.some((i: Fields) => i.code === "verification"));
  assert.equal(f.get(delivered._id)!.contentWork.retiredAt, undefined);
  f.setIdentity(null);
  await pumpUntil(f, () => f.get(delivered._id)!.contentWork.stage === "verified");
  assert.equal(f.modelCalls.length, calls, "Reconciliation is read-only, not new generation");
  assert.equal(JSON.stringify(selectedPageId ? f.get(delivered.contentWork.revisionId)!.receipt : f.get(delivered.articleId)!.publicationReceipt), receipts);
  assert.equal(f.get(delivered._id)!.workerAttempts, before.workerAttempts);
  if (selectedPageId) {
    assert.equal(f.get(selectedPageId)!.editable.active, false); assert.equal(f.get(selectedPageId)!.editable.version, revokedVersion);
  } else assert.ok(!f.tables.pages.some(p => p.editable?.managedArticleId === delivered.articleId), "Changed setup does not enroll an old artifact under fresh permission");
  const deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  f.setIdentity(`synthetic-owner-${site.domain}`);
  if (f.get(site.id)!.publishMethod === "wordpress") await f.invoke("publisher:verifyPublicationDestination", { siteId: site.id });
  assert.equal((await f.invoke("contentWork:reconfirm", request)).status, "preparing");
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
  f.setIdentity(null);
  await pumpUntil(f, () => f.tables.jobs.some(j => !oldJobs.has(j._id) && j.contentWork?.stage === "verified") &&
    f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 240, deadline + 3_600_000);
  if (selectedPageId) assert.equal(f.get(selectedPageId)!.editable.active, false);
  f.assertOffline();
}

test("SLC30 old delivery receipts reconcile after changed credentials without restoring permissions", async t => {
  for (const selected of [false, true]) await t.test(selected ? "revoked selected page" : "new creation", async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
    const page = selected ? await selectExistingPage(f) : null;
    await exerciseReceiptSetup(f, page?.pageId, () => rotateFixtureGithub(f));
  });
});

test("SLC30 expired selected leases retire only before I/O; attempted changes require retained owner disposition", async t => {
  for (const attempted of [false, true]) await t.test(attempted ? "attempted revision" : "pristine revision", async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
    const page = await selectExistingPage(f), site = await selectGrowth(f);
    await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
    const job = f.tables.jobs.find(j => j.contentWork?.intent === "improve")!;
    f.setTime(job.contentWork.windowStartAt);
    await f.invoke("contentWork:advance", { siteId: site.id });
    assert.ok(await f.invoke("jobs:claimPending", { siteId: site.id, jobId: job._id, workerToken: "retained-selected-worker" }));
    const claim = await f.invoke("contentImprovements:claim", { siteId: site.id, jobId: job._id, workerToken: "retained-selected-worker" });
    if (attempted) await f.invoke("contentImprovements:attempted", { siteId: site.id, jobId: job._id, workerToken: "retained-selected-worker", revisionId: claim.revision._id });
    const revision = structuredClone(f.get(claim.revision._id)!), oldJobs = new Set(f.tables.jobs.map(j => j._id));
    const deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt, ledger = JSON.stringify(f.get(job.providerSpendReservationId));
    // Durable legacy/callback drift while the external lease is still retained.
    f.get(site.id)!.siteSummary += " Confirmed maintenance-review option.";
    f.setIdentity(`synthetic-owner-${site.domain}`);
    await f.invoke("selectedPages:revoke", { siteId: site.id, pageId: page.pageId });
    const request = { siteId: site.id, reviewToken: (await f.invoke("contentWork:readiness", { siteId: site.id })).reviewToken, confirm: true };
    assert.equal((await f.invoke("contentWork:reconfirm", request)).status, "waiting");
    f.setTime(Math.max(f.get(site.id)!.publicationLeaseExpiresAt, f.get(job._id)!.leaseExpiresAt) + 1);
    await f.invoke("jobs:resetStuckJobs", { siteId: site.id, jobId: job._id, expectedWorkerToken: "retained-selected-worker" });
    if (attempted) {
      const blocked = await f.invoke("contentWork:reconfirm", request);
      assert.equal(blocked.status, "waiting"); assert.ok(blocked.issues.some((i: Fields) => i.code === "uncertain_delivery" && i.articleId === job.articleId));
      await f.invoke("publishedRevisions:abandonUnverifiedDelivery", { revisionId: revision._id, confirmation: "ABANDON UNVERIFIED DELIVERY AND RETAIN AUDIT" });
    }
    assert.equal((await f.invoke("contentWork:reconfirm", request)).status, "preparing");
    const retained = f.get(revision._id)!;
    assert.equal(retained.attempts, revision.attempts); assert.equal(retained.nextArtifactHash, revision.nextArtifactHash);
    assert.equal(retained.attemptedAt, revision.attemptedAt); assert.equal(retained.receipt, undefined);
    assert.equal(Boolean(retained.ambiguityDispositionAt), attempted); assert.equal(f.get(site.id)!.publicationLeaseOwner, undefined);
    assert.equal(JSON.stringify(f.get(job.providerSpendReservationId)), ledger); assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
    f.setIdentity(null);
    await pumpUntil(f, () => f.tables.jobs.some(j => !oldJobs.has(j._id) && j.contentWork?.stage === "verified") &&
      f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 240, f.now() + 3_600_000);
    assert.equal(f.get(page.pageId)!.editable.active, false); f.assertOffline();
  });
});

export async function exerciseUncertainSetup(f: ReturnType<typeof setup>, restoreTransport: () => void) {
  const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.articles?.some(a => a.publicationOutcomeUnverifiedAt), 180);
  const article = f.tables.articles.find(a => a.publicationOutcomeUnverifiedAt)!, job = f.tables.jobs.find(j => j.articleId === article._id)!;
  const artifact = article.markdown, ledger = JSON.stringify(f.get(job.providerSpendReservationId)), calls = f.modelCalls.length;
  f.setIdentity(`synthetic-owner-${site.domain}`);
  await assert.rejects(f.invoke("sites:upsert", { id: site.id, domain: site.domain, siteSummary: "Changed while delivery is uncertain" }), /locked/);
  const ownerReview = await f.invoke("articles:getPublicationAmbiguityReview", { articleId: article._id });
  assert.ok(ownerReview.initial.reviewAt);
  f.setTime(ownerReview.initial.reviewAt + 1);
  await f.invoke("articles:abandonUnverifiedPublication", { articleId: article._id, confirmation: "ABANDON UNVERIFIED DELIVERY AND RETAIN AUDIT" });
  await f.invoke("sites:upsert", { id: site.id, domain: site.domain, siteSummary: f.get(site.id)!.siteSummary + " Owner confirmed the retained uncertain article must not be replayed." });
  restoreTransport();
  if (f.get(site.id)!.publishMethod === "wordpress") await f.invoke("publisher:verifyPublicationDestination", { siteId: site.id });
  const deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  const result = await f.invoke("contentWork:reconfirm", { siteId: site.id, reviewToken: (await f.invoke("contentWork:readiness", { siteId: site.id })).reviewToken, confirm: true });
  assert.equal(result.status, "preparing", JSON.stringify(result));
  assert.equal(f.get(article._id)!.markdown, artifact); assert.ok(f.get(article._id)!.publicationAttemptedAt);
  assert.equal(f.get(article._id)!.publicationReceipt, undefined); assert.equal(f.get(article._id)!.status, "rejected");
  assert.equal(JSON.stringify(f.get(job.providerSpendReservationId)), ledger); assert.equal(f.modelCalls.length, calls);
  const oldJobs = new Set(f.tables.jobs.map(j => j._id)); f.setIdentity(null);
  await pumpUntil(f, () => f.tables.jobs.some(j => !oldJobs.has(j._id) && j.contentWork?.stage === "verified") &&
    f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 260, f.now() + 3_600_000);
  const fresh = f.tables.jobs.filter(j => !oldJobs.has(j._id));
  assert.ok(fresh.every(j => j.payload.topicId !== job.payload.topicId), "Never replay the possibly delivered intent");
  assert.equal(fresh.find(j => j.contentWork.stage === "verified")!.contentWork.deadlineAt, deadline);
  f.assertOffline();
}

test("SLC30 lost external acknowledgement requires exact owner disposition, preserves audit, then publishes a different fresh intent", async () => {
  let outage = false, dropped = false;
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], lostCommitResponses: 1,
    githubBeforeWrite: async () => { if (!dropped) { outage = true; dropped = true; } }, githubReadUnavailable: () => outage });
  await exerciseUncertainSetup(f, () => { outage = false; });
});

test("SLC30 reconfirmation does not mint a spending allowance when existing headroom is exhausted", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
  f.add("provider_spend_reservations", { siteId: site.id, userId: `synthetic-owner-${site.domain}`, purpose: "content_work", trigger: "existing-fixture-commitment",
    reservedMicroUsd: 28_000_000, reservationDay: "2026-09-11", reservationMonth: "2026-09", createdAt: START });
  const before = JSON.stringify(f.tables.provider_spend_reservations), calls = f.modelCalls.length, deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  f.setIdentity(`synthetic-owner-${site.domain}`);
  await f.invoke("sites:upsert", { id: site.id, domain: site.domain, siteSummary: f.get(site.id)!.siteSummary + " Owner-confirmed clarification." });
  assert.equal((await f.invoke("contentWork:reconfirm", { siteId: site.id, reviewToken: (await f.invoke("contentWork:readiness", { siteId: site.id })).reviewToken, confirm: true })).status, "preparing");
  assert.equal((await f.invoke("contentWork:advance", { siteId: site.id })).mode, "content_budget_exhausted");
  assert.equal(JSON.stringify(f.tables.provider_spend_reservations), before); assert.equal(f.modelCalls.length, calls);
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline); assert.equal(f.get(site.id)!.contentSchedule.active, false); f.assertOffline();
});

test("SLC29 safe readiness distinguishes actual spend, conservative holds, available capacity and missing pricing", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f), owner = `synthetic-owner-${site.domain}`;
  for (const data of [{ reservedMicroUsd: 700_000, settledMicroUsd: 120_000, settledAt: START, settlementReason: "verified_provider_receipt_actual_cost" },
    { reservedMicroUsd: 600_000 }, { reservedMicroUsd: 400_000, releasedAt: START, releaseReason: "content_work_closed_before_provider_execution" }]) {
    f.add("provider_spend_reservations", { siteId: site.id, userId: owner, purpose: "content_work", trigger: "synthetic-held-ledger", reservationDay: "2026-09-11", reservationMonth: "2026-09", createdAt: START, ...data });
  }
  f.setIdentity(owner);
  const before = JSON.stringify(f.tables.provider_spend_reservations), r = await f.invoke("contentWork:readiness", { siteId: site.id });
  assert.equal(r.funding.settledActualMicroUsd, 120_000); assert.equal(r.funding.heldCeilingMicroUsd, 600_000);
  assert.equal(r.funding.status, "available"); assert.equal(r.funding.providerCredit, "unverified");
  assert.equal(r.funding.monthlyResetAt, Date.UTC(2026, 9, 1));
  assert.equal(JSON.stringify(f.tables.provider_spend_reservations), before);
  assert.doesNotMatch(JSON.stringify(r), /synthetic-only|providerCalls|sourceContent|permission|workerToken/);
  f.setIdentity("unrelated-fixture-owner");
  await assert.rejects(f.invoke("contentWork:readiness", { siteId: site.id }), /Not authorized/);
  const unpriced = setup({ growthFirst: true, noPricing: true, businesses: [slcBusinesses[0]] });
  unpriced.setIdentity(`synthetic-owner-${unpriced.sites[0].domain}`);
  assert.equal((await unpriced.invoke("contentWork:readiness", { siteId: unpriced.sites[0].id })).funding.status, "unconfigured");
  f.assertOffline(); unpriced.assertOffline();
});

test("SLC29 synthetic owner-handler empty-site setup reuses verified entitlement, stays stopped and cannot alter another owner", async t => {
  for (const method of ["github", "wordpress"]) await t.test(method, async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), owner = `synthetic-owner-${f.sites[0].domain}`;
    f.setIdentity(owner);
    const args = { createOnly: true, contentSetup: true, domain: `new-${method}.example`, clerkUserId: owner,
      siteName: "New fixture business", siteSummary: "The synthetic business provides garden maintenance services.", targetAudienceSummary: "Residents arranging garden maintenance.",
      productUsage: "Residents describe the requested garden maintenance visit.", niche: "Garden maintenance", blogTheme: "Garden visit preparation", publishMethod: method, autopilotEnabled: false, approvalRequired: true, inferToneNiche: false };
    const id = await f.invoke("sites:upsert", args), saved = f.get(id)!;
    assert.equal(saved.contentSetupRequestedAt, START); assert.equal(saved.autopilotEnabled, false);
    assert.equal(saved.approvalRequired, true); assert.equal(saved.serviceMode, undefined);
    assert.equal(f.tables.jobs?.length ?? 0, 0); assert.equal(f.tables.provider_spend_reservations?.length ?? 0, 0);
    const r = await f.invoke("contentWork:readiness", { siteId: id });
    assert.equal(r.entitlement, true); assert.equal(r.destination.verified, false); assert.equal(r.profile.summary, args.siteSummary);
    await assert.rejects(f.invoke("contentWork:selectServiceMode", { siteId: id, mode: "growth_first", confirmBusinessProfile: true, reviewToken: r.reviewToken, firstDeadlineAt: START + 600_000, intervalMs: 86_400_000 }), /Connect|Verify/);
    f.setIdentity("foreign-fixture-owner");
    await assert.rejects(f.invoke("sites:upsert", { id, domain: args.domain, siteSummary: "A foreign owner cannot change this." }), /authorized|owner|auth|not found/i);
    assert.equal(f.get(id)!.siteSummary, args.siteSummary); assert.equal(f.modelCalls.length, 0); f.assertOffline();
  });
});

test("SLC29 selecting an exact page rejects stale preview consent and never exposes its remote grant", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), selected = await selectExistingPage(f), site = f.sites[0];
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const preview = await f.invoke("actions/selectedPages:preview", { siteId: site.id, path: selected.path });
  f.get(site.id)!.siteSummary += " Updated owner fact.";
  await assert.rejects(f.invoke("actions/selectedPages:select", { siteId: site.id, path: selected.path, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true }), /changed since preview/);
  const list = await f.invoke("selectedPages:list", { siteId: site.id });
  assert.equal(list.pages[0].bindingCurrent, false);
  assert.doesNotMatch(JSON.stringify(list), /sourceContent|synthetic-only|providerCalls|"permission"/);
  const detail = await f.invoke("selectedPages:detail", { siteId: site.id, pageId: selected.pageId });
  assert.ok(detail.paragraphs.length); assert.doesNotMatch(JSON.stringify(detail), /sourceContent|"permission"/);
  delete f.get(site.id)!.repoDefaultBranch;
  assert.equal((await f.invoke("selectedPages:list", { siteId: site.id })).pages[0].bindingCurrent, false,
    "A disconnected publisher must not crash permission inventory or hide the revoke control");
  f.assertOffline();
});

test("SLC29 consent snapshots, owner isolation and entitlement loss block resume without resetting work", async t => {
  for (const scenario of ["wrong_owner", "profile", "connection", "entitlement"]) await t.test(scenario, async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
    f.setIdentity(`synthetic-owner-${site.domain}`);
    const r = await f.invoke("contentWork:readiness", { siteId: site.id });
    await f.invoke("contentWork:control", { siteId: site.id, action: "pause", reviewToken: r.reviewToken });
    if (scenario === "wrong_owner") f.setIdentity("unrelated-fixture-owner");
    if (scenario === "profile") f.get(site.id)!.siteSummary += " A changed fact.";
    if (scenario === "connection") f.get(site.id)!.repoName = "changed-destination";
    if (scenario === "entitlement") f.tables.account_plan_entitlements[0].status = "pending";
    const deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
    await assert.rejects(f.invoke("contentWork:control", { siteId: site.id, action: "resume", reviewToken: r.reviewToken }));
    assert.equal(f.get(site.id)!.contentSchedule.paused, true); assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
    assert.equal(f.modelCalls.length, 0); f.assertOffline();
  });
});

test("SLC29 two ready articles with exhausted authorized capacity cannot activate a new schedule", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
  f.get(site.id)!.contentSchedule.active = false;
  f.add("provider_spend_reservations", { siteId: site.id, userId: `synthetic-owner-${site.domain}`, purpose: "content_work", trigger: "synthetic-existing-commitment",
    reservedMicroUsd: 28_000_000, reservationDay: "2026-09-11", reservationMonth: "2026-09", createdAt: START });
  assert.equal((await f.invoke("contentWork:advance", { siteId: site.id })).mode, "content_budget_exhausted");
  assert.equal(f.get(site.id)!.contentSchedule.active, false); assert.equal(f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length, 2);
  f.assertOffline();
});

test("SLC29 pause before execution preserves the reservation and an in-flight selected write still verifies while paused", async t => {
  await t.test("before paid execution", async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
    await f.invoke("contentWork:advance", { siteId: site.id });
    const job = f.tables.jobs.find(j => j.contentWork)!, reservation = JSON.stringify(f.get(job.providerSpendReservationId));
    f.setIdentity(`synthetic-owner-${site.domain}`);
    const r = await f.invoke("contentWork:readiness", { siteId: site.id });
    await f.invoke("contentWork:control", { siteId: site.id, action: "pause", reviewToken: r.reviewToken });
    await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
    assert.equal(f.modelCalls.length, 0); assert.equal(JSON.stringify(f.get(job.providerSpendReservationId)), reservation);
    assert.equal(f.get(job._id)!.status, "pending"); f.assertOffline();
  });
  await t.test("after selected write before live verification", async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }); await selectExistingPage(f); const site = await selectGrowth(f);
    await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.intent === "improve" && j.contentWork.stage === "verify"));
    const job = f.tables.jobs.find(j => j.contentWork?.stage === "verify")!, calls = f.modelCalls.length;
    f.setIdentity(`synthetic-owner-${site.domain}`); const r = await f.invoke("contentWork:readiness", { siteId: site.id });
    await f.invoke("contentWork:control", { siteId: site.id, action: "pause", reviewToken: r.reviewToken });
    const pageList = await f.invoke("selectedPages:list", { siteId: site.id }); assert.ok(pageList.pages.some((p: Fields) => p.pendingVerification));
    f.setIdentity(null); await pumpUntil(f, () => f.get(job._id)!.contentWork.stage === "verified");
    assert.equal(f.get(site.id)!.contentSchedule.paused, true); assert.equal(f.modelCalls.length, calls); f.assertOffline();
  });
});

test("SLC29 Search Console requires complete current epochs and distinguishes zero, missing, delayed and new-page cohorts", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f), stored = f.get(site.id)!;
  f.setIdentity(stored.userId);
  assert.equal((await f.invoke("searchPerformance:contentOutcome", { siteId: site.id })).status, "missing");
  const day = 86_400_000, end = Date.UTC(2026, 8, 7);
  stored.gscDataThrough = "2026-09-07";
  stored.gscDateEpochs = Array.from({ length: 56 }, (_, i) => ({ date: new Date(end - i * day).toISOString().slice(0, 10), syncEpoch: `current-${i}` }));
  let r = await f.invoke("searchPerformance:contentOutcome", { siteId: site.id });
  assert.equal(r.current.clicks, 0); assert.equal(r.previous.clicks, 0); assert.equal(r.delayed, true);
  f.add("search_page_daily", { siteId: site.id, date: "2026-09-07", syncEpoch: "old-connection", page: `https://${site.domain}/blog/new-page`, clicks: 999, impressions: 999, position: 1, ctr: 1, createdAt: START });
  f.add("search_page_daily", { siteId: site.id, date: "2026-09-07", syncEpoch: "current-0", page: `https://${site.domain}/blog/new-page`, clicks: 3, impressions: 30, position: 2, ctr: .1, createdAt: START });
  f.add("article_summaries", { siteId: site.id, slug: "new-page", title: "New synthetic page", status: "published", publicUrlStatus: "verified", publishedAt: end - day, createdAt: end - day });
  r = await f.invoke("searchPerformance:contentOutcome", { siteId: site.id });
  assert.equal(r.current.clicks, 3); assert.equal(r.cohorts[0].clicks, 3);
  stored.gscDateEpochs.pop(); r = await f.invoke("searchPerformance:contentOutcome", { siteId: site.id });
  assert.equal(r.current.clicks, 3); assert.equal(r.previous, null);
  stored.gscDateEpochs.shift(); assert.equal((await f.invoke("searchPerformance:contentOutcome", { siteId: site.id })).status, "incomplete");
  stored.gscProperty = "sc-domain:unrelated.example";
  assert.equal((await f.invoke("searchPerformance:contentOutcome", { siteId: site.id })).status, "not_connected");
  f.setIdentity("unrelated-fixture-owner"); await assert.rejects(f.invoke("searchPerformance:contentOutcome", { siteId: site.id }), /Not authorized/);
  f.assertOffline();
});
export async function selectExistingPage(f: ReturnType<typeof setup>, extension = "md", providedOriginal?: string) {
  const site = f.sites[0], stored = f.get(site.id)!;
  stored.publisherDestinationReceipt = expectedPublisherDestinationReceipt({ site: stored as never,
    ownerAccountKey: accountDeletionKey(stored.userId), verifiedAt: f.now() });
  const slug = slugify(site.keywords[0]), path = `content/blog/${slug}.${extension}`, url = `https://${site.domain}/blog/${slug}`;
  const original = providedOriginal ?? "This page preserves the confirmed local business facts and the customer's original explanation. Record the context behind each decision and ask an authorized reviewer to clarify anything that is uncertain. Keep the original record available when planning an addition to this guidance.";
  const raw = `---\ntitle: ${JSON.stringify(titleFor(site.keywords[0]))}\nmetaTitle: ${JSON.stringify(titleFor(site.keywords[0]).slice(0,60))}\ndescription: ${JSON.stringify(description)}\ncanonicalUrl: ${JSON.stringify(url)}\n---\n\n${original}\n`;
  f.repositories.get(site.name.toLowerCase())!.files.set(path, raw);
  f.setIdentity(stored.userId);
  const preview = await f.invoke("actions/selectedPages:preview", { siteId: site.id, path });
  const pageId = await f.invoke("actions/selectedPages:select", { siteId: site.id, path, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true });
  f.setIdentity(null);
  stored.gscDateEpochs = [{ date: "2026-09-10", syncEpoch: "selected-current" }];
  f.add("search_performance", { siteId: site.id, date: "2026-09-10", syncEpoch: "selected-current", query: site.keywords[0], page: url,
    syncVersion: 2, syncedAt: f.now(), clicks: 1, impressions: 60, ctr: 1 / 60, position: 12, createdAt: f.now() });
  return { pageId, path, original, raw, url };
}

test("SLC selected Markdown/MDX improvements use actual generation, review, CAS, live verification and fresh refill across five businesses", async t => {
  for (const [index, business] of slcBusinesses.entries()) await t.test(business.name, async () => {
    const f = setup({ growthFirst: true, businesses: [business] });
    await createEmptyContentSite(f);
    const selected = await selectExistingPage(f, index % 2 ? "mdx" : "md"), site = await selectGrowth(f);
    await pumpUntil(f, () => (f.tables.jobs ?? []).length > 0, 10);
    assert.equal(f.tables.jobs[0].contentWork.intent, "improve", JSON.stringify({ page: f.get(selected.pageId), epochs: f.get(site.id)!.gscDateEpochs, reads: f.queryReads.filter(r => r.table === "search_performance") }));
    await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.intent === "improve" && j.contentWork.stage === "verified"), 120);
    const improved = f.tables.jobs.find(j => j.contentWork?.intent === "improve")!;
    assert.equal(improved.contentWork.targetPageId, selected.pageId);
    assert.equal(f.get(improved.contentWork.revisionId)!.status, "verified");
    assert.ok(f.get(selected.pageId)!.editable.lastImprovedAt);
    const content = f.repositories.get(site.name.toLowerCase())!.files.get(selected.path)!;
    assert.ok(content.includes(selected.original)); assert.ok(content.includes("Additional reader guidance"));
    await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "verified").length >= 3 &&
      f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 200, START + 3 * 60 * 60_000);
    assert.equal(f.tables.jobs.filter(j => j.contentWork?.intent === "improve").length, 1, "14-day cooldown must not mint repeated improvements");
    assert.ok(f.tables.jobs.some(j => j.contentWork?.intent === "create" && j.createdAt > improved.contentWork.verifiedAt));
    assert.equal(f.modelCalls.some(c => String(c.model).includes("dataforseo")), false);
    t.diagnostic(JSON.stringify({ synthetic: true, adapter: "github", business: business.name, afterPause: await exerciseReadyPause(f) }));
    f.assertOffline();
  });
});

test("SLC28 verified fresh creation automatically enters the exact editable inventory without manual reselection", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
  try { await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.stage === "verified") && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2); }
  catch { assert.fail(JSON.stringify(f.tables.articles?.map(a => ({ status: a.status, verificationError: a.publicUrlCheckError, hasSource: !!a.contentWorkCreationSource })))); }
  const created = f.tables.jobs.find(j => j.contentWork?.stage === "verified")!, article = f.get(created.articleId)!;
  const page = f.tables.pages?.find(p => p.siteId === site.id && p.slug === article.slug.replace(/^\//, "") && p.editable?.active);
  assert.ok(page, "A verified Pentra-created page must enter its measured-improvement inventory");
  assert.equal(page.editable.managedArticleId, article._id);
  assert.equal(page.editable.sourceContent, f.repositories.get(site.name.toLowerCase())!.files.get(`content/blog/${article.slug.replace(/^\//, "")}.md`));
  f.setIdentity(`synthetic-owner-${site.domain}`);
  assert.equal((await f.invoke("articles:get", { articleId: article._id })).contentWorkCreationSource, undefined, "Owner UI must not receive the remote creation grant");
  await f.invoke("selectedPages:revoke", { siteId: site.id, pageId: page._id }); f.setIdentity(null);
  await f.invoke("articles:recordPublicPublicationCheck", { siteId: site.id, articleId: article._id,
    expectedContentHash: article.publishedContentHash, publicUrl: article.publicUrl, status: "verified", attempts: 2 });
  assert.equal(f.get(page._id)!.editable.active, false, "A duplicate creation verification must not resurrect revoked consent");
  assert.equal(f.tables.pages.find(p => p.slug === "/")?.editable, undefined, "Never enroll unrelated pre-existing content");
  f.assertOffline();
});

export const incorrectBusinessParagraph = "This business exclusively sells decorative commercial paint through unrelated retail appointments.";
export const correctionSurvivor = "Keep the original observations available to an authorized reviewer. Record uncertainty explicitly and ask the responsible owner to clarify unsupported statements before anyone relies on the explanation. Do not silently alter unrelated customer content or infer new facts from an automated label.";
export async function exerciseImmediateFactCorrection(f: ReturnType<typeof setup>, pageId: string) {
  const site = f.sites[0];
  await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
  const e = f.get(pageId)!.editable, original = e.sourceContent, originalMarkdown = e.markdown, deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  e.lastImprovedAt = f.now(); // A recent discretionary revision may not block a demonstrated correction.
  const lastImproved = e.lastImprovedAt, modelCount = f.modelCalls.length, reservationCount = f.tables.provider_spend_reservations.length;
  // Deliberately overdue fixed slot: correction must not move it or erase lateness.
  f.setTime(deadline + 1);
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const request = { siteId: site.id, pageId, baseRevision: e.sourceRevision, confirm: true, kind: "factual_correction", before: incorrectBusinessParagraph,
    reason: "Owner confirms this paragraph describes the wrong business; use the confirmed summary exactly.", field: "siteSummary" };
  const ids = await Promise.all([f.invoke("actions/contentCorrections:correct", request), f.invoke("actions/contentCorrections:correct", request)]);
  assert.equal(ids[0], ids[1], "Concurrent owner retries reuse one existing job"); f.setIdentity(null);
  await pumpUntil(f, () => f.get(ids[0])!.contentWork.stage === "verified", 100, f.now() + 60_000);
  const job = f.get(ids[0])!, page = f.get(pageId)!;
  assert.equal(page.editable.markdown, originalMarkdown.replace(incorrectBusinessParagraph, f.get(site.id)!.siteSummary));
  assert.equal(page.editable.lastImprovedAt, lastImproved);
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
  assert.equal(f.modelCalls.length, modelCount); assert.equal(f.tables.provider_spend_reservations.length, reservationCount);
  assert.equal(job.contentWork.budgetMicroUsd, 0); assert.equal(job.providerSpendReservationId, undefined);
  assert.equal(f.get(job.articleId)!.editorialQualityScore, undefined, "Do not fabricate model quality scores for a literal owner correction");
  f.setIdentity(`synthetic-owner-${site.domain}`);
  assert.equal(await f.invoke("actions/contentCorrections:correct", request), ids[0], "A lost owner-action response cannot duplicate an already verified correction");
  const rollback = await f.invoke("contentImprovements:requestRollback", { siteId: site.id, revisionId: job.contentWork.revisionId, confirm: true });
  f.setIdentity(null);
  await pumpUntil(f, () => f.get(rollback)!.contentWork.stage === "verified", 100, f.now() + 60_000);
  assert.equal(f.get(pageId)!.editable.sourceContent, original);
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
  assert.equal(f.modelCalls.length, modelCount);
  f.assertOffline();
  return { job, original, deadline };
}
test("SLC28 immediate exact factual correction and rollback are provider-free and preserve overdue cadence", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const page = await selectExistingPage(f, "md", `${incorrectBusinessParagraph}\n\n${correctionSurvivor}`);
  f.get(f.sites[0].id)!.gscDateEpochs = [];
  await exerciseImmediateFactCorrection(f, page.pageId);
});
test("SLC28 corrections reject wrong owner, cross-site page, revoked consent, changed profile and stale source without spending", async t => {
  for (const scenario of ["wrong_owner", "foreign_page", "revoked", "profile_changed", "stale_source"]) await t.test(scenario, async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
    const selected = await selectExistingPage(f, "md", `${incorrectBusinessParagraph}\n\n${correctionSurvivor}`), site = await selectGrowth(f);
    f.get(site.id)!.gscDateEpochs = [];
    await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
    const page = f.get(selected.pageId)!, revision = page.editable.sourceRevision;
    const calls = f.modelCalls.length, reservations = f.tables.provider_spend_reservations.length, jobs = f.tables.jobs.length;
    f.setIdentity(scenario === "wrong_owner" ? "unauthorized-synthetic-owner" : `synthetic-owner-${site.domain}`);
    if (scenario === "foreign_page") page.siteId = "sites:foreign-synthetic";
    if (scenario === "revoked") await f.invoke("selectedPages:revoke", { siteId: site.id, pageId: page._id });
    if (scenario === "profile_changed") f.get(site.id)!.siteSummary = "A changed unconfirmed business description";
    if (scenario === "stale_source") page.editable.sourceRevision = "f".repeat(40);
    await assert.rejects(f.invoke("actions/contentCorrections:correct", { siteId: site.id, pageId: page._id, baseRevision: revision,
      confirm: true, kind: "factual_correction", before: incorrectBusinessParagraph, field: "siteSummary", reason: "Owner confirms the incorrect company description." }));
    assert.equal(f.modelCalls.length, calls); assert.equal(f.tables.provider_spend_reservations.length, reservations); assert.equal(f.tables.jobs.length, jobs);
    f.assertOffline();
  });
});
test("SLC28 exact correction respects the final customer-edit fence and reconciles lost GitHub responses", async t => {
  for (const scenario of ["customer_edit", "lost_ack"]) await t.test(scenario, async () => {
    let armed = false;
    const f: ReturnType<typeof setup> = setup({ growthFirst: true, businesses: [slcBusinesses[0]], lostCommitResponses: scenario === "lost_ack" ? 1 : 0,
      githubBeforeWrite: async () => {
        if (scenario === "customer_edit" && armed) {
          armed = false; const repo = f.repositories.get(f.sites[0].name.toLowerCase())!;
          repo.files.set(selected.path, "Later customer source must survive."); repo.head = sha("customer-edit-after-correction-claim");
        }
      } });
    const selected = await selectExistingPage(f, "md", `${incorrectBusinessParagraph}\n\n${correctionSurvivor}`);
    const site = await selectGrowth(f); f.get(site.id)!.gscDateEpochs = [];
    await pumpUntil(f, () => f.tables.jobs?.filter(j => j.contentWork?.stage === "ready").length === 2);
    f.setIdentity(`synthetic-owner-${site.domain}`);
    const id = await f.invoke("actions/contentCorrections:correct", { siteId: site.id, pageId: selected.pageId, baseRevision: f.get(selected.pageId)!.editable.sourceRevision,
      kind: "factual_correction", confirm: true, before: incorrectBusinessParagraph, field: "siteSummary", reason: "Owner confirms the exact corrected company summary." });
    f.setIdentity(null); armed = true;
    if (scenario === "customer_edit") {
      await pumpUntil(f, () => !armed, 30);
      assert.equal(f.repositories.get(site.name.toLowerCase())!.files.get(selected.path), "Later customer source must survive.");
      assert.notEqual(f.get(id)!.contentWork.stage, "verified");
    } else {
      await pumpUntil(f, () => f.get(id)!.contentWork.stage === "verified", 140, START + 10 * 60_000);
      assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 1, "A lost response cannot duplicate the corrective commit");
    }
    f.assertOffline();
  });
});

export function brokenLinkParagraph(domain: string) { return `The navigation in this paragraph points to the [owner guidance](https://${domain}/blog/missing-correction-target). Retain the existing link label and every other word when repairing the demonstrated missing destination.`; }
export async function exerciseBrokenLinkCorrection(f: ReturnType<typeof setup>, pageId: string) {
  const site = f.sites[0]; await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.stage === "verified") && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  const destination = f.tables.pages.find(p => p.editable?.managedArticleId), source = f.get(pageId)!;
  assert.ok(destination); const original = source.editable.sourceContent;
  const deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt, count = f.modelCalls.length;
  source.editable.lastImprovedAt = f.now(); const lastImproved = source.editable.lastImprovedAt;
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const request = { siteId: site.id, pageId, baseRevision: source.editable.sourceRevision, kind: "technical_repair", confirm: true,
    before: brokenLinkParagraph(site.domain), reason: "Owner confirms this internal navigation target is missing; preserve the label and point to the verified guidance.", targetPageId: destination._id };
  const id = await f.invoke("actions/contentCorrections:correct", request); f.setIdentity(null);
  await pumpUntil(f, () => f.get(id)!.contentWork.stage === "verified", 100, deadline - 5 * 60_000);
  assert.equal(f.modelCalls.length, count); assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
  assert.equal(f.get(pageId)!.editable.lastImprovedAt, lastImproved);
  assert.ok(f.get(pageId)!.editable.markdown.includes(`[owner guidance](${destination.url})`));
  const r = f.get(f.get(id)!.contentWork.revisionId)!; assert.equal(r.kind, "renderer_repair"); assert.equal(r.status, "verified");
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const rollback = await f.invoke("contentImprovements:requestRollback", { siteId: site.id, revisionId: r._id, confirm: true }); f.setIdentity(null);
  await pumpUntil(f, () => f.get(rollback)!.contentWork.stage === "verified", 100, deadline - 5 * 60_000);
  assert.equal(f.get(pageId)!.editable.sourceContent, original); assert.equal(f.modelCalls.length, count);
  f.assertOffline(); return { id, destination, deadline };
}
test("SLC28 a demonstrated broken internal link is repaired and fully verified without model work or cadence credit", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const p = await selectExistingPage(f, "md", `${brokenLinkParagraph(f.sites[0].domain)}\n\n${correctionSurvivor}`);
  f.get(f.sites[0].id)!.gscDateEpochs = [];
  await exerciseBrokenLinkCorrection(f, p.pageId);
});

/** Real handlers, synthetic Search Console observations and virtual deadlines.
 * No manual selection, discarded ready jobs, clock reset or manufactured seals. */
export async function managedMeasuredFollowups(f: ReturnType<typeof setup>) {
  const day = 86_400_000, site = await selectGrowth(f, 7 * day);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.stage === "verified"));
  const created = f.tables.jobs.find(j => j.contentWork?.stage === "verified")!, article = f.get(created.articleId)!;
  const page = f.tables.pages.find(p => p.editable?.managedArticleId === article._id);
  assert.ok(page?.editable.active, "Verified creation must enroll itself before measured work");
  const original = page.editable.markdown;
  // Google cannot observe a page before it exists. Advance the clock, never
  // the immutable delivery deadline or the already prepared work.
  f.setTime(Math.max(f.now(), article.publishedAt + 2 * day));
  const observations: string[] = [];
  const measure = (question: string) => {
    const date = new Date(f.now() - day).toISOString().slice(0, 10), syncEpoch = `fresh-${date}`;
    assert.ok(date > new Date(article.publishedAt).toISOString().slice(0, 10));
    observations.push(date);
    f.get(site.id)!.gscDateEpochs = [...(f.get(site.id)!.gscDateEpochs ?? []).filter((x: Fields) => x.date !== date), { date, syncEpoch }];
    f.add("search_performance", { siteId: site.id, date, syncEpoch, page: page.url, query: question,
      syncVersion: 2, syncedAt: f.now(), clicks: 1, impressions: 60, ctr: 1 / 60, position: 12, createdAt: f.now() });
  };
  measure(`${site.keywords[0]} diagnostic decision`);
  const improved = () => f.tables.jobs.filter(j => j.contentWork?.targetPageId === page._id && j.contentWork?.stage === "verified");
  await pumpUntil(f, () => improved().length === 1 && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 300, START + 30 * day);
  const first = improved()[0], firstText = f.get(page._id)!.editable.markdown;
  assert.ok(first.contentWork.editTarget, "A full-length managed page requires a bounded edit, not appended articles");
  assert.notEqual(firstText, original);
  assert.ok(firstText.split(/\s+/).length <= original.split(/\s+/).length + 60);
  f.setTime(first.contentWork.verifiedAt + 14 * day + 1);
  measure(`${site.keywords[0]} accountable handoff`);
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_work", reason: "synthetic_post_change_measurement" });
  await pumpUntil(f, () => improved().length === 2 && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 400, START + 70 * day);
  const second = improved()[1], finalText = f.get(page._id)!.editable.markdown;
  assert.ok(second.contentWork.verifiedAt - first.contentWork.verifiedAt >= 14 * day);
  assert.ok(second.contentWork.editTarget);
  assert.notEqual(finalText, firstText);
  assert.ok(finalText.includes("Do not generalize the result into a performance claim"), "Unrelated source limitations survive both edits");
  assert.ok(finalText.split(/\s+/).length <= original.split(/\s+/).length + 120);
  for (const j of [first, second]) assert.equal(f.get(j.contentWork.revisionId)!.status, "verified");
  assert.equal(f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length, 2);
  assert.ok(f.tables.jobs.some(j => j.contentWork?.intent === "create" && j.createdAt > second.contentWork.verifiedAt), "Consumed work must be freshly replenished");
  f.assertOffline();
  return { page, first, second, original, finalText, observations, deadlines: improved().map(j => ({ deadline: j.contentWork.deadlineAt, published: j.contentWork.publishedAt, verified: j.contentWork.verifiedAt })) };
}
test("SLC28 empty inventory creates, measures, improves twice after fourteen days and replenishes without reselection", async t => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], longManagedPage: true });
  const result = await managedMeasuredFollowups(f);
  assert.ok(result.original.split(/\s+/).length >= 2400 && result.original.split(/\s+/).length <= 2600);
  assert.ok(result.finalText.split(/\s+/).length <= 2600);
  t.diagnostic(JSON.stringify({ synthetic: true, adapter: "github", observations: result.observations, deadlines: result.deadlines, ready: 2,
    originalWords: result.original.split(/\s+/).length, finalWords: result.finalText.split(/\s+/).length }));
});

test("SLC selected rollback uses the same provider-free job, restores exact bytes and does not consume a cadence slot", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const selected = await selectExistingPage(f), site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.intent === "improve" && j.contentWork.stage === "verified") &&
    f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  const original = f.tables.jobs.find(j => j.contentWork?.intent === "improve")!;
  const calls = f.modelCalls.length, deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  f.setIdentity(`synthetic-owner-${site.domain}`);
  const args = { siteId: site.id, revisionId: original.contentWork.revisionId, confirm: true };
  const id = await f.invoke("contentImprovements:requestRollback", args);
  assert.equal(await f.invoke("contentImprovements:requestRollback", args), id);
  f.setIdentity(null);
  await pumpUntil(f, () => f.get(id)!.contentWork.stage === "verify", 100, deadline - 5 * 60_000 - 1);
  // Reproduce a failed scheduler delivery before the verifier claimed a lease.
  for (const task of f.tables._scheduled_functions.filter(s => s.name === "publisher:verifyContentImprovement" && s.args.jobId === id && s.state.kind === "pending")) task.state = { kind: "failed" };
  assert.equal((await f.invoke("contentWork:advance", { siteId: site.id })).mode, "public_url_pending");
  await pumpUntil(f, () => f.get(id)!.contentWork.stage === "verified", 100, deadline - 5 * 60_000 - 1);
  assert.equal(f.repositories.get(site.name.toLowerCase())!.files.get(selected.path), selected.raw);
  assert.equal(f.modelCalls.length, calls);
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
  assert.equal(f.get(original.articleId)!.status, "revision");
  assert.equal(f.get(id)!.providerSpendReservationId, undefined);
  assert.equal(f.get(id)!.contentWork.budgetMicroUsd, 0);
  f.assertOffline();
});

test("SLC selected work rejects revoked permission before paid I/O and destination drift before writes", async t => {
  for (const mode of ["revoked", "repository_changed", "profile_changed"]) await t.test(mode, async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
    const selected = await selectExistingPage(f), site = await selectGrowth(f);
    await pumpUntil(f, () => f.tables.jobs?.length > 0, 10);
    const j = f.tables.jobs[0];
    if (mode === "revoked") {
      f.setIdentity(`synthetic-owner-${site.domain}`);
      await f.invoke("selectedPages:revoke", { siteId: site.id, pageId: selected.pageId }); f.setIdentity(null);
    } else if (mode === "repository_changed") f.get(site.id)!.repoName = "different-destination";
    else f.get(site.id)!.pricingInfo = "Changed confirmed business fact";
    await assert.rejects(f.invoke("selectedPages:workContext", { siteId: site.id, jobId: j._id }), /changed/);
    await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: j._id });
    assert.equal(f.modelCalls.length, 0); assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 0);
    assert.equal(f.get(j._id)!.contentWork.providerCalls.length, 0); f.assertOffline();
  });
});

test("SLC selected GitHub preserves a concurrent customer edit and rechecks revocation at the final write fence", async t => {
  for (const boundary of ["customer_commit", "permission", "reviewed_artifact"]) await t.test(boundary, async () => {
    let path = "", fired = false;
    const interfere = async () => {
      if (fired) return; fired = true;
      const site = f.sites[0];
      if (boundary === "customer_commit") { const repo = f.repositories.get(site.name.toLowerCase())!; repo.files.set(path, "Customer's later content must survive."); repo.head = sha("customer-commit"); }
      else if (boundary === "permission") {
        f.setIdentity(`synthetic-owner-${site.domain}`); await f.invoke("selectedPages:revoke", { siteId: site.id, pageId: f.tables.pages.find(p => p.editable)!._id }); f.setIdentity(null);
      } else { const job = f.tables.jobs.find(j => j.contentWork?.intent === "improve")!; f.get(job.articleId)!.markdown += "\nChanged after review."; }
    };
    const f: ReturnType<typeof setup> = setup({ growthFirst: true, businesses: [slcBusinesses[0]], ...(boundary === "customer_commit" ? { githubBeforeWrite: interfere } : { githubBeforeFence: interfere }) });
    const selected = await selectExistingPage(f); path = selected.path;
    const site = await selectGrowth(f);
    await pumpUntil(f, () => fired, 100);
    const repo = f.repositories.get(site.name.toLowerCase())!;
    assert.equal(repo.writes, 0);
    assert.equal(repo.files.get(path), boundary === "customer_commit" ? "Customer's later content must survive." : selected.raw);
    assert.ok(!f.tables.published_article_revisions?.some(r => r.receipt)); f.assertOffline();
  });
});

test("SLC selected improvement reconciles a lost commit response without a second destination write", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], lostCommitResponses: 1 });
  await selectExistingPage(f); const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.intent === "improve" && j.contentWork.stage === "verified"), 150);
  assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 1);
  assert.equal(f.tables.published_article_revisions.length, 1); f.assertOffline();
});

test("SLC selected verification lease survives interruption, duplicate events and stale callbacks", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  await selectExistingPage(f); const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.stage === "verify"), 100);
  const j = f.tables.jobs.find(j => j.contentWork?.stage === "verify")!, args = { siteId: site.id, jobId: j._id };
  const first = await f.invoke("contentImprovements:claimVerification", { ...args, leaseOwner: "interrupted-verifier" }); assert.ok(first);
  assert.equal(await f.invoke("contentImprovements:claimVerification", { ...args, leaseOwner: "duplicate" }), null);
  const r = f.get(j.contentWork.revisionId)!; assert.equal(r.liveVerificationAttempts, 1);
  f.setTime(f.now() + 60_001);
  await f.invoke("contentImprovements:verified", { ...args, leaseOwner: "interrupted-verifier", nextArtifactHash: r.nextArtifactHash });
  assert.equal(f.get(j._id)!.contentWork.stage, "verify");
  await pumpUntil(f, () => f.get(j._id)!.contentWork.stage === "verified", 60);
  assert.equal(f.get(r._id)!.liveVerificationAttempts, 2);
  const deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  await f.invoke("publisher:verifyContentImprovement", args);
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline); f.assertOffline();
});

test("SLC selected weekly review, 14-day cooldown and missing measurements never fabricate a completed improvement", async t => {
  for (const state of ["weekly_wait", "cooldown_wait", "boundary_due", "measurement_unavailable"]) await t.test(state, async () => {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
    const selected = await selectExistingPage(f), site = await selectGrowth(f), e = f.get(selected.pageId)!.editable;
    if (state === "weekly_wait") e.lastReviewedAt = f.now() - 6 * 86_400_000;
    if (state === "cooldown_wait") e.lastImprovedAt = f.now() - 13 * 86_400_000;
    if (state === "boundary_due") { e.lastReviewedAt = f.now() - 7 * 86_400_000; e.lastImprovedAt = f.now() - 14 * 86_400_000; }
    if (state === "measurement_unavailable") f.failReads("search_performance", new Error("Synthetic measurement unavailable"));
    await f.invoke("contentWork:advance", { siteId: site.id });
    assert.equal(f.tables.jobs[0].contentWork.intent, state === "boundary_due" ? "improve" : "create");
    assert.equal(f.tables.jobs[0].contentWork.stage, "prepare");
    assert.equal(f.get(selected.pageId)!.editable.latestRevisionId, undefined);
    assert.equal(f.modelCalls.length, 0); f.assertOffline();
  });
});

test("SLC failed exact-page verification cannot advance a deadline or enter legacy publication", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const selected = await selectExistingPage(f), site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.stage === "verify"), 100);
  const j = f.tables.jobs.find(j => j.contentWork?.stage === "verify")!, deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt;
  const repo = f.repositories.get(site.name.toLowerCase())!;
  repo.files.set(selected.path, repo.files.get(selected.path)!.replace('## Additional reader guidance', '## Hidden or missing reviewed guidance').split('## Define the decision')[0]);
  await pumpUntil(f, () => f.get(j._id)!.contentWork.stage === "failed", 100, f.now() + 20 * 60_000);
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline);
  assert.equal(f.get(selected.pageId)!.editable.lastImprovedAt, undefined);
  assert.equal(f.get(j.contentWork.revisionId)!.liveVerificationAttempts, 5);
  assert.equal(f.get(j.contentWork.revisionId)!.liveVerifiedAt, undefined);
  // Even a retired engine cannot turn a selected-page artifact into creation.
  f.get(site.id)!.serviceMode = "legacy_articles";
  await assert.rejects(f.invoke("publisher:publishArticleInternal", { siteId: site.id, articleId: j.articleId }), /another execution path/);
  assert.equal(repo.writes, 1); f.assertOffline();
});

test("SLC no-op selection cannot count as delivery; bounded review uses a distinct creation replacement", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], selectedNoop: true });
  const selected = await selectExistingPage(f), site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.stage === "verified"), 160);
  const first = f.tables.jobs[0];
  assert.equal(first.contentWork.intent, "create"); assert.equal(first.contentWork.replacements, 1); assert.equal(first.contentWork.revisions, 2);
  assert.equal(f.repositories.get(site.name.toLowerCase())!.files.get(selected.path), selected.raw);
  assert.equal(f.get(selected.pageId)!.editable.lastImprovedAt, undefined);
  assert.equal(f.tables.published_article_revisions?.length ?? 0, 0); f.assertOffline();
});

test("SLC mocked connected GitHub create-review-deliver-verify-refill repeats across five business types", async t => {
  for (const [index, business] of slcBusinesses.entries()) {
    const f = setup({ growthFirst: true, businesses: [business] });
    const intervalMs = (20 + index * 10) * 60_000, site = await selectGrowth(f, intervalMs);
    const ready = () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready");
    await pumpUntil(f, () => ready().length === 2);
    assert.equal(f.tables.articles.filter(a => a.status === "published").length, 0);
    const initial = ready().map(j => j.articleId);
    for (let cycle = 0; cycle < 3; cycle++) {
      const deadlineAt = START + 10 * 60_000 + cycle * intervalMs;
      f.setTime(deadlineAt - 5 * 60_000);
      await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "mocked ordinary fixed clock" });
      await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "verified").length === cycle + 1 && ready().length === 2,
        160, deadlineAt + 60_000);
      const delivered = f.tables.jobs.find(j => j.contentWork?.deadlineAt === deadlineAt)!;
      assert.equal(delivered.contentWork.stage, "verified", diagnostic(f));
      assert.ok(delivered.contentWork.publishedAt >= deadlineAt - 5 * 60_000 && delivered.contentWork.publishedAt <= deadlineAt);
      const article = f.get(delivered.articleId)!;
      assert.equal(article.publicUrlStatus, "verified");
      assert.equal(article.publishedContentHash, delivered.contentWork.approvedArtifactHash);
      assert.equal(f.tables.jobs.filter(j => j.articleId === article._id).length, 1, "one authoritative content-work job through every stage");
      t.diagnostic(JSON.stringify({ fixture: business.name, transports: "mocked", cycle: cycle + 1,
        windowStartAt: new Date(deadlineAt - 5 * 60_000).toISOString(), deadlineAt: new Date(deadlineAt).toISOString(),
        publishedAt: new Date(article.publishedAt).toISOString(), verifiedAt: new Date(article.publicUrlVerifiedAt).toISOString(), buffer: ready().length }));
    }
    assert.ok(ready().every(j => !initial.includes(j.articleId)));
    assert.equal(f.tables.jobs.filter(j => j.type === "plan").length, 0);
    assert.ok(f.tables.topic_clusters.every(topic => topic.searchVolume === undefined && topic.keywordDifficulty === undefined));
    assert.ok(f.modelCalls.every(call => call.model === "mocked-content-model"), "no unpriced model or optional enrichment");
    const count = f.modelCalls.length, writes = f.repositories.get(business.name.toLowerCase())!.writes;
    await Promise.all(Array.from({ length: 3 }, () => f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id })));
    assert.equal(f.modelCalls.length, count); assert.equal(f.repositories.get(business.name.toLowerCase())!.writes, writes);
    f.assertOffline();
  }
});

test("SLC pricing, unknown shared budget and exhausted account or per-work funds stop before mocked paid I/O", async () => {
  for (const scenario of ["unpriced", "unknown", "account_full", "work_full", "attempt_full"] as const) {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], noPricing: scenario === "unpriced", budgetMicroUsd: scenario === "work_full" ? 1 : undefined });
    const site = await selectGrowth(f);
    if (scenario === "unknown") f.failReads("provider_spend_reservations", new Error("Mocked budget read unavailable"));
    if (scenario === "account_full") f.add("provider_spend_reservations", { siteId: site.id, userId: `synthetic-owner-${site.domain}`, purpose: "topic_plan", trigger: "historical", reservedMicroUsd: 28_000_000, createdAt: START });
    if (scenario === "attempt_full") for (let n = 0; n < 170; n++) f.add("article_generation_attempts", { userId: `synthetic-owner-${site.domain}`, jobKey: `old-${n}`, workerAttempt: 0, attemptKey: `old-${n}:0`, monthKey: "2026-09", providerWorkKind: "generation", maxArticles: 150, attemptAllowance: 170, status: "failed", expiresAt: START - 1, createdAt: START - 1, updatedAt: START - 1 });
    if (scenario === "unknown") await assert.rejects(f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id }), /budget read unavailable/);
    else {
      const result = await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
      if (["work_full", "attempt_full"].includes(scenario)) {
        const job = f.tables.jobs.find(j => j.contentWork)!;
        await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
        assert.equal(f.get(job._id)!.status, scenario === "attempt_full" ? "pending" : "failed");
      } else assert.equal(result.mode, scenario === "unpriced" ? "content_pricing_unavailable" : "content_budget_exhausted");
    }
    assert.equal(f.modelCalls.length, 0, scenario); f.assertOffline();
  }
});

test("SLC genuinely ambiguous provider result retains its reservation and requires reconciliation without replay", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], ambiguousProviderFailure: "submit_article" });
  const site = await selectGrowth(f);
  await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
  const job = f.tables.jobs.find(j => j.contentWork)!;
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
  const receipt = f.get(job.providerSpendReservationId)!;
  assert.equal(f.modelCalls.length, 1); assert.equal(receipt.releasedAt, undefined); assert.equal(receipt.settledMicroUsd, undefined);
  for (let n = 0; n < 3; n++) {
    await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
    await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
  }
  assert.equal(f.modelCalls.length, 1); assert.equal(f.tables.jobs.length, 1);
  assert.equal(f.get(job._id)!.contentWork.failure, "content_provider_result_ambiguous_reconciliation_required");
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, START + 10 * 60_000);
  f.assertOffline();
});

test("SLC repair26 due ready delivery outranks an unfinished future refill", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  f.setTime(START + 5 * 60_000);
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "first mocked slot" });
  await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.stage === "verified") && f.tables.jobs.length === 3);
  const due = f.tables.jobs.find(j => j.contentWork?.stage === "ready")!;
  assert.ok(f.tables.jobs.some(j => j.contentWork?.stage === "prepare" && j.status === "pending"));
  f.setTime(due.contentWork.windowStartAt);
  const background = f.tables.jobs.find(j => j.contentWork?.stage === "prepare")!, calls = f.modelCalls.length;
  assert.equal((await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: background._id })).processed, false,
    "an already-scheduled preparation worker cannot race ahead of an exact due ready artifact");
  assert.equal(f.modelCalls.length, calls);
  assert.equal((await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id })).mode, "buffer_delivery");
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "second mocked slot" });
  await pumpUntil(f, () => f.get(due._id)!.contentWork.stage === "verified" && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2,
    180, due.contentWork.deadlineAt + 60_000);
  assert.ok(f.get(due._id)!.contentWork.publishedAt <= due.contentWork.deadlineAt); f.assertOffline();
});

test("SLC repair26 transient provider rejection recovers the same work through delivery and refill", async t => {
  const options = { growthFirst: true, businesses: [slcBusinesses[0]], providerFailure: "submit_article" as string | undefined };
  const f = setup(options), site = await selectGrowth(f);
  await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
  const job = f.tables.jobs.find(j => j.contentWork)!;
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
  assert.equal(f.get(job._id)!.status, "pending", "known transient rejection must have bounded recovery, not permanent shutdown");
  const originalReservationId = job.providerSpendReservationId;
  const firstRejected = f.get(job._id)!.contentWork.providerCalls[0];
  assert.equal(firstRejected.state, "rejected"); assert.equal(firstRejected.actualMicroUsd, undefined);
  await Promise.all(Array.from({ length: 3 }, () => f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id })));
  assert.equal(f.modelCalls.length, 1, "duplicate early wakes cannot bypass backoff");
  options.providerFailure = undefined;
  await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  f.setTime(Math.max(f.now(), START + 5 * 60_000));
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "recovered mocked slot" });
  await pumpUntil(f, () => f.get(job._id)!.contentWork.stage === "verified" && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  assert.equal(f.get(job._id)!.contentWork.deadlineAt, START + 10 * 60_000);
  assert.equal(f.get(job._id)!.contentWork.replacements, 0); f.assertOffline();
  const closed = f.get(job._id)!;
  assert.equal(closed.providerSpendReservationId, originalReservationId);
  assert.ok(closed.workerAttempts >= 1); assert.equal(closed.contentWork.recoveryAttempts, 1);
  assert.equal(new Set(closed.contentWork.providerCalls.map((c: Fields) => c.key)).size, closed.contentWork.providerCalls.length);
  assert.ok(closed.contentWork.providerCalls.reduce((sum: number, c: Fields) => sum + (c.actualMicroUsd ?? c.ceilingMicroUsd), 0) <= closed.contentWork.budgetMicroUsd);
  assert.equal(f.get(originalReservationId)!.settledAt, undefined, "rejection is not assumed free; original reservation remains conservative");
  t.diagnostic(JSON.stringify({ scenario: "known_rejection_recovered", transports: "mocked", deadlineAt: new Date(closed.contentWork.deadlineAt).toISOString(),
    publishedAt: new Date(closed.contentWork.publishedAt).toISOString(), verifiedAt: new Date(closed.contentWork.verifiedAt).toISOString(),
    buffer: 2, recoveryAttempts: closed.contentWork.recoveryAttempts }));
});

test("SLC repair26 running refill crosses the delivery window without starving or duplicating publication", async t => {
  const options: Parameters<typeof setup>[0] = { growthFirst: true, businesses: [slcBusinesses[0]], failedOptionalSource: true };
  const f = setup(options), site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  f.setTime(START + 5 * 60_000);
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "first mocked slot" });
  await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.stage === "verified") && f.tables.jobs.length === 3);
  const due = f.tables.jobs.find(j => j.contentWork?.stage === "ready")!, background = f.tables.jobs.find(j => j.contentWork?.stage === "prepare")!;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  options.providerBarrier = async tool => { if (tool === "submit_article") { entered(); await held; } };
  f.setTime(due.contentWork.windowStartAt - 1);
  const worker = f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: background._id });
  await started;
  assert.equal(f.get(background._id)!.status, "running");
  f.setTime(due.contentWork.windowStartAt);
  await Promise.all(Array.from({ length: 3 }, () => f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "overlapping fixed window" })));
  await pumpUntil(f, () => f.get(due._id)!.contentWork.stage === "verified", 120, due.contentWork.deadlineAt);
  assert.equal(f.get(background._id)!.status, "running", "actual provider worker still outstanding when delivery verified");
  assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 2);
  assert.ok(f.get(due._id)!.contentWork.publishedAt <= due.contentWork.deadlineAt);
  options.providerBarrier = undefined; release(); await worker;
  await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 160, due.contentWork.deadlineAt + 60_000);
  assert.equal(f.tables.jobs.filter(j => j.contentWork?.stage === "verified").length, 2); f.assertOffline();
  const delivered = f.get(due._id)!.contentWork;
  t.diagnostic(JSON.stringify({ scenario: "delivery_with_running_refill", transports: "mocked", deadlineAt: new Date(delivered.deadlineAt).toISOString(),
    publishedAt: new Date(delivered.publishedAt).toISOString(), verifiedAt: new Date(delivered.verifiedAt).toISOString(), buffer: 2 }));
});

test("SLC repair26 future review failure and funding deferral cannot outrank a due sealed article", async () => {
  for (const scenario of ["review_failed", "allowance_deferred", "ambiguous_failed"] as const) {
    const options: Parameters<typeof setup>[0] = { growthFirst: true, businesses: [slcBusinesses[0]] };
    const f = setup(options), site = await selectGrowth(f);
    await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
    f.setTime(START + 5 * 60_000);
    await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "first mocked slot" });
    await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.stage === "verified") && f.tables.jobs.length === 3);
    const due = f.tables.jobs.find(j => j.contentWork?.stage === "ready")!, background = f.tables.jobs.find(j => j.contentWork?.stage === "prepare")!;
    if (scenario === "review_failed") {
      await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: background._id });
      options.quality = "low";
      await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: background._id });
      assert.equal(f.get(background._id)!.contentWork.stage, "review_failed");
      options.quality = undefined;
    } else if (scenario === "ambiguous_failed") {
      options.ambiguousProviderFailure = "submit_article";
      await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: background._id });
      options.ambiguousProviderFailure = undefined;
    } else {
      await f.invoke("jobs:claimPending", { siteId: site.id, jobId: background._id, workerToken: "deferred-worker" });
      await f.invoke("jobs:deferArticleProviderMonthlyAllowance", { jobId: background._id, workerToken: "deferred-worker" });
    }
    f.setTime(due.contentWork.windowStartAt);
    assert.equal((await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id })).mode, "buffer_delivery", scenario);
    await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "due work despite future issue" });
    await pumpUntil(f, () => f.get(due._id)!.contentWork.stage === "verified", 120, due.contentWork.deadlineAt);
    assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 2);
    if (scenario === "review_failed") await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 180, due.contentWork.deadlineAt + 60_000);
    else assert.notEqual(f.get(background._id)!.contentWork.stage, "verified", "unresolved future work is not called successful recovery");
    f.assertOffline();
  }
});

test("SLC repair26 completed provider checkpoints survive a later rejected review call without replay", async () => {
  const options = { growthFirst: true, businesses: [slcBusinesses[0]], providerFailure: "audit_final_article" as string | undefined };
  const f = setup(options), site = await selectGrowth(f);
  await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
  const job = f.tables.jobs.find(j => j.contentWork)!;
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
  const original = f.get(job._id)!;
  assert.equal(original.status, "pending"); options.providerFailure = undefined;
  f.setTime(original.nextAttemptAt);
  await Promise.all(Array.from({ length: 3 }, () => f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id })));
  assert.equal(f.get(job._id)!.contentWork.stage, "ready", diagnostic(f));
  assert.equal(f.modelCalls.filter(c => c.tools[0].name === "submit_article").length, 1);
  assert.equal(f.modelCalls.filter(c => c.tools[0].name === "review_article").length, 1);
  assert.equal(f.modelCalls.filter(c => c.tools[0].name === "audit_final_article").length, 2);
  assert.equal(f.tables.articles.length, 1); f.assertOffline();
});

test("SLC repair26 no-I/O lease restart and UTC rollover retain one work envelope and exact deadline", async t => {
  for (const checkpoint of [false, true]) {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f, 48 * 60 * 60_000);
    await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
    const job = f.tables.jobs.find(j => j.contentWork)!;
    const originalReservationId = job.providerSpendReservationId;
    if (checkpoint) await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
    const initialCalls = f.modelCalls.length;
    await f.invoke("jobs:claimPending", { siteId: site.id, jobId: job._id, workerToken: "crashed-before-next-call" });
    f.setTime(START + 24 * 60 * 60_000);
    await Promise.all(Array.from({ length: 3 }, () => f.invoke("jobs:resetStuckJobs", { siteId: site.id, jobId: job._id, expectedWorkerToken: "crashed-before-next-call" })));
    assert.equal(f.get(job._id)!.contentWork.recoveryAttempts, 1);
    assert.equal(f.modelCalls.length, initialCalls);
    await pumpUntil(f, () => f.get(job._id)!.contentWork.stage === "ready", 120, f.now() + 10 * 60_000);
    const recovered = f.get(job._id)!;
    assert.notEqual(recovered.providerSpendReservationId, originalReservationId);
    const prior = f.get(originalReservationId)!, current = f.get(recovered.providerSpendReservationId)!;
    if (checkpoint) assert.equal(prior.settledMicroUsd, 200); else assert.ok(prior.releasedAt !== undefined);
    assert.equal(current.reservedMicroUsd + (prior.settledMicroUsd ?? 0), recovered.contentWork.budgetMicroUsd);
    assert.equal(recovered.contentWork.deadlineAt, START + 10 * 60_000);
    assert.equal(f.modelCalls.filter(c => c.tools[0].name === "submit_article").length, 1);
    assert.equal(recovered.workerAttempts, 1);
    await pumpUntil(f, () => f.get(job._id)!.contentWork.stage === "verified" && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2,
      180, f.now() + 10 * 60_000);
    const delivered = f.get(job._id)!.contentWork;
    t.diagnostic(JSON.stringify({ scenario: checkpoint ? "persisted_draft_rollover" : "no_io_lease_rollover", transports: "mocked",
      deadlineAt: new Date(delivered.deadlineAt).toISOString(), publishedAt: new Date(delivered.publishedAt).toISOString(),
      verifiedAt: new Date(delivered.verifiedAt).toISOString(), explicitlyLate: true, buffer: 2 }));
    f.assertOffline();
  }
});

test("SLC repair26 rollover cannot borrow a new budget when costs are uncertain or account headroom is exhausted", async () => {
  for (const uncertain of [false, true]) {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
    await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
    const job = f.tables.jobs.find(j => j.contentWork)!, reservationId = job.providerSpendReservationId;
    if (uncertain) {
      await f.invoke("jobs:claimPending", { siteId: site.id, jobId: job._id, workerToken: "uncertain-worker" });
      await f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: "uncertain-worker", key: "unknown", ceilingMicroUsd: 100 });
    }
    f.setTime(START + 24 * 60 * 60_000);
    if (uncertain) await f.invoke("jobs:resetStuckJobs", { siteId: site.id, jobId: job._id, expectedWorkerToken: "uncertain-worker" });
    else {
      f.add("provider_spend_reservations", { siteId: site.id, userId: `synthetic-owner-${site.domain}`, purpose: "topic_plan", trigger: "valid-other-work",
        reservedMicroUsd: 28_000_000, createdAt: f.now() });
      await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
    }
    const closed = f.get(job._id)!;
    assert.equal(closed.status, "failed"); assert.equal(closed.providerSpendReservationId, reservationId);
    assert.equal(f.modelCalls.length, 0); assert.equal(f.get(reservationId)!.releasedAt !== undefined, !uncertain);
    if (!uncertain) assert.match(closed.contentWork.failure, /rollover blocked: provider_account_monthly_budget_reserved; requestedMicroUsd=500000; consumedMicroUsd=28000000; ceilingMicroUsd=28000000/);
    else assert.equal(closed.contentWork.failure, "content_provider_result_ambiguous_reconciliation_required");
    assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, START + 10 * 60_000); f.assertOffline();
  }
});

test("SLC repair26 completed response checkpoint is immutable, idempotent and request-bound", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] }), site = await selectGrowth(f);
  await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
  const job = f.tables.jobs.find(j => j.contentWork)!;
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
  const call = structuredClone(f.get(job._id)!.contentWork.providerCalls[0]);
  await f.invoke("jobs:claimPending", { siteId: site.id, jobId: job._id, workerToken: "resumed-worker" });
  const args = { jobId: job._id, workerToken: "resumed-worker", key: call.logicalKey, requestHash: call.requestHash, ceilingMicroUsd: call.ceilingMicroUsd };
  for (let n = 0; n < 3; n++) assert.equal((await f.invoke("contentWork:beginProviderCall", args)).kind, "cached");
  await assert.rejects(f.invoke("contentWork:beginProviderCall", { ...args, requestHash: "different-request" }), /request changed/);
  await f.invoke("contentWork:completeProviderCall", { jobId: job._id, workerToken: "resumed-worker", key: call.key, actualMicroUsd: call.actualMicroUsd, result: call.result });
  await assert.rejects(f.invoke("contentWork:completeProviderCall", { jobId: job._id, workerToken: "resumed-worker", key: call.key, actualMicroUsd: call.actualMicroUsd, result: { tampered: true } }), /settlement conflict/);
  assert.equal(f.modelCalls.length, 1); assert.deepEqual(f.get(job._id)!.contentWork.providerCalls[0], call); f.assertOffline();
});

test("SLC repair26 repeated rejection exhausts bounded recovery without extra candidates or erased spend", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], providerFailure: "submit_article", budgetMicroUsd: 2_000_000 });
  const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.stage === "failed"));
  const job = f.tables.jobs[0];
  assert.equal(f.modelCalls.length, 4); assert.equal(job.contentWork.recoveryAttempts, 3);
  assert.equal(job.contentWork.failure, "content_recovery_attempts_exhausted");
  assert.equal(f.tables.jobs.length, 1); assert.equal(job.contentWork.replacements, 0);
  assert.equal(f.get(job.providerSpendReservationId)!.settledAt, undefined);
  for (let n = 0; n < 3; n++) await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "job_retry", reason: "duplicate terminal wake" });
  assert.equal(f.modelCalls.length, 4); assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, START + 10 * 60_000); f.assertOffline();
});

test("SLC bounded reviews allow two targeted revisions and one distinct replacement, never unsupported acceptance", async () => {
  for (const quality of ["unsupported", "low"] as const) {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], quality, budgetMicroUsd: 2_000_000 });
    await selectGrowth(f);
    await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.stage === "failed"));
    const jobs = f.tables.jobs.filter(j => j.contentWork); assert.equal(jobs.length, 1, diagnostic(f));
    assert.equal(jobs[0].contentWork.revisions, 2); assert.equal(jobs[0].contentWork.replacements, 1);
    assert.equal(f.modelCalls.filter(c => c.tools?.[0]?.name === "submit_article").length, 2);
    assert.equal(f.modelCalls.filter(c => c.tools?.[0]?.name === "remediate_final_article").length, 2);
    assert.equal(f.tables.articles.filter(a => a.status === "published" || a.publicationGateStatus === "passed").length, 0);
    assert.equal(f.tables.provider_spend_reservations.length, 1, "replacement shares the original budget");
    assert.equal(f.tables.provider_spend_reservations[0].settledMicroUsd,
      jobs[0].contentWork.providerCalls.reduce((sum: number, call: { actualMicroUsd: number }) => sum + call.actualMicroUsd, 0),
      "terminal quality failure settles known mock usage instead of retaining the full envelope");
    assert.equal(new Set(f.tables.articles.map(a => a.topicId)).size, 2);
    f.assertOffline();
  }
});

test("SLC persisted checkpoint survives restart and duplicate workers without another initial draft", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], failedOptionalSource: true });
  const site = await selectGrowth(f);
  await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
  const job = f.tables.jobs.find(j => j.contentWork)!;
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
  assert.equal(f.get(job._id)!.contentWork.stage, "review");
  await Promise.all(Array.from({ length: 3 }, () => f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id })));
  assert.equal(f.get(job._id)!.contentWork.stage, "ready", diagnostic(f));
  assert.equal(f.modelCalls.filter(c => c.tools?.[0]?.name === "submit_article").length, 1);
  assert.equal(f.get(job.providerSpendReservationId)!.settledMicroUsd, 600, "three mocked 100/100 usage receipts, not a cash-spend assertion");
  assert.ok(f.logs.some(log => log.includes("crawl") || log.includes("Crawl")));
  f.assertOffline();
});

test("SLC migration consent, tenant isolation and single-engine admission preserve the legacy path", async () => {
  const f = setup({ growthFirst: true });
  const site = f.sites[0], other = f.sites[1];
  f.setIdentity(`synthetic-owner-${other.domain}`);
  await assert.rejects(f.invoke("contentWork:selectServiceMode", { siteId: site.id, mode: "growth_first", confirmBusinessProfile: true }), /Not authorized/);
  await selectGrowth(f);
  const topicId = f.add("topic_clusters", { siteId: site.id, primaryKeyword: site.keywords[0], label: site.keywords[0], status: "planned", secondaryKeywords: [], createdAt: START, updatedAt: START });
  const results = await Promise.all([
    f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id }),
    f.invoke("jobs:queuePlanIfAbsent", { siteId: site.id, reason: "topic_replenishment" }),
    f.invoke("jobs:queueTopicArticleIfAbsent", { siteId: site.id, topicId, bufferFill: true }),
  ]);
  assert.equal(results[0].mode, "buffer_fill"); assert.equal(results[1].queued, false); assert.equal(results[2].queued, false);
  assert.equal(f.tables.jobs.filter(j => j.siteId === site.id).length, 1);
  const legacy = await f.invoke("jobs:queuePlanIfAbsent", { siteId: other.id, reason: "topic_replenishment" }); assert.equal(legacy.queued, true);
  f.setIdentity(`synthetic-owner-${site.domain}`);
  await assert.rejects(f.invoke("contentWork:selectServiceMode", { siteId: site.id, mode: "legacy_articles", confirmBusinessProfile: false }), /Reconcile/);
  assert.equal(f.modelCalls.length, 0); f.assertOffline();
});

test("SLC lost publication acknowledgement reconciles exact GitHub bytes without duplicate write, then refills", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], lostCommitResponses: 1 });
  const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  f.setTime(START + 5 * 60_000);
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "mocked window" });
  await pumpUntil(f, () => f.tables.jobs.some(j => j.contentWork?.stage === "verified") && f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2, 180, START + 180 * 60_000);
  assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 1);
  assert.equal(f.tables.jobs.filter(j => j.contentWork?.stage === "verified").length, 1);
  assert.equal(f.tables.jobs.find(j => j.contentWork?.stage === "verified")!.contentWork.deadlineAt, START + 10 * 60_000);
  f.assertOffline();
});

test("SLC mismatched canonical, title or rendered body never verifies and never advances the deadline", async () => {
  for (const liveCorrupt of ["canonical", "title", "body"] as const) {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]], liveCorrupt });
    const site = await selectGrowth(f);
    await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
    f.setTime(START + 5 * 60_000);
    await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "mocked window" });
    await pumpUntil(f, () => f.tables.articles.some(a => a.publicUrlStatus === "failed"), 180, START + 48 * 60 * 60_000);
    assert.equal(f.tables.jobs.filter(j => j.contentWork?.stage === "verified").length, 0);
    assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, START + 10 * 60_000); f.assertOffline();
  }
});

test("SLC changed connection, revoked access and changed confirmed facts stop before further provider work", async () => {
  for (const change of ["connection", "revoked", "profile", "lease", "entitlement"] as const) {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
    const site = await selectGrowth(f);
    await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
    const job = f.tables.jobs.find(j => j.contentWork)!;
    if (change === "connection") f.get(site.id)!.publisherConnectionGeneration = 1;
    if (change === "revoked") f.get(site.id)!.githubToken = undefined;
    if (change === "profile") f.get(site.id)!.siteSummary = "Unconfirmed replacement facts";
    if (change === "entitlement") f.tables.account_plan_entitlements[0].status = "pending";
    if (change === "lease") {
      await f.invoke("jobs:claimPending", { siteId: site.id, jobId: job._id, workerToken: "old-worker" });
      f.get(job._id)!.leaseExpiresAt = START - 1;
      await assert.rejects(f.invoke("contentWork:beginProviderCall", { jobId: job._id, workerToken: "old-worker", key: "stale", ceilingMicroUsd: 100 }), /authority changed/);
    } else {
      await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
      if (change === "entitlement") {
        // The existing site query hides sites with revoked entitlement before
        // the scheduler routes them; direct admission must independently deny.
        await assert.rejects(f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id }), /Site not found/);
        assert.equal((await f.invoke("contentWork:advance", { siteId: site.id })).mode, "content_paused");
      } else {
        assert.equal((await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id })).mode, "content_binding_changed");
      }
    }
    assert.equal(f.modelCalls.length, 0, change);
    const receipt = f.get(job.providerSpendReservationId)!;
    assert.equal(receipt.releasedAt !== undefined, f.get(job._id)!.status === "failed",
      "only a terminal no-I/O job releases; revoked but pending work stays reserved"); f.assertOffline();
  }
});

test("SLC terminal cancellation releases only proven no-I/O reservations, idempotently", async () => {
  for (const reason of ["cancel_before_call", "cancel_after_call_started"] as const) {
    const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
    const site = await selectGrowth(f);
    await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
    const job = f.tables.jobs.find(j => j.contentWork)!;
      await f.invoke("jobs:claimPending", { siteId: site.id, jobId: job._id, workerToken: "cancel-worker" });
      if (reason === "cancel_after_call_started") await f.invoke("contentWork:beginProviderCall", {
        jobId: job._id, workerToken: "cancel-worker", key: "in-flight-request", ceilingMicroUsd: 100 });
      await Promise.all(Array.from({ length: 3 }, () => f.invoke("jobs:markFailed", {
        jobId: job._id, workerToken: "cancel-worker", error: "Synthetic terminal cancellation" })));
    const closed = f.get(job._id)!, receipt = f.get(job.providerSpendReservationId)!;
    assert.equal(closed.status, "failed"); assert.equal(closed.contentWork.stage, "failed");
    assert.equal(receipt.releasedAt !== undefined, reason !== "cancel_after_call_started");
    assert.equal(receipt.settledMicroUsd, undefined); assert.equal(f.modelCalls.length, 0);
    const attempts = closed.workerAttempts, releasedAt = receipt.releasedAt;
    await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
    assert.equal(f.get(job._id)!.workerAttempts, attempts); assert.equal(f.get(receipt._id)!.releasedAt, releasedAt);
    assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, START + 10 * 60_000); f.assertOffline();
  }
});

test("SLC initial preparation activates warm mode without measurements, and overdue deadlines never move", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const site = f.sites[0]; f.get(site.id)!.autopilotRolloutMode = "warm";
  f.get(site.id)!.gscAccessToken = undefined; f.get(site.id)!.gscProperty = undefined;
  await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  const count = f.modelCalls.length;
  f.setTime(START + 12 * 60_000);
  const state = f.get(site.id)!.contentSchedule;
  await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
  assert.equal(f.get(site.id)!.autopilotRolloutMode, "live");
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, state.nextDeadlineAt);
  const job = f.tables.jobs.find(j => j.contentWork?.stage === "publish")!;
  assert.equal(job.contentWork.deadlineAt, START + 10 * 60_000);
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: job._id });
  assert.ok(f.get(job.articleId)!.publishedAt > job.contentWork.deadlineAt, "late publication is explicitly late, never a moved deadline");
  assert.equal(f.modelCalls.length, count); f.assertOffline();
});

test("SLC confirmed inventory rejects duplicate existing reader intent and blocks absent business inputs", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const site = await selectGrowth(f);
  f.add("pages", { siteId: site.id, slug: "/guide", url: `https://${site.domain}/guide`, title: site.keywords[0], keywords: [site.keywords[0]], createdAt: START });
  const off = f.add("topic_clusters", { siteId: site.id, primaryKeyword: "ceramic glaze inventory tracking", label: "Ceramic glaze inventory tracking", status: "planned", secondaryKeywords: [], createdAt: START, updatedAt: START });
  await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id });
  const job = f.tables.jobs.find(j => j.contentWork)!;
  assert.notEqual(job.payload.topicId, off); assert.notEqual(f.get(job.payload.topicId)!.primaryKeyword, site.keywords[0]);
  assert.equal(f.get(job.payload.topicId)!.searchVolume, undefined);
  const empty = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const emptySite = empty.sites[0]; Object.assign(empty.get(emptySite.id)!, { anchorKeywords: [], keyFeatures: [], painPoints: [], productUsage: undefined });
  await selectGrowth(empty);
  assert.equal((await empty.invoke("actions/scheduler:scheduleCadence", { siteId: emptySite.id })).mode, "content_inputs_exhausted");
  assert.equal(empty.modelCalls.length, 0); f.assertOffline(); empty.assertOffline();
});

test("SLC create cannot overwrite an existing customer-edited or earlier Pentra-owned path", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  const job = f.tables.jobs.find(j => j.contentWork?.stage === "ready")!, article = f.get(job.articleId)!;
  const path = `content/blog/${article.slug.replace(/^\//, "")}.md`, original = '---\ngenerator: "pentra"\npentraDeliveryKey: "earlier-work"\n---\nCustomer-edited existing page';
  const repo = f.repositories.get(site.name.toLowerCase())!; repo.files.set(path, original);
  f.setTime(START + 5 * 60_000);
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "content_window", reason: "mocked window" });
  await pumpUntil(f, () => f.get(job._id)!.status === "failed", 180, START + 180 * 60_000);
  assert.equal(repo.files.get(path), original); assert.equal(repo.writes, 0);
  assert.equal((await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id })).mode, "content_failed_slot",
    "a terminal publisher must not be mislabeled as pending delivery");
  assert.equal(f.get(job._id)!.contentWork.failure, "content_publication_failed_reconciliation_required");
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, START + 10 * 60_000); f.assertOffline();
});

test("SLC owner-requested approval stops delivery and exact intent never becomes distinct because SERPs differ", async () => {
  const f = setup({ growthFirst: true, businesses: [slcBusinesses[0]] });
  const site = await selectGrowth(f);
  await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === "ready").length === 2);
  const count = f.modelCalls.length;
  f.get(site.id)!.approvalRequired = true;
  f.setTime(START + 12 * 60_000);
  assert.equal((await f.invoke("actions/scheduler:scheduleCadence", { siteId: site.id })).mode, "approval_waiting");
  assert.equal(f.repositories.get(site.name.toLowerCase())!.writes, 0); assert.equal(f.modelCalls.length, count);
  assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, START + 10 * 60_000);
  assert.equal(contentIntentConflicts({ primaryKeyword: "garden visit checklist", serpTopUrls: Array.from({ length: 5 }, (_, i) => `https://a${i}.example/guide`) },
    { primaryKeyword: "Garden visit checklist", serpTopUrls: Array.from({ length: 5 }, (_, i) => `https://b${i}.example/guide`) }), true);
  assert.equal(contentIntentConflicts({ primaryKeyword: "garden visit checklist" }, { primaryKeyword: "garden pruning request" }), false);
  f.assertOffline();
});

const extraEvidence = { url: "https://unused.example.edu/extra", title: "Unused synthetic primary candidate",
  text: "This synthetic appendix concerns document retention headings, not field-register contents or outcomes. Its example fields are a custodian heading and a storage heading. It provides no measurements of commercial performance, resource savings, or the behavior of a product." };
const primaryEvidence = articlePayload("fixture").sources.map((source, index) => ({ ...source,
  text: index === 0 ? evidenceText : "The synthetic review manual contains a consent heading and an archive heading. Its proposed procedure asks a reviewer to explain the permissions needed to consult a document. This source describes only its example review manual, not the fields of a register, resource savings, or commercial product capabilities." }));
const taintedBrief = `${evidenceText}\nREJECTED_ONLY_PRISM_MARKER: a completed valve inspection reduces annual water consumption by 37% [1]. Source: ${extraEvidence.url}`;

async function finishUnoptedEvidenceArticle(options: Parameters<typeof setup>[0]) {
  const f = setup(options), site = f.sites[0];
  await f.invoke("articles:migrateLegacyArticles", {});
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic unopted evidence safety" });
  await pumpUntil(f, () => f.tables.articles.some(article => article.status === "ready") ||
    f.trace.some(row => row.name === "actions/pipeline:processNextJob" && row.result?.qualityQuarantined));
  const article = f.tables.articles[0];
  assert.ok(article, diagnostic(f));
  assert.ok(f.trace.some(row => row.name === "jobs:yieldGeneratedArticleForReview" && row.args.articleId === article._id), "Keep the normal lease/checkpoint review handoff");
  f.assertOffline();
  return { ...f, site, article };
}

test("unopted worker excludes failed unused evidence and its blended claims without losing good snapshots", async () => {
  const f = await finishUnoptedEvidenceArticle({ evidence: { sources: [...primaryEvidence, extraEvidence], failed: [extraEvidence.url], brief: taintedBrief } });
  assert.equal(f.article.status, "ready"); assert.equal(f.article.publicationGateStatus, "passed");
  assert.equal(f.article.claimEvidenceStatus, "passed");
  assert.equal(f.article.auditedContentHash, publicationArtifactHash({ ...f.article, title: f.article.title, slug: f.article.slug, markdown: f.article.markdown }));
  assert.deepEqual(f.article.sources.map((source: Fields) => source.url), primaryEvidence.map(source => source.url));
  for (const [index, source] of f.article.sources.entries()) {
    assert.equal(source.contentHash, sha256Hex(primaryEvidence[index].text));
    assert.equal(source.excerpt, primaryEvidence[index].text);
  }
  const writer = f.modelCalls.find(body => body.tools?.[0]?.name === "submit_article")!;
  assert.ok(!JSON.stringify(writer).includes("REJECTED_ONLY_PRISM_MARKER"), "Rejected blended claim reached the actual production-equivalent writer");
  assert.ok(!JSON.stringify(f.modelCalls).includes(extraEvidence.url));
  assert.ok(!JSON.stringify(f.modelCalls).includes("REJECTED_ONLY_PRISM_MARKER"));
  assert.ok(!JSON.stringify(f.article).includes("REJECTED_ONLY_PRISM_MARKER"));
  assert.ok(!f.article.researchEvidenceSummary.includes(extraEvidence.url));
  assert.ok(f.article.editorialQualityNotes.some((note: string) => note.includes("Excluded 1 source")));
  assert.ok(f.article.editorialQualityNotes.some((note: string) => note.startsWith("Discarded the blended research brief")));
});

test("unopted failed first or middle, competitor and capture-limit exclusions preserve exact citation identity", async () => {
  const withinLimit = [...primaryEvidence, ...Array.from({ length: 6 }, (_, index) => ({ ...extraEvidence,
    url: `https://appendix${index}.example.edu/primary`, title: `Synthetic primary appendix ${index}` }))];
  for (const scenario of [
    { name: "failed_first", sources: [extraEvidence, ...primaryEvidence], failed: [extraEvidence.url], expected: primaryEvidence },
    { name: "failed_middle", sources: [primaryEvidence[0], extraEvidence, primaryEvidence[1]], failed: [extraEvidence.url], expected: primaryEvidence },
    { name: "competitor", sources: [...primaryEvidence, extraEvidence], competitor: "unused.example.edu", expected: primaryEvidence },
    { name: "capture_limit", sources: [...withinLimit, extraEvidence], expected: withinLimit },
  ]) {
    const f = await finishUnoptedEvidenceArticle({ evidence: { ...scenario, brief: taintedBrief } });
    const article = f.article;
    assert.equal(article.publicationGateStatus, "passed", scenario.name);
    assert.equal(article.claimEvidenceStatus, "passed", scenario.name);
    assert.equal(article.auditedContentHash, publicationArtifactHash({ ...article, title: article.title, slug: article.slug, markdown: article.markdown }));
    assert.deepEqual(article.sources.map((source: Fields) => source.url), scenario.expected.map(source => source.url));
    for (const [index, source] of article.sources.entries()) {
      assert.equal(source.contentHash, sha256Hex(scenario.expected[index].text));
      assert.equal(source.excerpt, scenario.expected[index].text);
      assert.ok(article.researchEvidenceSummary.includes(`[${index + 1}] ${source.title}\nURL: ${source.url}`));
    }
    const writer = f.modelCalls.find(body => body.tools?.[0]?.name === "submit_article")!;
    assert.ok(writer.messages[0].content.includes(`[1] ${primaryEvidence[0].title} — ${primaryEvidence[0].url}`));
    assert.ok(article.claimEvidence.some((claim: Fields) => claim.claim.includes("field register") && JSON.stringify(claim.citationNumbers) === "[1]"));
    assert.ok(!JSON.stringify(f.modelCalls).includes("REJECTED_ONLY_PRISM_MARKER"), scenario.name);
    assert.ok(!JSON.stringify(f.modelCalls).includes(extraEvidence.url), scenario.name);
    assert.ok(!JSON.stringify(article).includes("REJECTED_ONLY_PRISM_MARKER"), scenario.name);
    assert.ok(!article.researchEvidenceSummary.includes(extraEvidence.url));
    assert.ok(article.editorialQualityNotes.some((note: string) => note.startsWith("Discarded the blended research brief")));
    if (scenario.name === "capture_limit" || scenario.name === "competitor") {
      assert.ok(!f.trace.some(row => row.name === "network" && row.args.url === extraEvidence.url), "Excluded candidate is not fetched");
    }
    assert.equal(f.modelCalls.filter(body => JSON.stringify(body.input ?? "").includes("Research this topic thoroughly for an SEO article:")).length,
      f.modelCalls.filter(body => body.tools?.[0]?.name === "submit_article").length,
      "One article-evidence research per writer; ordinary other web-search features are not disabled or miscounted as research retries");
  }
});

test("unopted all-captured evidence retains its brief and the ordinary media and checkpoint paths", async () => {
  const marker = "CAPTURED_BRIEF_CONTROL_MARKER";
  const f = await finishUnoptedEvidenceArticle({ evidence: { sources: [...primaryEvidence, extraEvidence], brief: `${evidenceText}\n${marker}` } });
  assert.equal(f.article.publicationGateStatus, "passed");
  assert.equal(f.article.auditedContentHash, publicationArtifactHash({ ...f.article, title: f.article.title, slug: f.article.slug, markdown: f.article.markdown }));
  assert.equal(f.article.sources.length, 3);
  assert.ok(f.modelCalls.find(body => body.tools?.[0]?.name === "submit_article")!.messages[0].content.includes(marker));
  assert.ok(!f.article.editorialQualityNotes.some((note: string) => note.startsWith("Discarded the blended research brief")));
  assert.ok(f.modelCalls.some(body => JSON.stringify(body.input ?? "").includes("strict editorial art director")), "Ordinary optional media decision is unchanged");
});

test("unopted actual unsupported reliance remains quarantined after rejected research is excluded", async () => {
  const f = await finishUnoptedEvidenceArticle({ quality: "unsupported", evidence: {
    sources: [...primaryEvidence, extraEvidence], failed: [extraEvidence.url], brief: taintedBrief } });
  assert.notEqual(f.article.claimEvidenceStatus, "passed");
  assert.notEqual(f.article.publicationGateStatus, "passed");
  assert.notEqual(f.article.status, "ready"); assert.notEqual(f.article.status, "published");
  assert.equal(f.repositories.get(f.site.name.toLowerCase())!.writes, 0);
  assert.ok(!f.article.researchEvidenceSummary.includes("37%"));
  assert.ok(!f.article.researchEvidenceSummary.includes(extraEvidence.url));
  assert.ok(!JSON.stringify(f.modelCalls).includes("REJECTED_ONLY_PRISM_MARKER"));
  assert.ok(!f.modelCalls.find(body => body.tools?.[0]?.name === "submit_article")!.messages[0].content.includes("37%"));
});

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
  // Advance to the already configured second due period, not an early manual
  // publication. Stale watchdogs are drained by the same scheduled executor.
  const dailySite = f.sites[0];
  const first = f.tables.articles.find(a => a.siteId === dailySite.id && a.status === "published")!;
  const dueAt = first.publishedAt + 86_400_000;
  assert.ok(f.tables.autopilot_runs.some(r => r.siteId === dailySite.id && r.scheduledAt === dueAt && r.status === "scheduled"));
  f.setTime(dueAt);
  await pumpUntil(f, () => {
    const second = f.tables.articles.find(a => a.siteId === dailySite.id && a.status === "published" && a._id !== first._id && a.publicUrlStatus === "verified");
    return !!second && f.tables.articles.some(a => a.siteId === dailySite.id && a.status === "ready" && a.createdAt > second.publishedAt) &&
      f.tables.articles.filter(a => a.siteId === dailySite.id && a.status === "ready").length === 4;
  }, 240, dueAt + 60 * 60_000);
  const second = f.tables.articles.find(a => a.siteId === dailySite.id && a.status === "published" && a._id !== first._id)!;
  const laterReplacement = f.tables.articles.find(a => a.siteId === dailySite.id && a.status === "ready" && a.createdAt > second.publishedAt)!;
  assert.ok(second.publishedAt >= dueAt); assert.notEqual(second.topicId, laterReplacement.topicId);
  assert.equal(f.repositories.get(dailySite.name.toLowerCase())!.writes, 2);
  t.diagnostic(JSON.stringify({ scenario: "second_configured_due_period", dueAt, publishedAt: second.publishedAt,
    verifiedAt: second.publicUrlVerifiedAt, replacementCreatedAt: laterReplacement.createdAt,
    replacementHash: laterReplacement.auditedContentHash, ready: 4, visibleCommits: 2 }));
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
  assert.equal(job.publicationAttempts, 1, "Pure lease contention must not consume a failed delivery attempt");
  const deliveries = f.trace.filter(t => t.name === "publisher:publishArticleInternal" && t.args.articleId === failed._id);
  assert.equal(deliveries.length, 3);
  // The five-minute wake returns structured contention and atomically arms
  // the exact expiry wake, retaining both the fence and remaining attempts.
  assert.equal(deliveries[1].result.outcome, "publication_lease_contention");
  assert.equal(deliveries[1].error, undefined);
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

async function failedPublication(options: { publisherFailures?: number; lostCommitResponses?: number } = { publisherFailures: 1 }) {
  const f = setup(options), site = f.sites[0];
  await f.invoke("articles:migrateLegacyArticles", {});
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic contention regression" });
  await pumpUntil(f, () => f.trace.some(t => t.name === "jobs:markPublishFailed" && t.result?.updated));
  const failure = f.trace.find(t => t.name === "jobs:markPublishFailed" && t.result?.updated)!;
  return { ...f, site, jobId: failure.args.jobId as string, articleId: failure.args.articleId as string };
}
async function deferFailedPublication(f: Awaited<ReturnType<typeof failedPublication>>) {
  f.setTime(f.get(f.jobId)!.nextAttemptAt);
  const result = await f.invoke("actions/pipeline:processNextJob", { siteId: f.site.id, jobId: f.jobId });
  assert.equal(result.failureKind, "publication_deferred", diagnostic(f));
  assert.equal(f.get(f.jobId)!.publicationAttempts, 1);
  return structuredClone(f.get(f.jobId)!.publicationDeferral);
}
const externalCalls = (f: ReturnType<typeof setup>) => f.trace.filter(t => t.name === "network").length;
const publicationFence = (f: ReturnType<typeof setup>, siteId: string, articleId: string) => ({
  siteOwner: f.get(siteId)!.publicationLeaseOwner, siteExpiry: f.get(siteId)!.publicationLeaseExpiresAt,
  articleOwner: f.get(articleId)!.publicationLeaseOwner, articleStart: f.get(articleId)!.publicationLeaseStartedAt,
  hash: f.get(articleId)!.publicationLeaseHash, envelope: f.get(articleId)!.publicationDeliveryHash,
});

async function terminalHeadBehindPristineOwner(attempted = false) {
  const f = setup(), site = f.sites[0];
  await f.invoke("articles:migrateLegacyArticles", {});
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic terminal-head preparation" });
  await pumpUntil(f, () => f.tables.articles.filter(a => a.siteId === site.id && a.status === "ready").length === 4);
  const [a, b, ...rest] = f.tables.articles.filter(a => a.siteId === site.id && a.status === "ready")
    .sort((x, y) => x.createdAt - y.createdAt);
  const first = f.tables.articles.find(a => a.siteId === site.id && a.status === "published")!;
  const dueAt = first.publishedAt + 86_400_000;
  f.setTime(dueAt);
  await f.invoke("articles:beginPublication", { articleId: b._id, expectedContentHash: b.auditedContentHash,
    expectedConfigHash: b.publicationConfigHash, expectedRolloutEpoch: 0, leaseOwner: "distinct-pristine-owner" });
  if (attempted) await f.invoke("articles:recordPublicationAttempted", { articleId: b._id,
    expectedContentHash: b.auditedContentHash, leaseOwner: "distinct-pristine-owner" });
  const queued = await f.invoke("jobs:queuePublicationIfAbsent", { siteId: site.id, articleId: a._id });
  assert.equal(queued.queued, true);
  assert.equal((await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: queued.jobId })).failureKind, "publication_deferred");
  const fence = publicationFence(f, site.id, b._id), models = f.modelCalls.length;
  for (let i = 0; i < 4; i++) {
    const record = f.get(queued.jobId)!.publicationDeferral;
    f.setTime(record.wakeAt);
    await f.invoke("jobs:resumePublicationAfterContention", { siteId: site.id, jobId: queued.jobId, generation: record.generation });
  }
  assert.equal(f.get(queued.jobId)!.publicationDeferral.state, "terminal");
  assert.equal(f.get(queued.jobId)!.publicationAttempts, 0);
  assert.deepEqual(publicationFence(f, site.id, b._id), fence);
  assert.equal(f.modelCalls.length, models);
  return { ...f, site, a, b, rest, jobId: queued.jobId, dueAt };
}

test("terminal oldest delivery cannot starve another genuinely sealed article after its real owner releases the destination", async t => {
  const f = await terminalHeadBehindPristineOwner();
  const closed = structuredClone(f.get(f.jobId)), hash = f.a.auditedContentHash;
  // Only the real pristine owner may release this lease. There was no external
  // attempt; no fixture mutation clears or invents a disposition for ambiguity.
  await f.invoke("articles:releasePublication", { articleId: f.b._id,
    expectedContentHash: f.b.auditedContentHash, leaseOwner: "distinct-pristine-owner" });
  assert.equal(f.get(f.site.id)!.publicationLeaseOwner, undefined);
  const scheduled = await f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id });
  assert.equal(scheduled.mode, "buffer_delivery");
  assert.equal(scheduled.bufferCount, 3, "Closed A must not inflate usable inventory");
  const delivery = f.tables.jobs.find(j => j.status === "pending" && j.payload?.publishOnly && j.articleId === f.b._id);
  assert.ok(delivery, "Oldest distinct eligible B owns the next delivery");
  assert.equal((await f.invoke("jobs:queuePublicationIfAbsent", { siteId: f.site.id, articleId: f.a._id })).queued, false);
  assert.deepEqual(f.get(f.jobId), closed); assert.equal(f.a.auditedContentHash, hash);
  assert.equal(f.a.status, "ready"); assert.equal(f.a.publicationGateStatus, "passed");
  assert.equal((await f.invoke("autopilot:reconcileSealedBufferCount", { siteId: f.site.id })).approvedBufferCount, 3);
  await pumpUntil(f, () => f.get(f.b._id)!.publicUrlStatus === "verified" &&
    f.tables.articles.some(a => a.siteId === f.site.id && a.status === "ready" && a.createdAt > f.get(f.b._id)!.publishedAt),
  240, f.now() + 60 * 60_000);
  const replacement = f.tables.articles.find(a => a.siteId === f.site.id && a.status === "ready" && a.createdAt > f.get(f.b._id)!.publishedAt)!;
  assert.equal(f.get(f.a._id)!.publishedAt, undefined);
  assert.deepEqual(f.get(f.jobId), closed);
  t.diagnostic(JSON.stringify({ scenario: "terminal_head_released", dueAt: f.dueAt, at: f.now(),
    closedArticle: f.a._id, selectedArticle: f.b._id, failedAttempts: 0, usableBuffer: scheduled.bufferCount,
    publishedAt: f.get(f.b._id)!.publishedAt, verifiedAt: f.get(f.b._id)!.publicUrlVerifiedAt,
    replacementCreatedAt: replacement.createdAt, replacementHash: replacement.auditedContentHash }));
  f.assertOffline();
});

test("three real writes without any contention record stay terminal across new queue attempts", async t => {
  const f = await failedPublication({ publisherFailures: 3 });
  for (let i = 0; i < 2; i++) {
    f.setTime(f.now() + 16 * 60_000);
    await f.invoke("actions/pipeline:processNextJob", { siteId: f.site.id, jobId: f.jobId });
  }
  assert.equal(f.get(f.jobId)!.publicationAttempts, 3); assert.equal(f.get(f.jobId)!.status, "failed");
  assert.equal(f.get(f.jobId)!.publicationDeferral, undefined);
  assert.equal(f.failedPublications.length, 3);
  const before = structuredClone(f.get(f.jobId)), calls = externalCalls(f);
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.invoke("jobs:queuePublicationIfAbsent", { siteId: f.site.id, articleId: f.articleId })).queued, false,
      "Terminal real-delivery failures cannot mint a replacement attempt-zero job");
    assert.equal((await f.invoke("actions/pipeline:processNextJob", { siteId: f.site.id, jobId: f.jobId })).processed, false);
    const schedule = await f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id });
    assert.equal(schedule.mode, "publication_destination_contended");
    assert.ok(schedule.blockers.includes(`publication_attempts_exhausted:${f.articleId}`));
  }
  assert.deepEqual(f.get(f.jobId), before); assert.equal(externalCalls(f), calls);
  t.diagnostic(JSON.stringify({ scenario: "three_failures_no_contention", failedAt: f.failedPublications,
    publicationAttempts: f.get(f.jobId)!.publicationAttempts, deferral: false, visibleCommits: 0 }));
  f.assertOffline();
});

test("a terminal head never grants authority to clear another workflow's attempted ambiguous destination", async () => {
  const f = await terminalHeadBehindPristineOwner(true);
  const calls = externalCalls(f), models = f.modelCalls.length, fence = publicationFence(f, f.site.id, f.b._id);
  const jobs = structuredClone(f.tables.jobs);
  await assert.rejects(f.invoke("articles:releasePublication", { articleId: f.b._id,
    expectedContentHash: f.b.auditedContentHash, leaseOwner: "distinct-pristine-owner" }), /unresolved external outcome/);
  for (let i = 0; i < 3; i++) {
    const result = await f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id });
    assert.equal(result.mode, "publication_destination_contended");
    assert.ok(result.blockers.includes("unresolved_publication_destination_lease"));
    assert.equal(result.bufferCount, 3);
  }
  assert.deepEqual(publicationFence(f, f.site.id, f.b._id), fence);
  assert.deepEqual(f.tables.jobs, jobs); assert.equal(externalCalls(f), calls); assert.equal(f.modelCalls.length, models);
  f.assertOffline();
});

test("all historical closed deliveries count as zero usable buffer and allow ordinary bounded fresh refill", async () => {
  const f = await terminalHeadBehindPristineOwner();
  await f.invoke("articles:releasePublication", { articleId: f.b._id,
    expectedContentHash: f.b.auditedContentHash, leaseOwner: "distinct-pristine-owner" });
  // Focused legacy receipt shapes, attached to genuinely generated/reviewed
  // articles. The separate transport tests prove the three actual failures.
  for (const article of [f.b, ...f.rest]) f.add("jobs", { siteId: f.site.id, type: "article",
    articleId: article._id, payload: { articleId: article._id, publishOnly: true },
    status: "failed", publicationAttempts: 3, createdAt: f.now(), updatedAt: f.now() });
  const closed = structuredClone(f.tables.jobs.filter(j => j.status === "failed"));
  const state = await f.invoke("articles:getAutopilotState", { siteId: f.site.id, since: START });
  assert.equal(state.ready.length, 4); assert.ok(state.ready.every((a: Fields) => a.publicationDeliveryBlocker));
  assert.equal((await f.invoke("autopilot:reconcileSealedBufferCount", { siteId: f.site.id })).approvedBufferCount, 0);
  const scheduled = await f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id });
  assert.equal(scheduled.bufferCount, 0); assert.equal(scheduled.mode, "buffer_fill");
  assert.equal(f.tables.jobs.filter(j => j.status === "pending" && j.payload?.publishOnly).length, 0);
  assert.deepEqual(f.tables.jobs.filter(j => j.status === "failed"), closed);
  const snapshot = await f.invoke("autopilot:getOperatorSnapshot", { siteId: f.site.id });
  assert.ok(snapshot.ready.every((a: Fields) => a.sealed === false && a.publicationDeliveryBlocker));
  f.assertOffline();
});

test("generation-origin deliveries also close after three real writes without contention or a deferral record", async t => {
  const f = setup({ publisherFailures: 3 }), site = f.sites[0];
  await f.invoke("articles:migrateLegacyArticles", {});
  const plan = await f.invoke("jobs:queuePlanIfAbsent", { siteId: site.id, reason: "topic_replenishment" });
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: plan.jobId });
  const topic = f.tables.topic_clusters.find(a => a.siteId === site.id && a.status === "planned")!;
  assert.ok(topic);
  const queue = await f.invoke("jobs:queueTopicArticleIfAbsent", { siteId: site.id, topicId: topic._id, bufferFill: false });
  assert.equal(queue.queued, true);
  assert.equal(f.get(queue.jobId)!.payload.publishOnly, undefined);
  await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: queue.jobId });
  await pumpUntil(f, () => f.get(queue.jobId)!.publicationAttempts === 1);
  assert.equal(f.failedPublications.length, 1);
  for (let i = 1; i < 3; i++) {
    f.setTime(f.now() + 16 * 60_000);
    const result = await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: queue.jobId });
    assert.equal(f.failedPublications.length, i + 1, JSON.stringify({ result, job: f.get(queue.jobId), logs: f.logs.slice(-2) }));
  }
  const job = f.get(queue.jobId)!;
  assert.equal(job.publicationAttempts, 3); assert.equal(job.status, "failed");
  assert.equal(job.publicationDeferral, undefined); assert.equal(f.failedPublications.length, 3);
  // This genuine generation-origin shape retains its pre-delivery workflow
  // status under an unresolved external fence. No status-reset authority is
  // invented just to force it into the buffer-only admission shape.
  const article = f.get(job.articleId)!;
  assert.notEqual(article.status, "ready"); assert.equal(article.publicationGateStatus, "passed");
  const before = structuredClone(job), calls = externalCalls(f);
  for (let i = 0; i < 3; i++) {
    await assert.rejects(f.invoke("jobs:queuePublicationIfAbsent", { siteId: site.id, articleId: job.articleId }), /strict-quality sealed ready/);
    assert.equal((await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: queue.jobId })).processed, false);
  }
  assert.deepEqual(f.get(queue.jobId), before); assert.equal(externalCalls(f), calls);
  await assert.rejects(f.invoke("jobs:queuePublicationIfAbsent", { siteId: f.sites[1].id, articleId: job.articleId }), /strict-quality sealed ready/);
  t.diagnostic(JSON.stringify({ scenario: "generation_origin_three_failures", failedAt: f.failedPublications,
    articleId: job.articleId, workflowStatus: article.status, failedAttempts: job.publicationAttempts, deferral: false, visibleCommits: 0 }));
  f.assertOffline();
});

test("history overflow closes only its article and exact-site receipts preserve oldest eligible ordering under concurrent wakes", async () => {
  const f = await terminalHeadBehindPristineOwner();
  await f.invoke("articles:releasePublication", { articleId: f.b._id,
    expectedContentHash: f.b.auditedContentHash, leaseOwner: "distinct-pristine-owner" });
  for (let i = 0; i < 101; i++) f.add("jobs", { siteId: f.site.id, articleId: f.a._id,
    type: "article", status: "failed", createdAt: f.now(), updatedAt: f.now() });
  // Deliberately malformed cross-site historical association is not an excuse
  // to query the other tenant or make that tenant's receipt control this site.
  f.add("jobs", { siteId: f.sites[1].id, articleId: f.b._id, type: "article", status: "failed",
    publicationAttempts: 3, createdAt: f.now(), updatedAt: f.now() });
  const state = await f.invoke("articles:getAutopilotState", { siteId: f.site.id, since: START });
  assert.equal(state.ready.find((a: Fields) => a._id === f.a._id).publicationDeliveryBlocker.reason, "publication_history_incomplete");
  assert.equal(state.ready.find((a: Fields) => a._id === f.b._id).publicationDeliveryBlocker, undefined);
  const history = structuredClone(f.tables.jobs.filter(j => j.status === "failed"));
  const scheduled = await Promise.all(Array.from({ length: 3 }, () => f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id })));
  assert.equal(scheduled.filter(r => r.scheduled === 1).length, 1);
  const pending = f.tables.jobs.filter(j => j.status === "pending" && j.payload?.publishOnly);
  assert.equal(pending.length, 1); assert.equal(pending[0].articleId, f.b._id);
  assert.equal((await f.invoke("jobs:queuePublicationIfAbsent", { siteId: f.site.id, articleId: f.a._id })).reason, "publication_history_incomplete");
  assert.deepEqual(f.tables.jobs.filter(j => j.status === "failed"), history);
  f.assertOffline();
});

test("publication eligibility read budgets skip done jobs and bound pathological histories across repeated exact-site views", async t => {
  const f = await terminalHeadBehindPristineOwner();
  const summarize = (reads: typeof f.queryReads) => ({ calls: reads.length,
    rows: reads.reduce((n, r) => n + r.rows, 0), bytes: reads.reduce((n, r) => n + r.bytes, 0) });
  const eligibilityReads = (start: number) => f.queryReads.slice(start).filter(r => r.table === "jobs" && r.index === "by_site_article");
  const readyReads = (start: number) => f.queryReads.slice(start).filter(r => r.table === "article_summaries" &&
    r.range.some(x => x.key === "status" && x.value === "ready"));
  let start = f.queryReads.length;
  await f.invoke("articles:getAutopilotState", { siteId: f.site.id, since: START });
  const typical = eligibilityReads(start);
  assert.equal(typical.length, 4); assert.equal(typical.reduce((n, r) => n + r.rows, 0), 1);
  assert.ok(typical.every(r => r.range.some(x => x.key === "status" && x.value === "failed")));
  start = f.queryReads.length;
  await f.invoke("autopilot:getOperatorSnapshot", { siteId: f.site.id });
  assert.equal(eligibilityReads(start).length, 4, "One operator query must not repeat eligibility for each projection");
  const template = f.tables.article_summaries.find(a => a.articleId === f.b._id)!;
  const other = f.sites[1], otherDomain = f.get(other.id)!.canonicalDomain ?? other.domain;
  let cleanFour: ReturnType<typeof summarize> | undefined;
  let cleanTwelve: ReturnType<typeof summarize> | undefined;
  for (let i = 0; i < 12; i++) {
    f.add("article_summaries", { ...template, siteId: other.id, canonicalDomain: otherDomain,
      articleId: `articles:clean-read-${i}` });
    if (i === 3 || i === 11) {
      start = f.queryReads.length;
      await f.invoke("articles:getAutopilotState", { siteId: other.id, since: START });
      const totals = summarize(eligibilityReads(start));
      assert.equal(totals.calls, i + 1); assert.equal(totals.rows, 0); assert.equal(totals.bytes, 0);
      if (i === 3) cleanFour = totals; else cleanTwelve = totals;
    }
  }
  // Metadata-only load fixture: these rows are never published or treated as
  // evidence of generated quality. B above is genuinely reviewed by handlers.
  const candidates = f.tables.article_summaries.filter(a => a.siteId === f.site.id && a.status === "ready");
  for (let i = candidates.length; i < 25; i++) {
    const id = f.add("article_summaries", { ...template, articleId: `articles:read-budget-${i}` });
    candidates.push(f.get(id)!);
  }
  const jobTemplate = structuredClone(f.get(f.jobId)!);
  for (const candidate of candidates) for (let i = 0; i < 101; i++) f.add("jobs", {
    ...jobTemplate, articleId: candidate.articleId,
    payload: { ...jobTemplate.payload, articleId: candidate.articleId },
    publicationDeferral: undefined, publicationAttempts: 0,
  });
  const storedHistories = f.tables.jobs.filter(j => j.siteId === f.site.id && j.status === "failed");
  const naiveBytes = storedHistories.reduce((n, row) => n + Buffer.byteLength(JSON.stringify(row)), 0);
  start = f.queryReads.length;
  const state = await f.invoke("articles:getAutopilotState", { siteId: f.site.id, since: START });
  const worst = eligibilityReads(start), totals = summarize(worst);
  const readyTwentyFive = summarize(readyReads(start));
  assert.equal(totals.calls, 25); assert.ok(totals.rows <= 128 + 25);
  assert.ok(totals.bytes < naiveBytes / 10);
  assert.ok(state.ready.every((a: Fields) => a.publicationDeliveryBlocker));
  assert.ok(worst.every(r => r.range.some(x => x.key === "siteId" && x.value === f.site.id) &&
    r.range.some(x => x.key === "status" && x.value === "failed")));
  start = f.queryReads.length;
  await f.invoke("autopilot:getOperatorSnapshot", { siteId: f.site.id });
  assert.deepEqual(summarize(eligibilityReads(start)), totals);
  const repeated = summarize(eligibilityReads(start));
  for (let i = 25; i < 50; i++) {
    const articleId = `articles:read-budget-${i}`;
    f.add("article_summaries", { ...template, articleId });
    for (let j = 0; j < 101; j++) f.add("jobs", { ...jobTemplate, articleId,
      payload: { ...jobTemplate.payload, articleId }, publicationDeferral: undefined, publicationAttempts: 0 });
  }
  start = f.queryReads.length;
  await f.invoke("articles:getAutopilotState", { siteId: f.site.id, since: START });
  const fifty = summarize(eligibilityReads(start));
  assert.equal(fifty.calls, 50); assert.ok(fifty.rows <= 128 + 50);
  t.diagnostic(JSON.stringify({ scenario: "publication_receipt_read_budget", typicalFourIncludingOneTerminal: summarize(typical),
    cleanFour, cleanTwelve, twentyFiveBy101RepresentativeStoredBytes: naiveBytes,
    boundedTwentyFive: totals, readyTwentyFive, repeatedOperatorView: repeated, boundedFifty: fifty,
    readyFifty: summarize(readyReads(start)) }));
  f.assertOffline();
});

test("more than 25 closed metadata receipts do not hide a later real sealed article; candidate saturation is explicit", async () => {
  for (const closedCount of [25, 51]) {
    const f = await terminalHeadBehindPristineOwner();
    await f.invoke("articles:releasePublication", { articleId: f.b._id,
      expectedContentHash: f.b.auditedContentHash, leaseOwner: "distinct-pristine-owner" });
    const template = f.tables.article_summaries.find(a => a.articleId === f.a._id)!;
    for (let i = 0; i < closedCount; i++) {
      const articleId = `articles:closed-window-${i}`;
      // Summary creation order is intentionally newer than real B. Selection
      // must use original articleCreatedAt, not migration/summary insertion.
      f.add("article_summaries", { ...template, articleId, articleCreatedAt: START - 2000 + i });
      f.add("jobs", { siteId: f.site.id, articleId, type: "article", status: "failed",
        publicationAttempts: 3, createdAt: START - 1500 + i, updatedAt: START - 1500 + i });
    }
    const start = f.queryReads.length, calls = externalCalls(f);
    const scheduled = await f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id });
    const reads = f.queryReads.slice(start).filter(r => r.index === "by_site_article");
    assert.ok(reads.length <= 51, "At most 50 candidate checks plus one atomic selected-article queue recheck");
    if (closedCount === 25) {
      assert.equal(scheduled.mode, "buffer_delivery"); assert.equal(scheduled.bufferCount, 3);
      const queued = f.tables.jobs.find(j => j.status === "pending" && j.payload?.publishOnly);
      assert.equal(queued?.articleId, f.b._id, "Real B is eligible after the 25 closed metadata rows and closed real A");
    } else {
      assert.equal(scheduled.mode, "publication_inventory_incomplete");
      assert.equal(scheduled.bufferInventory.status, "unknown");
      assert.equal(scheduled.bufferCount, undefined);
      assert.deepEqual(scheduled.blockers, ["publication_buffer_scan_incomplete"]);
      assert.equal(f.tables.jobs.filter(j => j.status === "pending" && j.payload?.publishOnly).length, 0);
      assert.equal(externalCalls(f), calls);
      assert.equal(f.get(f.site.id)!.canonicalDomainRevision ?? 0, 0);
      for (const summary of f.tables.article_summaries.filter(a => String(a.articleId).startsWith("articles:closed-window-"))) {
        summary.canonicalDomain = "earlier.example"; summary.domainRevision = 1;
      }
      const legacy = await f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id });
      assert.equal(legacy.mode, "publication_inventory_incomplete");
      assert.equal(legacy.bufferInventory.status, "unknown");
      assert.deepEqual(legacy.blockers, ["article_summary_domain_window_incomplete"]);
      assert.equal(externalCalls(f), calls);
    }
    f.assertOffline();
  }
});

test("scan-capped mixed prefix delivers its real sealed B despite unknown later rows without regenerating B", async t => {
  const f = await terminalHeadBehindPristineOwner();
  await f.invoke("articles:releasePublication", { articleId: f.b._id,
    expectedContentHash: f.b.auditedContentHash, leaseOwner: "distinct-pristine-owner" });
  const template = f.tables.article_summaries.find(row => row.articleId === f.a._id)!;
  for (let i = 0; i < 60; i++) {
    const articleId = `articles:scan-load-${i}`;
    // Load-only metadata surrounds real pipeline-produced/reviewed B.
    f.add("article_summaries", { ...template, articleId,
      articleCreatedAt: i < 20 ? START - 1000 + i : f.b.createdAt + 1000 + i });
    for (let j = 0; j < (i === 25 ? 101 : 1); j++) f.add("jobs", { siteId: f.site.id, articleId,
      type: "article", status: "failed", publicationAttempts: i === 25 ? 0 : 3, createdAt: START, updatedAt: START });
  }
  const history = structuredClone(f.tables.jobs.filter(row => row.status === "failed"));
  const models = f.modelCalls.length, before = structuredClone(f.get(f.b._id));
  const queued = await Promise.all(Array.from({ length: 3 }, () => f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id })));
  assert.equal(queued.filter(result => result.scheduled === 1).length, 1);
  assert.ok(queued.every(result => result.bufferInventory.status === "partial" && result.bufferCount === undefined));
  const job = f.tables.jobs.filter(row => row.status === "pending" && row.payload?.publishOnly);
  assert.equal(job.length, 1); assert.equal(job[0].articleId, f.b._id);
  const runId = f.add("autopilot_runs", { siteId: f.site.id, trigger: "natural", status: "scheduled",
    scheduledAt: f.now(), heartbeatAt: f.now(), rolloutEpoch: 0 });
  await f.invoke("actions/pipeline:autopilotTick", { siteId: f.site.id, runId, trigger: "natural" });
  await pumpUntil(f, () => f.get(f.b._id)!.publicUrlStatus === "verified" && f.get(runId)!.status === "completed", 100, f.now() + 60_000);
  assert.equal(f.get(runId)!.outcome, "publication_inventory_incomplete");
  const published = f.get(f.b._id)!;
  assert.equal(published.auditedContentHash, before!.auditedContentHash);
  assert.equal(published.markdown, before!.markdown); assert.equal(f.modelCalls.length, models);
  assert.deepEqual(f.tables.jobs.filter(row => row.status === "failed"), history);
  assert.equal(f.tables.articles.filter(row => row.siteId === f.site.id).length, 5);
  t.diagnostic(JSON.stringify({ scenario: "scan_capped_proven_B", dueAt: f.dueAt,
    selectedArticle: f.b._id, inventory: queued[0].bufferInventory,
    runStatus: f.get(runId)!.status, runOutcome: f.get(runId)!.outcome,
    publishedAt: published.publishedAt, verifiedAt: published.publicUrlVerifiedAt,
    hash: published.auditedContentHash, modelCallsAdded: f.modelCalls.length - models }));
  f.assertOffline();
});

test("a scan-capped prefix with proven B cannot steal an attempted shared destination or consume a new attempt", async () => {
  const f = await terminalHeadBehindPristineOwner(true);
  const template = f.tables.article_summaries.find(row => row.articleId === f.a._id)!;
  for (let i = 0; i < 51; i++) {
    const articleId = `articles:ambiguity-scan-load-${i}`;
    f.add("article_summaries", { ...template, articleId, articleCreatedAt: f.b.createdAt + 1000 + i });
    f.add("jobs", { siteId: f.site.id, articleId, type: "article", status: "failed", publicationAttempts: 3, createdAt: START, updatedAt: START });
  }
  const before = structuredClone(f.tables.jobs), fence = publicationFence(f, f.site.id, f.b._id);
  const calls = externalCalls(f), models = f.modelCalls.length;
  for (const result of await Promise.all(Array.from({ length: 3 }, () => f.invoke("actions/scheduler:scheduleCadence", { siteId: f.site.id })))) {
    assert.equal(result.mode, "publication_destination_contended"); assert.equal(result.scheduled, 0);
    assert.equal(result.bufferInventory.status, "partial"); assert.equal(result.bufferInventory.usableCountLowerBound, 3);
  }
  assert.deepEqual(f.tables.jobs, before); assert.deepEqual(publicationFence(f, f.site.id, f.b._id), fence);
  assert.equal(externalCalls(f), calls); assert.equal(f.modelCalls.length, models); f.assertOffline();
});

test("registered contention deferral coalesces repeated wakes without I/O, failures, fence changes or regeneration", async () => {
  const f = await failedPublication(), record = await deferFailedPublication(f);
  const job = structuredClone(f.get(f.jobId)), fence = publicationFence(f, f.site.id, f.articleId);
  const calls = externalCalls(f), models = f.modelCalls.length;
  const deferredArgs = f.trace.find(t => t.name === "jobs:markPublicationDeferred")!.args;
  for (let i = 0; i < 5; i++) {
    assert.equal((await f.invoke("actions/pipeline:processNextJob", { siteId: f.site.id, jobId: f.jobId })).processed, false);
    assert.equal((await f.invoke("jobs:resumePublicationAfterContention", { siteId: f.site.id, jobId: f.jobId, generation: record.generation })).status, "stale");
    assert.equal((await f.invoke("jobs:markPublicationDeferred", deferredArgs)).updated, false);
  }
  assert.deepEqual(f.get(f.jobId), job); assert.deepEqual(publicationFence(f, f.site.id, f.articleId), fence);
  assert.equal(externalCalls(f), calls); assert.equal(f.modelCalls.length, models);
  assert.equal(f.tables._scheduled_functions.filter(s => s.name === "jobs:resumePublicationAfterContention" && s.state.kind === "pending").length, 1);
  assert.equal(record.wakeAt, fence.siteExpiry);
  f.setTime(record.wakeAt);
  const resumes = await Promise.all(Array.from({ length: 3 }, () => f.invoke("jobs:resumePublicationAfterContention", {
    siteId: f.site.id, jobId: f.jobId, generation: record.generation,
  })));
  assert.equal(resumes.filter(r => r.status === "resumed").length, 1);
  const workers = await Promise.all(Array.from({ length: 2 }, () => f.invoke("actions/pipeline:processNextJob", { siteId: f.site.id, jobId: f.jobId })));
  assert.equal(workers.filter(r => r.publicationSucceeded).length, 1);
  await pumpUntil(f, () => f.get(f.articleId)!.publicUrlStatus === "verified");
  assert.equal(f.get(f.jobId)!.publicationAttempts, 1);
  assert.equal(f.get(f.articleId)!.publishedContentHash, record.boundary.contentHash);
  assert.equal(f.modelCalls.length, models); assert.equal(f.repositories.get(f.site.name.toLowerCase())!.writes, 1);
  f.assertOffline();
  const raced = await failedPublication(), racedRecord = await deferFailedPublication(raced);
  raced.setTime(racedRecord.wakeAt);
  // An ordinary due worker may win before the already scheduled callback.
  assert.equal((await raced.invoke("actions/pipeline:processNextJob", { siteId: raced.site.id, jobId: raced.jobId })).publicationSucceeded, true);
  assert.equal(raced.get(raced.jobId)!.publicationDeferral.state, "resumed");
  assert.equal(raced.get(racedRecord.wakeId)!.state.kind, "canceled");
  const racedCalls = externalCalls(raced);
  assert.equal((await raced.invoke("jobs:resumePublicationAfterContention", { siteId: raced.site.id, jobId: raced.jobId, generation: racedRecord.generation })).status, "stale");
  assert.equal(externalCalls(raced), racedCalls); assert.equal(raced.get(raced.jobId)!.publicationAttempts, 1);
  raced.assertOffline();
});

test("a committed Git artifact with a lost response is reconciled after contention without a duplicate write", async t => {
  const f = await failedPublication({ lostCommitResponses: 1 });
  const repo = f.repositories.get(f.site.name.toLowerCase())!, head = repo.head;
  assert.equal(repo.writes, 1); assert.notEqual(f.get(f.articleId)!.status, "published");
  const models = f.modelCalls.length;
  await deferFailedPublication(f);
  await pumpUntil(f, () => f.get(f.articleId)!.publicUrlStatus === "verified");
  assert.equal(repo.head, head); assert.equal(repo.writes, 1);
  assert.equal(f.trace.filter(x => x.name === "network" && x.args.method === "PATCH").length, 1);
  assert.equal(f.get(f.jobId)!.publicationAttempts, 1); assert.equal(f.modelCalls.length, models);
  assert.ok(f.trace.some(x => x.name === "network" && x.args.method === "GET" && x.args.url.includes("/contents/")));
  t.diagnostic(JSON.stringify({ scenario: "commit_response_lost", visibleCommits: repo.writes, patchAttempts: 1,
    failedAt: f.failedPublications[0], publishedAt: f.get(f.articleId)!.publishedAt,
    verifiedAt: f.get(f.articleId)!.publicUrlVerifiedAt, failureCount: f.get(f.jobId)!.publicationAttempts }));
  f.assertOffline();
});

test("another real upstream failure after contention consumes only its own attempt and leaves the final retry", async t => {
  const f = await failedPublication({ publisherFailures: 2 });
  await deferFailedPublication(f);
  await pumpUntil(f, () => f.failedPublications.length === 2 && f.get(f.jobId)!.status === "pending");
  assert.equal(f.get(f.jobId)!.publicationAttempts, 2); assert.equal(f.repositories.get(f.site.name.toLowerCase())!.writes, 0);
  assert.equal(f.get(f.jobId)!.publicationDeferral.state, "resumed");
  assert.equal(f.get(f.jobId)!.publicationDeferral.wakeId, undefined);
  await pumpUntil(f, () => f.get(f.articleId)!.publicUrlStatus === "verified");
  assert.equal(f.get(f.jobId)!.publicationAttempts, 2);
  assert.equal(f.trace.filter(x => x.name === "network" && x.args.method === "PATCH").length, 3);
  assert.equal(f.repositories.get(f.site.name.toLowerCase())!.writes, 1);
  t.diagnostic(JSON.stringify({ scenario: "two_real_failures", failedAt: f.failedPublications,
    publishedAt: f.get(f.articleId)!.publishedAt, verifiedAt: f.get(f.articleId)!.publicUrlVerifiedAt,
    failedAttempts: 2, patchAttempts: 3, visibleCommits: 1 }));
  f.assertOffline();
});

test("three real failed writes still exhaust delivery and cannot escape through the contention path", async () => {
  const f = await failedPublication({ publisherFailures: 3 });
  await deferFailedPublication(f);
  await pumpUntil(f, () => f.get(f.jobId)!.status === "failed");
  assert.equal(f.get(f.jobId)!.publicationAttempts, 3); assert.equal(f.failedPublications.length, 3);
  assert.equal(f.repositories.get(f.site.name.toLowerCase())!.writes, 0);
  assert.equal((await f.invoke("jobs:queuePublicationIfAbsent", { siteId: f.site.id, articleId: f.articleId })).queued, false);
  const calls = externalCalls(f);
  assert.equal((await f.invoke("actions/pipeline:processNextJob", { siteId: f.site.id, jobId: f.jobId })).processed, false);
  assert.equal(externalCalls(f), calls);
  f.assertOffline();
});

test("publish-only retries with retained quality-retry provenance never re-enter paid review or regenerate the sealed artifact", async () => {
  const f = await failedPublication(), job = f.get(f.jobId)!;
  // Historical quality-recovery deliveries retain this provenance when the
  // publisher stores its publishOnly checkpoint. No article/seal is fabricated.
  job.payload.qualityRetry = true;
  const models = f.modelCalls.length, hash = f.get(f.articleId)!.auditedContentHash;
  await deferFailedPublication(f);
  await pumpUntil(f, () => f.get(f.articleId)!.publicUrlStatus === "verified");
  assert.equal(f.modelCalls.length, models); assert.equal(f.get(f.articleId)!.publishedContentHash, hash);
  assert.equal(f.get(f.jobId)!.publicationAttempts, 1);
  f.assertOffline();
});

test("stale scheduled worker claims cannot acquire publication, mark an external attempt, defer, or charge a failure", async () => {
  const f = await failedPublication(), article = f.get(f.articleId)!;
  f.setTime(f.get(f.jobId)!.nextAttemptAt);
  const claimed = await f.invoke("jobs:claimPending", { siteId: f.site.id, jobId: f.jobId, workerToken: "owned-job" });
  assert.ok(claimed);
  const calls = externalCalls(f), fence = publicationFence(f, f.site.id, f.articleId);
  await assert.rejects(f.invoke("articles:beginPublication", {
    articleId: f.articleId, expectedContentHash: article.auditedContentHash,
    expectedConfigHash: article.publicationConfigHash, expectedRolloutEpoch: 0, leaseOwner: "cannot-acquire",
    jobClaim: { jobId: f.jobId, workerToken: "stale-job" },
  }), /exact job\/artifact claim/);
  const contention = await f.invoke("publisher:publishArticleInternal", { siteId: f.site.id, articleId: f.articleId });
  assert.equal(contention.outcome, "publication_lease_contention");
  f.get(f.jobId)!.leaseExpiresAt = f.now() - 1;
  const before = structuredClone(f.get(f.jobId));
  await assert.rejects(f.invoke("articles:recordPublicationAttempted", {
    articleId: f.articleId, expectedContentHash: article.auditedContentHash, leaseOwner: article.publicationLeaseOwner,
    jobClaim: { jobId: f.jobId, workerToken: "owned-job" },
  }), /exact job\/artifact claim/);
  assert.equal((await f.invoke("jobs:markPublicationDeferred", { siteId: f.site.id, jobId: f.jobId,
    workerToken: "owned-job", boundary: contention.boundary })).updated, false);
  assert.equal((await f.invoke("jobs:markPublishFailed", { jobId: f.jobId, articleId: f.articleId,
    workerToken: "owned-job", error: "A stale worker must not settle failure" })).updated, false);
  assert.deepEqual(f.get(f.jobId), before); assert.deepEqual(publicationFence(f, f.site.id, f.articleId), fence);
  assert.equal(externalCalls(f), calls);
  f.assertOffline();
});

test("renewed ambiguity leases have a finite separate wait budget and cannot be requeued as fresh delivery work", async () => {
  const f = await failedPublication(); await deferFailedPublication(f);
  const calls = externalCalls(f), article = f.get(f.articleId)!;
  for (let i = 0; i < 4; i++) {
    const record = structuredClone(f.get(f.jobId)!.publicationDeferral);
    f.setTime(record.wakeAt);
    // Simulated concurrent owner renewal. The handler must preserve exactly
    // this new fence; fixture serializability is not a distributed OCC test.
    f.get(f.site.id)!.publicationLeaseExpiresAt = f.now() + 15 * 60_000;
    article.publicationLeaseStartedAt = f.now();
    const fence = publicationFence(f, f.site.id, f.articleId);
    const result = await f.invoke("jobs:resumePublicationAfterContention", { siteId: f.site.id, jobId: f.jobId, generation: record.generation });
    assert.deepEqual(publicationFence(f, f.site.id, f.articleId), fence);
    assert.equal(f.get(f.jobId)!.publicationAttempts, 1);
    if (i === 3) assert.equal(result.status, "terminal"); else assert.equal(result.status, "deferred");
  }
  assert.equal(f.get(f.jobId)!.status, "failed");
  assert.equal(f.get(f.jobId)!.publicationDeferral.state, "terminal");
  assert.equal(externalCalls(f), calls);
  for (let i = 0; i < 3; i++) {
    const queued = await f.invoke("jobs:queuePublicationIfAbsent", { siteId: f.site.id, articleId: f.articleId });
    assert.equal(queued.queued, false); assert.equal(queued.reason, "publication_deferral_terminal");
    assert.equal((await f.invoke("actions/pipeline:processNextJob", { siteId: f.site.id, jobId: f.jobId })).processed, false);
  }
  assert.equal(f.tables.jobs.filter(j => j.articleId === f.articleId && j.payload?.publishOnly).length, 1);
  f.assertOffline();
});

test("deferral callbacks fence stale generations, wrong sites, changed owners, seals, destinations and rollout epochs", async () => {
  for (const change of ["owner", "content", "destination", "epoch"] as const) {
    const f = await failedPublication(), record = await deferFailedPublication(f);
    const before = structuredClone(f.get(f.jobId)), calls = externalCalls(f);
    assert.equal((await f.invoke("jobs:resumePublicationAfterContention", { siteId: f.sites[1].id, jobId: f.jobId, generation: record.generation })).status, "stale");
    assert.equal((await f.invoke("jobs:resumePublicationAfterContention", { siteId: f.site.id, jobId: f.jobId, generation: record.generation + 1 })).status, "stale");
    assert.deepEqual(f.get(f.jobId), before);
    if (change === "owner") f.get(f.site.id)!.userId = "synthetic-transferred-owner";
    if (change === "content") f.get(f.articleId)!.markdown += "\nA changed unsealed sentence.";
    if (change === "destination") f.get(f.site.id)!.repoName = "changed-destination";
    if (change === "epoch") f.get(f.site.id)!.autopilotRolloutEpoch++;
    f.setTime(record.wakeAt);
    const fence = publicationFence(f, f.site.id, f.articleId);
    if (change === "content") {
      assert.equal(await f.invoke("jobs:claimPending", { siteId: f.site.id, jobId: f.jobId, workerToken: "unrelated-natural-wake" }), null);
      assert.equal(f.get(f.jobId)!.publicationDeferral.state, "terminal");
    } else {
      assert.equal((await f.invoke("jobs:resumePublicationAfterContention", { siteId: f.site.id, jobId: f.jobId, generation: record.generation })).status, "terminal");
    }
    assert.deepEqual(publicationFence(f, f.site.id, f.articleId), fence);
    assert.equal(f.get(f.jobId)!.publicationAttempts, 1); assert.equal(externalCalls(f), calls);
    f.assertOffline();
  }
});

test("a long or malformed destination lease never grants admission and the wait expires within one hour", async () => {
  const f = await failedPublication();
  f.get(f.site.id)!.publicationLeaseExpiresAt = f.now() + 4 * 60 * 60_000;
  const record = await deferFailedPublication(f), calls = externalCalls(f);
  assert.equal(record.wakeAt, record.startedAt + 60 * 60_000);
  assert.equal(record.deadlineAt, record.wakeAt);
  const fence = publicationFence(f, f.site.id, f.articleId);
  f.setTime(record.wakeAt);
  assert.equal((await f.invoke("jobs:resumePublicationAfterContention", { siteId: f.site.id, jobId: f.jobId, generation: record.generation })).status, "terminal");
  assert.equal(f.get(f.jobId)!.publicationAttempts, 1); assert.equal(externalCalls(f), calls);
  assert.deepEqual(publicationFence(f, f.site.id, f.articleId), fence);
  // Malformed historical expiry is fail-closed, never interpreted as free.
  delete f.get(f.site.id)!.publicationLeaseExpiresAt;
  const article = f.get(f.articleId)!;
  const lease = await f.invoke("articles:beginPublication", { articleId: article._id,
    expectedContentHash: article.auditedContentHash, expectedConfigHash: article.publicationConfigHash,
    expectedRolloutEpoch: 0, leaseOwner: "cannot-take-unknown-fence" });
  assert.equal(lease.outcome, "publication_lease_contention");
  assert.equal(f.get(f.site.id)!.publicationLeaseOwner, fence.siteOwner);
  f.assertOffline();
});

test("actual lease mutations serialize same and different sealed articles while another site still publishes", async () => {
  const f = setup(), site = f.sites[0];
  await f.invoke("articles:migrateLegacyArticles", {});
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic preparation" });
  await pumpUntil(f, () => f.tables.articles.filter(a => a.siteId === site.id && a.status === "ready").length === 4);
  const [a, b] = f.tables.articles.filter(a => a.siteId === site.id && a.status === "ready");
  const args = (article: Fields, leaseOwner: string) => ({ articleId: article._id,
    expectedContentHash: article.auditedContentHash, expectedConfigHash: article.publicationConfigHash,
    expectedRolloutEpoch: 0, leaseOwner });
  const calls = externalCalls(f);
  const leases = await Promise.all([f.invoke("articles:beginPublication", args(a, "first")),
    f.invoke("articles:beginPublication", args(a, "duplicate")), f.invoke("articles:beginPublication", args(b, "different"))]);
  assert.equal(leases.filter(r => r.alreadyPublished === false).length, 1);
  assert.equal(leases.filter(r => r.outcome === "publication_lease_contention").length, 2);
  assert.equal(f.get(site.id)!.publicationLeaseOwner, "first"); assert.equal(b.publicationLeaseOwner, undefined);
  assert.equal(externalCalls(f), calls);
  await assert.rejects(f.invoke("publisher:publishArticleInternal", { siteId: f.sites[1].id, articleId: a._id }), /does not belong/);
  await assert.rejects(f.invoke("articles:recordPublicationAttempted", { articleId: a._id,
    expectedContentHash: a.auditedContentHash, leaseOwner: "stale" }), /immutable article lease/);
  const other = f.sites[1];
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: other.id, trigger: "scheduled", reason: "Independent synthetic tenant" });
  await pumpUntil(f, () => f.tables.articles.some(x => x.siteId === other.id && x.publicUrlStatus === "verified"));
  assert.equal(f.get(site.id)!.publicationLeaseOwner, "first");
  assert.equal(f.repositories.get(other.name.toLowerCase())!.writes, 1);
  f.assertOffline();
});

test("a queued publication behind a pristine crashed lease rechecks the seal at expiry without charging a failure", async () => {
  const f = setup(), site = f.sites[0];
  await f.invoke("articles:migrateLegacyArticles", {});
  await f.invoke("autopilot:dispatchSiteFollowup", { siteId: site.id, trigger: "scheduled", reason: "Synthetic pristine recovery preparation" });
  await pumpUntil(f, () => f.tables.articles.filter(a => a.siteId === site.id && a.status === "ready").length === 4);
  const article = f.tables.articles.find(a => a.siteId === site.id && a.status === "ready")!;
  const originalHash = article.auditedContentHash;
  const published = f.tables.articles.find(a => a.siteId === site.id && a.status === "published")!;
  f.setTime(published.publishedAt + 86_400_000);
  await f.invoke("articles:beginPublication", { articleId: article._id, expectedContentHash: originalHash,
    expectedConfigHash: article.publicationConfigHash, expectedRolloutEpoch: 0, leaseOwner: "crashed-before-provider" });
  const queue = await f.invoke("jobs:queuePublicationIfAbsent", { siteId: site.id, articleId: article._id });
  assert.equal(queue.queued, true);
  const result = await f.invoke("actions/pipeline:processNextJob", { siteId: site.id, jobId: queue.jobId });
  assert.equal(result.failureKind, "publication_deferred"); assert.equal(f.get(queue.jobId)!.publicationAttempts, 0);
  assert.equal(article.publicationAttemptedAt, undefined);
  const record = f.get(queue.jobId)!.publicationDeferral;
  await pumpUntil(f, () => f.get(article._id)!.publicUrlStatus === "verified", 240, record.wakeAt + 60 * 60_000);
  assert.equal(f.get(queue.jobId)!.publicationAttempts, 0);
  assert.equal(f.get(article._id)!.publishedContentHash, originalHash);
  assert.equal(f.trace.filter(t => t.name === "jobs:markPublishFailed" && t.args.jobId === queue.jobId).length, 0);
  assert.ok(f.trace.some(t => t.name === "articles:releaseExpiredPristinePublication" && t.args.articleId === article._id && t.result?.released));
  f.assertOffline();
});
