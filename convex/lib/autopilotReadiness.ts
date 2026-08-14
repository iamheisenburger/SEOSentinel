import { requiredMonthlyArticlesForCadence } from "../planLimits.ts";
import { publicationAdapterConfigHash } from "./publicationArtifact.ts";
import { PUBLICATION_ADAPTER_VERSION } from "./publicationReceipts.ts";

export type AutopilotReadinessSite = {
  autopilotEnabled?: boolean;
  approvalRequired?: boolean;
  cadencePerWeek?: number;
  domain?: string;
  niche?: string;
  siteSummary?: string;
  blogTheme?: string;
  publishMethod?: string;
  repoOwner?: string;
  repoName?: string;
  repoDefaultBranch?: string;
  githubToken?: string;
  wpUrl?: string;
  wpUsername?: string;
  wpAppPassword?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  publicationAdapterVerifiedAt?: number;
  publicationAdapterVersion?: string;
  publicationAdapterConfigHash?: string;
  gscAccessToken?: string;
  gscProperty?: string;
};

export type AutopilotReadiness = {
  ready: boolean;
  blockers: string[];
};

const BLOCKER_COPY: Record<string, string> = {
  autopilot_disabled: "Turn on Autopilot",
  domain_missing: "add the website domain",
  business_profile_missing: "complete the business profile",
  content_strategy_missing: "complete the content strategy",
  site_crawl_missing: "finish the first website crawl",
  cadence_invalid: "choose a positive cadence no higher than 21 articles per week",
  manual_publication_selected: "connect an automatic publishing destination",
  github_repository_missing: "choose the GitHub repository",
  github_token_missing: "reconnect GitHub",
  github_default_branch_unverified:
    "reconnect GitHub so Pentra can verify the repository's default branch",
  wordpress_connection_incomplete: "complete the WordPress connection",
  webhook_url_missing: "add the publishing webhook URL",
  webhook_secret_missing: "add the publishing webhook secret",
  publication_adapter_unverified:
    "verify this publishing connection before unattended delivery",
  unsupported_publication_method: "choose a supported publishing method",
  manual_approval_requested: "turn off manual approval for hands-off publishing",
  search_console_not_connected: "connect Google Search Console",
  subscription_capacity_below_cadence:
    "lower the cadence or upgrade to a plan with enough monthly articles",
  sealed_buffer_incomplete: "let Pentra finish the strict-quality article buffer",
};

export function describeAutopilotBlockers(blockers: string[]): string {
  return blockers.map((blocker) => BLOCKER_COPY[blocker] ?? blocker).join("; ");
}

/**
 * A calendar-month quota must survive the longest month to make a weekly
 * cadence an honest unattended promise. Shorter months merely leave spare
 * capacity; they never cause an avoidable mid-month stall.
 */
export { requiredMonthlyArticlesForCadence } from "../planLimits.ts";

function configured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function publicationDestinationBlockers(
  site: AutopilotReadinessSite,
): string[] {
  const method = site.publishMethod ?? "github";
  if (method === "manual") return ["manual_publication_selected"];
  if (method === "github") {
    const blockers: string[] = [];
    if (!configured(site.repoOwner) || !configured(site.repoName)) {
      blockers.push("github_repository_missing");
    }
    if (!configured(site.githubToken)) blockers.push("github_token_missing");
    if (!configured(site.repoDefaultBranch)) {
      blockers.push("github_default_branch_unverified");
    }
    return blockers;
  }
  if (method === "wordpress") {
    const configuredForWordPress = configured(site.wpUrl) &&
        configured(site.wpUsername) &&
        configured(site.wpAppPassword);
    if (!configuredForWordPress) return ["wordpress_connection_incomplete"];
    const expectedConfigHash = publicationAdapterConfigHash(site);
    return site.publicationAdapterVersion === PUBLICATION_ADAPTER_VERSION &&
      site.publicationAdapterConfigHash === expectedConfigHash &&
      (site.publicationAdapterVerifiedAt ?? 0) > 0
      ? []
      : ["publication_adapter_unverified"];
  }
  if (method === "webhook") {
    const blockers: string[] = [];
    if (!configured(site.webhookUrl)) blockers.push("webhook_url_missing");
    if (!configured(site.webhookSecret)) {
      blockers.push("webhook_secret_missing");
    }
    if (blockers.length === 0) {
      const expectedConfigHash = publicationAdapterConfigHash(site);
      if (
        site.publicationAdapterVersion !== PUBLICATION_ADAPTER_VERSION ||
        site.publicationAdapterConfigHash !== expectedConfigHash ||
        (site.publicationAdapterVerifiedAt ?? 0) <= 0
      ) {
        blockers.push("publication_adapter_unverified");
      }
    }
    return blockers;
  }
  return ["unsupported_publication_method"];
}

/** Readiness for paid generation and a sealed warm buffer. */
export function warmAutopilotReadiness(
  site: AutopilotReadinessSite,
  hasCrawledPage: boolean,
): AutopilotReadiness {
  const blockers: string[] = [];
  if (!site.autopilotEnabled) blockers.push("autopilot_disabled");
  if (!configured(site.domain)) blockers.push("domain_missing");
  if (!configured(site.siteSummary) && !configured(site.niche)) {
    blockers.push("business_profile_missing");
  }
  if (!configured(site.blogTheme) && !configured(site.niche)) {
    blockers.push("content_strategy_missing");
  }
  if (!hasCrawledPage) blockers.push("site_crawl_missing");
  const cadence = site.cadencePerWeek ?? 0;
  if (!Number.isFinite(cadence) || cadence <= 0 || cadence > 21) {
    blockers.push("cadence_invalid");
  }
  blockers.push(...publicationDestinationBlockers(site));
  return { ready: blockers.length === 0, blockers };
}

/** Readiness for unattended external delivery and closed-loop measurement. */
export function liveAutopilotReadiness(
  site: AutopilotReadinessSite,
  hasCrawledPage: boolean,
  maxArticlesPerMonth?: number,
): AutopilotReadiness {
  const blockers = [
    ...warmAutopilotReadiness(site, hasCrawledPage).blockers,
  ];
  if (site.approvalRequired) blockers.push("manual_approval_requested");
  if (!configured(site.gscAccessToken) || !configured(site.gscProperty)) {
    blockers.push("search_console_not_connected");
  }
  const requiredMonthly = requiredMonthlyArticlesForCadence(
    site.cadencePerWeek,
  );
  if (
    maxArticlesPerMonth !== undefined &&
    Number.isFinite(maxArticlesPerMonth) &&
    maxArticlesPerMonth < requiredMonthly
  ) {
    blockers.push("subscription_capacity_below_cadence");
  }
  return { ready: blockers.length === 0, blockers };
}
