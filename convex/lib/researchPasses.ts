/** P256 (Oct 30 2026): Cowork's fresh-account first article ("What Should a Freelance Invoice Include?") kept one
 * source. Research cited 8 pages, 6 of them vendor blogs that strict evidence cannot use, so the article's US half had
 * nothing behind it. When the first pass keeps fewer than two readable sources, one more bounded pass asks for primary
 * sources only and names the sites already found unusable. More sources, not more checks. */
// P258 (Oct 30 2026), Arshad's cost rule: research gathers 3 to 5 real sources before writing.
export const PRIMARY_PASS_BELOW = 3;
export const MAX_RESEARCH_SOURCES = 5;
export const PRIMARY_PASS_SEARCHES = 4;

export function primarySourcesRequest(args: { label: string; primaryKeyword: string; secondaryKeywords?: string[];
  targetCountry?: string; siteName: string; avoidHosts: string[] }) {
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
export function optionSourcesRequest(args: { label: string; primaryKeyword: string; options: readonly string[]; targetCountry?: string; productName?: string }) {
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
  avoidHosts: string[] }) {
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
  const owners = sources.filter((source) => role(source.url) === "owner");
  const publications = sources.filter((source) => role(source.url) === "publication");
  const blogs = sources.filter((source) => role(source.url) === "blog");
  const strong = [...owners, ...publications].slice(0, limit);
  const context = blogs.slice(0, Math.max(0, Math.min(2, MIN_STRONG_SOURCES - strong.length, limit - strong.length)));
  return { kept: [...strong, ...context], role, counts: { owner: Math.min(owners.length, limit), publication: strong.length - Math.min(owners.length, limit),
    context: context.length, dropped: blogs.length - context.length } };
}
