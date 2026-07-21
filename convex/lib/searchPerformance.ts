export function normalizeSearchConsolePage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`,
    );
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

export function isSameSearchConsolePage(candidate: string, target: string): boolean {
  return normalizeSearchConsolePage(candidate) === normalizeSearchConsolePage(target);
}

export function publishedArticlePageUrl(
  domain: string,
  urlStructure: string | undefined,
  slug: string,
): string {
  const rawDomain = domain.trim().replace(/\/+$/, "");
  const origin = new URL(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(rawDomain)
      ? rawDomain
      : `https://${rawDomain}`,
  ).origin;
  const template = urlStructure?.trim() || "/blog/[slug]";
  const placeholderCount = template.match(/\[slug\]/gi)?.length ?? 0;
  if (!template.startsWith("/") || placeholderCount !== 1) {
    throw new Error("Article URL structure must contain one [slug] path segment");
  }
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, "");
  if (!cleanSlug) throw new Error("Article slug is required");
  return `${origin}${template.replace(/\[slug\]/i, cleanSlug)}`;
}
