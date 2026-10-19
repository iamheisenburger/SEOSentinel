/** Markdown to HTML for the owner's "Copy HTML" button (pasted into a CMS
 * editor by hand). Nothing in the article may become live markup there: every
 * <, >, & and " is escaped before any Markdown syntax is applied, so a code
 * example such as `<script src="...">` reaches the page as visible code text,
 * and only https or same-site links become anchors. */
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function pasteHtmlFromMarkdown(md: string): string {
  const blocks: string[] = [];
  let html = md.replace(/^[ \t]*```([^\n`]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, (_match, info: string, body: string) => {
    const lang = info.trim().split(/\s+/)[0] ?? "";
    const cls = /^[A-Za-z0-9_+-]+$/.test(lang) ? ` class="language-${lang}"` : "";
    blocks.push(`<pre><code${cls}>${escapeHtml(body.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const spans: string[] = [];
  html = escapeHtml(html).replace(/`([^`\n]+)`/g, (_match, code: string) => {
    spans.push(`<code>${code}</code>`);
    return `\u0001${spans.length - 1}\u0001`;
  });
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) =>
    /^(?:https:\/\/|\/(?!\/)|#)/.test(url) ? `<a href="${url}">${label}</a>` : label);
  html = html.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^---$/gm, "<hr>");
  html = html.split("\n\n").map((block) => {
    const t = block.trim();
    if (!t) return "";
    if (/^<[a-z]/.test(t) || /^\u0000\d+\u0000$/.test(t)) return t;
    return `<p>${t.replace(/\n/g, "<br>")}</p>`;
  }).join("\n\n");
  html = html.replace(/\u0001(\d+)\u0001/g, (_match, i: string) => spans[Number(i)]);
  return html.replace(/\u0000(\d+)\u0000/g, (_match, i: string) => blocks[Number(i)]);
}
