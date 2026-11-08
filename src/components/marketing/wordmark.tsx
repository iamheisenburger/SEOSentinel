import Link from "next/link";
import { cx } from "@/lib/cx";

/** Pentra's mark: a line of an answer with one name highlighted. Monochrome; Signal Blue stays for "you". */
export function PentraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className={cx("h-5 w-5 shrink-0", className)}>
      <rect width="20" height="20" rx="5.5" fill="currentColor" />
      <g stroke="var(--bg)" strokeLinecap="round">
        <path d="M5.25 6.5h9.5" strokeWidth="1.5" />
        <path d="M5.25 10h3.5" strokeWidth="3" />
        <path d="M11.25 10h3.5" strokeWidth="1.5" />
        <path d="M5.25 13.5h6.5" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

export function Wordmark({ href = "/", className }: { href?: string | null; className?: string }) {
  const content = (
    <>
      <PentraMark className="text-text" />
      <span className="text-[16px] font-semibold tracking-[-0.015em] text-text">Pentra</span>
    </>
  );
  if (href === null) return <span className={cx("inline-flex items-center gap-2", className)}>{content}</span>;
  return (
    <Link href={href} aria-label="Pentra home" className={cx("inline-flex items-center gap-2 rounded-control", className)}>
      {content}
    </Link>
  );
}
