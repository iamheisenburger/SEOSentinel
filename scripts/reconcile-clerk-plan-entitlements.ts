import { createClerkClient } from "@clerk/backend";

import {
  resolvePlanEntitlement,
  type AuthoritativePlanFeatures,
  type ClerkBillingSubscriptionLike,
} from "../src/lib/clerk-billing-reconciliation.ts";
import type { CanonicalPlanTier } from "../convex/planLimits.ts";
import { callPentraInternal } from "../src/lib/pentra-internal-api.ts";

const APPLY_FLAG = "--apply";
const CONFIRM_FLAG = "--confirm-authoritative-clerk-read";
const DEFAULT_PAGE_SIZE = 100;
const AUDIT_ATTEMPTS = 30;
const AUDIT_DELAY_MS = 2_000;

type ReconciledAccount = {
  userId: string;
  entitlement: AuthoritativePlanFeatures;
};

type ScanResult = {
  total: number;
  accounts: ReconciledAccount[];
  tiers: Record<CanonicalPlanTier, number>;
  blocked: Record<string, number>;
};

type AuditPage = {
  ok: true;
  scanned: number;
  verifiedCompleted: number;
  verifiedReconciling: number;
  isDone: boolean;
  cursor?: string;
};

type AuditSummary = {
  scanned: number;
  verifiedCompleted: number;
  verifiedReconciling: number;
};

class SafeFailure extends Error {
  readonly category: string;

  constructor(category: string) {
    super(category);
    this.category = category;
    this.name = "SafeFailure";
  }
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function flagValue(args: readonly string[], prefix: string): string | undefined {
  return args.find((argument) => argument.startsWith(`${prefix}=`))
    ?.slice(prefix.length + 1);
}

function parseArguments(args: readonly string[]) {
  const allowed = args.every((argument) =>
    argument === APPLY_FLAG ||
    argument === CONFIRM_FLAG ||
    argument === "--help" ||
    argument.startsWith("--expected-total=") ||
    argument.startsWith("--page-size=")
  );
  if (!allowed) throw new SafeFailure("invalid_arguments");

  const apply = args.includes(APPLY_FLAG);
  const confirmed = args.includes(CONFIRM_FLAG);
  const expectedTotalValue = flagValue(args, "--expected-total");
  const expectedTotal = expectedTotalValue === undefined
    ? null
    : parsePositiveInteger(expectedTotalValue);
  const pageSizeValue = flagValue(args, "--page-size");
  const pageSize = pageSizeValue === undefined
    ? DEFAULT_PAGE_SIZE
    : parsePositiveInteger(pageSizeValue);
  if (!pageSize || pageSize > 100) {
    throw new SafeFailure("invalid_page_size");
  }
  if (apply && (!confirmed || expectedTotal === null)) {
    throw new SafeFailure("apply_confirmation_required");
  }
  return { apply, expectedTotal, pageSize };
}

function emptyTierCounts(): Record<CanonicalPlanTier, number> {
  return { free: 0, starter: 0, pro: 0, scale: 0, enterprise: 0 };
}

async function scanAuthoritativeClerkState(
  clerk: ReturnType<typeof createClerkClient>,
  pageSize: number,
): Promise<ScanResult> {
  const accounts: ReconciledAccount[] = [];
  const tiers = emptyTierCounts();
  const blocked: Record<string, number> = {};
  let total: number | null = null;
  let offset = 0;

  while (total === null || offset < total) {
    let page;
    try {
      page = await clerk.users.getUserList({
        limit: pageSize,
        offset,
        orderBy: "+created_at",
      });
    } catch {
      throw new SafeFailure("clerk_user_list_unavailable");
    }
    if (total === null) total = page.totalCount;
    if (page.totalCount !== total) {
      throw new SafeFailure("clerk_user_count_changed");
    }
    if (page.data.length === 0 && offset < total) {
      throw new SafeFailure("clerk_pagination_incomplete");
    }

    for (const user of page.data) {
      let subscription: ClerkBillingSubscriptionLike;
      try {
        subscription = await clerk.billing.getUserBillingSubscription(user.id);
      } catch {
        blocked.clerk_billing_read_failed =
          (blocked.clerk_billing_read_failed ?? 0) + 1;
        continue;
      }
      const resolution = resolvePlanEntitlement({
        subscription,
        metadata: {
          privateMetadata: user.privateMetadata,
          publicMetadata: user.publicMetadata,
        },
      });
      if (!resolution.ok) {
        blocked[resolution.reason] = (blocked[resolution.reason] ?? 0) + 1;
        continue;
      }
      tiers[resolution.entitlement.tier] += 1;
      accounts.push({ userId: user.id, entitlement: resolution.entitlement });
    }
    offset += page.data.length;
  }

  return { total: total ?? 0, accounts, tiers, blocked };
}

function assertCompleteScan(scan: ScanResult, expectedTotal?: number | null) {
  if (expectedTotal !== undefined && expectedTotal !== null &&
      scan.total !== expectedTotal) {
    throw new SafeFailure("expected_total_mismatch");
  }
  const blockedCount = Object.values(scan.blocked)
    .reduce((sum, count) => sum + count, 0);
  if (blockedCount > 0 || scan.accounts.length !== scan.total) {
    throw new SafeFailure("authoritative_preflight_blocked");
  }
}

function assertSameAuthoritativeSnapshot(
  first: readonly ReconciledAccount[],
  second: readonly ReconciledAccount[],
) {
  const firstById = new Map(first.map((account) => [
    account.userId,
    `${account.entitlement.tier}:${[...account.entitlement.planFeatures].sort().join(",")}`,
  ]));
  if (firstById.size !== second.length) {
    throw new SafeFailure("clerk_authoritative_state_changed");
  }
  for (const account of second) {
    const fingerprint =
      `${account.entitlement.tier}:${[...account.entitlement.planFeatures].sort().join(",")}`;
    if (firstById.get(account.userId) !== fingerprint) {
      throw new SafeFailure("clerk_authoritative_state_changed");
    }
  }
}

async function readAudit(authoritativeVerifiedSince: number) {
  const summary: AuditSummary = {
    scanned: 0,
    verifiedCompleted: 0,
    verifiedReconciling: 0,
  };
  let cursor: string | undefined;
  do {
    const page = await callPentraInternal<AuditPage>(
      "/internal/plan/entitlement-audit",
      { authoritativeVerifiedSince, cursor },
    );
    if (page.ok !== true) throw new SafeFailure("entitlement_audit_failed");
    summary.scanned += page.scanned;
    summary.verifiedCompleted += page.verifiedCompleted;
    summary.verifiedReconciling += page.verifiedReconciling;
    cursor = page.isDone ? undefined : page.cursor;
    if (!page.isDone && !cursor) {
      throw new SafeFailure("entitlement_audit_incomplete");
    }
  } while (cursor);
  return summary;
}

async function waitForAudit(
  authoritativeVerifiedSince: number,
  expectedTotal: number,
) {
  let latest: AuditSummary | null = null;
  for (let attempt = 0; attempt < AUDIT_ATTEMPTS; attempt += 1) {
    latest = await readAudit(authoritativeVerifiedSince);
    if (
      latest.scanned === expectedTotal &&
      latest.verifiedCompleted === expectedTotal &&
      latest.verifiedReconciling === 0
    ) return latest;
    if (attempt + 1 < AUDIT_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, AUDIT_DELAY_MS));
    }
  }
  throw new SafeFailure("entitlement_audit_timeout");
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (process.argv.includes("--help")) {
    console.log(JSON.stringify({
      mode: "help",
      dryRun: "no flags",
      apply: `${APPLY_FLAG} ${CONFIRM_FLAG} --expected-total=N`,
    }));
    return;
  }
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) throw new SafeFailure("clerk_secret_not_configured");
  const clerk = createClerkClient({ secretKey });

  // Pass one proves every current account has an unambiguous authoritative
  // Clerk Billing + server-metadata result. No Convex write happens here.
  const first = await scanAuthoritativeClerkState(clerk, args.pageSize);
  assertCompleteScan(first, args.expectedTotal);
  if (!args.apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry_run",
      total: first.total,
      tiers: first.tiers,
      blocked: first.blocked,
      applied: 0,
    }));
    return;
  }

  // Pass two closes the check/use gap. It must resolve the same complete Clerk
  // fleet immediately before the first write; a changed fleet aborts safely.
  const second = await scanAuthoritativeClerkState(clerk, args.pageSize);
  assertCompleteScan(second, args.expectedTotal);
  assertSameAuthoritativeSnapshot(first.accounts, second.accounts);

  const authoritativeVerifiedSince = Date.now();
  let applied = 0;
  for (const account of second.accounts) {
    await callPentraInternal<{ ok: true }>("/internal/plan/features", {
      userId: account.userId,
      planFeatures: account.entitlement.planFeatures,
    });
    applied += 1;
  }
  // Re-read the provider after writes. A changed account, tier, or trusted
  // metadata value leaves the strict gate off until a clean idempotent rerun.
  const final = await scanAuthoritativeClerkState(clerk, args.pageSize);
  assertCompleteScan(final, args.expectedTotal);
  assertSameAuthoritativeSnapshot(second.accounts, final.accounts);
  const audit = await waitForAudit(authoritativeVerifiedSince, second.total);
  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    total: second.total,
    tiers: second.tiers,
    blocked: second.blocked,
    applied,
    audit,
    strictGateReady: true,
  }));
}

main().catch((error: unknown) => {
  const category = error instanceof SafeFailure
    ? error.category
    : "unexpected_failure";
  // Deliberately exclude exception messages, Clerk ids, metadata and payloads.
  console.error(JSON.stringify({ ok: false, category }));
  process.exitCode = 1;
});
