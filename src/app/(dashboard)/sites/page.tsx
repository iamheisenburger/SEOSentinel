"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Globe, RotateCw, Map, Save } from "lucide-react";

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
    approvalRequired: false,
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
      approvalRequired: current.approvalRequired ?? false,
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
        approvalRequired: form.approvalRequired,
      });
      setMessage({ text: "Site saved successfully", type: "success" });
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
      setMessage({ text: "Onboarding complete. Pages indexed.", type: "success" });
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sites"
        subtitle="Configure your domain, tone, and publishing cadence"
      />

      {/* Site Form */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
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
            label="Niche / Notes"
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
          <Input
            label="Language"
            placeholder="en"
            value={form.language}
            onChange={(e) =>
              setForm((f) => ({ ...f, language: e.target.value }))
            }
          />
          <Input
            label="Cadence (posts/week)"
            type="number"
            value={form.cadencePerWeek}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                cadencePerWeek: Number(e.target.value),
              }))
            }
          />

          {/* Approval toggle */}
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="button"
              role="switch"
              aria-checked={form.approvalRequired}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  approvalRequired: !f.approvalRequired,
                }))
              }
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                form.approvalRequired ? "bg-[#0EA5E9]" : "bg-white/[0.08]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 mt-0.5 ml-0.5 ${
                  form.approvalRequired ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <div>
              <p className="text-[13px] font-medium text-[#EDEEF1]">
                Require approval before publishing
              </p>
              <p className="text-[11px] text-[#565A6E]">
                Articles will be held at &ldquo;review&rdquo; status until you approve them
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            loading={busy}
            icon={<Save className="h-3.5 w-3.5" />}
          >
            Save site
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOnboard}
            disabled={!current || busy}
            icon={<RotateCw className="h-3.5 w-3.5" />}
          >
            Run onboarding crawl
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePlan}
            disabled={!current || busy}
            icon={<Map className="h-3.5 w-3.5" />}
          >
            Generate content plan
          </Button>
        </div>

        {/* Status message */}
        {message && (
          <div
            className={`mt-4 rounded-lg px-3 py-2 text-[13px] ${
              message.type === "success"
                ? "bg-[#22C55E]/[0.08] text-[#4ADE80]"
                : message.type === "error"
                  ? "bg-[#EF4444]/[0.08] text-[#F87171]"
                  : "bg-[#0EA5E9]/[0.08] text-[#38BDF8]"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>

      {/* Current Site Info */}
      {current && (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.08]">
              <Globe className="h-4 w-4 text-[#0EA5E9]" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#EDEEF1]">
                {current.domain}
              </h2>
              <p className="text-[11px] text-[#565A6E]">
                {current.autopilotEnabled !== false ? "Autopilot enabled" : "Manual mode"}
              </p>
            </div>
            <StatusBadge
              status={current.autopilotEnabled !== false ? "running" : "pending"}
              className="ml-auto"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoBlock label="Niche" value={current.niche ?? "—"} />
            <InfoBlock label="Tone" value={current.tone ?? "—"} />
            <InfoBlock label="Language" value={current.language ?? "en"} />
            <InfoBlock
              label="Cadence"
              value={`${current.cadencePerWeek ?? 4} posts/week`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-[#EDEEF1]">{value}</dd>
    </div>
  );
}
