export const PUBLICATION_ADAPTER_VERSION = "verified-publisher-v1";
export const PUBLISHER_RENDERER_VERSION = "semantic-html-v1";

export type PublicationReceipt = {
  method: "github" | "wordpress" | "webhook";
  deliveryKey: string;
  contentHash: string;
  externalId: string;
  url: string;
  status: string;
  receivedAt: number;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} did not return a JSON object`);
  }
  return value as Record<string, unknown>;
}

function safeHttpsUrl(value: unknown, expectedHost?: string): string {
  if (typeof value !== "string") throw new Error("Publication receipt URL is missing");
  const url = new URL(value);
  const normalized = (host: string) => host.toLowerCase().replace(/^www\./, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (expectedHost && normalized(url.hostname) !== normalized(expectedHost))
  ) {
    throw new Error("Publication receipt URL is not an approved HTTPS destination");
  }
  url.hash = "";
  return url.href;
}

export function validatePublicationReceipt(receipt: PublicationReceipt): PublicationReceipt {
  if (!/^(?:pentra:)?[a-f0-9]{64}$/.test(receipt.deliveryKey)) {
    throw new Error("Publication receipt has an invalid delivery key");
  }
  if (!/^[a-f0-9]{64}$/.test(receipt.contentHash)) {
    throw new Error("Publication receipt has an invalid content hash");
  }
  if (!receipt.externalId || receipt.externalId.length > 500) {
    throw new Error("Publication receipt has an invalid external identifier");
  }
  if (!receipt.status || receipt.status.length > 100) {
    throw new Error("Publication receipt has an invalid status");
  }
  safeHttpsUrl(receipt.url);
  if (!Number.isFinite(receipt.receivedAt) || receipt.receivedAt <= 0) {
    throw new Error("Publication receipt has an invalid timestamp");
  }
  return receipt;
}

export function wordpressReceiptFromResponse(args: {
  response: unknown;
  expectedSlug: string;
  expectedHost: string;
  deliveryKey: string;
  contentHash: string;
  receivedAt: number;
}): PublicationReceipt {
  const post = record(args.response, "WordPress");
  if (!Number.isInteger(post.id) || Number(post.id) <= 0) {
    throw new Error("WordPress did not return a valid post id");
  }
  if (post.slug !== args.expectedSlug || post.status !== "publish") {
    throw new Error("WordPress did not confirm the exact published slug and status");
  }
  return validatePublicationReceipt({
    method: "wordpress",
    deliveryKey: args.deliveryKey,
    contentHash: args.contentHash,
    externalId: String(post.id),
    url: safeHttpsUrl(post.link, args.expectedHost),
    status: "published",
    receivedAt: args.receivedAt,
  });
}

export function webhookReceiptFromResponse(args: {
  response: unknown;
  expectedDeliveryKey: string;
  expectedContentHash: string;
  expectedSiteHost: string;
  receivedAt: number;
}): PublicationReceipt {
  const acknowledgement = record(args.response, "Webhook");
  if (
    acknowledgement.accepted !== true ||
    acknowledgement.deliveryKey !== args.expectedDeliveryKey ||
    acknowledgement.contentHash !== args.expectedContentHash
  ) {
    throw new Error("Webhook did not acknowledge the exact sealed delivery");
  }
  if (
    typeof acknowledgement.externalId !== "string" ||
    !acknowledgement.externalId.trim()
  ) {
    throw new Error("Webhook acknowledgement is missing an externalId");
  }
  return validatePublicationReceipt({
    method: "webhook",
    deliveryKey: args.expectedDeliveryKey,
    contentHash: args.expectedContentHash,
    externalId: acknowledgement.externalId.trim(),
    url: safeHttpsUrl(acknowledgement.url, args.expectedSiteHost),
    status: "accepted",
    receivedAt: args.receivedAt,
  });
}
