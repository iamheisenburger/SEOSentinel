import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(path: string): string {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exportedBlock(text: string, name: string): string {
  const start = text.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = text.indexOf("\nexport const ", start + 1);
  return text.slice(start, next < 0 ? text.length : next);
}

test("the documented strip-types command can load the migration script", () => {
  const scriptPath = fileURLToPath(new URL(
    "../scripts/reconcile-clerk-plan-entitlements.ts",
    import.meta.url,
  ));
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--help",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    mode: "help",
    dryRun: "no flags",
    apply: "--apply --confirm-authoritative-clerk-read --expected-total=N",
  });
});

test("fleet migration is dry-run by default and apply needs two explicit guards", () => {
  const script = source("scripts/reconcile-clerk-plan-entitlements.ts");
  assert.match(script, /const apply = args\.includes\(APPLY_FLAG\)/);
  assert.match(script, /apply && \(!confirmed \|\| expectedTotal === null\)/);
  assert.match(script, /--confirm-authoritative-clerk-read/);
  assert.match(script, /--expected-total=/);
  assert.match(script, /mode: "dry_run"/);
  assert.ok(
    script.indexOf("const first = await scanAuthoritativeClerkState") <
      script.indexOf('"/internal/plan/features"'),
  );
  assert.ok(
    script.indexOf("const second = await scanAuthoritativeClerkState") <
      script.indexOf('"/internal/plan/features"'),
  );
  assert.match(
    script,
    /assertSameAuthoritativeSnapshot\(first\.accounts, second\.accounts\)/,
  );
  assert.match(
    script,
    /assertSameAuthoritativeSnapshot\(second\.accounts, final\.accounts\)/,
  );
});

test("migration resolves every account from Clerk Billing and server metadata only", () => {
  const script = source("scripts/reconcile-clerk-plan-entitlements.ts");
  assert.match(script, /clerk\.users\.getUserList/);
  assert.match(script, /clerk\.billing\.getUserBillingSubscription\(user\.id\)/);
  assert.match(script, /resolvePlanEntitlement\(\{/);
  assert.match(script, /privateMetadata: user\.privateMetadata/);
  assert.match(script, /publicMetadata: user\.publicMetadata/);
  assert.doesNotMatch(script, /site\.planFeatures|sites\.planFeatures/);
  assert.match(script, /authoritative_preflight_blocked/);
  assert.match(script, /expected_total_mismatch/);
});

test("backfill output and post-apply proof are aggregate and PII-free", () => {
  const script = source("scripts/reconcile-clerk-plan-entitlements.ts");
  const auditStart = script.indexOf("async function readAudit");
  const mainStart = script.indexOf("async function main");
  const audit = script.slice(auditStart, mainStart);
  const logging = script.slice(mainStart);

  assert.match(audit, /\/internal\/plan\/entitlement-audit/);
  assert.match(script, /latest\.scanned === expectedTotal/);
  assert.match(script, /verifiedCompleted === expectedTotal/);
  assert.match(script, /verifiedReconciling === 0/);
  assert.match(script, /strictGateReady: true/);
  assert.doesNotMatch(logging, /console\.(?:log|error)\([^)]*userId/);
  assert.doesNotMatch(logging, /console\.error\([^)]*(?:message|stack|error)/);
  assert.match(logging, /unexpected_failure/);
});

test("Convex records fresh authoritative receipts without pausing idempotent plans", () => {
  const schema = source("convex/schema.ts");
  const sites = source("convex/sites.ts");
  const start = sites.indexOf("async function applyCanonicalPlanToUserSites");
  const end = sites.indexOf("async function requireSiteOwnerIncludingDeleting", start);
  const apply = sites.slice(start, end);

  assert.match(schema, /authoritativeVerifiedAt: v\.optional\(v\.number\(\)\)/);
  assert.match(apply, /existing\?\.status === "completed"/);
  assert.match(apply, /authoritativeVerifiedAt: timestamp/);
  assert.match(apply, /unchanged: true/);
  const unchanged = apply.indexOf("unchanged: true");
  assert.ok(unchanged >= 0);
  assert.ok(apply.indexOf("const syncVersion") > unchanged);
});

test("the internal audit is authorized, bounded, paginated and returns no tenant identity", () => {
  const sites = source("convex/sites.ts");
  const http = source("convex/http.ts");
  const query = exportedBlock(sites, "auditPlanEntitlementPageInternal");
  const routeStart = http.indexOf('path: "/internal/plan/entitlement-audit"');
  assert.ok(routeStart >= 0);
  const route = http.slice(routeStart, http.indexOf("\n});", routeStart) + 4);

  assert.match(query, /paginate\(\{ cursor: cursor \?\? null, numItems: 100 \}\)/);
  assert.match(query, /authoritativeVerifiedAt/);
  assert.match(query, /verifiedCompleted/);
  assert.match(query, /verifiedReconciling/);
  assert.doesNotMatch(query.slice(query.indexOf("return {")), /userId|domain|planFeatures/);
  assert.match(route, /isAuthorized\(request\)/);
  assert.match(route, /internal\.sites\.auditPlanEntitlementPageInternal/);
});

test("strict rollout fails unknown receipts closed without inventing a Free plan", () => {
  const allowance = source("convex/lib/planSiteAllowance.ts");
  assert.match(allowance, /PENTRA_REQUIRE_ACCOUNT_PLAN_RECEIPT !== "true"/);
  assert.ok(
    allowance.indexOf("if (!entitlement)") <
      allowance.indexOf("PENTRA_REQUIRE_ACCOUNT_PLAN_RECEIPT"),
  );
  const missingBranch = allowance.slice(
    allowance.indexOf("if (!entitlement)"),
    allowance.indexOf("if (entitlement.status"),
  );
  assert.doesNotMatch(missingBranch, /FREE_LIMITS|getLimitsFromFeatures/);
  assert.doesNotMatch(missingBranch, /return\s+\{[^}]*maxSites/);
});

test("runbook audits every current account before the strict production switch", () => {
  const runbook = source("docs/PLAN_ENTITLEMENT_BACKFILL_RUNBOOK.md");
  assert.match(runbook, /Never infer a plan from a[\s\S]*site's cached `planFeatures`/);
  assert.match(runbook, /never turn an unreadable account into Free/i);
  assert.match(runbook, /audit\.verifiedCompleted` equals that same total/);
  assert.match(runbook, /audit\.verifiedReconciling` is `0`/);
  assert.match(runbook, /`audit\.scanned` equals that same total/);
  assert.ok(
    runbook.indexOf("audit.verifiedReconciling") <
      runbook.indexOf("PENTRA_REQUIRE_ACCOUNT_PLAN_RECEIPT true --prod"),
  );
  assert.match(runbook, /PENTRA_REQUIRE_ACCOUNT_PLAN_RECEIPT false --prod/);
});

test("runbook requires the signed billing and account-deletion webhook contract", () => {
  const runbook = source("docs/PLAN_ENTITLEMENT_BACKFILL_RUNBOOK.md");
  for (const event of [
    "subscription.created",
    "subscription.updated",
    "subscription.active",
    "subscription.pastDue",
    "subscriptionItem.created",
    "subscriptionItem.updated",
    "subscriptionItem.active",
    "subscriptionItem.canceled",
    "subscriptionItem.upcoming",
    "subscriptionItem.ended",
    "subscriptionItem.abandoned",
    "subscriptionItem.incomplete",
    "subscriptionItem.pastDue",
    "subscriptionItem.freeTrialEnding",
    "user.deleted",
  ]) {
    assert.match(runbook, new RegExp(event.replace(".", "\\.")));
  }
  assert.match(runbook, /`\/api\/webhooks\/clerk-billing`/);
  assert.match(runbook, /`CLERK_WEBHOOK_SIGNING_SECRET`/);
  assert.match(runbook, /invalid-signature smoke request/);
  assert.match(runbook, /does not hard-code a fleet size/);
  assert.doesNotMatch(runbook, /(?:five|six|eight) Clerk accounts/);
});
