// Pentra Answers (Nov 2026): the hosted answers address (answers.<customer domain>) serves the customer's published answer
// pages from Pentra, as public pages in the customer's name: routed before Clerk, its own sitemap, robots and IndexNow key,
// and none of Pentra's analytics or sales chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("answers.<domain> is routed to the hosted pages before Clerk, by its host alone", () => {
  const proxy = read("src/proxy.ts");
  const hosted = proxy.indexOf("const hosted = hostedAnswersRewrite(request);");
  assert.ok(hosted > 0 && hosted < proxy.indexOf("const isLocalAcceptance"), "before the Clerk and acceptance paths");
  assert.match(proxy, /if \(!host\.startsWith\("answers\."\) \|\| host\.split\("\."\)\.length < 3/);
  assert.match(proxy, /NextResponse\.rewrite\(new URL\(`\/hosted-answers\/\$\{parts\[0\]\}`, request\.url\)\)/);
  assert.match(proxy, /\/\^\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\$\/\.test\(parts\[0\]\)/, "only safe page addresses");
});

test("a hosted page shows only a live, published page; the sitemap, robots and IndexNow key follow the host", () => {
  const page = read("src/app/hosted-answers/[slug]/page.tsx");
  assert.match(page, /if \(!isHostedAnswersHost\(host\)\) notFound\(\);/);
  assert.match(page, /api\.answerPublish\.hostedPage/);
  assert.match(page, /"@type": "Article"/);
  assert.match(page, /alternates: \{ canonical: url \}/);
  assert.match(read("src/app/sitemap.ts"), /if \(isHostedAnswersHost\(host\)\) \{\n\s+const index = await convexHttp\.query\(api\.answerPublish\.hostedIndex/);
  assert.match(read("src/app/robots.ts"), /sitemap: `https:\/\/\$\{host\}\/sitemap\.xml`/);
  assert.match(read("src/app/pentra-indexnow.txt/route.ts"), /index\.indexNowKey/);
  const query = read("convex/answerPublish.ts");
  assert.match(query, /site\.answers\.publishing\.hostedStatus !== "live"\) return null;/, "nothing renders before the address is live");
  assert.match(query, /\.filter\(\(q\) => q\.eq\(q\.field\("status"\), "published"\)\)/, "drafts never render");
});

test("Pentra's analytics and sales chat stay off customers' addresses", () => {
  assert.match(read("src/app/layout.tsx"), /if\(\/\(\^\|\\\\\.\)pentra\\\\\.dev\$\/\.test\(location\.hostname\)\)\{window\.dataLayer/);
  assert.match(read("src/components/pentra-sales-agent.tsx"), /const onPentra = \/\(\^\|\\\.\)pentra\\\.dev\$\/\.test\(window\.location\.hostname\)/);
  assert.match(read("src/components/pentra-sales-agent.tsx"), /if \(!enabled \|\| !onPentra\)/);
});
