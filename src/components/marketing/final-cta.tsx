import { DomainInput } from "@/components/ui/domain-input";
import { Reveal } from "@/components/ui/reveal";
import { TIMING } from "@/lib/product-facts";

/** The domain field again, last thing on the page. */
export function FinalCta({ title = "See what AI says about you." }: { title?: string }) {
  return (
    <section aria-labelledby="final-cta-title" className="section border-t border-border">
      <Reveal className="container-page flex flex-col items-center text-center">
        <h2 id="final-cta-title" data-reveal className="type-h1 max-w-[720px] text-text">
          {title}
        </h2>
        <p data-reveal className="type-lead mt-4 max-w-[520px] [text-wrap:balance]">
          Enter your domain. The snapshot is free and ready in about {TIMING.snapshotMinutes} minutes; the first answers arrive in under {TIMING.firstAnswersMinutes}.
        </p>
        <div data-reveal className="mt-9 flex w-full justify-center">
          <DomainInput id="final-domain" align="center" />
        </div>
      </Reveal>
    </section>
  );
}
