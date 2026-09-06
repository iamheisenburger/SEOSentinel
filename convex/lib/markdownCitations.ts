import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

type Node = {
  type: string;
  identifier?: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
type Edit = { start: number; end: number; replacement: string; inline: boolean };
const protectedNodes = new Set(["code", "inlineCode", "html", "image", "imageReference", "footnoteDefinition"]);
// No parser initialization at module load: metadata-only queries import
// article utilities too, and must not initialize the editorial toolchain.
function parseMarkdown(markdown: string): Node {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown) as Node;
}

export type CitationMarker = { start: number; end: number; numbers: number[] };

/** Citation detection and removal must agree about code and link boundaries. */
export function markdownCitationMarkers(markdown: string): CitationMarker[] {
  if (!markdown.includes("[")) return [];
  const markers: CitationMarker[] = [];
  const numbers = (value: string) => value.split(",").map(part => Number(part.trim()))
    .filter(value => Number.isInteger(value) && value > 0);
  const numeric = (value: string) => /^\d+(?:\s*,\s*\d+)*$/.test(value);
  const text = (node: Node): string => node.value ?? (node.children ?? []).map(text).join("");
  const visit = (node: Node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || protectedNodes.has(node.type) || node.type === "definition") return;
    if (node.type === "link" || node.type === "linkReference") {
      const label = node.type === "linkReference" ? node.identifier ?? "" : text(node);
      if (numeric(label)) markers.push({ start, end, numbers: numbers(label) });
      return;
    }
    if (node.type === "text") {
      const raw = markdown.slice(start, end);
      for (const match of raw.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
        if (((raw.slice(0, match.index).match(/\\+$/)?.[0].length ?? 0) % 2) === 1) continue;
        markers.push({ start: start + match.index, end: start + match.index + match[0].length, numbers: numbers(match[1]) });
      }
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parseMarkdown(markdown));
  return markers;
}

/** Remove unbound citation slots without rewriting unrelated Markdown. */
export function removeUnverifiedMarkdownCitations(markdown: string, sourceCount: number): string {
  const maximum = Number.isFinite(sourceCount) ? Math.max(0, Math.floor(sourceCount)) : 0;
  const verified = (raw: string) => raw.split(",").map(value => Number(value.trim()))
    .filter((value, index, values) => Number.isInteger(value) && value >= 1 &&
      value <= maximum && values.indexOf(value) === index);
  const numeric = (value: string) => /^\d+(?:\s*,\s*\d+)*$/.test(value);
  const boundSlot = (value: string) => /^\d+$/.test(value) && verified(value).length === 1;
  const tree = parseMarkdown(markdown);
  const edits: Edit[] = [];
  const text = (node: Node): string => node.value ?? (node.children ?? []).map(text).join("");
  const visit = (node: Node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "definition") {
      // Deleting just [9] from [9]: URL creates a visible, orphaned ': URL'.
      if (numeric(node.identifier ?? "") && !boundSlot(node.identifier!)) {
        edits.push({ start, end, replacement: "", inline: false });
      }
      return;
    }
    if (protectedNodes.has(node.type)) return;
    if (node.type === "linkReference" && numeric(node.identifier ?? "") && !boundSlot(node.identifier!)) {
      // Retain an ordinary reference link's label, but never retain a numeric
      // citation or an unbound destination disguised as reference metadata.
      const retained = verified(node.identifier!);
      const replacement = numeric(text(node)) ? (retained.length ? `[${retained.join(", ")}]` : "") : (node.children ?? [])
        .map(child => markdown.slice(child.position?.start.offset, child.position?.end.offset)).join("");
      edits.push({ start, end, replacement, inline: true });
      return;
    }
    if (node.type === "link") {
      const label = text(node);
      if (numeric(label) && !boundSlot(label)) {
        const retained = verified(label);
        edits.push({ start, end, replacement: retained.length ? `[${retained.join(", ")}]` : "", inline: true });
      }
      return;
    }
    if (node.type === "linkReference") return;
    if (node.type === "text") {
      const raw = markdown.slice(start, end);
      for (const match of raw.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
        const before = raw.slice(0, match.index);
        // An escaped literal is not a citation, including inside a code guide.
        if (((before.match(/\\+$/)?.[0].length ?? 0) % 2) === 1) continue;
        const retained = verified(match[1]);
        const replacement = retained.length ? `[${retained.join(", ")}]` : "";
        if (replacement !== match[0]) edits.push({ start: start + match.index,
          end: start + match.index + match[0].length, replacement, inline: true });
      }
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  let result = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    let { start, end } = edit;
    if (edit.inline && edit.replacement === "") {
      const leftSpace = result.slice(0, start).match(/[ \t]+$/)?.[0] ?? "";
      const rightSpace = result.slice(end).match(/^[ \t]+/)?.[0] ?? "";
      if (/^[,.;:!?]/.test(result.slice(end + rightSpace.length))) {
        start -= leftSpace.length;
        end += rightSpace.length;
      } else if (rightSpace && (leftSpace || start === 0 || result[start - 1] === "\n")) {
        end += rightSpace.length;
      }
    }
    result = result.slice(0, start) + edit.replacement + result.slice(end);
  }
  return result;
}
