// P231 (Oct 27 2026): P162 let an article name another company only when its search did. pentra.dev's Oct 27 article
// for "free ai tools for seo optimization" named no tool at all, while its one growing page ("Best Free SEO Tools for
// Small Teams", 25 → 72 impressions a week, written in July) has a section for each of the five tools it names. A search
// for a kind of product now gets the products named, with facts only from cited sources; listed competitors stay banned.
import assert from "node:assert/strict";
import test from "node:test";
import { citedCompanyName, otherCompaniesRule, searchAsksForProducts } from "../convex/lib/sourceQuality.ts";
import { unsearchedCompanyMentions } from "../convex/lib/autopilotEditor.ts";

test("P231 a search for a kind of product is told apart from one about a task or an idea", () => {
  for (const search of ["free ai tools for seo optimization", "lead scoring solutions", "best crm for realtors", "blog publishing services",
    "seo tool for remote teams", "ai blog post generator", "wordpress seo plugins", "free seo content writing software", "lead capture tools"]) {
    assert.equal(searchAsksForProducts(search), true, search);
  }
  for (const search of ["seo web content writing", "how often should a small business publish blog posts", "what is lead scoring",
    "lead scoring template", "dealership lead scoring system", "lead qualification process", "", undefined]) {
    assert.equal(searchAsksForProducts(search), false, String(search));
  }
});

test("P231 the writer names the products a search for a kind of product asks for, from cited sources only", () => {
  const category = otherCompaniesRule("free ai tools for seo optimization");
  assert.match(category, /name the specific products a reader would compare/);
  assert.match(category, /Every fact about a product must come from a supplied source, cited/);
  assert.match(category, /never state another product's prices, plans, editions, limits or rankings unless a supplied source states them/);
  assert.match(category, /Never name the banned companies above\./);
  assert.match(otherCompaniesRule("lead scoring marketing"), /^- OTHER COMPANIES: Name another company or product only when the primary keyword names it\./,
    "any other search keeps P162's rule");
});

test("P231 the edit pass leaves product names in an article for a kind of product, and still removes them elsewhere", () => {
  const markdown = "Ahrefs Webmaster Tools reports a site's backlinks for free [1].\n\n## Sources\n\n[1] AWT — https://help.ahrefs.com/awt";
  const companies = [citedCompanyName("https://help.ahrefs.com/awt")];
  assert.deepEqual(unsearchedCompanyMentions(markdown, companies, { search: "free seo tools for small teams", business: ["Pentra"] }), []);
  assert.equal(unsearchedCompanyMentions(markdown, companies, { search: "how to find broken backlinks", business: ["Pentra"] }).length, 1);
});
