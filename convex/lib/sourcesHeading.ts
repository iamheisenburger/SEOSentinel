/** A Sources heading in article markdown, at any level. */
export const SOURCES_HEADING = /^#{1,6}\s+(?:sources|references|editorial sources|bibliography|works cited)\s*:?\s*$/i;

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
