/** Small pure helpers for the setup and connection screens. */

const PACES = [1, 2, 4, 7, 14, 21];

/** Paces the plan can keep up: none that would use the month's articles in its
 * first days (a free plan's 3 a month was offered up to 21 a week in the first
 * outside new-user run, Oct 21 2026). The current pace always stays listed;
 * the monthly allowance still caps whatever is chosen. */
export function pacesFor(articlesPerMonth: number | null, current: number | null): number[] {
  const most = articlesPerMonth ? Math.max(1, Math.ceil(articlesPerMonth * 7 / 31)) : Infinity;
  return [...new Set([...PACES.filter(n => n <= most), ...(current ? [current] : [])])].sort((a, b) => a - b);
}

/** Where Pentra's GitHub publisher commits articles: the URL structure's
 * folders under content/ (convex/lib/publicationArtifact.ts), content/posts
 * when the structure has none. */
export function githubContentFolder(urlStructure?: string): string {
  const folders = (urlStructure || "/blog/[slug]").split("/").filter(part => part && part !== "[slug]");
  return folders.length ? `content/${folders.join("/")}` : "content/posts";
}
