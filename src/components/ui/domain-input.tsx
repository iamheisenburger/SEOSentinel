"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Spinner } from "@/components/ui/button";
import { cx } from "@/lib/cx";
import { DOMAIN_ERROR, normalizeDomain, startHref, stripPastedUrl } from "@/lib/domain-input";

export const DOMAIN_NOTE = "Free. No card. Results in about an hour; first answers in minutes.";

/**
 * The hero field: one input, one white button. A mono "https://" sits in front so people know an address
 * goes here; a pasted URL loses its protocol and path at once; the address is checked on submit only, then
 * the visitor goes to /start?domain=… . When the field itself is narrower than 432px (phones, the 1024px hero
 * column) the button stacks under it at full width; the layout follows the field's width, not the viewport.
 */
export function DomainInput({
  id,
  defaultValue,
  buttonLabel = "Check my site",
  note = DOMAIN_NOTE,
  autoFocus = false,
  align = "left",
  className,
  onDomain,
}: {
  id?: string;
  defaultValue?: string;
  buttonLabel?: string;
  /** Pass null to hide the note. */
  note?: ReactNode | null;
  autoFocus?: boolean;
  /** Where the note and the error sit under the field. */
  align?: "left" | "center";
  className?: string;
  /** Replaces the default navigation to /start (used by tests and embedded flows). */
  onDomain?: (domain: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Autofocus only with a mouse or trackpad: on phones it would throw the keyboard up unasked.
  useEffect(() => {
    if (!autoFocus) return;
    if (window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const [pending, startTransition] = useTransition();
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-domain`;
  const errorId = `${inputId}-error`;
  const noteId = `${inputId}-note`;

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    const cleaned = stripPastedUrl(pasted);
    if (cleaned === pasted) return;
    // Insert the cleaned text where the paste would have gone; the paste itself is never blocked.
    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(cleaned, start, end, "end");
    if (error) setError(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domain = normalizeDomain(inputRef.current?.value);
    if (!domain) {
      setError(DOMAIN_ERROR);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    if (inputRef.current) inputRef.current.value = domain;
    if (onDomain) {
      onDomain(domain);
      return;
    }
    startTransition(() => router.push(startHref(domain)));
  }

  const describedBy = [error ? errorId : null, note ? noteId : null].filter(Boolean).join(" ") || undefined;

  return (
    <form noValidate onSubmit={onSubmit} aria-label="Check your website" className={cx("@container w-full max-w-[520px]", className)}>
      <label htmlFor={inputId} className="sr-only">
        Your website address
      </label>
      <div
        className={cx(
          "flex flex-col gap-2 @min-[27rem]:h-14 @min-[27rem]:flex-row @min-[27rem]:items-center @min-[27rem]:gap-0 @min-[27rem]:rounded-[12px] @min-[27rem]:border @min-[27rem]:bg-surface-1 @min-[27rem]:p-1.5 @min-[27rem]:pl-4",
          "@min-[27rem]:transition-[border-color,box-shadow] @min-[27rem]:duration-[var(--d-instant)] @min-[27rem]:ease-out",
          error
            ? "@min-[27rem]:border-wrong @min-[27rem]:focus-within:shadow-[0_0_0_3px_var(--wrong-tint)]"
            : "@min-[27rem]:border-border-strong @min-[27rem]:hover:border-[rgba(255,255,255,0.2)] @min-[27rem]:focus-within:border-[var(--border-focus)] @min-[27rem]:focus-within:shadow-[0_0_0_3px_var(--you-tint)]",
        )}
      >
        {/* Stacked (narrow) layout: this wrapper is the field. Row layout: the row above is the field. */}
        <div
          className={cx(
            "flex min-w-0 items-center @min-[27rem]:h-full @min-[27rem]:flex-1",
            "@max-[27rem]:h-14 @max-[27rem]:rounded-[12px] @max-[27rem]:border @max-[27rem]:bg-surface-1 @max-[27rem]:pl-4",
            "@max-[27rem]:transition-[border-color,box-shadow] @max-[27rem]:duration-[var(--d-instant)] @max-[27rem]:ease-out",
            error
              ? "@max-[27rem]:border-wrong @max-[27rem]:focus-within:shadow-[0_0_0_3px_var(--wrong-tint)]"
              : "@max-[27rem]:border-border-strong @max-[27rem]:focus-within:border-[var(--border-focus)] @max-[27rem]:focus-within:shadow-[0_0_0_3px_var(--you-tint)]",
          )}
        >
          <span aria-hidden="true" className="select-none pr-0.5 font-mono text-[14px] tracking-[0.02em] text-text-4">
            https://
          </span>
          <input
            ref={inputRef}
            id={inputId}
            name="domain"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="yourbusiness.com"
            defaultValue={defaultValue}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onPaste={onPaste}
            onInput={() => {
              if (error) setError(null);
            }}
            className="h-full min-w-0 flex-1 bg-transparent pr-3 text-left text-[16px] text-text outline-none placeholder:text-text-4"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className={cx(
            "inline-flex h-12 shrink-0 items-center justify-center rounded-control bg-action px-5 text-[15px] font-semibold text-on-action @min-[27rem]:h-11 @min-[27rem]:text-[14px]",
            "transition-[background-color,translate,scale] duration-[var(--d-instant)] ease-out hover:bg-action-hover active:scale-[0.98] active:bg-action-active active:duration-[90ms]",
            "disabled:cursor-progress",
          )}
        >
          {/* Both labels share one grid cell, so the button never changes width. */}
          <span className="grid">
            <span className={cx("col-start-1 row-start-1 inline-flex items-center justify-center gap-2", pending && "invisible")}>
              {buttonLabel}
              <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <span
              className={cx("col-start-1 row-start-1 inline-flex items-center justify-center gap-2", !pending && "invisible")}
              aria-hidden={!pending}
            >
              <Spinner />
              Checking…
            </span>
          </span>
        </button>
      </div>
      <div className="mt-3 min-h-5 space-y-1.5">
        {error && (
          <p id={errorId} role="alert" className={cx("flex items-center gap-1.5 text-[13px] leading-5 text-wrong", align === "center" && "justify-center")}>
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
              <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.75v3.75M8 10.9v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {error}
          </p>
        )}
        {note && (
          <p id={noteId} className={cx("text-[13px] leading-5 text-text-3 [text-wrap:pretty]", align === "center" && "text-center")}>
            {note}
          </p>
        )}
      </div>
    </form>
  );
}
