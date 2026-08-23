/**
 * Pure classification for messages observed in a tenant's dedicated outreach
 * mailbox. The Gmail transport lives in a Node action; this module deliberately
 * accepts only the bounded evidence needed to decide whether a message is a
 * reply, a hard bounce, or an explicit opt-out.
 */

export const OUTREACH_INBOUND_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const OUTREACH_INBOUND_OVERLAP_MS = 10 * 60 * 1000;
export const OUTREACH_INBOUND_LEASE_MS = 2 * 60 * 1000;
export const OUTREACH_INBOUND_MAX_RESULTS = 25;
export const OUTREACH_INBOUND_MAX_PAGES = 2;
export const OUTREACH_INBOUND_MAX_MESSAGE_BYTES = 1_000_000;
export const OUTREACH_INBOUND_TOTAL_DEADLINE_MS = 60_000;

export type OutreachInboundKind = "reply" | "unsubscribe" | "bounce";

export type OutreachInboundEvidence = {
  providerMessageId: string;
  providerThreadId: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  mimeTypes?: string[];
  failedRecipients?: string[];
  autoSubmitted?: string;
  receivedAt: number;
};

export type OutreachInboundCandidate = {
  messageId: string;
  providerMessageId?: string;
  providerThreadId?: string;
  toEmail: string;
  toDomain: string;
  sentAt: number;
};

export type OutreachInboundMatch = {
  candidate: OutreachInboundCandidate;
  kind: OutreachInboundKind;
};

const INBOUND_KIND_PRIORITY: Record<OutreachInboundKind, number> = {
  reply: 1,
  bounce: 2,
  unsubscribe: 3,
};

/**
 * A stronger safety outcome may replace a weaker one. Equal outcomes advance
 * only with newer evidence, which keeps Gmail's newest-first pagination from
 * letting an older page overwrite a later receipt.
 */
export function shouldPromoteOutreachInbound(args: {
  existingKind?: OutreachInboundKind;
  existingAt?: number;
  nextKind: OutreachInboundKind;
  nextAt: number;
}): boolean {
  if (!args.existingKind) return true;
  const existingPriority = INBOUND_KIND_PRIORITY[args.existingKind];
  const nextPriority = INBOUND_KIND_PRIORITY[args.nextKind];
  return (
    nextPriority > existingPriority ||
    (nextPriority === existingPriority && args.nextAt >= (args.existingAt ?? 0))
  );
}

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,24}/i;

export function normalizeOutreachEmail(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function emailAddressFromHeader(value: string | undefined): string {
  return normalizeOutreachEmail(String(value ?? "").match(EMAIL_PATTERN)?.[0]);
}

function emailDomain(value: string): string {
  return normalizeOutreachEmail(value).split("@")[1] ?? "";
}

function normalizedNewReplyText(value: string): string {
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .slice(0, 100_000);
  const cutMarkers = [
    /^On .{0,300}wrote:\s*$/im,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^From:\s+.{1,300}$/im,
  ];
  let end = text.length;
  for (const marker of cutMarkers) {
    const match = marker.exec(text);
    if (match?.index !== undefined) end = Math.min(end, match.index);
  }
  return text.slice(0, end).replace(/\s+/g, " ").trim();
}

/**
 * Require direct opt-out language in the newly written portion of the reply.
 * A bare STOP is accepted only when it is itself the response, preventing the
 * quoted footer in our own message from suppressing every ordinary reply.
 */
export function requestsOutreachOptOut(bodyText: string): boolean {
  const reply = normalizedNewReplyText(bodyText);
  if (!reply) return false;
  if (/^(stop|unsubscribe|opt[ -]?out|remove)([.!\s]|$)/i.test(reply)) {
    return true;
  }
  return /\b(?:please\s+)?(?:unsubscribe me|remove me|take me off|opt me out|stop (?:emailing|contacting|messaging) me|do not contact me|don['’]?t contact me|no more emails)\b/i.test(
    reply,
  );
}

function isAutomaticReply(evidence: OutreachInboundEvidence): boolean {
  const autoSubmitted = String(evidence.autoSubmitted ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  return /\b(?:automatic reply|auto(?:matic)?[- ]reply|out of office|away from the office)\b/i.test(
    evidence.subject,
  );
}

function bounceSender(fromEmail: string): boolean {
  const local = normalizeOutreachEmail(fromEmail).split("@")[0] ?? "";
  return /^(?:mailer-daemon|postmaster|mail-daemon|maildelivery-subsystem)$/.test(local);
}

function evidenceNamesRecipient(
  evidence: OutreachInboundEvidence,
  recipient: string,
): boolean {
  const normalized = normalizeOutreachEmail(recipient);
  if (!normalized) return false;
  if (
    (evidence.failedRecipients ?? [])
      .map(normalizeOutreachEmail)
      .includes(normalized)
  ) {
    return true;
  }
  return String(evidence.bodyText ?? "").toLowerCase().includes(normalized);
}

function isHardBounce(
  evidence: OutreachInboundEvidence,
  candidate: OutreachInboundCandidate,
): boolean {
  if (!bounceSender(evidence.fromEmail)) return false;
  if (!evidenceNamesRecipient(evidence, candidate.toEmail)) return false;
  const deliveryMime = (evidence.mimeTypes ?? []).some(
    (value) => value.toLowerCase() === "message/delivery-status",
  );
  const failedSubject = /\b(?:delivery status notification|delivery failure|undeliver(?:ed|able)|mail delivery failed|returned mail)\b/i.test(
    evidence.subject,
  );
  const hardFailureText = /\b(?:address not found|user unknown|no such user|mailbox (?:does not exist|unavailable)|recipient rejected|5\.[0-9]\.[0-9])\b/i.test(
    evidence.bodyText,
  );
  return (deliveryMime || failedSubject) && hardFailureText;
}

/**
 * Bind one provider message to exactly one sent Pentra message. Thread identity
 * is authoritative for replies; a bounce may arrive in a separate thread, so
 * it additionally requires a trusted daemon sender and the exact failed
 * recipient in the delivery-status evidence.
 */
export function classifyOutreachInbound(args: {
  evidence: OutreachInboundEvidence;
  candidates: OutreachInboundCandidate[];
  senderEmail: string;
}): OutreachInboundMatch | null {
  const evidence = {
    ...args.evidence,
    fromEmail: emailAddressFromHeader(args.evidence.fromEmail),
  };
  if (!evidence.fromEmail || evidence.fromEmail === normalizeOutreachEmail(args.senderEmail)) {
    return null;
  }

  const plausible = args.candidates
    .filter(
      (candidate) =>
        Number.isFinite(candidate.sentAt) &&
        evidence.receivedAt >= candidate.sentAt - 60_000,
    )
    .sort((a, b) => b.sentAt - a.sentAt);

  for (const candidate of plausible) {
    if (isHardBounce(evidence, candidate)) {
      return { candidate, kind: "bounce" };
    }
  }

  const threaded = plausible.find(
    (candidate) =>
      candidate.providerThreadId &&
      candidate.providerThreadId === evidence.providerThreadId,
  );
  if (!threaded) return null;

  const fromDomain = emailDomain(evidence.fromEmail);
  const expectedDomain = String(threaded.toDomain ?? "").trim().toLowerCase();
  const exactRecipient = evidence.fromEmail === normalizeOutreachEmail(threaded.toEmail);
  if (!exactRecipient && (!fromDomain || fromDomain !== expectedDomain)) return null;
  if (isAutomaticReply(evidence)) return null;

  return {
    candidate: threaded,
    kind: requestsOutreachOptOut(evidence.bodyText) ? "unsubscribe" : "reply",
  };
}

export function outreachInboundReceipt(args: {
  siteId: string;
  messageId: string;
  providerMessageId: string;
  providerThreadId: string;
  kind: OutreachInboundKind;
  fromEmail: string;
  receivedAt: number;
  subjectDigest: string;
  bodyDigest: string;
}): string {
  return JSON.stringify({
    version: 1,
    siteId: args.siteId,
    messageId: args.messageId,
    providerMessageId: args.providerMessageId,
    providerThreadId: args.providerThreadId,
    kind: args.kind,
    fromEmail: normalizeOutreachEmail(args.fromEmail),
    receivedAt: args.receivedAt,
    subjectDigest: args.subjectDigest,
    bodyDigest: args.bodyDigest,
  });
}
