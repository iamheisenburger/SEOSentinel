"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function PlanPage() {
  const sites = useQuery(api.sites.list);
  const site = sites?.[0];
  const topics = useQuery(
    api.topics.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const generatePlan = useAction(api.actions.pipeline.generatePlan);
  const [status, setStatus] = useState<string | null>(null);

  const grouped = useMemo(() => {
    if (!topics) return [];
    return [...topics].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }, [topics]);

  const handleGenerate = async () => {
    if (!site?._id) return;
    setStatus("Generating...");
    try {
      await generatePlan({ siteId: site._id });
      setStatus("New plan generated.");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate plan";
      setStatus(message);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background:radial-gradient(circle_at_20%_20%,rgba(74,222,128,0.14),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(59,130,246,0.12),transparent_30%),radial-gradient(circle_at_60%_78%,rgba(16,185,129,0.14),transparent_30%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-14">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.25em] text-emerald-300/90">
            Content plan
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            Clusters and topics to work through
          </h1>
          <p className="max-w-3xl text-base text-slate-300">
            Generate a plan after onboarding, then pick topics to turn into articles.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={!site}
              onClick={handleGenerate}
              className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              Generate plan
            </button>
            <Link
              href="/articles"
              className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:border-emerald-400 hover:text-emerald-200"
            >
              Go to articles
            </Link>
          </div>
          {status && <p className="text-sm text-emerald-200/90">Status: {status}</p>}
        </div>

        {!site && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Add a site first on <Link href="/sites" className="underline">Sites</Link>.
          </div>
        )}

        {grouped && grouped.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/70 shadow-2xl shadow-black/30 backdrop-blur">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-900/80 text-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Topic</th>
                  <th className="px-4 py-3 text-left font-semibold">Primary keyword</th>
                  <th className="px-4 py-3 text-left font-semibold">Secondary</th>
                  <th className="px-4 py-3 text-left font-semibold">Intent</th>
                  <th className="px-4 py-3 text-left font-semibold">Priority</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {grouped.map((topic) => (
                  <tr key={topic._id} className="text-slate-100">
                    <td className="px-4 py-3 font-medium">{topic.label}</td>
                    <td className="px-4 py-3 text-slate-200">{topic.primaryKeyword}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {topic.secondaryKeywords.join(", ")}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{topic.intent ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {topic.priority ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-emerald-200">
                      {topic.status ?? "planned"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800/70 bg-slate-900/70 p-6 text-sm text-slate-200 shadow-2xl shadow-black/30 backdrop-blur">
            No topics yet. Generate the plan to see clustered keywords.
          </div>
        )}
      </div>
    </main>
  );
}

