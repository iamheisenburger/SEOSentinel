"use node";

import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { createHmac } from "crypto";

type FileContent = {
  path: string;
  content: string;
};

type ArticleRecord = {
  _id: Id<"articles">;
  title: string;
  slug: string;
  markdown: string;
  metaDescription?: string;
  language?: string;
  featuredImage?: string;
  readingTime?: number;
  wordCount?: number;
  createdAt: number;
  sources?: { url: string; title?: string }[];
  internalLinks?: { anchor: string; href: string }[];
};

type SiteRecord = {
  _id: Id<"sites">;
  domain: string;
  publishMethod?: string;
  repoOwner?: string;
  repoName?: string;
  githubToken?: string;
  wpUrl?: string;
  wpUsername?: string;
  wpAppPassword?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  brandFontFamily?: string;
  urlStructure?: string;
};

// ── Shared Utilities ────────────────────────────────────

/**
 * Build YAML frontmatter + markdown body + optional schema markup.
 */
function buildMdx(article: ArticleRecord, domain: string): string {
  const slug = article.slug.replace(/^\//, "");
  const schemaMarkup = generateSchemaMarkup(article, domain, slug);

  const frontmatter = [
    "---",
    `title: "${article.title.replace(/"/g, '\\"')}"`,
    article.metaDescription
      ? `description: "${article.metaDescription.replace(/"/g, '\\"')}"`
      : undefined,
    article.featuredImage ? `featuredImage: "${article.featuredImage}"` : undefined,
    article.readingTime ? `readingTime: ${article.readingTime}` : undefined,
    article.wordCount ? `wordCount: ${article.wordCount}` : undefined,
    article.language ? `language: "${article.language}"` : undefined,
    `date: "${new Date(article.createdAt ?? Date.now()).toISOString()}"`,
    article.sources && article.sources.length
      ? `sources:\n${article.sources
          .map(
            (s) =>
              `  - url: "${s.url}"${s.title ? `\n    title: "${s.title}"` : ""}`,
          )
          .join("\n")}`
      : undefined,
    article.internalLinks && article.internalLinks.length
      ? `internalLinks:\n${article.internalLinks
          .map((l) => `  - anchor: "${l.anchor}"\n    href: "${l.href}"`)
          .join("\n")}`
      : undefined,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  return `${frontmatter}\n\n${article.markdown}${schemaMarkup ? `\n\n${schemaMarkup}` : ""}`;
}

type BrandStyle = {
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
};

/**
 * Convert markdown to styled HTML for WordPress/Webhook.
 * Injects brand colors as inline styles when available.
 */
function markdownToHtml(md: string, brand?: BrandStyle): string {
  let html = md;

  const primary = brand?.primaryColor || "#0EA5E9";
  const accent = brand?.accentColor || "#22D3EE";
  const font = brand?.fontFamily || "system-ui, -apple-system, sans-serif";

  // Images (before headings to avoid conflicts)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;height:auto;border-radius:8px;margin:1.5em 0">');

  // Headings (must come before bold processing)
  html = html.replace(/^######\s+(.+)$/gm, `<h6 style="font-family:${font};color:${primary};margin:1em 0 0.5em">$1</h6>`);
  html = html.replace(/^#####\s+(.+)$/gm, `<h5 style="font-family:${font};color:${primary};margin:1em 0 0.5em">$1</h5>`);
  html = html.replace(/^####\s+(.+)$/gm, `<h4 style="font-family:${font};color:${primary};margin:1.2em 0 0.5em">$1</h4>`);
  html = html.replace(/^###\s+(.+)$/gm, `<h3 style="font-family:${font};font-size:1.15em;margin:1.5em 0 0.5em">$1</h3>`);
  html = html.replace(/^##\s+(.+)$/gm, `<h2 style="font-family:${font};color:${primary};font-size:1.4em;margin:1.8em 0 0.6em;padding-bottom:0.3em;border-bottom:2px solid ${primary}20">$1</h2>`);
  html = html.replace(/^#\s+(.+)$/gm, `<h1 style="font-family:${font};color:${primary};font-size:1.8em;margin:0 0 0.8em">$1</h1>`);

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links — styled with brand accent color
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="color:${accent};text-decoration:underline">$1</a>`);

  // Blockquotes — styled with brand primary border
  html = html.replace(/^>\s+(.+)$/gm, `<blockquote style="border-left:4px solid ${primary};padding:0.5em 1em;margin:1em 0;color:#555;background:#f9f9f9">$1</blockquote>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:0.15em 0.4em;border-radius:4px;font-size:0.9em">$1</code>');

  // Horizontal rules
  html = html.replace(/^---$/gm, `<hr style="border:none;border-top:2px solid ${primary}20;margin:2em 0">`);

  // Unordered lists (simple — handles single-level)
  html = html.replace(
    /(?:^[-*]\s+.+\n?)+/gm,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map((line) => `<li style="margin:0.3em 0">${line.replace(/^[-*]\s+/, "")}</li>`)
        .join("\n");
      return `<ul style="padding-left:1.5em;margin:1em 0">\n${items}\n</ul>\n`;
    },
  );

  // Ordered lists
  html = html.replace(
    /(?:^\d+\.\s+.+\n?)+/gm,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map((line) => `<li style="margin:0.3em 0">${line.replace(/^\d+\.\s+/, "")}</li>`)
        .join("\n");
      return `<ol style="padding-left:1.5em;margin:1em 0">\n${items}\n</ol>\n`;
    },
  );

  // Paragraphs — wrap remaining lines that aren't already tags
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<[a-z]/.test(trimmed)) return trimmed;
      return `<p style="font-family:${font};line-height:1.7;margin:1em 0;color:#1a1a1a">${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n\n");

  return html;
}


/**
 * Generate JSON-LD schema markup for rich snippets.
 */
function generateSchemaMarkup(
  article: {
    title: string;
    markdown: string;
    metaDescription?: string;
    featuredImage?: string;
    createdAt: number;
  },
  domain: string,
  slug: string,
): string {
  const schemas: object[] = [];
  const url = `https://${domain}/blog/${slug}`;

  const articleSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.metaDescription ?? "",
    url,
    datePublished: new Date(article.createdAt).toISOString(),
    publisher: {
      "@type": "Organization",
      name: domain,
      url: `https://${domain}`,
    },
  };
  if (article.featuredImage) {
    articleSchema.image = article.featuredImage;
  }
  schemas.push(articleSchema);

  // FAQ schema
  const faqRegex = /#{2,3}\s+(.+\?)\s*\n+([\s\S]*?)(?=\n#{2,3}\s|\n*$)/g;
  const faqs: { question: string; answer: string }[] = [];
  let match;
  while ((match = faqRegex.exec(article.markdown)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim().slice(0, 500);
    if (question && answer) faqs.push({ question, answer });
  }
  if (faqs.length >= 3) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }

  // HowTo schema
  if (/how\s+to/i.test(article.title)) {
    const stepRegex =
      /#{2,3}\s+(?:Step\s+\d+[:.]\s*)?(.+)\n+([\s\S]*?)(?=\n#{2,3}\s|\n*$)/g;
    const steps: { name: string; text: string }[] = [];
    let stepMatch;
    while ((stepMatch = stepRegex.exec(article.markdown)) !== null) {
      const name = stepMatch[1].trim();
      const text = stepMatch[2].trim().slice(0, 300);
      if (name && text && !/FAQ|Frequently/i.test(name))
        steps.push({ name, text });
    }
    if (steps.length >= 3) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: article.title,
        step: steps.map((s, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name: s.name,
          text: s.text,
        })),
      });
    }
  }

  if (schemas.length === 0) return "";
  return schemas
    .map(
      (s) =>
        `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`,
    )
    .join("\n\n");
}

// ── GitHub Adapter ──────────────────────────────────────

async function commitToMain({
  token,
  owner,
  repo,
  branch,
  message,
  files,
}: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  message: string;
  files: FileContent[];
}): Promise<{ commitUrl: string; sha: string }> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const branchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers },
  );
  if (!branchRes.ok)
    throw new Error(`Failed to get branch ref: ${branchRes.statusText}`);
  const branchData = await branchRes.json();
  const baseSha = branchData.object.sha;

  const blobs = [];
  for (const file of files) {
    const blobRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        }),
      },
    );
    if (!blobRes.ok)
      throw new Error(`Failed to create blob: ${blobRes.statusText}`);
    const blob = await blobRes.json();
    blobs.push({ path: file.path, sha: blob.sha });
  }

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: baseSha,
        tree: blobs.map((b) => ({
          path: b.path,
          mode: "100644",
          type: "blob",
          sha: b.sha,
        })),
      }),
    },
  );
  if (!treeRes.ok)
    throw new Error(`Failed to create tree: ${treeRes.statusText}`);
  const tree = await treeRes.json();

  const commitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [baseSha],
      }),
    },
  );
  if (!commitRes.ok)
    throw new Error(`Failed to create commit: ${commitRes.statusText}`);
  const commit = await commitRes.json();

  const updateRefRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: commit.sha }),
    },
  );
  if (!updateRefRes.ok)
    throw new Error(`Failed to update branch: ${updateRefRes.statusText}`);

  return {
    commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    sha: commit.sha,
  };
}

async function publishToGitHub(
  ctx: ActionCtx,
  site: SiteRecord,
  article: ArticleRecord,
  args: { repoOwner?: string; repoName?: string; baseBranch?: string; contentDir?: string },
): Promise<{ method: "github"; commitUrl: string; filePath: string }> {
  const token = site.githubToken;
  if (!token) throw new Error("GitHub token not configured. Go to Settings → Publishing to add your GitHub personal access token.");

  const repoOwner = args.repoOwner ?? site.repoOwner;
  const repoName = args.repoName ?? site.repoName;
  if (!repoOwner || !repoName) throw new Error("GitHub repository not configured. Go to Settings → Publishing to set your repo owner and name.");
  const baseBranch = args.baseBranch ?? "main";
  // Derive contentDir from site urlStructure (e.g. "/blog/[slug]" -> "content/blog")
  const defaultDir = site.urlStructure
    ? "content/" + site.urlStructure.replace(/^\//, "").replace(/\/\[.*\]$/, "").replace(/\/$/, "")
    : "content/posts";
  const contentDir = args.contentDir ?? defaultDir;

  const slug = article.slug.replace(/^\//, "");
  const filePath = `${contentDir}/${slug}.mdx`;
  const mdx = buildMdx(article, site.domain);

  const { commitUrl } = await commitToMain({
    token,
    owner: repoOwner,
    repo: repoName,
    branch: baseBranch,
    message: `Add article: ${article.title}`,
    files: [{ path: filePath, content: mdx }],
  });

  await ctx.runMutation(api.articles.updateStatus, {
    articleId: article._id,
    status: "published",
  });

  return { method: "github", commitUrl, filePath };
}

// ── WordPress Adapter ───────────────────────────────────

async function publishToWordPress(
  ctx: ActionCtx,
  site: SiteRecord,
  article: ArticleRecord,
): Promise<{ method: "wordpress"; postUrl: string; postId: number }> {
  if (!site.wpUrl || !site.wpUsername || !site.wpAppPassword) {
    throw new Error("WordPress credentials not configured (wpUrl, wpUsername, wpAppPassword)");
  }

  const wpApiUrl = site.wpUrl.replace(/\/+$/, "");
  const credentials = Buffer.from(`${site.wpUsername}:${site.wpAppPassword}`).toString("base64");
  const brand: BrandStyle = {
    primaryColor: site.brandPrimaryColor,
    accentColor: site.brandAccentColor,
    fontFamily: site.brandFontFamily,
  };
  const htmlContent = markdownToHtml(article.markdown, brand);
  const slug = article.slug.replace(/^\//, "").replace(/\//g, "-");

  const res = await fetch(`${wpApiUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: article.title,
      content: htmlContent,
      slug,
      status: "publish",
      excerpt: article.metaDescription ?? "",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress API error (${res.status}): ${body.slice(0, 300)}`);
  }

  const post = await res.json();

  await ctx.runMutation(api.articles.updateStatus, {
    articleId: article._id,
    status: "published",
  });

  return {
    method: "wordpress",
    postUrl: post.link ?? `${wpApiUrl}/?p=${post.id}`,
    postId: post.id,
  };
}

// ── Webhook Adapter ─────────────────────────────────────

async function publishToWebhook(
  ctx: ActionCtx,
  site: SiteRecord,
  article: ArticleRecord,
): Promise<{ method: "webhook"; status: number; response: string }> {
  if (!site.webhookUrl) {
    throw new Error("Webhook URL not configured");
  }

  const payload = JSON.stringify({
    title: article.title,
    slug: article.slug.replace(/^\//, ""),
    markdown: article.markdown,
    html: markdownToHtml(article.markdown, {
      primaryColor: site.brandPrimaryColor,
      accentColor: site.brandAccentColor,
      fontFamily: site.brandFontFamily,
    }),
    metaDescription: article.metaDescription ?? "",
    language: article.language ?? "en",
    date: new Date(article.createdAt).toISOString(),
    sources: article.sources ?? [],
    internalLinks: article.internalLinks ?? [],
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // HMAC signature if secret is configured
  if (site.webhookSecret) {
    const signature = createHmac("sha256", site.webhookSecret)
      .update(payload)
      .digest("hex");
    headers["X-Signature-256"] = `sha256=${signature}`;
  }

  const res = await fetch(site.webhookUrl, {
    method: "POST",
    headers,
    body: payload,
  });

  const responseText = await res.text();

  if (!res.ok) {
    throw new Error(`Webhook failed (${res.status}): ${responseText.slice(0, 300)}`);
  }

  await ctx.runMutation(api.articles.updateStatus, {
    articleId: article._id,
    status: "published",
  });

  return { method: "webhook", status: res.status, response: responseText.slice(0, 200) };
}

// ── Manual Adapter ──────────────────────────────────────

async function publishManual(
  ctx: ActionCtx,
  article: ArticleRecord,
): Promise<{ method: "manual" }> {
  await ctx.runMutation(api.articles.updateStatus, {
    articleId: article._id,
    status: "published",
  });
  return { method: "manual" };
}

// ── Main Publisher (Router) ─────────────────────────────

type PublishResult = {
  method: string;
  commitUrl?: string;
  filePath?: string;
  postUrl?: string;
  postId?: number;
  status?: number;
  response?: string;
};

export const publishArticle = action({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    repoOwner: v.optional(v.string()),
    repoName: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
    contentDir: v.optional(v.string()),
  },
  handler: async (
    ctx: ActionCtx,
    args: {
      siteId: Id<"sites">;
      articleId: Id<"articles">;
      repoOwner?: string;
      repoName?: string;
      baseBranch?: string;
      contentDir?: string;
    },
  ): Promise<PublishResult> => {
    const site = await ctx.runQuery(api.sites.get, { siteId: args.siteId });
    if (!site) throw new Error("Site not found");

    const article = await ctx.runQuery(api.articles.get, {
      articleId: args.articleId,
    });
    if (!article) throw new Error("Article not found");

    const method = site.publishMethod ?? "github";

    switch (method) {
      case "wordpress":
        return publishToWordPress(ctx, site as SiteRecord, article as ArticleRecord);
      case "webhook":
        return publishToWebhook(ctx, site as SiteRecord, article as ArticleRecord);
      case "manual":
        return publishManual(ctx, article as ArticleRecord);
      case "github":
      default:
        return publishToGitHub(ctx, site as SiteRecord, article as ArticleRecord, args);
    }
  },
});
