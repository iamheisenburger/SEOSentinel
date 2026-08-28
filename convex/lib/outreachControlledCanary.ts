import { sha256Hex } from "./publicationArtifact.ts";

export type ControlledSmtpImapCanaryKind =
  | "smtp_delivery"
  | "imap_reply"
  | "imap_bounce"
  | "imap_stop";

export function controlledSmtpImapCanaryOperationKey(input: {
  siteId: string;
  inboxId: string;
  configurationVersion: number;
  kind: ControlledSmtpImapCanaryKind;
}): string {
  if (
    !input.siteId || !input.inboxId ||
    !Number.isSafeInteger(input.configurationVersion) ||
    input.configurationVersion < 0
  ) throw new Error("Controlled canary binding is invalid");
  return sha256Hex(JSON.stringify({ version: 1, ...input }));
}

export function controlledSmtpImapCanaryTarget(input: {
  kind: ControlledSmtpImapCanaryKind;
  mailboxEmail: string;
  operationKey: string;
}): string {
  const mailboxEmail = input.mailboxEmail.trim().toLowerCase();
  if (
    !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,24}$/i.test(mailboxEmail) ||
    !/^[a-f0-9]{64}$/.test(input.operationKey)
  ) throw new Error("Controlled canary target binding is invalid");
  return input.kind === "imap_bounce"
    ? `pentra-canary-${input.operationKey.slice(0, 20)}@example.invalid`
    : mailboxEmail;
}

export function controlledCanaryMaySuppressDomain(
  controlledCanaryKind: string | undefined,
): boolean {
  return controlledCanaryKind === undefined;
}
