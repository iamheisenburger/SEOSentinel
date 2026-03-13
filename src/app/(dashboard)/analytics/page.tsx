"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useActiveSite } from "@/contexts/site-context";
import Link from "next/link";
import { useState } from "react";
import {
  BarChart3,
  MousePointerClick,
  Eye,
  Loader2,
  TrendingUp,
  Search,
  ArrowUpRight,
  ExternalLink,
  TrendingDown,
  ArrowRight,
} from "lucide-react";

export default function AnalyticsPage() {
  const { activeSite: site } = useActiveSite();
  const syncGSC = useAction(api.actions.gscSync.syncSite);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const gscSummary = useQuery(
    api.searchPerformance.getSummary,
    site?._id ? { siteId: site._id } : "skip",
  );
  const topQueries = useQuery(
    api.searchPerformance.getTopQueries,
    site?._id ? { siteId: site._id, limit: 50 } : "skip",
  );
  const decayingArticles = useQuery(
    api.articles.listDecaying,
    site?._id ? { siteId: site._id } : "skip",
  );

  const loading = gscSummary === undefined && site?._id;
  const gscConnected = !!site?.gscAccessToken;
  const hasGSC = !!gscSummary;

  // Segment queries by position
  const queries = topQueries ?? [];
  const top3 = queries.filter((q) => q.position <= 3);
  const top10 = queries.filter((q) => q.position > 3 && q.position <= 10);
  const strikingDistance = queries.filter((q) => q.position > 10 && q.position <= 20);
  const beyond20 = queries.filter((q) => q.position > 20);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#EDEEF1]">
            Analytics
          </h1>
          <p className="mt-1 text-[13px] text-[#565A6E]">
            Search performance from Google Search Console
          </p>
        </div>
        {hasGSC && (
          <p className="text-[11px] text-[#565A6E]">
            Last sync: {gscSummary.lastSync}
          </p>
        )}
      </div>

      {!gscConnected ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0F1117] py-16 px-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0EA5E9]/[0.08] mb-4">
            <BarChart3 className="h-7 w-7 text-[#0EA5E9]" />
          </div>
          <h2 className="text-[15px] font-semibold text-[#EDEEF1] mb-2">Connect Google Search Console</h2>
          <p className="text-[13px] text-[#565A6E] max-w-md text-center mb-3">
            See which keywords bring traffic to your site, track rankings over time, and automatically refresh declining content.
          </p>
          <button
            onClick={() => {
              if (!site?._id) return;
              const popup = window.open("/api/gsc/auth?siteId=" + site._id, "gsc-oauth", "width=600,height=700,popup=yes");
              if (!popup) return;
              const timer = setInterval(() => {
                if (popup.closed) {
                  clearInterval(timer);
                  window.location.reload();
                }
              }, 500);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0EA5E9] px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#0EA5E9]/90"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Connect Google Search Console
          </button>
          <p className="mt-3 text-[11px] text-[#565A6E] max-w-sm text-center">
            Sign in with the Google account that owns your site in{" "}
            <span className="text-[#8B8FA3]">search.google.com/search-console</span>.
            We only request read-only access.
          </p>
        </div>
      ) : !hasGSC ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[#22C55E]/[0.15] bg-[#22C55E]/[0.02] py-16 px-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#22C55E]/[0.08] mb-4">
            <BarChart3 className="h-7 w-7 text-[#22C55E]" />
          </div>
          <h2 className="text-[15px] font-semibold text-[#EDEEF1] mb-2">Google Search Console Connected</h2>
          {site?.gscProperty && (
            <p className="text-[12px] text-[#8B8FA3] mb-2">
              Property: <span className="text-[#EDEEF1] font-medium">{site.gscProperty}</span>
            </p>
          )}
          <p className="text-[13px] text-[#565A6E] max-w-md text-center mb-4">
            Your data will appear here after syncing. GSC data also syncs automatically every day.
          </p>
          <button
            disabled={syncing}
            onClick={async () => {
              if (!site?._id) return;
              setSyncing(true);
              setSyncError(null);
              try {
                await syncGSC({ siteId: site._id });
                window.location.reload();
              } catch (e) {
                setSyncError(e instanceof Error ? e.message : "Sync failed");
              } finally {
                setSyncing(false);
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0EA5E9] px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#0EA5E9]/90 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
          {syncError && (
            <p className="mt-2 text-[11px] text-[#EF4444]">{syncError}</p>
          )}
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <SummaryCard
              icon={<MousePointerClick className="h-3.5 w-3.5 text-[#0EA5E9]" />}
              label="Total Clicks"
              value={gscSummary.totalClicks.toLocaleString()}
            />
            <SummaryCard
              icon={<Eye className="h-3.5 w-3.5 text-[#22D3EE]" />}
              label="Impressions"
              value={gscSummary.totalImpressions.toLocaleString()}
            />
            <SummaryCard
              icon={<TrendingUp className="h-3.5 w-3.5 text-[#22C55E]" />}
              label="Avg CTR"
              value={`${gscSummary.avgCtr}%`}
            />
            <SummaryCard
              icon={<Search className="h-3.5 w-3.5 text-[#F59E0B]" />}
              label="Avg Position"
              value={gscSummary.avgPosition.toString()}
            />
            <SummaryCard
              icon={<BarChart3 className="h-3.5 w-3.5 text-[#A78BFA]" />}
              label="Keywords"
              value={gscSummary.queryCount.toString()}
            />
          </div>

          {/* Position Distribution */}
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
            <h2 className="text-[13px] font-semibold text-[#EDEEF1] mb-4">Ranking Distribution</h2>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <PositionBucket label="Top 3" count={top3.length} color="#22C55E" total={queries.length} />
              <PositionBucket label="Page 1 (4-10)" count={top10.length} color="#0EA5E9" total={queries.length} />
              <PositionBucket label="Striking Distance (11-20)" count={strikingDistance.length} color="#F59E0B" total={queries.length} />
              <PositionBucket label="Beyond Page 2" count={beyond20.length} color="#565A6E" total={queries.length} />
            </div>
          </div>

          {/* Content Health */}
          {decayingArticles && decayingArticles.length > 0 && (
            <div className="rounded-xl border border-[#EF4444]/[0.15] bg-[#EF4444]/[0.02] p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-[#EF4444]" />
                  <h2 className="text-[13px] font-semibold text-[#EDEEF1]">Declining Content</h2>
                </div>
                <Link href="/articles" className="text-[11px] text-[#565A6E] hover:text-[#8B8FA3] transition flex items-center gap-1">
                  View all <ArrowRight className="h-2.5 w-2.5" />
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {decayingArticles.slice(0, 5).map((article) => (
                  <Link
                    key={article._id}
                    href={`/articles/${article._id}`}
                    className="group flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] px-4 py-3 transition hover:bg-white/[0.04]"
                  >
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 ${
                      article.decayStatus === "declining"
                        ? "bg-[#EF4444]/[0.1] text-[#F87171]"
                        : "bg-[#F59E0B]/[0.1] text-[#FBBF24]"
                    }`}>
                      <TrendingDown className="h-2.5 w-2.5" />
                      {article.decayStatus === "declining" ? "Declining" : "Warning"}
                    </span>
                    <span className="text-[12px] text-[#EDEEF1] truncate flex-1">{article.title}</span>
                    {article.decayReason && (
                      <span className="text-[10px] text-[#565A6E] shrink-0 hidden sm:inline">{article.decayReason}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Striking Distance Opportunities */}
          {strikingDistance.length > 0 && (
            <div className="rounded-xl border border-[#F59E0B]/[0.15] bg-[#F59E0B]/[0.02] p-5">
              <div className="flex items-center gap-2 mb-1">
                <ArrowUpRight className="h-4 w-4 text-[#F59E0B]" />
                <h2 className="text-[13px] font-semibold text-[#EDEEF1]">Striking Distance</h2>
              </div>
              <p className="text-[11px] text-[#565A6E] mb-4">
                Keywords ranking 11-20 — a small push could get these to page 1
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Keyword</th>
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Position</th>
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Impressions</th>
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strikingDistance.slice(0, 10).map((q, i) => (
                      <tr key={i} className="border-b border-white/[0.03] last:border-0">
                        <td className="py-2.5 text-[12px] text-[#EDEEF1]">{q.query}</td>
                        <td className="py-2.5 text-[12px] text-[#F59E0B] text-right font-mono">{q.position}</td>
                        <td className="py-2.5 text-[12px] text-[#565A6E] text-right">{q.impressions.toLocaleString()}</td>
                        <td className="py-2.5 text-[12px] text-[#565A6E] text-right">{q.clicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* All Keywords Table */}
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
            <h2 className="text-[13px] font-semibold text-[#EDEEF1] mb-4">
              All Keywords <span className="font-normal text-[#565A6E]">({queries.length})</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">#</th>
                    <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Keyword</th>
                    <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Clicks</th>
                    <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Impressions</th>
                    <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">CTR</th>
                    <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Position</th>
                    <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Page</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.map((q, i) => (
                    <tr key={i} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition">
                      <td className="py-2.5 text-[11px] text-[#565A6E] font-mono">{i + 1}</td>
                      <td className="py-2.5 text-[12px] text-[#EDEEF1] max-w-[200px] truncate">{q.query}</td>
                      <td className="py-2.5 text-[12px] text-[#EDEEF1] text-right font-mono">{q.clicks}</td>
                      <td className="py-2.5 text-[12px] text-[#565A6E] text-right">{q.impressions.toLocaleString()}</td>
                      <td className="py-2.5 text-[12px] text-[#565A6E] text-right">{(q.ctr * 100).toFixed(1)}%</td>
                      <td className="py-2.5 text-right">
                        <span className={`text-[12px] font-mono ${
                          q.position <= 3
                            ? "text-[#22C55E]"
                            : q.position <= 10
                              ? "text-[#0EA5E9]"
                              : q.position <= 20
                                ? "text-[#F59E0B]"
                                : "text-[#565A6E]"
                        }`}>
                          {q.position}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {q.page && (
                          <a
                            href={q.page}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-[#565A6E] hover:text-[#8B8FA3] transition max-w-[150px] truncate"
                          >
                            {q.page.replace(/^https?:\/\//, "").split("/").slice(1).join("/").replace(/\/$/, "") || "/"}
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {queries.length === 0 && (
              <p className="text-center py-8 text-[12px] text-[#565A6E]">No keyword data yet. GSC data syncs daily.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">{label}</span>
      </div>
      <p className="text-xl font-bold text-[#EDEEF1]">{value}</p>
    </div>
  );
}

function PositionBucket({ label, count, color, total }: { label: string; count: number; color: string; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-[#EDEEF1]">{label}</span>
        <span className="text-[10px] text-[#565A6E]">{pct}%</span>
      </div>
      <p className="text-lg font-bold mb-2" style={{ color }}>{count}</p>
      <div className="h-1 w-full rounded-full bg-white/[0.04]">
        <div className="h-1 rounded-full transition-all" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color + "80" }} />
      </div>
    </div>
  );
}
