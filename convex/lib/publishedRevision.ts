import { clampMetaDescription, evaluatePublicationQuality } from "./articleQuality.ts";
import {
  appendRelatedInternalLinks,
  publishedArticleInternalHref,
  selectRelatedInternalLinks,
  validateInternalLinkSuggestions,
  type RelatedInternalDestination,
} from "./internalLinks.ts";
import {
  classifyPentraMarkdownDestination,
  publicationArtifactHash,
  sha256Hex,
  type PublicationArtifact,
} from "./publicationArtifact.ts";
import {
  type PublicationReceipt,
  validatePublicationReceipt,
} from "./publicationReceipts.ts";
import { assertSafePublishableMarkdown } from "./safeMarkdownHtml.ts";
import {
  canonicalPublicationUrl,
  verifyLivePublicationPage,
} from "./publicationLive.ts";

export const PUBLISHED_REVISION_VERSION = 1;
export const PUBLISHED_REVISION_LEASE_MS = 15 * 60 * 1000;
export const MAX_PUBLISHED_REVISION_RECONCILIATION_ATTEMPTS = 4;
export const MAX_PUBLISHED_REVISIONS_PER_TENANT_24H = 1;
export const MAX_PUBLISHED_REVISION_CANDIDATES_PER_SCAN = 5;

export type PublishedRevisionPreparation<RevisionId> = {
  status: "prepared" | "existing" | "no_safe_candidate" | "bounded_wait";
  detail: string;
  revisionId?: RevisionId;
  repair?: "legacy_github_receipt_adoption";
};

export const PUBLISHED_REVISION_PREPARATION_FAILED_DETAIL =
  "Revision preparation failed closed before any external write because the article lacks a current immutable publication receipt or destination seal.";

export const LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION = 4;

export function legacyGitHubReceiptAdoptionKey(args: {
  siteId: string;
  articleId: string;
  artifactHash: string;
  deliveryHash: string;
  publicationConfigHash: string;
}): string {
  return sha256Hex(JSON.stringify({ version: 1, ...args }));
}

/**
 * Pure, deterministic proof for the read-only legacy GitHub adoption path.
 * Exact renderer bytes, the embedded delivery key, immutable branch head, and
 * regular-file SHA must all agree before a receipt may be persisted.
 */
export function verifyLegacyGitHubReceiptAdoptionProof(args: {
  expectedContent: string;
  observedContent: string;
  deliveryKey: string;
  branchHeadBefore: string;
  branchHeadAfter: string;
  fileSha: string;
}): { externalContentHash: string } {
  if (
    !/^[a-f0-9]{40,64}$/i.test(args.branchHeadBefore) ||
    !/^[a-f0-9]{40,64}$/i.test(args.branchHeadAfter) ||
    args.branchHeadBefore !== args.branchHeadAfter
  ) {
    throw new Error("GitHub branch changed during legacy publication proof");
  }
  if (!/^[a-f0-9]{40,64}$/i.test(args.fileSha)) {
    throw new Error("GitHub legacy publication proof has an invalid file SHA");
  }
  const disposition = classifyPentraMarkdownDestination({
    existingContent: args.observedContent,
    nextContent: args.expectedContent,
    deliveryKey: args.deliveryKey,
  });
  if (disposition !== "idempotent") {
    throw new Error("Legacy GitHub publication is not the exact immutable Pentra artifact");
  }
  return { externalContentHash: sha256Hex(args.observedContent) };
}

/**
 * Walk a small deterministic candidate window. Receiptless legacy pages and
 * other fail-closed candidates are recorded and skipped; bounded tenant state
 * stops the walk, and at most one externally executable candidate is returned.
 */
export async function selectPreparedPublishedRevision<Request, RevisionId>(args: {
  requests: readonly Request[];
  prepare: (
    request: Request,
  ) => Promise<PublishedRevisionPreparation<RevisionId>>;
  onSkipped: (
    request: Request,
    outcome: PublishedRevisionPreparation<RevisionId>,
  ) => Promise<void>;
}): Promise<{
  selected?: {
    request: Request;
    prepared: PublishedRevisionPreparation<RevisionId> & { revisionId: RevisionId };
  };
  lastSkipped?: PublishedRevisionPreparation<RevisionId>;
}> {
  let lastSkipped: PublishedRevisionPreparation<RevisionId> | undefined;
  for (const request of args.requests.slice(
    0,
    MAX_PUBLISHED_REVISION_CANDIDATES_PER_SCAN,
  )) {
    let outcome: PublishedRevisionPreparation<RevisionId>;
    try {
      outcome = await args.prepare(request);
    } catch {
      outcome = {
        status: "no_safe_candidate",
        detail: PUBLISHED_REVISION_PREPARATION_FAILED_DETAIL,
      };
    }
    if (
      outcome.revisionId !== undefined &&
      (outcome.status === "prepared" || outcome.status === "existing")
    ) {
      return {
        selected: {
          request,
          prepared: { ...outcome, revisionId: outcome.revisionId },
        },
        lastSkipped,
      };
    }
    await args.onSkipped(request, outcome);
    lastSkipped = outcome;
    if (outcome.status === "bounded_wait") break;
  }
  return { lastSkipped };
}

export type PublishedRevisionKind =
  | "improve_snippet"
  | "strengthen_cluster"
  | "rollback";

export type PublishedRevisionArtifact = PublicationArtifact & {
  title: string;
  slug: string;
  markdown: string;
  metaKeywords?: string[];
};

export type PublishedRevisionReceipt = PublicationReceipt & {
  revisionKey: string;
  baseContentHash: string;
  baseExternalId: string;
};

export type RevisionLeaseState = {
  status: string;
  leaseOwner?: string;
  leaseStartedAt?: number;
  attempts?: number;
};

function normalizedWords(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function containsPhrase(value: string | undefined, phrase: string): boolean {
  return normalizedWords(value ?? "")
    .toLocaleLowerCase("en-US")
    .includes(normalizedWords(phrase).toLocaleLowerCase("en-US"));
}

function safeMeasuredKeyword(value: string | undefined): string | null {
  const keyword = normalizedWords(value ?? "");
  const words = keyword.split(" ").filter(Boolean);
  if (
    keyword.length < 8 ||
    keyword.length > 60 ||
    words.length < 2 ||
    words.length > 8 ||
    /[\n\r<>\[\]{}]/.test(keyword)
  ) {
    return null;
  }
  return keyword;
}

/**
 * A low-CTR revision may only rearrange exact measured/customer-authored text.
 * It never invents a benefit, number, year, urgency claim, or call to action.
 */
export function deterministicSnippetRevision(args: {
  artifact: PublishedRevisionArtifact;
  measuredKeyword?: string;
}): PublishedRevisionArtifact | null {
  const keyword = safeMeasuredKeyword(args.measuredKeyword);
  if (!keyword) return null;

  const currentTitle = normalizedWords(args.artifact.metaTitle ?? args.artifact.title);
  const currentDescription = normalizedWords(args.artifact.metaDescription ?? "");
  if (!currentDescription) return null;

  let metaTitle = currentTitle;
  if (!containsPhrase(currentTitle, keyword)) {
    const candidate = `${keyword}: ${currentTitle}`;
    if (candidate.length <= 65) metaTitle = candidate;
  }

  let metaDescription = clampMetaDescription(currentDescription, 155) ?? currentDescription;
  if (!containsPhrase(metaDescription, keyword)) {
    const candidate = `${keyword}: ${metaDescription}`;
    const clamped = clampMetaDescription(candidate, 155);
    if (clamped && clamped.length >= 100 && containsPhrase(clamped, keyword)) {
      metaDescription = clamped;
    }
  }

  if (
    metaTitle === (args.artifact.metaTitle ?? args.artifact.title) &&
    metaDescription === args.artifact.metaDescription
  ) {
    return null;
  }

  const next = { ...args.artifact, metaTitle, metaDescription };
  return validateDeterministicRevision({
    base: args.artifact,
    next,
    kind: "improve_snippet",
  });
}

/** Add one exact, already-live, same-tenant related destination. */
export function deterministicInternalLinkRevision(args: {
  artifact: PublishedRevisionArtifact;
  urlStructure?: string;
  liveDestinations: RelatedInternalDestination[];
}): PublishedRevisionArtifact | null {
  const selfHref = publishedArticleInternalHref(
    args.urlStructure,
    args.artifact.slug,
  );
  const selected = selectRelatedInternalLinks({
    currentTitle: args.artifact.title,
    currentKeywords: args.artifact.metaKeywords,
    destinations: args.liveDestinations,
    limit: 1,
  });
  const links = validateInternalLinkSuggestions(
    selected,
    args.liveDestinations.map((destination) => destination.href),
    selfHref,
  );
  if (links.length !== 1) return null;

  const appended = appendRelatedInternalLinks(args.artifact.markdown, links);
  if (appended.inserted.length !== 1 || appended.markdown === args.artifact.markdown) {
    return null;
  }
  const next = {
    ...args.artifact,
    markdown: appended.markdown,
    internalLinks: [
      ...(args.artifact.internalLinks ?? []),
      ...appended.inserted,
    ],
  };
  return validateDeterministicRevision({
    base: args.artifact,
    next,
    kind: "strengthen_cluster",
    allowedNewHrefs: args.liveDestinations.map((destination) => destination.href),
  });
}

export function validateDeterministicRevision(args: {
  base: PublishedRevisionArtifact;
  next: PublishedRevisionArtifact;
  kind: PublishedRevisionKind;
  allowedNewHrefs?: string[];
}): PublishedRevisionArtifact {
  if (
    args.base.title !== args.next.title ||
    args.base.slug !== args.next.slug ||
    args.base.publicationConfigHash !== args.next.publicationConfigHash
  ) {
    throw new Error("Published revision cannot change title, slug, canonical destination, or sealed publisher");
  }
  assertSafePublishableMarkdown(args.next.markdown);

  if (args.kind === "improve_snippet") {
    if (
      args.base.markdown !== args.next.markdown ||
      JSON.stringify(args.base.internalLinks ?? []) !==
        JSON.stringify(args.next.internalLinks ?? [])
    ) {
      throw new Error("Snippet revision cannot change article prose or links");
    }
  }
  if (args.kind === "strengthen_cluster") {
    if (
      args.base.metaTitle !== args.next.metaTitle ||
      args.base.metaDescription !== args.next.metaDescription
    ) {
      throw new Error("Internal-link revision cannot change search metadata");
    }
    const oldHrefs = new Set((args.base.internalLinks ?? []).map((link) => link.href));
    const additions = (args.next.internalLinks ?? []).filter(
      (link) => !oldHrefs.has(link.href),
    );
    const allowed = new Set(args.allowedNewHrefs ?? []);
    if (additions.length !== 1 || !allowed.has(additions[0].href)) {
      throw new Error("Internal-link revision requires one exact allowlisted live destination");
    }
  }

  const quality = evaluatePublicationQuality(args.next, "strict");
  if (!quality.passed) {
    throw new Error(`Published revision failed strict quality: ${quality.issues.join(" ")}`);
  }
  if (publicationArtifactHash(args.base) === publicationArtifactHash(args.next)) {
    throw new Error("Published revision does not change the sealed artifact");
  }
  return args.next;
}

export function publishedRevisionKey(args: {
  siteId: string;
  articleId: string;
  actionFingerprint: string;
  kind: PublishedRevisionKind;
  baseArtifactHash: string;
  nextArtifactHash: string;
  baseReceipt: PublicationReceipt;
}): string {
  validatePublicationReceipt(args.baseReceipt);
  return sha256Hex(JSON.stringify({
    version: PUBLISHED_REVISION_VERSION,
    siteId: args.siteId,
    articleId: args.articleId,
    actionFingerprint: args.actionFingerprint,
    kind: args.kind,
    baseArtifactHash: args.baseArtifactHash,
    nextArtifactHash: args.nextArtifactHash,
    baseDeliveryKey: args.baseReceipt.deliveryKey,
    baseExternalId: args.baseReceipt.externalId,
  }));
}

export function publishedRevisionDeliveryKey(revisionKey: string): string {
  if (!/^[a-f0-9]{64}$/.test(revisionKey)) {
    throw new Error("Invalid published revision key");
  }
  return `pentra:${revisionKey}`;
}

/** CAS decision shared by GitHub and testable fake destination adapters. */
export function classifyPublishedRevisionDestination(args: {
  observedContent: string | undefined;
  expectedBaseContent: string;
  expectedNextContent: string;
}): "apply" | "idempotent" {
  if (args.observedContent === args.expectedNextContent) return "idempotent";
  if (args.observedContent === args.expectedBaseContent) return "apply";
  throw new Error("External destination drifted from the exact revision base");
}

export function acquirePublishedRevisionLease(
  state: RevisionLeaseState,
  args: { leaseOwner: string; now: number },
): { idempotent: boolean; patch?: {
  status: "leased";
  leaseOwner: string;
  leaseStartedAt: number;
  attempts: number;
} } {
  if (state.status === "verified" || state.status === "rolled_back") {
    return { idempotent: true };
  }
  if (state.status === "verification_pending") {
    throw new Error("Published revision is waiting for exact live verification");
  }
  if (!["prepared", "unverified"].includes(state.status)) {
    const active =
      !!state.leaseOwner &&
      !!state.leaseStartedAt &&
      args.now - state.leaseStartedAt < PUBLISHED_REVISION_LEASE_MS;
    if (active) throw new Error("Published revision is already in progress");
    if (!["leased", "attempted"].includes(state.status)) {
      throw new Error("Published revision is not executable");
    }
  }
  return {
    idempotent: false,
    patch: {
      status: "leased",
      leaseOwner: args.leaseOwner,
      leaseStartedAt: args.now,
      attempts: Math.max(0, state.attempts ?? 0) + 1,
    },
  };
}

export function validatePublishedRevisionReceipt(args: {
  receipt: PublishedRevisionReceipt;
  method: PublicationReceipt["method"];
  revisionKey: string;
  baseArtifactHash: string;
  nextArtifactHash: string;
  baseExternalId: string;
}): PublishedRevisionReceipt {
  const receipt = validatePublicationReceipt(args.receipt) as PublishedRevisionReceipt;
  if (
    receipt.method !== args.method ||
    receipt.revisionKey !== args.revisionKey ||
    receipt.deliveryKey !== publishedRevisionDeliveryKey(args.revisionKey) ||
    receipt.baseContentHash !== args.baseArtifactHash ||
    receipt.contentHash !== args.nextArtifactHash ||
    receipt.baseExternalId !== args.baseExternalId
  ) {
    throw new Error("Published revision receipt does not prove the exact external CAS");
  }
  return receipt;
}

export function webhookRevisionReceiptFromResponse(args: {
  response: unknown;
  expectedMethod?: "webhook";
  expectedRevisionKey: string;
  expectedDeliveryKey: string;
  expectedBaseContentHash: string;
  expectedNextContentHash: string;
  expectedExternalId: string;
  expectedSiteHost: string;
  receivedAt: number;
}): PublishedRevisionReceipt {
  if (!args.response || typeof args.response !== "object" || Array.isArray(args.response)) {
    throw new Error("Webhook revision did not return a JSON object");
  }
  const response = args.response as Record<string, unknown>;
  if (
    response.accepted !== true ||
    response.revisionKey !== args.expectedRevisionKey ||
    response.deliveryKey !== args.expectedDeliveryKey ||
    response.baseContentHash !== args.expectedBaseContentHash ||
    response.contentHash !== args.expectedNextContentHash ||
    response.baseExternalId !== args.expectedExternalId ||
    typeof response.externalId !== "string" ||
    !response.externalId ||
    typeof response.url !== "string"
  ) {
    throw new Error("Webhook revision did not acknowledge the exact external CAS");
  }
  const url = new URL(response.url);
  const normalized = (host: string) => host.toLowerCase().replace(/^www\./, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    normalized(url.hostname) !== normalized(args.expectedSiteHost)
  ) {
    throw new Error("Webhook revision URL is not the expected tenant HTTPS destination");
  }
  url.hash = "";
  return validatePublishedRevisionReceipt({
    receipt: {
      method: args.expectedMethod ?? "webhook",
      revisionKey: args.expectedRevisionKey,
      deliveryKey: args.expectedDeliveryKey,
      baseContentHash: args.expectedBaseContentHash,
      baseExternalId: args.expectedExternalId,
      contentHash: args.expectedNextContentHash,
      externalId: response.externalId,
      url: url.href,
      status: "accepted",
      receivedAt: args.receivedAt,
    },
    method: "webhook",
    revisionKey: args.expectedRevisionKey,
    baseArtifactHash: args.expectedBaseContentHash,
    nextArtifactHash: args.expectedNextContentHash,
    baseExternalId: args.expectedExternalId,
  });
}

export function rollbackRevisionArtifact(args: {
  current: PublishedRevisionArtifact;
  preservedBase: PublishedRevisionArtifact;
}): PublishedRevisionArtifact {
  if (
    args.current.title !== args.preservedBase.title ||
    args.current.slug !== args.preservedBase.slug ||
    args.current.publicationConfigHash !== args.preservedBase.publicationConfigHash
  ) {
    throw new Error("Rollback artifact crossed an immutable publication boundary");
  }
  const quality = evaluatePublicationQuality(args.preservedBase, "strict");
  if (!quality.passed) {
    throw new Error(`Rollback artifact no longer passes strict quality: ${quality.issues.join(" ")}`);
  }
  return args.preservedBase;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizedHtmlText(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function tagAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return match ? normalizedHtmlText(match[1] ?? match[2] ?? "") : undefined;
}

function headTags(html: string, tagName: string): string[] {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  return [...head.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))].map(
    (match) => match[0],
  );
}

function liveMetaTitles(html: string): Array<string | undefined> {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const socialTitles = headTags(html, "meta")
    .filter((tag) => ["og:title", "twitter:title"].includes(
      (tagAttribute(tag, "property") ?? tagAttribute(tag, "name") ?? "")
        .toLocaleLowerCase("en-US"),
    ))
    .map((tag) => tagAttribute(tag, "content"));
  return [title ? normalizedHtmlText(title) : undefined, ...socialTitles];
}

function assertExactLiveMetaTitle(html: string, expectedTitle: string | undefined): void {
  const expected = normalizedHtmlText(expectedTitle ?? "");
  const documentTitle = liveMetaTitles(html)[0];
  if (!expected || documentTitle !== expected) {
    throw new Error("Live revision does not expose the exact revised meta title");
  }
}

function liveMetaDescriptions(html: string): Array<string | undefined> {
  return headTags(html, "meta")
    .filter((tag) =>
      (tagAttribute(tag, "name") ?? "").toLocaleLowerCase("en-US") ===
        "description"
    )
    .map((tag) => tagAttribute(tag, "content"));
}

function assertExactLiveMetaDescription(
  html: string,
  expectedDescription: string | undefined,
): void {
  const expected = normalizedHtmlText(expectedDescription ?? "");
  if (!expected || !liveMetaDescriptions(html).includes(expected)) {
    throw new Error("Live revision does not expose the exact revised meta description");
  }
}

type LiveAnchor = { href: string; anchor: string };

function canonicalLiveAnchor(
  href: string,
  anchorHtml: string,
  expectedUrl: string,
): LiveAnchor | null {
  try {
    return {
      href: canonicalPublicationUrl(new URL(decodeHtml(href), expectedUrl).href),
      anchor: normalizedHtmlText(anchorHtml.replace(/<[^>]*>/g, " ")),
    };
  } catch {
    return null;
  }
}

function relatedReadingAnchors(html: string, expectedUrl: string): LiveAnchor[] {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const anchors: LiveAnchor[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (
      normalizedHtmlText((heading[1] ?? "").replace(/<[^>]*>/g, " "))
        .toLocaleLowerCase("en-US") !== "related reading"
    ) {
      continue;
    }
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    for (const match of section.matchAll(
      /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const anchor = canonicalLiveAnchor(
        match[1] ?? match[2] ?? "",
        match[3] ?? "",
        expectedUrl,
      );
      if (anchor) anchors.push(anchor);
    }
  }
  return anchors;
}

function canonicalArtifactLink(
  link: { href: string; anchor: string },
  expectedUrl: string,
): LiveAnchor {
  return {
    href: canonicalPublicationUrl(new URL(link.href, expectedUrl).href),
    anchor: normalizedHtmlText(link.anchor),
  };
}

function sameLiveAnchor(left: LiveAnchor, right: LiveAnchor): boolean {
  return left.href === right.href && left.anchor === right.anchor;
}

/** Exact post-deploy proof. A delivery acknowledgement alone is not success. */
export function verifyLivePublishedRevision(args: {
  expectedUrl: string;
  fetchedUrl: string;
  html: string;
  base: PublishedRevisionArtifact;
  next: PublishedRevisionArtifact;
  kind: PublishedRevisionKind;
  targetUrl?: string;
}): void {
  verifyLivePublicationPage({
    expectedUrl: args.expectedUrl,
    fetchedUrl: args.fetchedUrl,
    html: args.html,
    title: args.next.title,
  });

  const canonicalTags = headTags(args.html, "link").filter((tag) =>
    (tagAttribute(tag, "rel") ?? "")
      .toLocaleLowerCase("en-US")
      .split(/\s+/)
      .includes("canonical"),
  );
  if (canonicalTags.length !== 1) {
    throw new Error("Live revision page must expose exactly one canonical link");
  }
  const canonicalHref = tagAttribute(canonicalTags[0], "href");
  if (
    !canonicalHref ||
    canonicalPublicationUrl(new URL(canonicalHref, args.expectedUrl).href) !==
      canonicalPublicationUrl(args.expectedUrl)
  ) {
    throw new Error("Live revision canonical does not match the exact tenant URL");
  }

  if (args.kind === "improve_snippet") {
    if (args.base.metaTitle !== args.next.metaTitle) {
      assertExactLiveMetaTitle(args.html, args.next.metaTitle);
    }
    if (args.base.metaDescription !== args.next.metaDescription) {
      assertExactLiveMetaDescription(args.html, args.next.metaDescription);
    }
  }

  if (args.kind === "strengthen_cluster") {
    if (!args.targetUrl) {
      throw new Error("Internal-link revision is missing its exact live target");
    }
    const baseHrefs = new Set((args.base.internalLinks ?? []).map((link) => link.href));
    const additions = (args.next.internalLinks ?? [])
      .filter((link) => !baseHrefs.has(link.href))
      .map((link) => canonicalArtifactLink(link, args.expectedUrl));
    if (additions.length !== 1) {
      throw new Error("Live internal-link proof lost its exact deterministic addition");
    }
    const exactTarget = canonicalPublicationUrl(
      new URL(args.targetUrl, args.expectedUrl).href,
    );
    if (additions[0].href !== exactTarget) {
      throw new Error("Live internal-link proof does not match the sealed target");
    }
    const liveAnchors = relatedReadingAnchors(args.html, args.expectedUrl);
    if (!liveAnchors.some((link) => sameLiveAnchor(link, additions[0]))) {
      throw new Error(
        "Live revision does not contain the exact verified internal target and anchor in Related reading",
      );
    }
  }

  if (args.kind === "rollback") {
    let observableChange = false;
    const baseRenderedTitle = args.base.metaTitle ?? args.base.title;
    const nextRenderedTitle = args.next.metaTitle ?? args.next.title;
    if (baseRenderedTitle !== nextRenderedTitle) {
      assertExactLiveMetaTitle(args.html, nextRenderedTitle);
      observableChange = true;
    }
    if (args.base.metaDescription !== args.next.metaDescription) {
      assertExactLiveMetaDescription(args.html, args.next.metaDescription);
      observableChange = true;
    }

    const baseLinks = (args.base.internalLinks ?? [])
      .map((link) => canonicalArtifactLink(link, args.expectedUrl));
    const nextLinks = (args.next.internalLinks ?? [])
      .map((link) => canonicalArtifactLink(link, args.expectedUrl));
    const removed = baseLinks.filter(
      (baseLink) => !nextLinks.some((nextLink) => nextLink.href === baseLink.href),
    );
    const restored = nextLinks.filter(
      (nextLink) => !baseLinks.some((baseLink) => baseLink.href === nextLink.href),
    );
    const liveAnchors = relatedReadingAnchors(args.html, args.expectedUrl);
    for (const removedLink of removed) {
      if (liveAnchors.some((link) => sameLiveAnchor(link, removedLink))) {
        throw new Error("Live rollback still contains the exact reverted internal link");
      }
      observableChange = true;
    }
    for (const restoredLink of restored) {
      if (!liveAnchors.some((link) => sameLiveAnchor(link, restoredLink))) {
        throw new Error("Live rollback does not contain the exact restored internal link");
      }
      observableChange = true;
    }
    if (!observableChange) {
      throw new Error("Live rollback has no deterministically verifiable field change");
    }
  }
}
