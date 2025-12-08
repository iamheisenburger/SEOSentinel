"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Id } from "../../../convex/_generated/dataModel";

export default function ArticlesPage() {
  const sites = useQuery(api.sites.list);
  const site = sites?.[0];
  const topics = useQuery(
    api.topics.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const articles = useQuery(
    api.articles.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const generateArticle = useAction(api.actions.pipeline.generateArticle);
  const suggestLinks = useAction(api.actions.pipeline.suggestInternalLinks);
  const updateStatus = useMutation(api.articles.updateStatus);

  const [status, setStatus] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<
    Id<"topic_clusters"> | undefined
  >(undefined);

  const availableTopics = useMemo(
    () =>
      (topics ?? []).filter(
        (t) => t.status !== "used" && t.status !== "queued",
      ),
    [topics],
  );

  const handleGenerate = async () => {
    if (!site?._id) return;
    setStatus("Generating article...");
    try {
      await generateArticle({
        siteId: site._id,
        topicId: selectedTopic,
      });
      setStatus("Draft created.");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate article";
      setStatus(message);
    }
  };

  const handleLinks = async (articleId: Id<"articles">) => {
    if (!site?._id) return;
    setStatus("Suggesting internal links...");
    try {
      await suggestLinks({ siteId: site._id, articleId });
      setStatus("Internal links generated.");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to suggest links";
      setStatus(message);
    }
  };

  const handlePublish = async (articleId: Id<"articles">) => {
    try {
      await updateStatus({ articleId, status: "published" });
      setStatus("Marked as published.");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to update status";
      setStatus(message);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background:radial-gradient(circle_at_18%_22%,rgba(74,222,128,0.15),transparent_30%),radial-gradient(circle_at_82%_12%,rgba(59,130,246,0.12),transparent_30%),radial-gradient(circle_at_58%_80%,rgba(16,185,129,0.14),transparent_32%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-14">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.25em] text-emerald-300/90">
            Articles
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            Generate drafts, review, and request internal links
          </h1>
          <p className="max-w-3xl text-base text-slate-300">
            Generate drafts from topics, review the markdown, and request internal links.
            Export manually to your CMS for now.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="rounded-full border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400"
              value={selectedTopic ?? ""}
              onChange={(e) =>
                setSelectedTopic(
                  e.target.value
                    ? (e.target.value as Id<"topic_clusters">)
                    : undefined,
                )
              }
            >
              <option value="">Pick topic (optional)</option>
              {availableTopics.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleGenerate}
              disabled={!site}
              className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              Generate article
            </button>
            <Link
              href="/plan"
              className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:border-emerald-400 hover:text-emerald-200"
            >
              Back to plan
            </Link>
          </div>
          {status && <p className="text-sm text-emerald-200/90">Status: {status}</p>}
        </div>

        {!site && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Add a site first on <Link href="/sites" className="underline">Sites</Link>.
          </div>
        )}

        {articles && articles.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/70 shadow-2xl shadow-black/30 backdrop-blur">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-900/80 text-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Title</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Slug</th>
                  <th className="px-4 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-100">
                {articles.map((article) => (
                  <tr key={article._id}>
                    <td className="px-4 py-3 font-medium">{article.title}</td>
                    <td className="px-4 py-3 text-emerald-200">{article.status}</td>
                    <td className="px-4 py-3 text-slate-200">{article.slug}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2 text-sm">
                        <button
                          onClick={() => handleLinks(article._id)}
                          className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-white transition hover:border-emerald-400 hover:text-emerald-200"
                        >
                          Links
                        </button>
                        <button
                          onClick={() => handlePublish(article._id)}
                          className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-white transition hover:border-emerald-400 hover:text-emerald-200"
                        >
                          Mark published
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800/70 bg-slate-900/70 p-6 text-sm text-slate-200 shadow-2xl shadow-black/30 backdrop-blur">
            No articles yet. Generate one from a topic to get started.
          </div>
        )}
      </div>
    </main>
  );
}

