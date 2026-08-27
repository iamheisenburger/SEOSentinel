import { getDomain } from "tldts";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_IDENTITY_SCOPES = new Set([
  "openid",
  "email",
  "https://www.googleapis.com/auth/userinfo.email",
]);

const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
]);

export function isConsumerGoogleMailbox(fromEmail: string): boolean {
  const senderDomain = normalizeMailDomain(fromEmail.split("@")[1] ?? "");
  return senderDomain === "gmail.com" || senderDomain === "googlemail.com";
}

export function hasGmailSendScope(scopes: string): boolean {
  return scopes.split(/\s+/).filter(Boolean).includes(GMAIL_SEND_SCOPE);
}

export function hasGmailReadScope(scopes: string): boolean {
  return scopes.split(/\s+/).filter(Boolean).includes(GMAIL_READONLY_SCOPE);
}

/** Reject incrementally coalesced GSC or broader Gmail permissions. Existing
 * readonly grants remain accepted during migration, but new authorization
 * requests ask only for gmail.send plus identity. */
export function hasOnlyGmailOutreachScopes(scopes: string): boolean {
  const granted = scopes.split(/\s+/).filter(Boolean);
  return (
    granted.includes(GMAIL_SEND_SCOPE) &&
    granted.every(
      (scope) =>
        scope === GMAIL_SEND_SCOPE ||
        scope === GMAIL_READONLY_SCOPE ||
        GOOGLE_IDENTITY_SCOPES.has(scope),
    )
  );
}

/** New and reconnect OAuth flows must never retain the restricted readonly
 * grant. Compatibility is limited to untouched legacy database rows. */
export function hasOnlyGmailOutboundScopes(scopes: string): boolean {
  const granted = scopes.split(/\s+/).filter(Boolean);
  return (
    granted.includes(GMAIL_SEND_SCOPE) &&
    granted.every(
      (scope) => scope === GMAIL_SEND_SCOPE || GOOGLE_IDENTITY_SCOPES.has(scope),
    )
  );
}

export function normalizeMailDomain(value: string): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return raw.replace(/^www\./, "").replace(/\.$/, "").split(/[/:]/)[0] ?? "";
  }
}

function registrableMailDomain(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: false }) ?? hostname;
}

export function gmailConnectionIssues(args: {
  siteDomain: string;
  fromEmail: string;
}): string[] {
  const issues: string[] = [];
  const email = args.fromEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(email)) {
    return ["Google did not return a valid business mailbox address."];
  }
  const senderDomain = normalizeMailDomain(email.split("@")[1] ?? "");
  const siteDomain = normalizeMailDomain(args.siteDomain);
  if (!senderDomain) {
    issues.push("The sender domain could not be verified.");
  }
  if (
    senderDomain &&
    siteDomain &&
    registrableMailDomain(senderDomain) === registrableMailDomain(siteDomain)
  ) {
    issues.push("Cold outreach cannot use the website's primary or transactional domain.");
  }
  return issues;
}

/** Prospect outreach stays fail-closed to a dedicated secondary domain, while
 * the OAuth connection itself may use consumer Gmail for a same-mailbox
 * self-test during onboarding and Google verification. */
export function secondaryGmailSenderIssues(args: {
  siteDomain: string;
  fromEmail: string;
}): string[] {
  const issues = gmailConnectionIssues(args);
  const senderDomain = normalizeMailDomain(args.fromEmail.split("@")[1] ?? "");
  if (senderDomain && CONSUMER_DOMAINS.has(senderDomain)) {
    issues.push("Use Google Workspace on a dedicated secondary domain, not a consumer Gmail mailbox.");
  }
  return issues;
}

export { GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE };
