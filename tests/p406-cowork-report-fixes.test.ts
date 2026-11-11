// P406 (Nov 11 2026): the causes behind Cowork's Nov 10 report, fixed for every site. Two send turns running at once
// both sent (the caps counted only confirmed sends); escaped page source glued itself to an address; support desks were
// ranked as contacts; bounces were recorded but counted and listed nowhere; the directories' "to do" never moved; and no
// Reddit or Quora thread was ever read (Reddit refuses servers), so every reply was written from the title alone.
// Fictional cases from other trades and countries: a UK bakery, an Australian physio, a US roofer, a Toronto contractor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractContactCandidates, isContactableAddress, isDeskAddress, selectBestContact } from "../convex/lib/outreachContacts.ts";
import { INBOX_READ_EVERY_MS, nextTurnAt, sendAllowedNow, sendTimes } from "../convex/lib/linkOutreach.ts";
import { forumThreadText, scrapedRedditThreadText } from "../convex/lib/answerGrowth.ts";

test("addresses are read from decoded page source: an escape never glues itself to an address", () => {
  const html = `<script>self.__next_f.push([1,"\\u003cp\\u003eWrite to editor@harbourbakes.co.uk\\u003c/p\\u003e"])</script>
    <p>Partnerships: hello&#64;harbourbakes.co.uk</p><a href="mailto:press%40harbourbakes.co.uk">Press</a>`;
  const emails = extractContactCandidates({ html, siteDomain: "harbourbakes.co.uk" }).map((c) => c.email).sort();
  assert.deepEqual(emails, ["editor@harbourbakes.co.uk", "hello@harbourbakes.co.uk", "press@harbourbakes.co.uk"]);
  // A JSON-escaped ">" before a legal desk's address: no "u003e..." address, and the desk itself is never chosen.
  const legal = `<script>{"footer":"Questions\\u003eprivacy@sunrisephysio.com.au\\u003c/a\\u003e"}</script>`;
  assert.deepEqual(extractContactCandidates({ html: legal, siteDomain: "sunrisephysio.com.au" }), []);
  assert.equal(isContactableAddress("u003eteam@sunrisephysio.com.au"), false, "a leftover already stored is refused at send time too");
  assert.equal(isContactableAddress("team@sunrisephysio.com.au"), true);
});

test("support and help desks are never chosen: they are ticket queues, not someone who edits the page", () => {
  const desks = `<footer>Support: support@ridgeroofing.com · Help desk: help-desk@ridgeroofing.com · Care: customer.care@ridgeroofing.com</footer>`;
  assert.equal(selectBestContact(extractContactCandidates({ html: desks, siteDomain: "ridgeroofing.com" })), null, "only desks: no contact, nothing is sent");
  const withPeople = `${desks}<p>Story ideas: news@ridgeroofing.com</p><p>Say hi: hello@ridgeroofing.com</p>`;
  const best = selectBestContact(extractContactCandidates({ html: withPeople, siteDomain: "ridgeroofing.com" }));
  assert.ok(best && ["news@ridgeroofing.com", "hello@ridgeroofing.com"].includes(best.email), best?.email);
  for (const desk of ["support@x.com", "Help@x.com", "customer_service@x.com", "tech-support@x.com", "privacy@x.com", "no-reply@x.com"]) assert.equal(isDeskAddress(desk), true, desk);
  for (const person of ["hello@x.com", "editor@x.com", "jane.doe@x.com", "info@x.com", "supporters.club@x.com"]) assert.equal(isDeskAddress(person), false, person);
});

test("the caps count emails going out at this moment: two send turns at once can't both send", () => {
  const monday = Date.UTC(2026, 10, 16, 13, 0);
  const times = sendTimes([{ sends: [] }, { pendingSend: { at: monday } }], monday + 5_000);
  assert.deepEqual(times, [monday]);
  assert.equal(sendAllowedNow(monday + 5_000, times), false, "a second email in the same minute is refused");
  assert.equal(sendAllowedNow(monday + 5_000, []), true);
  const three = [monday, monday + 50 * 60_000, monday + 100 * 60_000];
  assert.equal(sendAllowedNow(monday + 200 * 60_000, three), false, "a fourth on the same day is refused");
  assert.deepEqual(sendTimes([{ sends: [{ at: monday - 9 * 86_400_000 }] }], monday), [], "only the last eight days count");
  const records = readFileSync("convex/linkOpportunities.ts", "utf8");
  assert.match(records, /if \(!sendAllowedNow\(now, sendTimes\(await rows\(ctx, siteId\), now\)\)\) return \{ ok: false \};/, "the claim checks the pace in its transaction");
  assert.match(records, /const sentAt = sendTimes\(all, now\);/, "the turn counts emails going out too");
});

test("one chain of send turns per mailbox, and the inbox is read within six hours while an email waits for an answer", () => {
  const saturday = Date.UTC(2026, 10, 14, 10, 0);
  assert.equal(nextTurnAt(saturday, { sentAt: [], hasNext: true, nextFollowUpAt: null, awaiting: false }), Date.UTC(2026, 10, 16, 13, 0), "an email waits for Monday's window");
  assert.equal(nextTurnAt(saturday, { sentAt: [], hasNext: true, nextFollowUpAt: null, awaiting: true }), saturday + INBOX_READ_EVERY_MS, "the inbox is read over the weekend");
  assert.equal(nextTurnAt(saturday, { sentAt: [], hasNext: false, nextFollowUpAt: null, awaiting: false }), null, "nothing to send or wait for: asleep");
  const due = Date.UTC(2026, 10, 18, 15, 0);
  assert.equal(nextTurnAt(saturday, { sentAt: [], hasNext: false, nextFollowUpAt: due, awaiting: false }), due, "the sender wakes for a follow-up");
  const records = readFileSync("convex/linkOpportunities.ts", "utf8");
  assert.match(records, /const book = nextAt !== null && \(booked === undefined \|\| nextAt < booked\);/, "a turn books the next only when none is booked sooner");
  assert.match(records, /if \(booked !== undefined && booked <= at\) return;/);
  assert.match(records, /if \(booked === undefined\) await ctx\.db\.patch\(m\._id, \{ nextRunAt: at \}\);/, "a wake keeps a later booking on record");
  const action = readFileSync("convex/actions/linkOutreach.ts", "utf8");
  assert.match(action, /nextTurnAt\(Date\.now\(\), \{ sentAt: after\.sentAt, hasNext: Boolean\(after\.next\), nextFollowUpAt: after\.nextFollowUpAt, awaiting: after\.awaiting \}\)/);
  assert.ok(action.indexOf("internal.linkOpportunities.setAsideDesk") < action.indexOf("transport.sendMail("), "a desk address is set aside before anything is sent");
});

test("every email sent is listed with what became of it, ahead of the pages not yet read", () => {
  const records = readFileSync("convex/linkOpportunities.ts", "utf8");
  assert.match(records, /bounced: count\("bounced"\), optedOut: count\("opted_out"\)/);
  const order = Object.fromEntries([...(/const order: Record<string, number> = \{([^}]+)\}/.exec(records)?.[1] ?? "").matchAll(/(\w+): (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  for (const contacted of ["sent", "replied", "won", "bounced", "opted_out", "lost"]) assert.ok(order[contacted] < order.new, contacted);
  const ui = readFileSync("src/components/answers/dashboard/get-named.tsx", "utf8");
  assert.match(ui, /bounced: "bounced: the address doesn't exist"/);
  assert.match(ui, /o\.linksTo\.length \? ` · links to \$\{o\.linksTo\.join\(", "\)\}` : o\.source === "ai_answer" \? " · the assistants cite this page" : ""/, "never a blank 'links to'");
});

test("the directories' 'to do' counts what is left, not the list's length", () => {
  assert.match(readFileSync("convex/answerGrowthKit.ts", "utf8"), /todo: directories\.filter\(\(d\) => d\.status === "todo"\)\.length/);
  const ui = readFileSync("src/components/answers/dashboard/get-named-kit.tsx", "utf8");
  assert.match(ui, /\{extras\.listing\.counts\.todo\} to do/);
  assert.doesNotMatch(ui, /counts\.total\} to do/);
});

test("a Reddit thread is read through treg: the post and its most-upvoted replies", () => {
  const json = { success: true, post: { subreddit: "smallbusiness", title: "How do bakeries in Leeds win wholesale cafe clients?", selftext: "We bake for three cafes and want ten.", score: 12 },
    comments: [{ body: "Walk in with samples on a Tuesday morning.", score: 40, replies: { items: [] } }, { body: "[deleted]", score: 99, replies: { items: [] } },
      { body: "Instagram messages to cafe owners worked for us.", score: 55, replies: { items: [{ body: "a nested reply", score: 500 }] } }], more: { has_more: false } };
  const text = scrapedRedditThreadText(json)!;
  assert.match(text, /Subreddit: r\/smallbusiness/);
  assert.match(text, /Post: We bake for three cafes/);
  assert.ok(text.indexOf("Instagram messages") < text.indexOf("Walk in with samples"), "most upvoted first");
  assert.doesNotMatch(text, /\[deleted\]|a nested reply/);
  assert.equal(scrapedRedditThreadText({ success: false }), null);
  assert.equal(scrapedRedditThreadText(null), null);
  const action = readFileSync("convex/actions/answerGrowth.ts", "utf8");
  assert.match(action, /tregRead\(REDDIT_THREAD_ENDPOINT, \{ query: \{ url: thread\.url \} \}/);
  assert.doesNotMatch(action, /www\.reddit\.com\$\{/, "never Reddit's own JSON address: it refuses servers");
});

test("a Quora or forum page counts as the thread only when it is the thread, never a bot check or a sign-in wall", () => {
  const title = "What accounting software do Toronto contractors use? - Quora";
  const page = `What accounting software do Toronto contractors use? ${"Most contractors here pair a cloud ledger with a bookkeeper they meet monthly. ".repeat(8)}`;
  assert.match(forumThreadText(title, page)!, /^Title: What accounting software/);
  assert.equal(forumThreadText(title, "Just a moment... Enable JavaScript and cookies to continue"), null);
  assert.equal(forumThreadText(title, "Sign in to continue. Continue with Google. Continue with email. ".repeat(10)), null);
});

test("a waiting reply written from the title alone is written again from its thread; a posted one never is", () => {
  const growth = readFileSync("convex/answerGrowth.ts", "utf8");
  assert.match(growth, /posts\.filter\(\(p\) => p\.status === "todo" && !p\.threadRead\)\.slice\(0, REDRAFTS_PER_PREPARATION\)/);
  assert.match(growth, /if \(!post \|\| post\.status !== "todo" \|\| post\.threadRead\) return;/);
  const action = readFileSync("convex/actions/answerGrowth.ts", "utf8");
  assert.match(action, /if \(!thread\.postId \|\| read\.text\) \{/, "no second title-only draft is paid for");
});
