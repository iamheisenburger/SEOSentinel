// Pentra blog (https://pentra.dev): this site's blog settings, labels and styles. Pentra added this file with the blog.
export const SITE = /* pentra:site */ {
  "name": "Example",
  "origin": "https://example.com",
  "path": "/blog",
  "contentDir": "content/blog",
  "repoRoot": ".",
  "language": "en"
} /* pentra:end */;

const LABELS = {
  en: { blog: "Blog", minRead: "min read", sources: "Sources", related: "Related reading", empty: "New articles are on their way." },
  de: { blog: "Blog", minRead: "Min. Lesezeit", sources: "Quellen", related: "Weiterlesen", empty: "Neue Artikel folgen in Kürze." },
  fr: { blog: "Blog", minRead: "min de lecture", sources: "Sources", related: "À lire aussi", empty: "De nouveaux articles arrivent bientôt." },
  es: { blog: "Blog", minRead: "min de lectura", sources: "Fuentes", related: "Lecturas relacionadas", empty: "Pronto habrá nuevos artículos." },
  pt: { blog: "Blog", minRead: "min de leitura", sources: "Fontes", related: "Leia também", empty: "Novos artigos em breve." },
  it: { blog: "Blog", minRead: "min di lettura", sources: "Fonti", related: "Letture correlate", empty: "Nuovi articoli in arrivo." },
  nl: { blog: "Blog", minRead: "min lezen", sources: "Bronnen", related: "Meer lezen", empty: "Binnenkort nieuwe artikelen." },
};
export const LABEL = LABELS[String(SITE.language || "en").slice(0, 2).toLowerCase()] || LABELS.en;

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleDateString(SITE.language || "en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// Plain styles under .pentra-blog only: text and links take the site's own font and colours, so the blog fits light and
// dark sites. Edit freely; Pentra never rewrites this file.
export const CSS = [
  ".pentra-blog{box-sizing:border-box;max-width:740px;margin:0 auto;padding:48px 20px 72px;font-size:17px;line-height:1.7;overflow-wrap:break-word}",
  ".pentra-blog *{box-sizing:border-box}",
  ".pentra-blog h1{font-size:2.2em;line-height:1.15;font-weight:700;letter-spacing:-0.02em;margin:0.2em 0 0.4em}",
  ".pentra-blog .pentra-lede{font-size:1.15em;opacity:0.8;margin:0 0 0.8em}",
  ".pentra-blog .pentra-meta{font-size:0.85em;opacity:0.65;margin:0 0 1.6em}",
  ".pentra-blog .pentra-crumb{font-size:0.9em;margin:0 0 1.2em}",
  ".pentra-blog .pentra-hero{display:block;width:100%;height:auto;border-radius:12px;margin:0 0 2em}",
  ".pentra-blog a{color:inherit;text-decoration:underline;text-underline-offset:2px}",
  ".pentra-blog article h2{font-size:1.55em;line-height:1.25;font-weight:700;margin:2em 0 0.6em}",
  ".pentra-blog article h3{font-size:1.25em;line-height:1.3;font-weight:650;margin:1.6em 0 0.5em}",
  ".pentra-blog article h4,.pentra-blog article h5,.pentra-blog article h6{font-size:1.05em;font-weight:650;margin:1.4em 0 0.4em}",
  ".pentra-blog article p{margin:0 0 1.1em}",
  ".pentra-blog article ul{list-style:disc;padding-left:1.4em;margin:0 0 1.1em}",
  ".pentra-blog article ol{list-style:decimal;padding-left:1.6em;margin:0 0 1.1em}",
  ".pentra-blog article li{margin:0.35em 0}",
  ".pentra-blog article li p{margin:0 0 0.5em}",
  ".pentra-blog article li ul,.pentra-blog article li ol{margin:0.35em 0}",
  ".pentra-blog article li.pentra-task{list-style:none;margin-left:-1.2em}",
  ".pentra-blog article blockquote{margin:1.4em 0;padding:0.2em 0 0.2em 1em;border-left:3px solid rgba(127,127,127,0.4)}",
  ".pentra-blog article img{display:block;max-width:100%;height:auto;border-radius:10px;margin:1.4em 0}",
  ".pentra-blog .pentra-table{overflow-x:auto;margin:1.4em 0}",
  ".pentra-blog table{border-collapse:collapse;width:100%;font-size:0.92em}",
  ".pentra-blog th,.pentra-blog td{border:1px solid rgba(127,127,127,0.3);padding:0.55em 0.75em;text-align:left;vertical-align:top}",
  ".pentra-blog th{font-weight:650;background:rgba(127,127,127,0.08)}",
  ".pentra-blog code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.9em;background:rgba(127,127,127,0.12);padding:0.1em 0.35em;border-radius:4px}",
  ".pentra-blog pre{overflow-x:auto;background:rgba(127,127,127,0.1);padding:1em;border-radius:8px;margin:1.4em 0}",
  ".pentra-blog pre code{background:none;padding:0}",
  ".pentra-blog hr{border:0;border-top:1px solid rgba(127,127,127,0.3);margin:2.2em 0}",
  ".pentra-blog .pentra-video{position:relative;aspect-ratio:16/9;margin:1.6em 0}",
  ".pentra-blog .pentra-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px}",
  ".pentra-blog .pentra-list{list-style:none;padding:0;margin:2em 0 0}",
  ".pentra-blog .pentra-list li{padding:1.3em 0;border-top:1px solid rgba(127,127,127,0.25)}",
  ".pentra-blog .pentra-list h2{font-size:1.3em;line-height:1.3;font-weight:650;margin:0.2em 0 0.35em}",
  ".pentra-blog .pentra-list h2 a{text-decoration:none}",
  ".pentra-blog .pentra-list p{margin:0}",
  ".pentra-blog .pentra-list .pentra-meta{margin:0}",
  ".pentra-blog aside{margin-top:3em;padding-top:1.4em;border-top:1px solid rgba(127,127,127,0.25);font-size:0.92em}",
  ".pentra-blog aside h2{font-size:1em;font-weight:650;margin:0 0 0.6em}",
  ".pentra-blog aside ol,.pentra-blog aside ul{padding-left:1.4em;margin:0}",
  ".pentra-blog aside li{margin:0.3em 0}",
].join("\n");
