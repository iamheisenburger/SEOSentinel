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
 * the visitor goes to /start?domain=… . Under 640px the button stacks under the field at full width.
 */
export function DomainInput({
  id,
  defaultValue,
  buttonLabel = "Check my site",
  note = DOMAIN_NOTE,
  autoFocus = false,
  className,
  onDomain,
}: {
  id?: string;
  defaultValue?: string;
  buttonLabel?: string;
  /** Pass null to hide the note. */
  note?: ReactNode | null;
  autoFocus?: boolean;
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
    <form noValidate onSubmit={onSubmit} aria-label="Check your website" className={cx("w-full max-w-[520px]", className)}>
      <label htmlFor={inputId} className="sr-only">
        Your website address
      </label>
      <div
        className={cx(
          "flex flex-col gap-2 sm:h-14 sm:flex-row sm:items-center sm:gap-0 sm:rounded-[12px] sm:border sm:bg-surface-1 sm:p-1.5 sm:pl-4",
          "sm:transition-[border-color,box-shadow] sm:duration-[var(--d-instant)] sm:ease-out",
          error
            ? "sm:border-wrong sm:focus-within:shadow-[0_0_0_3px_var(--wrong-tint)]"
            : "sm:border-border-strong sm:hover:border-[rgba(255,255,255,0.2)] sm:focus-within:border-[var(--border-focus)] sm:focus-within:shadow-[0_0_0_3px_var(--you-tint)]",
        )}
      >
        <div
          className={cx(
            "flex h-14 min-w-0 items-center rounded-[12px] border bg-surface-1 pl-4 transition-[border-color,box-shadow] duration-[var(--d-instant)] ease-out sm:h-full sm:flex-1 sm:rounded-none sm:border-0 sm:bg-transparent sm:pl-0 sm:shadow-none",
            error
              ? "border-wrong focus-within:shadow-[0_0_0_3px_var(--wrong-tint)]"
              : "border-border-strong focus-within:border-[var(--border-focus)] focus-within:shadow-[0_0_0_3px_var(--you-tint)]",
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
            "inline-flex h-12 shrink-0 items-center justify-center rounded-control bg-action px-5 text-[15px] font-semibold text-on-action sm:h-11 sm:text-[14px]",
            "transition-[background-color,translate,scale] duration-[var(--d-instant)] ease-out hover:bg-action-hover active:scale-[0.98] active:bg-action-active active:duration-[90ms]",
            "disabled:cursor-progress",
          )}
        >
          {/* Both labels share one grid cell, so the button never changes width. */}
          <span className="grid">
            <span className={cx("col-start-1 row-start-1 inline-flex items-center justify-center gap-2", pending && "invisible")}>
              {buttonLabel}
              <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
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
          <p id={errorId} role="alert" className="flex items-center gap-1.5 text-[13px] leading-5 text-wrong">
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
              <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.75v3.75M8 10.9v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {error}
          </p>
        )}
        {note && (
          <p id={noteId} className="text-[13px] leading-5 text-text-3">
            {note}
          </p>
        )}
      </div>
    </form>
  );
}
