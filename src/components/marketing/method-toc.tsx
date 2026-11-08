"use client";

import { useEffect, useState } from "react";
import { cx } from "@/lib/cx";

/** "On this page" for long pages: the section under the reading line is marked as current. */
export function OnThisPage({ sections }: { sections: readonly { id: string; title: string }[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | null = null;
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= 160) current = section.id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections[sections.length - 1]?.id ?? current;
      setActive(current ?? sections[0]?.id ?? null);
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
  }, [sections]);

  return (
    <nav aria-label="On this page" className="sticky top-[100px]">
      <p className="text-[13px] font-medium text-text-3">On this page</p>
      <ol className="mt-4 border-l border-border">
        {sections.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={current ? "true" : undefined}
                className={cx(
                  "-ml-px block border-l py-1.5 pl-4 text-[14px] leading-5 transition-colors duration-[var(--d-instant)] ease-out",
                  current ? "border-text text-text" : "border-transparent text-text-3 hover:text-text-2",
                )}
              >
                {section.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
