import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
const autopilot = readFileSync("convex/autopilot.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");

test("legacy tenants retain their established topic scheduling contract", () => {
  assert.match(schema, /expectedClickSchedulingEnabled: v\.optional\(v\.boolean\(\)\)/);
  assert.match(
    scheduler,
    /const strictExpectedClickScheduling =\s*site\.expectedClickSchedulingEnabled === true/,
  );
  assert.match(scheduler, /if \(!strictExpectedClickScheduling\)[\s\S]*if \(!site\.verifiedKeywordDataRequired\) return true/);
  assert.match(
    scheduler,
    /strictExpectedClickScheduling && !portfolio\.supportsGoal/,
  );
});

test("legacy planning avoids expected-click spend and terminal evidence gates", () => {
  assert.match(
    pipeline,
    /const expectedClickSchedulingEnabled =\s*site\.expectedClickSchedulingEnabled === true/,
  );
  assert.match(
    pipeline,
    /expectedClickSchedulingEnabled &&\s*requireVerifiedKeywordData &&\s*!domainMetrics/,
  );
  assert.match(
    pipeline,
    /const expectedClickEvidenceRequired =\s*expectedClickSchedulingEnabled && requireVerifiedKeywordData/,
  );

  const authorityGateStart = pipeline.indexOf(
    "if (expectedClickEvidenceRequired)",
  );
  const topicSaveStart = pipeline.indexOf(
    "// STEP 6: Save fully enriched topics to DB",
    authorityGateStart,
  );
  const authorityGate = pipeline.slice(authorityGateStart, topicSaveStart);
  assert.match(authorityGate, /getDomainAuthorities/);
  assert.match(authorityGate, /No topic retained five fresh page-one authority/);
});

test("observational portfolio data cannot degrade health before canary enablement", () => {
  assert.match(
    autopilot,
    /runSite\?\.expectedClickSchedulingEnabled === true &&\s*currentPortfolioHealth\?\.portfolioSupportsGoal === false/,
  );
  const siteGatedOverrides = autopilot.match(
    /site\.expectedClickSchedulingEnabled === true &&\s*health\?\.portfolioSupportsGoal === false/g,
  );
  assert.equal(siteGatedOverrides?.length, 2);
});

test("expected-click scheduling is an internal per-tenant canary", () => {
  const setter = sites.slice(
    sites.indexOf("export const setExpectedClickScheduling"),
    sites.indexOf("export const resetAll"),
  );
  assert.match(setter, /internalMutation/);
  assert.match(setter, /expectedClickSchedulingEnabled: enabled/);
  assert.match(setter, /cancelAutonomousJobsForEpochTransition/);
  assert.match(setter, /false,\s*true/);
  assert.doesNotMatch(setter, /autopilotRolloutEpoch/);
  assert.match(setter, /Expected-click scheduling contract changed/);
  assert.doesNotMatch(setter, /mutation\(\{/);
});
