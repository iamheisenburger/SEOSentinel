import { Accordion } from "@/components/ui/accordion";
import { Reveal } from "@/components/ui/reveal";
import { Section } from "@/components/marketing/section";
import { SUPPORT_EMAIL } from "@/lib/product-facts";

export function Faq({
  id = "faq",
  title = "Questions",
  items,
}: {
  id?: string;
  title?: string;
  items: { id: string; question: string; answer: string }[];
}) {
  return (
    <Section id={id} labelledBy={`${id}-title`}>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-16">
        <Reveal>
          <h2 id={`${id}-title`} data-reveal className="type-h2 text-text">
            {title}
          </h2>
          <p data-reveal className="mt-4 max-w-[320px] text-[15px] leading-6 text-text-2">
            Anything else? Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="link">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </Reveal>
        <Accordion items={items.map((item) => ({ id: item.id, title: item.question, content: item.answer }))} />
      </div>
    </Section>
  );
}
