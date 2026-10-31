/** A Sources heading in article markdown, at any level. */
export const SOURCES_HEADING = /^#{1,6}\s+(?:sources|references|editorial sources|bibliography|works cited)\s*:?\s*$/i;

/** P264 (Oct 31 2026): a draft that cites [n] keeps its Sources list on every platform. Cowork's judge read a WordPress
 * article whose markers [1]-[4] had no list: the writer left the section out, and a page Pentra doesn't host prints the
 * draft as it is. The list is rebuilt from the article's own sources, in citation order. */
export function withSourcesSection(markdown: string, sources: readonly { url: string; title?: string }[]): string {
  if (!sources.length || markdownHasSourcesSection(markdown) || !/\[\d+(?:\s*,\s*\d+)*\]/.test(markdown)) return markdown;
  const name = (source: { url: string; title?: string }) => {
    const title = source.title?.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
    if (title) return title;
    try { return new URL(source.url).hostname.replace(/^www\./, ""); } catch { return source.url; }
  };
  return `${markdown.trimEnd()}\n\n## Sources\n\n${sources.map((source, index) => `${index + 1}. [${name(source)}](${source.url})`).join("\n")}\n`;
}

/** True when the article body has its own Sources section (outside code), so
 * the page must not append a second one from the article's source list. */
export function markdownHasSourcesSection(markdown: string): boolean {
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (!fenced && SOURCES_HEADING.test(line.trim())) return true;
  }
  return false;
}
