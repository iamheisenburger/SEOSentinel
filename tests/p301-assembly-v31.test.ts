// P301 (Nov 3 2026, v3.1, ops/ZCODE-PROPOSAL-V31.md + Cowork's batch 6 order): records decide facts, placeholders carry them
// into prose. Pins: expired programs drop (R9); prices exist only from a vendor's own page (R10); the local authority's
// figure wins a psi conflict (R8); citations renumber after deletion (A4); a paragraph is the deletion unit (A2); a
// paragraph that states a raw figure or talks about the article goes whole; an unreferenced section fact falls back to one
// plain line; the intro may finally state the headline fact.
import test from "node:test";
import assert from "node:assert/strict";
import { assembledArticle, endedProgram, proseParagraphs, skeletonFor, verifiedRecords, LIST_HEADING_GUARD } from "../convex/lib/articleAssembly.ts";
import { backedFactsOnly, rebuildSourcesSection } from "../convex/lib/backedFacts.ts";

const now = Date.UTC(2026, 10, 3);

test("P301 R9: a record whose quote or value states a program that ended is dropped (the 25C credit ended Dec 31 2025)", () => {
  assert.equal(endedProgram("30% federal tax credit", "Homeowners who installed qualifying equipment in 2023 through 2025 could claim a credit", now), true);
  assert.equal(endedProgram("Rebate", "The program expired and rebate offerings are no longer available", now), true);
  assert.equal(endedProgram("Rebate", "Texas Gas Service pays a $400 rebate for qualifying equipment", now), false);
  assert.equal(endedProgram("Pino", "Pino logs at level 30 by default since 2016", now), false, "a start date is not an end");
  assert.equal(endedProgram("Valid", "Offer runs through December 31, 2027", now), false);
  const sources = [{ url: "https://www.energystar.gov/credits", title: "Energy Star", excerpt: "The credit for energy efficient home improvements was available for property placed in service from January 1, 2023 through December 31, 2025." }];
  const v = verifiedRecords({ options: [], facts: [{ section: "Rebates", subject: "tax credit", kind: "rebate", label: "Federal tax credit",
    value: "30% of the cost, up to $600", quote: "from January 1, 2023 through December 31, 2025", source: 1 }], faqs: [] },
    { sources, profile: "", productName: "Northwind", competitors: [], sections: ["Rebates"], now });
  assert.equal(v.facts.length, 0, "an ended program never reaches the article");
  assert.ok(v.dropped.some((d) => /has ended/.test(d)));
});

test("P301 R10: a price exists only from the option's own page; a third party's price never shows", () => {
  const sources = [
    { url: "https://zapro.ai/xero-pricing", title: "Xero pricing guide", excerpt: "Xero plans range from $25 to $90 per organization per month." },
    { url: "https://www.xero.com/pricing", title: "Xero pricing", excerpt: "Early $27 per month. Send quotes and 20 invoices." },
  ];
  const v = verifiedRecords({ options: [{ name: "Xero", website: "", prices: [
      { plan: "", price: "$25 to $90", billing: "per organization per month", quote: "Xero plans range from $25 to $90 per organization per month", source: 1 },
      { plan: "Early", price: "$27", billing: "per month", quote: "Early $27 per month", source: 2 }],
    features: [{ text: "sends quotes and 20 invoices", quote: "Send quotes and 20 invoices", source: 2 }], limits: [] }], facts: [], faqs: [] },
    { sources, profile: "", productName: "Tallybook", competitors: [], sections: [], now });
  assert.deepEqual(v.options[0].prices.map((p) => p.price), ["$27"], "only the vendor's own price record survives");
  assert.ok(v.dropped.some((d) => /not from its own page/.test(d)));
});

test("P301 R8: in a unit conflict the .gov figure wins; with no authority both sourced figures stay", () => {
  const gov = { text: "Colorado State University Extension: never exceed 50 psi when blowing out polyethylene pipe.", url: "https://extension.colostate.edu/docs/yard/heat.pdf" };
  const maker = { text: "Rain Bird: regulate the compressor to 75-85 psi for most residential systems.", url: "https://www.rainbird.com/blog" };
  const input = { sources: [gov, maker], profile: "", allowedNames: ["Greenline"], topic: "how to winterize a sprinkler system" };
  const out = backedFactsOnly([
    "Regulate the compressor to 75-85 psi [2].",
    "Never exceed 50 psi when blowing out polyethylene pipe [1].",
  ].join("\n\n"), input);
  assert.doesNotMatch(out.markdown, /75-85 psi/);
  assert.match(out.markdown, /50 psi/);
  assert.ok(out.removed.some((r) => r.reason === "number"), "the conflict is removed as an unbacked figure");
  const blogs = { sources: [{ text: "A blog says 40 psi is enough.", url: "https://blog1.example" }, { text: "Another blog says 60 psi works.", url: "https://blog2.example" }],
    profile: "", allowedNames: ["Greenline"], topic: "how to winterize a sprinkler system" };
  const both = backedFactsOnly("One guide says to use 40 psi [1]. Another says 60 psi works [2].", blogs);
  assert.equal(both.markdown, "One guide says to use 40 psi [1]. Another says 60 psi works [2].", "no authority: the conflict is shown, not picked");
});

test("P301 A4: citation numbers stay stable and the Sources list is rebuilt canonically from the article's sources", () => {
  // Batch 7's first run renumbered the body by first use while the stored sources array kept research order: every shifted
  // citation then failed the cited-number check against the wrong source. Numbers are now stable — [n] is always the n-th
  // source of the array — and the tail is rebuilt from that array (batch 6's skipped [3] also cannot happen).
  const sources = [
    { url: "https://getpino.io", title: "Pino docs" },
    { url: "https://urllib3.readthedocs.io/util.html", title: "urllib3 utilities" },
    { url: "https://unused.example", title: "Unused page" },
    { url: "https://urllib3.readthedocs.io/retry.html", title: "urllib3 retry module" },
  ];
  const article = [
    "Pino logs at level 30 [1]. urllib3 retries with backoff [4].",
    "",
    "## Sources",
    "",
    "- [1] [Pino docs](https://getpino.io)",
    "- [4] [urllib3 retry module](https://urllib3.readthedocs.io/retry.html)",
  ].join("\n");
  const out = rebuildSourcesSection(article, sources);
  assert.match(out, /Pino logs at level 30 \[1\]/);
  assert.match(out, /urllib3 retries with backoff \[4\]/, "body numbers never shift");
  assert.doesNotMatch(out, /- \[1\]/, "the writer's gapped tail is replaced");
  // P379: after a gap the list restarts with the other delimiter ("4)"), so Markdown shows 4, not 2.
  assert.match(out, /## Sources\n\n1\. \[Pino docs\]\(https:\/\/getpino\.io\)\n4\) \[urllib3 retry module\]\(https:\/\/urllib3\.readthedocs\.io\/retry\.html\)\n$/,
    "P335: cited entries keep their numbers; never-cited entries are omitted from the tail");
  assert.equal(rebuildSourcesSection("No citations here.", sources), "No citations here.", "nothing cited: unchanged");
});

test("P301 prose: a placeholder fills with its value and citation; a raw figure, an unknown record or talk about the article drops the paragraph whole", () => {
  const pool = { r1: { display: "$7,400 to $16,500", source: 1, label: "Denver cost range" } };
  const used = new Map<string, number>();
  const kept = proseParagraphs("Most Denver homeowners pay between {{r1}} for a full replacement, and the price climbs with pitch and layers.",
    { pool, scope: [], used, allowedText: "Most Denver homeowners pay between for a full replacement and the price climbs with pitch and layers. Denver" });
  assert.equal(kept.kept, "Most Denver homeowners pay $7,400–$16,500 [1] for a full replacement, and the price climbs with pitch and layers."); // P311: dash form keeps both currencies
  const raw = proseParagraphs("Most homeowners pay about $10,000 in total.", { pool, scope: [], used, allowedText: "Denver $10,000" });
  assert.equal(raw.kept, "", "a figure written in the model's own words never prints");
  const unknown = proseParagraphs("See the details at {{r9}}.", { pool, scope: [], used, allowedText: "" });
  assert.equal(unknown.kept, "", "a placeholder with no record drops its paragraph");
  for (const meta of ["This block covers the permit rule that applies.", "The table below shows the costs for each material.", "The point below shows how one tool handles it."]) {
    const out = proseParagraphs(meta, { pool, scope: [], used, allowedText: "permit rule costs material tool" });
    assert.equal(out.kept, "", `batch 6's meta lead-ins never print: "${meta}"`);
  }
  const twice = proseParagraphs("Again, the range sits at {{r1}} for most homes.", { pool, scope: [], used: new Map([["r1", 1]]), allowedText: "Denver" });
  assert.equal(twice.kept, "", "a fact used twice before drops its paragraph");
});

test("P301 assembly: the intro states the headline fact by placeholder, and an unreferenced section fact falls back to one plain line", () => {
  const sources = [
    { url: "https://303roofer.com/cost", title: "Denver roof costs", excerpt: "Most Denver homeowners pay between $7,400 and $16,500 for a full roof replacement. Per square foot, asphalt costs $4 to $6 and the quote is: asphalt $4 to $6." },
    { url: "https://denvergov.org/permits", title: "Denver quick permits", excerpt: "All repairs that are more than 10% of the roof square footage or two roof squares (whichever is smaller) require a roof permit." },
  ];
  const v = verifiedRecords({ options: [], facts: [
      { section: "What a roof replacement costs in Denver", subject: "Denver cost range", kind: "cost", label: "Typical total cost", value: "between $7,400 and $16,500",
        quote: "Most Denver homeowners pay between $7,400 and $16,500", source: 1 },
      { section: "What a roof replacement costs in Denver", subject: "Denver cost per square", kind: "cost", label: "Per square foot, asphalt", value: "$4 to $6",
        quote: "asphalt $4 to $6", source: 1 },
      { section: "Permits", subject: "permit", kind: "rule", label: "Repair permit threshold", value: "more than 10% of the roof square footage or two roof squares (whichever is smaller)",
        quote: "All repairs that are more than 10% of the roof square footage or two roof squares (whichever is smaller) require a roof permit", source: 2 }], faqs: [] },
    { sources, profile: "Summit Peak Roofing replaces asphalt shingle and metal roofs in Denver.", productName: "Summit Peak Roofing", competitors: [], sections: ["What a roof replacement costs in Denver", "Permits"], now });
  const skeleton = skeletonFor({ format: "guide", sections: ["What a roof replacement costs in Denver", "Permits"], records: v, sources, readAt: now });
  assert.ok(skeleton.intro.length >= 2, "the headline cost records are available to the intro");
  const intro = skeleton.intro[0];
  const prose = { title: "Roof Replacement Cost Denver", metaTitle: "Roof Replacement Cost Denver", metaDescription: "What a Denver roof replacement costs, and the permits that come with it.",
    intro: `Most Denver homeowners pay {{${intro.id}}} for a full roof replacement. What drives the final bill, and the permit rule the city applies, are below.`,
    sections: [{ heading: "What a roof replacement costs in Denver", paragraph: "" }, { heading: "Permits", paragraph: "" }], options: [], conclusion: "Weigh the material against how long you plan to stay." };
  const built = assembledArticle({ skeleton, prose, records: v, productName: "Summit Peak Roofing",
    profile: "Summit Peak Roofing replaces asphalt shingle and metal roofs in Denver.", search: "roof replacement cost denver",
    cta: { label: "Try Summit Peak Roofing", url: "https://summit.example" } });
  assert.match(built.markdown, /^Most Denver homeowners pay \$7,400–\$16,500 \[1\] for a full roof replacement\./, "the search's answer is the first sentence"); // P311: both currencies kept
  assert.doesNotMatch(built.markdown, /## Permits/, "a section whose prose states nothing and whose facts make no table does not print (P329: unstated qualitative facts are not rendered)");
  assert.match(built.markdown, /\| Item \(as of November 2026\) \| Amount \| Source \|/, "two money facts make a dated table");
});

test("P301 the options table never lands under an 'Integrations with other tools' heading (batch 6's yoga article)", () => {
  assert.equal(LIST_HEADING_GUARD("Integrations with other tools"), false);
  assert.equal(LIST_HEADING_GUARD("Software options compared"), true);
  assert.equal(LIST_HEADING_GUARD("Best yoga scheduling software"), true);
});

test("P301 a comparison row whose quote names one maker's product stays out of the side-by-side table (batch 6's 500°F)", async () => {
  const { comparedSides } = await import("../convex/lib/articleAssembly.ts");
  const sides = comparedSides("ceramic vs cast iron cookware")!;
  const sources = [{ url: "https://shop.example/dutch-oven", title: "A shop", excerpt: "Lodge enameled Dutch oven is oven-safe up to 500°F." },
    { url: "https://maker.example/care", title: "Care", excerpt: "Cast iron is oven safe to 650°F. Cast iron skillets weigh about 5 lb. Ceramic coating withstands up to 600°F. Ceramic pans weigh about 2.5 lb." }];
  const fact = (subject: string, label: string, value: string, quote: string, source: number) =>
    ({ section: "Heat and oven limits", subject, kind: "spec", label, value, quote, source });
  const v = verifiedRecords({ options: [], facts: [
      fact("cast iron cookware", "Maximum oven temperature", "oven-safe up to 500°F", "Lodge enameled Dutch oven is oven-safe up to 500°F", 1),
      fact("cast iron cookware", "Maximum oven temperature", "oven safe to 650°F", "Cast iron is oven safe to 650°F", 2),
      fact("cast iron cookware", "Typical skillet weight", "5 lb", "Cast iron skillets weigh about 5 lb", 2),
      fact("ceramic cookware", "Maximum oven temperature", "up to 600°F", "Ceramic coating withstands up to 600°F", 2),
      fact("ceramic cookware", "Typical skillet weight", "2.5 lb", "Ceramic pans weigh about 2.5 lb", 2)], faqs: [] },
    { sources, profile: "", productName: "Hearth & Clay", competitors: [], sections: ["Heat and oven limits"], now });
  const skeleton = skeletonFor({ format: "comparison", sections: ["Heat and oven limits"], records: v, sources, readAt: now, sides });
  assert.doesNotMatch(skeleton.sections[0].body, /500°F/, "the one product's limit is not the material's row");
  assert.match(skeleton.sections[0].body, /650°F/);
  assert.match(skeleton.sections[0].body, /600°F/, "the material-generic row keeps both sides");
  const productRecord = skeleton.sections.find((s) => s.heading === "Heat and oven limits")!;
  assert.equal(productRecord.records.filter((r) => r.value.includes("500")).length, 1, "the product fact stays a prose record for its section");
});

test("P301 the rendered fallback's payload parser digs the page text out of treg's response shapes", async () => {
  const { tregExtractedText } = await import("../convex/lib/tregFetch.ts");
  const page = "word ".repeat(120);
  assert.equal(tregExtractedText({ data: { content: page } }), page);
  assert.equal(tregExtractedText({ content: page }), page);
  assert.equal(tregExtractedText({ result: { markdown: page } }), page);
  assert.equal(tregExtractedText({ data: { items: [page, page] } }), page + "\n" + page);
  assert.equal(tregExtractedText({ error: "nope" }), "", "an error payload yields no text");
});

test("P301 pageShape reads a rendered (Markdown) page too: headings, list entries as option names", async () => {
  const { pageShape, listedOptions } = await import("../convex/lib/serpBrief.ts");
  const md = [
    "# Best Yoga Studio Software", "",
    "1. **WellnessLiving** — an all-in-one for bigger studios.",
    "2. **Mindbody** — the established name.",
    "3. **Momence** — best for video.",
    "4. **Vagaro** — budget pick for small studios.",
    "", "## How we chose", "We weighed pricing and waitlists.",
  ].join("\n");
  const page = pageShape("https://listicle.example/best", md);
  assert.deepEqual(page.headings, ["How we chose"]);
  assert.ok((page.names ?? []).includes("WellnessLiving") && (page.names ?? []).includes("Vagaro"));
  const options = listedOptions({ pages: [page] });
  assert.ok(options.length >= 4, `the listicle's entries become seed options: ${JSON.stringify(options)}`);
});

test("P301 the inline price date never lands inside a worked example (batch 7's bank-rec article)", async () => {
  const { withPriceDate } = await import("../convex/lib/backedFacts.ts");
  const at = Date.UTC(2026, 10, 3);
  const md = [
    "## Worked example", "",
    "In the hypothetical correction, the books understated cash by $90.00 ($540.00 − $450.00), so cash goes up.", "",
    "## Real prices", "",
    "Permits in town cost $119.",
  ].join("\n");
  const out = withPriceDate(md, at);
  assert.doesNotMatch(out, /\$90\.00 \(as of/, "an illustration's amount is never dated");
  assert.match(out, /Permits in town cost \$119 \(as of November 2026\)\./, "the first real price carries the date");
});
