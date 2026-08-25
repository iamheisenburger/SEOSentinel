import { sha256Hex } from "./publicationArtifact.ts";

export const ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION = 1;

export type OneSetupPlanningContext = {
  domain: string;
  canonicalDomain?: string | null;
  niche?: string | null;
  language?: string | null;
  siteName?: string | null;
  siteType?: string | null;
  siteSummary?: string | null;
  blogTheme?: string | null;
  keyFeatures?: string[] | null;
  pricingInfo?: string | null;
  targetCountry?: string | null;
  targetAudienceSummary?: string | null;
  painPoints?: string[] | null;
  productUsage?: string | null;
  competitors?: string[] | null;
  anchorKeywords?: string[] | null;
  verifiedKeywordDataRequired?: boolean | null;
  expectedClickSchedulingEnabled?: boolean | null;
};

function normalizedPlanningText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function oneSetupPlanningDomain(value: string): string {
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return normalizedPlanningText(value);
  }
}

function normalizedPlanningList(
  values: string[] | null | undefined,
): string[] {
  return [...new Set(
    (values ?? [])
      .map(normalizedPlanningText)
      .filter(Boolean),
  )].sort();
}

/**
 * Exact, non-secret fingerprint of the owner/site inputs that can change topic
 * discovery or its evidence gates. Managed connection choices and cadence are
 * deliberately absent: changing machinery must not repurchase the same site's
 * initial content plan. Live measurements and topic inventory are also absent;
 * their normal evolution cannot invalidate an already-paid receipt.
 */
export function oneSetupInitialPlanContextFingerprint(
  site: OneSetupPlanningContext,
): string {
  return sha256Hex(JSON.stringify({
    version: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
    domain: oneSetupPlanningDomain(site.canonicalDomain ?? site.domain),
    niche: normalizedPlanningText(site.niche),
    language: normalizedPlanningText(site.language),
    siteName: normalizedPlanningText(site.siteName),
    siteType: normalizedPlanningText(site.siteType),
    siteSummary: normalizedPlanningText(site.siteSummary),
    blogTheme: normalizedPlanningText(site.blogTheme),
    keyFeatures: normalizedPlanningList(site.keyFeatures),
    pricingInfo: normalizedPlanningText(site.pricingInfo),
    targetCountry: normalizedPlanningText(site.targetCountry),
    targetAudienceSummary: normalizedPlanningText(
      site.targetAudienceSummary,
    ),
    painPoints: normalizedPlanningList(site.painPoints),
    productUsage: normalizedPlanningText(site.productUsage),
    competitors: normalizedPlanningList(site.competitors),
    anchorKeywords: normalizedPlanningList(site.anchorKeywords),
    verifiedKeywordDataRequired:
      site.verifiedKeywordDataRequired === true,
    expectedClickSchedulingEnabled:
      site.expectedClickSchedulingEnabled === true,
  }));
}

export type OneSetupInitialPlanReceiptDecision = {
  generation: number;
  reset: boolean;
  adoptBoundJob: boolean;
};

/**
 * Advance the plan generation only when its actual planning contract changes.
 * Job status is intentionally not an input: pending, running, failed and done
 * are all terminally associated with the same paid receipt and must be adopted.
 */
export function oneSetupInitialPlanReceiptDecision(args: {
  storedVersion?: number;
  storedGeneration?: number;
  storedContextFingerprint?: string;
  storedJobId?: string;
  currentContextFingerprint: string;
  hardReset: boolean;
}): OneSetupInitialPlanReceiptDecision {
  const storedGeneration = Number.isSafeInteger(args.storedGeneration) &&
      (args.storedGeneration ?? 0) > 0
    ? args.storedGeneration!
    : 0;
  const initialized =
    args.storedVersion === ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION &&
    storedGeneration > 0 &&
    Boolean(args.storedContextFingerprint);
  const reset = args.hardReset || !initialized ||
    args.storedContextFingerprint !== args.currentContextFingerprint;
  return {
    generation: reset ? storedGeneration + 1 : storedGeneration,
    reset,
    adoptBoundJob: !reset && Boolean(args.storedJobId),
  };
}

/** Stable request/generation binding shared by queueing and settlement. */
export function oneSetupInitialPlanJobBindingMatches(args: {
  requestId: string;
  requestPlanJobId?: string;
  requestReceiptVersion?: number;
  requestGeneration?: number;
  jobId: string;
  payloadRequestId?: unknown;
  payloadReceiptVersion?: unknown;
  payloadGeneration?: unknown;
}): boolean {
  return args.requestPlanJobId === args.jobId &&
    args.requestReceiptVersion === ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION &&
    Number.isSafeInteger(args.requestGeneration) &&
    (args.requestGeneration ?? 0) > 0 &&
    String(args.payloadRequestId ?? "") === args.requestId &&
    args.payloadReceiptVersion === args.requestReceiptVersion &&
    args.payloadGeneration === args.requestGeneration;
}
