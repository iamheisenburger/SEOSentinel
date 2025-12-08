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
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-slate-900">Content plan</h1>
        <p className="text-slate-600">
          Clusters and topics to work through. Generate a plan after onboarding,
          then pick topics to turn into articles.
        </p>
        <div className="flex gap-3">
          <button
            disabled={!site}
            onClick={handleGenerate}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            Generate plan
          </button>
          <Link
            href="/articles"
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-emerald-200 hover:bg-slate-50"
          >
            Go to articles
          </Link>
        </div>
        {status && <p className="text-sm text-slate-600">Status: {status}</p>}
      </div>

      {!site && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Add a site first on <Link href="/sites" className="underline">Sites</Link>.
        </div>
      )}

      {grouped && grouped.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Topic
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Primary keyword
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Secondary
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Intent
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Priority
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grouped.map((topic) => (
                <tr key={topic._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {topic.label}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {topic.primaryKeyword}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {topic.secondaryKeywords.join(", ")}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{topic.intent ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {topic.priority ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {topic.status ?? "planned"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
          No topics yet. Generate the plan to see clustered keywords.
        </div>
      )}
    </main>
  );
}

