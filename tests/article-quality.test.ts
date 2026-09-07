import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  articleWordCeiling,
  articleReviewImprovesWithoutRegression,
  clampMetaDescription,
  clampMetaTitle,
  containsExecutableMdx,
  evidenceRequiredParagraphs,
  evidenceSafeLengthRecoveryTarget,
  evaluatePublicationQuality,
  insertReviewedProductImage,
  initialArticleDepthTarget,
  inlineCitationNumbers,
  issuesBlockingPreLinkReview,
  PENDING_INTERNAL_LINK_ISSUE,
  preservedResearchEvidenceSnapshot,
  publicationMediaQualityStatus,
  normalizeSiteOrigin,
  normalizedFactCheckConfidence,
  contractConsistentEditorialScore,
  repairDanglingStructuredIntroductions,
  removeUncitedQuantifiedSentences,
  removeUnledgeredEvidenceParagraphs,
  removeUnsupportedClaimSentences,
  removeUnverifiedInlineCitations,
  selectReviewedProductImage,
  STRICT_PUBLICATION_MIN_WORDS,
  uncitedEvidenceRequiredParagraphs,
  validateClaimEvidenceLedger,
} from "../convex/lib/articleQuality.ts";
import {
  STRICT_EVIDENCE_SEARCH_DOMAINS,
  classifyEvidenceSource,
  normalizeEvidenceUrl,
  strictEvidenceSources,
} from "../convex/lib/sourceQuality.ts";
import {
  appendRelatedInternalLinks,
  injectInternalLinks,
  preferredInternalLinkAnchorCandidates,
  publishedArticleInternalHref,
  selectRelatedInternalLinks,
  stripGeneratedInternalLinks,
  validateInternalLinkSuggestions,
} from "../convex/lib/internalLinks.ts";
import {
  buildHeroImagePrompt,
  buildSupportingImagePrompt,
  insertImageUnderSection,
  insertYouTubeAfterSection,
} from "../convex/lib/mediaQuality.ts";
import { sha256Hex } from "../convex/lib/publicationArtifact.ts";

const body = Array.from(
  { length: 950 },
  (_, index) => `useful${index}`,
).join(" ");

test("length recovery reserves bounded headroom for deterministic evidence pruning", () => {
  assert.equal(evidenceSafeLengthRecoveryTarget({
    currentWords: 683,
    minimumWords: 1200,
    maximumWords: 2600,
  }), 2234);
  assert.equal(evidenceSafeLengthRecoveryTarget({
    currentWords: 702,
    minimumWords: 1200,
    maximumWords: 3000,
  }), 2196);
  assert.equal(evidenceSafeLengthRecoveryTarget({
    currentWords: 1199,
    minimumWords: 1200,
    maximumWords: 3000,
  }), 1800);
  assert.equal(evidenceSafeLengthRecoveryTarget({
    currentWords: 100,
    minimumWords: 1200,
    maximumWords: 1800,
  }), 1800);
  assert.equal(evidenceSafeLengthRecoveryTarget({
    currentWords: 1300,
    minimumWords: 1200,
    maximumWords: 3000,
  }), 1200);
});

test("new drafts carry a bounded depth reserve without padding to the ceiling", () => {
  assert.equal(initialArticleDepthTarget({
    minimumWords: 1200,
    maximumWords: 2600,
  }), 1500);
  assert.equal(initialArticleDepthTarget({
    minimumWords: 1200,
    maximumWords: 1400,
  }), 1400);
  assert.equal(initialArticleDepthTarget({
    minimumWords: 1200,
    maximumWords: 2600,
    requestedWords: 1800,
  }), 1800);
  assert.equal(initialArticleDepthTarget({
    minimumWords: 1200,
    maximumWords: 2600,
    requestedWords: 900,
  }), 1500);
});

test("fact-check confidence follows the provider's audited claim counts", () => {
  assert.equal(normalizedFactCheckConfidence({
    confidenceScore: 78,
    claimCount: 12,
    verifiedCount: 12,
  }), 100);
  assert.equal(normalizedFactCheckConfidence({
    confidenceScore: 96,
    claimCount: 10,
    verifiedCount: 8,
  }), 80);
  assert.equal(normalizedFactCheckConfidence({ confidenceScore: 88 }), 88);
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(
    pipeline,
    /confidenceScore:\s*normalizedFactCheckConfidence\(reviewed\)/,
  );
});

test("editorial score enforces the auditor's material-defect contract", () => {
  assert.equal(contractConsistentEditorialScore({
    score: 84,
    materialDefects: [],
    deterministicEvidenceDefectCount: 0,
  }), 84, "an unexplained low score must not be promoted into a passing audit");
  assert.equal(contractConsistentEditorialScore({
    score: 92,
    materialDefects: ["The comparison omits the decision criteria."],
    deterministicEvidenceDefectCount: 0,
  }), 84);
  assert.equal(contractConsistentEditorialScore({
    score: 91,
    materialDefects: [],
    deterministicEvidenceDefectCount: 1,
  }), 84);
});

test("the auditor receives the same deterministic claim units the gate validates", () => {
  const productEvidence =
    "Name: LeadPilot\nLeadPilot answers buyer questions using approved website content.";
  const markdown = [
    "# A useful guide",
    "",
    "Use this checklist to decide what your own analytics justify.",
    "",
    "LeadPilot answers buyer questions using the website content approved by the owner.",
    "",
    "A published study reports a measured response improvement [1].",
  ].join("\n");
  assert.deepEqual(evidenceRequiredParagraphs(markdown, productEvidence), [
    "LeadPilot answers buyer questions using the website content approved by the owner.",
    "A published study reports a measured response improvement [1].",
  ]);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /REQUIRED CLAIM UNITS/);
  assert.match(pipeline, /requiredClaimUnits\.length \* 512/);
  assert.doesNotMatch(
    pipeline,
    /if \(!claimAudit\.passed\) \{\s*pruned = removeUnledgeredEvidenceParagraphs/,
  );
});

test("strict generation and publication share one minimum depth contract", () => {
  const belowMinimum = Array.from(
    { length: STRICT_PUBLICATION_MIN_WORDS - 1 },
    (_, index) => `useful${index}`,
  ).join(" ");
  const atMinimum = `${belowMinimum} useful${STRICT_PUBLICATION_MIN_WORDS}`;

  const below = evaluatePublicationQuality(
    { title: "Depth contract", markdown: belowMinimum },
    "strict",
  );
  const exact = evaluatePublicationQuality(
    { title: "Depth contract", markdown: atMinimum },
    "strict",
  );
  assert.ok(
    below.issues.includes(
      `Article is too thin (${STRICT_PUBLICATION_MIN_WORDS - 1} words; minimum ${STRICT_PUBLICATION_MIN_WORDS}).`,
    ),
  );
  assert.equal(exact.issues.some((issue) => issue.includes("Article is too thin")), false);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /const minimumWords = STRICT_PUBLICATION_MIN_WORDS/);
  assert.doesNotMatch(pipeline, /wordCount < 900|between 900 words|\/900-\$\{maxWords\}/);
});

test("removes only audit-identified unsupported prose claims", () => {
  const markdown = [
    "# Website conversion guide",
    "",
    "Long forms create friction and reduce conversion for every website visitor. A shorter form can be tested when completion appears weak.",
    "",
    "- https://example.com/research",
    "- Keep the existing qualification step until evidence supports a change.",
    "",
    "| Signal | Action |",
    "| --- | --- |",
    "| Low completion | Test one fewer field |",
  ].join("\n");

  const result = removeUnsupportedClaimSentences(markdown, [
    "Long website forms add friction and reduce visitor conversion.",
  ]);

  assert.doesNotMatch(result, /Long forms create friction/);
  assert.match(result, /A shorter form can be tested/);
  assert.match(result, /# Website conversion guide/);
  assert.match(result, /https:\/\/example\.com\/research/);
  assert.match(result, /Keep the existing qualification step/);
  assert.match(result, /\| Low completion \| Test one fewer field \|/);
  assert.equal(
    removeUnsupportedClaimSentences(markdown, ["conversion issue"]),
    markdown,
  );
});

test("removes evidence-required paragraphs omitted from the supported claim ledger", () => {
  const markdown = [
    "# Practical comparison",
    "This recommendation is framed as advice and does not assert a measured external outcome.",
    "Automation tools reduce qualification time for every sales team by moving discovery before handoff.",
    "LeadPilot answers buyer questions using the website content approved by the owner.",
  ].join("\n\n");
  const productEvidence =
    "Name: LeadPilot\nLeadPilot answers buyer questions using approved website content.";

  const result = removeUnledgeredEvidenceParagraphs({
    markdown,
    productEvidence,
    claimEvidence: [
      {
        claim: "LeadPilot answers buyer questions using approved website content.",
        citationNumbers: [],
        supported: true,
        reason: "The first-party product snapshot directly supports this capability.",
      },
    ],
  });

  assert.doesNotMatch(result, /reduce qualification time/);
  assert.match(result, /recommendation is framed as advice/);
  assert.match(result, /LeadPilot answers buyer questions/);
});

test("normalizes bare and fully-qualified site domains", () => {
  assert.equal(normalizeSiteOrigin("leadpilot.chat/"), "https://leadpilot.chat");
  assert.equal(
    normalizeSiteOrigin("https://leadpilot.chat/"),
    "https://leadpilot.chat",
  );
});

test("clamps meta descriptions cleanly without cutting through a word", () => {
  const description = clampMetaDescription(
    "Learn how to deploy a lead qualification chatbot, score buyer fit in real time, and hand warm leads to sales with a practical step-by-step workflow that keeps going.",
    120,
  );

  assert.ok(description);
  assert.ok(description.length <= 120);
  assert.match(description, /\.$/);
  assert.doesNotMatch(description, /\s\.$/);
  assert.doesNotMatch(description, /\b(?:and|or|to|with)\.$/i);
  assert.equal(
    clampMetaDescription(
      "Lead generation chatbots answer buyer questions and hand qualified leads to sales with full.",
    ),
    "Lead generation chatbots answer buyer questions and hand qualified leads to sales.",
  );
  assert.equal(clampMetaTitle("A useful title that is deliberately far too long to fit inside a clean search result"), "A useful title that is deliberately far too long to fit");
  assert.equal(
    clampMetaDescription("Learn how qualification turns website conversations into"),
    "Learn how qualification turns website conversations.",
  );
  assert.equal(
    clampMetaDescription(
      "Learn how sales engagement platforms use AI chatbots to qualify leads through natural conversation instead of forms, improving website conversion and.",
    ),
    "Learn how sales engagement platforms use AI chatbots to qualify leads through natural conversation instead of forms, improving website conversion.",
  );
  assert.equal(
    clampMetaDescription(
      "Learn how website chat captures qualified demand, provides details and.",
    ),
    "Learn how website chat captures qualified demand, provides details.",
  );

  const exactBoundary = clampMetaDescription("x".repeat(155), 155);
  assert.ok(exactBoundary);
  assert.ok(exactBoundary.length <= 155);
  assert.match(exactBoundary, /\.$/);
});

test("strict publication rejects a promised metric list that was removed", () => {
  const markdown = [
    "# ROI measurement guide",
    "",
    "## Establish your baseline",
    "",
    "Document these current-state metrics:",
    "",
    "Write these down before deployment so the comparison remains honest.",
    "",
    body,
  ].join("\n");
  const result = evaluatePublicationQuality(
    {
      title: "ROI measurement guide",
      markdown,
      metaTitle: "ROI Measurement Guide for Website Chatbots",
      metaDescription:
        "Build an honest chatbot ROI baseline, compare qualified-lead outcomes, and measure the commercial result using your own business data.",
      wordCount: 980,
      factCheckScore: 90,
      editorialQualityScore: 90,
      mediaQualityStatus: "passed",
      featuredImage: "https://example.com/reviewed.jpg",
      reviewedMediaUrls: ["https://example.com/reviewed.jpg"],
      claimEvidenceStatus: "passed",
    },
    "strict",
  );
  assert.equal(result.passed, false);
  assert.ok(
    result.issues.some((issue) =>
      issue.includes("promises a list or table but none follows")
    ),
  );
});

test("strict publication accepts a promised metric list when it is present", () => {
  const markdown = [
    "# ROI measurement guide",
    "",
    "## Establish your baseline",
    "",
    "Document these current-state metrics:",
    "",
    "- Monthly unique website visitors",
    "- Qualified inbound leads per month",
    "- Median first-response time",
    "",
    body,
  ].join("\n");
  const result = evaluatePublicationQuality(
    {
      title: "ROI measurement guide",
      markdown,
      metaTitle: "ROI Measurement Guide for Website Chatbots",
      metaDescription:
        "Build an honest chatbot ROI baseline, compare qualified-lead outcomes, and measure the commercial result using your own business data.",
      wordCount: 980,
      factCheckScore: 90,
      editorialQualityScore: 90,
      mediaQualityStatus: "passed",
      featuredImage: "https://example.com/reviewed.jpg",
      reviewedMediaUrls: ["https://example.com/reviewed.jpg"],
      claimEvidenceStatus: "passed",
    },
    "strict",
  );
  assert.equal(
    result.issues.some((issue) =>
      issue.includes("promises a list or table but none follows")
    ),
    false,
  );
});

test("mechanically closes only structured introductions whose promised block is missing", () => {
  const dangling = [
    "## Measure performance",
    "",
    "Document these current-state metrics:",
    "",
    "Write them down before deployment.",
  ].join("\n");
  assert.equal(
    repairDanglingStructuredIntroductions(dangling),
    [
      "## Measure performance",
      "",
      "Document these current-state metrics.",
      "",
      "Write them down before deployment.",
    ].join("\n"),
  );

  const valid = [
    "Document these current-state metrics:",
    "",
    "- Qualified leads",
    "- Sales handoffs",
  ].join("\n");
  assert.equal(repairDanglingStructuredIntroductions(valid), valid);
});

test("strict publication rejects metadata cut off after a transitive verb", () => {
  const result = evaluatePublicationQuality(
    {
      title: "Chatbot vs contact forms",
      markdown: `# Chatbot vs contact forms\n\n${body}`,
      metaTitle: "Chatbot vs Contact Forms for Lead Capture",
      metaDescription:
        "Chatbots qualify intent before asking for contact details, while forms collect information upfront. Learn which tool captures.",
      wordCount: 960,
      factCheckScore: 90,
      editorialQualityScore: 90,
      mediaQualityStatus: "passed",
      featuredImage: "https://example.com/reviewed.jpg",
      reviewedMediaUrls: ["https://example.com/reviewed.jpg"],
      claimEvidenceStatus: "passed",
    },
    "strict",
  );
  assert.equal(result.passed, false);
  assert.ok(
    result.issues.some((issue) =>
      issue.includes("dangling or incomplete phrase")
    ),
  );
});

test("metadata clamping drops an incomplete generated final sentence", () => {
  assert.equal(
    clampMetaDescription(
      "Chatbots qualify visitors before asking for contact information, while forms collect data upfront. Learn which approach captures.",
    ),
    "Chatbots qualify visitors before asking for contact information, while forms collect data upfront.",
  );
});

test("ordinary advice mentioning data does not become a sourced research claim", () => {
  const productEvidence =
    "LeadPilot captures visitor contact details and sends the conversation context to the sales team.";
  const result = validateClaimEvidenceLedger({
    markdown:
      "Understand what the product solves before asking questions. Otherwise the chatbot collects data without useful context.",
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [
      {
        claim: "LeadPilot captures visitor contact details and sends conversation context to the sales team.",
        citationNumbers: [],
        supported: true,
        reason: "The first-party product snapshot states this workflow directly.",
      },
    ],
  });

  assert.equal(result.requiredClaimCount, 0);
  assert.deepEqual(result.issues, []);
});

test("a topical use of research is not mistaken for evidence attribution", () => {
  const productEvidence =
    "Name: Pentra\nDomain: pentra.dev\nPentra creates structured content briefs.";
  const result = validateClaimEvidenceLedger({
    markdown:
      "Use a research question generator to organize a content brief around the questions your team chooses to answer.",
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [
      {
        claim: "Pentra creates structured content briefs.",
        citationNumbers: [],
        supported: true,
        reason: "The hashed first-party product snapshot states this capability.",
      },
    ],
  });

  assert.equal(result.requiredClaimCount, 0);
  assert.deepEqual(result.issues, []);
});

test("an actual research attribution still requires exact evidence", () => {
  const result = validateClaimEvidenceLedger({
    markdown:
      "Research supports the claim that automated briefs improve organic performance.",
    sources: [],
    researchEvidence: "",
    productEvidence: "",
    claimEvidence: [],
  });

  assert.equal(result.requiredClaimCount, 1);
  assert.match(result.issues.join(" "), /absent from the claim ledger/i);
});

test("evidence as a writing input does not turn advice into an external factual claim", () => {
  const paragraphs = [
    '1. Who, specifically, is the reader? Not "everyone considering this category" — a named role in a named situation.\n2. What situation brought them to this page rather than a different one?\n3. What evidence would this reader need to move forward?\n4. Given that evidence need, which format actually fits — a product page, a use-case page, a workflow page, or a comparison page?',
    "- **Buyer problem:** the specific friction, risk, delay, or uncertainty the reader recognizes\n- **Product capability:** the verified action the product can perform\n- **Workflow change:** what the user does differently after adopting that capability\n- **Evidence:** a demonstration, approved documentation, or other reviewable support\n- **Limitation:** the condition that prevents the claim from becoming misleading\n- **Next action:** the sensible step for a reader who wants to evaluate fit",
    "1. State the situation and the decision the page supports.\n2. Describe the relevant workflow in plain language.\n3. Explain the product capabilities involved.\n4. Show the controls, prerequisites, and limits.\n5. Present the evidence available for review.\n6. Give the reader a proportionate next step.",
    "A product-truth record gates what you're allowed to claim. A decision statement anchors each page to a specific reader. An evidence map ties every message to a verifiable source. A reusable packet keeps repeated facts consistent. Review gates catch drift before it reaches a buyer. None of these substitutes for the others — an evidence map built on an incomplete product-truth record will still produce unsupported claims.",
    "To put the system into practice, pick one workflow that matters to your business now. Write its product-truth record, write its decision statement, build its evidence map, and run the reader tools above against the resulting draft before publishing. Use what you learn from that single asset — where a tool caught a problem, where reviewers disagreed — to adjust the process before applying it to the next workflow.",
    "A procurement brief can have separate fields for the proposed purchase, evidence to review, and unanswered questions. Fill those fields from your own evaluation before requesting approval.",
  ];
  for (const paragraph of paragraphs) {
    const result = validateClaimEvidenceLedger({
      markdown: paragraph,
      sources: [],
      researchEvidence: "",
      productEvidence: "Name: ExampleApp\nDomain: example.invalid",
      claimEvidence: [{ claim: paragraph, citationNumbers: [], supported: true, reason: "Author-proposed writing advice." }],
    });
    assert.equal(result.requiredClaimCount, 0, paragraph);
    assert.deepEqual(result.issues, [], paragraph);
  }
});

test("evidence assertions and facts mixed into advice remain fail-closed", () => {
  const factualClaims = [
    "The evidence shows that automated briefs improve organic performance.",
    "Evidence from controlled trials confirms that chatbots improve conversion.",
    "There is evidence that automated briefs improve organic performance.",
    "There is evidence of a measurable improvement in organic performance.",
    "ExampleApp automatically publishes every article without review.",
    "The workflow increases sales by 35% within a month.",
    "This method improves organic performance [1].",
  ];
  for (const claim of factualClaims) {
    for (const prefix of ["", "An evidence map lists the material to review. "]) {
      const paragraph = prefix + claim;
      const result = validateClaimEvidenceLedger({
        markdown: paragraph,
        sources: [],
        researchEvidence: "",
        productEvidence: "Name: ExampleApp\nDomain: example.invalid",
        claimEvidence: [{ claim: paragraph, citationNumbers: [], supported: true, reason: "Claimed support is not a substitute for preserved evidence." }],
      });
      assert.equal(result.requiredClaimCount, 1, paragraph);
      assert.equal(result.passed, false, paragraph);
      assert.match(result.issues.join(" "), /neither a matched source excerpt nor a valid matched first-party evidence snapshot/i);
    }
  }
});

test("reader procedures are formatting-independent and cannot hide factual body claims", () => {
  const procedure = [
    "1. **What is the buyer problem?** Name the specific friction, risk, delay, or uncertainty the reader recognizes.",
    "2. **What is the product capability?** Name only the verified action the product can perform — not an inferred benefit.",
    "3. **What changes in the reader's workflow** once they adopt that capability?",
    "4. **What evidence supports this?** A demonstration, approved documentation, or other reviewable source.",
    "5. **What is the limitation?** The condition that prevents the claim from becoming misleading.",
    "6. **What is the next action** for a reader who wants to evaluate fit?",
  ].join("\n");
  const productEvidence = "Name: ExampleApp\nDomain: example.invalid";
  for (const markdown of [procedure, procedure.replaceAll("**", "")]) {
    assert.deepEqual(evidenceRequiredParagraphs(markdown, productEvidence), []);
    for (const fact of [
      "ExampleApp automatically publishes every article.",
      "Chatbots convert more website visitors.",
      "Evidence shows that automated briefs improve organic performance.",
      "The workflow increases sales by 35% within a month.",
    ]) {
      const mixed = `${markdown} ${fact}`;
      assert.deepEqual(evidenceRequiredParagraphs(mixed, productEvidence), [mixed]);
    }
  }
  const disguised = "1. **Check the output.** Chatbots convert more visitors.\n2. **Confirm the audit trail.** Record the result.";
  assert.deepEqual(evidenceRequiredParagraphs(disguised, productEvidence), [disguised]);
});

test("reader-supplied ROI measurement instructions do not require external evidence", () => {
  const productEvidence =
    "Name: LeadPilot\nDomain: leadpilot.chat\nLeadPilot learns website content, captures visitor contact details, and preserves conversation context.";
  const result = validateClaimEvidenceLedger({
    markdown: [
      "ROI compares the value your business records against what your business spends.",
      "**The key measurement:** Track close rate separately for chatbot-sourced leads versus other lead sources. If your own analytics show a different close rate, keep those cohorts separate.",
      "**Current state (pre-deployment):**\n- Average screening time per lead\n- Close rate on inbound leads\n- Average deal value",
      "LeadPilot learns website content and captures visitor contact details with conversation context.",
    ].join("\n\n"),
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [
      {
        claim: "ROI compares recorded value against recorded cost.",
        citationNumbers: [],
        supported: true,
        reason: "This is a calculation definition using the reader's own inputs.",
      },
      {
        claim:
          "LeadPilot learns website content and captures visitor contact details with conversation context.",
        citationNumbers: [],
        supported: true,
        reason: "The hashed first-party product snapshot states this workflow.",
      },
    ],
  });

  assert.equal(result.requiredClaimCount, 1);
  assert.deepEqual(result.issues, []);
});

test("ROI question framing, FAQ prompts, and input checklists are not factual claims", () => {
  const productEvidence = "Name: LeadPilot\nDomain: leadpilot.chat";
  const result = validateClaimEvidenceLedger({
    markdown: [
      "The practical question is whether an AI chatbot can convert enough of your existing demand to justify its cost.",
      "- Current monthly inbound lead volume\n- Average deal value\n- What is the current close rate?",
      "**Q: Can a chatbot convert every visitor?**",
    ].join("\n\n"),
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [],
  });

  assert.equal(result.requiredClaimCount, 0);
  assert.deepEqual(result.issues, [], "questions without factual assertions do not need invented ledger entries");
});

test("an independently identified unsupported claim blocks even when no deterministic pattern matches", () => {
  const claim = "Letters arrive instantly across every network without any delivery failures.";
  assert.deepEqual(evidenceRequiredParagraphs(claim, ""), []);
  const result = validateClaimEvidenceLedger({ markdown: claim, sources: [], productEvidence: "", researchEvidence: "",
    claimEvidence: [{ claim, citationNumbers: [], supported: false, reason: "No preserved evidence supports this delivery guarantee." }],
  });
  assert.equal(result.passed, false);
  assert.match(result.issues.join(" "), /unsupported/i);
});

test("explicit author frameworks, reader-run procedures, and standalone CTAs are not evidence claims", () => {
  const productEvidence =
    "Name: Pentra\nDomain: pentra.dev\nPentra publishes through a GitHub adapter and verifies the live page.";
  const markdown = [
    "This evaluation is proposed by this guide — not an external or industry-standard checklist — and can be applied to any platform, including Pentra.",
    [
      "1. **Name the bottleneck.** Write down the problem your own analytics show.",
      "2. **Check the output.** Verify the resulting page in your own environment.",
      "3. **Confirm the audit trail.** Treat an unverified status as inconclusive.",
    ].join("\n"),
    "Here is what to check directly on Pentra's product pages before deciding.",
    "[Try Pentra](https://pentra.dev/sign-up)",
  ].join("\n\n");
  assert.deepEqual(evidenceRequiredParagraphs(markdown, productEvidence), []);
  const result = validateClaimEvidenceLedger({
    markdown,
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [
      {
        claim: markdown.split("\n\n")[0],
        citationNumbers: [],
        supported: true,
        reason: "This is explicitly identified as an author-proposed framework.",
      },
      {
        claim: "[Try Pentra](https://pentra.dev/sign-up)",
        citationNumbers: [],
        supported: true,
        reason: "This is a standalone call-to-action link, not a factual claim.",
      },
    ],
  });
  assert.deepEqual(result.issues, []);
});

test("authorial ranking disclaimers are exempt but embedded product capabilities remain audited", () => {
  const productEvidence =
    "Name: Pentra\nDomain: pentra.dev\nPentra publishes through a GitHub adapter.";
  const authorialContext =
    "This guide is an author-proposed evaluation framework, not a ranking of every tool on the market and not a citation of third-party benchmark scores. The next section sets out evaluation questions this guide proposes you run yourself against any SEO platform. The guide then looks at Pentra using only what Pentra's own product pages state about it.";
  assert.deepEqual(
    evidenceRequiredParagraphs(authorialContext, productEvidence),
    [],
  );
  const readerRunContext =
    "The sequence below is a reader-run test proposed by this guide for evaluating any SEO platform, including Pentra, against your actual situation rather than a features list. It is not an industry-standard procedure; the value is in applying it to your own site's data.";
  assert.deepEqual(
    evidenceRequiredParagraphs(readerRunContext, productEvidence),
    [],
  );

  const capabilityClaim =
    "This guide uses an author-proposed framework, not a ranking. Pentra automatically publishes every article through GitHub.";
  assert.deepEqual(
    evidenceRequiredParagraphs(capabilityClaim, productEvidence),
    [capabilityClaim],
  );
});

test("framework and measurement labels cannot exempt third-party factual assertions", () => {
  const productEvidence = "Name: ExampleApp\nDomain: example.invalid";
  const assertions = [
    "Atlas Market does not publish how its ranking system works.",
    "Northwind Cloud never discloses its recommendation mechanics.",
    "The platform does not provide impression measurements for sellers.",
    "No analytics reports are available from the service.",
    "Autocomplete suggestions come from actual customer queries.",
    "The selected category determines which search results include a listing.",
    "Research shows that this workflow improves organic performance.",
    "ExampleApp automatically publishes every article without review.",
  ];
  for (const assertion of assertions) {
    for (const prefix of [
      "",
      "This is an author-proposed framework, not an external standard. ",
      "Record the result in your own worksheet. ",
      "The practical question is whether the workflow suits your business. ",
    ]) {
      const paragraph = prefix + assertion;
      assert.deepEqual(evidenceRequiredParagraphs(paragraph, productEvidence), [paragraph], paragraph);
      const checked = validateClaimEvidenceLedger({
        markdown: paragraph, sources: [], researchEvidence: "", productEvidence,
        claimEvidence: [{ claim: paragraph, citationNumbers: [], supported: true,
          reason: "A prose label cannot substitute for a preserved evidence source." }],
      });
      assert.equal(checked.passed, false, paragraph);
    }
  }
});

test("first-party word overlap cannot certify an unrelated platform's mechanics", () => {
  const productEvidence = "Name: ExampleApp\nDomain: example.invalid\nExampleApp helps teams research keyword ranking and publish content. Its workflow records how the system works and what steps an author chose.";
  const external = "VendorDock does not publish how its keyword ranking system works.";
  const own = "ExampleApp helps teams research keyword ranking and publish content.";
  for (const paragraph of [external, `${own} ${external}`]) {
    const result = validateClaimEvidenceLedger({ markdown: paragraph, sources: [], researchEvidence: "", productEvidence,
      productEvidenceHash: sha256Hex(productEvidence),
      claimEvidence: [{ claim: paragraph, supported: true, citationNumbers: [], reason: "The auditor asserted support based on overlapping research vocabulary." }],
    });
    assert.equal(result.passed, false, paragraph);
    assert.match(result.issues.join(" "), /neither a matched source excerpt/);
  }
  const valid = validateClaimEvidenceLedger({ markdown: own, sources: [], researchEvidence: "", productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [{ claim: own, supported: true, citationNumbers: [], reason: "The exact first-party product snapshot states this capability." }],
  });
  assert.equal(valid.passed, true, valid.issues.join(" "));
});

test("first-party authority checks preserve mixed transitions and genuinely documented limitations", () => {
  const productEvidence = "Name: ExampleApp\nDomain: example.invalid\nExampleApp researches keywords and publishes approved articles through a connected repository. ExampleApp does not provide an email inbox.";
  for (const claim of [
    "This is where ExampleApp fits in the operating system described above. ExampleApp researches keywords and publishes approved articles through a connected repository.",
    "ExampleApp does not provide an email inbox.",
  ]) {
    const checked = validateClaimEvidenceLedger({
      markdown: claim, sources: [], researchEvidence: "", productEvidence,
      productEvidenceHash: sha256Hex(productEvidence),
      claimEvidence: [{ claim, supported: true, citationNumbers: [], reason: "The preserved first-party snapshot states the exact product capability or limitation." }],
    });
    assert.equal(checked.passed, true, checked.issues.join("\n"));
  }
});

test("retrieval limitations and reader instructions remain distinct from platform absence claims", () => {
  const productEvidence = "Name: ExampleApp\nDomain: example.invalid";
  for (const paragraph of [
    "No external source was captured during this research attempt; do not infer a platform-wide limitation from that.",
    "We did not find documentation in the supplied research; check the service's current help pages before deciding.",
    "Do not publish an assertion about a platform's ranking system without supporting documentation.",
    "- Do not publish an assertion about a platform's ranking system without supporting documentation.",
    "Does the platform never disclose its recommendation mechanics?",
    "Record the analytics reports available in your own account before choosing what to measure.",
    "The practical question is whether your account offers the reports you need.",
    "If your business does not offer a service, record that limitation before choosing the next action.",
    "A visitor may want to talk immediately but need a service you do not provide. Record the uncertainty before deciding.",
    "- [ ] What evidence supports the fit classification?\n- [ ] What information is unknown rather than negative?",
    "This is an author-proposed framework, not an external standard. Compare the options against your own requirements.",
  ]) assert.deepEqual(evidenceRequiredParagraphs(paragraph, productEvidence), [], paragraph);
});

test("first-party sentence lead-ins do not become phantom named entities", () => {
  const productEvidence =
    "Name: Pentra\nDomain: pentra.dev\nPentra connects to Google Search Console and tracks clicks and impressions.";
  const claim =
    "Per Pentra's product pages, Pentra connects to Google Search Console and tracks clicks and impressions.";
  const result = validateClaimEvidenceLedger({
    markdown: claim,
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [{
      claim,
      citationNumbers: [],
      supported: true,
      reason: "The exact hashed first-party snapshot states this capability.",
    }],
  });
  assert.equal(result.passed, true, result.issues.join("\n"));
});

test("short factual bullet claims still require evidence", () => {
  const productEvidence = "Name: LeadPilot\nDomain: leadpilot.chat";
  const result = validateClaimEvidenceLedger({
    markdown: "- Chatbots convert more website visitors.",
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [],
  });

  assert.equal(result.requiredClaimCount, 1);
  assert.match(result.issues.join(" "), /absent from the claim ledger/i);
});

test("illustrative chatbot configurations are not treated as measured outcomes", () => {
  const productEvidence =
    "Name: LeadPilot\nDomain: leadpilot.chat\nLeadPilot captures visitor contact details.";
  const result = validateClaimEvidenceLedger({
    markdown: [
      "**Sales Booking Automation**\nThe chatbot qualifies leads and directly books qualified calls into a sales calendar.",
      "**Support and Presales Triage**\nThe chatbot answers product questions and routes complex inquiries to a team member.",
      "LeadPilot captures visitor contact details.",
    ].join("\n\n"),
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [
      {
        claim: "LeadPilot captures visitor contact details.",
        citationNumbers: [],
        supported: true,
        reason: "The exact hashed first-party snapshot states this capability.",
      },
    ],
  });
  assert.equal(result.requiredClaimCount, 1);
  assert.deepEqual(result.issues, []);
});

test("an unsupported named-product capability still fails without hype or numbers", () => {
  const productEvidence =
    "Name: LeadPilot\nDomain: leadpilot.chat\nLeadPilot captures visitor contact details.";
  const result = validateClaimEvidenceLedger({
    markdown: "LeadPilot sends signed contracts and collects payments.",
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [
      {
        claim: "LeadPilot sends signed contracts and collects payments.",
        citationNumbers: [],
        supported: true,
        reason: "The product snapshot supposedly supports this capability.",
      },
    ],
  });
  assert.equal(result.passed, false);
  assert.match(result.issues.join(" "), /first-party evidence snapshot/i);
});

test("plain-Markdown publication rejects multiline and component MDX", () => {
  assert.equal(containsExecutableMdx("Useful prose with **Markdown**."), false);
  assert.equal(
    containsExecutableMdx("Useful prose\n\n{\n  await fetch('/private')\n}"),
    true,
  );
  assert.equal(containsExecutableMdx("<Dangerous\n value={secret}\n/>"), true);
  assert.equal(containsExecutableMdx("<>hidden expression</>"), true);
});

test("surfaces deterministic uncited numeric guidance for remediation", () => {
  const paragraphs = uncitedEvidenceRequiredParagraphs([
    "Use a documented qualification framework.",
    "Ask 10–15 questions, award 5/3/1 points, and review results after 2 weeks.",
    "A documented study reported a 12% change [1].",
  ].join("\n\n"));

  assert.deepEqual(paragraphs, [
    "Ask 10–15 questions, award 5/3/1 points, and review results after 2 weeks.",
  ]);
});

test("claim ledger cannot empty-pass and must bind citations to a preserved snapshot", () => {
  const markdown =
    "Research found that faster responses improved follow-up consistency [1].";
  const excerpt =
    "The Response Study found that faster responses improved follow-up consistency across the documented workflow. " +
    "The research describes response-time improvements and consistent follow-up behavior in sufficient detail for an exact evidence snapshot.";
  const sources = [
    {
      url: "https://www.nber.org/papers/w12345",
      title: "Response study",
      excerpt,
      contentHash: sha256Hex(excerpt),
    },
  ];
  const researchEvidence =
    "[1] Response study — https://www.nber.org/papers/w12345\nThe study reports more consistent follow-up after response-time improvements.";

  const empty = validateClaimEvidenceLedger({
    markdown,
    sources,
    researchEvidence,
    productEvidence: "",
    claimEvidence: [],
  });
  assert.equal(empty.passed, false);
  assert.match(empty.issues.join(" "), /ledger is empty/i);

  const grounded = validateClaimEvidenceLedger({
    markdown,
    sources,
    researchEvidence,
    productEvidence: "",
    claimEvidence: [
      {
        claim: "Faster responses improved follow-up consistency.",
        citationNumbers: [1],
        supported: true,
        reason: "The preserved Response study directly reports this relationship.",
      },
    ],
  });
  assert.deepEqual(grounded.issues, []);
  assert.equal(grounded.passed, true);
});

test("citation auditing accepts exact sourced sentences mixed with reader advice", () => {
  const excerpt =
    "The study analyzed 1M websites. It reported that the first category was most common among the top 300K websites and documented encrypted transport as an implementation concern. " +
    "The preserved source contains enough surrounding methodology and findings for deterministic verification.";
  const source = {
    url: "https://arxiv.org/abs/1234.5678",
    title: "Website implementation study",
    excerpt,
    contentHash: sha256Hex(excerpt),
  };
  const paragraph =
    "The study analyzed 1,000,000 websites and found the first category was most common among the top 300,000 websites [1]. Ask each vendor to document its transport controls before you decide.";
  const result = validateClaimEvidenceLedger({
    markdown: paragraph,
    sources: [source],
    researchEvidence: preservedResearchEvidenceSnapshot([source]),
    productEvidence: "",
    claimEvidence: [{
      claim: paragraph,
      citationNumbers: [1],
      supported: true,
      reason:
        "The cited sentence matches the preserved study; the second sentence is reader advice.",
    }],
  });

  assert.equal(result.passed, true, result.issues.join("\n"));
  assert.deepEqual(result.issues, []);
});

test("exact paragraph receipts cannot inherit citations from similar neighboring prose", () => {
  for (const brand of ["HarborDesk", "CedarWorks"]) {
    const own = `${brand} stores approved documents in the shared archive and records publication timestamps for reviewers.`;
    const cited = "Research found that approved documents in the shared archive have publication timestamps available for reviewers [1].";
    const productEvidence = `Name: ${brand}\nDomain: ${brand.toLowerCase()}.example\n${own}`;
    const excerpt = "Research found that approved documents in the shared archive have publication timestamps available for reviewers. The preserved report describes the study design and the observed archival workflow in sufficient detail for review.";
    const source = { url: "https://research.example/archive", excerpt, contentHash: sha256Hex(excerpt) };
    const ownEntry = { claim: own, supported: true, citationNumbers: [],
      reason: "Exact hashed first-party product evidence supports this paragraph." };
    const sourceEntry = { claim: cited, supported: true, citationNumbers: [1],
      reason: "The preserved research excerpt supports this separate paragraph." };
    for (const claimEvidence of [[ownEntry, sourceEntry], [sourceEntry, ownEntry]]) {
      const result = validateClaimEvidenceLedger({
        markdown: `${own}\n\n${cited}`, sources: [source], researchEvidence: excerpt,
        productEvidence, productEvidenceHash: sha256Hex(productEvidence), claimEvidence,
      });
      assert.equal(result.requiredClaimCount, 2);
      assert.equal(result.passed, true, result.issues.join("\n"));
    }
  }
});

test("an exact paragraph receipt cannot borrow a neighboring receipt's missing citation binding", () => {
  const first = "Research found that reviewed documents in the shared archive retain publication timestamps for readers [1].";
  const second = "Research found that approved documents in the shared archive retain publication timestamps for reviewers [1].";
  const excerpt = "Research found that reviewed and approved documents in the shared archive retain publication timestamps for readers and reviewers. The preserved report explains this measured archive behavior with additional context for the audit.";
  const result = validateClaimEvidenceLedger({
    markdown: `${first}\n\n${second}`,
    sources: [{ url: "https://research.example/archive", excerpt, contentHash: sha256Hex(excerpt) }],
    researchEvidence: excerpt, productEvidence: "", claimEvidence: [
      { claim: first, supported: true, citationNumbers: [], reason: "An incomplete citation binding was returned for this exact paragraph." },
      { claim: second, supported: true, citationNumbers: [1], reason: "Only this separate paragraph has a bound source receipt." },
    ],
  });
  assert.equal(result.passed, false);
  assert.match(result.issues.join("\n"), /paragraph 1 cites \[1\] without a matching supported claim-ledger entry/);
});

test("exact paragraph selection does not waive unsupported entries, snapshots or real missing inline citations", () => {
  const claim = "Research found that approved documents in the shared archive retain publication timestamps for reviewers.";
  const excerpt = `${claim} The preserved report describes the study design and the observed archival workflow in sufficient detail for review.`;
  const base = { markdown: claim, sources: [{ url: "https://research.example/archive", excerpt, contentHash: sha256Hex(excerpt) }],
    researchEvidence: excerpt, productEvidence: "" };
  const entry = { claim, supported: true, citationNumbers: [1], reason: "The source supports this paragraph but its inline citation is missing." };
  const missing = validateClaimEvidenceLedger({ ...base, claimEvidence: [entry] });
  assert.match(missing.issues.join("\n"), /omits the inline citation/);
  const unsupported = validateClaimEvidenceLedger({ ...base, claimEvidence: [{ ...entry, supported: false }] });
  assert.match(unsupported.issues.join("\n"), /unsupported/);
  const invalidSnapshot = validateClaimEvidenceLedger({ ...base, sources: [{ ...base.sources[0], contentHash: "invalid" }],
    claimEvidence: [entry] });
  assert.match(invalidSnapshot.issues.join("\n"), /content hash is missing or invalid/);
});

test("citation auditing still rejects uncited factual claims mixed into a sourced paragraph", () => {
  const excerpt =
    "The study analyzed 1M websites and documented implementation patterns. " +
    "The preserved source contains enough surrounding methodology and findings for deterministic verification.";
  const source = {
    url: "https://arxiv.org/abs/1234.5678",
    excerpt,
    contentHash: sha256Hex(excerpt),
  };
  const paragraph =
    "The study analyzed 1 million websites [1]. Chatbots increase website conversion.";
  const result = validateClaimEvidenceLedger({
    markdown: paragraph,
    sources: [source],
    researchEvidence: preservedResearchEvidenceSnapshot([source]),
    productEvidence: "",
    claimEvidence: [{
      claim: paragraph,
      citationNumbers: [1],
      supported: true,
      reason: "Only the first sentence appears in the preserved source.",
    }],
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join(" "), /uncited factual sentence/i);
});

test("durable research evidence keeps valid excerpts and their original citation ordinals", () => {
  const validExcerpt =
    "This exact primary-source excerpt is deliberately long enough to be retained as durable evidence. " +
    "It states the supported mechanism clearly and includes sufficient surrounding context for a later independent quality review.";
  const snapshot = preservedResearchEvidenceSnapshot([
    {
      url: "https://example.invalid/unverified",
      excerpt: "too short",
      contentHash: sha256Hex("too short"),
    },
    {
      url: "https://www.nber.org/papers/w12345",
      title: "Primary study",
      excerpt: validExcerpt,
      contentHash: sha256Hex(validExcerpt),
    },
  ]);

  assert.match(snapshot, /PRESERVED SOURCE EXCERPTS/);
  assert.match(snapshot, /\[2\] Primary study/);
  assert.match(snapshot, new RegExp(sha256Hex(validExcerpt)));
  assert.match(snapshot, /This exact primary-source excerpt/);
  assert.doesNotMatch(snapshot, /example\.invalid/);
});

test("bibliography metadata is not reclassified as an evidence claim", () => {
  const bibliography =
    '[1] Researcher, A. "Primary Study." https://arxiv.org/abs/1234.5678';
  assert.deepEqual(evidenceRequiredParagraphs(bibliography, ""), []);
  const result = validateClaimEvidenceLedger({
    markdown: bibliography,
    sources: [{
      url: "https://arxiv.org/abs/1234.5678",
      title: "Primary Study",
    }],
    researchEvidence: "",
    productEvidence: "",
    claimEvidence: [{
      claim: bibliography,
      citationNumbers: [1],
      supported: true,
      reason: "This row reproduces the stored source metadata.",
    }],
  });
  assert.equal(result.passed, true, result.issues.join("\n"));
});

test("a contiguous bibliography block is metadata only when every line is a reference", () => {
  const rows = [
    '[1] Researcher, A. "A Study of 12 Writers." https://research.example/writers',
    '[2] Authoring Tools 2.0 — https://standards.example/tools',
    '[3] Accessible Output — https://standards.example/output',
  ];
  for (const separator of ["\n", "\r\n", "\n\n"]) {
    const bibliography = rows.join(separator);
    assert.deepEqual(evidenceRequiredParagraphs(bibliography, ""), []);
    const result = validateClaimEvidenceLedger({ markdown: bibliography,
      sources: [], researchEvidence: "", productEvidence: "",
      claimEvidence: [{ claim: bibliography, citationNumbers: [1, 2, 3], supported: true,
        reason: "These are reference metadata rows, not assertions from their source bodies." }],
    });
    assert.equal(result.passed, true, result.issues.join("\n"));
  }
  for (const markdown of [
    `${rows[0]}\nResearch found that software increases conversion by 99%.`,
    '- https://research.example/writers\nResearch found that software increases conversion by 99%.',
    '- https://research.example/writers Research found that software increases conversion by 99%.',
  ]) {
    assert.equal(evidenceRequiredParagraphs(markdown, "").length, 1);
    const result = validateClaimEvidenceLedger({ markdown, sources: [], researchEvidence: "",
      productEvidence: "", claimEvidence: [{ claim: markdown, citationNumbers: [1], supported: true,
        reason: "A source-looking prefix must not excuse the unsupported assertion that follows." }],
    });
    assert.equal(result.passed, false);
  }
});

function auditCitedParagraph(claim: string, excerpts: string[]) {
  const sources = excerpts.map((excerpt, index) => ({ url: `https://research.example/source-${index + 1}`,
    excerpt, contentHash: sha256Hex(excerpt) }));
  return validateClaimEvidenceLedger({ markdown: claim, sources,
    researchEvidence: preservedResearchEvidenceSnapshot(sources), productEvidence: "",
    claimEvidence: [{ claim, citationNumbers: inlineCitationNumbers(claim), supported: true,
      reason: "The independent audit binds each stated proposition to its inline preserved source." }],
  });
}

const writerExcerpt = "The study surveyed 12 writers about hierarchical planning tools and documented their experiences with long-form documents. The source preserves the complete study methodology and enough surrounding context to inspect its findings.";
const editorExcerpt = "The study surveyed 8 editors about reflective writing assistants and documented their experiences with goal setting. The source preserves the complete study methodology and enough surrounding context to inspect its findings.";

test("distinct inline citations bind distinct propositions without borrowing earlier numbers", () => {
  for (const conjunction of [", while", ";", ", and"]) {
    const claim = `The study surveyed 12 writers [1]${conjunction} the study surveyed 8 editors [2].`;
    const result = auditCitedParagraph(claim, [writerExcerpt, editorExcerpt]);
    assert.equal(result.passed, true, result.issues.join("\n"));
  }
});

test("every repeated source marker is audited rather than accepting only its first proposition", () => {
  const result = auditCitedParagraph(
    "The study surveyed 12 writers [1], and the study surveyed 999 writers [1].", [writerExcerpt]);
  assert.equal(result.passed, false);
  assert.match(result.issues.join("\n"), /number absent from excerpt: "999"/);
});

test("adjacent citations still bind the same complete proposition to each source", () => {
  for (const citations of ["[1][2]", "[1] [2]", "[1], [2]", "[1] and [2]", "[1, 2]"]) {
    const claim = `The study surveyed 12 writers ${citations}.`;
    const valid = auditCitedParagraph(claim, [writerExcerpt, writerExcerpt]);
    assert.equal(valid.passed, true, valid.issues.join("\n"));
    const invalid = auditCitedParagraph(claim, [writerExcerpt, editorExcerpt]);
    assert.equal(invalid.passed, false, "A neighboring citation must not erase the unsupported number");
    assert.match(invalid.issues.join("\n"), /number absent from excerpt: "12"/);
  }
});

test("a trailing uncited factual clause cannot hide behind a preceding citation", () => {
  const invalid = auditCitedParagraph(
    "The study surveyed 12 writers [1], and software increases conversion by 99%.", [writerExcerpt]);
  assert.equal(invalid.passed, false);
  assert.match(invalid.issues.join("\n"), /uncited factual/);
  assert.match(invalid.issues.join("\n"), /Uncited text: "and software increases conversion by 99%\."/);
  const advice = auditCitedParagraph(
    "The study surveyed 12 writers [1] — compare the study's context with your own workflow before deciding.", [writerExcerpt]);
  assert.equal(advice.passed, true, advice.issues.join("\n"));
});

test("comma-list inline citations bind every ordinal to the exact claim ledger", () => {
  assert.deepEqual(inlineCitationNumbers("Supported result [1, 2] and method [3]."), [1, 2, 3]);
  const claim = "Research found that faster responses improved follow-up consistency.";
  const excerptOne =
    "The Response Study research found that faster responses improved follow-up consistency across the documented workflow and describes the audited method in sufficient detail for preservation.";
  const excerptTwo =
    "A second research review found that faster responses improved follow-up consistency across the documented workflow and repeats the exact relationship with enough surrounding source detail.";
  const sources = [
    {
      url: "https://www.nber.org/papers/w12345",
      excerpt: excerptOne,
      contentHash: sha256Hex(excerptOne),
    },
    {
      url: "https://www.oecd.org/research/response-study",
      excerpt: excerptTwo,
      contentHash: sha256Hex(excerptTwo),
    },
  ];
  const valid = validateClaimEvidenceLedger({
    markdown: `${claim} [1, 2]`,
    sources,
    researchEvidence: "Preserved research evidence.",
    productEvidence: "",
    claimEvidence: [
      {
        claim,
        citationNumbers: [1, 2],
        supported: true,
        reason: "Both preserved snapshots state the exact audited relationship.",
      },
    ],
  });
  assert.equal(valid.passed, true, valid.issues.join("\n"));

  const missingBinding = validateClaimEvidenceLedger({
    markdown: `${claim} [1, 2]`,
    sources,
    researchEvidence: "Preserved research evidence.",
    productEvidence: "",
    claimEvidence: [
      {
        claim,
        citationNumbers: [1],
        supported: true,
        reason: "Only the first preserved source is bound by this ledger entry.",
      },
    ],
  });
  assert.equal(missingBinding.passed, false);
  assert.match(missingBinding.issues.join(" "), /cites \[2\] without a matching supported claim-ledger entry/);
});

test("removes citation ordinals that have no preserved source", () => {
  assert.equal(
    removeUnverifiedInlineCitations(
      "LeadPilot captures contact context [1]. A study supports this [1, 2].",
      0,
    ),
    "LeadPilot captures contact context. A study supports this.",
  );
  assert.equal(
    removeUnverifiedInlineCitations(
      "A preserved source supports this [1, 2].",
      1,
    ),
    "A preserved source supports this [1].",
  );
});

test("source-less correction removes only the unsupported quantified sentence", () => {
  assert.equal(
    removeUncitedQuantifiedSentences(
      "These are not dramatic gains. You will not 10x revenue. Focus on whether qualified conversations improve.",
    ),
    "These are not dramatic gains. Focus on whether qualified conversations improve.",
  );
  assert.equal(
    removeUncitedQuantifiedSentences(
      "A documented study reported a 12% change [1]. Keep the cited result.",
    ),
    "A documented study reported a 12% change [1]. Keep the cited result.",
  );
});

test("uses only a reviewed image from the exact product section as a hero fallback", () => {
  const reviewedProduct = "https://cdn.example/product.png";
  const markdown = [
    "# Guide",
    "",
    "![Decorative image](https://cdn.example/decorative.png)",
    "",
    "## How LeadPilot Helps",
    "",
    `![LeadPilot workflow](${reviewedProduct})`,
    "",
    "## Conclusion",
    "",
    "Useful conclusion.",
  ].join("\n");

  assert.equal(
    selectReviewedProductImage(markdown, "LeadPilot", [reviewedProduct]),
    reviewedProduct,
  );
  assert.equal(
    selectReviewedProductImage(markdown, "LeadPilot", [
      "https://cdn.example/decorative.png",
    ]),
    undefined,
  );
});

test("restores preserved first-party evidence removed by prose remediation", () => {
  const reviewedProduct = "https://cdn.example/product.png";
  const remediated = [
    "# Guide",
    "",
    "## How LeadPilot Helps",
    "",
    "LeadPilot supports the workflow described here.",
    "",
    "## Conclusion",
    "",
    "Useful conclusion.",
  ].join("\n");

  const restored = insertReviewedProductImage(
    remediated,
    "LeadPilot",
    reviewedProduct,
  );
  assert.equal(restored.inserted, true);
  assert.equal(
    selectReviewedProductImage(
      restored.markdown,
      "LeadPilot",
      [reviewedProduct],
    ),
    reviewedProduct,
  );
  assert.equal(
    insertReviewedProductImage(restored.markdown, "LeadPilot", reviewedProduct)
      .inserted,
    false,
  );
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(
    pipeline,
    /preservedReviewedProductImage[\s\S]*insertReviewedProductImage/,
  );
});

test("website captures request a completed still image instead of a loading frame", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /image\.thum\.io\/get\/noanimate\/png\//);
});

test("misnumbered first-party claims fall back only to the exact hashed product snapshot", () => {
  const productEvidence =
    "LeadPilot captures visitor contact details and sends conversation context to the sales team.";
  const result = validateClaimEvidenceLedger({
    markdown:
      "LeadPilot captures visitor contact details and sends conversation context to the sales team.",
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [
      {
        claim:
          "LeadPilot captures visitor contact details and sends conversation context to the sales team.",
        citationNumbers: [1],
        supported: true,
        reason:
          "The exact hashed first-party product snapshot states this workflow directly.",
      },
    ],
  });

  assert.equal(result.passed, true, result.issues.join("\n"));
});

test("a headerless snapshot cannot certify an external platform assertion", () => {
  const claim = "VendorDock does not publish how its keyword ranking system works.";
  const productEvidence = claim;
  const result = validateClaimEvidenceLedger({
    markdown: claim,
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [{
      claim, citationNumbers: [1], supported: true,
      reason: "The captured text repeats the assertion but supplies no product identity or external source.",
    }],
  });
  assert.equal(result.passed, false);
  assert.match(result.issues.join("\n"), /missing source/);
});

test("sentence-opening lead-ins do not become phantom named entities", () => {
  const productEvidence =
    "LeadPilot answers from approved content. If the answer is missing, LeadPilot says so instead of inventing it.";
  const result = validateClaimEvidenceLedger({
    markdown:
      "When LeadPilot cannot find an answer, it says so instead of inventing it.",
    sources: [],
    researchEvidence: "",
    productEvidence,
    productEvidenceHash: sha256Hex(productEvidence),
    claimEvidence: [
      {
        claim:
          "When LeadPilot cannot find an answer, it says so instead of inventing it.",
        citationNumbers: [],
        supported: true,
        reason:
          "The exact hashed first-party snapshot states this fallback behavior.",
      },
    ],
  });

  assert.equal(result.passed, true, result.issues.join("\n"));
});

test("source mismatch feedback identifies the exact cited sentence and failed evidence detail", () => {
  for (const brand of ["Harbor", "Cedar"]) {
    const excerpt = `${brand} Metrics reports clicks, impressions, and average position. ` +
      "The report groups observations by page and query. Readers can compare the recorded measurements across reporting periods and inspect each page separately.";
    const check = (claim: string) => validateClaimEvidenceLedger({
      markdown: claim,
      sources: [{ url: "https://docs.example.com/report", excerpt, contentHash: sha256Hex(excerpt) }],
      researchEvidence: excerpt, productEvidence: "",
      claimEvidence: [{ claim, citationNumbers: [1], supported: true, reason: "The auditor asserts that the captured report supports this sentence." }],
    });
    const identity = `${brand} Search Console reports clicks, impressions, and average position [1].`;
    const identityResult = check(identity);
    assert.equal(identityResult.passed, false);
    assert.match(identityResult.issues.join("\n"), /Cited sentence:/);
    assert.ok(identityResult.issues.join("\n").includes(identity.slice(0, -1)));
    assert.ok(identityResult.issues.join("\n").includes(`named phrase absent from excerpt: "${brand.toLowerCase()} search console"`));
    const numeric = check(`${brand} Metrics reports 900 clicks and average position [1].`);
    assert.equal(numeric.passed, false);
    assert.match(numeric.issues.join("\n"), /number absent from excerpt: "900"/);
    const unmatched = check("Proprietary workflows guarantee automated campaign optimization without manual intervention [1].");
    assert.equal(unmatched.passed, false);
    assert.match(unmatched.issues.join("\n"), /insufficient source wording overlap/);
    const corrected = check(`${brand} Metrics reports clicks, impressions, and average position [1].`);
    assert.equal(corrected.passed, true, corrected.issues.join("\n"));
  }
});

test("first-party mismatch feedback distinguishes navigation numbers and unsupported product details", () => {
  for (const brand of ["Harbor", "Cedar"]) {
    const productEvidence = `Name: ${brand}\n${brand} publishes reviewed articles and tracks page impressions and clicks.`;
    const check = (claim: string) => validateClaimEvidenceLedger({
      markdown: claim, sources: [], researchEvidence: "", productEvidence,
      productEvidenceHash: sha256Hex(productEvidence),
      claimEvidence: [{ claim, citationNumbers: [], supported: true,
        reason: "The auditor asserts that the preserved product snapshot supports this prose." }],
    });
    const navigation = check(`${brand} publishes reviewed articles — see Step 5.`);
    assert.equal(navigation.passed, false);
    assert.match(navigation.issues.join("\n"), /Product claim:/);
    assert.match(navigation.issues.join("\n"), /number absent from excerpt: "5"/);
    const quantity = check(`${brand} publishes 900 reviewed articles each month.`);
    assert.equal(quantity.passed, false);
    assert.match(quantity.issues.join("\n"), /number absent from excerpt: "900"/);
    const alias = check(`${brand} Search Suite tracks page impressions and clicks.`);
    assert.equal(alias.passed, false);
    assert.ok(alias.issues.join("\n").includes(`named phrase absent from excerpt: "${brand.toLowerCase()} search suite"`));
    const corrected = check(`${brand} publishes reviewed articles and tracks page impressions and clicks.`);
    assert.equal(corrected.passed, true, corrected.issues.join("\n"));
  }
});

test("first-party diagnostic reports invalid provenance without pretending wording can repair it", () => {
  const claim = "Cedar publishes reviewed articles and tracks page impressions and clicks.";
  const productEvidence = `Name: Cedar\n${claim}`;
  for (const productEvidenceHash of [undefined, sha256Hex("different snapshot")]) {
    const result = validateClaimEvidenceLedger({
      markdown: claim, sources: [], researchEvidence: "", productEvidence, productEvidenceHash,
      claimEvidence: [{ claim, citationNumbers: [], supported: true,
        reason: "The auditor asserts support without an exact valid first-party snapshot." }],
    });
    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /snapshot is missing or its content hash is invalid/);
    assert.doesNotMatch(result.issues.join("\n"), /number absent|wording overlap/);
  }
});

test("first-party diagnostic exposes a late unmatched detail while keeping feedback bounded", () => {
  const evidence = "Name: Cedar\nCedar publishes reviewed articles and tracks page impressions and clicks.";
  const claim = `Cedar publishes reviewed articles. ${"Readers can inspect their own pages before deciding what to do next. ".repeat(24)} Cedar tracks 900 page impressions.`;
  const result = validateClaimEvidenceLedger({
    markdown: claim, sources: [], researchEvidence: "", productEvidence: evidence,
    productEvidenceHash: sha256Hex(evidence),
    claimEvidence: [{ claim, citationNumbers: [], supported: true,
      reason: "The auditor incorrectly asserts support for the complete product paragraph." }],
  });
  assert.equal(result.passed, false);
  const issue = result.issues.find(issue => issue.includes("neither a matched source"))!;
  assert.match(issue, /number absent from excerpt: "900"/);
  assert.ok(issue.length < 1200);
});

test("source mismatch diagnostics are bounded without dropping additional failing sentences", () => {
  const excerpt = "The measurement report describes clicks, impressions, and position. ".repeat(4);
  const claim = Array.from({ length: 8 }, (_, i) =>
    `Invented System ${i + 100} guarantees ${"unsupported ".repeat(70)} [1].`,
  ).join(" ");
  const result = validateClaimEvidenceLedger({
    markdown: claim,
    sources: [{ url: "https://docs.example.com/report", excerpt, contentHash: sha256Hex(excerpt) }],
    researchEvidence: excerpt, productEvidence: "",
    claimEvidence: [{ claim, citationNumbers: [1], supported: true, reason: "The auditor incorrectly asserts support for all invented system details." }],
  });
  assert.equal(result.passed, false);
  const issue = result.issues.find((issue) => issue.includes("does not deterministically match"))!;
  assert.equal((issue.match(/Cited sentence:/g) ?? []).length, 3);
  assert.match(issue, /5 additional mismatched cited sentences/);
  assert.ok(issue.length < 2400);
});

test("claim ledger rejects unsupported citation-free product assertions", () => {
  const result = validateClaimEvidenceLedger({
    markdown: "The product automatically guarantees qualified pipeline growth.",
    sources: [],
    researchEvidence: "",
    productEvidence: "LeadPilot displays a chat widget and records conversations.",
    claimEvidence: [
      {
        claim: "The product automatically guarantees qualified pipeline growth.",
        citationNumbers: [],
        supported: true,
        reason: "The product evidence proves the claimed outcome.",
      },
    ],
  });
  assert.equal(result.passed, false);
  assert.match(result.issues.join(" "), /first-party evidence snapshot/i);
  assert.match(
    result.issues.join(" "),
    /automatically guarantees qualified pipeline growth/i,
  );
});

test("classifies and normalizes strict evidence sources", () => {
  for (const domain of STRICT_EVIDENCE_SEARCH_DOMAINS) {
    assert.equal(
      classifyEvidenceSource(`https://${domain}/docs`).strictEligible,
      true,
      `${domain} must remain eligible before it is sent to the primary-source search filter`,
    );
  }
  assert.equal(
    normalizeEvidenceUrl("https://developers.google.com/search/docs?utm_source=test#section"),
    "https://developers.google.com/search/docs",
  );
  assert.equal(
    classifyEvidenceSource("https://developers.google.com/search/docs").strictEligible,
    true,
  );
  assert.equal(
    classifyEvidenceSource("https://vendor.example/blog/chatbot-statistics").strictEligible,
    false,
  );
  const filtered = strictEvidenceSources([
    { url: "https://www.nber.org/papers/w12345", title: "Study" },
    { url: "https://vendor.example/blog/results", title: "Vendor blog" },
  ]);
  assert.equal(filtered.accepted.length, 1);
  assert.equal(filtered.rejected.length, 1);
});

test("documentation on a dedicated help/docs host is treated like documentation under a path", () => {
  for (const url of [
    "https://help.fiverr.com/hc/en-us/articles/23429542870161",
    "https://docs.github.com/en/actions",
    "https://docs.stripe.com/payments",
    "https://help.vendor-one.example/en/workflows",
    "https://support.vendor-two.example/articles/routing",
    "https://developers.vendor-three.example/reference/workflows",
  ]) {
    const result = classifyEvidenceSource(url);
    assert.equal(result.strictEligible, true, url);
    assert.equal(result.tier, "official-doc", "documentation must not become universal research evidence");
  }
});

test("documentation host recognition does not admit insecure URLs, community hosts or general vendor marketing", () => {
  for (const url of [
    "http://docs.vendor-one.example/reference",
    "https://docs.local/workflows",
    "https://docs.medium.com/articles/workflows",
    "https://help.blogspot.com/hc/article",
    "https://vendor-one.example/blog/research",
    "https://docs-vendor-one.example/blog/research",
    "https://vendor-two.example/?redirect=https://docs.vendor-one.example/",
  ]) assert.equal(classifyEvidenceSource(url).strictEligible, false, url);
});

test("uses format-specific people-first word ceilings", () => {
  assert.equal(articleWordCeiling("checklist"), 2400);
  assert.equal(articleWordCeiling("how-to"), 2800);
  assert.equal(articleWordCeiling("ultimate-guide"), 3600);
});

test("accepts a grounded strict article", () => {
  // A strict article must now also clear the substance floor and join a topic
  // cluster, so this canonical fixture carries the extra length and one
  // site-relative link.
  const clusterDepth = Array.from({ length: 300 }, (_, index) => `context${index}`).join(" ");
  const result = evaluatePublicationQuality(
    {
      title: "A practical website lead qualification workflow",
      metaTitle: "A practical website lead qualification workflow",
      metaDescription:
        "Use this practical workflow to answer buyer questions, assess genuine interest, and route useful sales context to the right next step.",
      markdown:
        `${body}\n\n${clusterDepth}\n\n` +
        `Related reading: [how qualification routing works](/blog/qualification-routing).\n\n` +
        `The workflow reduced review time by 12% in the documented test [1].`,
      featuredImage: "https://example.com/hero.webp",
      reviewedMediaUrls: ["https://example.com/hero.webp"],
      factCheckScore: 91,
      editorialQualityScore: 92,
      mediaQualityStatus: "passed",
      productEvidenceStatus: "not_applicable",
      claimEvidenceStatus: "passed",
      sources: [
        { url: "https://www.nber.org/papers/w12345", title: "Research" },
        { url: "https://developers.google.com/search/docs", title: "Method" },
      ],
    },
    "strict",
  );

  assert.equal(result.passed, true, result.issues.join("\n"));
});

test("accepts an evidence-complete text-first strict article without optional media", () => {
  const clusterDepth = Array.from(
    { length: 300 },
    (_, index) => `context${index}`,
  ).join(" ");
  const markdown =
    `${body}\n\n${clusterDepth}\n\n` +
    "Related reading: [qualification routing](/blog/qualification-routing).";
  const result = evaluatePublicationQuality(
    {
      title: "A practical website lead qualification workflow",
      metaTitle: "A practical website lead qualification workflow",
      metaDescription:
        "Use this practical workflow to answer buyer questions, assess genuine interest, and route useful sales context to the right next step.",
      markdown,
      factCheckScore: 91,
      editorialQualityScore: 92,
      mediaQualityStatus: publicationMediaQualityStatus({
        markdown,
        productEvidenceStatus: "not_applicable",
      }),
      productEvidenceStatus: "not_applicable",
      claimEvidenceStatus: "passed",
      sources: [
        { url: "https://www.nber.org/papers/w12345", title: "Research" },
        { url: "https://developers.google.com/search/docs", title: "Method" },
      ],
    },
    "strict",
  );

  assert.equal(result.passed, true, result.issues.join("\n"));
  assert.ok(result.warnings.some((warning) => warning.includes("No featured image")));
});

test("media review remains fail-closed for every asset that is present", () => {
  assert.equal(
    publicationMediaQualityStatus({
      markdown: "![Reviewed diagram](https://example.com/diagram.webp)",
      productEvidenceStatus: "not_applicable",
      reviewedMediaUrls: [],
    }),
    "failed",
  );
  assert.equal(
    publicationMediaQualityStatus({
      markdown: "Text-first article.",
      featuredImage: "https://example.com/hero.webp",
      productEvidenceStatus: "not_applicable",
      reviewedMediaUrls: [],
    }),
    "failed",
  );
  assert.equal(
    publicationMediaQualityStatus({
      markdown: "Text-first product article.",
      productEvidenceStatus: "failed",
    }),
    "failed",
  );
  assert.equal(
    publicationMediaQualityStatus({
      markdown: "Text-first product article.",
      productEvidenceStatus: "passed",
    }),
    "passed",
  );
});

test("rejects unsupported marketing outcomes in strict metadata and body", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A website agent that boosts conversions by 400%",
      metaDescription: "Proven software that increases revenue by 25%.",
      markdown: `${body}\n\nCustomers increase conversion by 40% after setup.`,
      featuredImage: "https://example.com/hero.webp",
      factCheckScore: 95,
      editorialQualityScore: 90,
      mediaQualityStatus: "passed",
      sources: [{ url: "https://example.com/research" }],
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("quantified outcome")));
  assert.ok(result.issues.some((issue) => issue.includes("promotional language")));
  assert.ok(result.issues.some((issue) => issue.includes("inline citation")));
});

test("rejects unsupported operational thresholds in strict articles", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A practical chatbot optimization workflow",
      metaTitle: "A practical chatbot optimization workflow",
      metaDescription:
        "Use this practical workflow to review chatbot conversations, identify repeated friction, and improve the path to a useful next step.",
      markdown: `${body}\n\nWait for 50–100 conversations and 2,000 visitor messages before changing the qualification flow.`,
      featuredImage: "https://example.com/hero.webp",
      factCheckScore: 94,
      editorialQualityScore: 91,
      mediaQualityStatus: "passed",
      sources: [
        { url: "https://www.nber.org/papers/w12345", title: "Research" },
        { url: "https://developers.google.com/search/docs", title: "Method" },
      ],
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("operational claim")));
  assert.ok(result.issues.some((issue) => issue.includes("inline citation")));
});

test("rejects stale metadata years and vendor-only evidence for numerical outcomes", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A practical lead qualification workflow",
      metaTitle: "Lead qualification workflow in 2024",
      metaDescription:
        "Use this practical workflow to answer buyer questions, assess genuine interest, and route useful context to the right next step.",
      markdown: `${body}\n\nThe workflow increased conversion by 12% [1].`,
      featuredImage: "https://example.com/hero.webp",
      factCheckScore: 93,
      editorialQualityScore: 91,
      mediaQualityStatus: "passed",
      sources: [
        { url: "https://vendor.example/blog/customer-results", title: "Vendor results" },
        { url: "https://another-vendor.example/blog/benchmarks", title: "Vendor benchmark" },
      ],
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("unsupported year 2024")));
  assert.ok(result.issues.some((issue) => issue.includes("primary or authoritative")));
});

test("rejects malformed URLs and executable scripts", () => {
  const result = evaluatePublicationQuality({
    title: "Safe article",
    metaDescription: "A safe description.",
    markdown: `${body}\n<script>alert(1)</script>\nhttps://https://example.com\n<iframe src="https://attacker.example/embed"></iframe>`,
    sources: [{ url: "http://localhost/source" }],
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("script tag")));
  assert.ok(result.issues.some((issue) => issue.includes("duplicated URL")));
  assert.ok(result.issues.some((issue) => issue.includes("source URL")));
  assert.ok(result.issues.some((issue) => issue.includes("unsupported iframe")));
});

test("validates contextual internal-link suggestions against crawled pages", () => {
  const links = validateInternalLinkSuggestions(
    [
      { anchor: "Blog", href: "/blog" },
      { anchor: "lead qualification workflow", href: "/#features" },
      { anchor: "LeadPilot pricing options", href: "/#pricing" },
      { anchor: "external destination", href: "https://example.com" },
      { anchor: "current article guide", href: "/current-article" },
    ],
    ["/blog", "/#features", "/#pricing", "/current-article"],
    "/current-article",
  );

  assert.deepEqual(links, [
    { anchor: "lead qualification workflow", href: "/#features" },
    { anchor: "LeadPilot pricing options", href: "/#pricing" },
  ]);
});

test("defers only the exact internal-link gate until final prose resealing", () => {
  assert.deepEqual(
    issuesBlockingPreLinkReview([
      PENDING_INTERNAL_LINK_ISSUE,
      "Fact-check score is below the strict minimum.",
    ]),
    ["Fact-check score is below the strict minimum."],
  );
  assert.deepEqual(
    issuesBlockingPreLinkReview(["Article has only one internal link."]),
    ["Article has only one internal link."],
  );
});

test("builds safe related-article links from each tenant publication path", () => {
  assert.equal(
    publishedArticleInternalHref(
      "/resources/[slug]",
      "lead-qualification-workflow",
    ),
    "/resources/lead-qualification-workflow",
  );
  assert.throws(
    () => publishedArticleInternalHref("/blog/[slug]", "../admin"),
    /safe path segment/,
  );
  assert.throws(
    () => publishedArticleInternalHref("/blog/[slug]?preview=1", "article"),
    /safe \[slug\]/,
  );
});

test("derives bounded exact anchors for a measured parent article", () => {
  const anchors = preferredInternalLinkAnchorCandidates(
    "How to Build a Website Lead Qualification Workflow That Converts",
    ["website lead qualification"],
  );
  assert.equal(
    anchors[0],
    "How to Build a Website Lead Qualification Workflow",
  );
  assert.ok(
    anchors.some((anchor) => anchor.toLowerCase() === "website lead qualification"),
  );
  assert.ok(anchors.every((anchor) => anchor.split(/\s+/).length <= 8));
});

test("adds deterministic same-tenant related reading when exact prose has no anchor", () => {
  const links = selectRelatedInternalLinks({
    currentTitle: "CRM Chatbot Integration for Sales Teams",
    currentKeywords: ["crm chatbot", "sales automation"],
    destinations: [
      {
        href: "/blog/crm-workflow-automation",
        title: "CRM Workflow Automation for Sales",
        keywords: ["crm workflow", "sales automation"],
      },
      {
        href: "/blog/office-furniture",
        title: "Office Furniture Maintenance",
        keywords: ["wooden desks"],
      },
    ],
  });
  assert.deepEqual(links, [
    {
      anchor: "CRM Workflow Automation for Sales",
      href: "/blog/crm-workflow-automation",
    },
  ]);

  const appended = appendRelatedInternalLinks(
    "# CRM integration\n\nUseful approved prose.\n\n## Sources\n\n- Source",
    links,
  );
  assert.equal(appended.inserted.length, 1);
  assert.match(
    appended.markdown,
    /## Related reading[\s\S]*\/blog\/crm-workflow-automation[\s\S]*## Sources/,
  );
});

test("rebuilding generated links removes stale internal anchors but preserves external citations", () => {
  const markdown = [
    "Use [tools and](/blog/old) compare this with [official guidance](https://example.com/source).",
    "",
    "## Related reading",
    "",
    "- [Old article](/blog/old)",
    "",
    "## Sources",
    "",
    "1. [Official guidance](https://example.com/source)",
  ].join("\n");
  assert.equal(
    stripGeneratedInternalLinks(markdown),
    [
      "Use tools and compare this with [official guidance](https://example.com/source).",
      "",
      "## Sources",
      "",
      "1. [Official guidance](https://example.com/source)",
      "",
    ].join("\n"),
  );
});

test("injects links only into eligible article prose", () => {
  const markdown = [
    "# Lead qualification workflow",
    "",
    "## Table of Contents",
    "",
    "- [Lead qualification workflow](#workflow)",
    "",
    "## Workflow",
    "",
    "A lead qualification workflow helps sales teams route serious buyers.",
    "",
    "An [existing qualification guide](https://example.com/guide) stays intact.",
    "",
    "`lead qualification workflow` remains code.",
    "",
    "## Sources",
    "",
    "[1] Blog source — https://blog.happyfox.com/lead-qualification-workflow/",
  ].join("\n");

  const result = injectInternalLinks(markdown, [
    { anchor: "lead qualification workflow", href: "/#features" },
    { anchor: "Blog source", href: "/blog" },
  ]);

  assert.equal(result.inserted.length, 1);
  assert.match(
    result.markdown,
    /A \[lead qualification workflow\]\(\/#features\) helps sales teams/,
  );
  assert.match(result.markdown, /https:\/\/blog\.happyfox\.com\/lead-qualification-workflow\//);
  assert.doesNotMatch(result.markdown, /https:\/\/\[Blog\]/);
  assert.match(result.markdown, /`lead qualification workflow` remains code/);
});

test("publication quality blocks markdown inserted inside an external URL", () => {
  const result = evaluatePublicationQuality({
    title: "Safe article",
    metaDescription: "A safe description.",
    markdown: `${body}\n\nhttps://[Blog](/blog).example.com/source`,
    sources: [{ url: "https://example.com/source" }],
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("inside an external URL")));
});

test("strict publication requires editorial and media review signals", () => {
  const result = evaluatePublicationQuality(
    {
      title: "A grounded article",
      metaDescription: "A useful description for a grounded article.",
      markdown: body,
      factCheckScore: 93,
      sources: [{ url: "https://example.com/source" }],
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("editorial review")));
  assert.ok(result.issues.some((issue) => issue.includes("media-quality")));
});

test("strict publication blocks overlong non-guide articles", () => {
  const result = evaluatePublicationQuality(
    {
      title: "An overlong how-to",
      articleType: "how-to",
      metaDescription: "A practical but unnecessarily long how-to article.",
      markdown: Array.from({ length: 3500 }, (_, index) => `word${index}`).join(" "),
      factCheckScore: 93,
      editorialQualityScore: 91,
      mediaQualityStatus: "passed",
    },
    "strict",
  );

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("overlong")));
});

test("publication quality blocks malformed tables and multiple videos", () => {
  const result = evaluatePublicationQuality({
    title: "Broken media article",
    metaDescription: "An article with structurally broken rich content.",
    markdown: `${body}\n\n| Column one | Column two | Value | Extra |\n\n<div><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></div>\n<div><iframe src="https://www.youtube.com/embed/lmnopqrstuv"></iframe></div>`,
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("separator row")));
  assert.ok(result.issues.some((issue) => issue.includes("maximum is one")));
});

test("custom hero style cannot remove hard truthfulness constraints", () => {
  const prompt = buildHeroImagePrompt({
    title: "Lead qualification workflow",
    niche: "sales software",
    brandingPrompt: "Bright orange editorial lighting",
    brandColor: "#F97316",
  });

  assert.match(prompt, /Bright orange editorial lighting/);
  assert.match(prompt, /Do not include text/);
  assert.match(prompt, /Do not invent or imitate a product interface/);
});

test("inserts one verified video after its exact relevant section", () => {
  const markdown = [
    "# Guide",
    "",
    "## Qualification questions",
    "",
    "Ask concise questions.",
    "",
    "## Next steps",
    "",
    "Route the buyer.",
  ].join("\n");
  const result = insertYouTubeAfterSection(markdown, {
    videoId: "abcdefghijk",
    title: "Qualification questions explained",
    sectionHeading: "Qualification questions",
  });

  assert.equal((result.match(/youtube-nocookie\.com\/embed/g) ?? []).length, 1);
  assert.ok(result.indexOf("youtube-nocookie.com/embed") < result.indexOf("## Next steps"));
});

test("grounds a supporting visual in an exact article section", () => {
  const prompt = buildSupportingImagePrompt({
    title: "Lead qualification guide",
    primaryKeyword: "lead qualification framework",
    niche: "sales software",
    sectionHeading: "Separate fit from buying intent",
    visualConcept: "Two distinct paths that converge only for qualified buyers",
  });
  assert.match(prompt, /Separate fit from buying intent/);
  assert.match(prompt, /Two distinct paths/);
  assert.match(prompt, /not an infographic/i);
  assert.match(prompt, /Do not include text/);

  const markdown = [
    "# Guide",
    "",
    "## Separate fit from buying intent",
    "",
    "Fit and intent answer different questions.",
    "",
    "## Next step",
    "",
    "Route qualified buyers.",
  ].join("\n");
  const result = insertImageUnderSection(
    markdown,
    "Separate fit from buying intent",
    "![Qualified buyer paths](https://example.com/image.webp)",
  );
  assert.ok(result.indexOf("image.webp") < result.indexOf("Fit and intent"));
  assert.equal(
    insertImageUnderSection(markdown, "Missing heading", "![x](https://example.com/x)"),
    markdown,
  );
});

test("malformed strict tool output receives one bounded schema correction", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const structured = pipeline.slice(
    pipeline.indexOf("async function callClaudeStructured"),
    pipeline.indexOf("async function fetchHtml"),
  );
  assert.match(structured, /for \(let attempt = 0; attempt < 2;/);
  assert.match(structured, /outputSchema\.safeParse\(toolUse\.input\)/);
  assert.match(structured, /failed schema validation; retrying once/);
  assert.doesNotMatch(structured, /attempt < 3/);
});

test("review improvement is monotonic across editorial, factual and evidence dimensions", () => {
  const baseline = { editorialScore: 82, factualScore: 92, evidenceDefects: 2, materialDefects: 2 };
  assert.equal(articleReviewImprovesWithoutRegression(baseline, baseline), false);
  for (const improvement of [
    { editorialScore: 84 }, { factualScore: 95 }, { evidenceDefects: 1 }, { materialDefects: 1 },
  ]) assert.equal(articleReviewImprovesWithoutRegression(baseline, { ...baseline, ...improvement }), true);
  for (const regression of [
    { editorialScore: 81, factualScore: 99 }, { editorialScore: 84, factualScore: 85 },
    { editorialScore: 84, evidenceDefects: 3 }, { editorialScore: 84, materialDefects: 3 },
  ]) assert.equal(articleReviewImprovesWithoutRegression(baseline, { ...baseline, ...regression }), false);
  for (const field of Object.keys(baseline)) {
    for (const invalid of [NaN, Infinity, -1]) {
      assert.equal(articleReviewImprovesWithoutRegression(baseline, { ...baseline, [field]: invalid }), false);
      assert.equal(articleReviewImprovesWithoutRegression({ ...baseline, [field]: invalid }, baseline), false);
    }
  }
  assert.equal(articleReviewImprovesWithoutRegression(baseline, { ...baseline, factualScore: 101 }), false);
  assert.equal(articleReviewImprovesWithoutRegression(baseline, { ...baseline, evidenceDefects: 0.5 }), false);
});

test("generation and both recovery selection points share the non-regression rule", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const recoveryStart = pipeline.indexOf("async function reviewExistingArticleHandler");
  assert.equal((pipeline.slice(0, recoveryStart).match(/articleReviewImprovesWithoutRegression\(\{/g) ?? []).length, 1);
  assert.equal((pipeline.slice(recoveryStart).match(/articleReviewImprovesWithoutRegression\(\{/g) ?? []).length, 2);
  assert.match(pipeline, /!recoveryBaseline \|\| postAuditPass <= 1/);
});
