"use client";

import { useAuth } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Globe,
  Link2,
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
  cadenceFitsMonthlyAllowance,
  cadenceLabel,
  cadenceOptionsForMonthlyLimit,
  defaultCadenceForMonthlyLimit,
} from "../../../convex/planLimits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetupReadiness } from "@/components/onboarding/setup-readiness";

type SetupMode = "connect_existing" | "managed";
type AutomationMode = "assisted" | "full";
type OneSetupReceipt = {
  requestId: Id<"managed_provisioning_requests">;
  revision: number;
};

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

function ModeChoice({
  value,
  onChange,
}: {
  value: SetupMode;
  onChange: (mode: SetupMode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange("managed")}
        className={`rounded-lg border px-3 py-2 text-left transition ${
          value === "managed"
            ? "border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.07]"
            : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
        }`}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#EDEEF1]">
          <Sparkles className="h-3 w-3 text-[#0EA5E9]" />
          Managed setup
        </span>
        <span className="mt-1 block text-[9px] leading-relaxed text-[#565A6E]">
          Pentra owns the setup queue
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange("connect_existing")}
        className={`rounded-lg border px-3 py-2 text-left transition ${
          value === "connect_existing"
            ? "border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.07]"
            : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
        }`}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#EDEEF1]">
          <Link2 className="h-3 w-3 text-[#8B8FA3]" />
          Connect existing
        </span>
        <span className="mt-1 block text-[9px] leading-relaxed text-[#565A6E]">
          Use an account you control
        </span>
      </button>
    </div>
  );
}

export function SetupWizard() {
  const { userId, isLoaded } = useAuth();
  const [domain, setDomain] = useState("");
  const [publisherMode, setPublisherMode] = useState<SetupMode>("managed");
  const [measurementMode, setMeasurementMode] = useState<SetupMode>("managed");
  const [outreachMode, setOutreachMode] = useState<SetupMode>("managed");
  const [automationMode, setAutomationMode] = useState<AutomationMode>("full");
  const [cadence, setCadence] = useState(0);
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
    isLoaded && userId ? {} : "skip",
  );
  const upsertSite = useMutation(api.sites.upsert);
  const saveOneSetupRequest = useMutation(api.sites.saveOneSetupRequest);
  const resumeOneSetupExecution = useAction(
    api.actions.pipeline.resumeOneSetupExecution,
  );

  const monthlyAllowance = capacity?.ready
    ? capacity.availableMonthlyArticles
    : 0;
  const cadenceOptions = cadenceOptionsForMonthlyLimit(monthlyAllowance);

  useEffect(() => {
    const next = defaultCadenceForMonthlyLimit(monthlyAllowance);
    setCadence((current) =>
      current === automaticCadence.current ||
        !cadenceFitsMonthlyAllowance(current, monthlyAllowance)
        ? next
        : current,
    );
    automaticCadence.current = next;
  }, [monthlyAllowance]);

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
          publisherMode,
          searchMeasurementMode: measurementMode,
          outreachMailboxMode: outreachMode,
          automationMode,
          requestedCadencePerWeek: cadence,
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
        requestRevision: receipt.revision,
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
    if (!domain.trim()) {
      setError("Enter your website URL.");
      return;
    }
    if (!capacity?.ready || cadence <= 0) {
      setError("Choose an active cadence after your plan capacity finishes loading.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setActiveOperation("Creating the tenant setup record…");
      const createdSiteId = await upsertSite({
        domain: domain.trim(),
        clerkUserId: userId,
        cadencePerWeek: cadence,
        publishMethod: "manual",
        approvalRequired: automationMode !== "full",
        autopilotEnabled: true,
        inferToneNiche: true,
        language: "en",
        createOnly: true,
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
    const hasSelfManaged = [publisherMode, measurementMode, outreachMode]
      .includes("connect_existing");
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
                Managed setup never asks you to edit DNS here.
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
                {outreachMode === "connect_existing" && (
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
          Set up Pentra once
        </h1>
        <p className="mx-auto mt-1 max-w-lg text-[12px] leading-relaxed text-[#565A6E]">
          Enter your website, choose who handles each connection, and select a
          cadence. Pentra tracks the rest in one readiness view.
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
          onChange={(event) => setDomain(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy) void startSetup();
          }}
        />

        <div className="mt-5 space-y-3">
          {CAPABILITIES.map((capability) => {
            const mode = capability.key === "publisher"
              ? publisherMode
              : capability.key === "measurement"
                ? measurementMode
                : outreachMode;
            const setMode = capability.key === "publisher"
              ? setPublisherMode
              : capability.key === "measurement"
                ? setMeasurementMode
                : setOutreachMode;
            const Icon = capability.icon;
            return (
              <div
                key={capability.key}
                className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-4"
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04]">
                    <Icon className="h-3.5 w-3.5 text-[#8B8FA3]" />
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-[#EDEEF1]">
                      {capability.title}
                    </p>
                    <p className="text-[10px] text-[#565A6E]">
                      {capability.detail}
                    </p>
                  </div>
                </div>
                <ModeChoice value={mode} onChange={setMode} />
              </div>
            );
          })}
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-[11px] font-medium text-[#8B8FA3]">
            Publishing cadence
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
          <p className="mt-2 text-[10px] text-[#565A6E]">
            {capacity === undefined || !capacity.ready
              ? "Verifying your account-wide cadence capacity…"
              : `${capacity.availableMonthlyArticles} of ${capacity.maxArticles} monthly articles are available for this website.`}
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
                  ? "Full Autopilot requested"
                  : "Assisted review requested"}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-[#8B8FA3]">
                {automationMode === "full"
                  ? "Recommended. Pentra may run unattended only after every required connection, plan, cadence, rollout, and consent receipt is real. This choice does not itself authorize outreach."
                  : "Assisted review keeps owner approval in the publishing path. Outreach still requires its own explicit authorization."}
              </p>
            </div>
          </div>
        </div>

        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-[10px] text-[#565A6E] hover:text-[#8B8FA3]">
            <Settings2 className="h-3 w-3" />
            Advanced automation control
            <ChevronDown className="h-3 w-3 transition group-open:rotate-180" />
          </summary>
          <div className="mt-1 grid grid-cols-2 gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2">
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
          <p className="mt-2 text-[9px] text-[#565A6E]">
            Automatic Medium and LinkedIn syndication is not available yet.
          </p>
        </details>

        <Button
          className="mt-5 w-full"
          onClick={() => void startSetup()}
          loading={busy}
          disabled={!capacity?.ready || cadence <= 0 || !domain.trim()}
          icon={<Globe className="h-3.5 w-3.5" />}
        >
          {busy ? "Starting setup…" : `Start one setup · ${cadenceLabel(cadence)}`}
        </Button>
      </div>
    </div>
  );
}
