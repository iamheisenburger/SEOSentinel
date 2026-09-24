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
  Target,
  Workflow,
  UserPlus,
  Rocket,
  BadgeDollarSign,
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
  const growthSummary = useQuery(
    api.seoGrowth.getSummary,
    site?._id ? { siteId: site._id } : "skip",
  );
  const outcomeCredential = useQuery(
    api.outcomes.getIngestCredentialStatus,
    site?._id ? { siteId: site._id } : "skip",
  );
  const outcomeSummary = useQuery(
    api.outcomes.getOutcomeSummary,
    site?._id ? { siteId: site._id } : "skip",
  );

  const gscConnected = !!site?.gscConnected;
  const gscGrowthEnabled = !!site?.gscGrowthEnabled;
  const hasGSC = !!gscSummary;
  const gscAuthUrl = site?._id ? `/api/gsc/auth?siteId=${site._id}` : null;
  // Legacy conversion tracking stays for older sites that report real data;
  // owner-reviewed sites and empty cohorts do not show it.
  const showOutcomes = site?.serviceMode !== "growth_first" &&
    !!outcomeCredential?.configured && !!outcomeSummary && outcomeSummary.organicLandingSessions > 0;
  // Only show a clicks goal the owner actually saved, never the default.
  const savedClicksGoal = growthSummary?.goal && "_id" in growthSummary.goal
    ? growthSummary.goal.monthlyOrganicClicksGoal : null;

  // Every ranked query lands in exactly one bucket, and the shares add up to
  // 100%. Queries without a usable position are left out of the total.
  const queries = topQueries ?? [];
  const rankedQueries = queries.filter((q) => Number.isFinite(q.position) && q.position >= 1);
  const top3 = rankedQueries.filter((q) => q.position <= 3);
  const top10 = rankedQueries.filter((q) => q.position > 3 && q.position <= 10);
  const pageTwo = rankedQueries.filter((q) => q.position > 10 && q.position <= 20);
  const beyond20 = rankedQueries.filter((q) => q.position > 20);
  const bucketShares = wholePercentages([top3.length, top10.length, pageTwo.length, beyond20.length]);
  // "Money pages": already visible in Google and close enough to page one's
  // top spots that a small improvement can bring real clicks.
  const closeToPageOne = rankedQueries
    .filter((q) => q.position >= 4 && q.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

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

      {showOutcomes && outcomeSummary && (
        <div className="rounded-xl border border-[#A78BFA]/[0.16] bg-[#A78BFA]/[0.025] p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[#A78BFA]" />
                <h2 className="text-[13px] font-semibold text-[#EDEEF1]">What Google visitors did next</h2>
              </div>
              <p className="mt-1 text-[11px] text-[#565A6E]">
                People who arrived on your articles from Google in the last 90 days, and how many signed up, started using your product, or paid.
              </p>
            </div>
            <Link href="/settings" className="text-[10px] font-medium text-[#A78BFA] hover:text-[#C4B5FD]">
              Integration settings
            </Link>
          </div>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <OutcomeMetric
              icon={<MousePointerClick className="h-3.5 w-3.5 text-[#0EA5E9]" />}
              label="Visits from Google"
              value={outcomeSummary.organicLandingSessions}
              rateLabel="Last 90 days"
            />
            <OutcomeMetric
              icon={<UserPlus className="h-3.5 w-3.5 text-[#22D3EE]" />}
              label="Signups"
              value={outcomeSummary.signups}
              rateLabel={`${(outcomeSummary.organicLandingToSignupRate * 100).toFixed(1)}% of visits`}
            />
            <OutcomeMetric
              icon={<Rocket className="h-3.5 w-3.5 text-[#F59E0B]" />}
              label="Activations"
              value={outcomeSummary.activations}
              rateLabel={`${(outcomeSummary.signupToActivationRate * 100).toFixed(1)}% of signups`}
            />
            <OutcomeMetric
              icon={<BadgeDollarSign className="h-3.5 w-3.5 text-[#22C55E]" />}
              label="Paid conversions"
              value={outcomeSummary.paidConversions}
              rateLabel={`${(outcomeSummary.organicLandingToPaidRate * 100).toFixed(1)}% of visits`}
            />
          </div>
        </div>
      )}

      {!gscConnected ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0F1117] py-16 px-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0EA5E9]/[0.08] mb-4">
            <BarChart3 className="h-7 w-7 text-[#0EA5E9]" />
          </div>
          <h2 className="text-[15px] font-semibold text-[#EDEEF1] mb-2">Connect Google Search Console</h2>
          <p className="text-[13px] text-[#565A6E] max-w-md text-center mb-3">
            See which searches bring people to your site, which pages are close to page one of Google, and which pages are slipping.
          </p>
          <a
            href={gscAuthUrl ?? "#"}
            aria-disabled={!gscAuthUrl}
            onClick={(event) => {
              if (!gscAuthUrl) {
                event.preventDefault();
                return;
              }
              const popup = window.open(gscAuthUrl, "gsc-oauth", "width=600,height=700,popup=yes");
              // If the browser blocks the popup, follow the link in this tab.
              if (!popup) return;
              event.preventDefault();
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
            Connect Search Console
          </a>
          <p className="mt-3 text-[11px] text-[#565A6E] max-w-sm text-center">
            Sign in with the Google account that owns your site in{" "}
            <span className="text-[#8B8FA3]">search.google.com/search-console</span>.
            Pentra reads performance/indexing data and can submit your sitemap. It cannot edit your website.
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
            Your data will appear here after syncing. Search Console data also updates automatically every day.
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
          {!gscGrowthEnabled && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[#F59E0B]/[0.18] bg-[#F59E0B]/[0.04] px-5 py-4">
              <p className="text-[12px] text-[#FBBF24]">
                Reconnect Search Console once so Pentra can ask Google to look again at pages that are not in search results yet.
              </p>
              <a
                href={gscAuthUrl ?? "#"}
                onClick={(event) => {
                  if (!gscAuthUrl) {
                    event.preventDefault();
                    return;
                  }
                  // Falls back to following the link if the popup is blocked.
                  if (window.open(gscAuthUrl, "gsc-oauth", "width=600,height=700,popup=yes")) event.preventDefault();
                }}
                className="shrink-0 rounded-lg bg-[#F59E0B] px-3 py-2 text-[11px] font-medium text-black"
              >
                Reconnect
              </a>
            </div>
          )}
          {/* Summary Cards */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <SummaryCard
              icon={<MousePointerClick className="h-3.5 w-3.5 text-[#0EA5E9]" />}
              label="Organic Clicks (28d)"
              value={gscSummary.totalClicks.toLocaleString()}
            />
            <SummaryCard
              icon={<Eye className="h-3.5 w-3.5 text-[#22D3EE]" />}
              label="Impressions (28d)"
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

          {/* How published articles are doing in Google */}
          <div className="rounded-xl border border-[#0EA5E9]/[0.15] bg-[#0EA5E9]/[0.02] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-[#0EA5E9]" />
                  <h2 className="text-[13px] font-semibold text-[#EDEEF1]">Your articles in Google</h2>
                </div>
                <p className="mt-1 text-[11px] text-[#565A6E]">
                  How your published articles are doing in Google search, updated after each Search Console sync.
                </p>
              </div>
              {growthSummary?.health && savedClicksGoal !== null && (
                <div className="flex items-center gap-2 text-[11px] text-[#8B8FA3]">
                  <Target className="h-3.5 w-3.5 text-[#22C55E]" />
                  {growthSummary.health.organicClicks.toLocaleString()} of your {growthSummary.health.monthlyOrganicClicksGoal.toLocaleString()} monthly clicks goal
                </div>
              )}
            </div>

            {growthSummary?.health ? (
              <>
                {savedClicksGoal !== null && (
                  <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden mb-4">
                    <div
                      className="h-full rounded-full bg-[#22C55E]/70 transition-all"
                      style={{ width: `${Math.min(100, Math.round(growthSummary.health.goalProgress * 100))}%` }}
                    />
                  </div>
                )}
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                  <GrowthMetric label="Getting clicks" value={growthSummary.health.stageCounts.performing} color="#22C55E" />
                  <GrowthMetric label="Close to page one" value={growthSummary.health.stageCounts.strikingDistance} color="#F59E0B" />
                  <GrowthMetric label="Not in search results yet" value={growthSummary.health.stageCounts.noVisibility} color="#F87171" />
                </div>
              </>
            ) : (
              <p className="text-[11px] text-[#565A6E]">
                This will fill in after the next Search Console sync.
              </p>
            )}
          </div>

          {/* Position Distribution */}
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
            <h2 className="text-[13px] font-semibold text-[#EDEEF1] mb-4">Ranking Distribution</h2>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <PositionBucket label="Top 3" count={top3.length} color="#22C55E" pct={bucketShares[0]} />
              <PositionBucket label="Page one (4-10)" count={top10.length} color="#0EA5E9" pct={bucketShares[1]} />
              <PositionBucket label="Page two (11-20)" count={pageTwo.length} color="#F59E0B" pct={bucketShares[2]} />
              <PositionBucket label="Beyond page two" count={beyond20.length} color="#565A6E" pct={bucketShares[3]} />
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

          {/* Pages close to page one: the pages most worth improving */}
          <div className="rounded-xl border border-[#F59E0B]/[0.15] bg-[#F59E0B]/[0.02] p-5">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="h-4 w-4 text-[#F59E0B]" />
              <h2 className="text-[13px] font-semibold text-[#EDEEF1]">Pages close to page one (positions 4–20)</h2>
            </div>
            <p className="text-[11px] text-[#565A6E] mb-4">
              Google already shows these pages, just not near the top. A small improvement can bring them more clicks.
            </p>
            {closeToPageOne.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Page and search</th>
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Position</th>
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Impressions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closeToPageOne.map((q, i) => (
                      <tr key={i} className="border-b border-white/[0.03] last:border-0">
                        <td className="py-2.5 pr-3">
                          {q.page ? (
                            <a
                              href={q.page}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-[260px] items-center gap-1 truncate text-[12px] text-[#EDEEF1] hover:text-white"
                            >
                              {pagePath(q.page)}
                              <ExternalLink className="h-2.5 w-2.5 shrink-0 text-[#565A6E]" />
                            </a>
                          ) : (
                            <span className="text-[12px] text-[#8B8FA3]">Page not reported</span>
                          )}
                          <p className="text-[11px] text-[#565A6E]">“{q.query}”</p>
                        </td>
                        <td className="py-2.5 text-[12px] text-[#F59E0B] text-right font-mono">{q.position}</td>
                        <td className="py-2.5 text-[12px] text-[#8B8FA3] text-right">{q.impressions.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12px] text-[#565A6E]">
                No pages are in positions 4–20 yet. They will show here as Google starts ranking your pages.
              </p>
            )}
          </div>

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
                            {pagePath(q.page)}
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
              <p className="text-center py-8 text-[12px] text-[#565A6E]">No keyword data yet. Search Console data updates daily.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Helpers ─── */

/** Whole-number shares of the total that always add up to exactly 100
 * (largest-remainder rounding), or all zeros when there is nothing to count. */
function wholePercentages(counts: number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((count) => (count / total) * 100);
  const shares = exact.map(Math.floor);
  let remaining = 100 - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of byRemainder) {
    if (remaining <= 0) break;
    shares[index] += 1;
    remaining -= 1;
  }
  return shares;
}

/** The path part of a page URL, e.g. "/blog/my-article" or "/" for the home page. */
function pagePath(url: string): string {
  return url.replace(/^https?:\/\/[^/]*/, "").replace(/\/$/, "") || "/";
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

function PositionBucket({ label, count, color, pct }: { label: string; count: number; color: string; pct: number }) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="min-w-0 text-[11px] text-[#EDEEF1]">{label}</span>
        <span className="shrink-0 text-[10px] text-[#565A6E]">{pct}%</span>
      </div>
      <p className="text-lg font-bold mb-2" style={{ color }}>{count}</p>
      <div className="h-1 w-full rounded-full bg-white/[0.04]">
        <div className="h-1 rounded-full transition-all" style={{ width: `${count > 0 ? Math.max(pct, 2) : 0}%`, backgroundColor: color + "80" }} />
      </div>
    </div>
  );
}

function GrowthMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[#565A6E]">{label}</p>
      <p className="mt-1 text-lg font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

function OutcomeMetric({
  icon,
  label,
  value,
  rateLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  rateLabel: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[10px] uppercase tracking-wider text-[#565A6E]">{label}</p>
      </div>
      <p className="mt-1 text-lg font-bold text-[#EDEEF1]">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-[10px] text-[#565A6E]">{rateLabel}</p>
    </div>
  );
}
