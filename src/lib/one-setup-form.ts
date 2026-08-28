import { cadenceFitsOperationalLimit } from "../../convex/planLimits.ts";

export type OneSetupFormBlocker = {
  key: string;
  message: string;
};

export function postalAddressError(value: string): string | undefined {
  const address = value.trim();
  if (!address) {
    return "Enter the complete postal address used in outreach email footers.";
  }
  if (address.includes("@")) {
    return "Enter a postal address—not an email address.";
  }
  if (address.length < 15 || !/\d/.test(address)) {
    return "Enter the full street or PO Box, postcode, city, and country—not only the country.";
  }
  return undefined;
}

export type OneSetupFormReadinessInput = {
  capacityReady: boolean;
  domain: string;
  businessName: string;
  businessSummary: string;
  targetCountry: string;
  targetAudience: string;
  productUsage: string;
  cadence: number;
  fullAutopilot: boolean;
  autopublishConsentAccepted: boolean;
  senderName: string;
  postalAddress: string;
  confirmsSenderIdentityAndAddress: boolean;
  authorizesDeliveryEventCanary: boolean;
  confirmsSeparateAutomaticSendingConsent: boolean;
  managedOutreach: boolean;
  managedSenderDomain: string;
  confirmsDedicatedManagedSenderIdentity: boolean;
};

export function oneSetupFormBlockers(
  input: OneSetupFormReadinessInput,
): OneSetupFormBlocker[] {
  const blockers: OneSetupFormBlocker[] = [];
  if (!input.capacityReady) {
    blockers.push({
      key: "plan_capacity",
      message: "Wait while Pentra verifies this account's plan and monthly article allowance.",
    });
  }
  if (!input.domain.trim()) {
    blockers.push({ key: "domain", message: "Enter the website URL." });
  }
  if (input.businessName.trim().length < 2) {
    blockers.push({ key: "business_name", message: "Enter the business name." });
  }
  if (input.businessSummary.trim().length < 20) {
    blockers.push({
      key: "business_summary",
      message: "Describe the business in at least 20 characters.",
    });
  }
  if (input.targetCountry.trim().length < 2) {
    blockers.push({ key: "target_country", message: "Enter the target country or market." });
  }
  if (input.targetAudience.trim().length < 10) {
    blockers.push({
      key: "target_audience",
      message: "Describe the target audience in at least 10 characters.",
    });
  }
  if (input.productUsage.trim().length < 10) {
    blockers.push({
      key: "product_usage",
      message: "Explain how customers use the product in at least 10 characters.",
    });
  }
  if (!cadenceFitsOperationalLimit(input.cadence)) {
    blockers.push({
      key: "cadence",
      message: "Choose a target cadence from 1 to 21 articles per week.",
    });
  }
  if (input.fullAutopilot && !input.autopublishConsentAccepted) {
    blockers.push({
      key: "autopublish_consent",
      message: "Authorize automatic publishing, or choose Assisted review.",
    });
  }
  if (input.senderName.trim().length < 2) {
    blockers.push({ key: "sender_name", message: "Enter the outreach sender name." });
  }
  const addressError = postalAddressError(input.postalAddress);
  if (addressError) {
    blockers.push({ key: "postal_address", message: addressError });
  }
  if (!input.confirmsSenderIdentityAndAddress) {
    blockers.push({
      key: "sender_attestation",
      message: "Confirm that the outreach sender identity and postal address are accurate.",
    });
  }
  if (!input.authorizesDeliveryEventCanary) {
    blockers.push({
      key: "delivery_canary",
      message: "Authorize the controlled delivery-status canary.",
    });
  }
  if (!input.confirmsSeparateAutomaticSendingConsent) {
    blockers.push({
      key: "automatic_sending_consent",
      message: "Acknowledge that automatic outreach requires separate consent.",
    });
  }
  if (input.managedOutreach) {
    if (input.managedSenderDomain.trim().length < 4) {
      blockers.push({
        key: "managed_sender_domain",
        message: "Enter the dedicated managed sender domain.",
      });
    }
    if (!input.confirmsDedicatedManagedSenderIdentity) {
      blockers.push({
        key: "managed_sender_attestation",
        message: "Authorize the dedicated managed sender identity.",
      });
    }
  }
  return blockers;
}
