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
    // A token alone is not a publication-ready connection. The repository's
    // actual default branch must have been discovered through the trusted
    // GitHub connection flow and persisted with it.
    githubConnected: Boolean(site.githubToken && site.repoDefaultBranch),
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
