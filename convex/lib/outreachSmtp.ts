/**
 * SMTP sending identity for outreach.
 *
 * SMTP is a provider-independent fallback, not the primary path.
 *
 * `gmail.send` is a Google *sensitive* scope, not a restricted one. Google's
 * console lists it under sensitive scopes with no restricted scopes present,
 * so this project's verification does not automatically require a CASA
 * security assessment. An earlier version of this comment claimed otherwise
 * and was wrong. Gmail OAuth remains the primary customer path and Pentra's
 * verification is under review; until it completes, only approved accounts can
 * connect.
 *
 * SMTP still matters: it works with any provider, needs no OAuth verification
 * queue, and gives a tenant a customer-managed fallback. Smartlead is the
 * managed One-Setup default; SMTP never impersonates that managed path.
 *
 * Pure and deterministic so credential and pacing decisions are provable
 * without opening a socket.
 */

export const OUTREACH_SMTP_VERSION = 1;

/** Submission port. 465 is implicit TLS; 587 upgrades with STARTTLS. */
export const SMTP_IMPLICIT_TLS_PORT = 465;
export const SMTP_SUBMISSION_PORT = 587;

const ALLOWED_PORTS = new Set([SMTP_IMPLICIT_TLS_PORT, SMTP_SUBMISSION_PORT, 2525]);

export type SmtpCredentials = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  fromEmail?: string;
};

export type SmtpConfigIssue =
  | "host_missing"
  | "host_invalid"
  | "port_missing"
  | "port_unsupported"
  | "username_missing"
  | "password_missing"
  | "from_email_invalid"
  | "plaintext_port";

/**
 * Validate a tenant-supplied SMTP configuration.
 *
 * Returns issues rather than throwing so the UI can show every problem at
 * once instead of making the tenant discover them one failed save at a time.
 */
export function smtpConfigIssues(
  credentials: SmtpCredentials,
): SmtpConfigIssue[] {
  const issues: SmtpConfigIssue[] = [];
  const host = credentials.host?.trim().toLowerCase() ?? "";
  if (!host) {
    issues.push("host_missing");
  } else if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)
  ) {
    issues.push("host_invalid");
  }

  const port = credentials.port;
  if (typeof port !== "number" || !Number.isFinite(port)) {
    issues.push("port_missing");
  } else if (port === 25) {
    // Port 25 is relay, not submission: it is widely blocked and frequently
    // unauthenticated. Refusing it prevents a silently undeliverable inbox.
    issues.push("plaintext_port");
  } else if (!ALLOWED_PORTS.has(port)) {
    issues.push("port_unsupported");
  }

  if (!credentials.username?.trim()) issues.push("username_missing");
  if (!credentials.password?.trim()) issues.push("password_missing");
  if (
    !credentials.fromEmail ||
    !/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(credentials.fromEmail.trim())
  ) {
    issues.push("from_email_invalid");
  }
  return issues;
}

/** Operator-facing text for each issue. Never echoes the credential itself. */
export function describeSmtpIssue(issue: SmtpConfigIssue): string {
  switch (issue) {
    case "host_missing":
      return "Enter your provider's SMTP server, for example smtp.gmail.com.";
    case "host_invalid":
      return "That SMTP server name is not a valid hostname.";
    case "port_missing":
      return "Enter the SMTP port, usually 587.";
    case "plaintext_port":
      return "Port 25 is for server relay and is blocked by most networks. Use 587 or 465.";
    case "port_unsupported":
      return "Use port 587 (STARTTLS) or 465 (TLS).";
    case "username_missing":
      return "Enter the SMTP username, usually the full email address.";
    case "password_missing":
      return "Enter an app password. Your normal account password will not work where two-factor authentication is enabled.";
    case "from_email_invalid":
      return "Enter the address outreach should be sent from.";
  }
}

/**
 * Transport options for the configured credentials.
 *
 * TLS is never optional: outreach carries a tenant's mailbox password, and an
 * unencrypted submission would expose it on every send.
 */
export function smtpTransportOptions(credentials: SmtpCredentials): {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  requireTLS: boolean;
} {
  const issues = smtpConfigIssues(credentials);
  if (issues.length > 0) {
    throw new Error(`SMTP configuration is incomplete: ${issues.join(", ")}`);
  }
  const port = credentials.port as number;
  return {
    host: credentials.host!.trim().toLowerCase(),
    port,
    secure: port === SMTP_IMPLICIT_TLS_PORT,
    auth: { user: credentials.username!.trim(), pass: credentials.password! },
    // On 587 the connection starts plaintext and must be upgraded; without
    // this a server that silently declines STARTTLS would send credentials in
    // the clear.
    requireTLS: port !== SMTP_IMPLICIT_TLS_PORT,
  };
}

/**
 * Known submission endpoints, so a tenant can pick their provider instead of
 * hunting for host and port in a help centre.
 */
export const SMTP_PRESETS: Array<{
  id: string;
  label: string;
  host: string;
  port: number;
  appPasswordUrl?: string;
  note: string;
}> = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: SMTP_SUBMISSION_PORT,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    note: "Requires 2-Step Verification, then an app password.",
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    host: "smtp-mail.outlook.com",
    port: SMTP_SUBMISSION_PORT,
    note: "Use an app password if security defaults are enabled.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    host: "smtp.zoho.com",
    port: SMTP_SUBMISSION_PORT,
    appPasswordUrl: "https://accounts.zoho.com/home#security/apppasswords",
    note: "Generate an application-specific password.",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    host: "smtp.fastmail.com",
    port: SMTP_IMPLICIT_TLS_PORT,
    note: "Create an app password scoped to SMTP.",
  },
];

/**
 * Classify an SMTP failure so the tenant is told what to change.
 *
 * Provider text is inspected but never persisted or shown verbatim: it can
 * contain the account address and internal host detail.
 */
export function classifySmtpFailure(message: string): {
  reason:
    | "authentication_failed"
    | "connection_failed"
    | "tls_failed"
    | "recipient_rejected"
    | "rate_limited"
    | "unknown";
  operatorMessage: string;
  retryable: boolean;
} {
  const text = String(message || "").toLowerCase();
  if (/invalid login|authentication|auth failed|535|534|username and password/.test(text)) {
    return {
      reason: "authentication_failed",
      operatorMessage:
        "The mailbox rejected these credentials. Use an app password, not the account password.",
      retryable: false,
    };
  }
  if (/starttls|tls|certificate|ssl/.test(text)) {
    return {
      reason: "tls_failed",
      operatorMessage: "The server refused an encrypted connection. Try port 465.",
      retryable: false,
    };
  }
  if (/econnrefused|enotfound|etimedout|connection|socket|dns/.test(text)) {
    return {
      reason: "connection_failed",
      operatorMessage: "Could not reach that SMTP server. Check the host and port.",
      retryable: true,
    };
  }
  if (/rate|too many|quota|4\.7\.0|throttl/.test(text)) {
    return {
      reason: "rate_limited",
      operatorMessage:
        "The mailbox is rate limiting sending. Pentra will retry within the warm-up allowance.",
      retryable: true,
    };
  }
  if (/550|recipient|mailbox unavailable|does not exist/.test(text)) {
    return {
      reason: "recipient_rejected",
      operatorMessage: "The recipient address was rejected and has been suppressed.",
      retryable: false,
    };
  }
  return {
    reason: "unknown",
    operatorMessage: "The mailbox refused this send.",
    retryable: false,
  };
}
