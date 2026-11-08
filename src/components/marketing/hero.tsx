import { DomainInput } from "@/components/ui/domain-input";
import { EvidenceCarousel } from "@/components/ui/evidence-card";
import { HERO_ANSWERS, SAMPLE_LABEL } from "@/components/marketing/samples";
import { HERO_FORM_ANCHOR, HERO_INPUT_ID } from "@/lib/marketing-ids";
import { ASSISTANT_NAMES_SENTENCE } from "@/lib/product-facts";

/**
 * The first viewport: the promise and the one field on the left, a real AI answer on the right. The answer is
 * built in code from sample data, cycles through the five assistants, and says plainly that it is an example.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pb-20 pt-[116px] sm:pt-[132px] lg:pb-28 lg:pt-[156px]">
      <div className="container-page grid grid-cols-1 items-center gap-x-8 gap-y-14 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <h1 id="hero-title" className="type-display text-text">
            See what AI assistants say about your business.
          </h1>
          <p className="type-lead mt-6 max-w-[34rem]">
            Pentra asks {ASSISTANT_NAMES_SENTENCE} the questions your buyers ask, shows who they name, and writes the
            pages that answer them.
          </p>
          <div id={HERO_FORM_ANCHOR} className="mt-9">
            <DomainInput id={HERO_INPUT_ID} />
          </div>
        </div>
        <div className="w-full min-w-0 lg:col-span-7 lg:max-w-[560px] lg:justify-self-end">
          <EvidenceCarousel
            answers={HERO_ANSWERS}
            label={SAMPLE_LABEL}
            caption="A sample business with fictional names. In your snapshot, every count opens to real answers like this one."
          />
        </div>
      </div>
    </section>
  );
}
