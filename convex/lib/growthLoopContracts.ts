/**
 * Tenant-generic public contracts for Pentra's autonomous growth loop.
 *
 * These contracts are deliberately provider-neutral. Provider progress is not
 * proof of an outcome, and activity must never be presented as growth.
 */

import { sha256Hex } from "./publicationArtifact.ts";

export const GROWTH_LOOP_CONTRACT_VERSION = 1;
export const OPPORTUNITY_DECISION_VERSION = 1;
export const OUTREACH_POLICY_VERSION = 1;
export const GROWTH_LOOP_RELEASE_VERSION = 2;
export const GROWTH_LOOP_ROLLOUT_STAGES = [10, 50, 100] as const;

export type GrowthLoopReleaseProfile = "bootstrap_v1" | "full_managed";

/** Bootstrap operations are intentionally scoped to the explicitly proven
 * tenant pair. Unrelated enrolled tenants must neither widen nor block that
 * release profile; full-managed GA continues to audit the whole fleet. */
export function growthLoopOperationalSiteInScope(
  profile: GrowthLoopReleaseProfile,
  releaseTenantSiteIds: ReadonlySet<string>,
  siteId: string,
): boolean {
  return profile === "full_managed" || releaseTenantSiteIds.has(siteId);
}

/** A content miss is an ordinary classified product outcome, not a severe
 * safety incident. GA-stopping incidents are the boundaries that can cause a
 * duplicate external effect, tenant exposure, suppression failure, or an
 * unverifiable write. */
export function isGrowthLoopSevereIncident(
  kind: string,
  message = "",
): boolean {
  return /(duplicate_external|cross_tenant|suppression|integrity|conflict|delivery_unverified|terminal_alert)/
    .test(`${kind}:${message}`.toLowerCase());
}

export function growthLoopRolloutBucket(siteId: string): number {
  return Number.parseInt(sha256Hex(`growth-loop-rollout:${siteId}`).slice(0, 8), 16) % 100;
}

export function growthLoopRolloutAllowsSite(
  siteId: string,
  targetPercent: number,
): boolean {
  if (![...GROWTH_LOOP_ROLLOUT_STAGES, 0].includes(targetPercent as 0 | 10 | 50 | 100)) {
    throw new Error("Growth-loop rollout percent must be 0, 10, 50, or 100");
  }
  return targetPercent >= 100 || growthLoopRolloutBucket(siteId) < targetPercent;
}

export type PublisherKind = "github" | "wordpress" | "webhook";
export type OutreachTransport =
  | "smartlead_managed"
  | "gmail_oauth"
  | "smtp";
export type LegacyOutreachTransport = "managed_ses";

export type CapabilityState =
  | "waiting_owner"
  | "waiting_pentra"
  | "waiting_provider"
  | "warming"
  | "ready"
  | "degraded"
  | "terminal";

export type ResponsibleParty = "owner" | "pentra" | "provider" | "none";

export type CapabilityReceipt = {
  capability: string;
  state: CapabilityState;
  blockerCode?: string;
  responsibleParty: ResponsibleParty;
  nextEligibleAt?: number;
  automaticWakeAt?: number;
  receiptKey: string;
  evaluatedAt: number;
  version: number;
};

export function capabilityReceipt(args: {
  capability: string;
  state: CapabilityState;
  blockerCode?: string;
  nextEligibleAt?: number;
  automaticWakeAt?: number;
  binding: string;
  evaluatedAt: number;
}): CapabilityReceipt {
  if (args.state !== "ready" && !args.blockerCode) {
    throw new Error("An unfinished capability must expose a blocker code");
  }
  if (
    args.nextEligibleAt !== undefined &&
    (!Number.isFinite(args.nextEligibleAt) || args.nextEligibleAt < 0)
  ) {
    throw new Error("nextEligibleAt must be a finite timestamp");
  }
  if (
    args.state !== "ready" && args.state !== "terminal" &&
    (args.nextEligibleAt === undefined || args.automaticWakeAt === undefined)
  ) {
    throw new Error(
      "An unfinished non-terminal capability must expose eligibility and an automatic wake",
    );
  }
  const responsibleParty: ResponsibleParty =
    args.state === "waiting_owner"
      ? "owner"
      : args.state === "waiting_provider" || args.state === "warming"
        ? "provider"
        : args.state === "ready"
          ? "none"
          : "pentra";
  return {
    capability: args.capability,
    state: args.state,
    blockerCode: args.blockerCode,
    responsibleParty,
    nextEligibleAt: args.nextEligibleAt,
    automaticWakeAt: args.automaticWakeAt,
    receiptKey: [
      GROWTH_LOOP_CONTRACT_VERSION,
      args.capability,
      args.binding,
      args.state,
      args.blockerCode ?? "ready",
    ].join(":"),
    evaluatedAt: args.evaluatedAt,
    version: GROWTH_LOOP_CONTRACT_VERSION,
  };
}

export type OpportunityClassification =
  | "eligible"
  | "needs_evidence"
  | "too_thin"
  | "coverage_conflict"
  | "business_fit_failed"
  | "cooldown"
  | "opportunity_space_exhausted";

export type OpportunityDecisionInput = {
  businessFitScore?: number;
  businessFitEligible?: boolean;
  monthlyDemand?: number;
  expectedClicksMonthly?: number;
  serpAttainable?: boolean;
  commercialRelevance?: number;
  contentDepthScore?: number;
  contentFeasibilityFailed?: boolean;
  evidenceFresh?: boolean;
  coverageConflict?: boolean;
  cooldownUntil?: number;
  remainingCandidateCount?: number;
};

export type OpportunityDecision = {
  classification: OpportunityClassification;
  admitted: boolean;
  score: number;
  reasons: string[];
  nextEligibleAt?: number;
  version: number;
};

function unit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * A multi-signal admission decision. Demand contributes to the score, but no
 * global search-volume floor can veto an otherwise useful, winnable topic.
 */
export function decideOpportunity(
  input: OpportunityDecisionInput,
  now: number,
): OpportunityDecision {
  if (input.cooldownUntil !== undefined && input.cooldownUntil > now) {
    return {
      classification: "cooldown",
      admitted: false,
      score: 0,
      reasons: ["The exact opportunity is inside its durable cooldown."],
      nextEligibleAt: input.cooldownUntil,
      version: OPPORTUNITY_DECISION_VERSION,
    };
  }
  if (input.contentFeasibilityFailed) {
    return {
      classification: "too_thin",
      admitted: false,
      score: 0,
      reasons: ["Bounded generation and quality recovery could not produce a truthful article at the required depth."],
      version: OPPORTUNITY_DECISION_VERSION,
    };
  }
  if (input.coverageConflict) {
    return {
      classification: "coverage_conflict",
      admitted: false,
      score: 0,
      reasons: ["Existing coverage already owns the measured search intent."],
      version: OPPORTUNITY_DECISION_VERSION,
    };
  }
  if (input.businessFitEligible === false) {
    return {
      classification: "business_fit_failed",
      admitted: false,
      score: 0,
      reasons: ["The topic is not anchored to this tenant's product or buyer problem."],
      version: OPPORTUNITY_DECISION_VERSION,
    };
  }
  const evidenceMissing =
    input.evidenceFresh !== true ||
    input.monthlyDemand === undefined ||
    input.expectedClicksMonthly === undefined ||
    input.serpAttainable === undefined ||
    input.businessFitScore === undefined ||
    input.commercialRelevance === undefined ||
    input.contentDepthScore === undefined;
  if (evidenceMissing) {
    if ((input.remainingCandidateCount ?? 1) <= 0) {
      return {
        classification: "opportunity_space_exhausted",
        admitted: false,
        score: 0,
        reasons: ["No unconsumed candidate remains; continue measurement and authority work."],
        version: OPPORTUNITY_DECISION_VERSION,
      };
    }
    return {
      classification: "needs_evidence",
      admitted: false,
      score: 0,
      reasons: ["Fresh demand, SERP, fit, relevance, and depth evidence is required."],
      version: OPPORTUNITY_DECISION_VERSION,
    };
  }

  const demandSignal = Math.log10(1 + Math.max(0, input.monthlyDemand!)) / 3;
  const clickSignal = Math.log10(1 + Math.max(0, input.expectedClicksMonthly!)) / 2;
  const score = Math.round(100 * (
    0.2 * unit(input.businessFitScore! / 100) +
    0.16 * unit(demandSignal) +
    0.18 * unit(clickSignal) +
    0.16 * (input.serpAttainable ? 1 : 0) +
    0.15 * unit(input.commercialRelevance) +
    0.15 * unit(input.contentDepthScore)
  ));
  if (!input.serpAttainable) {
    return {
      classification: "needs_evidence",
      admitted: false,
      score,
      reasons: ["The measured SERP is not currently attainable; remeasure after authority changes."],
      version: OPPORTUNITY_DECISION_VERSION,
    };
  }
  if (input.contentDepthScore! < 0.55) {
    return {
      classification: "too_thin",
      admitted: false,
      score,
      reasons: ["The topic cannot yet support the required useful depth and evidence."],
      version: OPPORTUNITY_DECISION_VERSION,
    };
  }
  if (score < 55) {
    return {
      classification: "needs_evidence",
      admitted: false,
      score,
      reasons: ["The combined measured opportunity score is below the admission boundary."],
      version: OPPORTUNITY_DECISION_VERSION,
    };
  }
  return {
    classification: "eligible",
    admitted: true,
    score,
    reasons: ["Fresh tenant-specific evidence supports generation."],
    version: OPPORTUNITY_DECISION_VERSION,
  };
}

export type OutreachPolicyDecisionKind =
  | "allowed_auto"
  | "approval_only"
  | "blocked"
  | "needs_evidence";

export type OutreachPolicyInput = {
  recipientClass?: "corporate" | "sole_trader" | "personal";
  jurisdiction?: string;
  jurisdictionEvidence?: string;
  businessRoleEvidence?: string;
  businessRelevance?: string;
  contactSource?: string;
  lawfulBasisClass?: string;
  requiredDisclosuresPresent: boolean;
  tenantConsentVersion?: number;
  suppressed: boolean;
  legalRuleEnabled: boolean;
};

/** Fail closed: general availability is not permission to send everywhere. */
export function decideOutreachPolicy(
  input: OutreachPolicyInput,
): { decision: OutreachPolicyDecisionKind; reasons: string[]; version: number } {
  if (input.suppressed) {
    return { decision: "blocked", reasons: ["Recipient is suppressed account-wide."], version: OUTREACH_POLICY_VERSION };
  }
  if (input.recipientClass === "personal") {
    return { decision: "blocked", reasons: ["Personal or consumer addresses are not eligible for automatic outreach."], version: OUTREACH_POLICY_VERSION };
  }
  const missing = [
    input.recipientClass,
    input.jurisdiction,
    input.jurisdictionEvidence,
    input.businessRoleEvidence,
    input.businessRelevance,
    input.contactSource,
    input.lawfulBasisClass,
    input.tenantConsentVersion,
  ].some((value) => value === undefined || value === "");
  if (missing) {
    return { decision: "needs_evidence", reasons: ["Jurisdiction, role, source, relevance, lawful basis, and consent evidence are required."], version: OUTREACH_POLICY_VERSION };
  }
  if (!input.requiredDisclosuresPresent) {
    return { decision: "approval_only", reasons: ["Required sender identity, address, or opt-out disclosure is absent."], version: OUTREACH_POLICY_VERSION };
  }
  if (!input.legalRuleEnabled) {
    return { decision: "approval_only", reasons: ["No independently reviewed automatic-outreach rule is enabled for this jurisdiction."], version: OUTREACH_POLICY_VERSION };
  }
  return { decision: "allowed_auto", reasons: ["The versioned jurisdiction policy admits automatic business outreach."], version: OUTREACH_POLICY_VERSION };
}

export const GROWTH_LOOP_STAGE_KEYS = [
  "setup",
  "planning",
  "buffer",
  "publication",
  "measurement",
  "improvement",
  "outreach",
  "backlink_verification",
] as const;

export type GrowthLoopStageKey = typeof GROWTH_LOOP_STAGE_KEYS[number];
export type GrowthLoopStatus = {
  siteId: string;
  stages: Record<GrowthLoopStageKey, CapabilityReceipt>;
  ready: boolean;
  nextEligibleAt?: number;
  verifiedOutcomes: {
    publishedUrls: number;
    measuredConversions: number;
    acquiredBacklinks: number;
  };
  evaluatedAt: number;
  version: number;
};

export type GrowthLoopReleaseEvidence = {
  profile?: GrowthLoopReleaseProfile;
  releaseCommit: string;
  publisherCanaries: readonly PublisherKind[];
  tenantCanaryIds: string[];
  unrelatedTenantCount: number;
  naturalPlanningVerified: boolean;
  sealedBufferVerified: boolean;
  publicationVerified: boolean;
  measurementDecisionExecuted: boolean;
  smartleadProvisioningVerified?: boolean;
  smartleadWarmupVerified?: boolean;
  smartleadDeliveryVerified?: boolean;
  smartleadReplyVerified?: boolean;
  smartleadBounceVerified?: boolean;
  smartleadUnsubscribeVerified?: boolean;
  smartleadCancellationVerified?: boolean;
  acquiredBacklinkVerified: boolean;
  terminalConvergenceVerified?: boolean;
  smtpConnectionVerified?: boolean;
  smtpDeliveryVerified?: boolean;
  imapReplyVerified?: boolean;
  imapBounceVerified?: boolean;
  imapStopVerified?: boolean;
  smtpFollowupCancellationVerified?: boolean;
  controlledConversionVerified?: boolean;
  unresolvedSevereIncidentCount: number;
  silentStateCount: number;
};

export function growthLoopReleaseBlockers(
  evidence: GrowthLoopReleaseEvidence,
): string[] {
  const blockers: string[] = [];
  if (!/^[0-9a-f]{7,64}$/i.test(evidence.releaseCommit)) blockers.push("release_commit_unbound");
  if (evidence.profile === "bootstrap_v1") {
    if (!evidence.publisherCanaries.includes("github")) {
      blockers.push("publisher_canary_github_missing");
    }
    if (
      new Set(evidence.tenantCanaryIds).size < 2 ||
      evidence.unrelatedTenantCount < 2
    ) blockers.push("two_authorized_tenant_canaries_missing");
    const bootstrapChecks = {
      natural_planning_missing: evidence.naturalPlanningVerified,
      sealed_buffer_missing: evidence.sealedBufferVerified,
      verified_publication_missing: evidence.publicationVerified,
      measured_improvement_missing: evidence.measurementDecisionExecuted,
      terminal_convergence_missing: evidence.terminalConvergenceVerified,
      smtp_connection_missing: evidence.smtpConnectionVerified,
      smtp_delivery_missing: evidence.smtpDeliveryVerified,
      imap_reply_missing: evidence.imapReplyVerified,
      imap_bounce_missing: evidence.imapBounceVerified,
      imap_stop_missing: evidence.imapStopVerified,
      smtp_followup_cancellation_missing:
        evidence.smtpFollowupCancellationVerified,
      controlled_conversion_missing: evidence.controlledConversionVerified,
      acquired_backlink_missing: evidence.acquiredBacklinkVerified,
    };
    for (const [code, complete] of Object.entries(bootstrapChecks)) {
      if (!complete) blockers.push(code);
    }
    if (evidence.unresolvedSevereIncidentCount > 0) {
      blockers.push("unresolved_severe_incidents");
    }
    if (evidence.silentStateCount > 0) blockers.push("silent_states_present");
    return blockers;
  }
  for (const publisher of ["github", "wordpress", "webhook"] as const) {
    if (!evidence.publisherCanaries.includes(publisher)) blockers.push(`publisher_canary_${publisher}_missing`);
  }
  if (new Set(evidence.tenantCanaryIds).size < 3 || evidence.unrelatedTenantCount < 3) blockers.push("three_unrelated_tenant_canaries_missing");
  const booleanChecks = {
    natural_planning_missing: evidence.naturalPlanningVerified,
    sealed_buffer_missing: evidence.sealedBufferVerified,
    verified_publication_missing: evidence.publicationVerified,
    measured_improvement_missing: evidence.measurementDecisionExecuted,
    smartlead_provisioning_missing: evidence.smartleadProvisioningVerified,
    smartlead_warmup_missing: evidence.smartleadWarmupVerified,
    smartlead_delivery_missing: evidence.smartleadDeliveryVerified,
    smartlead_reply_missing: evidence.smartleadReplyVerified,
    smartlead_bounce_missing: evidence.smartleadBounceVerified,
    smartlead_unsubscribe_missing: evidence.smartleadUnsubscribeVerified,
    smartlead_cancellation_missing: evidence.smartleadCancellationVerified,
    acquired_backlink_missing: evidence.acquiredBacklinkVerified,
  };
  for (const [code, complete] of Object.entries(booleanChecks)) if (!complete) blockers.push(code);
  if (evidence.unresolvedSevereIncidentCount > 0) blockers.push("unresolved_severe_incidents");
  if (evidence.silentStateCount > 0) blockers.push("silent_states_present");
  return blockers;
}
