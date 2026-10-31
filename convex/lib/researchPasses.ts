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
 * "best scheduling software for yoga studios"). A list keeps up to LIST_RESEARCH_SOURCES sources, one an option. */
export const LIST_RESEARCH_SOURCES = 8;
export function optionSourcesRequest(args: { label: string; primaryKeyword: string; options: readonly string[]; targetCountry?: string }) {
  return {
    system: [
      "You research a list article that compares named options. For each option, use web search to find its own official pages: features, plans and pricing, and its help centre or documentation.",
      "Cite those pages for what each option offers and costs; skip an option whose own pages you can't find. Do not cite review sites, affiliate lists, forums, social media or news aggregators.",
      "Then write a short research brief: for each option, the facts its own pages state, citing the page each fact comes from. Quote only what the pages say; do not add facts of your own.",
    ].join(" "),
    userMessage: [
      `Article topic: ${args.label}`,
      `Primary search: ${args.primaryKeyword}`,
      `Options to research, each on its own website: ${args.options.join(", ")}`,
      args.targetCountry ? `Readers are in: ${args.targetCountry}` : "",
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
