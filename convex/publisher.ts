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

async function createPR({
  token,
  owner,
  repo,
  base,
  title,
  body,
  files,
}: {
  token: string;
  owner: string;
  repo: string;
  base: string;
  title: string;
  body: string;
  files: FileContent[];
}) {
  const slug = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const branch = `seo-auto/${slug}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // Get base SHA
  const baseRefRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${base}`,
    { headers },
  );
  if (!baseRefRes.ok) {
    throw new Error(`Failed to get base ref: ${baseRefRes.statusText}`);
  }
  const baseRef = await baseRefRes.json();
  const baseSha = baseRef.object.sha;

  // Create branch
  const createRefRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: baseSha,
      }),
    },
  );
  if (!createRefRes.ok) {
    throw new Error(`Failed to create branch: ${baseRefRes.statusText}`);
  }

  // Get blob SHAs
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
        message: title,
        tree: tree.sha,
        parents: [baseSha],
      }),
    },
  );
  if (!commitRes.ok) {
    throw new Error(`Failed to create commit: ${commitRes.statusText}`);
  }
  const commit = await commitRes.json();

  // Update branch ref
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

  // Open PR
  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        title,
        head: branch,
        base,
        body,
      }),
    },
  );
  if (!prRes.ok) {
    throw new Error(`Failed to open PR: ${prRes.statusText}`);
  }
  const pr = await prRes.json();
  return pr.html_url as string;
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
  ): Promise<{ prUrl: string; filePath: string }> => {
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

    const mdx = `${frontmatter}\n\n${article.markdown}`;

    const prUrl = await createPR({
      token,
      owner: repoOwner,
      repo: repoName,
      base: baseBranch,
      title: `Add article: ${article.title}`,
      body: `Auto-generated article for ${site.domain}`,
      files: [{ path: filePath, content: mdx }],
    });

    // Mark published
    await ctx.runMutation(api.articles.updateStatus, {
      articleId: args.articleId,
      status: "published",
    });

    return { prUrl, filePath };
  },
});

