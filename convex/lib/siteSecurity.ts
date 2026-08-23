type SiteRecord = Record<string, unknown>;

const SECRET_FIELD_NAMES = [
  "githubToken",
  "wpAppPassword",
  "webhookSecret",
  "gscAccessToken",
  "gscRefreshToken",
  "mediumToken",
  "linkedinAccessToken",
  "publicationAdapterConfigHash",
] as const;

type SecretField = (typeof SECRET_FIELD_NAMES)[number];

const SECRET_FIELDS = new Set<string>(SECRET_FIELD_NAMES);

type SiteConnectionFlags = {
  githubConnected: boolean;
  wordpressConfigured: boolean;
  webhookConfigured: boolean;
  webhookSecretConfigured: boolean;
  gscConnected: boolean;
  gscGrowthEnabled: boolean;
  mediumConnected: boolean;
  linkedinConnected: boolean;
  publicationAdapterVerified: boolean;
  planAccessStatus: "active" | "parked";
  planAccessReason?: string;
  domainAccessStatus: "active" | "blocked";
  domainAccessReason?: string;
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
    gscGrowthEnabled: Boolean(
      typeof site.gscScopes === "string" &&
      site.gscScopes
        .split(/\s+/)
        .includes("https://www.googleapis.com/auth/webmasters"),
    ),
    mediumConnected: Boolean(site.mediumToken),
    linkedinConnected: Boolean(site.linkedinAccessToken),
    publicationAdapterVerified: Boolean(
      site.publicationAdapterVerifiedAt && site.publicationAdapterVersion,
    ),
    planAccessStatus: site.planParkedAt ? "parked" : "active",
    planAccessReason: site.planParkedAt
      ? "This site is parked because it is outside your current plan's site allowance. Its data and integrations are preserved. Upgrade or remove an active site to reactivate the next eligible site."
      : undefined,
    domainAccessStatus: site.domainOwnershipConflictAt
      ? "blocked"
      : "active",
    domainAccessReason: site.domainOwnershipConflictAt
      ? "This hostname is connected to more than one tenant record. Automation is paused to protect tenant isolation; contact support to resolve ownership."
      : undefined,
  };
}
