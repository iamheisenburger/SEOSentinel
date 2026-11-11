// P408 (Nov 11 2026): who a link email may go to, for every site. Two causes, both general:
// 1. "US and UK only" (P371) knew only an EU/EEA country's name beside a postal code. Businesses write their address at
//    home without their country ("80802 München"), and no country outside the EU/EEA was known at all, so sites run from
//    abroad on .com and .co domains were written to.
// 2. Any one-word address passed for a person's first name and outranked the general inbox, so department desks (the
//    accounts, orders or ads desk) were chosen as "people". Now an address is a person's only when the site names them.
// Fictional sites from other trades and countries throughout.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addressOutsideUsUk, shownOutsideUsUk } from "../convex/lib/linkOutreach.ts";
import { extractContactCandidates, linkContactRole, namesPerson, peopleNamedIn, selectBestContact } from "../convex/lib/outreachContacts.ts";

test("a business abroad shows itself: legal-notice page, company form, home address without its country", () => {
  const munich = `<html lang="en"><body><main><article>Ten ways to plan a kitchen.</article></main>
    <footer><a href="/impressum">Impressum</a> © 2026 Alpenblick Software GmbH, Leopoldstraße 12, 80802 München</footer></body></html>`;
  assert.equal(shownOutsideUsUk(munich, { articlePage: true }), true);
  assert.equal(shownOutsideUsUk(`<footer><a href="/imprint">Imprint</a> <a href="/privacy">Privacy</a></footer>`), true, "the legal-notice link alone");
  assert.equal(shownOutsideUsUk(`<main>Guide</main><footer>© 2026 Tulpen Analytics B.V.</footer>`, { articlePage: true }), true, "a Dutch company form");
  assert.equal(shownOutsideUsUk(`<main>Guide</main><footer>Harbourline Logistics Pte. Ltd.</footer>`, { articlePage: true }), true, "a Singapore company form");
  assert.equal(shownOutsideUsUk(`<p>Mentions légales</p><a href="/ml">Mentions légales</a>`), true);
});

test("a site's declared locale and its phone link say where it is", () => {
  assert.equal(shownOutsideUsUk(`<html lang="en-AU"><body>Plumbing tips</body></html>`), true);
  assert.equal(shownOutsideUsUk(`<html lang="en"><head><meta property="og:locale" content="en_NG"></head></html>`), true);
  assert.equal(shownOutsideUsUk(`<html lang="en-US"><head><meta property="og:locale:alternate" content="de_DE"></head></html>`), false, "an alternate is not the page's own");
  assert.equal(shownOutsideUsUk(`<html lang="en-GB"><body>Leeds bakery</body></html>`), false);
  assert.equal(shownOutsideUsUk(`<a href="tel:+2348012345678">Call us</a>`), true, "a Nigerian number");
  assert.equal(shownOutsideUsUk(`<a href="tel:0049 89 123456">Ruf an</a>`), true, "a German number dialled with 00");
  for (const home of [`<a href="tel:+1 (512) 555-0100">Call</a>`, `<a href="tel:+44 20 7946 0000">Call</a>`, `<a href="tel:0800-123-456">Call</a>`,
    `<a href="tel:+15035550100">Sales</a> <a href="tel:+5035550100">Support</a>`, `<a href="tel:+16175550100">Boston</a> <a href="tel:+4930123456">Berlin</a>`])
    assert.equal(shownOutsideUsUk(home), false, `a US or UK number on the page: ${home}`);
});

test("a postal address in any country but the US and the UK, wherever it is", () => {
  assert.equal(addressOutsideUsUk("Kothrud, Pune, Maharashtra 411038, India"), true);
  assert.equal(addressOutsideUsUk("1055 Granville St, Vancouver, BC V6B 1A1, Canada"), true);
  assert.equal(addressOutsideUsUk("Lekki Phase 1, Lagos 105102, Nigeria"), true);
  assert.equal(addressOutsideUsUk("Av. Paulista 1000, São Paulo 01310-100, Brasil"), true);
  assert.equal(addressOutsideUsUk("Belfast BT1 5GS, Northern Ireland"), false, "the UK");
  assert.equal(addressOutsideUsUk("410 Elm St, Austin, TX 78701, United States"), false);
});

test("US and UK businesses are written to, US towns named after countries included", () => {
  const austin = `<html lang="en-US"><body><main>Roof guide</main><footer>© 2026 Lakeside Roofing LLC · 410 Elm St, Austin, TX 78701
    <a href="tel:+15125550100">512-555-0100</a></footer></body></html>`;
  assert.equal(shownOutsideUsUk(austin, { articlePage: true }), false);
  const leeds = `<html lang="en-GB"><body><footer>Brightwater Bakes Ltd, 12 High St, Leeds LS1 4AP, United Kingdom</footer></body></html>`;
  assert.equal(shownOutsideUsUk(leeds), false);
  for (const town of ["© 2026 Keystone Feed & Seed, 200 Cumberland St, Lebanon, PA 17042", "1200 Market St, Poland, OH 44514", "Santa Fe, New Mexico 87501",
    "© 2026 Ridgeview Media LLC. Serving customers since 2015 across Canada and Mexico.",
    "HQ: 2500 Pine St, Suite 300, Columbus, OH 43215, USA · Studio: Kraków, Poland", "Oak Lane 4410, Portland, OR 97201, United States · Team in Cebu, Philippines"])
    assert.equal(addressOutsideUsUk(town), false, town);
  assert.equal(addressOutsideUsUk("2500 Pine St, Columbus, OH 43215, USA · 6000 Cebu City, Philippines"), true, "a full address abroad still counts");
});

test("on the page being pitched, the article's own text about other companies never counts: only the site's footer", () => {
  const usBlog = `<html lang="en-US"><body><main><article>Kontor GmbH, Berlin's favourite CRM. Founded 2014 in Toronto, Ontario M5V 2T6, Canada.
    Pune 411038, India runs a third.</article></main><footer>© 2026 Ridgeview Media LLC</footer></body></html>`;
  assert.equal(shownOutsideUsUk(usBlog, { articlePage: true }), false);
  assert.equal(shownOutsideUsUk(usBlog), true, "the same words on a contact or about page are about the business itself");
});

test("offices or partners abroad named beside a US or UK address don't make a US or UK business foreign", () => {
  const seattle = `<p>HQ: 1200 Western Ave, Seattle, WA 98101</p><p>Our Lisbon studio: Rua Augusta 100, 1100-053 Lisboa, Portugal</p>`;
  assert.equal(shownOutsideUsUk(seattle), false, "a US address on the page");
  assert.equal(shownOutsideUsUk(`<html lang="en-GB"><footer>© 2026 Larkspur Pay Limited · partner: Kestrel Remit Private Limited</footer></html>`), false, "a page set for the UK");
  assert.equal(shownOutsideUsUk(`<footer>Partner office: 400 Bay St, Toronto, ON M5H 2Y4, Canada</footer>`), true, "no US or UK presence: abroad");
  assert.equal(shownOutsideUsUk(`<a href="/impressum">Impressum</a><p>NYC office: 10 Hudson Yards, New York, NY 10001</p>`), true, "an EU legal notice always counts");
});

test("an address is a person's only when the site names that person; department desks are never chosen", () => {
  const article = `<html><head><script type="application/ld+json">{"@type":"BlogPosting","author":{"@type":"Person","name":"Priya Raman"}}</script></head>
    <body><a href="mailto:priya@lakeshorekitchens.com">Email Priya</a> Orders: orders@lakeshorekitchens.com · Wholesale: wholesale@lakeshorekitchens.com
    · Accounts: accounts@lakeshorekitchens.com · Say hi: hello@lakeshorekitchens.com</body></html>`;
  const strict = extractContactCandidates({ html: article, siteDomain: "lakeshorekitchens.com", knownRolesOnly: true });
  assert.deepEqual(strict.map((c) => c.email).sort(), ["hello@lakeshorekitchens.com", "priya@lakeshorekitchens.com"]);
  assert.equal(selectBestContact(strict)?.email, "priya@lakeshorekitchens.com");
  const desksOnly = `<p>Orders: orders@pinecrestnursery.com</p><p>Wholesale: wholesale@pinecrestnursery.com</p>`;
  assert.equal(selectBestContact(extractContactCandidates({ html: desksOnly, siteDomain: "pinecrestnursery.com", knownRolesOnly: true })), null, "no one to write to");
  assert.equal(extractContactCandidates({ html: desksOnly, siteDomain: "pinecrestnursery.com" }).length, 2, "the older outreach engine's extraction is unchanged");
  // The author named on the article page makes their address on the contact page a person's.
  const contactPage = `<p>Write to p.raman@lakeshorekitchens.com</p>`;
  assert.equal(extractContactCandidates({ html: contactPage, siteDomain: "lakeshorekitchens.com", knownRolesOnly: true }).length, 0);
  assert.equal(extractContactCandidates({ html: contactPage, siteDomain: "lakeshorekitchens.com", knownRolesOnly: true, people: peopleNamedIn(article) })[0]?.role, "individual");
});

test("the people a page names: metadata, rel=author and bylines, never a link", () => {
  assert.deepEqual(peopleNamedIn(`<meta name="author" content="Dana Whitfield">`), [["dana", "whitfield"]]);
  assert.deepEqual(peopleNamedIn(`<meta property="article:author" content="https://social.example/dana">`), []);
  assert.deepEqual(peopleNamedIn(`<p>By Liam O'Connor · 6 min read</p>`), [["liam", "oconnor"]]);
  assert.deepEqual(peopleNamedIn(`<span class="byline">By <a href="/author/nora">Nora Price</a></span>`), [["nora", "price"]]);
  assert.deepEqual(peopleNamedIn(`<div class="meta">By Theo September 3, 2026</div>`), [["theo"]], "the date is not a surname");
  assert.deepEqual(peopleNamedIn(`<title>Best Chatbots: 9 Tools Compared by Orders Team</title><h1>Find an Address By Phone Number</h1><p>Loved by Accounts Teams</p>`), [],
    "a title's or a sentence's 'by' is never a byline");
  assert.deepEqual(peopleNamedIn(`<a rel="author" href="/team/ines">Inês Duarte</a>`), [["ines", "duarte"]]);
  const dana = [["dana", "whitfield"]];
  for (const local of ["dana", "whitfield", "dana.whitfield", "d.whitfield", "dwhitfield", "danawhitfield"]) assert.equal(namesPerson(local, dana), true, local);
  for (const local of ["danny", "accounts", "d.w", "whitfield.dana.x"]) assert.equal(namesPerson(local, dana), false, local);
  assert.equal(linkContactRole("orders@x.com", []), undefined);
  assert.equal(linkContactRole("enquiries@x.com", []), "general");
  assert.equal(linkContactRole("office@x.com", []), "general");
  assert.equal(linkContactRole("liam@x.com", [["liam", "oconnor"]]), "individual");
  assert.equal(linkContactRole("support@x.com", [["support", "team"]]), undefined, "a desk is never a person");
});

test("emails are written to those people only, and checked again on the live pages just before sending", () => {
  const action = readFileSync("convex/actions/linkOutreach.ts", "utf8");
  assert.equal(action.match(/knownRolesOnly: true/g)?.length, 2, "the page itself and its contact or about pages");
  const send = action.slice(action.indexOf("export const sendNext"));
  assert.match(send, /const site = next\.kind === "first" \? await readSite\(next\.url, next\.domain\) : null;/);
  assert.match(send, /!linkContactRole\(next\.to, site\.people\) \? "desk" as const/);
  assert.ok(send.indexOf("readSite(next.url") < send.indexOf("internal.linkOpportunities.claimSend"), "read before anything is claimed or sent");
  assert.match(action, /if \(shownOutsideUsUk\(html, \{ articlePage: url === pageUrl \}\)\) return \{ read, outside: true, people \};/);
  const records = readFileSync("convex/linkOpportunities.ts", "utf8");
  assert.match(records, /note: unread \? UNREAD_BEFORE_SENDING_NOTE : NOT_AN_EDITOR_NOTE/);
  assert.match(records, /note: OUTSIDE_US_UK_NOTE/);
});
