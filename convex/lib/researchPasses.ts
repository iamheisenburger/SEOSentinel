/** P256 (Oct 30 2026): Cowork's fresh-account first article ("What Should a Freelance Invoice Include?") kept one
 * source. Research cited 8 pages, 6 of them vendor blogs that strict evidence cannot use, so the article's US half had
 * nothing behind it. When the first pass keeps fewer than two readable sources, one more bounded pass asks for primary
 * sources only and names the sites already found unusable. More sources, not more checks. */
// P258 (Oct 30 2026), Arshad's cost rule: research gathers 3 to 5 real sources before writing.
export const PRIMARY_PASS_BELOW = 3;
export const MAX_RESEARCH_SOURCES = 5;
export const PRIMARY_PASS_SEARCHES = 4;

/** P271 (Oct 31 2026): a pass told only "not its competitors" researched them: the first production article under P268 spent
 * 9 searches on pentra.dev's competitors' pages and kept none (the competitor filter drops them). Each pass names them. */
const competitorsLine = (competitors?: readonly string[]) =>
  competitors?.length ? `Do not research or cite the business's competitors (the article never names them): ${competitors.join(", ")}` : "";

export function primarySourcesRequest(args: { label: string; primaryKeyword: string; secondaryKeywords?: string[];
  targetCountry?: string; siteName: string; avoidHosts: string[]; competitors?: readonly string[] }) {
  return {
    system: [
      "You research primary sources for a fact-checked article. A first search found mostly vendor blogs and other secondary pages, which cannot be cited.",
      "Use web search to find primary sources only: government and regulator pages (for example .gov, gov.uk or europa.eu), official guidance from tax authorities and standards bodies, academic research, and the official documentation of any software or platform the topic is about.",
      "When the topic involves more than one country or audience, find each one's own official source. Do not cite vendor blogs, marketing pages, forums, social media or news aggregators.",
      "Then write a short research brief of the facts most useful to the article, citing the page each fact comes from. Quote only what the sources say; do not add facts of your own.",
    ].join(" "),
    userMessage: [
      `Article topic: ${args.label}`,
      `Primary search: ${args.primaryKeyword}`,
      args.secondaryKeywords?.length ? `Related searches: ${args.secondaryKeywords.slice(0, 6).join(", ")}` : "",
      args.targetCountry ? `Readers are in: ${args.targetCountry}` : "",
      args.avoidHosts.length ? `Already found, not usable as evidence (do not cite): ${args.avoidHosts.join(", ")}` : "",
      `Do not research ${args.siteName} itself or its competitors; research the subject for its readers.`,
      competitorsLine(args.competitors),
    ].filter(Boolean).join("\n"),
  };
}

/** P262 (Oct 31 2026): a "best X" list's second pass looks up the options its top lists name on their own sites (features,
 * plans and pricing, help centre), where the general pass found government pages instead (live trial: the IRS and the FTC for
 * "best scheduling software for yoga studios"). A list keeps up to LIST_RESEARCH_SOURCES sources, one an option.
 * P268 (Oct 31 2026): Cowork failed batch 2's list for "only 4 real options plus StudioFlow, and none built for yoga" (the
 * top results list 6 to 10, such as Momoyoga, WellnessLiving, Walla and Arketa): a list names at least LIST_MIN_OPTIONS
 * options built for the search's audience, the business's own product not counted, each from its own pricing page. */
export const LIST_RESEARCH_SOURCES = 10;
export const LIST_MIN_OPTIONS = 6;
/** Searches a list's research may run: one or two for the top lists, then one per option's pricing page. */
export const LIST_RESEARCH_SEARCHES = 8;
export function optionSourcesRequest(args: { label: string; primaryKeyword: string; options: readonly string[]; targetCountry?: string; productName?: string;
  competitors?: readonly string[] }) {
  return {
    system: [
      `You research a list article that compares named options for the audience its search names. Name at least ${LIST_MIN_OPTIONS} options built for that audience: the options the current top lists for this search name, not general-purpose tools a list for this audience would skip.`,
      "For each option, use web search to find its own official pages: plans and pricing, features, and its help centre or documentation. Cite those pages for what each option offers and costs, with each price's conditions (plan name, billing period, introductory period, per location or per user, transaction fees and which plan they apply to); skip an option whose own pages you can't find.",
      "Do not cite review sites, affiliate lists, forums, social media or news aggregators for an option's facts.",
      "Then write a short research brief: for each option, the facts its own pages state, citing the page each fact comes from. Quote only what the pages say; do not add facts of your own.",
    ].join(" "),
    userMessage: [
      `Article topic: ${args.label}`,
      `Primary search: ${args.primaryKeyword}`,
      args.options.length ? `Options the top results name (research each on its own website; add others the top lists for this search name until there are at least ${LIST_MIN_OPTIONS}): ${args.options.join(", ")}`
        : `Find at least ${LIST_MIN_OPTIONS} options the current top lists for this search name, and research each on its own website.`,
      args.productName ? `Do not research ${args.productName}: it is the business this article is for.` : "",
      competitorsLine(args.competitors),
      args.targetCountry ? `Readers are in: ${args.targetCountry}` : "",
    ].filter(Boolean).join("\n"),
  };
}

/** P264 (Oct 31 2026): the fixed plan keeps up to 6 sources (a list 10), one each for the facts its coverage needs. */
export const PLANNED_RESEARCH_SOURCES = 6;
/** P264: the fixed plan's research, searcher-led. The plan lists what the top results give a searcher (its coverage), and
 * research finds a reputable source for each item: official where it exists, otherwise the reputable page where that
 * fact lives. Cowork judged the first 5 planned articles 0 of 5, "accurate, cautious and thin", because only government
 * and documentation pages were kept: no prices, no named tools, no runnable code, no rebates.
 * P268 (Oct 31 2026): batch 2 got its numbers wrong where small blogs supplied them (Cowork: a tankless rebate credited to
 * Austin Energy that only Texas Gas Service pays, an old permit fee, a wrong 25C cap, Pino "since 2014"): an owned fact
 * comes from its owner, and a blog or cost guide may give context only. */
export const SEARCHER_LED_RESEARCH_SYSTEM = [
  "You research sources for an article that must give a searcher everything the current top results give them. For each item in the coverage list, use web search to find the page that states it.",
  "OWNED FACTS come from their owner's own page: a product's prices, plans and features from the seller's pricing or product page; a rebate or incentive from the utility, agency or program that pays it; a permit, fee or local rule from the city's or county's own page or fee schedule; a specification or care instruction (temperature limits, weight, capacity, warranty) from the manufacturer; a software release, version, API or option from its official documentation, package registry or repository; a law, tax credit or program from the government's page. A blog, review site, cost guide or another company's page never supports an owned fact, even when it repeats one: find the owner's page.",
  "For context (typical installed costs, how something works, comparisons), use established publications: major cost guides (for example Angi or HomeGuide), encyclopedias, national publications, university and extension pages.",
  "Avoid forums, social media, marketplaces, content farms, AI-written listicles, coupon or affiliate pages and anonymous blogs. For prices, fees, laws and rules, use the current page (from the last 12 months) and check that a rule is still in force (court rulings, repeals, effective dates).",
  "Then write a short research brief: for each coverage item, the facts its source states with the conditions the source gives (introductory periods, which plan or product, effective dates), citing the page; say which items no source states. Quote only what the sources say; do not add facts of your own.",
].join(" ");
export function coverageSourcesRequest(args: { label: string; primaryKeyword: string; coverage: readonly string[]; targetCountry?: string;
  avoidHosts: string[]; competitors?: readonly string[] }) {
  return {
    system: SEARCHER_LED_RESEARCH_SYSTEM,
    userMessage: [
      `Article topic: ${args.label}`,
      `Primary search: ${args.primaryKeyword}`,
      // P268: the second pass looks for each item's owner (the seller, utility, city, manufacturer or registry).
      `COVERAGE still without its owner's page or a reputable source (find one for each item you can):`,
      ...args.coverage.map((item) => `- ${item}`),
      args.targetCountry ? `Readers are in: ${args.targetCountry}` : "",
      args.avoidHosts.length ? `Already found (find other pages): ${args.avoidHosts.join(", ")}` : "",
      competitorsLine(args.competitors),
    ].filter(Boolean).join("\n"),
  };
}

/** Distinct host names (without "www."), in first-seen order. */
export function sourceHosts(urls: readonly string[], limit = 12): string[] {
  const hosts: string[] = [];
  for (const url of urls) {
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { continue; }
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts.slice(0, limit);
}

/** P268 (Oct 31 2026): who publishes a kept source. An owner sets the facts its page states (a government, the seller or
 * maker of a product, a utility or city on its own programs and fees, a manufacturer, a project's documentation, registry
 * or repository); a publication is an established independent one (a major cost guide, an encyclopedia, a national
 * publication); a blog is anything else. Cowork's batch 2 verdicts: every wrong number came from a small blog. */
export type SourceRole = "owner" | "publication" | "blog";
export const SOURCE_ROLE_LABEL: Record<SourceRole, string> = {
  owner: "OWNER'S PAGE: supports the facts its publisher sets, such as its own prices, plans, fees, rebates, specifications, rules and releases",
  publication: "PUBLICATION: context such as typical ranges, how things work and comparisons; never a product's own price, fee, rebate, specification or date",
  blog: "CONTEXT ONLY: may explain; never the source of a number, price, fee, rebate, specification, date or rule",
};
/** A planned article needs this many owner or publication sources before a blog is left out. */
export const MIN_STRONG_SOURCES = 4;
/** P268: the sources a planned article keeps, owners' pages first, then publications; a blog only while fewer than
 * MIN_STRONG_SOURCES stronger sources exist (at most 2, marked context only). A source the check didn't sort counts as a
 * publication. */
export function rankedResearchSources<T extends { url: string }>(sources: readonly T[], roles: ReadonlyMap<string, SourceRole>, limit: number) {
  const role = (url: string): SourceRole => roles.get(url) ?? "publication";
  const authority = (source: T) => /^https?:\/\/[^/]*\.(?:gov|edu|mil)\//i.test(source.url);
  // P306 (batch 10's Austin): the city's or county's own page is never the source the cap drops for a cost guide or a
  // vendor page — batch 9 kept austintexas.gov and lost every dollar figure, batch 10 kept the dollars and lost the
  // authority to a permit-estimate blog. Up to 3 authority pages keep a seat past the limit; both sides then reach the
  // records call (P305's extras union carries the rest).
  const pinned = sources.filter((source) => role(source.url) !== "blog" && authority(source)).slice(0, 3);
  const pinnedUrls = new Set(pinned.map((source) => source.url));
  const rest = sources.filter((source) => !pinnedUrls.has(source.url));
  const owners = rest.filter((source) => role(source.url) === "owner");
  const publications = rest.filter((source) => role(source.url) === "publication");
  const blogs = rest.filter((source) => role(source.url) === "blog");
  const strong = [...pinned, ...owners, ...publications].slice(0, limit);
  // P288 (Nov 3 2026): up to MIN_STRONG_SOURCES in all, not at most 2 blogs: a how-to's guides (QuickBooks, NetSuite,
  // Experian) and a local search's trade pages are all "blogs", and batch 3's how-to and Austin articles kept 2 sources.
  const context = blogs.slice(0, Math.max(0, Math.min(MIN_STRONG_SOURCES - strong.length, limit - strong.length)));
  const keptUrls = new Set([...strong, ...context].map((source) => source.url));
  return { kept: [...strong, ...context], role, counts: { owner: [...strong].filter((s) => role(s.url) === "owner").length,
    publication: strong.length - pinned.length - [...strong].filter((s) => role(s.url) === "owner").length,
    context: context.length, dropped: rest.filter((s) => !keptUrls.has(s.url)).filter((s) => role(s.url) === "blog").length } };
}

/** P295 (Nov 3 2026, Cowork's batch 4: 0 of 7, ops/COWORK-JUDGE-RESULTS.md fix 1): research covered the search, not the
 * required items, so deletion emptied the sections searchers want (a cost section with no prices, a rebates heading with no
 * rebate), though every missing figure was on its owner's page (WellnessLiving pricing, the City of Austin permit fee,
 * Texas Gas Service's rebate, Carrier's lifespans). Each required item that asks for a figure and has none in the kept
 * sources gets a targeted search on its owner's site before writing. */
export const FIGURE_ITEM = /\b(?:costs?|prices?|pricing|fees?|rebates?|incentives?|tax credits?|temperatures?|heat limits?|lifespans?|timeline|how long)\b|°/i;
export const ITEM_FILLER = new Set(("from what which whether their each with that this these those page pages owner owners source sources official guidance " +
  "own sites site range ranges amount amounts typically usually common such including includes include about into than more most only also " +
  "item items figure figures program programs reputable guide guides").split(" "));
const itemTerms = (item: string) => [...new Set((item.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !ITEM_FILLER.has(w)))];
export const ITEM_LOOKUP_MAX = 6;
export function missingFigureItems(coverage: readonly string[], sources: readonly { excerpt?: string; title?: string; url?: string }[], uncoveredOptions: readonly string[] = []): string[] {
  const texts = sources.map((source) => `${source.title ?? ""}\n${source.excerpt ?? ""}`.toLowerCase());
  // P306 (batch 10's Austin): a permit, fee, rebate or credit is covered only by its owner — a .gov/.edu/.mil page (the
  // utility's own domain passes the record checks later, R9b). A permit-estimate site's dollar figure is not the city's
  // permit fee, and counting it skipped the austintexas.gov lookup batch 9 was praised for.
  const authorityHost = (i: number) => /^https?:\/\/[^/]*\.(?:gov|edu|mil)\//i.test(sources[i]?.url ?? "");
  const OWNED_RULE_ITEM = /\b(?:permits?|fees?|rebates?|incentives?|tax credits?)\b/i;
  // The figure the item asks for, not any digit: a price, fee, rebate or credit needs an amount of money; a temperature a
  // degree; a lifespan or timeline a duration (batch 5's Denver roofing passed on a year beside "cost" and lost its prices).
  const figureFor = (item: string) => /\b(?:costs?|prices?|pricing|fees?|rebates?|incentives?|tax credits?)\b/i.test(item) ? /[$€£]\s?\d|\d\s?(?:usd|dollars)/
    : /temperature|heat limit|°/i.test(item) ? /\d\s?°|\d+\s?degrees/ : /\d+\s?(?:-|to|–)?\s?\d*\s?(?:years?|months?|weeks?|days?|hours?)/;
  // v3.1 (batch 9): a term nearly every source shares ("denver", "roof" beside every price) makes ANY item look covered —
  // batch 8's Denver roofing skipped its permit and insurance lookups that way while "permit" appeared in 0 sources. Only
  // DISTINCTIVE terms (in at most half the sources) decide coverage.
  const sourcesWith = (term: string) => texts.filter((text) => text.includes(term)).length;
  const distinctive = (item: string) => itemTerms(item).filter((term) => term.length > 3 && sourcesWith(term) <= Math.max(1, Math.floor(texts.length / 2)));
  const figured = (item: string) => {
    const terms = distinctive(item).slice(0, 8), figure = figureFor(item);
    if (terms.length < 2) return false;
    // An item is covered only where a source also has its TOPIC word — the item's first distinctive term (batch 8: "cash
    // value" asides in cost pages made the insurance item look covered while "insurance" appeared in 0 sources, and the
    // permit item skipped its denvergov lookup the same way). A permit, fee, rebate or credit counts only on an
    // authority host (P306).
    const topic = terms[0];
    const needsAuthority = OWNED_RULE_ITEM.test(item);
    return texts.some((text, i) => (!needsAuthority || authorityHost(i)) && text.includes(topic) &&
      terms.filter((term) => text.includes(term)).length >= 2 &&
      terms.some((term) => { const at = text.indexOf(term); return at >= 0 && figure.test(text.slice(Math.max(0, at - 200), at + 200)); }));
  };
  const items = coverage.filter((item) => FIGURE_ITEM.test(item) && !figured(item));
  return [...uncoveredOptions.map((option) => `${option} pricing, from ${option}'s own pricing page`), ...items].slice(0, ITEM_LOOKUP_MAX);
}
export function itemLookupRequest(args: { label: string; primaryKeyword: string; items: readonly string[]; targetCountry?: string; competitors?: readonly string[] }) {
  return {
    system: [
      "You find specific figures on the pages of the organisations that own them, for an article that states only what its sources say.",
      "For each item, search the owner's own website directly, for example \"WellnessLiving pricing\", \"site:austintexas.gov water heater permit fee\",",
      "\"Texas Gas Service tankless water heater rebate\" or \"Lodge cast iron seasoning\". Open the page that states the figure and cite it.",
      "The owner is the seller for a price, the utility or agency that pays a rebate, the city or county for a permit or fee, the manufacturer for a",
      "specification, temperature limit or lifespan, and the agency for a rule or tax credit. Use at most two searches for an item, then move on.",
      "P305: a rebate, incentive, tax credit, permit, fee or local cost is LOCAL. Search it WITH the article's own city and state (they are in its topic",
      "or primary search), and cite only the utility, agency or program that serves that place. The same figure from another region's utility,",
      "county or program is wrong for these readers, however official its page.",
      "Cite only pages that state the figure; never blogs, forums, social media or aggregators for these figures.",
      "Then write a short brief: for each item, the figure exactly as its page states it, with its conditions, citing the page.",
    ].join(" "),
    userMessage: [
      `Article topic: ${args.label}`,
      `Primary search: ${args.primaryKeyword}`,
      "ITEMS WITHOUT A FIGURE YET (find each on its owner's page):",
      ...args.items.map((item) => `- ${item}`),
      args.targetCountry ? `Readers are in: ${args.targetCountry}` : "",
      competitorsLine(args.competitors),
    ].filter(Boolean).join("\n"),
  };
}
