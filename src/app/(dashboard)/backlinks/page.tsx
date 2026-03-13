"use client";

import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useActiveSite } from "@/contexts/site-context";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  Link2,
  Search,
  Globe,
  TrendingUp,
  ExternalLink,
  Mail,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Shield,
  Anchor,
  ArrowRight,
} from "lucide-react";

interface BacklinkProfile {
  totalBacklinks: number;
  referringDomains: number;
  domainAuthority: number;
  topReferrers: Array<{ domain: string; backlinks: number; rank: number }>;
  anchorDistribution: Array<{ anchor: string; count: number }>;
}

interface OutreachEmail {
  to: string;
  subject: string;
  body: string;
}

export default function BacklinksPage() {
  const { activeSite: site } = useActiveSite();

  const analyzeBacklinks = useAction(api.actions.backlinks.analyzeBacklinks);
  const generateOutreach = useAction(api.actions.backlinks.generateOutreach);

  const [profile, setProfile] = useState<BacklinkProfile | null>(null);
  const [opportunities, setOpportunities] = useState<Array<{ type: string; sourceDomain: string; sourceUrl: string; context: string }>>([]);
  const [outreachEmails, setOutreachEmails] = useState<OutreachEmail[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingOutreach, setGeneratingOutreach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "outreach">("overview");

  const handleAnalyze = async () => {
    if (!site?._id) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeBacklinks({ siteId: site._id });
      if (result.profile) {
        setProfile(result.profile as unknown as BacklinkProfile);
      }
      // Collect opportunities from mentions and broken links
      const opps: Array<{ type: string; sourceDomain: string; sourceUrl: string; context: string }> = [];
      if (result.mentions) {
        for (const m of result.mentions as Array<{ sourceDomain: string; sourceUrl: string; mentionText: string }>) {
          opps.push({ type: "mention", sourceDomain: m.sourceDomain, sourceUrl: m.sourceUrl, context: m.mentionText });
        }
      }
      if (result.brokenLinks) {
        for (const b of result.brokenLinks as Array<{ sourceDomain: string; sourceUrl: string; brokenUrl: string }>) {
          opps.push({ type: "broken_link", sourceDomain: b.sourceDomain, sourceUrl: b.sourceUrl, context: b.brokenUrl });
        }
      }
      setOpportunities(opps);
      if (!result.profile && opps.length === 0) {
        setError("No backlink data found. This may require DataForSEO credentials to be configured.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed. Make sure DataForSEO credentials are configured.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleOutreach = async () => {
    if (!site?._id || opportunities.length === 0) return;
    setGeneratingOutreach(true);
    setError(null);
    try {
      const result = await generateOutreach({
        siteId: site._id,
        opportunities: opportunities.slice(0, 5),
      });
      setOutreachEmails((result as { emails: OutreachEmail[] }).emails ?? []);
      setActiveTab("outreach");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Outreach generation failed");
    } finally {
      setGeneratingOutreach(false);
    }
  };

  const copyEmail = (idx: number) => {
    const email = outreachEmails[idx];
    navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#EDEEF1]">
            Backlinks
          </h1>
          <p className="mt-1 text-[13px] text-[#565A6E]">
            Analyze your link profile and generate outreach emails
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleOutreach}
            loading={generatingOutreach}
            disabled={opportunities.length === 0}
            icon={<Mail className="h-3.5 w-3.5" />}
          >
            Generate Outreach
          </Button>
          <Button
            onClick={handleAnalyze}
            loading={analyzing}
            icon={<Search className="h-3.5 w-3.5" />}
          >
            Analyze Backlinks
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-[#EF4444]/[0.2] bg-[#EF4444]/[0.05] px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-[#EF4444]" />
          <p className="text-[13px] text-[#F87171]">{error}</p>
        </div>
      )}

      {/* Tabs */}
      {(profile || outreachEmails.length > 0) && (
        <div className="flex gap-1 rounded-lg bg-white/[0.02] border border-white/[0.06] p-1 w-fit">
          <button
            onClick={() => setActiveTab("overview")}
            className={`rounded-md px-4 py-1.5 text-[12px] font-medium transition ${
              activeTab === "overview"
                ? "bg-white/[0.06] text-[#EDEEF1]"
                : "text-[#565A6E] hover:text-[#8B8FA3]"
            }`}
          >
            Link Profile
          </button>
          <button
            onClick={() => setActiveTab("outreach")}
            className={`rounded-md px-4 py-1.5 text-[12px] font-medium transition ${
              activeTab === "outreach"
                ? "bg-white/[0.06] text-[#EDEEF1]"
                : "text-[#565A6E] hover:text-[#8B8FA3]"
            }`}
          >
            Outreach
            {outreachEmails.length > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0EA5E9]/[0.15] px-1 text-[9px] font-bold text-[#0EA5E9]">
                {outreachEmails.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* No data state */}
      {!profile && outreachEmails.length === 0 && !analyzing && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0F1117] py-16 px-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0EA5E9]/[0.08] mb-4">
            <Link2 className="h-7 w-7 text-[#0EA5E9]" />
          </div>
          <h2 className="text-[15px] font-semibold text-[#EDEEF1] mb-2">Analyze Your Backlink Profile</h2>
          <p className="text-[13px] text-[#565A6E] max-w-md text-center mb-5">
            Discover who links to your site, find broken link opportunities, and generate personalized outreach emails to build more links.
          </p>
          <Button
            onClick={handleAnalyze}
            loading={analyzing}
            icon={<Search className="h-3.5 w-3.5" />}
          >
            Start Analysis
          </Button>
        </div>
      )}

      {/* Loading */}
      {analyzing && !profile && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0F1117] py-16">
          <Loader2 className="h-8 w-8 text-[#0EA5E9] animate-spin mb-4" />
          <p className="text-[13px] text-[#565A6E]">Analyzing backlink profile for {site?.domain}...</p>
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === "overview" && profile && (
        <>
          {/* Summary */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Link2 className="h-3.5 w-3.5 text-[#0EA5E9]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Total Backlinks</span>
              </div>
              <p className="text-xl font-bold text-[#EDEEF1]">{profile.totalBacklinks.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Globe className="h-3.5 w-3.5 text-[#22D3EE]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Referring Domains</span>
              </div>
              <p className="text-xl font-bold text-[#EDEEF1]">{profile.referringDomains.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Shield className="h-3.5 w-3.5 text-[#22C55E]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Domain Authority</span>
              </div>
              <p className="text-xl font-bold text-[#EDEEF1]">{profile.domainAuthority}</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-[#22C55E]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Link Ratio</span>
              </div>
              <p className="text-xl font-bold text-[#EDEEF1]">{profile.referringDomains > 0 ? (profile.totalBacklinks / profile.referringDomains).toFixed(1) : "0"}</p>
            </div>
          </div>

          {/* Top Referrers */}
          {profile.topReferrers.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
              <h2 className="text-[13px] font-semibold text-[#EDEEF1] mb-4">Top Referring Domains</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Domain</th>
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Backlinks</th>
                      <th className="pb-2 text-[10px] font-medium uppercase tracking-wider text-[#565A6E] text-right">Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.topReferrers.map((r, i) => (
                      <tr key={i} className="border-b border-white/[0.03] last:border-0">
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <Globe className="h-3 w-3 text-[#565A6E]" />
                            <span className="text-[12px] text-[#EDEEF1]">{r.domain}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-[12px] text-[#0EA5E9] text-right font-mono">{r.backlinks}</td>
                        <td className="py-2.5 text-[12px] text-[#565A6E] text-right">{r.rank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Anchor Text Distribution */}
          {profile.anchorDistribution.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Anchor className="h-4 w-4 text-[#0EA5E9]" />
                <h2 className="text-[13px] font-semibold text-[#EDEEF1]">Anchor Text Distribution</h2>
              </div>
              <div className="flex flex-col gap-2">
                {(() => {
                const totalAnchors = profile.anchorDistribution.reduce((s, a) => s + a.count, 0) || 1;
                return profile.anchorDistribution.slice(0, 10).map((a, i) => {
                  const pct = Math.round((a.count / totalAnchors) * 100);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[12px] text-[#EDEEF1] truncate w-48 shrink-0">{a.anchor || "(empty)"}</span>
                      <div className="flex-1 h-2 rounded-full bg-white/[0.04]">
                        <div
                          className="h-2 rounded-full bg-[#0EA5E9]/40"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-[#565A6E] w-12 text-right shrink-0">{pct}%</span>
                      <span className="text-[10px] text-[#565A6E] w-10 text-right shrink-0">{a.count}</span>
                    </div>
                  );
                });
              })()}
              </div>
            </div>
          )}
        </>
      )}

      {/* Outreach Tab */}
      {activeTab === "outreach" && outreachEmails.length > 0 && (
        <div className="flex flex-col gap-3">
          {outreachEmails.map((email, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-[#0EA5E9]" />
                  <span className="text-[12px] font-medium text-[#EDEEF1]">{email.to}</span>
                </div>
                <button
                  onClick={() => copyEmail(i)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-[#8B8FA3] transition hover:bg-white/[0.08] hover:text-white"
                >
                  {copiedIdx === i ? (
                    <>
                      <Check className="h-3 w-3 text-[#22C55E]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-4">
                <p className="text-[11px] text-[#565A6E] mb-1">Subject:</p>
                <p className="text-[13px] text-[#EDEEF1] mb-3 font-medium">{email.subject}</p>
                <p className="text-[11px] text-[#565A6E] mb-1">Body:</p>
                <p className="text-[12px] text-[#EDEEF1] whitespace-pre-line leading-relaxed">{email.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "outreach" && outreachEmails.length === 0 && !generatingOutreach && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0F1117] py-12">
          <Mail className="h-8 w-8 text-[#565A6E]/30 mb-3" />
          <p className="text-[13px] text-[#565A6E] mb-4">No outreach emails generated yet</p>
          <Button
            onClick={handleOutreach}
            loading={generatingOutreach}
            disabled={opportunities.length === 0}
            icon={<Mail className="h-3.5 w-3.5" />}
          >
            Generate Outreach Emails
          </Button>
        </div>
      )}
    </div>
  );
}
