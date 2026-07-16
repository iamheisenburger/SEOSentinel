function normalizeHeading(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

/**
 * GitHub-backed sites normally render the article title from front matter.
 * Remove a matching leading H1 from the Markdown body so readers and search
 * engines see one document title rather than a duplicated heading.
 */
export function stripLeadingDocumentTitle(
  markdown: string,
  title: string,
): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine === -1) return "";

  const match = lines[firstContentLine].match(/^\s*#\s+(.+?)\s*#*\s*$/);
  if (!match || normalizeHeading(match[1]) !== normalizeHeading(title)) {
    return markdown.trim();
  }

  lines.splice(firstContentLine, 1);
  while (
    firstContentLine < lines.length &&
    lines[firstContentLine].trim().length === 0
  ) {
    lines.splice(firstContentLine, 1);
  }
  return lines.join("\n").trim();
}
