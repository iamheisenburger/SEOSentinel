import { Ghost, Github, Globe, ShoppingBag, Webhook } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";
import { PUBLISH_TARGETS, type PublishTargetId } from "@/lib/product-facts";

/** Monochrome marks, 20px at 1.5 stroke, that identify each platform. Drawn or from Lucide; never logo files. */
function TargetMark({ id }: { id: PublishTargetId }) {
  const props = { className: "h-5 w-5", strokeWidth: 1.5, "aria-hidden": true } as const;
  switch (id) {
    case "wordpress":
      return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
          <circle cx="10" cy="10" r="8.25" />
          <path d="M4.75 7.25 7.5 15l2.5-6.5L12.5 15l2.75-7.75M3.75 7.25h3M13.5 7.25h2.75" />
        </svg>
      );
    case "webflow":
      return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
          <path d="M1.75 5.5 5.25 14.5l3-6.25 3 6.25L18.25 5.5" />
        </svg>
      );
    case "shopify":
      return <ShoppingBag {...props} />;
    case "ghost":
      return <Ghost {...props} />;
    case "github":
      return <Github {...props} />;
    case "webhook":
      return <Webhook {...props} />;
    case "hosted":
      return <Globe {...props} />;
  }
}

export function PublishTargets() {
  return (
    <Section labelledBy="publish-title">
      <SectionHeading
        id="publish-title"
        title="Publishes where your site already lives."
        lead="Connect your site once, or let Pentra host the pages on your own subdomain."
      />
      <Reveal as="ul" className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-4 lg:grid-cols-7">
        {PUBLISH_TARGETS.map((target) => (
          <li key={target.id} data-reveal className="flex flex-col bg-bg p-5">
            <span className="text-text-2">
              <TargetMark id={target.id} />
            </span>
            <span className="mt-5 text-[14px] font-semibold leading-5 text-text">{target.name}</span>
            <span className="mt-1 text-[13px] leading-5 text-text-3 [text-wrap:pretty]">{target.detail}</span>
          </li>
        ))}
        {/* Keeps the 2- and 4-column grids even. */}
        <li aria-hidden="true" className="bg-bg lg:hidden" />
      </Reveal>
      <p className="mt-6 max-w-[640px] text-[14px] leading-[22px] text-text-2">
        Hosting with Pentra takes one DNS record for answers.yourdomain.com, and Pentra shows you the exact record to copy.
      </p>
    </Section>
  );
}
