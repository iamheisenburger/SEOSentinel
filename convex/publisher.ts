"use node";

import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { api } from "./_generated/api";

type FileContent = {
  path: string;
  content: string;
};

/**
 * Commit files directly to main branch (no PR, fully autonomous).
 */
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

  // Get current branch SHA
  const branchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers },
  );
  if (!branchRes.ok) {
    throw new Error(`Failed to get branch ref: ${branchRes.statusText}`);
  }
  const branchData = await branchRes.json();
  const baseSha = branchData.object.sha;

  // Create blobs for each file
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
    if (!blobRes.ok) {
      throw new Error(`Failed to create blob: ${blobRes.statusText}`);
    }
    const blob = await blobRes.json();
    blobs.push({ path: file.path, sha: blob.sha });
  }

  // Create tree
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
  if (!treeRes.ok) {
    throw new Error(`Failed to create tree: ${treeRes.statusText}`);
  }
  const tree = await treeRes.json();

  // Create commit
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
  if (!commitRes.ok) {
    throw new Error(`Failed to create commit: ${commitRes.statusText}`);
  }
  const commit = await commitRes.json();

  // Update branch ref to point to new commit (direct push to main)
  const updateRefRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: commit.sha }),
    },
  );
  if (!updateRefRes.ok) {
    throw new Error(`Failed to update branch: ${updateRefRes.statusText}`);
  }

  return {
    commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    sha: commit.sha,
  };
}

/**
 * Generate JSON-LD schema markup for rich snippets.
 * Detects FAQ sections and HowTo patterns in the article.
 */
function generateSchemaMarkup(
  article: {
    title: string;
    markdown: string;
    metaDescription?: string;
    createdAt: number;
  },
  domain: string,
  slug: string,
): string {
  const schemas: object[] = [];
  const url = `https://${domain}/${slug}`;

  // Article schema (always)
  schemas.push({
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
  });

  // FAQ schema — detect Q&A patterns (## heading ending with ?)
  const faqRegex = /#{2,3}\s+(.+\?)\s*\n+([\s\S]*?)(?=\n#{2,3}\s|\n*$)/g;
  const faqs: { question: string; answer: string }[] = [];
  let match;
  while ((match = faqRegex.exec(article.markdown)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim().slice(0, 500); // Truncate long answers
    if (question && answer) {
      faqs.push({ question, answer });
    }
  }

  if (faqs.length >= 3) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    });
  }

  // HowTo schema — detect "how to" in title with numbered steps
  if (/how\s+to/i.test(article.title)) {
    const stepRegex = /#{2,3}\s+(?:Step\s+\d+[:.]\s*)?(.+)\n+([\s\S]*?)(?=\n#{2,3}\s|\n*$)/g;
    const steps: { name: string; text: string }[] = [];
    let stepMatch;
    while ((stepMatch = stepRegex.exec(article.markdown)) !== null) {
      const name = stepMatch[1].trim();
      const text = stepMatch[2].trim().slice(0, 300);
      if (name && text && !/FAQ|Frequently/i.test(name)) {
        steps.push({ name, text });
      }
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

/**
 * Generate a sitemap.xml for all published articles.
 */
function generateSitemap(
  domain: string,
  articles: { slug: string; lastmod: string }[],
): string {
  const urls = articles.map((a) => {
    const loc = `https://${domain}${a.slug.startsWith("/") ? a.slug : `/${a.slug}`}`;
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${a.lastmod.split("T")[0]}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${domain}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${urls.join("\n")}
</urlset>`;
}

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
  ): Promise<{ commitUrl: string; filePath: string }> => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");

    const site = await ctx.runQuery(api.sites.get, { siteId: args.siteId });
    if (!site) throw new Error("Site not found");

    const article = await ctx.runQuery(api.articles.get, {
      articleId: args.articleId,
    });
    if (!article) throw new Error("Article not found");

    // Hardcoded defaults for fully hands-off operation.
    const repoOwner = args.repoOwner ?? "iamheisenburger";
    const repoName = args.repoName ?? "subscription-tracker";
    const baseBranch = args.baseBranch ?? "main";
    const contentDir = args.contentDir ?? "content/posts";

    const slug = article.slug.replace(/^\//, "");
    const filePath = `${contentDir}/${slug}.mdx`;

    // Generate schema markup (JSON-LD) for rich snippets
    const schemaMarkup = generateSchemaMarkup(article, site.domain, slug);

    const frontmatter = [
      "---",
      `title: "${article.title.replace(/"/g, '\\"')}"`,
      article.metaDescription
        ? `description: "${article.metaDescription.replace(/"/g, '\\"')}"`
        : undefined,
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

    const mdx = `${frontmatter}\n\n${article.markdown}${schemaMarkup ? `\n\n${schemaMarkup}` : ""}`;

    // Build files to commit: the article + updated sitemap
    const filesToCommit: FileContent[] = [
      { path: filePath, content: mdx },
    ];

    // Generate updated sitemap.xml with all published articles
    try {
      const allArticles = await ctx.runQuery(api.articles.listBySite, {
        siteId: args.siteId,
      });
      const publishedArticles = allArticles.filter(
        (a: { status?: string }) =>
          a.status === "published" || a._id === args.articleId,
      );
      const sitemapXml = generateSitemap(
        site.domain,
        publishedArticles.map((a: { slug: string; updatedAt?: number; createdAt: number }) => ({
          slug: a.slug,
          lastmod: new Date(a.updatedAt ?? a.createdAt).toISOString(),
        })),
      );
      filesToCommit.push({ path: "public/sitemap.xml", content: sitemapXml });
    } catch (err) {
      console.error("Sitemap generation failed (publishing without sitemap update).");
    }

    // Commit directly to main (no PR needed)
    const { commitUrl } = await commitToMain({
      token,
      owner: repoOwner,
      repo: repoName,
      branch: baseBranch,
      message: `Add article: ${article.title}`,
      files: filesToCommit,
    });

    // Mark published
    await ctx.runMutation(api.articles.updateStatus, {
      articleId: args.articleId,
      status: "published",
    });

    return { commitUrl, filePath };
  },
});
