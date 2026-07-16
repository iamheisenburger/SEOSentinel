type SiteRecord = Record<string, unknown>;

const SECRET_FIELD_NAMES = [
  "githubToken",
  "wpAppPassword",
  "webhookSecret",
  "gscAccessToken",
  "gscRefreshToken",
  "mediumToken",
  "linkedinAccessToken",
] as const;

type SecretField = (typeof SECRET_FIELD_NAMES)[number];

const SECRET_FIELDS = new Set<string>(SECRET_FIELD_NAMES);

type SiteConnectionFlags = {
  githubConnected: boolean;
  wordpressConfigured: boolean;
  webhookConfigured: boolean;
  webhookSecretConfigured: boolean;
  gscConnected: boolean;
  mediumConnected: boolean;
  linkedinConnected: boolean;
};

export function sanitizeSiteForClient<T extends SiteRecord>(
  site: T,
): Omit<T, SecretField> & SiteConnectionFlags {
  const safe = Object.fromEntries(
    Object.entries(site).filter(([key]) => !SECRET_FIELDS.has(key)),
  ) as Omit<T, SecretField>;

  return {
    ...safe,
    githubConnected: Boolean(site.githubToken),
    wordpressConfigured: Boolean(
      site.wpUrl && site.wpUsername && site.wpAppPassword,
    ),
    webhookConfigured: Boolean(site.webhookUrl),
    webhookSecretConfigured: Boolean(site.webhookSecret),
    gscConnected: Boolean(site.gscAccessToken && site.gscProperty),
    mediumConnected: Boolean(site.mediumToken),
    linkedinConnected: Boolean(site.linkedinAccessToken),
  };
}
