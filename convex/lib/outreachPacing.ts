import { getDomain } from "tldts";

/**
 * Authority outreach pacing, warm-up and compliance.
 *
 * Link acquisition is the missing half of Pentra's outcome chain: a tenant can
 * publish perfect articles and still never rank because its domain carries no
 * authority. Outreach closes that gap, but it is also the part of the system
 * that touches real people from a real inbox, so every decision here fails
 * closed.
 *
 * Everything in this module is pure and deterministic so the send decision can
 * be tested exhaustively without a mailbox, and so an operator can always be
 * shown exactly why a message was or was not sent.
 */

/** Bump when the pacing contract changes so stored decisions stay auditable. */
export const OUTREACH_PACING_VERSION = 1;

/** A cold inbox that suddenly sends at full volume gets filtered. */
export const WARMUP_DAYS = 14;
export const WARMUP_INITIAL_DAILY_CAP = 5;
/** Matches the safe industry ceiling for genuine one-to-one outreach. */
export const DEFAULT_DAILY_SEND_CAP = 30;
/** Every send, including an explicitly approved one, is spaced out. */
export const OUTREACH_MIN_SEND_INTERVAL_MS = 30 * 60 * 1000;
/** Never contact the same domain more often than this, across all campaigns. */
export const DOMAIN_CONTACT_COOLDOWN_DAYS = 90;
/** Follow-up cadence in days after the initial send. */
export const FOLLOW_UP_SCHEDULE_DAYS = [4, 9];
export const MAX_SEQUENCE_STEP = FOLLOW_UP_SCHEDULE_DAYS.length;

const DAY_MS = 24 * 60 * 60 * 1000;

export type OutreachInboxState = {
  provider?: string;
  status: string;
  /** "approval" holds every draft for a human; "live" may send automatically. */
  mode?: string;
  dailySendCap?: number;
  warmupStartedAt?: number;
  sentToday?: number;
  sentTodayDay?: string;
  lastSentAt?: number;
};

export type OutreachSendDecision = {
  allowed: boolean;
  reason: string;
  /** The cap in force right now, after warm-up ramping. */
  effectiveDailyCap: number;
  version: number;
};

export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Daily cap during warm-up.
 *
 * Ramps linearly from a small initial volume to the tenant's configured cap
 * over WARMUP_DAYS. Without a recorded warm-up start the inbox is treated as
 * brand new, which is the safe assumption.
 */
export function warmupDailyCap(args: {
  warmupStartedAt?: number;
  now: number;
  targetCap?: number;
}): number {
  const target = Math.max(1, args.targetCap ?? DEFAULT_DAILY_SEND_CAP);
  const started = args.warmupStartedAt;
  if (!started || !Number.isFinite(started) || started <= 0) {
    return Math.min(WARMUP_INITIAL_DAILY_CAP, target);
  }
  const elapsedDays = Math.max(0, (args.now - started) / DAY_MS);
  if (elapsedDays >= WARMUP_DAYS) return target;
  const progress = elapsedDays / WARMUP_DAYS;
  const ramped = Math.floor(
    WARMUP_INITIAL_DAILY_CAP + (target - WARMUP_INITIAL_DAILY_CAP) * progress,
  );
  return Math.max(1, Math.min(target, ramped));
}

/**
 * Decide whether one more message may be sent from this inbox right now.
 *
 * Deliberately independent of message content: content safety is enforced
 * separately at draft time. This answers only the deliverability question.
 */
export function outreachSendDecision(args: {
  inbox: OutreachInboxState | null | undefined;
  now: number;
  /** Automatic requires live mode; approved is one explicit tenant release. */
  release?: "automatic" | "approved";
}): OutreachSendDecision {
  const version = OUTREACH_PACING_VERSION;
  const inbox = args.inbox;
  if (!inbox) {
    return {
      allowed: false,
      reason: "No outreach inbox is connected for this tenant.",
      effectiveDailyCap: 0,
      version,
    };
  }
  const effectiveDailyCap = warmupDailyCap({
    warmupStartedAt: inbox.warmupStartedAt,
    now: args.now,
    targetCap: inbox.dailySendCap,
  });

  if (inbox.provider !== "gmail") {
    return {
      allowed: false,
      reason: "Cold outreach requires a verified secondary-domain Gmail inbox.",
      effectiveDailyCap,
      version,
    };
  }

  if (!["warming", "active"].includes(inbox.status)) {
    return {
      allowed: false,
      reason: `Inbox status is "${inbox.status}"; sending requires a connected inbox.`,
      effectiveDailyCap,
      version,
    };
  }
  if ((args.release ?? "automatic") === "automatic" && (inbox.mode ?? "approval") !== "live") {
    return {
      allowed: false,
      reason:
        "Inbox is in approval mode; drafts must be released by the tenant before delivery.",
      effectiveDailyCap,
      version,
    };
  }
  // A counter from an earlier day must never authorise today's sends.
  const today = utcDayKey(args.now);
  const sentToday = inbox.sentTodayDay === today ? (inbox.sentToday ?? 0) : 0;
  if (sentToday >= effectiveDailyCap) {
    return {
      allowed: false,
      reason: `Daily send cap reached (${sentToday}/${effectiveDailyCap}).`,
      effectiveDailyCap,
      version,
    };
  }
  if (
    inbox.lastSentAt &&
    args.now - inbox.lastSentAt < OUTREACH_MIN_SEND_INTERVAL_MS
  ) {
    const waitMinutes = Math.max(
      1,
      Math.ceil((OUTREACH_MIN_SEND_INTERVAL_MS - (args.now - inbox.lastSentAt)) / 60_000),
    );
    return {
      allowed: false,
      reason: `Send spacing is active; the next message is eligible in ${waitMinutes} minute(s).`,
      effectiveDailyCap,
      version,
    };
  }
  return {
    allowed: true,
    reason: `Within pacing (${sentToday}/${effectiveDailyCap} sent today).`,
    effectiveDailyCap,
    version,
  };
}

const CONSUMER_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
]);

function registrableOutreachDomain(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: false }) ?? hostname;
}

export function outreachSenderReadinessIssues(args: {
  siteDomain: string;
  provider: string;
  fromEmail: string;
}): string[] {
  const issues: string[] = [];
  if (args.provider !== "gmail") {
    issues.push("Cold outreach supports secondary-domain Gmail only; transactional providers are not permitted.");
  }
  const senderDomain = normalizeDomain(args.fromEmail.split("@")[1] ?? "");
  const primaryDomain = normalizeDomain(args.siteDomain);
  if (!senderDomain) {
    issues.push("A valid sender domain is required.");
  } else {
    if (CONSUMER_MAIL_DOMAINS.has(senderDomain)) {
      issues.push("Use a business mailbox on a dedicated secondary domain, not a consumer mailbox.");
    }
    if (
      primaryDomain &&
      registrableOutreachDomain(senderDomain) ===
        registrableOutreachDomain(primaryDomain)
    ) {
      issues.push("Cold outreach cannot use the tenant's primary or transactional domain.");
    }
  }
  return issues;
}

export type ContactHistoryEntry = {
  domain: string;
  lastContactedAt: number;
};

/**
 * Prior-contact and suppression check.
 *
 * Contacting the same domain repeatedly is both ineffective and the fastest
 * route to spam complaints, so a single cooldown applies across every campaign
 * for the tenant.
 */
export function contactEligibility(args: {
  sourceDomain: string;
  now: number;
  history?: ContactHistoryEntry[];
  suppressedDomains?: string[];
  suppressedEmails?: string[];
  toEmail?: string;
}): { eligible: boolean; reason: string } {
  const domain = normalizeDomain(args.sourceDomain);
  if (!domain) {
    return { eligible: false, reason: "Opportunity has no resolvable domain." };
  }
  const suppressedDomains = (args.suppressedDomains ?? []).map(normalizeDomain);
  if (suppressedDomains.includes(domain)) {
    return {
      eligible: false,
      reason: `${domain} is suppressed (unsubscribe, bounce or complaint).`,
    };
  }
  const email = (args.toEmail ?? "").trim().toLowerCase();
  if (email && (args.suppressedEmails ?? []).some((e) => e.trim().toLowerCase() === email)) {
    return { eligible: false, reason: `${email} is suppressed.` };
  }
  const previous = (args.history ?? []).find(
    (entry) => normalizeDomain(entry.domain) === domain,
  );
  if (previous) {
    const days = (args.now - previous.lastContactedAt) / DAY_MS;
    if (days < DOMAIN_CONTACT_COOLDOWN_DAYS) {
      return {
        eligible: false,
        reason: `${domain} was contacted ${Math.floor(days)} day(s) ago; cooldown is ${DOMAIN_CONTACT_COOLDOWN_DAYS} days.`,
      };
    }
  }
  return { eligible: true, reason: "No prior contact or suppression." };
}

export function normalizeDomain(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

/**
 * When the next follow-up is due, or null when the sequence is complete.
 * A replied or suppressed thread must never schedule another message.
 */
export function nextFollowUpAt(args: {
  sequenceStep: number;
  lastSentAt: number;
  replied?: boolean;
}): number | null {
  if (args.replied) return null;
  const nextStep = args.sequenceStep + 1;
  if (nextStep > MAX_SEQUENCE_STEP) return null;
  const cumulativeDays = FOLLOW_UP_SCHEDULE_DAYS[nextStep - 1];
  const priorCumulativeDays = args.sequenceStep === 0
    ? 0
    : FOLLOW_UP_SCHEDULE_DAYS[args.sequenceStep - 1];
  const offsetDays = cumulativeDays - priorCumulativeDays;
  if (!Number.isFinite(offsetDays) || offsetDays <= 0) return null;
  return args.lastSentAt + offsetDays * DAY_MS;
}

/**
 * Compliance requirements for any outbound message. Returned as issues so the
 * caller can block a draft and show the tenant precisely what is missing.
 */
export function outreachComplianceIssues(args: {
  body: string;
  toEmail: string;
  fromEmail?: string;
  brandName: string;
  physicalMailingAddress?: string;
  unsubscribeUrl?: string;
}): string[] {
  const issues: string[] = [];
  const body = String(args.body || "");
  if (body.trim().length < 40) {
    issues.push("Message body is too short to be a genuine personalised email.");
  }
  if (!/@/.test(String(args.toEmail || ""))) {
    issues.push("Recipient address is not a valid email address.");
  }
  if (!args.fromEmail || !/@/.test(args.fromEmail)) {
    issues.push("A verified sender address is required.");
  }
  if (
    !args.physicalMailingAddress ||
    args.physicalMailingAddress.trim().length < 15 ||
    !body.includes(args.physicalMailingAddress.trim())
  ) {
    issues.push("A complete physical mailing address must appear in the message footer.");
  }
  if (!args.unsubscribeUrl && !/unsubscribe|opt out|reply .{0,20}stop/i.test(body)) {
    issues.push("Message must offer a clear way to opt out.");
  }
  const brandName = String(args.brandName || "").trim();
  if (
    !brandName ||
    !body.includes(`This is a commercial outreach message from ${brandName}.`)
  ) {
    issues.push("Message must identify itself as commercial outreach from the tenant brand.");
  }
  if (/\{\{|\}\}|\[FIRST_NAME\]|\[SITE\]/.test(body)) {
    issues.push("Message still contains unfilled template placeholders.");
  }
  return issues;
}
