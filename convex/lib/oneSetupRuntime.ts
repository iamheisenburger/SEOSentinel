import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { accountDeletionKey } from "./accountDeletion.ts";
import {
  oneSetupPublisherReceiptVerified,
  oneSetupSearchMeasurementReceiptVerified,
} from "./oneSetupCanonical.ts";
import {
  normalizedOneSetupDomain,
  ONE_SETUP_CONTRACT_VERSION,
} from "./oneSetup.ts";
import {
  oneSetupDomainRevisionReceiptMatches,
} from "./oneSetupInitialPlan.ts";
import {
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "./siteDomainBinding.ts";

export async function oneSetupPromotionBlockers(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
  stage: "warm" | "live" = "warm",
): Promise<string[]> {
  const request = await ctx.db
    .query("managed_provisioning_requests")
    .withIndex("by_site", (q) => q.eq("siteId", site._id))
    .unique();
  if (!request) return [];
  const domainSnapshot = site.canonicalDomain ??
    normalizedOneSetupDomain(site.domain);
  if (
    !site.userId ||
    site.deletionStatus ||
    site.accountDeletionRequestedAt ||
    request.ownerAccountKey !== accountDeletionKey(site.userId) ||
    request.domainSnapshot !== domainSnapshot ||
    !oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision: siteCanonicalDomainRevision(site),
      receiptDomainRevision: request.domainRevisionSnapshot,
      legacyUnstampedAllowed: siteUsesLegacyDomainReceipts(site),
    }) ||
    request.contractVersion !== ONE_SETUP_CONTRACT_VERSION
  ) {
    return ["one_setup_request_stale"];
  }
  // Content research and the sealed warm buffer must not wait for later-stage
  // measurement or authority setup. Publishing is the only additional
  // one-setup promotion fence here; live already applies its canonical GSC
  // gate and outreach has a separate consent/mailbox execution boundary.
  const blockers: string[] = [];
  if (!oneSetupPublisherReceiptVerified(site)) {
    blockers.push("one_setup_publisher_receipt_missing");
  }
  if (
    stage === "live" &&
    !oneSetupSearchMeasurementReceiptVerified(site)
  ) {
    blockers.push("one_setup_search_measurement_receipt_missing");
  }
  return blockers;
}
