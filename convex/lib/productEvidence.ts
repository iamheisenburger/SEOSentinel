/** The owner's call to action exactly as the writer is told to link it. */
export function configuredCallToAction(site: { ctaText?: string; ctaUrl?: string; domain: string }, productName: string) {
  return {
    label: site.ctaText || `Try ${productName}`,
    url: site.ctaUrl || `https://${site.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`,
  };
}

/** First-party evidence about the customer's own product: what the owner
 * configured plus the crawled pages. The owner's call-to-action link is part
 * of it. The writer is told to link exactly that URL, and crawled page text
 * carries no link targets, so without it every review flagged the article's
 * own sign-up link as "not confirmed by first-party evidence". */
export function firstPartyProductEvidence(args: {
  productName: string;
  site: { domain: string; siteSummary?: string; keyFeatures?: string[]; pricingInfo?: string; ctaText?: string; ctaUrl?: string };
  crawled: { homepage?: string; features?: string; pricing?: string };
}): string {
  const { site, crawled } = args;
  const cta = configuredCallToAction(site, args.productName);
  return [
    `Name: ${args.productName}`,
    `Domain: ${site.domain}`,
    site.siteSummary ? `Summary: ${site.siteSummary}` : "",
    site.keyFeatures?.length
      ? `Configured features:\n${site.keyFeatures.map((feature) => `- ${feature}`).join("\n")}`
      : "",
    site.pricingInfo ? `Configured pricing:\n${site.pricingInfo}` : "",
    `Configured call to action (the owner's own next-step link; articles may link to it): "${cta.label}" ${cta.url}`,
    crawled.homepage ? `Crawled homepage:\n${crawled.homepage.slice(0, 4000)}` : "",
    crawled.features ? `Crawled features page:\n${crawled.features.slice(0, 4000)}` : "",
    crawled.pricing ? `Crawled pricing page:\n${crawled.pricing.slice(0, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
