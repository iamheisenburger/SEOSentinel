import type { Doc } from "../_generated/dataModel";
import { publicationDestinationBlockers } from "./autopilotReadiness.ts";
import { autonomousGmailCredentialIssues } from "./outreachDelivery.ts";

export function oneSetupPublisherReceiptVerified(
  site: Doc<"sites">,
): boolean {
  return publicationDestinationBlockers(site).length === 0;
}

export function oneSetupSearchMeasurementReceiptVerified(
  site: Doc<"sites">,
): boolean {
  return Boolean(site.gscAccessToken && site.gscProperty);
}

export function oneSetupOutreachMailboxReceiptVerified(args: {
  inboxes: readonly Doc<"outreach_inboxes">[];
  ownerAccountKey: string;
}): boolean {
  const inbox = args.inboxes.length === 1 ? args.inboxes[0] : null;
  return Boolean(
    inbox &&
      inbox.credentialOwnerAccountKey === args.ownerAccountKey &&
      ["warming", "active"].includes(inbox.status) &&
      inbox.verifiedAt &&
      inbox.spfVerifiedAt &&
      inbox.dkimVerifiedAt &&
      inbox.dmarcVerifiedAt &&
      inbox.complianceConfirmedAt &&
      autonomousGmailCredentialIssues({
        oauthScopes: inbox.oauthScopes,
        hasRefreshToken: Boolean(inbox.oauthRefreshToken),
      }).length === 0,
  );
}

export function oneSetupCanonicalReceiptBlockers(args: {
  site: Doc<"sites">;
  inboxes: readonly Doc<"outreach_inboxes">[];
  ownerAccountKey: string;
}): string[] {
  const blockers: string[] = [];
  if (!oneSetupPublisherReceiptVerified(args.site)) {
    blockers.push("one_setup_publisher_receipt_missing");
  }
  if (!oneSetupSearchMeasurementReceiptVerified(args.site)) {
    blockers.push("one_setup_search_measurement_receipt_missing");
  }
  if (!oneSetupOutreachMailboxReceiptVerified(args)) {
    blockers.push("one_setup_outreach_mailbox_receipt_missing");
  }
  return blockers;
}
