import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoritySource = readFileSync(
  new URL("../convex/seoAuthority.ts", import.meta.url),
  "utf8",
);
const actionSource = readFileSync(
  new URL("../convex/actions/outreach.ts", import.meta.url),
  "utf8",
);
const growthLoopSource = readFileSync(
  new URL("../convex/growthLoop.ts", import.meta.url),
  "utf8",
);

test("controlled backlink source and target are derived from same-owner sites", () => {
  assert.match(
    authoritySource,
    /targetSite\.userId !== sourceSite\?\.userId/,
  );
  assert.match(
    authoritySource,
    /const sourceUrl = `https:\/\/\$\{sourceDomain\}\/pentra-growth-verification`/,
  );
  assert.match(
    authoritySource,
    /const targetUrl = `https:\/\/\$\{targetDomain\}\/`/,
  );
});

test("controlled backlink acquisition uses the ordinary exact-href verifier", () => {
  const coordinator = actionSource.slice(
    actionSource.indexOf("export const verifyControlledBacklinkCanaryInternal"),
  );
  assert.match(coordinator, /verifyHandler\(ctx, targetSiteId, 50\)/);
  assert.match(actionSource, /hasExactAuthorityLink/);
  assert.match(actionSource, /internal\.seoAuthority\.markAcquired/);
});

test("a still-live acquired link advances its exact recheck receipt", () => {
  assert.match(
    actionSource,
    /for \(const opportunity of alreadyAcquired\)[\s\S]*receipt\.found && receipt\.receiptUrl[\s\S]*internal\.seoAuthority\.markAcquired/,
  );
});

test("controlled backlink receipts stay out of customer growth metrics", () => {
  assert.match(
    authoritySource,
    /filter\(\(row\) => row\.type !== "controlled_backlink_canary"\)/,
  );
  assert.match(
    growthLoopSource,
    /customerAcquiredOpportunities = opportunities\.filter/,
  );
  assert.match(
    growthLoopSource,
    /acquiredBacklinks: customerAcquiredOpportunities\.length/,
  );
});
