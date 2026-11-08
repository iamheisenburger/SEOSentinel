import type { ReactNode } from "react";
import { LandingNav } from "@/components/layout/landing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { cx } from "@/lib/cx";

/** Nav, page content (which enters once per navigation) and footer for every public page. */
export function MarketingShell({
  children,
  className,
  footer = true,
}: {
  children: ReactNode;
  className?: string;
  footer?: boolean;
}) {
  return (
    <>
      <LandingNav />
      <main id="main" className={cx("page-enter", className)}>
        {children}
      </main>
      {footer && <MarketingFooter />}
    </>
  );
}
