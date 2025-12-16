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

    // Commit directly to main (no PR needed)
    const { commitUrl } = await commitToMain({
      token,
      owner: repoOwner,
      repo: repoName,
      branch: baseBranch,
      message: `Add article: ${article.title}`,
      files: [{ path: filePath, content: mdx }],
    });

    // Mark published
    await ctx.runMutation(api.articles.updateStatus, {
      articleId: args.articleId,
      status: "published",
    });

    return { commitUrl, filePath };
  },
});
