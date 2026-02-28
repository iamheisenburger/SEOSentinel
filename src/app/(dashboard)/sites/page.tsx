"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Globe,
  RotateCw,
  Map,
  Save,
  GitBranch,
  Sparkles,
  ShieldCheck,
  Gauge,
  Bot,
  FileSearch,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

export default function SitesPage() {
  const sites = useQuery(api.sites.list);
  const upsert = useMutation(api.sites.upsert);
  const onboard = useAction(api.actions.pipeline.onboardSite);
  const generatePlan = useAction(api.actions.pipeline.generatePlan);

  const current = sites?.[0];
  const [form, setForm] = useState({
    domain: "",
    niche: "",
    tone: "",
    language: "en",
    cadencePerWeek: 4,
    autopilotEnabled: true,
    inferToneNiche: true,
    approvalRequired: false,
    repoOwner: "",
    repoName: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error" | "info";
  } | null>(null);

  useEffect(() => {
    if (!current) return;
    setForm({
      domain: current.domain ?? "",
      niche: current.niche ?? "",
      tone: current.tone ?? "",
      language: current.language ?? "en",
      cadencePerWeek: current.cadencePerWeek ?? 4,
      autopilotEnabled: current.autopilotEnabled !== false,
      inferToneNiche: current.inferToneNiche !== false,
      approvalRequired: current.approvalRequired ?? false,
      repoOwner: current.repoOwner ?? "",
      repoName: current.repoName ?? "",
    });
  }, [current?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await upsert({
        id: current?._id,
        domain: form.domain,
        niche: form.niche || undefined,
        tone: form.tone || undefined,
        language: form.language || "en",
        cadencePerWeek: Number(form.cadencePerWeek),
        autopilotEnabled: form.autopilotEnabled,
        inferToneNiche: form.inferToneNiche,
        approvalRequired: form.approvalRequired,
        repoOwner: form.repoOwner || undefined,
        repoName: form.repoName || undefined,
      });
      setMessage({ text: "Settings saved", type: "success" });
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : "Error saving",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleOnboard = async () => {
    if (!current?._id) return;
    setBusy(true);
    setMessage({ text: "Running onboarding crawl...", type: "info" });
    try {
      await onboard({ siteId: current._id });
      setMessage({
        text: "Onboarding complete. Pages indexed.",
        type: "success",
      });
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : "Onboarding failed",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePlan = async () => {
    if (!current?._id) return;
    setBusy(true);
    setMessage({ text: "Generating content plan...", type: "info" });
    try {
      await generatePlan({ siteId: current._id });
      setMessage({ text: "Content plan generated.", type: "success" });
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : "Plan generation failed",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  if (sites === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
        </div>
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5"
          >
            <div className="h-4 w-32 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="h-10 animate-pulse rounded-lg bg-white/[0.03]" />
              <div className="h-10 animate-pulse rounded-lg bg-white/[0.03]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Settings"
        subtitle={
          current
            ? `Managing ${current.domain}`
            : "Configure your site to get started"
        }
        actions={
          <Button
            size="sm"
            onClick={handleSave}
            loading={busy}
            icon={<Save className="h-3.5 w-3.5" />}
          >
            Save changes
          </Button>
        }
      />

      {/* Status message */}
      {message && (
        <div
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] ${
            message.type === "success"
              ? "bg-[#22C55E]/[0.06] border border-[#22C55E]/[0.1] text-[#4ADE80]"
              : message.type === "error"
                ? "bg-[#EF4444]/[0.06] border border-[#EF4444]/[0.1] text-[#F87171]"
                : "bg-[#0EA5E9]/[0.06] border border-[#0EA5E9]/[0.1] text-[#38BDF8]"
          }`}
        >
          {message.type === "success" && (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          )}
          {message.type === "error" && (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          {message.type === "info" && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          )}
          {message.text}
        </div>
      )}

      {/* ── Section 1: Domain ── */}
      <SettingsSection
        icon={<Globe className="h-3.5 w-3.5 text-[#0EA5E9]" />}
        title="Domain"
        description="The website SEOSentinel monitors and writes content for."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Domain"
            placeholder="example.com"
            value={form.domain}
            onChange={(e) =>
              setForm((f) => ({ ...f, domain: e.target.value }))
            }
          />
          <Input
            label="Language"
            placeholder="en"
            value={form.language}
            onChange={(e) =>
              setForm((f) => ({ ...f, language: e.target.value }))
            }
          />
        </div>
      </SettingsSection>

      {/* ── Section 2: Content ── */}
      <SettingsSection
        icon={<Sparkles className="h-3.5 w-3.5 text-[#F59E0B]" />}
        title="Content"
        description="How articles are written — niche focus, voice, and style."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Niche / Industry"
            placeholder="AI SaaS, developer tools, etc."
            value={form.niche}
            onChange={(e) =>
              setForm((f) => ({ ...f, niche: e.target.value }))
            }
          />
          <Input
            label="Tone"
            placeholder="professional, practical, authoritative"
            value={form.tone}
            onChange={(e) =>
              setForm((f) => ({ ...f, tone: e.target.value }))
            }
          />
        </div>
        <Toggle
          checked={form.inferToneNiche}
          onChange={() =>
            setForm((f) => ({ ...f, inferToneNiche: !f.inferToneNiche }))
          }
          label="Auto-detect niche and tone"
          description="Let AI infer your niche and writing style from your site content"
        />
      </SettingsSection>

      {/* ── Section 3: Pipeline ── */}
      <SettingsSection
        icon={<Gauge className="h-3.5 w-3.5 text-[#22C55E]" />}
        title="Pipeline"
        description="Publishing cadence and automation preferences."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Articles per week"
            type="number"
            value={form.cadencePerWeek}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                cadencePerWeek: Number(e.target.value),
              }))
            }
          />
          <div /> {/* Spacer for grid alignment */}
        </div>
        <div className="flex flex-col gap-3">
          <Toggle
            checked={form.autopilotEnabled}
            onChange={() =>
              setForm((f) => ({
                ...f,
                autopilotEnabled: !f.autopilotEnabled,
              }))
            }
            label="Autopilot"
            description="Automatically generate and publish articles on schedule"
            icon={<Bot className="h-3.5 w-3.5" />}
          />
          <Toggle
            checked={form.approvalRequired}
            onChange={() =>
              setForm((f) => ({
                ...f,
                approvalRequired: !f.approvalRequired,
              }))
            }
            label="Require approval"
            description="Hold articles at review status until you manually approve"
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
          />
        </div>
      </SettingsSection>

      {/* ── Section 4: Publishing ── */}
      <SettingsSection
        icon={<GitBranch className="h-3.5 w-3.5 text-[#A78BFA]" />}
        title="Publishing"
        description="GitHub repository where articles are committed."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Repository owner"
            placeholder="your-github-username"
            value={form.repoOwner}
            onChange={(e) =>
              setForm((f) => ({ ...f, repoOwner: e.target.value }))
            }
          />
          <Input
            label="Repository name"
            placeholder="my-blog"
            value={form.repoName}
            onChange={(e) =>
              setForm((f) => ({ ...f, repoName: e.target.value }))
            }
          />
        </div>
      </SettingsSection>

      {/* ── Section 5: Actions ── */}
      {current && (
        <SettingsSection
          icon={<FileSearch className="h-3.5 w-3.5 text-[#0EA5E9]" />}
          title="Actions"
          description="Manually trigger pipeline steps."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOnboard}
              disabled={busy}
              icon={<RotateCw className="h-3.5 w-3.5" />}
            >
              Re-crawl site
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePlan}
              disabled={busy}
              icon={<Map className="h-3.5 w-3.5" />}
            >
              Generate topics
            </Button>
          </div>
        </SettingsSection>
      )}
    </div>
  );
}

/* ── Shared components ── */

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0F1117]">
      <div className="flex items-center gap-3 border-b border-white/[0.04] px-5 py-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04]">
          {icon}
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[#EDEEF1]">{title}</h3>
          <p className="text-[11px] text-[#565A6E]">{description}</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-5">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  icon,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
          checked ? "bg-[#0EA5E9]" : "bg-white/[0.08]"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 mt-0.5 ml-0.5 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <span className={checked ? "text-[#0EA5E9]" : "text-[#565A6E]"}>
            {icon}
          </span>
        )}
        <div>
          <p className="text-[13px] font-medium text-[#EDEEF1]">{label}</p>
          <p className="text-[11px] text-[#565A6E]">{description}</p>
        </div>
      </div>
    </div>
  );
}
