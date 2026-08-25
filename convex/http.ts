import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  requireSafeGitHubDefaultBranch,
  safeGitHubRepositoryPart,
} from "./lib/publicationArtifact";
import {
  isBrowserOutcomeRequest,
  isOutcomeEventType,
  isOutcomeIngestPubliclyEnabled,
  outcomeTokenHash,
  parseOutcomeBearerToken,
} from "./lib/outcomeReceipts";
import { isAuthorizedInternalBearer } from "./lib/internalHttpAuth";
import { sha256Hex } from "./lib/publicationArtifact";
import {
  OUTREACH_INBOUND_RELAY_MAX_BODY_BYTES,
  classifyInboundRelay,
  classifyInboundRelayDsnCanary,
  inboundRelayAliasHash,
  inboundRelayCanaryEvidenceReceipt,
  inboundRelayConfigured,
  inboundRelayEventKey,
  inboundRelayEvidenceReceipt,
  inboundRelayMessageIdHash,
  normalizeInboundRelayDomain,
  parseInboundRelayPayload,
  verifyInboundRelaySignature,
} from "./lib/outreachInboundRelay";

function inboundRelayRuntimeConfig() {
  return {
    domain: process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    secrets: [
      process.env.OUTREACH_INBOUND_RELAY_SECRET,
      process.env.OUTREACH_INBOUND_RELAY_SECRET_NEXT,
    ],
    dsnTargetSecret:
      process.env.OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET,
    adapterVersion: process.env.OUTREACH_INBOUND_RELAY_ADAPTER_VERSION,
    retentionPolicyHash:
      process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH,
    retentionAudited: process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
  };
}

const http = httpRouter();

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    },
  });
}

function isAuthorized(request: Request) {
  return isAuthorizedInternalBearer(
    request.headers.get("authorization"),
    [
      process.env.PENTRA_INTERNAL_SECRET,
      process.env.PENTRA_INTERNAL_SECRET_NEXT,
    ],
  );
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readBoundedOutcomeBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength === null ? undefined : Number(contentLength);
  if (
    !contentType.toLowerCase().startsWith("application/json") ||
    (
      declaredLength !== undefined &&
      (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength < 0 ||
        declaredLength > 8_192
      )
    ) ||
    !request.body
  ) {
    return null;
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > 8_192) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readBoundedRawJson(
  request: Request,
  maximumBytes: number,
): Promise<{ bytes: Uint8Array; text: string } | null> {
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength === null ? undefined : Number(contentLength);
  if (
    !contentType.toLowerCase().startsWith("application/json") ||
    (declaredLength !== undefined &&
      (!Number.isSafeInteger(declaredLength) ||
        declaredLength <= 0 ||
        declaredLength > maximumBytes)) ||
    !request.body
  ) {
    return null;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  if (bytesRead === 0) return null;
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      bytes,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return null;
  }
}

/**
 * Provider-neutral receiving-only authority webhook.
 *
 * The relay signs exact bytes and forwards only inbound mail. This route has
 * no reference to an outbound action and passes only bodyless digests and a
 * classification to the durable mutation.
 */
http.route({
  path: "/webhooks/outreach-inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const relayDomain = normalizeInboundRelayDomain(
      process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    );
    const secrets = [
      process.env.OUTREACH_INBOUND_RELAY_SECRET,
      process.env.OUTREACH_INBOUND_RELAY_SECRET_NEXT,
    ];
    if (!inboundRelayConfigured(inboundRelayRuntimeConfig())) {
      return json({ error: "Inbound relay is unavailable" }, 503);
    }
    const body = await readBoundedRawJson(
      request,
      OUTREACH_INBOUND_RELAY_MAX_BODY_BYTES,
    );
    if (!body) return json({ error: "Invalid relay payload" }, 400);

    const eventIdHeader = request.headers.get("x-pentra-relay-event-id");
    const signatureValid = await verifyInboundRelaySignature({
      rawBody: body.bytes,
      timestampHeader: request.headers.get("x-pentra-relay-timestamp"),
      eventIdHeader,
      signatureHeader: request.headers.get("x-pentra-relay-signature"),
      secrets,
      now: Date.now(),
    });
    if (!signatureValid) return json({ error: "Invalid relay signature" }, 401);

    const payload = parseInboundRelayPayload(body.text);
    if (!payload || payload.eventId !== eventIdHeader) {
      return json({ error: "Invalid relay payload" }, 400);
    }
    if (
      payload.adapterVersion !==
        process.env.OUTREACH_INBOUND_RELAY_ADAPTER_VERSION ||
      payload.retentionPolicyHash !==
        process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH
    ) {
      // A signed but stale adapter must retry after the deployment/config is
      // reconciled; it cannot silently settle mail under a different audit.
      return json({ error: "Relay adapter configuration is stale" }, 503);
    }
    const recipientDomain = normalizeInboundRelayDomain(
      payload.recipient.split("@")[1],
    );
    if (!recipientDomain || recipientDomain !== relayDomain) {
      return json({ error: "Invalid relay recipient" }, 400);
    }

    const aliasHash = inboundRelayAliasHash(payload.recipient);
    const candidate = await ctx.runQuery(
      internal.outreach.getInboundRelayCandidate,
      { aliasHash, aliasDomain: recipientDomain },
    );
    if (!candidate) {
      const canary = await ctx.runQuery(
        internal.outreach.getInboundRelayDsnCanaryCandidate,
        { aliasHash, aliasDomain: recipientDomain },
      );
      // Unknown, stale, deleted or cross-tenant aliases deliberately receive
      // a generic acknowledgement so the endpoint is not an alias oracle.
      if (!canary) return json({ ok: true }, 202);
      const classification = classifyInboundRelayDsnCanary({
        payload,
        candidate: {
          testRecipientHash: canary.testRecipientHash,
          outboundRfcMessageIdHash: canary.outboundRfcMessageIdHash,
          issuedAt: canary.issuedAt,
          expiresAt: canary.expiresAt,
          dsnRoutingTargetHash: canary.dsnRoutingTargetHash,
          dsnRoutingTargetVersion: canary.dsnRoutingTargetVersion,
          dsnRoutingTargetGeneration:
            canary.dsnRoutingTargetGeneration,
        },
        now: Date.now(),
      });
      if (!classification) return json({ ok: true }, 202);
      const eventKey = inboundRelayEventKey(payload.eventId);
      const payloadHash = sha256Hex(body.text);
      const evidenceHash = sha256Hex(inboundRelayCanaryEvidenceReceipt({
        eventKey,
        siteId: canary.siteId,
        inboxId: canary.inboxId,
        canaryId: canary.canaryId,
        aliasHash,
        inboundMessageId: payload.messageId,
        outboundMessageIdHash: canary.outboundRfcMessageIdHash,
        dsnRoutingTargetHash: canary.dsnRoutingTargetHash,
        dsnRoutingTargetVersion: canary.dsnRoutingTargetVersion,
        dsnRoutingTargetGeneration: canary.dsnRoutingTargetGeneration,
        receivedAt: payload.receivedAt,
        adapterVersion: payload.adapterVersion,
        retentionPolicyHash: payload.retentionPolicyHash,
      }));
      const result = await ctx.runMutation(
        internal.outreach.recordInboundRelayDsnCanaryReceipt,
        {
          canaryId: canary.canaryId,
          siteId: canary.siteId,
          inboxId: canary.inboxId,
          aliasHash,
          aliasDomain: canary.aliasDomain,
          eventKey,
          payloadHash,
          evidenceHash,
          inboundMessageIdHash: inboundRelayMessageIdHash(payload.messageId),
          fromEmail: classification.fromEmail,
          receivedAt: payload.receivedAt,
          rolloutEpoch: canary.rolloutEpoch,
          inboxConfigurationVersion: canary.inboxConfigurationVersion,
          senderDomain: canary.senderDomain,
          relayConfigurationHash: canary.relayConfigurationHash,
          adapterVersion: canary.adapterVersion,
          retentionPolicyHash: canary.retentionPolicyHash,
          dsnRoutingTargetHash: canary.dsnRoutingTargetHash,
          dsnRoutingTargetVersion: canary.dsnRoutingTargetVersion,
          dsnRoutingTargetGeneration: canary.dsnRoutingTargetGeneration,
        },
      );
      return json({
        ok: true,
        accepted: true,
        canary: true,
        replay: "replay" in result && result.replay === true,
      });
    }
    if (candidate.state === "pending") {
      return json(
        { error: "Outbound delivery is still settling" },
        425,
        { "Retry-After": "30" },
      );
    }

    const classification = classifyInboundRelay({
      payload,
      candidate: {
        messageId: candidate.messageId,
        toEmail: candidate.toEmail,
        toDomain: candidate.toDomain,
        sentAt: candidate.sentAt,
        outboundRfcMessageIdHash: candidate.outboundRfcMessageIdHash,
        dsnRoutingTargetHash: candidate.dsnRoutingTargetHash,
        dsnRoutingTargetVersion: candidate.dsnRoutingTargetVersion,
        dsnRoutingTargetGeneration: candidate.dsnRoutingTargetGeneration,
      },
      now: Date.now(),
    });
    const eventKey = inboundRelayEventKey(payload.eventId);
    const payloadHash = sha256Hex(body.text);
    const subjectDigest = sha256Hex(payload.subject);
    const bodyDigest = sha256Hex(payload.text);
    const evidenceHash = sha256Hex(inboundRelayEvidenceReceipt({
      eventKey,
      siteId: candidate.siteId,
      messageId: candidate.messageId,
      inboundMessageId: payload.messageId,
      outboundMessageIdHash: candidate.outboundRfcMessageIdHash,
      aliasHash,
      kind: classification.kind,
      fromEmail: classification.fromEmail,
      receivedAt: payload.receivedAt,
      subjectDigest,
      bodyDigest,
      ...(payload.dsn
        ? { dsnRoutingTargetHash: payload.dsn.routingRecipientHash }
        : {}),
    }));
    const result = await ctx.runMutation(
      internal.outreach.recordInboundRelayReceipt,
      {
        siteId: candidate.siteId,
        inboxId: candidate.inboxId,
        messageId: candidate.messageId,
        aliasHash,
        aliasDomain: candidate.aliasDomain,
        eventKey,
        payloadHash,
        evidenceHash,
        inboundMessageId: payload.messageId,
        outboundMessageIdHash: candidate.outboundRfcMessageIdHash,
        kind: classification.kind,
        reason:
          classification.kind === "ignored"
            ? classification.reason
            : undefined,
        fromEmail: classification.fromEmail,
        receivedAt: payload.receivedAt,
        rolloutEpoch: candidate.rolloutEpoch,
        inboxConfigurationVersion: candidate.inboxConfigurationVersion,
        senderDomain: candidate.senderDomain,
        dsnRoutingTargetHash: candidate.dsnRoutingTargetHash,
        dsnRoutingTargetVersion: candidate.dsnRoutingTargetVersion,
        dsnRoutingTargetGeneration: candidate.dsnRoutingTargetGeneration,
        deliveryOwnerAccountKey: candidate.deliveryOwnerAccountKey,
      },
    );
    return json({
      ok: true,
      accepted: classification.kind !== "ignored",
      replay: "replay" in result && result.replay === true,
    });
  }),
});

http.route({
  path: "/internal/oauth/site",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = await readBody(request);
    const siteId = body?.siteId;
    if (typeof siteId !== "string") return json({ error: "Invalid site" }, 400);

    const site = await ctx.runQuery(internal.sites.getFull, {
      siteId: siteId as Id<"sites">,
    });
    if (!site) return json({ error: "Site not found" }, 404);
    return json({ domain: site.domain });
  }),
});

http.route({
  path: "/internal/oauth/github",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = await readBody(request);
    if (
      typeof body?.siteId !== "string" ||
      typeof body.githubToken !== "string" ||
      body.githubToken.length < 10
    ) {
      return json({ error: "Invalid GitHub connection payload" }, 400);
    }

    const siteId = body.siteId as Id<"sites">;
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) return json({ error: "Site not found" }, 404);

    let repoOwner: string | undefined;
    let repoName: string | undefined;
    try {
      repoOwner = safeGitHubRepositoryPart(site.repoOwner, "owner");
      repoName = safeGitHubRepositoryPart(site.repoName, "repository name");
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Invalid GitHub repository" },
        400,
      );
    }
    if (!repoOwner || !repoName) {
      return json(
        { error: "Save the GitHub owner and repository before connecting" },
        409,
      );
    }

    let repositoryResponse: Response;
    try {
      repositoryResponse = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}`,
        {
          headers: {
            Authorization: `Bearer ${body.githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Pentra",
          },
          redirect: "error",
        },
      );
    } catch {
      return json({ error: "Could not verify the GitHub repository" }, 502);
    }
    if (!repositoryResponse.ok) {
      return json(
        {
          error:
            repositoryResponse.status === 404
              ? "Repository not found or the GitHub account cannot access it"
              : "GitHub repository verification failed",
        },
        repositoryResponse.status === 404 ? 400 : 502,
      );
    }

    let repoDefaultBranch: string;
    try {
      const metadata = (await repositoryResponse.json()) as {
        default_branch?: unknown;
      };
      repoDefaultBranch = requireSafeGitHubDefaultBranch(
        typeof metadata.default_branch === "string"
          ? metadata.default_branch
          : undefined,
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "GitHub did not return a valid default branch",
        },
        502,
      );
    }

    await ctx.runMutation(internal.sites.setGithubTokenInternal, {
      siteId,
      githubToken: body.githubToken,
      repoOwner,
      repoName,
      repoDefaultBranch,
    });
    return json({ ok: true, repoDefaultBranch });
  }),
});

http.route({
  path: "/internal/oauth/gsc",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = await readBody(request);
    if (
      typeof body?.siteId !== "string" ||
      typeof body.gscAccessToken !== "string" ||
      typeof body.gscProperty !== "string" ||
      typeof body.expectedCanonicalDomain !== "string" ||
      typeof body.expectedDomainRevision !== "number" ||
      !Number.isSafeInteger(body.expectedDomainRevision) ||
      body.expectedDomainRevision < 0 ||
      typeof body.expectedConnectionRevision !== "number" ||
      !Number.isSafeInteger(body.expectedConnectionRevision) ||
      body.expectedConnectionRevision < 0 ||
      body.establishConnection !== true
    ) {
      return json({ error: "Invalid Search Console payload" }, 400);
    }

    await ctx.runMutation(internal.sites.setGscTokenInternal, {
      siteId: body.siteId as Id<"sites">,
      expectedCanonicalDomain: body.expectedCanonicalDomain,
      expectedDomainRevision: body.expectedDomainRevision,
      expectedConnectionRevision: body.expectedConnectionRevision,
      establishConnection: true,
      gscAccessToken: body.gscAccessToken,
      gscRefreshToken:
        typeof body.gscRefreshToken === "string"
          ? body.gscRefreshToken
          : undefined,
      gscProperty: body.gscProperty,
      gscEmail:
        typeof body.gscEmail === "string" ? body.gscEmail : undefined,
      gscScopes:
        typeof body.gscScopes === "string" ? body.gscScopes : undefined,
    });
    return json({ ok: true });
  }),
});

http.route({
  path: "/internal/oauth/outreach-gmail/preflight",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = await readBody(request);
    if (typeof body?.siteId !== "string") {
      return json({ error: "Invalid Gmail outreach preflight" }, 400);
    }
    const result = await ctx.runQuery(
      internal.outreach.getGmailReconnectReadinessInternal,
      { siteId: body.siteId as Id<"sites"> },
    );
    return json(result, result.ready ? 200 : 409);
  }),
});

http.route({
  path: "/internal/oauth/outreach-gmail",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = await readBody(request);
    if (
      typeof body?.siteId !== "string" ||
      typeof body.fromEmail !== "string" ||
      typeof body.oauthAccessToken !== "string" ||
      typeof body.oauthScopes !== "string" ||
      typeof body.senderDomain !== "string" ||
      typeof body.dkimSelector !== "string" ||
      typeof body.dnsCheckedAt !== "number" ||
      typeof body.spfVerified !== "boolean" ||
      typeof body.dkimVerified !== "boolean" ||
      typeof body.dmarcVerified !== "boolean"
    ) {
      return json({ error: "Invalid Gmail outreach payload" }, 400);
    }
    const result = await ctx.runMutation(
      internal.outreach.connectGmailInboxInternal,
      {
        siteId: body.siteId as Id<"sites">,
        fromEmail: body.fromEmail,
        fromName: typeof body.fromName === "string" ? body.fromName : undefined,
        oauthAccessToken: body.oauthAccessToken,
        oauthRefreshToken:
          typeof body.oauthRefreshToken === "string"
            ? body.oauthRefreshToken
            : undefined,
        oauthExpiresAt:
          typeof body.oauthExpiresAt === "number"
            ? body.oauthExpiresAt
            : undefined,
        oauthScopes: body.oauthScopes,
        senderDomain: body.senderDomain,
        dkimSelector: body.dkimSelector,
        dnsCheckedAt: body.dnsCheckedAt,
        spfVerified: body.spfVerified,
        dkimVerified: body.dkimVerified,
        dmarcVerified: body.dmarcVerified,
      },
    );
    return json({
      ok: true,
      ready: result.ready,
      inboundReady: result.inboundReady,
    });
  }),
});

http.route({
  path: "/internal/plan/features",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = await readBody(request);
    if (
      typeof body?.userId !== "string" ||
      !Array.isArray(body.planFeatures) ||
      !body.planFeatures.every((feature) => typeof feature === "string")
    ) {
      return json({ error: "Invalid plan payload" }, 400);
    }

    await ctx.runMutation(internal.sites.syncPlanFeaturesInternal, {
      userId: body.userId,
      planFeatures: body.planFeatures as string[],
    });
    return json({ ok: true });
  }),
});

http.route({
  path: "/internal/plan/entitlement-audit",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = await readBody(request);
    if (
      typeof body?.authoritativeVerifiedSince !== "number" ||
      !Number.isFinite(body.authoritativeVerifiedSince) ||
      body.authoritativeVerifiedSince <= 0 ||
      (
        body.cursor !== undefined &&
        typeof body.cursor !== "string"
      )
    ) {
      return json({ error: "Invalid audit payload" }, 400);
    }
    const result = await ctx.runQuery(
      internal.sites.auditPlanEntitlementPageInternal,
      {
        authoritativeVerifiedSince: body.authoritativeVerifiedSince,
        cursor: typeof body.cursor === "string" ? body.cursor : undefined,
      },
    );
    return json({ ok: true, ...result });
  }),
});

// Clerk signature verification happens in the Next.js webhook bridge. This
// second boundary accepts only the rotating server-to-server bearer secret;
// the raw Clerk id is never returned or logged by this endpoint.
http.route({
  path: "/account-deletion",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = await readBody(request);
    if (
      typeof body?.userId !== "string" ||
      !body.userId.startsWith("user_") ||
      body.userId.length > 512 ||
      (
        body.sourceEventId !== undefined &&
        (
          typeof body.sourceEventId !== "string" ||
          !body.sourceEventId.trim() ||
          body.sourceEventId.length > 512
        )
      )
    ) {
      return json({ error: "Invalid account deletion payload" }, 400);
    }
    const result = await ctx.runMutation(
      internal.sites.requestAccountDeletionInternal,
      {
        userId: body.userId,
        sourceEventId:
          typeof body.sourceEventId === "string"
            ? body.sourceEventId
            : undefined,
      },
    );
    return json({
      ok: true,
      accepted: result.accepted,
      status: result.status,
      alreadyRequested: result.alreadyRequested,
    });
  }),
});

// This endpoint is deliberately server-to-server only. It has no CORS route,
// rejects browser fetch metadata, and accepts the per-site secret exclusively
// in Authorization. Customer sites must relay trusted backend/session events;
// embedding the credential in public analytics JavaScript is unsupported.
http.route({
  path: "/outcomes/v1/receipts",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Keep the public edge dark unless an operator enables both the endpoint
    // and this exact reviewed safety policy. A stale or partial configuration
    // fails as 404 rather than exposing the credential-check mutation.
    if (!isOutcomeIngestPubliclyEnabled({
      enabled: process.env.OUTCOME_INGEST_ENABLED,
      safetyVersion: process.env.OUTCOME_INGEST_SAFETY_VERSION,
    })) {
      return json({ error: "Not found" }, 404, { "Cache-Control": "no-store" });
    }
    if (isBrowserOutcomeRequest(request.headers)) {
      return json(
        { error: "Browser outcome ingestion is not allowed" },
        403,
        { "Cache-Control": "no-store" },
      );
    }
    const token = parseOutcomeBearerToken(
      request.headers.get("authorization"),
    );
    if (!token) {
      return json(
        { error: "Unauthorized" },
        401,
        { "Cache-Control": "no-store" },
      );
    }
    const body = await readBoundedOutcomeBody(request);
    if (!body) {
      return json(
        { error: "Invalid receipt payload" },
        400,
        { "Cache-Control": "no-store" },
      );
    }
    // Secrets in JSON bodies are easy to leak through application logs and
    // browser instrumentation. Reject them rather than silently ignoring them.
    if (
      "token" in body ||
      "apiKey" in body ||
      "secret" in body ||
      "credential" in body
    ) {
      return json(
        { error: "Credentials belong only in Authorization" },
        400,
        { "Cache-Control": "no-store" },
      );
    }
    if (
      typeof body.siteId !== "string" ||
      (
        (typeof body.articleId !== "string") ===
        (typeof body.publicationDeliveryKey !== "string")
      ) ||
      typeof body.eventId !== "string" ||
      !isOutcomeEventType(body.eventType) ||
      typeof body.articleUrl !== "string" ||
      typeof body.sessionId !== "string" ||
      typeof body.goalKey !== "string" ||
      typeof body.occurredAt !== "number"
    ) {
      return json(
        { error: "Invalid receipt payload" },
        400,
        { "Cache-Control": "no-store" },
      );
    }
    let result;
    try {
      result = await ctx.runMutation(internal.outcomes.ingestReceiptInternal, {
        siteId: body.siteId,
        articleId:
          typeof body.articleId === "string" ? body.articleId : undefined,
        publicationDeliveryKey:
          typeof body.publicationDeliveryKey === "string"
            ? body.publicationDeliveryKey
            : undefined,
        // The raw credential never crosses the database mutation boundary.
        presentedTokenHash: outcomeTokenHash(body.siteId, token),
        eventId: body.eventId,
        eventType: body.eventType,
        articleUrl: body.articleUrl,
        sessionId: body.sessionId,
        goalKey: body.goalKey,
        occurredAt: body.occurredAt,
      });
    } catch {
      return json(
        { error: "Outcome receipt could not be recorded" },
        500,
        { "Cache-Control": "no-store" },
      );
    }
    if (!result.accepted) {
      if (result.code === "rate_limited") {
        return json(
          { error: "Outcome receipt rate limit reached" },
          429,
          {
            "Cache-Control": "no-store",
            "Retry-After": String(result.retryAfterSeconds ?? 60),
          },
        );
      }
      if (result.code === "unauthorized") {
        return json(
          { error: "Unauthorized" },
          401,
          { "Cache-Control": "no-store" },
        );
      }
      if (
        result.code === "event_conflict" ||
        result.code === "session_conflict"
      ) {
        return json(
          { error: "Receipt conflicts with existing attribution" },
          409,
          { "Cache-Control": "no-store" },
        );
      }
      return json(
        { error: "Receipt failed validation" },
        400,
        { "Cache-Control": "no-store" },
      );
    }
    return json(
      {
        accepted: true,
        duplicate: result.duplicate,
        eventId: result.eventId,
      },
      result.duplicate ? 200 : 202,
      { "Cache-Control": "no-store" },
    );
  }),
});

export default http;
