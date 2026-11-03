// P300 (Nov 3 2026): publishing batch 5's cookware comparison to the Webflow test site failed: Webflow answered 400 "text: Is
// too long (maximum is 140 characters), got: 150". The blog template's "Intro Text" field, which its SEO settings bind to the
// page's meta description, takes 140 characters, and Pentra sent the description cut at 256. A field's own limit is honoured.
import test from "node:test";
import assert from "node:assert/strict";
import { publishToCms, webflowFieldMap } from "../convex/lib/cmsPublishers.ts";

const fields = [
  { slug: "name", type: "PlainText", isRequired: true, displayName: "Name", validations: { maxLength: 256 } },
  { slug: "slug", type: "PlainText", isRequired: true, displayName: "Slug" },
  { slug: "title", type: "PlainText", isRequired: true, displayName: "Title", validations: { maxLength: 70 } },
  { slug: "text", type: "PlainText", isRequired: true, displayName: "Intro Text", validations: { maxLength: 140 } },
  { slug: "post-content", type: "RichText", isRequired: true, displayName: "Post Content" },
];
const description = "Compare ceramic-coated pans, bare cast iron and enameled cast iron on construction, oven limits, care and cost to pick the right pan for your kitchen.";

test("P300 a Webflow field's own length limit is read from the collection", () => {
  assert.deepEqual(webflowFieldMap(fields), { body: "post-content", summary: "text", seoTitle: "title", summaryMax: 140, seoTitleMax: 70 });
});

test("P300 the description goes into a 140-character field cut at a word, and Webflow accepts the item", async () => {
  assert.equal(description.length, 150);
  let posted: Record<string, unknown> | null = null;
  const request = async (url: string, init: { method?: string; body?: string }) => {
    const json = (body: unknown, status = 200) => ({ status, text: JSON.stringify(body) });
    if (url === "https://api.webflow.com/v2/sites") return json({ sites: [{ id: "site-1", shortName: "pentra-webflow-test", customDomains: [] }] });
    if (url === "https://api.webflow.com/v2/sites/site-1/collections") return json({ collections: [{ id: "col-1", slug: "posts" }] });
    if (url === "https://api.webflow.com/v2/collections/col-1") return json({ id: "col-1", slug: "posts", fields });
    if (url.startsWith("https://api.webflow.com/v2/collections/col-1/items?")) return json({ items: [] });
    assert.equal(url, "https://api.webflow.com/v2/collections/col-1/items/live");
    const fieldData = JSON.parse(init.body!).fieldData;
    for (const field of fields) {
      const max = (field as { validations?: { maxLength?: number } }).validations?.maxLength;
      if (max && String(fieldData[field.slug] ?? "").length > max) return json({ message: "Validation Error", details: [{ param: field.slug, description: `Is too long (maximum is ${max} characters)` }] }, 400);
    }
    posted = fieldData;
    return json({ id: "item-1", isDraft: false, fieldData }, 202);
  };
  const site = { publishMethod: "webflow", domain: "pentra-webflow-test.webflow.io", cmsSecret: "w".repeat(64), cmsCollection: "posts" } as const;
  const article = { slug: "ceramic-vs-cast-iron-cookware", title: "Ceramic vs Cast Iron Cookware: How to Choose", metaTitle: "Ceramic vs Cast Iron Cookware: How to Choose",
    metaDescription: description, markdown: "Body.", html: "<p>Body.</p>" };
  const receipt = await publishToCms({ site: site as never, article: article as never, deliveryKey: `pentra:${"b".repeat(64)}`, contentHash: "c".repeat(64),
    publicUrl: "https://pentra-webflow-test.webflow.io/posts/ceramic-vs-cast-iron-cookware", urlStructure: "/posts/[slug]", hadPriorAttempt: false,
    beforeExternalMutation: async () => {}, request: request as never });
  assert.equal(receipt.externalId, "item-1");
  const text = String(posted!.text);
  assert.ok(text.length <= 140, text);
  assert.equal(text, "Compare ceramic-coated pans, bare cast iron and enameled cast iron on construction, oven limits, care and cost to pick the right pan for…");
  assert.equal(posted!.title, article.metaTitle, "a title under its limit is unchanged");
});
