"use node";

import { api } from "../_generated/api";
import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import OpenAI from "openai";
import { z } from "zod";
import type { Id } from "convex/values";

const defaultModel = "gpt-4.1-mini";

const TopicSchema = z.object({
  label: z.string(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()).default([]),
  intent: z.string().optional(),
  priority: z.number().optional(),
  notes: z.string().optional(),
});

const PlanSchema = z.array(TopicSchema);

const ArticleSchema = z.object({
  title: z.string(),
  slug: z.string(),
  markdown: z.string(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  sources: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().optional(),
      }),
    )
    .optional(),
});

const LinkSchema = z.array(
  z.object({
    anchor: z.string(),
    href: z.string(),
  }),
);

const parseJson = <T>(schema: z.ZodTypeAny, text: string): T => {
  const startCandidates = [text.indexOf("{"), text.indexOf("[")].filter(
    (v) => v >= 0,
  );
  const start =
    startCandidates.length > 0
      ? Math.min(...startCandidates)
      : 0;
  const raw = text.slice(start).trim();
  return schema.parse(JSON.parse(raw)) as T;
};

const buildSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 90);

const openaiClient = (apiKey?: string) => {
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey });
};

async function fetchHtml(domain: string) {
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  const res = await fetch(url);
  const html = await res.text();
  return { url, html };
}

async function handleOnboarding(ctx: ActionCtx, siteId: Id<"sites">) {
  const site = await ctx.runQuery(api.sites.get, { siteId });
  if (!site) throw new Error("Site not found");
  const { html } = await fetchHtml(site.domain);
  const client = openaiClient(ctx.env.get("OPENAI_API_KEY"));

  const completion = await client.responses.create({
    model: defaultModel,
    input: [
      {
        role: "system",
        content:
          "You are an SEO onboarding agent. Extract up to 8 important pages for internal linking.",
      },
      {
        role: "user",
        content: `Return JSON only in shape {"siteSummary": string, "pages":[{"slug":string,"title":string,"summary":string,"keywords":string[]}]} based on this HTML:\n${html.slice(0, 8000)}`,
      },
    ],
  });

  const data = parseJson<{
    siteSummary?: string;
    pages: { slug: string; title: string; summary: string; keywords?: string[] }[];
  }>(z.object({
    siteSummary: z.string().optional(),
    pages: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        summary: z.string(),
        keywords: z.array(z.string()).optional(),
      }),
    ),
  }), completion.output_text);

  const pages = data.pages ?? [];
  if (pages.length) {
    await ctx.runMutation(api.pages.bulkUpsert, {
      siteId,
      pages: pages.map((p) => ({
        url: `${site.domain.replace(/\/$/, "")}/${p.slug.replace(/^\//, "")}`,
        slug: p.slug.startsWith("/") ? p.slug : `/${p.slug}`,
        title: p.title,
        keywords: p.keywords,
        summary: p.summary,
      })),
    });
  }

  return {
    siteId,
    pages,
    siteSummary: data.siteSummary ?? "",
  };
}

async function handlePlan(ctx: ActionCtx, siteId: Id<"sites">) {
  const site = await ctx.runQuery(api.sites.get, { siteId });
  if (!site) throw new Error("Site not found");
  const client = openaiClient(ctx.env.get("OPENAI_API_KEY"));

  const completion = await client.responses.create({
    model: defaultModel,
    input: [
      {
        role: "system",
        content:
          "You are an SEO strategist. Propose clustered topics with keywords. Output JSON only.",
      },
      {
        role: "user",
        content: `Domain: ${site.domain}\nNiche: ${site.niche ?? ""}\nTone: ${site.tone ?? "neutral"}\nLanguage: ${site.language ?? "en"}\nReturn JSON array of topics like [{"label": "...","primaryKeyword":"...","secondaryKeywords":["..."],"intent":"informational|commercial|transactional","priority":1-5,"notes":"short reason"}].`,
      },
    ],
  });

  const plan = parseJson<z.infer<typeof PlanSchema>>(PlanSchema, completion.output_text);
  await ctx.runMutation(api.topics.upsertMany, { siteId, topics: plan });
  return { count: plan.length };
}

async function handleArticle(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  topicId?: Id<"topic_clusters">,
) {
  const site = await ctx.runQuery(api.sites.get, { siteId });
  const topic = topicId
    ? await ctx.runQuery(api.topics.get, { topicId })
    : null;
  if (!site) throw new Error("Site not found");
  if (topicId && !topic) throw new Error("Topic not found");

  const client = openaiClient(ctx.env.get("OPENAI_API_KEY"));
  const completion = await client.responses.create({
    model: defaultModel,
    input: [
      {
        role: "system",
        content:
          "You are an SEO content agent. Produce a concise, well-structured Markdown article with headings, bullets, and a brief FAQ. Output JSON only.",
      },
      {
        role: "user",
        content: `Site: ${site.domain}\nNiche: ${site.niche ?? ""}\nTone: ${site.tone ?? "neutral"}\nLanguage: ${site.language ?? "en"}\nTopic: ${
          topic?.label ?? "General SEO article"
        }\nPrimary keyword: ${topic?.primaryKeyword ?? ""}\nSecondary keywords: ${
          topic?.secondaryKeywords?.join(", ") ?? ""
        }\nReturn JSON like {"title": "...","slug":"...","markdown":"...","metaTitle":"...","metaDescription":"...","sources":[{"url":"...","title":"..."}]}.`,
      },
    ],
  });

  const article = parseJson<z.infer<typeof ArticleSchema>>(
    ArticleSchema,
    completion.output_text,
  );

  const slug = article.slug || buildSlug(article.title);
  const articleId = await ctx.runMutation(api.articles.createDraft, {
    siteId,
    topicId: topicId ?? undefined,
    title: article.title,
    slug: slug.startsWith("/") ? slug : `/${slug}`,
    markdown: article.markdown,
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    sources: article.sources,
    language: site.language,
  });

  if (topicId) {
    await ctx.runMutation(api.topics.updateStatus, {
      topicId,
      status: "used",
    });
  }

  return { articleId };
}

async function handleLinks(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  articleId: Id<"articles">,
) {
  const site = await ctx.runQuery(api.sites.get, { siteId });
  const article = await ctx.runQuery(api.articles.get, { articleId });
  if (!site || !article) throw new Error("Missing site or article");
  const pages = await ctx.runQuery(api.pages.listBySite, { siteId });
  const client = openaiClient(ctx.env.get("OPENAI_API_KEY"));

  const completion = await client.responses.create({
    model: defaultModel,
    input: [
      {
        role: "system",
        content:
          "Suggest concise internal links. Output JSON array only: [{\"anchor\":\"...\",\"href\":\"/path\"}].",
      },
      {
        role: "user",
        content: `Use this article and site pages to propose 5-10 internal links. Article title: ${article.title}. Slug: ${article.slug}. Pages: ${pages
          .map((p) => `${p.slug}:${p.title ?? ""}`)
          .join("; ")}`,
      },
    ],
  });

  const links = parseJson<z.infer<typeof LinkSchema>>(LinkSchema, completion.output_text);
  await ctx.runMutation(api.articles.updateLinks, { articleId, internalLinks: links });
  return { count: links.length };
}

export const onboardSite = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => handleOnboarding(ctx, siteId),
});

export const generatePlan = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => handlePlan(ctx, siteId),
});

export const generateArticle = action({
  args: { siteId: v.id("sites"), topicId: v.optional(v.id("topic_clusters")) },
  handler: async (ctx, { siteId, topicId }) =>
    handleArticle(ctx, siteId, topicId),
});

export const suggestInternalLinks = action({
  args: { siteId: v.id("sites"), articleId: v.id("articles") },
  handler: async (ctx, { siteId, articleId }) =>
    handleLinks(ctx, siteId, articleId),
});

export const processNextJob = action({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.runQuery(api.jobs.listPending, {});
    const job = pending[0];
    if (!job) return { processed: false };
    await ctx.runMutation(api.jobs.markRunning, { jobId: job._id });
    try {
      type JobPayload = {
        topicId?: Id<"topic_clusters">;
        articleId?: Id<"articles">;
      };
      const payload = job.payload as JobPayload | undefined;

      if (job.type === "onboarding") {
        if (!job.siteId) throw new Error("Missing siteId on onboarding job");
        await handleOnboarding(ctx, job.siteId);
      } else if (job.type === "plan") {
        if (!job.siteId) throw new Error("Missing siteId on plan job");
        await handlePlan(ctx, job.siteId);
      } else if (job.type === "article") {
        if (!job.siteId) throw new Error("Missing siteId on article job");
        await handleArticle(ctx, job.siteId, payload?.topicId);
      } else if (job.type === "links") {
        if (!job.siteId) throw new Error("Missing siteId on links job");
        if (!payload?.articleId)
          throw new Error("Missing articleId on links job");
        await handleLinks(ctx, job.siteId, payload.articleId);
      }
      await ctx.runMutation(api.jobs.markDone, {
        jobId: job._id,
        result: "ok",
      });
      return { processed: true, jobId: job._id };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      await ctx.runMutation(api.jobs.markFailed, {
        jobId: job._id,
        error: message,
      });
      return { processed: false, error: message };
    }
  },
});

