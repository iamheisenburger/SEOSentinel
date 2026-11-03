// P304 (Nov 3 2026, batch 9): the required item reaches its owner, the list's width is the union of what every kept page
// names, a rebate or credit exists only from the program's own page, and a quoted fragment lands mid-sentence in the
// sentence's case. Every pin rehearses the stored batch-8 evidence (ops/data/judge-batch/batch8) without live calls.
import test from "node:test";
import assert from "node:assert/strict";
import { missingFigureItems } from "../convex/lib/researchPasses.ts";
import { namesInText } from "../convex/lib/serpBrief.ts";
import { proseParagraphs, verifiedRecords } from "../convex/lib/articleAssembly.ts";

test("P304 an item is covered only where a source has its rarest term (batch 8's Denver permit and insurance items)", () => {
  const costPage = { title: "Denver roof costs", excerpt: "Denver roof replacement costs on average $4 to $11 per square foot, a typical range. The actual cash value versus replacement cost coverage matters to your insurer's roof-age rules. Timeline: one week. $150 permit mention." };
  // "permit" appears in 0 sources, "insurance" in 0: both items must reach the owner lookup even though a cost page says
  // "coverage", "cash value" and "$" near them — batch 8 skipped both and the sections came out empty.
  const sources = [costPage, { title: "More costs", excerpt: "Denver asphalt shingle roof costs $7,400 to $16,500 installed; metal runs $10,500." }];
  const coverage = [
    "Average total installed cost range for a Denver asphalt shingle roof and the typical cost per square",
    "Whether a Denver re-roof requires a building permit and its fee, from the City and County of Denver's permit office",
    "Insurance coverage facts: replacement cost versus actual cash value, deductible, and roof-age considerations",
  ];
  const missing = missingFigureItems(coverage, sources, []);
  assert.ok(missing.some((m) => /permit/i.test(m)), "the permit item is searched on its owner's site");
  assert.ok(missing.some((m) => /insurance/i.test(m)), "the insurance item too");
  assert.ok(!missing.some((m) => /Average total installed cost/i.test(m)), "a cost item backed by figures stays out");
});

test("P304 a list's seed options include the names inside listicle prose ('Vagaro offers…', 'WellnessLiving offers…')", () => {
  const text = [
    "Scheduling for Small Studios Vagaro offers one of the most affordable entry points for yoga studio scheduling.",
    "WellnessLiving offers clear, tiered subscription plans: Starter at around $69/month Business approximately $199/month.",
    "Core features at predictable prices. approximately $199/month. The starter is $69.",
  ].join("\n");
  const names = namesInText(text);
  assert.ok(names.includes("Vagaro"), JSON.stringify(names));
  assert.ok(names.includes("WellnessLiving"), JSON.stringify(names));
  assert.deepEqual(namesInText("approximately $199/month. Standard $25 applies. Pricing Core features"), [], "price-context words are never names");
});

test("P304 a rebate or tax credit exists only from the program's own page (the 25C caps from a tax-software blog)", () => {
  const credit = (subject: string) => [{ section: "Rebates", subject, kind: "rebate", label: "Federal credit", value: "up to $2,000",
    quote: "The credit is worth up to $2,000", source: 1 }];
  const ctx = (url: string, excerpt: string) => ({ sources: [{ url, title: "T", excerpt }], profile: "", productName: "Northwind", competitors: [], sections: ["Rebates"] });
  const blog = verifiedRecords({ options: [], faqs: [], facts: credit("federal tax credit") },
    ctx("https://support.taxslayer.com/hc/en-us/articles/5695", "The credit is worth up to $2,000 for qualifying property placed in service."));
  assert.equal(blog.facts.length, 0, "a third party's credit figure never prints");
  assert.ok(blog.dropped.some((d) => /not from the program's own page/.test(d)));
  const gov = verifiedRecords({ options: [], faqs: [], facts: credit("federal tax credit") },
    ctx("https://www.energystar.gov/about/federal-tax-credits", "The credit is worth up to $2,000 for qualifying property."));
  assert.equal(gov.facts.length, 1, "the program's own page states it");
  const utility = verifiedRecords({ options: [], faqs: [], facts: [{ section: "Rebates", subject: "tankless rebate", kind: "rebate",
    label: "Utility rebate", value: "$400 rebate", quote: "Texas Gas Service pays a $400 rebate for qualifying tankless water heaters", source: 1 }] },
    ctx("https://www.texasgasservice.com/rebates", "Texas Gas Service pays a $400 rebate for qualifying tankless water heaters."));
  assert.equal(utility.facts.length, 1, "the paying utility's own page states it");
});

test("P304 a quoted fragment landing mid-sentence follows the sentence's case (batch 8's glued capitals)", () => {
  const pool = { r1: { display: "Automated waitlists, plus late-cancel and no-show fee handling", source: 1, label: "features" } };
  const mid = proseParagraphs("Good software also deals with {{r1}} for you.", { pool, scope: [], used: new Map(), allowedText: "software waitlists cancel handling" });
  assert.equal(mid.kept, "Good software also deals with automated waitlists, plus late-cancel and no-show fee handling [1] for you.");
  const start = proseParagraphs("{{r1}} protect class revenue.", { pool, scope: [], used: new Map(), allowedText: "waitlists cancel handling revenue" });
  assert.match(start.kept, /^Automated waitlists/, "a fragment opening its sentence keeps its capital");
});
