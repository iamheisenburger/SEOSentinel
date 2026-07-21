import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  requireSafeGitHubDefaultBranch,
  safeGitHubRepositoryPart,
} from "./lib/publicationArtifact";

const http = httpRouter();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isAuthorized(request: Request) {
  const secret = process.env.PENTRA_INTERNAL_SECRET;
  return Boolean(
    secret &&
      request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
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
    });
    return json({ ok: true });
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

export default http;
