import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type InternalLink = {
  anchor: string;
  href: string;
};

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

type TextCandidate = {
  start: number;
  end: number;
  containerStart: number;
};

const GENERIC_ANCHORS = new Set([
  "blog",
  "click here",
  "faq",
  "features",
  "get started",
  "here",
  "home",
  "how it works",
  "learn more",
  "pricing",
  "read more",
  "sign up",
]);

const BLOCKED_NODE_TYPES = new Set([
  "code",
  "definition",
  "footnoteDefinition",
  "heading",
  "html",
  "image",
  "imageReference",
  "inlineCode",
  "link",
  "linkReference",
  "table",
  "tableCell",
  "tableRow",
  "yaml",
]);

function normalizeInternalHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (/\s|\\|\.\./.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed, "https://internal.invalid");
    if (parsed.origin !== "https://internal.invalid") return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function normalizeAnchor(value: string): string | null {
  const anchor = value.trim().replace(/\s+/g, " ");
  const words = anchor.split(" ").filter(Boolean);
  if (anchor.length < 5 || anchor.length > 80) return null;
  if (words.length < 2 || words.length > 8) return null;
  if (GENERIC_ANCHORS.has(anchor.toLowerCase())) return null;
  if (/[\[\](){}<>\n\r]/.test(anchor)) return null;
  return anchor;
}

export function validateInternalLinkSuggestions(
  suggestions: InternalLink[],
  allowedHrefs: string[],
  selfHref: string,
): InternalLink[] {
  const allowed = new Set(
    allowedHrefs
      .map(normalizeInternalHref)
      .filter((href): href is string => href !== null),
  );
  const normalizedSelf = normalizeInternalHref(selfHref);
  const seenAnchors = new Set<string>();
  const seenHrefs = new Set<string>();
  const validated: InternalLink[] = [];

  for (const suggestion of suggestions) {
    const anchor = normalizeAnchor(suggestion.anchor);
    const href = normalizeInternalHref(suggestion.href);
    if (!anchor || !href || !allowed.has(href) || href === normalizedSelf) continue;

    const anchorKey = anchor.toLowerCase();
    if (seenAnchors.has(anchorKey) || seenHrefs.has(href)) continue;
    seenAnchors.add(anchorKey);
    seenHrefs.add(href);
    validated.push({ anchor, href });
  }

  return validated;
}

function nodeText(node: MarkdownNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(nodeText).join("");
}

function collectExistingHrefs(node: MarkdownNode, hrefs: Set<string>): void {
  if (node.type === "link" && node.url) hrefs.add(node.url);
  for (const child of node.children ?? []) collectExistingHrefs(child, hrefs);
}

function collectTextCandidates(
  node: MarkdownNode,
  candidates: TextCandidate[],
  containerStart?: number,
): void {
  if (BLOCKED_NODE_TYPES.has(node.type)) return;

  const ownStart = node.position?.start.offset;
  const nextContainerStart =
    node.type === "paragraph" && ownStart !== undefined
      ? ownStart
      : containerStart;

  if (node.type === "text") {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined && start < end) {
      candidates.push({
        start,
        end,
        containerStart: nextContainerStart ?? start,
      });
    }
    return;
  }

  for (const child of node.children ?? []) {
    collectTextCandidates(child, candidates, nextContainerStart);
  }
}

function anchorPattern(anchor: string): RegExp {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    "iu",
  );
}

export function injectInternalLinks(
  markdown: string,
  links: InternalLink[],
): { markdown: string; inserted: InternalLink[] } {
  if (!markdown.trim() || links.length === 0) {
    return { markdown, inserted: [] };
  }

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown) as MarkdownNode;
  const existingHrefs = new Set<string>();
  collectExistingHrefs(tree, existingHrefs);

  const candidates: TextCandidate[] = [];
  let skipTableOfContents = false;
  let reachedSources = false;

  for (const child of tree.children ?? []) {
    if (child.type === "heading") {
      const heading = nodeText(child).trim().toLowerCase();
      skipTableOfContents = heading === "table of contents";
      if (heading === "sources" || heading === "references") reachedSources = true;
      continue;
    }
    if (!skipTableOfContents && !reachedSources) {
      collectTextCandidates(child, candidates);
    }
  }

  const usedContainers = new Set<number>();
  const insertions: Array<{
    start: number;
    end: number;
    replacement: string;
    link: InternalLink;
  }> = [];

  for (const link of links) {
    if (existingHrefs.has(link.href)) continue;
    const pattern = anchorPattern(link.anchor);

    for (const candidate of candidates) {
      if (usedContainers.has(candidate.containerStart)) continue;
      const sourceText = markdown.slice(candidate.start, candidate.end);
      const match = pattern.exec(sourceText);
      if (!match || match.index === undefined) continue;

      const start = candidate.start + match.index;
      const matchedText = match[0];
      insertions.push({
        start,
        end: start + matchedText.length,
        replacement: `[${matchedText}](${link.href})`,
        link: { anchor: matchedText, href: link.href },
      });
      usedContainers.add(candidate.containerStart);
      existingHrefs.add(link.href);
      break;
    }
  }

  let updated = markdown;
  for (const insertion of [...insertions].sort((a, b) => b.start - a.start)) {
    updated =
      updated.slice(0, insertion.start) +
      insertion.replacement +
      updated.slice(insertion.end);
  }

  return {
    markdown: updated,
    inserted: insertions.map((insertion) => insertion.link),
  };
}
