// Nov 2026 rebuild: the design system's rules are checked here, not left to taste. Tokens follow
// ops/design/pentra-redesign-research.md §5; Signal Blue means "you", white is the one primary action, green/amber/red
// appear only as evidence, and every sample answer says it is an example.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DOMAIN_ERROR, normalizeDomain, startHref, stripPastedUrl } from "../src/lib/domain-input.ts";

const read = (path: string) => readFileSync(path, "utf8");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

function load<T>(entry: string): T {
  // next/link needs a running Next.js router; a plain anchor is enough to render a component's markup here.
  const code = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", packages: "external",
    write: false, jsx: "automatic", alias: { "next/link": "./tests/helpers/next-link-stub.tsx" } }).outputFiles[0]!.text;
  const runtime = { exports: {} as T };
  runInNewContext(code, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url), console });
  return runtime.exports;
}

test("tokens match the research and map onto Tailwind classes", () => {
  const css = read("src/app/pentra.css");
  for (const [token, value] of [["--bg", "#08090a"], ["--surface-1", "#0f1011"], ["--surface-2", "#161718"], ["--surface-3", "#1d1e20"],
    ["--text", "#f7f8f8"], ["--text-2", "#b4b8c0"], ["--text-3", "#8a8f98"], ["--text-4", "#62666d"], ["--you", "#3da5f5"],
    ["--named", "#3fcf8e"], ["--rival", "#e8b24a"], ["--wrong", "#f27a72"], ["--action", "#f7f8f8"]] as const) {
    assert.match(css, new RegExp(`${token}: ${value};`), token);
  }
  for (const name of ["bg", "surface-1", "surface-2", "surface-3", "border", "border-strong", "text", "text-2", "text-3", "text-4", "you", "you-tint", "named", "rival", "wrong"]) {
    assert.match(css, new RegExp(`--color-${name}: var\\(--`), name);
  }
  assert.match(css, /--radius-control: 6px;/);
  assert.match(css, /--radius-card: 10px;/);
  assert.match(css, /--radius-hero: 14px;/);
  // Reduced motion turns travel off and shortens everything.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{[^}]*--rise: 0px;/);
  // Clerk's screens stay on the same tokens.
  assert.match(css, /\.cl-formButtonPrimary \{[^}]*background-color: var\(--action\) !important;/);
});

test("no transition: all, no indigo or violet, no emoji anywhere in the interface", () => {
  const all = files("src").map((path) => [path, read(path)] as const);
  for (const [path, text] of all) assert.doesNotMatch(text, /transition:\s*all/, path);
  const rebuilt = all.filter(([path]) => /src\/(components\/(ui|marketing|auth)|app\/(page|pricing|method|start|contact|legal|layout|not-found|error|global-error))/.test(path) || path.endsWith("landing-nav.tsx") || path.endsWith("pentra.css"));
  for (const [path, text] of rebuilt) {
    assert.doesNotMatch(text, /transition-all/, path);
    assert.doesNotMatch(text, /#6366f1|#8b5cf6|#7c3aed|#5e6ad2|indigo-|violet-|purple-/i, path);
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u, path);
  }
});

test("white is the primary action and Signal Blue is never a button fill", () => {
  const styles = read("src/components/ui/button-styles.ts");
  assert.match(styles, /primary: "bg-action text-on-action/);
  assert.doesNotMatch(styles, /bg-you/);
  for (const path of [...files("src/components/ui"), ...files("src/components/marketing"), "src/components/layout/landing-nav.tsx"]) {
    // Signal Blue fills only data marks (bars, dots); never alongside button text colours.
    assert.doesNotMatch(read(path), /bg-you\b[^"]*text-on-action|text-on-action[^"]*bg-you\b/, path);
  }
});

test("domain entry strips a pasted protocol, validates on submit and routes to /start", () => {
  assert.equal(stripPastedUrl("https://www.KettlewoodDecks.com/services?ref=ad"), "www.KettlewoodDecks.com");
  assert.equal(stripPastedUrl("http://user:pass@example.com:8080/x"), "example.com:8080");
  assert.equal(stripPastedUrl("example.com/about"), "example.com");
  assert.equal(stripPastedUrl("plain text"), "plain text");
  assert.equal(normalizeDomain("https://www.Pentra.dev/pricing#plans"), "pentra.dev");
  assert.equal(normalizeDomain("kettlewooddecks.com."), "kettlewooddecks.com");
  assert.equal(normalizeDomain("café.fr"), "xn--caf-dma.fr");
  for (const bad of ["not a website", "pentra", "localhost:3000", "192.168.1.1", "example.c", "-bad.com", "", null, "ftp://example.com"]) {
    assert.equal(normalizeDomain(bad as string), null, String(bad));
  }
  assert.equal(startHref("kettlewooddecks.com"), "/start?domain=kettlewooddecks.com");
  assert.equal(DOMAIN_ERROR, "Enter your website address, like yourbusiness.com.");
  const field = read("src/components/ui/domain-input.tsx");
  assert.match(field, /inputMode="url"/);
  assert.match(field, /autoComplete="url"/);
  assert.match(field, /spellCheck=\{false\}/);
  assert.match(field, /onPaste=\{onPaste\}/);
  assert.doesNotMatch(field, /onChange=/, "no validation per keystroke");
  assert.match(field, /router\.push\(startHref\(domain\)\)/);
  assert.match(field, /Free\. No card\. Results in about an hour; first answers in minutes\./);
});

test("the evidence card highlights the business, underlines competitors and labels sample answers", () => {
  const { EvidenceCard } = load<{ EvidenceCard: ComponentType<Record<string, unknown>> }>("src/components/ui/evidence-card.tsx");
  const answer = {
    id: "a", assistant: "perplexity", askedAt: "2026-11-06 09:16 UTC", question: "Who are the best deck builders in Austin, TX?",
    answer: [{ p: [{ you: "Kettlewood Decks" }, " is often recommended", { cite: 1 }, ". ", { rival: "Cedar Row Builders" }, " ", { wrong: "only builds pine" }] }],
    outcomes: [{ kind: "named", label: "Named you · position 1 of 2" }, { kind: "wrong", label: "Wrong fact" }],
    sources: [{ domain: "kettlewooddecks.com", title: "Deck permits", url: "https://kettlewooddecks.com/permits", yours: true }, { domain: "houzz.com", title: "Deck builders", url: "https://houzz.com/x" }],
    locale: "US English",
  };
  const sample = renderToStaticMarkup(createElement(EvidenceCard, { answer, variant: "hero", sample: true, ink: "play" }));
  assert.match(sample, /<mark class="hl-you" data-ink="play">Kettlewood Decks<\/mark>/);
  assert.match(sample, /<span class="hl-rival">Cedar Row Builders<\/span>/);
  assert.match(sample, /class="hl-wrong">only builds pine<span class="sr-only"> \(wrong\)<\/span>/);
  assert.match(sample, /Cited sources · <span class="tabular-nums">2<\/span>/);
  assert.match(sample, /Your page/);
  assert.match(sample, /aria-label="Perplexity answer \(example\)"/);
  assert.match(sample, /Pentra asks from a fresh session with web search · US English/);
  assert.doesNotMatch(sample, /href="https:\/\/houzz\.com/, "sample sources are not links");
  assert.match(sample, /href="\/method"/, "the method is one click away");
  assert.match(sample, /bg-named-tint/);
  assert.match(sample, /bg-wrong-tint/);

  const recorded = renderToStaticMarkup(createElement(EvidenceCard, { answer: { ...answer, rawHref: "/answers/a/raw" } }));
  assert.match(recorded, /Asked by Pentra from a fresh session · US English/);
  assert.match(recorded, /href="https:\/\/houzz\.com\/x" target="_blank" rel="noopener noreferrer"/);
  assert.match(recorded, />Raw<\/a>/);
  assert.match(recorded, /aria-label="Perplexity answer"/);
});

test("status pills keep green, amber and red for outcomes and pulse only while indexing", () => {
  const { StatusPill } = load<{ StatusPill: ComponentType<Record<string, unknown>> }>("src/components/ui/status-pill.tsx");
  const pill = (kind: string) => renderToStaticMarkup(createElement(StatusPill, { kind }, "Label"));
  assert.match(pill("named"), /bg-named-tint/);
  assert.match(pill("rival"), /bg-rival-tint/);
  assert.match(pill("wrong"), /bg-wrong-tint/);
  assert.match(pill("none"), /bg-surface-3/);
  assert.match(pill("indexing"), /pulse-dot/);
  assert.doesNotMatch(pill("published"), /pulse-dot/);
  assert.match(pill("draft"), /h-5 /, "20px tall");
});

test("the hero carousel can be paused, stops when someone picks, and never rotates under reduced motion", () => {
  const card = read("src/components/ui/evidence-card.tsx");
  assert.match(card, /const rotating = !reducedMotion && !userPicked && !userPaused;/);
  assert.match(card, /const paused = !rotating \|\| hovered \|\| focused \|\| hidden \|\| offscreen \|\| expandedId !== null;/);
  assert.match(card, /aria-label=\{userPaused \? "Play the examples" : "Pause the examples"\}/);
  assert.match(card, /animation: `progress-fill \$\{interval\}ms linear both`/);
  assert.match(card, /aria-roledescription="carousel"/);
  assert.match(read("src/lib/motion.ts"), /cycle: 6000,/);
  assert.match(read("src/lib/motion.ts"), /crossfade: 400,/);
});
