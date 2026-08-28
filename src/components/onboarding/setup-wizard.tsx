"use client";

import { useAuth } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  AlertCircle,
  BarChart3,
  Check,
  ChevronDown,
  Globe,
  Mail,
  Settings2,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  cadenceFitsOperationalLimit,
  cadenceLabel,
  defaultTargetCadenceForMonthlyLimit,
  MAX_AUTOPILOT_CADENCE_PER_WEEK,
  requiredMonthlyArticlesForCadence,
  targetCadenceOptions,
} from "../../../convex/planLimits";
import { PUBLISHER_AUTOPUBLISH_CONSENT_TEXT } from
  "../../../convex/lib/publisherProvisioning";
import {
  MANAGED_OUTREACH_MAILBOX_CANARY_CONSENT_VERSION,
  MANAGED_OUTREACH_MAILBOX_PROFILE_ATTESTATION_VERSION,
} from "../../../convex/lib/managedOutreachMailbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetupReadiness } from "@/components/onboarding/setup-readiness";
import {
  OneSetupAdapterChoices,
  type OutreachTransport,
  type PublisherKind,
} from "@/components/onboarding/one-setup-adapter-choices";
import {
  oneSetupFormBlockers,
  postalAddressError,
} from "@/lib/one-setup-form";

type SetupMode = "connect_existing" | "managed";
type AutomationMode = "assisted" | "full";
type OneSetupReceipt = {
  requestId: Id<"managed_provisioning_requests">;
  revision: number;
  configurationRevision: number;
};

type ExistingSiteSetup = {
  _id: Id<"sites">;
  domain: string;
  siteName?: string;
  siteSummary?: string;
  targetCountry?: string;
  targetAudienceSummary?: string;
  productUsage?: string;
  painPoints?: string[];
  publishMethod?: string;
  cadencePerWeek?: number;
  cadenceRequestedPerWeek?: number;
  approvalRequired?: boolean;
};

function existingPublisherKind(value?: string): PublisherKind {
  return value === "wordpress" || value === "webhook" || value === "github"
    ? value
    : "github";
}

const CAPABILITIES = [
  {
    key: "publisher",
    title: "Publishing",
    detail: "Deliver approved articles to your website",
    icon: Upload,
  },
  {
    key: "measurement",
    title: "Search measurement",
    detail: "Measure rankings, clicks, and page performance",
    icon: BarChart3,
  },
  {
    key: "outreach",
    title: "Authority mailbox",
    detail: "Use a dedicated business sender for authority outreach",
    icon: Mail,
  },
] as const;

export function SetupWizard({
  existingSite,
}: {
  existingSite?: ExistingSiteSetup;
} = {}) {
  const { userId, isLoaded } = useAuth();
  const [domain, setDomain] = useState(existingSite?.domain ?? "");
  const [businessName, setBusinessName] = useState(existingSite?.siteName ?? "");
  const [businessSummary, setBusinessSummary] = useState(
    existingSite?.siteSummary ?? "",
  );
  const [targetCountry, setTargetCountry] = useState(
    existingSite?.targetCountry ?? "",
  );
  const [targetAudience, setTargetAudience] = useState(
    existingSite?.targetAudienceSummary ?? "",
  );
  const [productUsage, setProductUsage] = useState(
    existingSite?.productUsage ?? "",
  );
  const [painPoints, setPainPoints] = useState(
    existingSite?.painPoints?.join(", ") ?? "",
  );
  const [publisherKind, setPublisherKind] = useState<PublisherKind>(
    existingPublisherKind(existingSite?.publishMethod),
  );
  const [outreachTransport, setOutreachTransport] =
    useState<OutreachTransport>("smtp");
  const publisherMode: SetupMode = "connect_existing";
  const measurementMode: SetupMode = "connect_existing";
  const outreachMode: SetupMode = outreachTransport === "smartlead_managed"
    ? "managed"
    : "connect_existing";
  const [automationMode, setAutomationMode] = useState<AutomationMode>(
    existingSite?.approvalRequired === true ? "assisted" : "full",
  );
  const [autopublishConsentAccepted, setAutopublishConsentAccepted] =
    useState(false);
  const [managedSenderName, setManagedSenderName] = useState(
    existingSite?.siteName ?? "",
  );
  const [managedPhysicalAddress, setManagedPhysicalAddress] = useState("");
  const [managedSenderDomain, setManagedSenderDomain] = useState("");
  const [confirmsSenderIdentityAndAddress, setConfirmsSenderIdentityAndAddress] =
    useState(false);
  const [
    confirmsDedicatedManagedSenderIdentity,
    setConfirmsDedicatedManagedSenderIdentity,
  ] =
    useState(false);
  const [authorizesManagedDeliveryEventCanary, setAuthorizesManagedDeliveryEventCanary] =
    useState(false);
  const [confirmsSeparateAutomaticSendingConsent, setConfirmsSeparateAutomaticSendingConsent] =
    useState(false);
  const [cadence, setCadence] = useState(
    existingSite?.cadenceRequestedPerWeek ?? existingSite?.cadencePerWeek ?? 0,
  );
  const automaticCadence = useRef(0);
  const [siteId, setSiteId] = useState<Id<"sites"> | null>(null);
  const [setupReceipt, setSetupReceipt] = useState<OneSetupReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupNeedsRetry, setSetupNeedsRetry] = useState(false);
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capacity = useQuery(
    api.sites.getCadenceCapacity,
    isLoaded && userId
      ? existingSite
        ? { siteId: existingSite._id }
        : {}
      : "skip",
  );
  const upsertSite = useMutation(api.sites.upsert);
  const saveOneSetupRequest = useMutation(api.sites.saveOneSetupRequest);
  const resumeOneSetupExecution = useAction(
    api.actions.pipeline.resumeOneSetupExecution,
  );

  const cadenceOptions = targetCadenceOptions();
  const cadenceMonthlyCost = requiredMonthlyArticlesForCadence(cadence);
  const cadenceInputReady = Boolean(
    capacity?.ready &&
      cadenceFitsOperationalLimit(cadence),
  );
  const physicalAddressError = postalAddressError(managedPhysicalAddress);
  const setupBlockers = oneSetupFormBlockers({
    capacityReady: Boolean(capacity?.ready),
    domain,
    businessName,
    businessSummary,
    targetCountry,
    targetAudience,
    productUsage,
    cadence,
    fullAutopilot: automationMode === "full",
    autopublishConsentAccepted,
    senderName: managedSenderName,
    postalAddress: managedPhysicalAddress,
    confirmsSenderIdentityAndAddress,
    authorizesDeliveryEventCanary: authorizesManagedDeliveryEventCanary,
    confirmsSeparateAutomaticSendingConsent,
    managedOutreach: outreachMode === "managed",
    managedSenderDomain,
    confirmsDedicatedManagedSenderIdentity,
  });

  useEffect(() => {
    if (!capacity?.ready) return;
    const next = defaultTargetCadenceForMonthlyLimit(capacity.maxArticles);
    setCadence((current) =>
      current === automaticCadence.current ||
        !cadenceFitsOperationalLimit(current)
        ? next
        : current,
    );
    automaticCadence.current = next;
  }, [capacity?.maxArticles, capacity?.ready]);

  async function finishSetup(
    createdSiteId: Id<"sites">,
    existingReceipt: OneSetupReceipt | null = setupReceipt,
  ) {
    let receipt = existingReceipt;
    try {
      if (!receipt) {
        setActiveOperation("Recording your connection choices…");
        receipt = await saveOneSetupRequest({
          siteId: createdSiteId,
          publisherKind,
          outreachTransport,
          publisherMode,
          searchMeasurementMode: measurementMode,
          outreachMailboxMode: outreachMode,
          automationMode,
          publisherAutopublishConsentAccepted:
            automationMode === "full" && autopublishConsentAccepted,
          requestedCadencePerWeek: cadence,
          managedOutreachFromName: managedSenderName,
          managedOutreachPhysicalMailingAddress:
            managedPhysicalAddress,
          managedOutreachAttestationVersion:
            MANAGED_OUTREACH_MAILBOX_PROFILE_ATTESTATION_VERSION,
          managedOutreachCanaryConsentVersion:
            MANAGED_OUTREACH_MAILBOX_CANARY_CONSENT_VERSION,
          confirmsSenderIdentityAndAddress,
          authorizesManagedDeliveryEventCanary,
          confirmsAutonomousSendingRequiresSeparateConsent:
            confirmsSeparateAutomaticSendingConsent,
          ...(outreachMode === "managed"
            ? {
                managedOutreachSenderDomain: managedSenderDomain,
                confirmsDedicatedManagedSenderIdentity,
              }
            : {}),
        });
        setSetupReceipt(receipt);
      }

      const planSync = await fetch("/api/billing/sync-plan", {
        method: "POST",
        cache: "no-store",
      });
      if (!planSync.ok) {
        throw new Error(
          "Your setup choices were saved, but plan verification needs to be retried.",
        );
      }
      setSetupNeedsRetry(false);
    } catch (setupError) {
      setSetupNeedsRetry(true);
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Setup could not be saved.",
      );
      return;
    }

    try {
      setActiveOperation("Resuming the exact setup execution…");
      const result = await resumeOneSetupExecution({
        siteId: createdSiteId,
        requestId: receipt.requestId,
        configurationRevision: receipt.configurationRevision,
      });
      if (result.state === "completed") {
        setSetupNeedsRetry(false);
        setNotice(
          `The first measured plan produced ${result.topicCount} topics. Managed connections remain pending until their canonical receipts verify.`,
        );
      } else if (result.state === "blocked") {
        setSetupNeedsRetry(true);
        setError(
          `The exact setup execution stopped safely (${result.blockerCode}). No paid plan was replayed.`,
        );
      } else {
        setSetupNeedsRetry(true);
        setNotice(
          `The saved setup execution is ${result.state.replace("_", " ")} (${result.reason}). Retry resumes the same receipt.`,
        );
      }
    } catch (pipelineError) {
      setSetupNeedsRetry(true);
      setNotice(
        pipelineError instanceof Error
          ? `The setup request is safe. Retry resumes its exact execution: ${pipelineError.message}`
          : "The setup request is safe. Retry resumes its exact execution.",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  async function startSetup() {
    if (!userId) {
      setError("Authentication is still loading. Try again in a moment.");
      return;
    }
    if (setupBlockers.length > 0) {
      setError(
        `Complete ${setupBlockers.length} required ${setupBlockers.length === 1 ? "item" : "items"}: ${setupBlockers.map((blocker) => blocker.message).join(" ")}`,
      );
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setActiveOperation(
        existingSite
          ? "Updating the existing tenant setup record…"
          : "Creating the tenant setup record…",
      );
      const createdSiteId = await upsertSite({
        ...(existingSite ? { id: existingSite._id } : {}),
        domain: domain.trim(),
        clerkUserId: userId,
        siteName: businessName.trim(),
        siteSummary: businessSummary.trim(),
        targetCountry: targetCountry.trim(),
        targetAudienceSummary: targetAudience.trim(),
        productUsage: productUsage.trim(),
        painPoints: painPoints
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 12),
        cadencePerWeek: cadence,
        publishMethod: publisherKind,
        // Site creation stays review-safe. saveOneSetupRequest atomically
        // applies Full Autopilot only with the versioned consent receipt.
        approvalRequired: true,
        autopilotEnabled: true,
        inferToneNiche: true,
        language: "en",
        ...(!existingSite ? { createOnly: true } : {}),
      });
      setSiteId(createdSiteId);
      await finishSetup(createdSiteId);
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Setup could not be created.",
      );
    } finally {
      setActiveOperation(null);
      setBusy(false);
    }
  }

  async function retrySetup() {
    if (!siteId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await finishSetup(siteId, setupReceipt);
    } finally {
      setActiveOperation(null);
      setBusy(false);
    }
  }

  function openPopup(url: string, name: string) {
    window.open(url, name, "width=600,height=720,popup=yes");
  }

  if (siteId) {
    const hasSelfManaged = true;
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-6 sm:py-10">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0EA5E9]">
            One Setup
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[#EDEEF1]">
            Setup progress
          </h1>
          <p className="mt-1 text-[12px] text-[#565A6E]">
            One view for website, cadence, publishing, measurement, and authority readiness.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/[0.06] px-4 py-3 text-[12px] text-[#F87171]">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-[#0EA5E9]/20 bg-[#0EA5E9]/[0.06] px-4 py-3 text-[12px] text-[#38BDF8]">
            {notice}
          </div>
        )}

        <SetupReadiness siteId={siteId} activeOperation={activeOperation} />

        {setupNeedsRetry && (
          <Button
            onClick={() => void retrySetup()}
            loading={busy}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            Retry saved setup
          </Button>
        )}

        {hasSelfManaged && (
          <details className="group rounded-xl border border-white/[0.06] bg-[#0F1117]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-[12px] font-medium text-[#8B8FA3]">
              <Settings2 className="h-3.5 w-3.5" />
              Advanced connection controls
              <ChevronDown className="ml-auto h-3.5 w-3.5 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-white/[0.04] px-5 py-4">
              <p className="mb-3 text-[10px] leading-relaxed text-[#565A6E]">
                These controls are only for accounts you chose to connect yourself.
                One Setup keeps provider authorization inside this guided flow.
              </p>
              <div className="flex flex-wrap gap-2">
                {publisherMode === "connect_existing" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      window.location.assign(`/sites/${siteId}?tab=settings`)
                    }
                    icon={<Upload className="h-3.5 w-3.5" />}
                  >
                    Publishing settings
                  </Button>
                )}
                {measurementMode === "connect_existing" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      openPopup(`/api/gsc/auth?siteId=${siteId}`, "gsc-connect")
                    }
                    icon={<BarChart3 className="h-3.5 w-3.5" />}
                  >
                    Connect search data
                  </Button>
                )}
                {outreachMode === "connect_existing" && outreachTransport === "gmail_oauth" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      openPopup(
                        `/api/outreach/gmail/auth?siteId=${siteId}`,
                        "outreach-connect",
                      )
                    }
                    icon={<Mail className="h-3.5 w-3.5" />}
                  >
                    Connect business mailbox
                  </Button>
                )}
                {outreachMode === "connect_existing" && outreachTransport === "smtp" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      window.location.assign("/backlinks?configure=smtp")
                    }
                    icon={<Mail className="h-3.5 w-3.5" />}
                  >
                    Configure SMTP mailbox
                  </Button>
                )}
              </div>
            </div>
          </details>
        )}

        <div className="flex justify-end">
          <Button
            disabled={busy}
            onClick={() => window.location.assign("/dashboard")}
            icon={<ArrowRight className="h-3.5 w-3.5" />}
          >
            Continue to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-6 sm:py-10">
      <div className="text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.09]">
          <Zap className="h-5 w-5 text-[#0EA5E9]" />
        </div>
        <h1 className="mt-3 text-xl font-semibold text-[#EDEEF1]">
          {existingSite ? "Finish One Setup" : "Set up Pentra once"}
        </h1>
        <p className="mx-auto mt-1 max-w-lg text-[12px] leading-relaxed text-[#565A6E]">
          {existingSite
            ? "Confirm this existing site's business, connections, and automation choices once. Pentra will preserve the same tenant and continue from durable receipts."
            : "Describe the business once, authorize each connection, and Pentra takes it from there."}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/[0.06] px-4 py-3 text-[12px] text-[#F87171]">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5 sm:p-6">
        <Input
          label="Website"
          placeholder="https://example.com"
          value={domain}
          readOnly={Boolean(existingSite)}
          onChange={(event) => setDomain(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy) void startSetup();
          }}
        />

        <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
          <div>
            <p className="text-[12px] font-medium text-[#EDEEF1]">
              Business and target market
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#707589]">
              This profile is stored with the tenant and gates every topic,
              article, and outreach decision. The website crawl can enrich it,
              but cannot silently replace what you state here.
            </p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Business or product name"
              placeholder="Acme Analytics"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
            />
            <Input
              label="Primary target country"
              placeholder="United States"
              value={targetCountry}
              onChange={(event) => setTargetCountry(event.target.value)}
            />
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[11px] font-medium text-[#8B8FA3]">
              What the business sells and why it is different
            </span>
            <textarea
              required
              minLength={20}
              maxLength={1200}
              value={businessSummary}
              onChange={(event) => setBusinessSummary(event.target.value)}
              placeholder="Describe the product, service, customer problem, and differentiators."
              className="min-h-24 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[12px] leading-relaxed text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[11px] font-medium text-[#8B8FA3]">
              Ideal customer
            </span>
            <textarea
              required
              minLength={10}
              maxLength={800}
              value={targetAudience}
              onChange={(event) => setTargetAudience(event.target.value)}
              placeholder="Who buys, their role, company type, and buying problem."
              className="min-h-20 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[12px] leading-relaxed text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[11px] font-medium text-[#8B8FA3]">
              How customers use it
            </span>
            <textarea
              required
              minLength={10}
              maxLength={800}
              value={productUsage}
              onChange={(event) => setProductUsage(event.target.value)}
              placeholder="Describe the workflow and outcome a successful customer gets."
              className="min-h-20 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[12px] leading-relaxed text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
            />
          </label>
          <Input
            label="Customer pain points (comma-separated)"
            placeholder="manual reporting, slow follow-up, unclear attribution"
            value={painPoints}
            onChange={(event) => setPainPoints(event.target.value)}
          />
        </div>

        <div className="mt-5 rounded-xl border border-[#0EA5E9]/15 bg-[#0EA5E9]/[0.04] p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.1]">
              <Sparkles className="h-4 w-4 text-[#38BDF8]" />
            </div>
            <div>
              <p className="text-[12px] font-medium text-[#EDEEF1]">
                One guided setup
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-[#8B8FA3]">
                Choose the exact publishing destination and sender path now.
                Provider authorization remains inside this guided flow, and
                every unfinished step keeps a durable blocker and automatic wake.
              </p>
            </div>
          </div>
        </div>

        <OneSetupAdapterChoices
          publisherKind={publisherKind}
          outreachTransport={outreachTransport}
          onPublisherChange={setPublisherKind}
          onOutreachTransportChange={setOutreachTransport}
        />

        <div className="mt-5">
          <label className="mb-2 block text-[11px] font-medium text-[#8B8FA3]">
            How many articles should Pentra publish?
          </label>
          <div className="flex flex-wrap gap-2">
            {cadenceOptions.filter((option) => option.value > 0).map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setCadence(option.value)}
                className={`rounded-lg px-3 py-2 text-[11px] font-medium transition ${
                  cadence === option.value
                    ? "bg-[#0EA5E9] text-white"
                    : "bg-white/[0.04] text-[#8B8FA3] hover:bg-white/[0.07]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="mt-3 block max-w-[220px]">
              <span className="mb-1.5 block text-[10px] text-[#8B8FA3]">
                Articles per week
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_AUTOPILOT_CADENCE_PER_WEEK}
                step={1}
                value={Number.isInteger(cadence) ? cadence : ""}
                onChange={(event) => setCadence(Number(event.target.value))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[12px] text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
              />
            </label>
          <p className="mt-2 text-[10px] leading-relaxed text-[#73788F]">
            {capacity === undefined || !capacity.ready
              ? "Verifying your plan and monthly article allowance…"
              : cadenceInputReady
                ? `${cadenceLabel(cadence)} is the target pace (up to ${cadenceMonthlyCost} articles in a 31-day month). ${capacity.availableMonthlyArticles} of ${capacity.maxArticles} account credits remain this UTC month. Pentra pauses automatically when the allowance is used and resumes after it renews.`
                : `Choose 1–${MAX_AUTOPILOT_CADENCE_PER_WEEK} articles per week. Cadence controls pace; your ${capacity.maxArticles}-article monthly plan controls total usage.`}
          </p>
        </div>

        <div className="mt-5 rounded-xl border border-[#22C55E]/15 bg-[#22C55E]/[0.04] p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-[#22C55E]/[0.1]">
              <Check className="h-3.5 w-3.5 text-[#4ADE80]" />
            </div>
            <div>
              <p className="text-[12px] font-medium text-[#4ADE80]">
                {automationMode === "full"
                  ? "Full Autopilot"
                  : "Assisted review"}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-[#8B8FA3]">
                {automationMode === "full"
                  ? "Pentra automatically researches, creates, quality-checks, publishes, measures, and adapts after the required production readiness gates verify. Authority outreach begins only after sender consent, mailbox, compliance, pacing, and runtime gates are all ready."
                  : "Pentra prepares work for your approval before publishing. Authority outreach remains separately controlled."}
              </p>
            </div>
          </div>
          {automationMode === "full" && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.06] bg-black/10 p-3">
              <input
                type="checkbox"
                checked={autopublishConsentAccepted}
                onChange={(event) =>
                  setAutopublishConsentAccepted(event.target.checked)
                }
                className="mt-0.5 h-4 w-4 rounded border-white/20 accent-[#0EA5E9]"
              />
              <span className="text-[10px] leading-relaxed text-[#A3A7B8]">
                {PUBLISHER_AUTOPUBLISH_CONSENT_TEXT}
              </span>
            </label>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-[#0EA5E9]/15 bg-[#0EA5E9]/[0.025] p-4">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#38BDF8]" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[#EDEEF1]">
                  Outreach sender details
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-[#8B8FA3]">
                  Outreach emails identify the sender and show a real postal
                  address in the footer. Enter a business address, registered
                  office, or postal mailbox where your business can receive
                  mail. Do not enter an email address.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Sender name"
                    placeholder="Person or business name"
                    value={managedSenderName}
                    onChange={(event) => setManagedSenderName(event.target.value)}
                  />
                  <Input
                    label="Postal address shown in email footers"
                    placeholder="Street or PO Box, city, postcode, country"
                    autoComplete="street-address"
                    value={managedPhysicalAddress}
                    onChange={(event) =>
                      setManagedPhysicalAddress(event.target.value)
                    }
                    error={managedPhysicalAddress.trim()
                      ? physicalAddressError
                      : undefined}
                  />
                  {outreachMode === "managed" && (
                    <Input
                      label="Secondary sending domain"
                      placeholder="outreach.example.com"
                      value={managedSenderDomain}
                      onChange={(event) =>
                        setManagedSenderDomain(event.target.value)
                      }
                    />
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {[
                    {
                      checked: confirmsSenderIdentityAndAddress,
                      setChecked: setConfirmsSenderIdentityAndAddress,
                      text: "I confirm the sender identity and physical mailing address are accurate and may be included in outreach.",
                    },
                    ...(outreachMode === "managed" ? [{
                      checked: confirmsDedicatedManagedSenderIdentity,
                      setChecked: setConfirmsDedicatedManagedSenderIdentity,
                      text: "I authorize Pentra to request a dedicated managed sender identity and its required sender-domain configuration.",
                    }] : []),
                    {
                      checked: authorizesManagedDeliveryEventCanary,
                      setChecked: setAuthorizesManagedDeliveryEventCanary,
                      text: "I authorize one signed delivery-status canary to verify bounce routing for this mailbox configuration.",
                    },
                    {
                      checked: confirmsSeparateAutomaticSendingConsent,
                      setChecked: setConfirmsSeparateAutomaticSendingConsent,
                      text: "I understand this setup does not authorize automatic sending; enabling that later requires a separate versioned consent.",
                    },
                  ].map((item) => (
                    <label
                      key={item.text}
                      className="flex cursor-pointer items-start gap-2 text-[10px] leading-relaxed text-[#8B8FA3]"
                    >
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(event) => item.setChecked(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-black/20 accent-[#0EA5E9]"
                      />
                      <span>{item.text}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
        </div>

        <details className="group mt-3 rounded-xl border border-white/[0.05] bg-white/[0.015]">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[10px] text-[#565A6E] hover:text-[#8B8FA3]">
            <Settings2 className="h-3 w-3" />
            Advanced setup options
            <ChevronDown className="h-3 w-3 transition group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-white/[0.04] px-4 pb-4 pt-3">
            <div>
              <p className="mb-2 text-[10px] font-medium text-[#73788F]">
                Integration ownership
              </p>
              <div className="space-y-3">
                {CAPABILITIES.filter((capability) => capability.key !== "publisher" && capability.key !== "measurement").map((capability) => {
                  const Icon = capability.icon;
                  return (
                    <div key={capability.key}>
                      <div className="mb-2 flex items-center gap-2">
                        <Icon className="h-3 w-3 text-[#8B8FA3]" />
                        <span className="text-[10px] text-[#8B8FA3]">
                          {capability.title}
                        </span>
                        <span className="text-[9px] text-[#565A6E]">
                          {capability.detail}
                        </span>
                      </div>
                      <div className="rounded-lg border border-[#0EA5E9]/15 bg-[#0EA5E9]/[0.04] px-3 py-2 text-[10px] leading-relaxed text-[#8B8FA3]">
                        Customer-managed SMTP/IMAP · approval only. Managed
                        sending remains beta-gated and cannot be selected in
                        bootstrap v1.
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[10px] font-medium text-[#73788F]">
                Content approval
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/[0.02] p-2">
                {(["full", "assisted"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAutomationMode(mode)}
                    className={`rounded-lg px-3 py-2 text-[10px] font-medium transition ${
                      automationMode === mode
                        ? "bg-[#0EA5E9]/15 text-[#38BDF8]"
                        : "text-[#565A6E] hover:bg-white/[0.03]"
                    }`}
                  >
                    {mode === "full" ? "Full Autopilot" : "Assisted review"}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[9px] leading-relaxed text-[#565A6E]">
              Automatic Medium and LinkedIn syndication is not available yet.
            </p>
          </div>
        </details>

        {setupBlockers.length > 0 && (
          <div
            id="one-setup-blockers"
            role="alert"
            className="mt-4 rounded-xl border border-[#F59E0B]/25 bg-[#F59E0B]/[0.06] p-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FBBF24]" />
              <div>
                <p className="text-[11px] font-medium text-[#FBBF24]">
                  Complete {setupBlockers.length} required {setupBlockers.length === 1 ? "item" : "items"} to continue
                </p>
                <ul className="mt-2 space-y-1 text-[10px] leading-relaxed text-[#A3A7B8]">
                  {setupBlockers.map((blocker) => (
                    <li key={blocker.key}>• {blocker.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <Button
          className="mt-5 w-full"
          onClick={() => void startSetup()}
          loading={busy}
          disabled={setupBlockers.length > 0}
          aria-describedby={setupBlockers.length > 0 ? "one-setup-blockers" : undefined}
          icon={<Globe className="h-3.5 w-3.5" />}
        >
          {busy
            ? existingSite
              ? "Finishing setup…"
              : "Starting setup…"
            : `${existingSite ? "Finish" : "Start"} one setup · ${cadenceLabel(cadence)}`}
        </Button>
      </div>
    </div>
  );
}
