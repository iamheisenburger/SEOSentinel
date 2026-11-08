import Link from "next/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { SUPPORT_EMAIL } from "@/lib/product-facts";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Proof", href: "/#proof" },
      { label: "Pricing", href: "/pricing" },
      { label: "FAQ", href: "/#faq" },
      { label: "Blog", href: "/blog" },
    ],
  },
  { title: "Method", links: [{ label: "How we measure", href: "/method" }] },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Terms", href: "/legal/terms" },
    ],
  },
  {
    title: "Contact",
    links: [
      { label: "Contact", href: "/contact" },
      { label: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="container-page grid grid-cols-1 gap-12 py-16 md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] md:gap-8">
        <div className="max-w-[280px]">
          <Wordmark />
          <p className="mt-4 text-[14px] leading-[22px] text-text-3">
            Pentra helps AI assistants recommend your business, and shows you every answer.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4 md:col-span-4">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-[13px] font-medium text-text-3">{column.title}</h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.href.startsWith("mailto:") ? (
                      <a href={link.href} className="break-all text-[14px] text-text-2 transition-colors duration-[var(--d-instant)] hover:text-text">
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className="text-[14px] text-text-2 transition-colors duration-[var(--d-instant)] hover:text-text">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-page flex flex-col gap-2 py-6 text-[13px] leading-5 text-text-3 md:flex-row md:items-center md:justify-between">
          <p>&copy; {new Date().getFullYear()} Pentra</p>
          <p className="max-w-[640px] md:text-right">
            ChatGPT, Perplexity, Gemini and Google are trademarks of their owners. Pentra is independent and not affiliated with them.
          </p>
        </div>
      </div>
    </footer>
  );
}
