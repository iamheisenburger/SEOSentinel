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
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Sites"
        subtitle="Configure your domain, tone, and publishing cadence"
      />

      {/* Site Form */}
      <div className="rounded-2xl border border-[#1E293B] bg-[#111827] p-6">
        <div className="grid gap-5 sm:grid-cols-2">
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
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                form.approvalRequired ? "bg-[#0EA5E9]" : "bg-[#1E293B]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  form.approvalRequired ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-medium text-[#F1F5F9]">
                Require approval before publishing
              </p>
              <p className="text-xs text-[#64748B]">
                Articles will be held at &ldquo;review&rdquo; status until you approve them
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            loading={busy}
            icon={<Save className="h-4 w-4" />}
          >
            Save site
          </Button>
          <Button
            variant="secondary"
            onClick={handleOnboard}
            disabled={!current || busy}
            icon={<RotateCw className="h-4 w-4" />}
          >
            Run onboarding crawl
          </Button>
          <Button
            variant="secondary"
            onClick={handlePlan}
            disabled={!current || busy}
            icon={<Map className="h-4 w-4" />}
          >
            Generate content plan
          </Button>
        </div>

        {/* Status message */}
        {message && (
          <div
            className={`mt-4 rounded-lg px-4 py-2.5 text-sm ${
              message.type === "success"
                ? "bg-[#22C55E]/10 text-[#4ADE80]"
                : message.type === "error"
                  ? "bg-[#EF4444]/10 text-[#F87171]"
                  : "bg-[#0EA5E9]/10 text-[#38BDF8]"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>

      {/* Current Site Info */}
      {current && (
        <div className="rounded-2xl border border-[#1E293B] bg-[#111827] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/10">
              <Globe className="h-5 w-5 text-[#0EA5E9]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#F1F5F9]">
                {current.domain}
              </h2>
              <p className="text-xs text-[#64748B]">
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
      <dt className="text-xs font-medium uppercase tracking-wider text-[#475569]">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-[#F1F5F9]">{value}</dd>
    </div>
  );
}
