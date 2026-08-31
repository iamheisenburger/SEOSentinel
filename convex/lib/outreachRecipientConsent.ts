export const GMAIL_RECIPIENT_CONSENT_POLICY_VERSION = 1;

export const GMAIL_RECIPIENT_CONSENT_SOURCES = [
  "web_form",
  "customer_request",
  "contract",
  "event_registration",
  "documented_relationship",
] as const;

export type GmailRecipientConsentSource =
  typeof GMAIL_RECIPIENT_CONSENT_SOURCES[number];

export type GmailRecipientConsentRecord = {
  recipientConsentStatus?: string;
  recipientConsentSource?: string;
  recipientConsentEvidenceHash?: string;
  recipientConsentPurpose?: string;
  recipientConsentRecordedAt?: number;
  recipientConsentExpiresAt?: number;
  recipientConsentRevokedAt?: number;
  recipientConsentPolicyVersion?: number;
};

/** Public discovery is evidence that an address exists, never evidence that
 * its owner opted in. Gmail OAuth delivery requires a separate, current,
 * recipient-level consent receipt. */
export function gmailRecipientConsentCurrent(
  record: GmailRecipientConsentRecord | null | undefined,
  now: number,
): boolean {
  return Boolean(
    record?.recipientConsentStatus === "verified" &&
      record.recipientConsentPurpose === "commercial_email" &&
      record.recipientConsentSource &&
      GMAIL_RECIPIENT_CONSENT_SOURCES.includes(
        record.recipientConsentSource as GmailRecipientConsentSource,
      ) &&
      record.recipientConsentEvidenceHash &&
      /^[a-f0-9]{64}$/.test(record.recipientConsentEvidenceHash) &&
      record.recipientConsentRecordedAt &&
      record.recipientConsentRecordedAt <= now &&
      !record.recipientConsentRevokedAt &&
      (!record.recipientConsentExpiresAt ||
        record.recipientConsentExpiresAt > now) &&
      record.recipientConsentPolicyVersion ===
        GMAIL_RECIPIENT_CONSENT_POLICY_VERSION,
  );
}

export function gmailRecipientConsentMatchesReceipt(
  record: GmailRecipientConsentRecord | null | undefined,
  receipt: GmailRecipientConsentRecord | null | undefined,
  now: number,
): boolean {
  return Boolean(
    gmailRecipientConsentCurrent(record, now) &&
      gmailRecipientConsentCurrent(receipt, now) &&
      record?.recipientConsentEvidenceHash ===
        receipt?.recipientConsentEvidenceHash &&
      record?.recipientConsentSource === receipt?.recipientConsentSource &&
      record?.recipientConsentRecordedAt ===
        receipt?.recipientConsentRecordedAt &&
      record?.recipientConsentExpiresAt ===
        receipt?.recipientConsentExpiresAt &&
      record?.recipientConsentPolicyVersion ===
        receipt?.recipientConsentPolicyVersion,
  );
}
