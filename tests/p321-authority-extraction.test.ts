// P321: the authority recovery extracts in code. These pins use fictional utilities, cities and programs —
// nothing from the benchmark — because the guarantee being pinned is that the extractor knows no place.
import test from "node:test";
import assert from "node:assert/strict";
import { authorityFactsFromPage, verifiedRecords } from "../convex/lib/articleAssembly.ts";

const now = Date.UTC(2026, 10, 4);
const sections = ["What it costs", "Rebates and incentives", "Permits and rules"];
const covers = new Map([["What it costs", "installed price ranges"], ["Rebates and incentives", "utility rebate amounts and eligibility"], ["Permits and rules", "city permit requirements and fees"]]);

test("P321: a rebate sentence of the owner's page becomes a record quoted verbatim", () => {
  const excerpt = `Northline Gas — rebates
Eligible customers receive a $300 rebate for qualifying high-efficiency units. Income limits apply; see the program page for details.`;
  const facts = authorityFactsFromPage({ item: "Utility rebate amounts and eligibility, from the utility or program that pays them",
    excerpt, source: 2, owner: "Northline Gas", sections, covers });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].value, "$300");
  assert.equal(facts[0].kind, "rebate");
  assert.equal(facts[0].section, "Rebates and incentives");
  assert.ok(excerpt.includes(facts[0].quote), "the quote is a slice of the excerpt");
});

test("P321: verification passes deterministically — the quote IS the excerpt's text", () => {
  const excerpt = `Harbor Electric incentives
Customers installing a qualifying heat pump receive up to $1,200 back after installation.`;
  const facts = authorityFactsFromPage({ item: "Utility rebate amounts for qualifying units", excerpt, source: 1, owner: "Harbor Electric", sections, covers });
  assert.equal(facts.length, 1);
  const v = verifiedRecords({ options: [], facts, faqs: [], steps: [] },
    { sources: [{ url: "https://harbor-electric.example/rebates", title: "Rebates", excerpt }], profile: "Biz", productName: "Biz", competitors: [], sections, now });
  assert.equal(v.facts.length, 1, `verification is by construction; dropped: ${JSON.stringify(v.dropped)}`);
});

test("P321: a percentage credit and a permit fee row both extract", () => {
  const excerpt = `City of Millbrook
| Permit type | Fee |
| --- | --- |
| Water heater replacement permit | $85 |
The federal credit covers 30% of qualifying costs.`;
  const fee = authorityFactsFromPage({ item: "City permit fee for replacement, from the city permit office", excerpt, source: 1, owner: "City of Millbrook", sections, covers });
  assert.equal(fee.length, 1);
  assert.equal(fee[0].value, "$85");
  assert.equal(fee[0].kind, "fee");
  assert.equal(fee[0].section, "Permits and rules");
  const credit = authorityFactsFromPage({ item: "Tax credit percentage for qualifying installations", excerpt, source: 1, owner: "City of Millbrook", sections, covers });
  assert.equal(credit.length, 1);
  assert.equal(credit[0].value, "30%");
});

test("P321: no figure or no term match yields nothing; an expired program is dropped by the records rules", () => {
  const noFigure = authorityFactsFromPage({ item: "Utility rebate amounts", excerpt: `Northline Gas
Rebates are available for eligible customers each season.`, source: 1, owner: "Northline Gas", sections, covers });
  assert.equal(noFigure.length, 0);
  const noTerm = authorityFactsFromPage({ item: "Utility rebate amounts", excerpt: `Northline Gas
The $300 program is closed.`, source: 1, owner: "Northline Gas", sections, covers });
  assert.equal(noTerm.length, 0);
  const expired = authorityFactsFromPage({ item: "Utility rebate amounts", excerpt: `Northline Gas
A $300 rebate was available through December 31, 2024.`, source: 1, owner: "Northline Gas", sections, covers });
  const v = verifiedRecords({ options: [], facts: expired, faqs: [], steps: [] },
    { sources: [{ url: "https://northline.example/rebates", title: "Rebates", excerpt: `Northline Gas
A $300 rebate was available through December 31, 2024.` }], profile: "Biz", productName: "Biz", competitors: [], sections, now });
  assert.equal(v.facts.length, 0, "the R9 rules the model's records face drop this too");
});
