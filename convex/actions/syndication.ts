"use node";

import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

// ────────────────────────────────────────────────────────────
// Internal helper: Generate a LinkedIn post from article data
// ────────────────────────────────────────────────────────────

async function generateLinkedInPost(opts: {
  title: string;
  excerpt: string;
  keywords: string[];
  domain: string;
  slug: string;
  anthropicApiKey: string;
}): Promise<string> {
  const { title, excerpt, keywords, domain, slug, anthropicApiKey } = opts;

  const articleUrl = `https://${domain}/${slug}`;
  const hashtags = keywords
    .slice(0, 5)
    .map((k) => `#${k.replace(/[^a-zA-Z0-9]/g, "")}`)
    .join(" ");

  const client = new Anthropic({ apiKey: anthropicApiKey });

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Write a compelling LinkedIn post (150-200 words) to promote this article. The post should hook the reader, share 1-2 key insights from the article, and encourage them to read the full piece.

Article title: ${title}
Article excerpt: ${excerpt}
Keywords: ${keywords.join(", ")}

End the post with these hashtags: ${hashtags}

End with a call-to-action linking to the full article: ${articleUrl}

Rules:
- Write in a professional but conversational tone
- Use line breaks for readability (LinkedIn style)
- Do NOT use markdown formatting
- Do NOT include any preamble like "Here's a post" — just output the post text directly`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? `${title}\n\nRead the full article: ${articleUrl}\n\n${hashtags}`;
}

// ────────────────────────────────────────────────────────────
// syndicateToMedium
// ────────────────────────────────────────────────────────────

export const syndicateToMedium = action({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
  },
  handler: async (ctx, { siteId, articleId }): Promise<{ success: boolean; error?: string; url?: string }> => {
    try {
      // Fetch site and article
      const site = await ctx.runQuery(api.sites.get, { siteId });
      if (!site) return { success: false, error: "Site not found" };

      const article = await ctx.runQuery(api.articles.get, { articleId });
      if (!article) return { success: false, error: "Article not found" };

      const mediumToken = (site as Record<string, unknown>).mediumToken as string | undefined;
      if (!mediumToken) return { success: false, error: "Medium integration token not configured" };

      // Get Medium user ID
      const meRes = await fetch("https://api.medium.com/v1/me", {
        headers: {
          Authorization: `Bearer ${mediumToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!meRes.ok) {
        const errText = await meRes.text();
        console.error("[syndication] Medium /me failed:", meRes.status, errText);
        return { success: false, error: `Medium auth failed (${meRes.status})` };
      }

      const meData = (await meRes.json()) as { data?: { id?: string } };
      const mediumUserId = meData?.data?.id;
      if (!mediumUserId) return { success: false, error: "Could not resolve Medium user ID" };

      // Build canonical URL
      const domain = site.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
      const slug = article.slug.replace(/^\//, "");
      const canonicalUrl = `https://${domain}/${slug}`;

      // Build content with canonical footer
      const tags = (article.metaKeywords ?? []).slice(0, 5);
      const footer = `\n\n---\n\n*Originally published at [${domain}](${canonicalUrl})*`;
      const canonicalTag = `<link rel="canonical" href="${canonicalUrl}" />`;
      const content = `${canonicalTag}\n\n${article.markdown}${footer}`;

      // Post to Medium
      const postRes = await fetch(`https://api.medium.com/v1/users/${mediumUserId}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mediumToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          title: article.title,
          contentFormat: "markdown",
          content,
          canonicalUrl,
          publishStatus: "draft",
          tags,
        }),
      });

      if (!postRes.ok) {
        const errText = await postRes.text();
        console.error("[syndication] Medium post failed:", postRes.status, errText);
        return { success: false, error: `Medium post failed (${postRes.status})` };
      }

      const postData = (await postRes.json()) as { data?: { url?: string } };
      const mediumUrl = postData?.data?.url ?? "";

      console.log("[syndication] Medium draft created:", mediumUrl);
      return { success: true, url: mediumUrl };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[syndication] syndicateToMedium error:", message);
      return { success: false, error: message };
    }
  },
});

// ────────────────────────────────────────────────────────────
// syndicateToLinkedIn
// ────────────────────────────────────────────────────────────

export const syndicateToLinkedIn = action({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
  },
  handler: async (ctx, { siteId, articleId }): Promise<{ success: boolean; error?: string }> => {
    try {
      // Fetch site and article
      const site = await ctx.runQuery(api.sites.get, { siteId });
      if (!site) return { success: false, error: "Site not found" };

      const article = await ctx.runQuery(api.articles.get, { articleId });
      if (!article) return { success: false, error: "Article not found" };

      const siteAny = site as Record<string, unknown>;
      const linkedinToken = siteAny.linkedinToken as string | undefined;
      const linkedinAuthorId = siteAny.linkedinAuthorId as string | undefined;

      if (!linkedinToken) return { success: false, error: "LinkedIn OAuth token not configured" };
      if (!linkedinAuthorId) return { success: false, error: "LinkedIn author ID not configured" };

      // Get Anthropic key for post generation
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicApiKey) return { success: false, error: "ANTHROPIC_API_KEY not set" };

      // Build article URL
      const domain = site.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
      const slug = article.slug.replace(/^\//, "");
      const articleUrl = `https://${domain}/${slug}`;

      // Generate LinkedIn post text via Claude
      const excerpt = (article.markdown ?? "").slice(0, 500);
      const keywords = article.metaKeywords ?? [];

      const postText = await generateLinkedInPost({
        title: article.title,
        excerpt,
        keywords,
        domain,
        slug,
        anthropicApiKey,
      });

      // Post to LinkedIn UGC API
      const ugcBody = {
        author: `urn:li:person:${linkedinAuthorId}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: postText },
            shareMediaCategory: "ARTICLE",
            media: [
              {
                status: "READY",
                originalUrl: articleUrl,
                title: { text: article.title },
                description: { text: article.metaDescription ?? "" },
              },
            ],
          },
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      };

      const linkedinRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${linkedinToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(ugcBody),
      });

      if (!linkedinRes.ok) {
        const errText = await linkedinRes.text();
        console.error("[syndication] LinkedIn post failed:", linkedinRes.status, errText);
        return { success: false, error: `LinkedIn post failed (${linkedinRes.status})` };
      }

      console.log("[syndication] LinkedIn post published for:", article.title);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[syndication] syndicateToLinkedIn error:", message);
      return { success: false, error: message };
    }
  },
});

// ────────────────────────────────────────────────────────────
// syndicateArticle — orchestrator
// ────────────────────────────────────────────────────────────

export const syndicateArticle = action({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
  },
  handler: async (
    ctx,
    { siteId, articleId },
  ): Promise<{
    medium: { success: boolean; error?: string; url?: string };
    linkedin: { success: boolean; error?: string };
  }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });

    // Determine which platforms are configured
    const siteAny = (site ?? {}) as Record<string, unknown>;
    const hasMedium = !!siteAny.mediumToken;
    const hasLinkedIn = !!siteAny.linkedinToken && !!siteAny.linkedinAuthorId;

    // Run syndications in parallel where possible
    const [mediumResult, linkedinResult] = await Promise.all([
      hasMedium
        ? ctx.runAction(api.actions.syndication.syndicateToMedium, { siteId, articleId })
        : Promise.resolve({ success: false, error: "Medium not configured" } as { success: boolean; error?: string; url?: string }),
      hasLinkedIn
        ? ctx.runAction(api.actions.syndication.syndicateToLinkedIn, { siteId, articleId })
        : Promise.resolve({ success: false, error: "LinkedIn not configured" } as { success: boolean; error?: string }),
    ]);

    console.log("[syndication] Results — Medium:", mediumResult, "LinkedIn:", linkedinResult);

    return {
      medium: mediumResult,
      linkedin: linkedinResult,
    };
  },
});
