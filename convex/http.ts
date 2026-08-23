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
      typeof body.gscProperty !== "string"
    ) {
      return json({ error: "Invalid Search Console payload" }, 400);
    }

    await ctx.runMutation(internal.sites.setGscTokenInternal, {
      siteId: body.siteId as Id<"sites">,
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
    return json({ ok: true, ready: result.ready });
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
