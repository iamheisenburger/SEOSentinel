"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";

export default function SitesPage() {
  const sites = useQuery(api.sites.list);
  const upsert = useMutation(api.sites.upsert);
  const onboard = useAction(api.actions.pipeline.onboardSite);
  const generatePlan = useAction(api.actions.pipeline.generatePlan);

  const current = sites?.[0];
  const [form, setForm] = useState({
    domain: current?.domain ?? "",
    niche: current?.niche ?? "",
    tone: current?.tone ?? "",
    language: current?.language ?? "en",
    cadencePerWeek: current?.cadencePerWeek ?? 4,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      });
      setMessage("Saved");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Error saving";
      setMessage(message);
    } finally {
      setBusy(false);
    }
  };

  const handleOnboard = async () => {
    if (!current?._id) return;
    setBusy(true);
    setMessage("Running onboarding...");
    try {
      await onboard({ siteId: current._id });
      setMessage("Onboarding complete. Pages indexed.");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Onboarding failed";
      setMessage(message);
    } finally {
      setBusy(false);
    }
  };

  const handlePlan = async () => {
    if (!current?._id) return;
    setBusy(true);
    setMessage("Generating plan...");
    try {
      await generatePlan({ siteId: current._id });
      setMessage("Content plan generated.");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Plan generation failed";
      setMessage(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-slate-900">Sites</h1>
        <p className="text-slate-600">
          Add your primary domain, tone, and cadence. Then run onboarding to
          crawl and summarize your site, and generate the content plan.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-800">
            Domain
            <input
              className="rounded-md border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
              placeholder="example.com"
              value={form.domain}
              onChange={(e) =>
                setForm((f) => ({ ...f, domain: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-800">
            Niche / notes
            <input
              className="rounded-md border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
              placeholder="SaaS for dev tools"
              value={form.niche}
              onChange={(e) =>
                setForm((f) => ({ ...f, niche: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-800">
            Tone
            <input
              className="rounded-md border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
              placeholder="practical, concise"
              value={form.tone}
              onChange={(e) =>
                setForm((f) => ({ ...f, tone: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-800">
            Language
            <input
              className="rounded-md border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
              placeholder="en"
              value={form.language}
              onChange={(e) =>
                setForm((f) => ({ ...f, language: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-800">
            Cadence (posts/week)
            <input
              type="number"
              className="rounded-md border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
              value={form.cadencePerWeek}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  cadencePerWeek: Number(e.target.value),
                }))
              }
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={handleSave}
            disabled={busy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            Save site
          </button>
          <button
            onClick={handleOnboard}
            disabled={!current || busy}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-emerald-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Run onboarding crawl
          </button>
          <button
            onClick={handlePlan}
            disabled={!current || busy}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-emerald-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Generate content plan
          </button>
        </div>
        {message && (
          <p className="mt-3 text-sm text-slate-600">
            Status: <span className="font-semibold">{message}</span>
          </p>
        )}
      </div>

      {current && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Current site</h2>
          <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-800">Domain</dt>
              <dd>{current.domain}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Cadence</dt>
              <dd>{current.cadencePerWeek ?? 4} posts/week</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Niche</dt>
              <dd>{current.niche ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Tone</dt>
              <dd>{current.tone ?? "—"}</dd>
            </div>
          </dl>
        </div>
      )}
    </main>
  );
}

