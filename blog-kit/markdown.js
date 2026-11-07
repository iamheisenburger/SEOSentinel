// Pentra blog (https://pentra.dev): turns an article's Markdown into HTML. Pentra added this file with the blog.
// It needs no packages. Raw HTML in an article is never passed through: only a YouTube embed and a few inline tags
// (line breaks, superscript, subscript) are kept, and links may only point to web pages, email addresses or this site.

const BLOCK_HTML = /^ {0,3}(?:<!--|<\/?(?:address|article|aside|blockquote|center|details|div|dl|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|img|li|main|nav|ol|p|pre|script|section|style|summary|table|tbody|td|tfoot|th|thead|tr|ul|video)\b)/i;
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*$)/;
const TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/;
const YOUTUBE = /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/;

const blank = (line) => /^\s*$/.test(line);
const indentOf = (line) => line.match(/^ */)[0].length;
const escapeText = (text) => text.replace(/&(?!#?[A-Za-z0-9]+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeAll = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = (html) => html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function startsBlock(line) {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || BLOCK_HTML.test(line) ||
    (ITEM.test(line) && Boolean(ITEM.exec(line)[3]));
}

function safeUrl(raw, image) {
  const url = raw.trim().replace(/^<|>$/g, "");
  if (!url || /[\s"<>]/.test(url)) return null;
  if (url.startsWith("#") || (url.startsWith("/") && !url.startsWith("//"))) return image ? null : url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
    if (!image && parsed.protocol === "mailto:") return url;
  } catch {
    return null;
  }
  return null;
}

/** Markdown to HTML. `origin` is this site's own address: links elsewhere open in a new tab. */
export function renderMarkdown(markdown, origin = "") {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const refs = new Map();
  const kept = [];
  let fenced = null;
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fenced) { if (fence && fence[2][0] === fenced[0] && fence[2].length >= fenced.length) fenced = null; kept.push(line); continue; }
    if (fence) { fenced = fence[2]; kept.push(line); continue; }
    const def = DEFINITION.exec(line);
    if (def) { refs.set(def[1].trim().toLowerCase(), { url: def[2], title: def[3] ?? def[4] ?? def[5] ?? "" }); continue; }
    kept.push(line);
  }
  const ids = new Map();
  const slug = (html) => {
    const base = decode(html).toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
    const seen = ids.get(base) ?? 0;
    ids.set(base, seen + 1);
    return seen ? `${base}-${seen}` : base;
  };
  const host = (() => { try { return new URL(origin).host; } catch { return ""; } })();

  function anchor(url, inner, title) {
    let external = false;
    try { external = /^https?:/i.test(url) && new URL(url).host !== host; } catch { external = false; }
    return `<a href="${escapeAll(url)}"${title ? ` title="${escapeAll(title)}"` : ""}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inner}</a>`;
  }

  function inline(source) {
    const slots = [];
    const keep = (html) => `\u0001${slots.push(html) - 1}\u0002`;
    const LINK_TEXT = String.raw`\[((?:[^\[\]\\]|\\.|\[(?:[^\[\]\\]|\\.)*\])*)\]`;
    const DEST = String.raw`\(\s*(<[^>\n]*>|(?:[^\s()]|\((?:[^\s()])*\))*)(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)`;
    function pass(text) {
      let s = text.replace(/<!--[\s\S]*?-->/g, "");
      s = s.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_, ticks, code) => keep(`<code>${escapeAll(code.replace(/^ ([\s\S]*[^ ]) $/, "$1"))}</code>`));
      s = s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_, c) => keep(escapeAll(c)));
      s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi, (_, url) => { const safe = safeUrl(url, false); return safe ? keep(anchor(safe, escapeAll(url))) : _; });
      s = s.replace(/<(\/?)(br|sup|sub)\s*\/?>/gi, (_, close, tag) => keep(`<${close}${tag.toLowerCase()}>`));
      // Any other tag is dropped and its text kept: no attribute or element from an article reaches the page.
      s = s.replace(/<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/g, "");
      s = s.replace(new RegExp(`!${LINK_TEXT}${DEST}`, "g"), (_, alt, url, t1, t2) => {
        const safe = safeUrl(url, true);
        const altText = escapeAll(decode(alt.replace(/\\(.)/g, "$1")));
        return safe ? keep(`<img src="${escapeAll(safe)}" alt="${altText}" loading="lazy" decoding="async"${t1 ?? t2 ? ` title="${escapeAll(t1 ?? t2)}"` : ""}>`) : keep(altText);
      });
      s = s.replace(new RegExp(`${LINK_TEXT}${DEST}`, "g"), (whole, label, url, t1, t2) => {
        const safe = safeUrl(url, false);
        return safe ? keep(anchor(safe, finish(pass(label)), t1 ?? t2)) : keep(finish(pass(label)));
      });
      s = s.replace(new RegExp(`${LINK_TEXT}(?:\\[([^\\]]*)\\])?`, "g"), (whole, label, ref) => {
        const key = (ref || label).trim().toLowerCase();
        const target = refs.get(key);
        if (!target || ref === undefined && /^\^/.test(label)) return whole;
        const safe = safeUrl(target.url, false);
        return safe ? keep(anchor(safe, finish(pass(label)), target.title)) : whole;
      });
      s = s.replace(/(^|[\s(*_~])((?:https?:\/\/|www\.)[^\s<\u0001]*[^\s<\u0001?!.,:;*_~"')\]])/g, (_, before, url) => {
        const safe = safeUrl(url.startsWith("www.") ? `https://${url}` : url, false);
        return before + (safe ? keep(anchor(safe, escapeAll(url))) : url);
      });
      s = s.replace(/(^|[\s(])([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?=$|[\s),;:!?]|\.(?:\s|$))/g,
        (_, before, email) => before + keep(anchor(`mailto:${email}`, escapeAll(email))));
      s = escapeText(s);
      s = s.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, "$1<strong>$2</strong>")
        .replace(/(^|[^*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/g, "$1<em>$2</em>")
        .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>")
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
        .replace(/(?: {2,}|\\)\n/g, "<br>\n");
      return s;
    }
    function finish(s) {
      let out = s;
      for (let i = 0; i < 8 && /\u0001\d+\u0002/.test(out); i++) out = out.replace(/\u0001(\d+)\u0002/g, (_, n) => slots[Number(n)] ?? "");
      return out;
    }
    return finish(pass(source));
  }

  function cells(row) {
    const trimmed = row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
    const parts = [];
    let current = "", code = false;
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c === "\\" && trimmed[i + 1] === "|") { current += "|"; i++; continue; }
      if (c === "`") code = !code;
      if (c === "|" && !code) { parts.push(current.trim()); current = ""; continue; }
      current += c;
    }
    parts.push(current.trim());
    return parts;
  }

  function htmlBlock(block) {
    const images = [...block.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)].map((m) => {
      const src = safeUrl(m[1], true);
      const alt = /\balt=["']([^"']*)["']/i.exec(m[0]);
      return src ? `<img src="${escapeAll(src)}" alt="${escapeAll(alt ? alt[1] : "")}" loading="lazy" decoding="async">` : "";
    }).filter(Boolean);
    const video = YOUTUBE.exec(block);
    if (video) {
      return `<div class="pentra-video"><iframe src="https://www.youtube-nocookie.com/embed/${video[1]}" title="Video" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    const text = block.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").trim();
    return images.join("\n") + (text ? `<p>${inline(text)}</p>` : "");
  }

  function list(src, start) {
    const first = ITEM.exec(src[start]);
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const item = (line) => { const m = ITEM.exec(line); return m && !HR.test(line) ? m : null; };
    const sameType = (m) => /\d/.test(m[2]) === ordered;
    // A line belongs to the current item when it is indented to the item's text (a nested list or paragraph), or when it
    // is a list of the other kind indented under the item ("1. Step" then "  - detail"): writers mean it nested.
    const inside = (line, contentIndent) => {
      const indent = indentOf(line), m = item(line);
      return indent >= contentIndent || Boolean(m && indent > base && !sameType(m));
    };
    const items = [];
    let loose = false, i = start;
    while (i < src.length) {
      const m = item(src[i]);
      if (!m || !sameType(m) || m[1].length < base || m[1].length > base + 3) break;
      const contentIndent = m[1].length + m[2].length + 1;
      const body = [m[3] ?? ""];
      i++;
      while (i < src.length) {
        const line = src[i];
        if (blank(line)) {
          let j = i + 1;
          while (j < src.length && blank(src[j])) j++;
          if (j < src.length && inside(src[j], contentIndent)) { while (i < j) { body.push(""); i++; } loose = true; continue; }
          const next = j < src.length ? item(src[j]) : null;
          if (next && sameType(next) && next[1].length >= base && next[1].length <= base + 3) { loose = true; i = j; }
          break;
        }
        if (inside(line, contentIndent)) { body.push(line.slice(Math.min(indentOf(line), contentIndent))); i++; continue; }
        if (item(line) || startsBlock(line)) break;
        body.push(line.trim());
        i++;
      }
      items.push(body);
      if (i < src.length && blank(src[i])) break;
    }
    const startAttr = ordered && parseInt(first[2], 10) !== 1 ? ` start="${parseInt(first[2], 10)}"` : "";
    const tag = ordered ? "ol" : "ul";
    const html = items.map((body) => {
      const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
      if (task) body[0] = body[0].slice(task[0].length);
      const inner = blocks(body, !loose).trim();
      const box = task ? `<input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> ` : "";
      return `<li${task ? ' class="pentra-task"' : ""}>${box}${inner}</li>`;
    }).join("\n");
    return { html: `<${tag}${startAttr}>\n${html}\n</${tag}>`, next: i };
  }

  function blocks(src, tight) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const line = src[i];
      if (blank(line)) { i++; continue; }
      const fence = FENCE.exec(line);
      if (fence) {
        const code = [];
        i++;
        while (i < src.length) {
          const close = FENCE.exec(src[i]);
          if (close && close[2][0] === fence[2][0] && close[2].length >= fence[2].length && !close[3]) { i++; break; }
          code.push(src[i].slice(Math.min(indentOf(src[i]), fence[1].length)));
          i++;
        }
        const language = fence[3] ? ` class="language-${escapeAll(fence[3])}"` : "";
        out.push(`<pre><code${language}>${escapeAll(code.join("\n"))}</code></pre>`);
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        const level = Math.max(2, heading[1].length);
        const html = inline(heading[2] ?? "");
        out.push(`<h${level} id="${escapeAll(slug(html))}">${html}</h${level}>`);
        i++;
        continue;
      }
      if (HR.test(line)) { out.push("<hr>"); i++; continue; }
      if (QUOTE.test(line)) {
        const inner = [];
        while (i < src.length && !blank(src[i]) && (QUOTE.test(src[i]) || (inner.length && !startsBlock(src[i])))) {
          inner.push(src[i].replace(QUOTE, ""));
          i++;
        }
        out.push(`<blockquote>\n${blocks(inner, false)}\n</blockquote>`);
        continue;
      }
      if (ITEM.test(line)) {
        const result = list(src, i);
        out.push(result.html);
        i = result.next;
        continue;
      }
      if (BLOCK_HTML.test(line)) {
        const block = [];
        while (i < src.length && !blank(src[i])) { block.push(src[i]); i++; }
        const html = htmlBlock(block.join("\n"));
        if (html) out.push(html);
        continue;
      }
      if (line.includes("|") && i + 1 < src.length && TABLE_SEP.test(src[i + 1]) && /[|]/.test(src[i + 1] + line)) {
        const head = cells(line);
        const align = cells(src[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : /^:-+/.test(c) ? "left" : ""));
        const rows = [];
        i += 2;
        while (i < src.length && !blank(src[i]) && src[i].includes("|") && !startsBlock(src[i])) { rows.push(cells(src[i])); i++; }
        const cell = (tagName, text, n) => `<${tagName}${align[n] ? ` style="text-align:${align[n]}"` : ""}>${inline(text ?? "")}</${tagName}>`;
        out.push(`<div class="pentra-table"><table>\n<thead><tr>${head.map((c, n) => cell("th", c, n)).join("")}</tr></thead>\n<tbody>\n${rows
          .map((r) => `<tr>${head.map((_, n) => cell("td", r[n], n)).join("")}</tr>`).join("\n")}\n</tbody>\n</table></div>`);
        continue;
      }
      const para = [line.replace(/^ +/, "")];
      i++;
      let setext = 0;
      while (i < src.length && !blank(src[i])) {
        const s = SETEXT.exec(src[i]);
        if (s && para.length) { setext = 2; i++; break; }
        if (startsBlock(src[i]) || (src[i].includes("|") && i + 1 < src.length && TABLE_SEP.test(src[i + 1]))) break;
        para.push(src[i].replace(/^ +/, ""));
        i++;
      }
      const html = inline(para.join("\n").replace(/[ \t]+$/, ""));
      if (setext) out.push(`<h${setext} id="${escapeAll(slug(html))}">${html}</h${setext}>`);
      else out.push(tight ? html : `<p>${html}</p>`);
    }
    return out.join("\n");
  }

  return blocks(kept, false);
}
