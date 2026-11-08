"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { Menu, X } from "lucide-react";
import { UserButton, useAuth } from "@clerk/nextjs";
import { Wordmark } from "@/components/marketing/wordmark";
import { useOverlay } from "@/components/ui/overlay";
import { buttonStyles } from "@/components/ui/button";
import { cx } from "@/lib/cx";
import { HERO_FORM_ANCHOR, HERO_INPUT_ID } from "@/lib/marketing-ids";

/** Sections on the landing page the nav glides to; elsewhere they link back to them. */
const NAV_LINKS = [
  { label: "How it works", section: "how-it-works", href: "/#how-it-works" },
  { label: "Proof", section: "proof", href: "/#proof" },
  { label: "Pricing", section: "pricing", href: "/pricing" },
  { label: "FAQ", section: "faq", href: "/#faq" },
] as const;

/** Puts the cursor in the hero field: right away near the top, after the glide further down. */
export function focusHeroInput(event: MouseEvent<HTMLElement>) {
  const input = document.getElementById(HERO_INPUT_ID) as HTMLInputElement | null;
  const target = document.getElementById(HERO_FORM_ANCHOR);
  if (!input || !target) return;
  event.preventDefault();
  const rect = target.getBoundingClientRect();
  const inView = rect.top >= 60 && rect.bottom <= window.innerHeight;
  if (inView) {
    input.focus();
    return;
  }
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    input.focus({ preventScroll: true });
  };
  window.addEventListener("scrollend", finish, { once: true });
  window.setTimeout(finish, reduce ? 0 : 700);
}

/** The landing section currently under the nav, for the sliding underline. */
function useActiveSection(enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | null = null;
      for (const link of NAV_LINKS) {
        const element = document.getElementById(link.section);
        if (element && element.getBoundingClientRect().top <= 140) current = link.section;
      }
      // At the very bottom the last section wins even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = NAV_LINKS[NAV_LINKS.length - 1]!.section;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [enabled]);
  return enabled ? active : null;
}

/**
 * Marketing nav: 60px, frosted, fixed. Its bottom border fades in after 8px of scroll. On the landing page the
 * links glide to their sections and an underline follows the section in view; on other pages they lead back.
 * Phones get a menu that drops from the top.
 */
export function LandingNav() {
  const pathname = usePathname();
  const onLanding = pathname === "/";
  const { isSignedIn } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const activeSection = useActiveSection(onLanding);
  const linksRef = useRef<HTMLDivElement>(null);
  const underlineRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menu = useOverlay({ open: menuOpen, onClose: () => setMenuOpen(false), panelRef });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const currentKey = onLanding ? activeSection : pathname === "/pricing" ? "pricing" : null;

  // The underline is placed directly on the element; it slides (200ms) after its first placement.
  useLayoutEffect(() => {
    const underline = underlineRef.current;
    const container = linksRef.current;
    if (!underline || !container) return;
    const link = currentKey ? container.querySelector<HTMLElement>(`[data-section="${currentKey}"]`) : null;
    if (!link) {
      underline.style.opacity = "0";
      return;
    }
    const wasHidden = underline.style.opacity !== "1";
    if (wasHidden) underline.removeAttribute("data-ready");
    underline.style.width = `${link.offsetWidth - 24}px`;
    underline.style.translate = `${link.offsetLeft + 12}px 0`;
    underline.style.opacity = "1";
    if (wasHidden) requestAnimationFrame(() => underline.setAttribute("data-ready", ""));
  }, [currentKey]);

  const linkClass = (key: string) =>
    cx(
      "relative inline-flex h-9 items-center rounded-control px-3 text-[13px] font-medium tracking-[0.01em] transition-colors duration-[var(--d-instant)] ease-out",
      currentKey === key ? "text-text" : "text-text-2 hover:text-text",
    );

  const checkCta = onLanding ? (
    <a href="#check" onClick={focusHeroInput} className={buttonStyles({ size: "sm" })}>
      Check my site
    </a>
  ) : (
    <Link href="/start" className={buttonStyles({ size: "sm" })}>
      Check my site
    </Link>
  );

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-control focus:bg-action focus:px-3 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-on-action"
      >
        Skip to content
      </a>
      <header
        className={cx(
          "fixed inset-x-0 top-0 z-50 h-[60px] border-b bg-[rgba(8,9,10,0.72)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)]",
          "pr-[var(--scrollbar-comp,0px)] transition-[border-color] duration-[var(--d-state)] ease-out",
          scrolled || menuOpen ? "border-border" : "border-transparent",
        )}
      >
        <div className="container-page grid h-full grid-cols-[1fr_auto] items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
          <Wordmark className="justify-self-start" />

          <nav aria-label="Main" className="hidden md:block">
            <div ref={linksRef} className="relative flex items-center">
              {NAV_LINKS.map((link) =>
                onLanding ? (
                  <a key={link.section} href={`#${link.section}`} data-section={link.section} aria-current={currentKey === link.section ? "true" : undefined} className={linkClass(link.section)}>
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.section} href={link.href} data-section={link.section} aria-current={currentKey === link.section ? "page" : undefined} className={linkClass(link.section)}>
                    {link.label}
                  </Link>
                ),
              )}
              <span
                ref={underlineRef}
                aria-hidden="true"
                className="pointer-events-none absolute bottom-[5px] left-0 h-px w-0 bg-text opacity-0 data-[ready]:transition-[translate,width,opacity] data-[ready]:duration-[var(--d-state)] data-[ready]:ease-in-out"
              />
            </div>
          </nav>

          <div className="flex items-center justify-self-end gap-1.5">
            {isSignedIn ? (
              <>
                <span className="hidden sm:inline-flex">
                  <Link href="/dashboard" className={buttonStyles({ variant: "ghost", size: "sm" })}>
                    Dashboard
                  </Link>
                </span>
                <div className="flex h-8 w-8 items-center justify-center">
                  <UserButton userProfileMode="modal" />
                </div>
              </>
            ) : (
              <>
                <span className="hidden sm:inline-flex">
                  <Link href="/sign-in" className={buttonStyles({ variant: "ghost", size: "sm" })}>
                    Sign in
                  </Link>
                </span>
                <span className="hidden sm:inline-flex">{checkCta}</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-control text-text-2 transition-colors duration-[var(--d-instant)] hover:bg-surface-2 hover:text-text md:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" /> : <Menu className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      {menu.present && (
        <div className="fixed inset-x-0 bottom-0 top-[60px] z-40 md:hidden">
          <div data-state={menu.state} aria-hidden="true" onClick={() => setMenuOpen(false)} className="motion-scrim absolute inset-0 bg-scrim" />
          <div
            ref={panelRef}
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            data-state={menu.state}
            onAnimationEnd={menu.onAnimationEnd}
            className="motion-drop relative border-b border-border bg-bg px-[var(--gutter)] pb-6 pt-2 outline-none"
          >
            <nav aria-label="Main">
              <ul>
                {NAV_LINKS.map((link) => (
                  <li key={link.section} className="border-b border-border">
                    {onLanding ? (
                      <a
                        href={`#${link.section}`}
                        onClick={(event) => {
                          // Close first (which releases the scroll lock), then glide to the section.
                          event.preventDefault();
                          setMenuOpen(false);
                          requestAnimationFrame(() => {
                            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                            document.getElementById(link.section)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
                            history.pushState(null, "", `#${link.section}`);
                          });
                        }}
                        className="flex h-12 items-center text-[17px] font-medium text-text"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} onClick={() => setMenuOpen(false)} className="flex h-12 items-center text-[17px] font-medium text-text">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
                <li className="border-b border-border">
                  <Link href="/method" onClick={() => setMenuOpen(false)} className="flex h-12 items-center text-[17px] font-medium text-text">
                    How we measure
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="mt-6 grid gap-2">
              {isSignedIn ? (
                <Link href="/dashboard" onClick={() => setMenuOpen(false)} className={buttonStyles({ size: "lg" })}>
                  Dashboard
                </Link>
              ) : (
                <>
                  {onLanding ? (
                    <a
                      href="#check"
                      onClick={(event) => {
                        event.preventDefault();
                        setMenuOpen(false);
                        requestAnimationFrame(() => focusHeroInput(event));
                      }}
                      className={buttonStyles({ size: "lg" })}
                    >
                      Check my site
                    </a>
                  ) : (
                    <Link href="/start" onClick={() => setMenuOpen(false)} className={buttonStyles({ size: "lg" })}>
                      Check my site
                    </Link>
                  )}
                  <Link href="/sign-in" onClick={() => setMenuOpen(false)} className={buttonStyles({ variant: "secondary", size: "lg" })}>
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
