import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const blogPostRoute = readFileSync("src/app/blog/[slug]/page.tsx", "utf8");

test("published blog posts render and emit per-article SEO data on the server", () => {
  assert.doesNotMatch(blogPostRoute, /^['\"]use client['\"];?/m);
  assert.doesNotMatch(blogPostRoute, /useQuery|useParams|useEffect/);
  assert.match(blogPostRoute, /convexHttp\.query\(api\.blog\.getPublishedBySlug/);
  assert.match(blogPostRoute, /export async function generateMetadata/);
  assert.match(blogPostRoute, /alternates: canonical \? \{ canonical \}/);
  assert.match(blogPostRoute, /openGraph:/);
});

test("published blog posts preserve safe Markdown and escaped server JSON-LD", () => {
  assert.match(blogPostRoute, /<ReactMarkdown/);
  assert.doesNotMatch(blogPostRoute, /rehypeRaw|rehype-raw/);
  assert.match(blogPostRoute, /function jsonLd/);
  assert.match(blogPostRoute, /\.replace\(\/<\/g, "\\\\u003c"\)/);
  assert.match(blogPostRoute, /dangerouslySetInnerHTML=\{\{ __html: jsonLd\(/);
});
