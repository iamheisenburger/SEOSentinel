import assert from "node:assert/strict";
import test from "node:test";
import { citedCompanyName } from "../convex/lib/sourceQuality.ts";
import { autopilotCompanyNameIssue, autopilotCompanyNameNote, unsearchedCompanyMentions } from "../convex/lib/autopilotEditor.ts";
import { ownerWaivableIssue } from "../convex/lib/articleQuality.ts";

// P162 (Oct 22 2026): a LeadPilot draft on lead scoring for marketing teams kept one source, Salesforce's help page,
// and named Salesforce three times with its edition list, though its search names no company (V1).
test("the company behind a cited vendor page is known; research, standards and Google are not companies to avoid", () => {
  assert.equal(citedCompanyName("https://help.salesforce.com/s/articleView?id=mktg.pardot_einstein_leads.htm"), "salesforce");
  assert.equal(citedCompanyName("https://knowledge.hubspot.com/scoring/understand-the-lead-scoring-tool"), "hubspot");
  assert.equal(citedCompanyName("https://developers.google.com/search/docs"), null);
  assert.equal(citedCompanyName("https://www.census.gov/data"), null);
  assert.equal(citedCompanyName("https://pubmed.ncbi.nlm.nih.gov/123/"), null);
});

test("sentences naming a cited company the search does not name are found; named, own and source-list mentions are not", () => {
  const markdown = [
    "Lead scoring ranks leads by fit and intent.",
    "Salesforce describes its own scoring feature in the same terms: it generates insights based on lead fields [1].",
    "The same documentation lists required editions: Account Engagement Advanced and Premium Editions with Salesforce Enterprise [1].",
    "LeadPilot asks one question at a time.",
    "Read the [Salesforce guide](https://help.salesforce.com/s/articleView) for details.",
    "## Sources",
    "[1] Einstein Lead Scoring — https://help.salesforce.com/s/articleView",
  ].join("\n\n");
  const companies = [citedCompanyName("https://help.salesforce.com/s/articleView")];
  const found = unsearchedCompanyMentions(markdown, companies, { search: "lead scoring marketing", business: ["LeadPilot", "leadpilot"] });
  assert.deepEqual(found.map((m) => m.company), ["salesforce", "salesforce", "salesforce"]);
  assert.equal(found[2].sentence, "Read the [Salesforce guide] for details.", "a link's visible text counts; its target does not");
  assert.match(found[0].sentence, /^Salesforce describes/);
  assert.equal(unsearchedCompanyMentions(markdown, companies, { search: "lead scoring in salesforce", business: ["LeadPilot"] }).length, 0,
    "a search that names Salesforce may name it");
  assert.equal(unsearchedCompanyMentions(markdown, [citedCompanyName("https://leadpilot.chat/docs")], { search: "lead scoring", business: ["LeadPilot", "leadpilot"] }).length, 0,
    "the business itself is never another company");
  assert.equal(unsearchedCompanyMentions("No company here.\n\n## Sources\n\n[1] Salesforce — https://help.salesforce.com/x", companies,
    { search: "lead scoring", business: ["LeadPilot"] }).length, 0, "the Sources list is not prose");
});

test("the edit pass is raised, never waived, and tells the rewrite what to keep", () => {
  const issue = autopilotCompanyNameIssue(3);
  assert.equal(issue, "Autopilot edit pass: 3 sentence(s) name a company the search does not name.");
  assert.equal(ownerWaivableIssue(issue, { markdown: "" }), false);
  assert.match(autopilotCompanyNameNote("salesforce", "Salesforce describes it [1]."),
    /^Rewrite without naming Salesforce, which the search does not name: «Salesforce describes it \[1\]\.»\. Keep the fact and its citation/);
});
