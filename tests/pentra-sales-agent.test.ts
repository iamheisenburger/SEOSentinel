import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PENTRA_SALES_AGENT_EMBED_KEY,
  isPentraSalesAgentRoute,
} from "../src/lib/pentra-sales-agent.ts";

test("Pentra's sales agent appears only on public marketing routes", () => {
  for (const pathname of [
    "/",
    "/pricing",
    "/contact",
    "/blog",
    "/blog/autonomous-seo",
    "/legal/privacy",
  ]) {
    assert.equal(isPentraSalesAgentRoute(pathname), true, pathname);
  }

  for (const pathname of [
    "/dashboard",
    "/analytics",
    "/articles",
    "/backlinks",
    "/jobs",
    "/plan",
    "/settings",
    "/sites",
    "/sign-in",
    "/sign-up",
  ]) {
    assert.equal(isPentraSalesAgentRoute(pathname), false, pathname);
  }
});

test("Pentra loads its dedicated LeadPilot agent and cleans it up on SPA navigation", () => {
  const component = readFileSync("src/components/pentra-sales-agent.tsx", "utf8");
  const config = readFileSync("src/lib/pentra-sales-agent.ts", "utf8");
  assert.match(component, /https:\/\/leadpilot\.chat\/embed\.js/);
  assert.match(component, /registry\?\.\[PENTRA_SALES_AGENT_EMBED_KEY\]\?\.destroy\(\)/);
  assert.match(component, /script\.dataset\.agent = PENTRA_SALES_AGENT_EMBED_KEY/);
  assert.match(component, /document\.getElementById\("leadpilot-widget"\)\?\.remove\(\)/);
  assert.match(config, new RegExp(PENTRA_SALES_AGENT_EMBED_KEY));
});
