import { requestsOutreachOptOut } from "./outreachInbound.ts";
import { sha256Hex } from "./publicationArtifact.ts";

export const OUTREACH_IMAP_VERSION = 1;
export const OUTREACH_IMAP_LEASE_MS = 2 * 60 * 1000;
export const OUTREACH_IMAP_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const OUTREACH_IMAP_MAX_RESULTS = 25;
export const OUTREACH_IMAP_MAX_MESSAGE_BYTES = 256_000;
export const OUTREACH_IMAP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export type ImapCandidate = {
  messageId: string;
  toEmail: string;
  toDomain: string;
  sentAt: number;
  outboundMessageIdHash: string;
  controlledCanaryKind?: "imap_reply" | "imap_stop";
};

export type ImapEvidence = {
  uidValidity: string;
  uid: number;
  inboundMessageIdHash: string;
  referencedMessageIdHashes: string[];
  fromEmail: string;
  subject: string;
  bodyText: string;
  mimeTypes: string[];
  failedRecipients: string[];
  authenticationResults?: string;
  autoSubmitted?: string;
  receivedAt: number;
};

export type ImapMatch = {
  candidate: ImapCandidate;
  kind: "reply" | "unsubscribe" | "bounce";
};

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function emailDomain(value: string): string {
  return normalizedEmail(value).split("@")[1] ?? "";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function authenticatedSender(results: string | undefined, fromEmail: string): boolean {
  const value = String(results ?? "").slice(0, 8_000);
  const domain = emailDomain(fromEmail);
  if (!domain) return false;
  const escaped = escapeRegex(domain);
  return new RegExp(
    `\\bdmarc=pass\\b[\\s\\S]{0,800}\\bheader\\.from=${escaped}(?:\\s|;|$)`,
    "i",
  ).test(value) || new RegExp(
    `\\bdkim=pass\\b[\\s\\S]{0,800}\\bheader\\.(?:i|d)=(?:[^@;\\s]+@|@)?${escaped}(?:\\s|;|$)`,
    "i",
  ).test(value);
}

function automaticReply(evidence: ImapEvidence): boolean {
  const auto = String(evidence.autoSubmitted ?? "").trim().toLowerCase();
  return (auto !== "" && auto !== "no") ||
    /\b(?:automatic reply|auto(?:matic)?[- ]reply|out of office)\b/i.test(
      evidence.subject,
    );
}

export function classifyImapEvidence(args: {
  evidence: ImapEvidence;
  candidates: ImapCandidate[];
  mailboxEmail: string;
}): ImapMatch | null {
  const evidence = args.evidence;
  const referenceHashes = new Set(evidence.referencedMessageIdHashes);
  const candidate = args.candidates
    .filter((row) =>
      /^[a-f0-9]{64}$/.test(row.outboundMessageIdHash) &&
      referenceHashes.has(row.outboundMessageIdHash) &&
      evidence.receivedAt >= row.sentAt - 60_000
    )
    .sort((left, right) => right.sentAt - left.sentAt)[0];
  if (!candidate) return null;

  const fromEmail = normalizedEmail(evidence.fromEmail);
  const mailboxEmail = normalizedEmail(args.mailboxEmail);
  const controlledSelfSignal = Boolean(
    candidate.controlledCanaryKind &&
      fromEmail === mailboxEmail &&
      normalizedEmail(candidate.toEmail) === mailboxEmail,
  );
  const failedRecipients = new Set(
    evidence.failedRecipients.map(normalizedEmail).filter(Boolean),
  );
  const bounceSignal =
    failedRecipients.has(normalizedEmail(candidate.toEmail)) &&
    (
      evidence.mimeTypes.some((value) =>
        value.toLowerCase() === "message/delivery-status"
      ) ||
      /\b(?:mailer-daemon|postmaster)@/i.test(fromEmail) ||
      /\b(?:delivery status notification|undeliverable|delivery failed|mail delivery subsystem)\b/i.test(
        evidence.subject,
      )
    );
  if (bounceSignal) return { candidate, kind: "bounce" };

  if (!fromEmail || (fromEmail === mailboxEmail && !controlledSelfSignal)) {
    return null;
  }
  const exactRecipient = fromEmail === normalizedEmail(candidate.toEmail);
  const sameDomain = emailDomain(fromEmail) === normalizedEmail(candidate.toDomain);
  if (
    (!exactRecipient && !sameDomain) ||
    (candidate.controlledCanaryKind && !exactRecipient) ||
    automaticReply(evidence)
  ) return null;
  // The controlled signal is injected through the already-verified SMTP
  // account, is addressed back to that exact mailbox, and is bound to a
  // random outbound Message-ID. Gmail does not consistently add an
  // Authentication-Results header to self-delivered mail, so that header is
  // required for every real recipient but is not part of this internal-only
  // proof.
  if (
    !controlledSelfSignal &&
    !authenticatedSender(evidence.authenticationResults, fromEmail)
  ) return null;
  const optedOut = requestsOutreachOptOut(evidence.bodyText);
  if (
    (candidate.controlledCanaryKind === "imap_stop" && !optedOut) ||
    (candidate.controlledCanaryKind === "imap_reply" && optedOut)
  ) return null;
  return {
    candidate,
    kind: exactRecipient && optedOut
      ? "unsubscribe"
      : "reply",
  };
}

export function imapEventKey(args: {
  siteId: string;
  inboxId: string;
  uidValidity: string;
  uid: number;
}): string {
  return sha256Hex(JSON.stringify({ version: OUTREACH_IMAP_VERSION, ...args }));
}

export function imapEvidenceHash(args: {
  eventKey: string;
  messageId: string;
  kind: string;
  inboundMessageIdHash: string;
  fromEmailHash: string;
  receivedAt: number;
  subjectHash: string;
  bodyHash: string;
}): string {
  return sha256Hex(JSON.stringify({ version: OUTREACH_IMAP_VERSION, ...args }));
}
