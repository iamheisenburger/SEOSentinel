"use client";

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, fieldStyles } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FitDomain, InlineError, LiveDot } from "@/components/answers/ui";
import { useAnswersActions, useNow } from "@/lib/answers/backend";
import { COUNTRY_OPTIONS, elapsed } from "@/lib/answers/format";
import type { Competitor, SetupState } from "@/lib/answers/types";
import { SNAPSHOT, TIMING } from "@/lib/product-facts";
import { placeFrom, updateBusinessWithPlace } from "@/lib/answers/update-business";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

const MAX_COMPETITORS = 8;
const MAX_OFFERINGS = 10;

/** "apollo.io" → { name: "Apollo", domain: "apollo.io" }; anything else is a name. */
export function parseCompetitor(raw: string): Competitor | null {
  const text = raw.trim();
  if (text.length < 2) return null;
  const host = text.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] ?? "";
  if (!/\s/.test(text) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
    const label = host.split(".").slice(0, -1).filter((p) => !["www", "app", "get", "try"].includes(p)).pop() ?? host.split(".")[0]!;
    return { name: label.charAt(0).toUpperCase() + label.slice(1), domain: host };
  }
  return { name: text.slice(0, 60) };
}

/**
 * "Here's what we understood": what Pentra read on the site, editable, with the competitors as chips. Wrong
 * competitors would poison every count, so this is the one screen before any assistant is asked.
 */
export function Understood({ state, reading }: { state: SetupState; reading: boolean }) {
  return (
    <section aria-labelledby="understood-title" className="mx-auto max-w-[760px] px-[var(--gutter)] py-12 sm:py-16">
      <p className="text-[14px] font-medium text-text-3">Free snapshot · step 3 of 5</p>
      <h1 id="understood-title" className="type-h1 @container mt-3 text-text">
        {reading ? <>Reading{" "}<FitDomain domain={state.domain} className="mt-1" /></> : "Here’s what we understood"}
      </h1>
      <p className="type-lead mt-4">
        {reading
          ? "Pentra is reading your site to describe the business. You'll check it before any assistant is asked."
          : `Check it before Pentra asks ${SNAPSHOT.assistants} assistants about ${SNAPSHOT.questions} questions. Fix anything that's off; the competitors matter most.`}
      </p>
      {reading ? <ReadingPanel /> : <UnderstoodForm key={state.readAt ?? 0} state={state} />}
    </section>
  );
}

function ReadingPanel() {
  const [since] = useState(() => Date.now());
  const now = useNow(1000);
  return (
    <div className="mt-10 overflow-hidden rounded-hero border border-border bg-surface-1" aria-busy="true">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5 text-[14px] text-text-2" role="status">
        <LiveDot />
        Reading the site · <span className="font-mono text-[13px] tabular-nums text-text-3">{elapsed(Math.max(0, now - since))}</span>
        <span className="ml-auto hidden text-[13px] text-text-3 sm:inline">Usually 20 to 40 seconds</span>
      </div>
      <div className="divide-y divide-border">
        {["Business name", "What it sells", "Who buys it", "What it offers", "Market", "City or area", "Competitors"].map((label, i) => (
          <div key={label} className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6">
            <span className="text-[13px] font-medium text-text-3">{label}</span>
            <Skeleton className={cx("h-5", i % 2 ? "w-3/4" : "w-1/2")} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6">
      <div>
        {htmlFor ? <label htmlFor={htmlFor} className="text-[13px] font-medium text-text">{label}</label> : <span className="text-[13px] font-medium text-text">{label}</span>}
        {hint && <p className="mt-0.5 text-[12px] leading-[18px] text-text-3">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Chip({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  return (
    <li className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 pl-3 pr-1 text-[13px] text-text">
      <span className="min-w-0 truncate">{children}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors duration-[var(--d-instant)] hover:bg-surface-3 hover:text-text">
        <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </li>
  );
}

function AddField({ id, placeholder, onAdd, disabled, buttonLabel }: { id: string; placeholder: string; onAdd: (value: string) => boolean; disabled?: boolean; buttonLabel: string }) {
  const [value, setValue] = useState("");
  const add = () => { if (onAdd(value)) setValue(""); };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); add(); } };
  return (
    <div className="flex gap-2">
      <input id={id} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} placeholder={placeholder} disabled={disabled}
        className={cx(fieldStyles, "h-9 min-w-0 flex-1 text-[14px]")} />
      <Button variant="secondary" size="sm" onClick={add} disabled={disabled || value.trim().length < 2} icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.5} />} className="h-9">
        {buttonLabel}
      </Button>
    </div>
  );
}

function UnderstoodForm({ state }: { state: SetupState }) {
  const actions = useAnswersActions();
  const [name, setName] = useState(state.name ?? "");
  const [sells, setSells] = useState(state.sells);
  const [buyers, setBuyers] = useState(state.buyers);
  const [offerings, setOfferings] = useState<string[]>(state.offerings);
  const [country, setCountry] = useState(state.country ?? "US");
  // Filled in only when the read found a local business; an empty field means "not local".
  const [location, setLocation] = useState(state.local ? state.location ?? "" : "");
  const [competitors, setCompetitors] = useState<Competitor[]>(state.competitors.slice(0, MAX_COMPETITORS));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameError = touched && !name.trim() ? "Enter the business's name." : undefined;
  const sellsError = touched && sells.trim().length < 10 ? "Say what the business sells in a sentence." : undefined;

  const addCompetitor = (raw: string) => {
    const parsed = parseCompetitor(raw);
    if (!parsed || competitors.length >= MAX_COMPETITORS) return false;
    if (competitors.some((c) => c.name.toLowerCase() === parsed.name.toLowerCase() || (parsed.domain && c.domain === parsed.domain))) return true;
    setCompetitors((list) => [...list, parsed]);
    return true;
  };
  const addOffering = (raw: string) => {
    const text = raw.trim().slice(0, 120);
    if (text.length < 2 || offerings.length >= MAX_OFFERINGS) return false;
    if (!offerings.some((o) => o.toLowerCase() === text.toLowerCase())) setOfferings((list) => [...list, text]);
    return true;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!name.trim() || sells.trim().length < 10) return;
    setSaving(true);
    setError(null);
    try {
      await updateBusinessWithPlace(actions.updateBusiness, { siteId: state.siteId, name, sells, buyers, offerings }, placeFrom(location));
      await actions.confirmSetup({ siteId: state.siteId, name, competitors, country });
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't save this. Check the fields and try again."));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-10">
      {state.readError && (
        <InlineError className="mb-6" title={`We couldn't read all of ${state.domain}`}>
          {state.readError} Fill in what we missed below; it takes a minute, and everything after this works the same.
        </InlineError>
      )}
      <div className="overflow-hidden rounded-hero border border-border bg-surface-1">
        <div className="divide-y divide-border">
          <Row label="Business name" htmlFor="biz-name">
            <Input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={nameError} placeholder="Your business" />
          </Row>
          <Row label="What it sells" hint="One or two plain sentences." htmlFor="biz-sells">
            <Textarea id="biz-sells" value={sells} onChange={(e) => setSells(e.target.value)} maxLength={600} rows={3} error={sellsError}
              placeholder="What you offer, and the outcome for the customer." />
          </Row>
          <Row label="Who buys it" htmlFor="biz-buyers">
            <Textarea id="biz-buyers" value={buyers} onChange={(e) => setBuyers(e.target.value)} maxLength={300} rows={2} className="min-h-[64px]"
              placeholder="The people who pay for it." />
          </Row>
          <Row label="What it offers" hint={`Up to ${MAX_OFFERINGS}.`} htmlFor="biz-offer-add">
            <div className="flex flex-col gap-2.5">
              {offerings.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Offerings">
                  {offerings.map((o) => <Chip key={o} label={o} onRemove={() => setOfferings((list) => list.filter((x) => x !== o))}>{o}</Chip>)}
                </ul>
              )}
              <AddField id="biz-offer-add" placeholder="Add a product or service" onAdd={addOffering} disabled={offerings.length >= MAX_OFFERINGS} buttonLabel="Add" />
            </div>
          </Row>
          <Row label="Market" hint="Assistants are asked from this country." htmlFor="biz-country">
            <select id="biz-country" value={country} onChange={(e) => setCountry(e.target.value)} className={cx(fieldStyles, "select-field h-10 sm:w-64")}>
              {COUNTRY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Row>
          <Row label="City or area" hint="If you serve customers in person. Pentra asks what buyers there ask; leave it empty if you sell anywhere." htmlFor="biz-location">
            <Input id="biz-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={80} autoComplete="off" placeholder="Like Austin, TX" className="sm:w-64" />
          </Row>
          <Row label="Competitors" hint="Wrong ones would skew every count. Remove any that aren't, add the ones buyers compare you with." htmlFor="biz-rival-add">
            <div className="flex flex-col gap-2.5">
              {competitors.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label="Competitors">
                  {competitors.map((c) => (
                    <Chip key={`${c.name}-${c.domain ?? ""}`} label={c.name} onRemove={() => setCompetitors((list) => list.filter((x) => x !== c))}>
                      {c.name}{c.domain && <span className="ml-1.5 font-mono text-[11px] text-text-3">{c.domain}</span>}
                    </Chip>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] leading-5 text-text-3">None yet. Add the businesses your buyers compare you with.</p>
              )}
              <AddField id="biz-rival-add" placeholder="Name or website" onAdd={addCompetitor}
                disabled={competitors.length >= MAX_COMPETITORS} buttonLabel="Add" />
              {competitors.length >= MAX_COMPETITORS && <p className="text-[12px] text-text-3">{MAX_COMPETITORS} at most. Remove one to add another.</p>}
            </div>
          </Row>
        </div>
      </div>
      {error && <InlineError className="mt-6" title="Not saved">{error}</InlineError>}
      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button type="submit" size="lg" loading={saving} loadingLabel="Starting…" iconRight={<ArrowRight className="h-4 w-4" strokeWidth={1.5} />} className="w-full sm:w-auto">
          Looks right. Ask the assistants
        </Button>
        <p className="text-[13px] leading-5 text-text-3">{TIMING.line} Safe to close the tab.</p>
      </div>
    </form>
  );
}
