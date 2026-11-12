// P409 (Nov 12 2026): link emails still reached businesses outside the US and the UK after P408, for two general causes:
// 1. A business abroad was recognised only by a postal code followed by its country's name, an EU legal notice, a foreign
//    phone code or a foreign company form. Canada shares the US's +1 phones and English pages, and a Canadian address
//    written at home names no country; any business may also say in words where it is registered or based.
// 2. Follow-ups skipped the live check P408 runs before every first email, so a business abroad or a desk written to under
//    the older rules would get a second email five days later.
// Fictional sites from other trades and countries throughout.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { addressOutsideUsUk, followUpDue, LINK_FOLLOW_UP_DAYS, noFollowUpNote, shownOutsideUsUk, statesBaseOutsideUsUk } from "../convex/lib/linkOutreach.ts";

const DAY = 86_400_000;

test("a Canadian address counts without its country's name; US and UK addresses and look-alike codes don't", () => {
  for (const address of ["Maple Hollow Roasters, 88 King St W, Toronto, ON M5H 1A1", "1055 W Hastings St, Vancouver, BC V6E 2E9",
    "1800 Barrington St, Halifax, Nova Scotia B3J 3K1", "500 Rue Sherbrooke O, Montréal, QC H3A 3G6", "Calgary, Alberta T2P1J9"])
    assert.equal(addressOutsideUsUk(address), true, address);
  for (const other of ["410 Elm St, Austin, TX 78701", "12 High St, Leeds LS1 4AP", "Model ON A1B 2C3X", "Part K2Z 9Q8 in stock", "Turn ON 12345"])
    assert.equal(addressOutsideUsUk(other), false, other);
  assert.equal(shownOutsideUsUk(`<footer>Northbay Climbing Gear Inc. · 22 Water St, St. John's, NL A1C 1A1 · <a href="tel:+18005550199">Call</a></footer>`), true,
    "a toll-free +1 number doesn't make a Canadian address American");
  assert.equal(shownOutsideUsUk(`<p>HQ: 1200 Western Ave, Seattle, WA 98101</p><p>Our studio: 20 Bay St, Toronto, ON M5J 2N8</p>`), false,
    "a US business with an office in Canada");
});

test("a business saying in words where it is registered or based", () => {
  for (const said of ["Brightpath Media is a company registered in Ghana (RC 1234567).", "We're a small studio based in Cape Town, South Africa.",
    "Incorporated in Ireland. Company number 654321.", "Headquarters: 12 Ayala Avenue, Makati, Philippines", "Our team is located in Wellington, New Zealand",
    "Stackhouse Labs is headquartered in Toronto, Ontario, Canada", "A family bakery based in São Paulo, Brazil", "Proudly based in Canada Contact Privacy"])
    assert.equal(statesBaseOutsideUsUk(said), true, said);
  for (const said of ["Registered in England and Wales, company no. 01234567", "Proudly based in Austin, Texas", "Headquartered in Denver, Colorado, USA",
    "We help teams based in the US, UK and Canada", "Based in New York and London, with a support team in Poland", "Family-run and based in Lebanon, PA since 1952",
    "A dental studio based in Jersey City, NJ", "registered in the USA and other countries", "Based in Poland, Ohio", "located in Panama City Beach, Florida",
    "Registered office: 91 Market St, Bristol BS1 4DJ", "Based in Indiana since 1998"])
    assert.equal(statesBaseOutsideUsUk(said), false, said);
});

test("the site's own words count on its contact and about pages, and only in the footer of the page being pitched", () => {
  assert.equal(shownOutsideUsUk(`<html lang="en"><body><h1>Contact</h1><p>Lumen Tutors is registered in Ghana. Write to hello@lumentutors.com</p></body></html>`), true);
  const article = `<html lang="en-US"><body><main><article>Acme Robotics, based in Seoul, South Korea, makes arms.</article></main>
    <footer>© 2026 Ridgeline Tools LLC</footer></body></html>`;
  assert.equal(shownOutsideUsUk(article, { articlePage: true }), false, "the article names another company");
  assert.equal(shownOutsideUsUk(`<main>Guide</main><footer>Tallgrass Analytics is registered in Australia.</footer>`, { articlePage: true }), true, "its own footer");
  assert.equal(shownOutsideUsUk(`<p>Our support team is based in Manila, Philippines.</p><p>HQ: 300 Congress Ave, Austin, TX 78701</p>`), false,
    "a US business with a team abroad");
});

// The send turn's records, run against an in-memory database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Synthetic serialized database rows.
type Row = Record<string, any>;
const source = buildSync({ entryPoints: ["convex/linkOpportunities.ts"], bundle: true, platform: "node", format: "cjs", external: ["convex/*"], write: false })
  .outputFiles[0].text;
function records(tables: Record<string, Row[]>) {
  const all = () => Object.values(tables).flat();
  const ctx = { db: {
    async get(id: string) { return structuredClone(all().find((row) => row._id === id) ?? null); },
    async patch(id: string, fields: Row) { Object.assign(all().find((row) => row._id === id)!, fields); },
    query(table: string) {
      const conditions: Array<(row: Row) => boolean> = [];
      const range = { eq(key: string, value: unknown) { conditions.push((row) => row[key] === value); return range; } };
      const read = () => structuredClone((tables[table] ?? []).filter((row) => conditions.every((fn) => fn(row))));
      const chain = { withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        async take(n: number) { return read().slice(0, n); }, async first() { return read()[0] ?? null; } };
      return chain;
    },
  } };
  const runtime = { exports: {} as Record<string, { _handler(ctx: unknown, args: unknown): Promise<Row> }> };
  runInNewContext(source, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url), URL, TextEncoder, TextDecoder, process, Buffer });
  return (name: string, args: Row) => runtime.exports[name]._handler(ctx, args);
}

test("a follow-up goes only where a first email would go today: stopped, never sent; the row stays sent so an answer still counts", async () => {
  const now = Date.now();
  const tables: Record<string, Row[]> = {
    sites: [{ _id: "site-a", domain: "fernhillpottery.com", siteName: "Fernhill Pottery", linkOutreach: "send" }],
    link_mailboxes: [{ _id: "mbox-a", siteId: "site-a", email: "sam@fernhillpottery.com", senderName: "Sam Reed", postalAddress: "1 Clay Lane, Asheville, NC 28801",
      smtp: { host: "smtp.example.com", port: 465 }, imap: { host: "imap.example.com", port: 993 }, credentials: {}, status: "ready", createdAt: 0, updatedAt: 0 }],
    link_opportunities: [
      { _id: "opp-sent", siteId: "site-a", domain: "glazecraftjournal.com", rank: 5, linksTo: [], status: "sent", foundAt: 0, seenAt: 0,
        url: "https://glazecraftjournal.com/best-kilns/", title: "Best kilns", contact: { email: "hello@glazecraftjournal.com", source: "page" },
        pitch: { subject: "Your kiln list", body: "Hi", writtenAt: 0, costMicroUsd: 0 },
        sends: [{ at: now - (LINK_FOLLOW_UP_DAYS + 1) * DAY, kind: "first", messageId: "<first@fernhillpottery.com>" }] },
      { _id: "opp-ready", siteId: "site-a", domain: "wheelthrowers.com", rank: 1, linksTo: [], status: "ready", foundAt: 0, seenAt: 0,
        url: "https://wheelthrowers.com/tools/", contact: { email: "editor@wheelthrowers.com", source: "page" }, pitch: { subject: "Tools", body: "Hi", writtenAt: 0, costMicroUsd: 0 } },
    ],
  };
  const run = records(tables);
  const before = await run("sendContext", { siteId: "site-a" });
  assert.equal(before.next?.kind, "follow_up", "a follow-up falls due before any first email");
  assert.equal(before.next?.id, "opp-sent");

  await run("stopFollowUp", { siteId: "site-a", id: "opp-sent", reason: "country" });
  const stopped = tables.link_opportunities[0];
  assert.equal(stopped.status, "sent");
  assert.equal(typeof stopped.followUpStoppedAt, "number");
  assert.equal(stopped.note, noFollowUpNote("country"));
  assert.match(stopped.note, /^No follow-up\. The site shows a business outside the US and the UK/);
  assert.equal(followUpDue(stopped, now + 30 * DAY), false);
  assert.equal((await run("claimSend", { siteId: "site-a", id: "opp-sent", kind: "follow_up", messageId: "<second@fernhillpottery.com>" })).ok, false);
  assert.equal(stopped.pendingSend, undefined, "nothing was claimed");

  const after = await run("sendContext", { siteId: "site-a" });
  assert.equal(after.next?.id, "opp-ready", "the next first email comes up instead");
  assert.equal(after.nextFollowUpAt, null, "the sender doesn't wake for the stopped follow-up");
  assert.equal(after.contacted.map((c: Row) => c.id).join(), "opp-sent", "its answers are still read");

  await run("stopFollowUp", { siteId: "site-a", id: "opp-ready", reason: "desk" });
  assert.equal(tables.link_opportunities[1].followUpStoppedAt, undefined, "only a sent email's follow-up is stopped");
});

test("the send turn reads the site again before every email, first or follow-up", () => {
  const action = readFileSync("convex/actions/linkOutreach.ts", "utf8");
  const send = action.slice(action.indexOf("export const sendNext"));
  assert.match(send, /const site = await readSite\(next\.url, next\.domain\);/);
  assert.match(send, /if \(setAside && next\.kind === "follow_up"\) await ctx\.runMutation\(internal\.linkOpportunities\.stopFollowUp, \{ siteId, id: next\.id, reason: setAside \}\);/);
  assert.ok(send.indexOf("readSite(next.url") < send.indexOf("internal.linkOpportunities.claimSend"), "read before anything is claimed or sent");
  assert.ok(send.indexOf("stopFollowUp") < send.indexOf("internal.linkOpportunities.claimSend"));
  assert.match(send, /const claim = setAside \? \{ ok: false \} : await ctx\.runMutation\(internal\.linkOpportunities\.claimSend/);
});
