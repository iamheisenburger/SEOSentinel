import { sha256Hex } from "./publicationArtifact.ts";

export const OUTREACH_CREDENTIAL_ENCRYPTION_VERSION = 1;

type CredentialSecrets = {
  smtpPassword: string;
  imapPassword: string;
};

type CredentialKeyConfig = {
  keyId: string;
  keyBase64: string;
};

export type EncryptedOutreachCredentials = {
  credentialCiphertext: string;
  credentialKeyId: string;
  credentialEncryptionVersion: number;
  credentialBindingHash: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("Mailbox credential encryption key is invalid");
  }
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function validKeyId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value);
}

async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(keyBase64);
  if (bytes.byteLength !== 32) {
    throw new Error("Mailbox credential encryption key must be 32 bytes");
  }
  return crypto.subtle.importKey(
    "raw",
    bytes.buffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export function outreachCredentialKeyConfig(
  env: Record<string, string | undefined>,
  requestedKeyId?: string,
): CredentialKeyConfig {
  const currentKeyId =
    env.OUTREACH_CREDENTIAL_ENCRYPTION_KEY_ID?.trim() ?? "";
  const requested = requestedKeyId?.trim() || currentKeyId;
  let keyBase64 = "";
  if (requested === currentKeyId) {
    keyBase64 =
      env.OUTREACH_CREDENTIAL_ENCRYPTION_KEY_V1?.trim() ?? "";
  } else {
    // During rotation production retains only old encryption keys in this
    // encrypted environment value. New writes always use the separate current
    // key above; the ring is read only when decrypting an older envelope.
    try {
      const ring = JSON.parse(
        env.OUTREACH_CREDENTIAL_ENCRYPTION_KEYRING_V1 ?? "{}",
      ) as Record<string, unknown>;
      keyBase64 = typeof ring[requested] === "string"
        ? ring[requested].trim()
        : "";
    } catch {
      throw new Error("Mailbox credential encryption keyring is invalid");
    }
  }
  const keyId = requested;
  if (!validKeyId(keyId) || !keyBase64) {
    throw new Error("Mailbox credential encryption is not configured");
  }
  return { keyId, keyBase64 };
}

export async function encryptOutreachCredentials(args: {
  secrets: CredentialSecrets;
  binding: string;
  key: CredentialKeyConfig;
}): Promise<EncryptedOutreachCredentials> {
  if (
    !args.secrets.smtpPassword.trim() ||
    !args.secrets.imapPassword.trim() ||
    !args.binding
  ) throw new Error("Mailbox credentials and binding are required");
  if (!validKeyId(args.key.keyId)) throw new Error("Credential key id is invalid");
  const key = await importAesKey(args.key.keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(args.secrets));
  const additionalData = new TextEncoder().encode(args.binding);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData, tagLength: 128 },
    key,
    plaintext,
  );
  return {
    credentialCiphertext: `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`,
    credentialKeyId: args.key.keyId,
    credentialEncryptionVersion: OUTREACH_CREDENTIAL_ENCRYPTION_VERSION,
    credentialBindingHash: sha256Hex(args.binding),
  };
}

export async function decryptOutreachCredentials(args: {
  encrypted: EncryptedOutreachCredentials;
  binding: string;
  key: CredentialKeyConfig;
}): Promise<CredentialSecrets> {
  if (
    args.encrypted.credentialEncryptionVersion !==
      OUTREACH_CREDENTIAL_ENCRYPTION_VERSION ||
    args.encrypted.credentialKeyId !== args.key.keyId ||
    args.encrypted.credentialBindingHash !== sha256Hex(args.binding)
  ) throw new Error("Mailbox credential binding is not current");
  const [ivText, ciphertextText, extra] =
    args.encrypted.credentialCiphertext.split(".");
  if (!ivText || !ciphertextText || extra !== undefined) {
    throw new Error("Mailbox credential envelope is invalid");
  }
  const iv = base64ToBytes(ivText);
  if (iv.byteLength !== 12) throw new Error("Mailbox credential envelope is invalid");
  const key = await importAesKey(args.key.keyBase64);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(args.binding),
        tagLength: 128,
      },
      key,
      base64ToBytes(ciphertextText).buffer,
    );
  } catch {
    throw new Error("Mailbox credentials could not be decrypted");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Mailbox credential payload is invalid");
  }
  if (
    !parsed || typeof parsed !== "object" ||
    typeof (parsed as CredentialSecrets).smtpPassword !== "string" ||
    typeof (parsed as CredentialSecrets).imapPassword !== "string" ||
    !(parsed as CredentialSecrets).smtpPassword ||
    !(parsed as CredentialSecrets).imapPassword
  ) throw new Error("Mailbox credential payload is invalid");
  return parsed as CredentialSecrets;
}

export function outreachCredentialBinding(args: {
  siteId: string;
  configurationVersion: number;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
}): string {
  return JSON.stringify({
    version: OUTREACH_CREDENTIAL_ENCRYPTION_VERSION,
    siteId: args.siteId,
    configurationVersion: args.configurationVersion,
    fromEmail: args.fromEmail.trim().toLowerCase(),
    smtpHost: args.smtpHost.trim().toLowerCase(),
    smtpPort: args.smtpPort,
    smtpUsername: args.smtpUsername.trim(),
    imapHost: args.imapHost.trim().toLowerCase(),
    imapPort: args.imapPort,
    imapUsername: args.imapUsername.trim(),
  });
}
