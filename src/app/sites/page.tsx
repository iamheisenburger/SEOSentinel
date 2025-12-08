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
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background:radial-gradient(circle_at_15%_20%,rgba(74,222,128,0.18),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(59,130,246,0.15),transparent_28%),radial-gradient(circle_at_60%_80%,rgba(16,185,129,0.16),transparent_28%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.25em] text-emerald-300/90">
            Sites
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl text-white">Your site profile</h1>
          <p className="max-w-3xl text-base text-slate-300">
            Add your primary domain, tone, and cadence. Run onboarding to crawl and
            summarize your site, then generate a content plan.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-200">
              Domain
              <input
                className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-white outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/50"
                placeholder="example.com"
                value={form.domain}
                onChange={(e) =>
                  setForm((f) => ({ ...f, domain: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-200">
              Niche / notes
              <input
                className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-white outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/50"
                placeholder="SaaS for dev tools"
                value={form.niche}
                onChange={(e) =>
                  setForm((f) => ({ ...f, niche: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-200">
              Tone
              <input
                className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-white outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/50"
                placeholder="practical, concise"
                value={form.tone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tone: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-200">
              Language
              <input
                className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-white outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/50"
                placeholder="en"
                value={form.language}
                onChange={(e) =>
                  setForm((f) => ({ ...f, language: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-200">
              Cadence (posts/week)
              <input
                type="number"
                className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-white outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/50"
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

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={handleSave}
              disabled={busy}
              className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              Save site
            </button>
            <button
              onClick={handleOnboard}
              disabled={!current || busy}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run onboarding crawl
            </button>
            <button
              onClick={handlePlan}
              disabled={!current || busy}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate content plan
            </button>
          </div>
          {message && (
            <p className="mt-3 text-sm text-emerald-200/90">
              Status: <span className="font-semibold">{message}</span>
            </p>
          )}
        </div>

        {current && (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-2xl shadow-black/30 backdrop-blur">
            <h2 className="text-lg font-semibold text-white">Current site</h2>
            <dl className="mt-3 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-300">Domain</dt>
                <dd className="text-slate-100">{current.domain}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-300">Cadence</dt>
                <dd className="text-slate-100">
                  {current.cadencePerWeek ?? 4} posts/week
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-300">Niche</dt>
                <dd className="text-slate-100">{current.niche ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-300">Tone</dt>
                <dd className="text-slate-100">{current.tone ?? "—"}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </main>
  );
}

