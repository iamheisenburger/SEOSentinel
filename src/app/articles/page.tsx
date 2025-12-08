"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Id } from "convex/values";

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
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-slate-900">Articles</h1>
        <p className="text-slate-600">
          Generate drafts from topics, review the markdown, and request internal
          links. Export manually to your CMS for now.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
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
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            Generate article
          </button>
          <Link
            href="/plan"
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-emerald-200 hover:bg-slate-50"
          >
            Back to plan
          </Link>
        </div>
        {status && <p className="text-sm text-slate-600">Status: {status}</p>}
      </div>

      {!site && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Add a site first on <Link href="/sites" className="underline">Sites</Link>.
        </div>
      )}

      {articles && articles.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Title
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Slug
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {articles.map((article) => (
                <tr key={article._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {article.title}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{article.status}</td>
                  <td className="px-4 py-3 text-slate-600">{article.slug}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2 text-sm">
                      <button
                        onClick={() => handleLinks(article._id)}
                        className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-800 transition hover:border-emerald-200 hover:bg-slate-50"
                      >
                        Links
                      </button>
                      <button
                        onClick={() => handlePublish(article._id)}
                        className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-800 transition hover:border-emerald-200 hover:bg-slate-50"
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
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
          No articles yet. Generate one from a topic to get started.
        </div>
      )}
    </main>
  );
}

