// P299 (Nov 3 2026, ops/ARTICLE-ASSEMBLY-V3.md, Cowork's order): "Stop patching the writer's output." Plans v1 and v2 asked one
// call to write the whole article, so facts it didn't place became gaps, facts it placed twice repeats, facts it put on the
// wrong company errors. Assembly v3: research gives typed records, code checks each against the exact excerpt it quotes and
// prints every fact once, a section with no record has no heading, and the model writes only short prose, from which code
// drops any sentence with a figure or a name its section's records don't give.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assembledArticle, assembledFormat, comparedSides, keptProse, priceWithBilling, pricingText, sideOf, skeletonFor, verifiedRecords, type Records } from "../convex/lib/articleAssembly.ts";
import { evaluatePublicationQuality, issuesBlockingPreLinkReview, planChecksForArticle, readerVisibleIssues } from "../convex/lib/articleQuality.ts";
import { withSourcesSection } from "../convex/lib/sourcesHeading.ts";

const sources = [
  { url: "https://www.mindbodyonline.com/business/pricing", title: "Mindbody pricing", excerpt: "Starter $139/month billed monthly. Accelerate $279/month. Online booking, waitlists and class packs on every plan." },
  { url: "https://www.glofox.com/blog/yoga-studio-software/", title: "Best yoga studio software", excerpt: "Momence starts at $99 per month and includes livestream classes. Arketa offers a branded app for each studio." },
  { url: "https://www.momence.com/pricing", title: "Momence pricing", excerpt: "Momence Basic is $89 per month. Livestream and on-demand video are included on every plan." },
  { url: "https://www.vagaro.com/pricing", title: "Vagaro pricing", excerpt: "Vagaro costs $30 per month for one calendar. Online booking and a marketplace listing are included." },
  { url: "https://permitcalculator.com/cities/austin-tx/", title: "Austin permits", excerpt: "A water heater permit in Austin costs $125, and an inspection is required within 30 days of the permit." },
];
const profile = "Name: StudioFlow\nDomain: studioflow.example\nStudioFlow costs $59 a month per studio with unlimited members. It includes a class schedule, online booking, memberships and class packs, waitlists, and automatic reminder emails.";
const sections = ["Why studios switch", "Best yoga scheduling software options compared", "Permits and inspections", "Frequently asked questions"];
const raw: Omit<Records, "steps"> = {
  options: [
    { name: "Mindbody", website: "https://www.mindbodyonline.com", prices: [
      { plan: "Starter", price: "$139/month", billing: "billed monthly", quote: "Starter $139/month billed monthly", source: 1 },
      { plan: "Accelerate", price: "$279/month", billing: "", quote: "Accelerate $279/month", source: 1 }],
      features: [{ text: "online booking, waitlists and class packs on every plan", quote: "Online booking, waitlists and class packs on every plan", source: 1 },
        { text: "a free mobile app", quote: "a free mobile app for clients", source: 1 }], limits: [] },
    { name: "Momence", website: "", prices: [{ plan: "", price: "$99 per month", billing: "", quote: "Momence starts at $99 per month", source: 2 },
      { plan: "Basic", price: "$89 per month", billing: "", quote: "Momence Basic is $89 per month", source: 3 }],
      features: [{ text: "livestream classes", quote: "includes livestream classes", source: 2 },
        { text: "livestream and on-demand video on every plan", quote: "Livestream and on-demand video are included on every plan", source: 3 }], limits: [] },
    { name: "Arketa", website: "", prices: [{ plan: "", price: "$89/month", billing: "", quote: "Arketa offers a branded app for each studio", source: 2 }],
      features: [{ text: "a branded app for each studio", quote: "Arketa offers a branded app for each studio", source: 2 }], limits: [] },
    { name: "Vagaro", website: "https://www.vagaro.com", prices: [{ plan: "", price: "30", billing: "per month", quote: "Vagaro costs $30 per month", source: 4 }],
      features: [{ text: "online booking", quote: "Online booking and a marketplace listing are included", source: 4 },
        { text: "a marketplace listing", quote: "Online booking and a marketplace listing are included", source: 4 }], limits: [] },
    { name: "ZenPlanner", website: "", prices: [{ plan: "", price: "$117/month", billing: "", quote: "ZenPlanner costs $117/month", source: 2 }], features: [], limits: [] },
    { name: "StudioFlow", website: "", prices: [{ plan: "", price: "$59 a month", billing: "per studio", quote: "StudioFlow costs $59 a month per studio with unlimited members", source: 0 }],
      features: [{ text: "waitlists and automatic reminder emails", quote: "waitlists, and automatic reminder emails", source: 0 }], limits: [] },
  ],
  facts: [
    { section: "Permits and inspections", subject: "permit", kind: "fee", label: "Water heater permit, City of Austin", value: "$125", quote: "A water heater permit in Austin costs $125", source: 5 },
    { section: "Permits and inspections", subject: "inspection", kind: "rule", label: "Inspection", value: "required within 30 days of the permit", quote: "an inspection is required within 30 days of the permit", source: 5 },
    { section: "Permits and inspections", subject: "permit", kind: "fee", label: "Water heater permit, City of Austin", value: "$125", quote: "A water heater permit in Austin costs $125", source: 5 },
    { section: "Why studios switch", subject: "Mindbody", kind: "price", label: "Mindbody Starter", value: "$139/month", quote: "Starter $139/month billed monthly", source: 1 },
    { section: "A heading the outline doesn't have", subject: "x", kind: "fact", label: "x", value: "y", quote: "A water heater permit in Austin", source: 5 },
  ],
  faqs: [{ question: "Do I need a permit for a water heater in Austin?", answer: "Yes. A water heater permit in Austin costs $125.", quote: "A water heater permit in Austin costs $125", source: 5 },
    { question: "Should I call a plumber?", answer: "Ask your plumber for a quote.", quote: "A water heater permit in Austin costs $125", source: 5 }],
};
const verified = () => verifiedRecords(raw, { sources, profile, productName: "StudioFlow", competitors: ["zenplanner.com"], sections });

test("P299 assembly is off unless PENTRA_ASSEMBLY_V3 names the format: lists and local-service guides first", () => {
  assert.equal(assembledFormat(undefined, "list"), false);
  assert.equal(assembledFormat("off", "list"), false);
  assert.equal(assembledFormat("on", "list"), true);
  assert.equal(assembledFormat("on", "guide"), true);
  assert.equal(assembledFormat("on", "comparison"), true);
  assert.equal(assembledFormat("on", "how-to"), true, "a how-to reads its procedure page's own ordered list");
  assert.equal(assembledFormat("list,how-to", "how-to"), true);
  assert.equal(assembledFormat("on", "tutorial"), false, "a format without renderers keeps the writer");
  assert.equal(assembledFormat("list", "guide"), false);
});

test("P299 code keeps a record only when its quote is in its excerpt and states its figures, about the right company", () => {
  const v = verified();
  assert.deepEqual(v.options.map((o) => o.name), ["StudioFlow", "Mindbody", "Momence", "Vagaro"], JSON.stringify(v.dropped));
  const momence = v.options.find((o) => o.name === "Momence")!;
  assert.deepEqual(momence.prices.map((p) => p.price), ["$89 per month"], "a price from the option's own page wins over a blog's");
  assert.ok(!v.options.find((o) => o.name === "Mindbody")!.features.some((f) => /mobile app/.test(f.text)), "a quote its excerpt doesn't contain");
  assert.deepEqual(v.options.find((o) => o.name === "Vagaro")!.prices, [], '"30" with no currency is not a price');
  assert.ok(v.dropped.some((d) => /Arketa price: a figure its quote doesn't state/.test(d)));
  assert.ok(v.dropped.some((d) => /ZenPlanner: a competitor/.test(d)));
  assert.ok(v.options[0].business && v.options[0].prices[0].source === 0, "the business's own option comes from its confirmed details");
  assert.equal(v.facts.filter((f) => f.label === "Water heater permit, City of Austin").length, 1, "each fact once");
  assert.ok(!v.facts.some((f) => f.section === "Why studios switch"), "a list's option facts are never printed a second time");
  assert.ok(!v.facts.some((f) => f.label === "x"), "a section the outline doesn't have");
  assert.deepEqual(v.faqs.map((f) => f.question), ["Do I need a permit for a water heater in Austin?"], "an answer that sends the reader elsewhere goes");
});

test("P299 code prints every fact once, a section with no record has no heading, prices are dated in the table header, the FAQ is last", () => {
  const v = verified();
  const skeleton = skeletonFor({ format: "list", sections, records: v, sources, readAt: Date.UTC(2026, 10, 3) });
  assert.deepEqual(skeleton.sections.map((s) => s.heading), ["Best yoga scheduling software options compared", "Permits and inspections"],
    "no heading for 'Why studios switch': it has no record");
  const list = skeleton.sections[0].body;
  // v3.1: the date rides in the table header (never a standalone line), the business's own product lists last, and an
  // option with no price of its own shows "No public price" (Vagaro's "$30" has no currency: not a price).
  assert.match(list, /^\| Option \| Starting price \(as of November 2026\) \|\n\| --- \| --- \|\n\| \[Mindbody\]\(https:\/\/www\.mindbodyonline\.com\) \| \$139\/month billed monthly \(Starter plan\) \[1\] \|\n\| \[Momence\]\(https:\/\/www\.momence\.com\) \| \$89 per month \(Basic plan\) \[3\] \|\n\| \[Vagaro\]\(https:\/\/www\.vagaro\.com\) \| No public price \|\n\| StudioFlow \| \$59 a month per studio \|$/m);
  assert.equal(list.match(/\$139/g)!.length, 1, "the starting price is in the table only");
  assert.match(list, /### Mindbody\n\n\{\{SUITS:Mindbody\}\}\n\n- \*\*Accelerate:\*\* \$279\/month \[1\]\n- Online booking, waitlists and class packs on every plan \[1\]/);
  assert.doesNotMatch(skeleton.sections.map((s) => s.body).join("\n"), /^Prices as of /m, "no standalone dating line anywhere");
  // v3.1: a section's facts are prose records (placeholders), not label: quote bullets; two or more money facts make a
  // table whose header carries "as of".
  const permits = skeleton.sections[1];
  assert.match(permits.body, /\| Item \(as of November 2026\) \| Amount \| Source \|/, "one fee: a dated one-row table (P327)");
  assert.match(permits.body, /\| Item \| Detail \| Source \|/, "one rule: a detail table (P327)");
  assert.deepEqual(permits.records.map((r) => r.value), ["$125", "required within 30 days of the permit"]);
  assert.equal(permits.records[0].id.startsWith("r"), true);
  assert.equal(skeleton.faq!.body, "### Do I need a permit for a water heater in Austin?\n\nYes. A water heater permit in Austin costs $125 [5].");
  assert.equal(priceWithBilling("$12", "a month"), "$12 a month");
  assert.equal(priceWithBilling("$6.99", "/mo"), "$6.99/mo");
  assert.equal(priceWithBilling("$55", "PER MONTH"), "$55 per month", "a page's shouting is decased");
});

test("P299 code drops a prose sentence with a figure or a name its records don't give, homework, or talk about the records", () => {
  const scope = { allowedText: "Mindbody Starter $139/month billed monthly. Online booking, waitlists and class packs on every plan." };
  const kept = keptProse("Mindbody suits studios that want every tool in one place. It costs $500 a month. Acme Corp recommends it. " +
    "Ask your vendor for a written quote. The records give no price for it. It suits growing studios.", scope);
  assert.equal(kept.kept, "Mindbody suits studios that want every tool in one place. It suits growing studios.");
  assert.equal(kept.dropped.length, 4);
});

test("P299 an assembled article passes Pentra's gate with nothing blocking and no plan-check number or name failures", () => {
  const v = verified();
  const skeleton = skeletonFor({ format: "list", sections, records: v, sources, readAt: Date.UTC(2026, 10, 3) });
  const prose = { title: "Best Scheduling Software for Yoga Studios", metaTitle: "Best Scheduling Software for Yoga Studios",
    metaDescription: "Compare yoga studio scheduling software by starting price, what each plan includes and which kind of studio each one suits best.",
    intro: "The right scheduling software decides how easily students book, how often they come back and how much admin fills your week. " +
      "A small studio needs a schedule students can read on a phone, simple ways to sell drop-ins, packs and memberships, and reminders that cut no-shows. " +
      "Below, each option's starting price and what it includes sit side by side, followed by who each one suits, so you can shortlist the tools that fit how you already teach and sell classes.",
    sections: [{ heading: "Best yoga scheduling software options compared", paragraph: "The table compares starting prices; each entry below says what the plan includes." },
      { heading: "Permits and inspections", paragraph: "If your studio is moving into a new space, a water heater permit there costs {{r3}}, and the inspection that follows it is {{r4}}." }],
    options: [{ name: "Mindbody", suits: "Mindbody suits studios that want booking, waitlists and class packs in one place." },
      { name: "Momence", suits: "Momence suits studios that stream classes or sell on-demand video." },
      { name: "Vagaro", suits: "Vagaro suits studios that want a marketplace listing next to online booking." },
      { name: "StudioFlow", suits: "StudioFlow suits small studios that want booking, memberships and reminders without extras." }],
    conclusion: "Start from how you sell classes: memberships, packs, drop-ins or video. Then weigh each starting price against the features you would use every week, " +
      "because a cheaper plan that lacks waitlists or reminders costs you in empty mats and manual follow-ups. Shortlist two tools, set up the same week of classes in each, " +
      "and keep the one your students find easier to book. StudioFlow gives small studios booking, memberships and automatic reminders." };
  const built = assembledArticle({ skeleton, prose, records: v, productName: "StudioFlow", profile, search: "best scheduling software for yoga studios",
    cta: { label: "Try StudioFlow", url: "https://studioflow.example" } });
  assert.ok(built.markdown.indexOf("## The bottom line") < built.markdown.indexOf("## Frequently asked questions"), "the FAQ is last");
  assert.match(built.markdown, /### Momence\n\nMomence suits studios that stream classes or sell on-demand video\.\n\n- Livestream and on-demand video on every plan \[3\]/);
  assert.match(built.markdown, /a water heater permit there costs \$125 \[5\]/, "v3.1: a placeholder fills with its record's value and citation");
  const hashed = sources.map((s) => ({ ...s, contentHash: createHash("sha256").update(s.excerpt).digest("hex") }));
  const markdown = withSourcesSection(built.markdown, hashed);
  const article = { title: prose.title, slug: "/best-scheduling-software-for-yoga-studios", articleType: "listicle", markdown, metaTitle: prose.metaTitle,
    metaDescription: prose.metaDescription, metaKeywords: ["best scheduling software for yoga studios"], sources: hashed, qualityPlan: "fixed_v1",
    articlePlan: { version: 1, format: "list", sections, minItems: 3, assembly: "v3" }, productEvidenceSnapshot: profile,
    productEvidenceHash: createHash("sha256").update(profile).digest("hex"), claimEvidence: [], claimEvidenceStatus: "not_applicable",
    productEvidenceStatus: "not_applicable", mediaQualityStatus: "passed" };
  const blocking = issuesBlockingPreLinkReview([...evaluatePublicationQuality(article as never, "strict").issues, ...readerVisibleIssues(article as never)]);
  assert.deepEqual(blocking, []);
  assert.deepEqual(planChecksForArticle(article as never).filter((f) => ["number", "product", "name"].includes(f.check)), []);
});

test("P299 a pricing page is read around its prices; the pipeline assembles only when switched on and the review adds no AI step", () => {
  assert.equal(pricingText("<html><script>var x = 1</script><nav>Menu</nav><h2>Pricing</h2><div>Starter</div><div>$29 per month</div></html>"), "Pricing. Starter. $29 per month.");
  assert.equal(pricingText("<p>No prices here.</p>"), "");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /const assembleV3 = Boolean\(articlePlan && topic && assembledFormat\(process\.env\.PENTRA_ASSEMBLY_V3, articlePlan\.format\)\);/);
  assert.match(pipeline, /const article = assembleV3 && articlePlan && topic \? await assembleArticleV3\(/);
  assert.match(pipeline, /toolName: "extract_records"[\s\S]{0,200}maxTokens: 16000 \}\);/);
  assert.match(pipeline, /const assembled = article\.articlePlan\?\.assembly === "v3";/);
  assert.match(pipeline, /if \(!fixedBefore && !assembled\) \{\n\s+const plan = article\.articlePlan;/);
  const provider = readFileSync("convex/actions/contentWorkProvider.ts", "utf8");
  assert.match(provider, /"extract_records", "write_prose"\]\.includes\(args\.toolName\)/);
  assert.doesNotMatch(readFileSync("convex/contentWork.ts", "utf8").match(/export const ARTICLE_OPTIONAL_STEP = .*$/m)![0], /extract_records|write_prose/,
    "records and prose are the writing: never skipped by the cap's optional-step rule");
});

test("P299 batch 6's first run: no stand-in prose, no raw address, no stale change, no doubled period, no fake plan name", () => {
  // The prose call once filled the conclusion first and wrote "placeholder" (the schema now asks for it last).
  assert.deepEqual(keptProse("placeholder", { allowedText: "" }), { kept: "", dropped: ["placeholder"] });
  assert.equal(keptProse("Pick the tool that fits how you bill. You can try it at https://tallybook.example today.", { allowedText: "" }).kept,
    "Pick the tool that fits how you bill.");
  assert.equal(priceWithBilling("$25/month", "per month"), "$25/month");
  assert.equal(priceWithBilling("$23/month", "billed annually"), "$23/month billed annually");
  const src = [{ url: "https://www.freshbooks.com/pricing", title: "FreshBooks pricing", excerpt: "Lite is $23/month. All pricing will increase on or after March 5, 2026. Starting price $19 for Lite." }];
  const v = verifiedRecords({ options: [{ name: "FreshBooks", website: "https://www.freshbooks.com", prices: [{ plan: "Starting price", price: "$19", billing: "", quote: "Starting price $19 for Lite", source: 1 }],
    features: [{ text: "pricing will increase on or after March 5, 2026", quote: "All pricing will increase on or after March 5, 2026", source: 1 },
      { text: "Lite plan", quote: "Lite is $23/month", source: 1 }], limits: [] }], facts: [], faqs: [] },
    { sources: src, profile: "", productName: "Tallybook", competitors: [], sections: [], now: Date.UTC(2026, 10, 3) });
  assert.equal(v.options[0].prices[0].plan, "", '"Starting price" is not a plan name');
  assert.deepEqual(v.options[0].features.map((f) => f.text), ["Lite plan"], "a change dated in the past is stale");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /const emptied = assembled \? \{ markdown: fields\.markdown, removed: \[\] as string\[\] \} : withoutEmptyFigureSections\(fields\.markdown\);/,
    "a FAQ question about price with a yes-or-no answer is not an empty figure section");
});

test("P299 a comparison's attributes stated for both sides form one side-by-side table; nothing in it is printed twice", () => {
  const sides = comparedSides("ceramic vs cast iron cookware")!;
  assert.deepEqual(sides, ["ceramic cookware", "cast iron cookware"]);
  assert.deepEqual(comparedSides("heat pump vs gas furnace"), ["heat pump", "gas furnace"]);
  assert.equal(comparedSides("best invoicing software"), null);
  assert.deepEqual([sideOf("ceramic-coated pans", sides), sideOf("bare cast iron skillet", sides), sideOf("both pans", sides)], [0, 1, -1]);
  const fact = (section: string, subject: string, label: string, value: string, source: number) =>
    ({ section, subject, kind: "spec", label, value, quote: "q", source });
  const facts = [fact("Heat and oven limits", "ceramic cookware", "Maximum oven temperature", "500°F", 1),
    fact("Heat and oven limits", "cast iron cookware", "Maximum oven temperature", "no limit", 2),
    fact("Weight", "ceramic", "Weight of a 10-inch skillet (ceramic)", "2.5 lb", 1), fact("Weight", "cast iron", "Weight of a 10-inch skillet, cast iron", "5 lb", 2),
    fact("Care", "cast iron", "Seasoning", "needs seasoning", 2)];
  const skeleton = skeletonFor({ format: "comparison", sections: ["Ceramic vs cast iron at a glance", "Heat and oven limits", "Weight", "Care"],
    records: { options: [], facts, faqs: [], dropped: [] }, sources: [{ url: "https://a.example", excerpt: "" }, { url: "https://b.example", excerpt: "" }],
    readAt: Date.UTC(2026, 10, 3), sides });
  assert.deepEqual(skeleton.sections.map((s) => s.heading), ["Ceramic vs cast iron at a glance", "Care"], "sections whose facts all went into the table have no heading");
  assert.equal(skeleton.sections[0].body, "| | Ceramic cookware | Cast iron cookware |\n| --- | --- | --- |\n| Maximum oven temperature | 500°F [1] | no limit [2] |\n" +
    "| Weight of a 10-inch skillet | 2.5 lb [1] | 5 lb [2] |");
  // P327: a single-side fact is BOTH a prose record and a table row in its section's detail table.
  assert.match(skeleton.sections[1].body, /\| Item \| Detail \| Source \|\n\| --- \| --- \| --- \|\n\| Seasoning \| needs seasoning \[2\] \| b.example \|/);
  assert.deepEqual(skeleton.sections[1].records.map((r) => r.value), ["needs seasoning"]);
  assert.match(skeleton.sections[1].records[0].label, /cast iron/i, "the record's label carries its side");
});

test("P299 batch 6's second run: the business's price keeps its period, labels lose the option's name cleanly, prose never counts options", async () => {
  const { withoutName } = await import("../convex/lib/articleAssembly.ts");
  assert.equal(priceWithBilling("$59", "a month per studio with unlimited members"), "$59 a month per studio");
  assert.equal(withoutName("Combined monthly cost of piecing together tools (Mindbody estimate)", "Mindbody"), "Combined monthly cost of piecing together tools (estimate)");
  assert.equal(withoutName("Free trial, Gymdesk", "Gymdesk"), "Free trial");
  assert.equal(keptProse("Below you will find six options compared on starting price. Start with what you need every week.", { allowedText: "" }).kept,
    "Start with what you need every week.", "a count can disagree with the list code printed");
});

test("P299 a comparison row keeps its words: only a side's own name leaves the label", () => {
  const sides = comparedSides("heat pump vs gas furnace")!;
  const fact = (subject: string, label: string, value: string) => ({ section: "How they work", subject, kind: "fact", label, value, quote: "q", source: 1 });
  const skeleton = skeletonFor({ format: "comparison", sections: ["How they work"], sources: [{ url: "https://a.example", excerpt: "" }], readAt: Date.UTC(2026, 10, 3), sides,
    records: { options: [], faqs: [], dropped: [], facts: [fact("heat pump", "How it makes heat, heat pump", "moves heat from outdoor air"), fact("gas furnace", "How it makes heat (gas furnace)", "burns natural gas"),
      fact("heat pump", "Installed cost", "$12,000"), fact("gas furnace", "Installed cost", "$3,800")] } });
  assert.match(skeleton.sections[0].body, /\| How it makes heat \| moves heat from outdoor air \[1\] \| burns natural gas \[1\] \|/);
});

test("P299 a comparison's single-side fact names its side", () => {
  const sides = comparedSides("ceramic vs cast iron cookware")!;
  const skeleton = skeletonFor({ format: "comparison", sections: ["Durability and lifespan"], sources: [{ url: "https://a.example", excerpt: "" }], readAt: Date.UTC(2026, 10, 3), sides,
    records: { options: [], faqs: [], dropped: [], facts: [{ section: "Durability and lifespan", subject: "ceramic cookware", kind: "duration", label: "Typical lifespan",
      value: "up to three years", quote: "q", source: 1 }] } });
  // P327: the single-side fact also prints as a detail row.
  assert.match(skeleton.sections[0].body, /\| Typical lifespan \| up to three years \[1\] \| a.example \|/);
  assert.deepEqual(skeleton.sections[0].records.map((r) => r.value), ["up to three years"]);
  assert.match(skeleton.sections[0].records[0].label, /ceramic cookware/i, "the record's label carries its side");
});

test("P299 a how-to's steps come from one source, in that source's own order, numbered by code", () => {
  const sources = [
    { url: "https://www.rainbird.com/winterize", title: "Rain Bird: winterizing", excerpt: "First, shut off the water supply at the main valve. Next, set the controller to rain mode. Then connect an air compressor to the blow-out port. Finally, open each zone one at a time." },
    { url: "https://blog.example/winterize", title: "A blog", excerpt: "Open each zone one at a time. Shut off the water supply." },
  ];
  const step = (s: string, quote: string, source: number) => ({ section: "How to winterize step by step", step: s, quote, source });
  const v = verifiedRecords({ options: [], facts: [], faqs: [], steps: [
    step("Open each zone one at a time", "open each zone one at a time", 1), step("Shut off the water supply at the main valve", "shut off the water supply at the main valve", 1),
    step("Connect an air compressor to the blow-out port", "connect an air compressor to the blow-out port", 1), step("Set the controller to rain mode", "set the controller to rain mode", 1),
    step("Shut off the water supply", "Shut off the water supply", 2)] },
    { sources, profile: "", productName: "Greenline", competitors: [], sections: ["How to winterize step by step"] });
  assert.deepEqual(v.steps!.map((s) => s.step), ["Shut off the water supply at the main valve", "Set the controller to rain mode",
    "Connect an air compressor to the blow-out port", "Open each zone one at a time"], "the source's own order, whatever order the records came in");
  assert.ok(v.dropped.some((d) => /1 step\(s\) from other sources/.test(d)));
  const skeleton = skeletonFor({ format: "how-to", sections: ["How to winterize step by step"], records: v, sources, readAt: Date.UTC(2026, 10, 3) });
  assert.equal(skeleton.sections[0].body, "1. Shut off the water supply at the main valve [1]\n2. Set the controller to rain mode [1]\n" +
    "3. Connect an air compressor to the blow-out port [1]\n4. Open each zone one at a time [1]");
});

test("P299 a how-to reads each procedure page's own ordered list; each section's procedure is numbered on its own", async () => {
  const { orderedStepsText } = await import("../convex/lib/articleAssembly.ts");
  const html = "<h2>Drain</h2><ol><li>Turn off the mainline shutoff valve.</li><li>Open one control valve to relieve pressure.</li><li>Slowly open the manual drain valve.</li></ol>" +
    "<h2>Blow out</h2><ol><li>Close the mainline sprinkler shutoff valve.</li><li>Attach the air compressor hose to a blow-out adapter.</li><li>Set the pressure regulating valve to 50 psi.</li></ol>";
  assert.equal(orderedStepsText(html), "1. Turn off the mainline shutoff valve. 2. Open one control valve to relieve pressure. 3. Slowly open the manual drain valve. … " +
    "1. Close the mainline sprinkler shutoff valve. 2. Attach the air compressor hose to a blow-out adapter. 3. Set the pressure regulating valve to 50 psi.");
  const excerpt = orderedStepsText(html);
  const sources = [{ url: "https://www.rainbird.com/blog/blow-out", title: "Rain Bird", excerpt }];
  const step = (section: string, s: string) => ({ section, step: s, quote: s, source: 1 });
  const v = verifiedRecords({ options: [], facts: [], faqs: [], steps: [step("Blow out the lines", "Set the pressure regulating valve to 50 psi."),
    step("Drain the system", "Turn off the mainline shutoff valve."), step("Blow out the lines", "Close the mainline sprinkler shutoff valve."),
    step("Drain the system", "Slowly open the manual drain valve.")] },
    { sources, profile: "", productName: "Greenline", competitors: [], sections: ["Drain the system", "Blow out the lines"] });
  const skeleton = skeletonFor({ format: "how-to", sections: ["Drain the system", "Blow out the lines"], records: v, sources, readAt: Date.UTC(2026, 10, 3) });
  assert.deepEqual(skeleton.sections.map((s) => s.body), ["1. Turn off the mainline shutoff valve [1]\n2. Slowly open the manual drain valve [1]",
    "1. Close the mainline sprinkler shutoff valve [1]\n2. Set the pressure regulating valve to 50 psi [1]"], "two procedures, each in its page's order");
});

test("P299 one procedure split over sections keeps counting; a second procedure starts again at 1", () => {
  const excerpt = "1. Gather the records. 2. Check the statement itself. 3. Match transactions. 4. List the differences. 5. Calculate the adjusted balances. 6. Post entries and document. … 1. Close the shutoff valve. 2. Open the drain valve.";
  const sources = [{ url: "https://a.example/reconcile", title: "Guide", excerpt }];
  const step = (section: string, s: string) => ({ section, step: s, quote: s, source: 1 });
  const sections = ["Steps", "Calculate the adjusted balance", "Record adjusting entries", "Draining"];
  const v = verifiedRecords({ options: [], facts: [], faqs: [], steps: [step("Steps", "Gather the records."), step("Steps", "Match transactions."),
    step("Calculate the adjusted balance", "Calculate the adjusted balances."), step("Record adjusting entries", "Post entries and document."),
    step("Draining", "Close the shutoff valve."), step("Draining", "Open the drain valve.")] }, { sources, profile: "", productName: "Brightline", competitors: [], sections });
  const skeleton = skeletonFor({ format: "how-to", sections, records: v, sources, readAt: Date.UTC(2026, 10, 3) });
  assert.deepEqual(skeleton.sections.map((s) => s.body), ["1. Gather the records [1]\n2. Match transactions [1]", "3. Calculate the adjusted balances [1]",
    "4. Post entries and document [1]", "1. Close the shutoff valve [1]\n2. Open the drain valve [1]"]);
});
