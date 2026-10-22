import assert from "node:assert/strict";
import test from "node:test";
import { relatedArticles } from "../src/lib/related-articles.ts";

// P159 (Oct 22 2026): 58 of pentra.dev's 80 articles linked to no other article; most were reachable only from
// /blog, and Google left 10 recent ones "discovered, currently not indexed".
test("an article page links the articles that share its subject, then the newest ones", () => {
  const day = 86_400_000;
  const articles = [
    { slug: "international-keyword-research", title: "International keyword research", createdAt: 10 * day },
    { slug: "ppc-keyword-research-framework", title: "A PPC keyword research framework", createdAt: 3 * day },
    { slug: "ecommerce-keyword-research-2", title: "Ecommerce keyword research", createdAt: 4 * day },
    { slug: "content-automation-platforms-explained", title: "Content automation platforms explained", createdAt: 9 * day },
    { slug: "weekly-website-seo-health-checks", title: "Weekly website SEO health checks", createdAt: 8 * day },
    { slug: "saas-keyword-research", title: "SaaS keyword research", createdAt: 7 * day },
    { slug: "blog-publishing-frequency", title: "How often to publish", createdAt: 1 * day },
  ];
  const related = relatedArticles({ slug: "/ppc-keyword-research-framework/", title: "A PPC keyword research framework" }, articles);
  assert.deepEqual(related.map((a) => a.slug), ["international-keyword-research", "saas-keyword-research", "ecommerce-keyword-research-2",
    "content-automation-platforms-explained", "weekly-website-seo-health-checks"], "three on its subject (newest first), then the two newest others");
  assert.ok(!related.some((a) => a.slug === "ppc-keyword-research-framework"), "never itself");
  // An article sharing no subject word still links five others, newest first: a new article is linked from every page.
  assert.deepEqual(relatedArticles({ slug: "blog-publishing-frequency", title: "How often to publish" }, articles).map((a) => a.slug),
    ["international-keyword-research", "content-automation-platforms-explained", "weekly-website-seo-health-checks", "saas-keyword-research",
      "ecommerce-keyword-research-2"]);
  assert.deepEqual(relatedArticles({ slug: "only", title: "Only article" }, [{ slug: "only", title: "Only article", createdAt: 1 }]), []);
});
