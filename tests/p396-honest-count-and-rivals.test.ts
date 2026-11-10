// P396 (Nov 10 2026): three general causes, each failing without its fix.
// 1. A page the assistant read (cited) was counted as a recommendation (named). Only the answer's words name a business.
// 2. Who the assistants recommend was listed only for answers that named the business, so a business named nowhere had no
//    record of who wins instead. Every answer's businesses are now totalled per run.
// 3. The link engine needed competitors to compare pages with; a site with none confirmed and no reachable page-one rival
//    skipped every page the assistants cited. The answers themselves now supply rivals (a named business whose own site
//    the assistants cite) and the pages, most-cited first.
// Cases are deliberately other trades and countries: a UK dentist, a US plumber, an Australian accountant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeAnswer, recommendedInstead, runTotals } from "../convex/lib/answerEngine.ts";
import { citedPagesFromAnswers, linkCompetitors, rivalDomainsFromAnswers } from "../convex/lib/linkOpportunities.ts";

test("a cited page is a source the assistant read, never a recommendation on its own", () => {
  const dentist = { name: "Brightsmile Dental", domain: "brightsmiledental.co.uk" };
  const citedOnly = judgeAnswer({ text: "For Invisalign in Leeds, Leeds Dental Studio and Smile Clinic are well reviewed.",
    sources: [{ url: "https://brightsmiledental.co.uk/invisalign-cost" }, { url: "https://nhs.uk/x" }] }, dentist, []);
  assert.equal(citedOnly.cited, true);
  assert.equal(citedOnly.named, false, "the answer's words never name the business");
  const namedToo = judgeAnswer({ text: "Brightsmile Dental offers Invisalign from £2,400.", sources: [{ url: "https://brightsmiledental.co.uk/x" }] }, dentist, []);
  assert.deepEqual([namedToo.named, namedToo.cited], [true, true]);
  const totals = runTotals([
    { assistant: "chatgpt", status: "answered", named: citedOnly.named, cited: citedOnly.cited, competitorsNamed: [], sources: [] },
    { assistant: "gemini", status: "answered", named: namedToo.named, cited: namedToo.cited, competitorsNamed: [], sources: [] },
  ]);
  assert.deepEqual([totals.named, totals.cited, totals.answered], [1, 2, 2]);
});

test("who the assistants recommend instead is counted from every answer, once per answer, never the business itself", () => {
  const plumber = { name: "Riverside Plumbing", domain: "riversideplumbing.com" };
  const check = (businessesNamed: string[], status = "answered") =>
    ({ assistant: "chatgpt", status, named: false, cited: false, competitorsNamed: [], businessesNamed, sources: [] });
  const out = recommendedInstead([
    check(["Mr. Rooter", "Roto-Rooter", "Riverside Plumbing"]),
    check(["roto-rooter", "Roto-Rooter", "Benjamin Franklin Plumbing"]),
    check(["Roto-Rooter"], "error"),
    check(["Mr. Rooter"]),
  ], plumber);
  assert.deepEqual(out, [{ name: "Mr. Rooter", answers: 2 }, { name: "Roto-Rooter", answers: 2 }, { name: "Benjamin Franklin Plumbing", answers: 1 }]);
  const totals = runTotals([check(["Xero", "MYOB"]), check(["Xero"])], { name: "Ledgerly", domain: "ledgerly.com.au" });
  assert.deepEqual(totals.recommended, [{ name: "Xero", answers: 2 }, { name: "MYOB", answers: 1 }]);
});

test("rivals come from the answers: a named business whose own site the assistants cite", () => {
  const src = (domain: string, own = false) => ({ url: `https://${domain}/guide`, domain, own });
  const checks = [
    { status: "answered", businessesNamed: ["Xero", "MYOB", "QuickBooks"], sources: [src("xero.com"), src("myob.com"), src("reddit.com")] },
    { status: "answered", businessesNamed: ["Xero", "Ledgerly"], sources: [src("xero.com"), src("ledgerly.com.au", true)] },
    { status: "answered", businessesNamed: ["Pimlico Plumbers"], sources: [src("pimlicoplumbers.com")] },
    { status: "error", businessesNamed: ["MYOB"], sources: [src("myob.com")] },
  ];
  const rivals = rivalDomainsFromAnswers(checks, "ledgerly.com.au");
  assert.deepEqual(rivals, ["xero.com", "myob.com", "pimlicoplumbers.com"], "most-named first; QuickBooks has no cited site; a forum is never a rival");
  assert.ok(!rivals.includes("ledgerly.com.au"), "never the site itself");
  // They reach the link engine's competitor list when nothing else is known.
  assert.deepEqual(linkCompetitors([], "ledgerly.com.au", 3, rivals), ["xero.com", "myob.com", "pimlicoplumbers.com"]);
  // A short name can't be matched safely to a domain label.
  assert.deepEqual(rivalDomainsFromAnswers([{ businessesNamed: ["HQ"], sources: [src("hq.com")] }], "x.com"), []);
});

test("the pages the assistants cite are offered most-cited first, never the site's own", () => {
  const src = (url: string, own = false) => ({ url, domain: new URL(url).hostname, own });
  const pages = citedPagesFromAnswers([
    { status: "answered", sources: [src("https://blog.example.org/best-dentists-leeds"), src("https://brightsmiledental.co.uk/a", true)] },
    { status: "answered", sources: [src("https://blog.example.org/best-dentists-leeds"), src("https://guide.example.net/invisalign")] },
    { status: "no_answer", sources: [src("https://ignored.example.com/x")] },
  ]);
  assert.deepEqual(pages, ["https://blog.example.org/best-dentists-leeds", "https://guide.example.net/invisalign"]);
});
