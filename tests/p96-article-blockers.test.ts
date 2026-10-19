import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMetaDescription,
  codeTagsInSourceLabels,
  containsExecutableMdx,
  evaluatePublicationQuality,
} from "../convex/lib/articleQuality.ts";
import { deleteSentencesCoherently } from "../convex/lib/coherentDeletion.ts";
import { renderSafePublicationHtml } from "../convex/lib/safeMarkdownHtml.ts";
import { pasteHtmlFromMarkdown } from "../src/lib/paste-html.ts";

const SCRIPT_ISSUE = "Article contains a script tag; structured data belongs in the renderer.";
const RAW_ISSUE = "Raw HTML and executable MDX are disabled in publication content.";
const gate = (markdown: string) => evaluatePublicationQuality({ title: "Add a chat widget in HTML", markdown }, "strict").issues;

// LeadPilot /chat-widget-html (Oct 18 23:40Z): fact 100, ed 72, ledger passed,
// held only by these two gates. Its <script> lines are inside a fenced block
// and inline code; the writer also copied MDN page titles into Sources.
const howTo = [
  "A chat widget in HTML is usually one `<script>` tag, and some vendors offer an `<iframe>` instead.",
  "",
  "## Paste the snippet",
  "",
  "```html",
  '<script src="https://widget.example.com/embed.js" data-agent="your-key"></script>',
  "```",
  "",
  "Paste it once, just before the closing body tag.",
  "",
  "## Sources",
  "",
  "1. [Embed Chat Widget](https://chipp.ai/docs/guides/embed-widget)",
  "2. [<script> HTML script element - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script)",
  "3. [<iframe> HTML inline frame element - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)",
].join("\n");

test("P96 a how-to whose script tags are only code examples passes both markup gates", () => {
  const repaired = codeTagsInSourceLabels(howTo);
  assert.match(repaired, /2\. \[`<script>` HTML script element - MDN Web Docs\]\(https:\/\/developer\.mozilla\.org/);
  assert.match(repaired, /3\. \[`<iframe>` HTML inline frame element/);
  assert.equal(repaired.split("## Sources")[0], howTo.split("## Sources")[0], "body prose and code are never changed");
  const issues = gate(repaired);
  assert.equal(issues.includes(SCRIPT_ISSUE), false, JSON.stringify(issues));
  assert.equal(issues.includes(RAW_ISSUE), false, JSON.stringify(issues));
  // Without the label repair the raw MDX gate still (correctly) blocks it.
  assert.ok(gate(howTo).includes(RAW_ISSUE));
});

test("P96 real markup outside code stays blocked exactly as before", () => {
  const body = "Paste the snippet below.\n\n";
  for (const [markdown, issue] of [
    [`${body}<script src="https://widget.example.com/embed.js"></script>`, SCRIPT_ISSUE],
    [`${body}<script type="application/ld+json">{"@type":"Article"}</script>`, SCRIPT_ISSUE],
    [`${body}<iframe src="https://widget.example.com/frame"></iframe>`, RAW_ISSUE],
    [`${body}<img src="https://x.example/a.png" onerror="alert(1)">`, RAW_ISSUE],
    [`${body}{process.env.SECRET}`, RAW_ISSUE],
    [`${body}import Widget from "./widget"`, RAW_ISSUE],
    // An unclosed fence is not code.
    [`${body}\`\`\`html\n<script src="https://widget.example.com/embed.js"></script>\n`, SCRIPT_ISSUE],
    // Template syntax still expands inside code.
    [`${body}\`\`\`liquid\n{{ product.title }}\n\`\`\``, RAW_ISSUE],
    // A tag in body link text (not a Sources row) is not repaired.
    [codeTagsInSourceLabels(`${body}Read [<script> basics](https://developer.mozilla.org/x) first.`), RAW_ISSUE],
  ] as const) {
    assert.ok(gate(markdown).includes(issue), `${issue} expected for: ${markdown.slice(body.length, body.length + 70)}`);
  }
  assert.equal(containsExecutableMdx("Use `<title>` and\n\n```html\n<meta name=\"description\">\n```"), false);
});

test("P96 every publisher outputs code examples as literal code, never live markup", () => {
  const markdown = codeTagsInSourceLabels(howTo);
  // WordPress, Shopify, Webflow, Ghost and the webhook html field share this renderer.
  const html = renderSafePublicationHtml(markdown);
  assert.match(html, /&#x3C;script src="https:\/\/widget\.example\.com\/embed\.js"|&lt;script src=(?:"|&quot;)https:\/\/widget\.example\.com\/embed\.js/);
  assert.doesNotMatch(html, /<script|<iframe/i);
  // Manual destinations: the owner's "Copy HTML" button.
  const pasted = pasteHtmlFromMarkdown(markdown);
  assert.match(pasted, /<pre><code class="language-html">&lt;script src=&quot;https:\/\/widget\.example\.com\/embed\.js&quot;/);
  assert.match(pasted, /<code>&lt;iframe&gt;<\/code>/);
  assert.doesNotMatch(pasted, /<script|<iframe/i);
  assert.doesNotMatch(pasteHtmlFromMarkdown("[click](javascript:alert(1)) and <img src=x onerror=alert(1)>"), /<a |<img/);
  assert.match(pasteHtmlFromMarkdown("## Title\n\nSee [docs](https://example.com/a?b=1&c=2)."), /<h2>Title<\/h2>[\s\S]*<a href="https:\/\/example\.com\/a\?b=1&amp;c=2">docs<\/a>/);
});

test("P96 an over-long meta description is cut at a sentence or clause, never mid-thought", () => {
  // /local-seo-ranking-diagnose-position (Oct 18 23:38Z) shipped "...for finding whether your."
  const long = "This guide proposes a baseline check and a working model, which is the author's own suggestion rather than an established rule, for finding whether your listing or your website is the gap.";
  const clamped = clampMetaDescription(long)!;
  assert.equal(clamped, "This guide proposes a baseline check and a working model, which is the author's own suggestion rather than an established rule.");
  assert.ok(clamped.length >= 100 && clamped.length <= 155);
  const sentences = "Learn how a rank monitor reads Search Console position data, why a manual search differs, and what each figure means. Then run a weekly check that flags slipping pages.";
  assert.equal(clampMetaDescription(sentences), "Learn how a rank monitor reads Search Console position data, why a manual search differs, and what each figure means.");
  // Already short enough but ending on a function word: the word goes and the gate agrees.
  assert.equal(clampMetaDescription("A baseline check and a working model for diagnosing local rankings, written so you can test whether your"), "A baseline check and a working model for diagnosing local rankings, written so you can test.");
  const dangling = evaluatePublicationQuality({ title: "Local SEO", markdown: "x", metaDescription: "A baseline check and a working model for diagnosing local rankings, so you can finally test whether your." }, "strict").issues;
  assert.ok(dangling.includes("Meta description ends with a dangling or incomplete phrase."));
});

test("P96 deleting an unsupported sentence never removes a paragraph's bold step label", () => {
  const drop = (sentence: string) => /3 to 4 weeks/.test(sentence);
  // /best-chat-widgets (Oct 18): "Step 2" vanished and the test design jumped from Step 1 to Step 3.
  const md = [
    "**Step 1: Pick the pages.** Choose pages where a conversation could change the outcome.",
    "",
    "**Step 2: Write the question list.** Include a timeline question such as a 3 to 4 weeks turnaround. Add a few that your site cannot answer.",
    "",
    "**Step 3: Define outcomes in advance.** Decide what counts as success.",
  ].join("\n");
  const partial = deleteSentencesCoherently(md, drop);
  assert.equal(partial.markdown, md, "the sentence carrying the label is held for the writer");
  assert.equal(partial.held.length, 1);
  // A whole paragraph under a numbered bold label is never dropped either.
  const whole = md.replace(" Add a few that your site cannot answer.", "");
  const result = deleteSentencesCoherently(whole, drop);
  assert.match(result.markdown, /\*\*Step 2: Write the question list\.\*\*/);
  assert.equal(result.removed.length, 0);
  // Unlabelled paragraphs are still repaired by deletion.
  const plain = "Choose the pages first. Include a 3 to 4 weeks turnaround. Add a few questions your site cannot answer.";
  assert.equal(deleteSentencesCoherently(plain, drop).markdown, "Choose the pages first. Add a few questions your site cannot answer.");
});
