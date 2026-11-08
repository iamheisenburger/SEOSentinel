"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Wordmark } from "@/components/marketing/wordmark";
import { DomainInput } from "@/components/ui/domain-input";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError, ScreenErrorBoundary } from "@/components/answers/ui";
import { SiteSetup } from "@/components/answers/onboarding/site-setup";
import { useAnswersActions, useAnswersQuery, useAppHref } from "@/lib/answers/backend";
import { DOMAIN_ERROR, normalizeDomain, startAuthHref, startHref } from "@/lib/domain-input";
import { createSiteWithEmail } from "@/lib/answers/create-site";
import { HONESTY_LINE, SNAPSHOT } from "@/lib/product-facts";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

export type StartAuth = "loading" | "signed-out" | "signed-in" | "session-error";

/** The steps a new account goes through, in order. */
export const START_STEPS = ["Your website", "Account", "What we understood", "Asking the assistants", "Your snapshot"] as const;
export type StartStep = 0 | 1 | 2 | 3 | 4;

const STORAGE_KEY = "pentra_start_domain";
function remember(domain: string) {
  try { sessionStorage.setItem(STORAGE_KEY, domain); } catch { /* Optional: the redirect keeps it too. */ }
}
function recall(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function forget() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Optional. */ }
}
const noSubscribe = () => () => {};
/** The domain kept across the sign-up redirect (read after hydration; null on the server). */
function useRemembered(): string | null {
  return useSyncExternalStore(noSubscribe, recall, () => null);
}

/**
 * /start: domain, then a Pentra account (the domain survives the sign-up redirect), then the site is created and
 * read, the owner confirms what Pentra understood, the first hour runs live, and the snapshot, drafts and upgrade
 * follow. Each step reads the backend's own state, so a refresh or an emailed link lands on the right one.
 */
export function StartFlow({ auth, account, email }: { auth: StartAuth; account?: ReactNode; email?: string | null }) {
  const params = useSearchParams();
  const domainParam = params.get("domain");
  const siteParam = params.get("site");
  const [step, setStep] = useState<StartStep>(siteParam ? 2 : domainParam && auth === "signed-in" ? 2 : domainParam ? 1 : 0);

  let body: ReactNode;
  if (auth === "loading") body = <StepSkeleton />;
  else if (auth === "session-error") body = <SessionError />;
  else if (auth === "signed-out") body = <SignedOut requested={domainParam} />;
  else if (siteParam) body = <SiteSetup siteId={siteParam} onStep={setStep} />;
  else if (domainParam) body = <CreateSite requested={domainParam} email={email ?? null} />;
  else body = <SignedInEntry />;

  const shownStep: StartStep = auth === "signed-out" ? (normalizeDomain(domainParam) ? 1 : 0) : auth !== "signed-in" ? 1 : siteParam ? step : 2;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="sticky top-0 z-40 border-b border-border bg-[rgba(8,9,10,0.82)] backdrop-blur-[20px]">
        <div className="mx-auto flex h-[60px] max-w-[1200px] items-center gap-6 px-[var(--gutter)]">
          <Wordmark />
          <StepIndicator current={shownStep} />
          <div className="ml-auto flex items-center gap-3">
            {auth === "signed-out" ? (
              <Link href="/sign-in" className="rounded-control px-2 py-1 text-[13px] font-medium text-text-2 transition-colors hover:text-text">Sign in</Link>
            ) : (
              account
            )}
          </div>
        </div>
      </header>
      <main id="main" className="page-enter flex-1">
        <ScreenErrorBoundary fallbackClassName="mx-auto max-w-[640px] px-[var(--gutter)] py-16">{body}</ScreenErrorBoundary>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-[var(--gutter)] py-6 text-[13px] leading-5 text-text-3 md:flex-row md:items-center md:justify-between">
          <p className="max-w-[640px]">{HONESTY_LINE}</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link href="/method" className="hover:text-text">How we measure</Link>
            <Link href="/legal/privacy" className="hover:text-text">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-text">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function StepIndicator({ current }: { current: StartStep }) {
  return (
    <ol aria-label="Setup steps" className="hidden items-center gap-1 lg:flex">
      {START_STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "next";
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className="mx-1 h-px w-4 bg-border-strong" />}
            <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium",
              state === "current" ? "bg-surface-2 text-text" : state === "done" ? "text-text-3" : "text-text-4")}>
              {state === "done" ? <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2} /> : <span className="font-mono text-[11px]">{i + 1}</span>}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SessionError() {
  return (
    <section className="mx-auto max-w-[640px] px-[var(--gutter)] py-16 sm:py-24">
      <h1 className="type-h2 text-text">Your session isn&apos;t ready</h1>
      <p className="type-lead mt-4">We couldn&apos;t confirm your sign-in. Try again, or sign in again. Nothing you did is lost.</p>
      <div className="mt-8 flex gap-3">
        <Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button>
        <ButtonLink href="/sign-in?redirect_url=%2Fstart">Sign in</ButtonLink>
      </div>
    </section>
  );
}

function StepSkeleton() {
  return (
    <div className="mx-auto max-w-[640px] px-[var(--gutter)] py-20" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-4 h-10 w-3/4" />
      <Skeleton className="mt-5 h-4 w-full" />
      <Skeleton className="mt-10 h-14 w-full" />
    </div>
  );
}

const WHAT_HAPPENS = [
  "Pentra reads your site, and you confirm what you sell, where, and who you compete with.",
  `It writes about ${SNAPSHOT.questions} questions your buyers ask AI assistants.`,
  `It asks ${SNAPSHOT.assistants} assistants every question: about ${SNAPSHOT.answers} answers, each kept in full.`,
  `It writes your first ${SNAPSHOT.draftPages} answer pages, as drafts you can read and edit.`,
];

/** Signed out: the domain (from the hero, or typed here), then Pentra's own sign-up with the domain kept. */
function SignedOut({ requested }: { requested: string | null }) {
  const domain = normalizeDomain(requested);
  const router = useRouter();
  const href = useAppHref();
  useEffect(() => { if (domain) remember(domain); }, [domain]);
  if (!domain) {
    return (
      <section aria-labelledby="start-title" className="mx-auto max-w-[640px] px-[var(--gutter)] py-16 sm:py-24">
        <p className="text-[14px] font-medium text-text-3">Free snapshot</p>
        <h1 id="start-title" className="type-h1 mt-3 text-text">Which site should we check?</h1>
        <p className="type-lead mt-5">Pentra asks {SNAPSHOT.assistants} AI assistants the questions your buyers ask and shows you every answer.</p>
        {requested && (
          <p role="alert" className="mt-6 text-[14px] leading-[22px] text-wrong">&ldquo;{requested.slice(0, 80)}&rdquo; isn&apos;t a website address. {DOMAIN_ERROR}</p>
        )}
        <div className="mt-8">
          <DomainInput id="start-domain" autoFocus={!requested} onDomain={(d) => router.push(href(startHref(d)))} />
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="start-title" className="mx-auto max-w-[640px] px-[var(--gutter)] py-16 sm:py-24">
      <p className="text-[14px] font-medium text-text-3">Free snapshot · step 2 of 5</p>
      <h1 id="start-title" className="type-h1 mt-3 text-text [overflow-wrap:anywhere]">Create your account to check {domain}</h1>
      <p className="type-lead mt-5">Your account is where the snapshot is saved. No card. In about an hour you&apos;ll see how {SNAPSHOT.assistants} assistants answer your buyers, with every answer as proof.</p>
      <ol className="mt-10 border-t border-border">
        {WHAT_HAPPENS.map((line, i) => (
          <li key={line} className="grid grid-cols-[40px_minmax(0,1fr)] border-b border-border py-4 text-[15px] leading-6 text-text-2">
            <span className="mono-label pt-1 text-text-3">0{i + 1}</span>
            <span className="[text-wrap:pretty]">{line}</span>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
        <ButtonLink href={startAuthHref("/sign-up", domain)} size="lg" iconRight={<ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />} className="w-full sm:w-auto">
          Create free account
        </ButtonLink>
        <ButtonLink href={startAuthHref("/sign-in", domain)} variant="secondary" size="lg" className="w-full sm:w-auto">I have an account</ButtonLink>
      </div>
      <p className="mt-6 text-[14px] leading-[22px] text-text-3">
        Not your site?{" "}
        <Link href={href("/start")} className="link">Use a different address</Link>
      </p>
    </section>
  );
}

/** Signed in with a domain: the site is created (once) and the page moves to its setup. */
function CreateSite({ requested, email }: { requested: string; email: string | null }) {
  const domain = normalizeDomain(requested);
  const actions = useAnswersActions();
  const router = useRouter();
  const href = useAppHref();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(domain ? null : DOMAIN_ERROR);
  useEffect(() => {
    if (!domain || started.current) return;
    started.current = true;
    // The owner's email goes with the site, so the first hour's "ready" email reaches them.
    createSiteWithEmail(actions.createSite, domain, email)
      .then(({ siteId }) => { forget(); router.replace(href(`/start?site=${encodeURIComponent(siteId)}`)); })
      .catch((e) => setError(userErrorMessage(e, `Pentra couldn't add ${domain}. Check the address and try again.`)));
  }, [domain, email, actions, router, href]);
  if (error) {
    const alreadyTracking = /already tracks/i.test(error);
    return (
      <section className="mx-auto max-w-[640px] px-[var(--gutter)] py-16 sm:py-24">
        <h1 className="type-h2 text-text">{alreadyTracking ? "Your account already has a website" : "That address didn't work"}</h1>
        <InlineError className="mt-6" title={error}
          actions={alreadyTracking ? <ButtonLink href={href("/dashboard")} size="sm">Go to your dashboard</ButtonLink> : undefined}>
          {alreadyTracking ? "Pentra tracks one website per account for now." : "Check the spelling, or try the address you see in your browser."}
        </InlineError>
        <div className="mt-8">
          <DomainInput id="start-retry" defaultValue={domain ?? requested.slice(0, 80)} note={null} buttonLabel="Check this site"
            onDomain={(d) => { started.current = false; setError(null); router.replace(href(startHref(d))); }} />
        </div>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-[640px] px-[var(--gutter)] py-16 sm:py-24" aria-busy="true">
      <p className="text-[14px] font-medium text-text-3">Free snapshot</p>
      <h1 className="type-h1 mt-3 text-text [overflow-wrap:anywhere]">Adding {domain}…</h1>
      <p className="type-lead mt-5">Pentra starts reading the site as soon as it&apos;s added.</p>
    </section>
  );
}

/** Signed in, nothing in the URL: continue the setup in progress, or start one. */
function SignedInEntry() {
  const sites = useAnswersQuery("mySites", {});
  const router = useRouter();
  const href = useAppHref();
  const remembered = useRemembered();
  const pending = sites?.find((s) => s.answers && !s.confirmed);
  const confirmed = sites?.find((s) => s.answers && s.confirmed);
  useEffect(() => {
    if (remembered) router.replace(href(startHref(remembered)));
    else if (pending) router.replace(href(`/start?site=${encodeURIComponent(pending.siteId)}`));
  }, [remembered, pending, router, href]);
  if (sites === undefined || remembered || pending) return <StepSkeleton />;
  return (
    <section aria-labelledby="start-title" className="mx-auto max-w-[640px] px-[var(--gutter)] py-16 sm:py-24">
      {confirmed ? (
        <>
          <h1 id="start-title" className="type-h1 text-text">You&apos;re set up</h1>
          <p className="type-lead mt-5">Pentra already tracks {confirmed.domain} for your account.</p>
          <div className="mt-8 flex gap-3">
            <ButtonLink href={href(`/start?site=${encodeURIComponent(confirmed.siteId)}`)} variant="secondary">See your snapshot</ButtonLink>
            <ButtonLink href={href("/dashboard")}>Open the dashboard</ButtonLink>
          </div>
        </>
      ) : (
        <>
          <p className="text-[14px] font-medium text-text-3">Free snapshot</p>
          <h1 id="start-title" className="type-h1 mt-3 text-text">Which site should we check?</h1>
          <p className="type-lead mt-5">Enter your website. Pentra reads it first, and you confirm what it understood before any assistant is asked.</p>
          <div className="mt-8">
            <DomainInput id="start-domain" autoFocus onDomain={(d) => router.push(href(startHref(d)))} />
          </div>
        </>
      )}
    </section>
  );
}

export function StartAgainButton() {
  const router = useRouter();
  const href = useAppHref();
  return <Button variant="ghost" size="sm" onClick={() => router.push(href("/start"))}>Use a different address</Button>;
}
