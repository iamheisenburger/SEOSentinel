"use node";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { containsExecutableMdx } from "./articleQuality.ts";
export { PUBLISHER_RENDERER_VERSION } from "./publicationReceipts.ts";

export function assertSafePublishableMarkdown(markdown: string): void {
  if (containsExecutableMdx(markdown)) {
    throw new Error("Raw HTML and executable MDX are disabled in publication content");
  }
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    let url: URL;
    try {
      url = new URL(match[1]);
    } catch {
      throw new Error("Article images must use absolute HTTPS URLs");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Article images must use absolute HTTPS URLs");
    }
  }
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1];
    if (target.startsWith("/") && !target.startsWith("//")) continue;
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new Error("Article links must be relative paths or absolute HTTPS URLs");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Article links must be relative paths or absolute HTTPS URLs");
    }
  }
}

/**
 * Render publication Markdown into portable semantic HTML. No CSS, scripts,
 * event handlers, forms, embeds, protocol-relative resources, or raw HTML are
 * allowed. Customer branding remains a presentation concern for the target
 * CMS and therefore cannot become an HTML/CSS injection channel.
 */
export function renderSafePublicationHtml(markdown: string): string {
  assertSafePublishableMarkdown(markdown);
  const schema = {
    ...defaultSchema,
    tagNames: [
      "p", "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "em", "ul", "ol", "li", "blockquote", "code", "pre",
      "a", "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "br",
    ],
    attributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title"],
      th: ["align"],
      td: ["align"],
    },
    protocols: {
      href: ["https"],
      src: ["https"],
    },
  };
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSanitize, schema)
      .use(rehypeStringify)
      .processSync(markdown),
  )
    .replace(/<a /g, '<a rel="nofollow noopener noreferrer" ')
    .trim();
}
