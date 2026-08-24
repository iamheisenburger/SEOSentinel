/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_backlinks from "../actions/backlinks.js";
import type * as actions_cadenceMicroSeed from "../actions/cadenceMicroSeed.js";
import type * as actions_contentDecay from "../actions/contentDecay.js";
import type * as actions_expectedClickBackfillFleet from "../actions/expectedClickBackfillFleet.js";
import type * as actions_expectedClickDemandBackfill from "../actions/expectedClickDemandBackfill.js";
import type * as actions_expectedClickEvidenceBackfill from "../actions/expectedClickEvidenceBackfill.js";
import type * as actions_expectedClickMigration from "../actions/expectedClickMigration.js";
import type * as actions_gscSync from "../actions/gscSync.js";
import type * as actions_outcomeCredentials from "../actions/outcomeCredentials.js";
import type * as actions_outreach from "../actions/outreach.js";
import type * as actions_outreachFleet from "../actions/outreachFleet.js";
import type * as actions_pipeline from "../actions/pipeline.js";
import type * as actions_plannedTopicEvidenceRecovery from "../actions/plannedTopicEvidenceRecovery.js";
import type * as actions_scheduler from "../actions/scheduler.js";
import type * as actions_seoData from "../actions/seoData.js";
import type * as actions_seoGrowth from "../actions/seoGrowth.js";
import type * as actions_syndication from "../actions/syndication.js";
import type * as actions_underfilledPlanRecovery from "../actions/underfilledPlanRecovery.js";
import type * as articles from "../articles.js";
import type * as autopilot from "../autopilot.js";
import type * as blog from "../blog.js";
import type * as cadenceMicroSeed from "../cadenceMicroSeed.js";
import type * as crons from "../crons.js";
import type * as executionAuthorization from "../executionAuthorization.js";
import type * as expectedClickDemandBackfill from "../expectedClickDemandBackfill.js";
import type * as expectedClickEvidenceBackfill from "../expectedClickEvidenceBackfill.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib_accountDeletion from "../lib/accountDeletion.js";
import type * as lib_articleGenerationAttempt from "../lib/articleGenerationAttempt.js";
import type * as lib_articleQuality from "../lib/articleQuality.js";
import type * as lib_authorityDiscoveryBudget from "../lib/authorityDiscoveryBudget.js";
import type * as lib_autopilotAlerts from "../lib/autopilotAlerts.js";
import type * as lib_autopilotBuffer from "../lib/autopilotBuffer.js";
import type * as lib_autopilotCadence from "../lib/autopilotCadence.js";
import type * as lib_autopilotReadiness from "../lib/autopilotReadiness.js";
import type * as lib_cadenceMicroSeed from "../lib/cadenceMicroSeed.js";
import type * as lib_dataForSeoAccountBalance from "../lib/dataForSeoAccountBalance.js";
import type * as lib_dataForSeoLocale from "../lib/dataForSeoLocale.js";
import type * as lib_expectedClickBackfillFleet from "../lib/expectedClickBackfillFleet.js";
import type * as lib_expectedClickDemandBackfill from "../lib/expectedClickDemandBackfill.js";
import type * as lib_expectedClickEvidenceBackfill from "../lib/expectedClickEvidenceBackfill.js";
import type * as lib_expectedClickMigrationRecovery from "../lib/expectedClickMigrationRecovery.js";
import type * as lib_expectedClickPortfolio from "../lib/expectedClickPortfolio.js";
import type * as lib_gscSearchAnalytics from "../lib/gscSearchAnalytics.js";
import type * as lib_growthSupportDelivery from "../lib/growthSupportDelivery.js";
import type * as lib_internalHttpAuth from "../lib/internalHttpAuth.js";
import type * as lib_internalLinks from "../lib/internalLinks.js";
import type * as lib_jobRollout from "../lib/jobRollout.js";
import type * as lib_linkReceipts from "../lib/linkReceipts.js";
import type * as lib_linkRelevance from "../lib/linkRelevance.js";
import type * as lib_markdownPublishing from "../lib/markdownPublishing.js";
import type * as lib_mediaQuality from "../lib/mediaQuality.js";
import type * as lib_onboardingClaim from "../lib/onboardingClaim.js";
import type * as lib_outcomeReceipts from "../lib/outcomeReceipts.js";
import type * as lib_outreachContacts from "../lib/outreachContacts.js";
import type * as lib_outreachDelivery from "../lib/outreachDelivery.js";
import type * as lib_outreachDrafting from "../lib/outreachDrafting.js";
import type * as lib_outreachInbound from "../lib/outreachInbound.js";
import type * as lib_outreachInboundRelay from "../lib/outreachInboundRelay.js";
import type * as lib_outreachPacing from "../lib/outreachPacing.js";
import type * as lib_outreachPreparationBudget from "../lib/outreachPreparationBudget.js";
import type * as lib_outreachSecurity from "../lib/outreachSecurity.js";
import type * as lib_outreachTargetLive from "../lib/outreachTargetLive.js";
import type * as lib_planProviderBudget from "../lib/planProviderBudget.js";
import type * as lib_planProviderReservation from "../lib/planProviderReservation.js";
import type * as lib_planSiteAllowance from "../lib/planSiteAllowance.js";
import type * as lib_plannedTopicEvidenceRecovery from "../lib/plannedTopicEvidenceRecovery.js";
import type * as lib_providerSpendReservation from "../lib/providerSpendReservation.js";
import type * as lib_publicationArtifact from "../lib/publicationArtifact.js";
import type * as lib_publicationLease from "../lib/publicationLease.js";
import type * as lib_publicationLive from "../lib/publicationLive.js";
import type * as lib_publicationReceipts from "../lib/publicationReceipts.js";
import type * as lib_publishedRevision from "../lib/publishedRevision.js";
import type * as lib_safeMarkdownHtml from "../lib/safeMarkdownHtml.js";
import type * as lib_safeOutbound from "../lib/safeOutbound.js";
import type * as lib_searchPerformance from "../lib/searchPerformance.js";
import type * as lib_seoGrowth from "../lib/seoGrowth.js";
import type * as lib_serpAttainability from "../lib/serpAttainability.js";
import type * as lib_siteSecurity from "../lib/siteSecurity.js";
import type * as lib_sourceQuality from "../lib/sourceQuality.js";
import type * as lib_topicLifecycle from "../lib/topicLifecycle.js";
import type * as lib_topicLifecycleDb from "../lib/topicLifecycleDb.js";
import type * as onboardingClaims from "../onboardingClaims.js";
import type * as outcomes from "../outcomes.js";
import type * as outreach from "../outreach.js";
import type * as pages from "../pages.js";
import type * as planJobs from "../planJobs.js";
import type * as planLimits from "../planLimits.js";
import type * as publishedRevisions from "../publishedRevisions.js";
import type * as publisher from "../publisher.js";
import type * as searchPerformance from "../searchPerformance.js";
import type * as seoAuthority from "../seoAuthority.js";
import type * as seoGrowth from "../seoGrowth.js";
import type * as sites from "../sites.js";
import type * as topics from "../topics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/backlinks": typeof actions_backlinks;
  "actions/cadenceMicroSeed": typeof actions_cadenceMicroSeed;
  "actions/contentDecay": typeof actions_contentDecay;
  "actions/expectedClickBackfillFleet": typeof actions_expectedClickBackfillFleet;
  "actions/expectedClickDemandBackfill": typeof actions_expectedClickDemandBackfill;
  "actions/expectedClickEvidenceBackfill": typeof actions_expectedClickEvidenceBackfill;
  "actions/expectedClickMigration": typeof actions_expectedClickMigration;
  "actions/gscSync": typeof actions_gscSync;
  "actions/outcomeCredentials": typeof actions_outcomeCredentials;
  "actions/outreach": typeof actions_outreach;
  "actions/outreachFleet": typeof actions_outreachFleet;
  "actions/pipeline": typeof actions_pipeline;
  "actions/plannedTopicEvidenceRecovery": typeof actions_plannedTopicEvidenceRecovery;
  "actions/scheduler": typeof actions_scheduler;
  "actions/seoData": typeof actions_seoData;
  "actions/seoGrowth": typeof actions_seoGrowth;
  "actions/syndication": typeof actions_syndication;
  "actions/underfilledPlanRecovery": typeof actions_underfilledPlanRecovery;
  articles: typeof articles;
  autopilot: typeof autopilot;
  blog: typeof blog;
  cadenceMicroSeed: typeof cadenceMicroSeed;
  crons: typeof crons;
  executionAuthorization: typeof executionAuthorization;
  expectedClickDemandBackfill: typeof expectedClickDemandBackfill;
  expectedClickEvidenceBackfill: typeof expectedClickEvidenceBackfill;
  http: typeof http;
  jobs: typeof jobs;
  "lib/accountDeletion": typeof lib_accountDeletion;
  "lib/articleGenerationAttempt": typeof lib_articleGenerationAttempt;
  "lib/articleQuality": typeof lib_articleQuality;
  "lib/authorityDiscoveryBudget": typeof lib_authorityDiscoveryBudget;
  "lib/autopilotAlerts": typeof lib_autopilotAlerts;
  "lib/autopilotBuffer": typeof lib_autopilotBuffer;
  "lib/autopilotCadence": typeof lib_autopilotCadence;
  "lib/autopilotReadiness": typeof lib_autopilotReadiness;
  "lib/cadenceMicroSeed": typeof lib_cadenceMicroSeed;
  "lib/dataForSeoAccountBalance": typeof lib_dataForSeoAccountBalance;
  "lib/dataForSeoLocale": typeof lib_dataForSeoLocale;
  "lib/expectedClickBackfillFleet": typeof lib_expectedClickBackfillFleet;
  "lib/expectedClickDemandBackfill": typeof lib_expectedClickDemandBackfill;
  "lib/expectedClickEvidenceBackfill": typeof lib_expectedClickEvidenceBackfill;
  "lib/expectedClickMigrationRecovery": typeof lib_expectedClickMigrationRecovery;
  "lib/expectedClickPortfolio": typeof lib_expectedClickPortfolio;
  "lib/gscSearchAnalytics": typeof lib_gscSearchAnalytics;
  "lib/growthSupportDelivery": typeof lib_growthSupportDelivery;
  "lib/internalHttpAuth": typeof lib_internalHttpAuth;
  "lib/internalLinks": typeof lib_internalLinks;
  "lib/jobRollout": typeof lib_jobRollout;
  "lib/linkReceipts": typeof lib_linkReceipts;
  "lib/linkRelevance": typeof lib_linkRelevance;
  "lib/markdownPublishing": typeof lib_markdownPublishing;
  "lib/mediaQuality": typeof lib_mediaQuality;
  "lib/onboardingClaim": typeof lib_onboardingClaim;
  "lib/outcomeReceipts": typeof lib_outcomeReceipts;
  "lib/outreachContacts": typeof lib_outreachContacts;
  "lib/outreachDelivery": typeof lib_outreachDelivery;
  "lib/outreachDrafting": typeof lib_outreachDrafting;
  "lib/outreachInbound": typeof lib_outreachInbound;
  "lib/outreachInboundRelay": typeof lib_outreachInboundRelay;
  "lib/outreachPacing": typeof lib_outreachPacing;
  "lib/outreachPreparationBudget": typeof lib_outreachPreparationBudget;
  "lib/outreachSecurity": typeof lib_outreachSecurity;
  "lib/outreachTargetLive": typeof lib_outreachTargetLive;
  "lib/planProviderBudget": typeof lib_planProviderBudget;
  "lib/planProviderReservation": typeof lib_planProviderReservation;
  "lib/planSiteAllowance": typeof lib_planSiteAllowance;
  "lib/plannedTopicEvidenceRecovery": typeof lib_plannedTopicEvidenceRecovery;
  "lib/providerSpendReservation": typeof lib_providerSpendReservation;
  "lib/publicationArtifact": typeof lib_publicationArtifact;
  "lib/publicationLease": typeof lib_publicationLease;
  "lib/publicationLive": typeof lib_publicationLive;
  "lib/publicationReceipts": typeof lib_publicationReceipts;
  "lib/publishedRevision": typeof lib_publishedRevision;
  "lib/safeMarkdownHtml": typeof lib_safeMarkdownHtml;
  "lib/safeOutbound": typeof lib_safeOutbound;
  "lib/searchPerformance": typeof lib_searchPerformance;
  "lib/seoGrowth": typeof lib_seoGrowth;
  "lib/serpAttainability": typeof lib_serpAttainability;
  "lib/siteSecurity": typeof lib_siteSecurity;
  "lib/sourceQuality": typeof lib_sourceQuality;
  "lib/topicLifecycle": typeof lib_topicLifecycle;
  "lib/topicLifecycleDb": typeof lib_topicLifecycleDb;
  onboardingClaims: typeof onboardingClaims;
  outcomes: typeof outcomes;
  outreach: typeof outreach;
  pages: typeof pages;
  planJobs: typeof planJobs;
  planLimits: typeof planLimits;
  publishedRevisions: typeof publishedRevisions;
  publisher: typeof publisher;
  searchPerformance: typeof searchPerformance;
  seoAuthority: typeof seoAuthority;
  seoGrowth: typeof seoGrowth;
  sites: typeof sites;
  topics: typeof topics;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
