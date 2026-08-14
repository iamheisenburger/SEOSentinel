import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertSafePublishableMarkdown,
  renderSafePublicationHtml,
} from "../convex/lib/safeMarkdownHtml.ts";
import {
  webhookReceiptFromResponse,
  wordpressReceiptFromResponse,
} from "../convex/lib/publicationReceipts.ts";
import { safeRequestPublicHttps } from "../convex/lib/safeOutbound.ts";

const contentHash = "a".repeat(64);
const deliveryKey = `pentra:${"b".repeat(64)}`;

test("publication renderer emits semantic allowlisted HTML without inline injection", () => {
  const html = renderSafePublicationHtml(
    "## Safe heading\n\n[Read more](https://example.com/docs)\n\n![Diagram](https://example.com/image.png)",
  );
  assert.match(html, /<h2>Safe heading<\/h2>/);
  assert.match(html, /rel="nofollow noopener noreferrer"/);
  assert.match(html, /<img src="https:\/\/example\.com\/image\.png" alt="Diagram">/);
  assert.doesNotMatch(html, /style=|onerror=|<script/i);
});

test("publication renderer rejects raw HTML, executable MDX, and unsafe URL schemes", () => {
  assert.throws(
    () => renderSafePublicationHtml('<img src="x" onerror="alert(1)">'),
    /Raw HTML and executable MDX/,
  );
  assert.throws(
    () => assertSafePublishableMarkdown("[click](javascript:alert(1))"),
    /relative paths or absolute HTTPS URLs/,
  );
  assert.throws(
    () => assertSafePublishableMarkdown("![pixel](http://example.com/pixel.gif)"),
    /absolute HTTPS URLs/,
  );
});

test("WordPress receipt must confirm the exact slug, status, host, and post id", () => {
  const receipt = wordpressReceiptFromResponse({
    response: {
      id: 42,
      slug: "safe-post",
      status: "publish",
      link: "https://example.com/blog/safe-post",
    },
    expectedSlug: "safe-post",
    expectedHost: "example.com",
    deliveryKey,
    contentHash,
    receivedAt: Date.now(),
  });
  assert.equal(receipt.externalId, "42");
  assert.throws(
    () => wordpressReceiptFromResponse({
      response: { id: 42, slug: "other", status: "draft", link: "https://evil.example/post" },
      expectedSlug: "safe-post",
      expectedHost: "example.com",
      deliveryKey,
      contentHash,
      receivedAt: Date.now(),
    }),
    /exact published slug and status/,
  );
});

test("webhook receipt cannot acknowledge a different or unverifiable delivery", () => {
  const receipt = webhookReceiptFromResponse({
    response: {
      accepted: true,
      deliveryKey,
      contentHash,
      externalId: "cms-123",
      url: "https://example.com/blog/safe-post",
    },
    expectedDeliveryKey: deliveryKey,
    expectedContentHash: contentHash,
    expectedSiteHost: "example.com",
    receivedAt: Date.now(),
  });
  assert.equal(receipt.status, "accepted");
  assert.throws(
    () => webhookReceiptFromResponse({
      response: {
        accepted: true,
        deliveryKey: `pentra:${"c".repeat(64)}`,
        contentHash,
        externalId: "cms-123",
        url: "https://example.com/blog/safe-post",
      },
      expectedDeliveryKey: deliveryKey,
      expectedContentHash: contentHash,
      expectedSiteHost: "example.com",
      receivedAt: Date.now(),
    }),
    /exact sealed delivery/,
  );
});

test("publisher egress is bounded before a socket can be opened", async () => {
  await assert.rejects(
    safeRequestPublicHttps("https://example.com/publish", {
      method: "POST",
      body: "x".repeat(65),
      maxRequestBytes: 64,
    }),
    /request body is too large/,
  );
});

test("WordPress and webhook adapters only use the pinned outbound transport", () => {
  const publisher = readFileSync("convex/publisher.ts", "utf8");
  const wordpress = publisher.slice(
    publisher.indexOf("async function publishToWordPress"),
    publisher.indexOf("// ── Webhook Adapter"),
  );
  const webhook = publisher.slice(
    publisher.indexOf("async function publishToWebhook"),
    publisher.indexOf("// ── Main Publisher"),
  );
  assert.doesNotMatch(wordpress, /await fetch\(/);
  assert.doesNotMatch(webhook, /await fetch\(/);
  assert.match(wordpress, /safeRequestPublicHttps/);
  assert.match(webhook, /X-Pentra-Signature-256/);
  assert.match(webhook, /webhookReceiptFromResponse/);
});
