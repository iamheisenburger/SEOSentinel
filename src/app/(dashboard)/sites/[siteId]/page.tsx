"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Globe,
  FileText,
  Target,
  Settings,
  Trash2,
  ArrowRight,
  ArrowLeft,
  Clock,
  Zap,
  Palette,
  Users,
  LayoutDashboard,
  Plus,
  X,
  Check,
  Save,
  Upload,
  GitBranch,
  Webhook,
  Copy,
  Shield,
  KeyRound,
} from "lucide-react";
import Link from "next/link";
import { ArticleProgress } from "@/components/ui/article-progress";
import { formatDistanceToNow } from "date-fns";

type Tab = "overview" | "articles" | "settings";

export default function SiteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const siteId = params.siteId as Id<"sites">;
  const site = useQuery(api.sites.get, { siteId });
  const articles = useQuery(api.articles.listBySite, { siteId });
  const topics = useQuery(api.topics.listBySite, { siteId });
  const deleteSite = useMutation(api.sites.deleteSite);
  const deleteArticle = useMutation(api.articles.deleteArticle);
  const updateSite = useMutation(api.sites.updateSite);

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Settings state ──
  const [settingsInitialized, setSettingsInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable fields
  const [siteName, setSiteName] = useState("");
  const [niche, setNiche] = useState("");
  const [tone, setTone] = useState("");
  const [language, setLanguage] = useState("");
  const [cadence, setCadence] = useState(4);
  const [autopilot, setAutopilot] = useState(true);
  const [approval, setApproval] = useState(false);
  const [ctaText, setCtaText] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [urlStructure, setUrlStructure] = useState("");
  const [externalLinking, setExternalLinking] = useState(true);
  const [sourceCitations, setSourceCitations] = useState(true);
  const [youtubeEmbeds, setYoutubeEmbeds] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [targetCountry, setTargetCountry] = useState("");
  const [audienceSummary, setAudienceSummary] = useState("");
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);

  // Initialize settings from site data (once)
  if (site && !settingsInitialized) {
    setSiteName(site.siteName ?? "");
    setNiche(site.niche ?? "");
    setTone(site.tone ?? "");
    setLanguage(site.language ?? "en");
    setCadence(site.cadencePerWeek ?? 4);
    setAutopilot(site.autopilotEnabled !== false);
    setApproval(site.approvalRequired ?? false);
    setCtaText(site.ctaText ?? "");
    setCtaUrl(site.ctaUrl ?? "");
    setUrlStructure(site.urlStructure ?? "/blog/[slug]");
    setExternalLinking(site.externalLinking !== false);
    setSourceCitations(site.sourceCitations !== false);
    setYoutubeEmbeds(site.youtubeEmbeds ?? false);
    setPrimaryColor(site.brandPrimaryColor ?? "");
    setAccentColor(site.brandAccentColor ?? "");
    setFontFamily(site.brandFontFamily ?? "");
    setTargetCountry(site.targetCountry ?? "");
    setAudienceSummary(site.targetAudienceSummary ?? "");
    setPainPoints(site.painPoints ?? []);
    setCompetitors(site.competitors ?? []);
    setKeywords(site.anchorKeywords ?? []);
    setSettingsInitialized(true);
  }

  if (site === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <div className="h-6 w-48 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-4 w-32 animate-pulse rounded bg-white/[0.03]" />
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-8">
          <div className="h-40 animate-pulse rounded-lg bg-white/[0.03]" />
        </div>
      </div>
    );
  }

  if (site === null) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <Globe className="h-10 w-10 text-[#565A6E]/30" />
        <p className="text-[13px] text-[#565A6E]">Website not found.</p>
        <Button size="sm" onClick={() => router.push("/sites")}>
          Back to Websites
        </Button>
      </div>
    );
  }

  const articleCount = articles?.length ?? 0;
  const topicCount = topics?.length ?? 0;
  const publishedCount = articles?.filter((a) => a.status === "published").length ?? 0;
  const draftCount = articles?.filter((a) => a.status === "draft").length ?? 0;
  const reviewCount = articles?.filter((a) => a.status === "review").length ?? 0;
  const brandColor = site.brandPrimaryColor || "#0EA5E9";

  const handleDeleteSite = async () => {
    setDeleting(true);
    try {
      await deleteSite({ siteId });
      router.push("/sites");
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateSite({
        siteId,
        siteName: siteName || undefined,
        niche: niche || undefined,
        tone: tone || undefined,
        language: language || undefined,
        cadencePerWeek: cadence,
        autopilotEnabled: autopilot,
        approvalRequired: approval,
        ctaText: ctaText || undefined,
        ctaUrl: ctaUrl || undefined,
        urlStructure: urlStructure || undefined,
        externalLinking,
        sourceCitations,
        youtubeEmbeds,
        brandPrimaryColor: primaryColor || undefined,
        brandAccentColor: accentColor || undefined,
        brandFontFamily: fontFamily || undefined,
        targetCountry: targetCountry || undefined,
        targetAudienceSummary: audienceSummary || undefined,
        painPoints: painPoints.length > 0 ? painPoints : undefined,
        competitors: competitors.length > 0 ? competitors : undefined,
        anchorKeywords: keywords.length > 0 ? keywords : undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof Globe }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "articles", label: "Articles", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => router.push("/sites")}
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-[#565A6E] hover:text-[#EDEEF1] transition shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
              style={{ backgroundColor: `${brandColor}15` }}
            >
              <Globe className="h-4.5 w-4.5" style={{ color: brandColor }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-[16px] font-semibold text-[#EDEEF1] truncate">
                  {site.siteName || site.domain}
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#22C55E]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#4ADE80] shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                  Active
                </span>
              </div>
              <p className="text-[11px] text-[#565A6E] truncate">
                {site.domain}
                {site.siteType ? ` · ${site.siteType}` : ""}
              </p>
            </div>
          </div>
        </div>

        {/* Delete */}
        {showDeleteConfirm ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="text-[11px] text-[#8B8FA3] hover:text-[#EDEEF1] transition"
            >
              Cancel
            </button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteSite}
              loading={deleting}
              icon={<Trash2 className="h-3 w-3" />}
            >
              Delete Site
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-[#565A6E] hover:text-[#EF4444] hover:border-[#EF4444]/20 transition shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-white/[0.06]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                relative flex items-center gap-2 px-4 pb-2.5 pt-1 text-[13px] font-medium transition-colors
                ${active ? "text-[#EDEEF1]" : "text-[#565A6E] hover:text-[#8B8FA3]"}
              `}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? "text-[#0EA5E9]" : ""}`} />
              <span className="hidden sm:inline">{tab.label}</span>
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-[#0EA5E9]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab
          siteId={siteId}
          site={site}
          articleCount={articleCount}
          topicCount={topicCount}
          publishedCount={publishedCount}
          draftCount={draftCount}
          reviewCount={reviewCount}
          brandColor={brandColor}
          onTabChange={setActiveTab}
        />
      )}
      {activeTab === "articles" && (
        <ArticlesTab
          articles={articles}
          onDelete={(id) => deleteArticle({ articleId: id })}
          siteId={siteId}
        />
      )}
      {activeTab === "settings" && (
        <SettingsTab
          site={site}
          siteName={siteName} setSiteName={setSiteName}
          niche={niche} setNiche={setNiche}
          tone={tone} setTone={setTone}
          language={language} setLanguage={setLanguage}
          cadence={cadence} setCadence={setCadence}
          autopilot={autopilot} setAutopilot={setAutopilot}
          approval={approval} setApproval={setApproval}
          ctaText={ctaText} setCtaText={setCtaText}
          ctaUrl={ctaUrl} setCtaUrl={setCtaUrl}
          urlStructure={urlStructure} setUrlStructure={setUrlStructure}
          externalLinking={externalLinking} setExternalLinking={setExternalLinking}
          sourceCitations={sourceCitations} setSourceCitations={setSourceCitations}
          youtubeEmbeds={youtubeEmbeds} setYoutubeEmbeds={setYoutubeEmbeds}
          primaryColor={primaryColor} setPrimaryColor={setPrimaryColor}
          accentColor={accentColor} setAccentColor={setAccentColor}
          fontFamily={fontFamily} setFontFamily={setFontFamily}
          targetCountry={targetCountry} setTargetCountry={setTargetCountry}
          audienceSummary={audienceSummary} setAudienceSummary={setAudienceSummary}
          painPoints={painPoints} setPainPoints={setPainPoints}
          competitors={competitors} setCompetitors={setCompetitors}
          keywords={keywords} setKeywords={setKeywords}
          saving={saving}
          saved={saved}
          onSave={handleSaveSettings}
        />
      )}
    </div>
  );
}

/* ── Overview Tab ── */

function OverviewTab({
  siteId,
  site,
  articleCount,
  topicCount,
  publishedCount,
  draftCount,
  reviewCount,
  brandColor,
  onTabChange,
}: {
  siteId: Id<"sites">;
  site: {
    domain: string;
    siteName?: string;
    siteType?: string;
    niche?: string;
    tone?: string;
    language?: string;
    cadencePerWeek?: number;
    autopilotEnabled?: boolean;
    brandPrimaryColor?: string;
    urlStructure?: string;
    publishMethod?: string;
    repoOwner?: string;
    repoName?: string;
    githubToken?: string;
    wpUrl?: string;
    wpUsername?: string;
    webhookUrl?: string;
  };
  articleCount: number;
  topicCount: number;
  publishedCount: number;
  draftCount: number;
  reviewCount: number;
  brandColor: string;
  onTabChange: (tab: Tab) => void;
}) {
  // Quick link cards
  const quickLinks = [
    {
      label: "Articles",
      count: articleCount,
      color: "#0EA5E9",
      onClick: () => onTabChange("articles"),
      icon: FileText,
    },
    {
      label: "Topics",
      count: topicCount,
      color: "#F59E0B",
      href: "/plan",
      icon: Target,
    },
    {
      label: "Pipeline",
      count: reviewCount,
      suffix: " in review",
      color: "#8B5CF6",
      href: "/jobs",
      icon: Zap,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Article progress (live) */}
      <ArticleProgress siteId={siteId} />

      {/* Quick links */}
      <div className="grid gap-3 sm:grid-cols-3">
        {quickLinks.map((item) => {
          const Icon = item.icon;
          const content = (
            <div
              className="group relative rounded-xl border border-white/[0.06] bg-[#0F1117] p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1] cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${item.color}15` }}
                >
                  <Icon className="h-4 w-4" style={{ color: item.color }} />
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-[#565A6E] opacity-0 group-hover:opacity-100 transition" />
              </div>
              <p className="mt-3 text-[22px] font-bold text-[#EDEEF1]">
                {item.count}
              </p>
              <p className="text-[11px] text-[#565A6E]">
                {item.label}{item.suffix ?? ""}
              </p>
            </div>
          );

          if (item.href) {
            return <Link key={item.label} href={item.href}>{content}</Link>;
          }
          return <div key={item.label} onClick={item.onClick}>{content}</div>;
        })}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatMini label="Published" value={publishedCount} />
        <StatMini label="Drafts" value={draftCount} />
        <StatMini label="In Review" value={reviewCount} />
        <StatMini label="Topics" value={topicCount} />
      </div>

      {/* Site details */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.04] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">
          Site Details
        </div>
        <div className="grid gap-px bg-white/[0.02]">
          <DetailRow label="Domain" value={site.domain} />
          {site.siteName ? <DetailRow label="Site Name" value={site.siteName} /> : null}
          {site.siteType ? <DetailRow label="Type" value={site.siteType} /> : null}
          {site.niche ? <DetailRow label="Niche" value={site.niche} /> : null}
          {site.tone ? <DetailRow label="Tone" value={site.tone} /> : null}
          {site.language ? <DetailRow label="Language" value={site.language} /> : null}
          <DetailRow
            label="Cadence"
            value={`${site.cadencePerWeek ?? 4} articles/week`}
          />
          <DetailRow
            label="Mode"
            value={site.autopilotEnabled !== false ? "Autopilot" : "Manual"}
          />
          {site.brandPrimaryColor ? (
            <DetailRow label="Brand Color" value={site.brandPrimaryColor}>
              <div
                className="h-4 w-4 rounded border border-white/[0.1]"
                style={{ backgroundColor: site.brandPrimaryColor }}
              />
            </DetailRow>
          ) : null}
          <DetailRow
            label="Publish Method"
            value={
              site.publishMethod === "github" ? "GitHub" :
              site.publishMethod === "wordpress" ? "WordPress" :
              site.publishMethod === "webhook" ? "Webhook" :
              site.publishMethod === "manual" ? "Copy & Paste" :
              "Not set"
            }
          />
          {site.publishMethod === "github" && site.repoOwner && (
            <DetailRow label="Repository" value={site.repoOwner + "/" + (site.repoName || "")} />
          )}
          {site.publishMethod === "github" && (
            <DetailRow label="GitHub Status" value={site.githubToken ? "Connected" : "Not connected"}>
              <span className={"h-2 w-2 rounded-full " + (site.githubToken ? "bg-[#22C55E]" : "bg-[#F59E0B]")} />
            </DetailRow>
          )}
          {site.publishMethod === "wordpress" && site.wpUrl && (
            <DetailRow label="WordPress" value={site.wpUrl} />
          )}
          {site.publishMethod === "webhook" && site.webhookUrl && (
            <DetailRow label="Webhook" value={site.webhookUrl} />
          )}
          {site.urlStructure ? <DetailRow label="URL Structure" value={site.urlStructure} /> : null}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onTabChange("settings")}
          icon={<Settings className="h-3.5 w-3.5" />}
        >
          Edit Settings
        </Button>
        <Link href="/dashboard">
          <Button
            size="sm"
            icon={<Zap className="h-3.5 w-3.5" />}
          >
            Generate Article
          </Button>
        </Link>
      </div>
    </div>
  );
}

function StatMini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[#0F1117] border border-white/[0.06] p-3 text-center">
      <p className="text-[18px] font-bold text-[#EDEEF1]">{value}</p>
      <p className="text-[10px] text-[#565A6E]">{label}</p>
    </div>
  );
}

function DetailRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5 bg-[#0F1117]">
      <span className="text-[12px] text-[#565A6E]">{label}</span>
      <div className="flex items-center gap-2">
        {children}
        <span className="text-[12px] text-[#EDEEF1]">{value}</span>
      </div>
    </div>
  );
}

/* ── Articles Tab ── */

function ArticlesTab({
  articles,
  onDelete,
  siteId,
}: {
  articles: Array<{
    _id: Id<"articles">;
    title: string;
    status: string;
    slug: string;
    markdown: string;
    wordCount?: number;
    featuredImage?: string;
    createdAt: number;
  }> | undefined;
  onDelete: (id: Id<"articles">) => void;
  siteId: Id<"sites">;
}) {
  const [deletingId, setDeletingId] = useState<Id<"articles"> | null>(null);

  if (articles === undefined) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117]">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-0">
            <div className="h-4 w-16 animate-pulse rounded-full bg-white/[0.04]" />
            <div className="h-4 w-60 animate-pulse rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
        <FileText className="mx-auto h-10 w-10 text-[#565A6E]/30" />
        <p className="mt-3 text-[13px] text-[#565A6E]">
          No articles yet. Generate one to get started.
        </p>
        <Link href="/dashboard">
          <Button className="mt-4" size="sm" icon={<Zap className="h-3.5 w-3.5" />}>
            Generate Article
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-[#565A6E]">{articles.length} articles</p>
        <Link href="/dashboard">
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}>
            Generate
          </Button>
        </Link>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
        {/* Header */}
        <div className="hidden sm:grid sm:grid-cols-[1fr_100px_80px_100px_40px] gap-4 px-5 py-2.5 border-b border-white/[0.04] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">
          <span>Title</span>
          <span>Status</span>
          <span>Words</span>
          <span className="text-right">Created</span>
          <span />
        </div>

        {articles.map((article) => {
          const wc = article.wordCount ?? Math.round(article.markdown.split(/\s+/).length);
          const isDeleting = deletingId === article._id;

          return (
            <div
              key={article._id}
              className="group flex flex-col sm:grid sm:grid-cols-[1fr_100px_80px_100px_40px] gap-1 sm:gap-4 sm:items-center px-5 py-3.5 border-b border-white/[0.04] last:border-0 transition hover:bg-white/[0.02]"
            >
              <Link href={`/articles/${article._id}`} className="flex items-center gap-3 min-w-0">
                {article.featuredImage && (
                  <img
                    src={article.featuredImage}
                    alt=""
                    className="hidden sm:block h-9 w-14 rounded object-cover shrink-0 border border-white/[0.06]"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#EDEEF1] leading-snug truncate group-hover:text-white transition">
                    {article.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#565A6E] font-mono truncate sm:hidden">
                    /{article.slug}
                  </p>
                </div>
              </Link>
              <StatusBadge status={article.status} />
              <span className="text-[12px] text-[#8B8FA3] tabular-nums hidden sm:block">
                {wc.toLocaleString()}
              </span>
              <span className="text-[11px] text-[#565A6E] sm:text-right">
                {formatDistanceToNow(article.createdAt, { addSuffix: true })}
              </span>
              <div className="flex items-center justify-end">
                {isDeleting ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="text-[10px] text-[#8B8FA3] hover:text-[#EDEEF1] transition"
                    >
                      No
                    </button>
                    <button
                      onClick={() => {
                        onDelete(article._id);
                        setDeletingId(null);
                      }}
                      className="text-[10px] text-[#EF4444] hover:text-[#F87171] transition font-medium"
                    >
                      Yes
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeletingId(article._id)}
                    className="text-[#565A6E] hover:text-[#EF4444] transition opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Settings Tab ── */

function SettingsTab({
  site,
  siteName, setSiteName,
  niche, setNiche,
  tone, setTone,
  language, setLanguage,
  cadence, setCadence,
  autopilot, setAutopilot,
  approval, setApproval,
  ctaText, setCtaText,
  ctaUrl, setCtaUrl,
  urlStructure, setUrlStructure,
  externalLinking, setExternalLinking,
  sourceCitations, setSourceCitations,
  youtubeEmbeds, setYoutubeEmbeds,
  primaryColor, setPrimaryColor,
  accentColor, setAccentColor,
  fontFamily, setFontFamily,
  targetCountry, setTargetCountry,
  audienceSummary, setAudienceSummary,
  painPoints, setPainPoints,
  competitors, setCompetitors,
  keywords, setKeywords,
  saving,
  saved,
  onSave,
}: {
  site: any;
  siteName: string; setSiteName: (v: string) => void;
  niche: string; setNiche: (v: string) => void;
  tone: string; setTone: (v: string) => void;
  language: string; setLanguage: (v: string) => void;
  cadence: number; setCadence: (v: number) => void;
  autopilot: boolean; setAutopilot: (v: boolean) => void;
  approval: boolean; setApproval: (v: boolean) => void;
  ctaText: string; setCtaText: (v: string) => void;
  ctaUrl: string; setCtaUrl: (v: string) => void;
  urlStructure: string; setUrlStructure: (v: string) => void;
  externalLinking: boolean; setExternalLinking: (v: boolean) => void;
  sourceCitations: boolean; setSourceCitations: (v: boolean) => void;
  youtubeEmbeds: boolean; setYoutubeEmbeds: (v: boolean) => void;
  primaryColor: string; setPrimaryColor: (v: string) => void;
  accentColor: string; setAccentColor: (v: string) => void;
  fontFamily: string; setFontFamily: (v: string) => void;
  targetCountry: string; setTargetCountry: (v: string) => void;
  audienceSummary: string; setAudienceSummary: (v: string) => void;
  painPoints: string[]; setPainPoints: (v: string[]) => void;
  competitors: string[]; setCompetitors: (v: string[]) => void;
  keywords: string[]; setKeywords: (v: string[]) => void;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Save bar */}
      <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#0F1117] px-5 py-3">
        <p className="text-[12px] text-[#565A6E]">
          Changes are saved when you click Save.
        </p>
        <Button
          size="sm"
          onClick={onSave}
          loading={saving}
          icon={saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
        >
          {saved ? "Saved" : "Save Changes"}
        </Button>
      </div>

      {/* Connection */}
      <ConnectionSection site={site} />

      {/* General */}
      <SettingsSection title="General" icon={Globe}>
        <FieldRow label="Site Name" description="Display name for your website">
          <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="My Website" />
        </FieldRow>
        <FieldRow label="Niche" description="Primary topic or industry">
          <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. SaaS, Marketing" />
        </FieldRow>
        <FieldRow label="Tone" description="Writing style for generated articles">
          <select
            className="w-full rounded-lg border border-white/[0.06] bg-[#0F1117] px-3 py-2 text-[13px] text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          >
            <option value="">Auto-detect</option>
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="casual">Casual</option>
            <option value="authoritative">Authoritative</option>
          </select>
        </FieldRow>
        <FieldRow label="Language" description="Content language">
          <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
        </FieldRow>
      </SettingsSection>

      {/* Publishing */}
      <SettingsSection title="Publishing" icon={Zap}>
        <FieldRow label="Articles per week" description="How many articles to generate weekly">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={14}
              value={cadence}
              onChange={(e) => setCadence(Number(e.target.value))}
              className="flex-1 accent-[#0EA5E9]"
            />
            <span className="text-[14px] font-bold text-[#EDEEF1] w-8 text-center tabular-nums">
              {cadence}
            </span>
          </div>
        </FieldRow>
        <ToggleRow
          label="Autopilot"
          description="Automatically generate and publish on schedule"
          value={autopilot}
          onChange={setAutopilot}
        />
        <ToggleRow
          label="Review before publishing"
          description="Require manual approval before articles go live"
          value={approval}
          onChange={setApproval}
        />
      </SettingsSection>

      {/* Content */}
      <SettingsSection title="Content Settings" icon={FileText}>
        <FieldRow label="CTA text (optional)" description="Call-to-action button text in articles">
          <Input value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Try it free" />
        </FieldRow>
        <FieldRow label="CTA URL (optional)" description="Where the CTA button links to">
          <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://yoursite.com/signup" />
        </FieldRow>
        <FieldRow label="URL structure" description="How article URLs are formatted">
          <Input value={urlStructure} onChange={(e) => setUrlStructure(e.target.value)} placeholder="/blog/[slug]" />
        </FieldRow>
        <ToggleRow
          label="Link to sources"
          description="Add outbound links to referenced sources"
          value={externalLinking}
          onChange={setExternalLinking}
        />
        <ToggleRow
          label="Reference list"
          description="Include a sources section at the end of articles"
          value={sourceCitations}
          onChange={setSourceCitations}
        />
        <ToggleRow
          label="YouTube videos"
          description="Embed relevant YouTube videos when available"
          value={youtubeEmbeds}
          onChange={setYoutubeEmbeds}
        />
      </SettingsSection>

      {/* SEO Keywords */}
      <SettingsSection title="SEO Keywords" icon={Target}>
        <TagEditor
          label="Priority keywords"
          description="Focus keywords for backlinks and SEO"
          items={keywords}
          onChange={setKeywords}
          placeholder="Add keyword"
        />
        <TagEditor
          label="Competitors"
          description="Domains to avoid mentioning in articles"
          items={competitors}
          onChange={setCompetitors}
          placeholder="competitor.com"
        />
      </SettingsSection>

      {/* Audience */}
      <SettingsSection title="Target Audience" icon={Users}>
        <FieldRow label="Country" description="Primary target country for content">
          <Input value={targetCountry} onChange={(e) => setTargetCountry(e.target.value)} placeholder="United States" />
        </FieldRow>
        <FieldRow label="Audience summary" description="Who your ideal reader is">
          <Textarea value={audienceSummary} onChange={(e) => setAudienceSummary(e.target.value)} placeholder="SaaS founders looking to improve their content marketing..." />
        </FieldRow>
        <TagEditor
          label="Pain points"
          description="Problems your audience faces"
          items={painPoints}
          onChange={setPainPoints}
          placeholder="Add pain point"
        />
      </SettingsSection>

      {/* Branding */}
      <SettingsSection title="Brand & Style" icon={Palette}>
        <FieldRow label="Primary color" description="Used for headings and links">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={primaryColor || "#0EA5E9"}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-9 w-9 cursor-pointer rounded border border-white/[0.1] bg-transparent"
            />
            <Input
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#0EA5E9"
              className="flex-1 font-mono"
            />
          </div>
        </FieldRow>
        <FieldRow label="Accent color" description="Used for highlights and borders">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={accentColor || "#0EA5E9"}
              onChange={(e) => setAccentColor(e.target.value)}
              className="h-9 w-9 cursor-pointer rounded border border-white/[0.1] bg-transparent"
            />
            <Input
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#0EA5E9"
              className="flex-1 font-mono"
            />
          </div>
        </FieldRow>
        <FieldRow label="Font family" description="Primary font for article content">
          <Input value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="Inter" />
        </FieldRow>
      </SettingsSection>

      {/* Bottom save */}
      <div className="flex justify-end">
        <Button
          onClick={onSave}
          loading={saving}
          icon={saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
        >
          {saved ? "Saved" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

/* ── Connection Section ── */

function ConnectionSection({ site }: { site: any }) {
  const updateSite = useMutation(api.sites.upsert);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repoOwner, setRepoOwner] = useState(site.repoOwner || "");
  const [repoName, setRepoName] = useState(site.repoName || "");
  const [wpUrl, setWpUrl] = useState(site.wpUrl || "");
  const [wpUsername, setWpUsername] = useState(site.wpUsername || "");
  const [wpAppPassword, setWpAppPassword] = useState(site.wpAppPassword || "");
  const [webhookUrl, setWebhookUrl] = useState(site.webhookUrl || "");
  const [webhookSecret, setWebhookSecret] = useState(site.webhookSecret || "");

  const method = site.publishMethod || "github";
  const labels = { github: "GitHub", wordpress: "WordPress", webhook: "Webhook", manual: "Copy & Paste" } as Record<string, string>;
  const iconMap = { github: GitBranch, wordpress: Globe, webhook: Webhook, manual: Copy } as Record<string, typeof GitBranch>;
  const MethodIcon = iconMap[method] || GitBranch;
  const isGithub = method === "github";
  const isWp = method === "wordpress";
  const isWebhook = method === "webhook";
  const isManual = method === "manual";
  const hasGithubToken = !!site.githubToken;

  const inputCls = "w-full rounded-lg border border-white/[0.06] bg-[#0F1117] px-3 py-2 text-[13px] text-[#EDEEF1] placeholder-[#565A6E] outline-none focus:border-[#0EA5E9]/50";

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: any = { id: site._id, domain: site.domain };
      if (isGithub) { updates.repoOwner = repoOwner.trim() || undefined; updates.repoName = repoName.trim() || undefined; }
      if (isWp) { updates.wpUrl = wpUrl.trim() || undefined; updates.wpUsername = wpUsername.trim() || undefined; updates.wpAppPassword = wpAppPassword.trim() || undefined; }
      if (isWebhook) { updates.webhookUrl = webhookUrl.trim() || undefined; updates.webhookSecret = webhookSecret.trim() || undefined; }
      await updateSite(updates);
      setEditing(false);
    } catch (e) { console.error("Failed to save:", e); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-white/[0.04]">
        <Upload className="h-4 w-4 text-[#0EA5E9]" />
        <p className="text-[13px] font-semibold text-[#EDEEF1]">Connection</p>
      </div>
      <div className="px-5 py-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.08]">
              <MethodIcon className="h-5 w-5 text-[#0EA5E9]" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-medium text-[#EDEEF1]">{labels[method] || method}</p>
              {isGithub && site.repoOwner && !editing && (
                <p className="text-[12px] text-[#565A6E] font-mono">{site.repoOwner}/{site.repoName}</p>
              )}
              {isWp && site.wpUrl && !editing && (
                <p className="text-[12px] text-[#565A6E]">{site.wpUrl}</p>
              )}
              {isWebhook && site.webhookUrl && !editing && (
                <p className="text-[12px] text-[#565A6E] truncate max-w-[300px]">{site.webhookUrl}</p>
              )}
              {isManual && (
                <p className="text-[12px] text-[#565A6E]">Copy markdown or HTML from article pages</p>
              )}
            </div>
            {!isManual && !editing && (
              <button onClick={() => setEditing(true)} className="text-[11px] font-medium text-[#8B8FA3] hover:text-[#0EA5E9] transition">Edit</button>
            )}
          </div>

          {editing && (
            <div className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              {isGithub && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-[#8B8FA3]">Owner</label>
                    <input value={repoOwner} onChange={(e) => setRepoOwner(e.target.value)} placeholder="acme" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-[#8B8FA3]">Repository</label>
                    <input value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="my-blog" className={inputCls} />
                  </div>
                </div>
              )}
              {isWp && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-[#8B8FA3]">WordPress URL</label>
                    <input value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} placeholder="https://yoursite.com" className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[12px] font-medium text-[#8B8FA3]">Username</label>
                      <input value={wpUsername} onChange={(e) => setWpUsername(e.target.value)} placeholder="admin" className={inputCls} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[12px] font-medium text-[#8B8FA3]">App Password</label>
                      <input type="password" value={wpAppPassword} onChange={(e) => setWpAppPassword(e.target.value)} placeholder="xxxx xxxx xxxx" className={inputCls} />
                    </div>
                  </div>
                </>
              )}
              {isWebhook && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-[#8B8FA3]">Webhook URL</label>
                    <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://api.yoursite.com/articles" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-[#8B8FA3]">Secret (optional)</label>
                    <input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="your-webhook-secret" className={inputCls} />
                  </div>
                </>
              )}
              <div className="flex items-center gap-2 mt-1">
                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0EA5E9] px-4 py-2 text-[12px] font-medium text-white transition hover:bg-[#38BDF8] disabled:opacity-50">
                  <Check className="h-3 w-3" />
                  {saving ? "Saving..." : "Save"}
                </button>
                <button onClick={() => setEditing(false)} className="text-[12px] text-[#8B8FA3] hover:text-[#EDEEF1] transition px-3 py-2">Cancel</button>
              </div>
            </div>
          )}

          {isGithub && (
            <div className={"flex items-center gap-3 rounded-lg px-4 py-3 " + (hasGithubToken ? "bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.12]" : "bg-[#F59E0B]/[0.04] border border-[#F59E0B]/[0.12]")}>
              {hasGithubToken ? (
                <>
                  <Check className="h-4 w-4 text-[#22C55E]" />
                  <span className="flex-1 text-[12px] text-[#4ADE80]">GitHub connected</span>
                  <button onClick={() => window.open("/api/github/auth?siteId=" + site._id, "github-oauth", "width=600,height=700,popup=yes")} className="text-[11px] text-[#565A6E] hover:text-[#0EA5E9] transition">Reconnect</button>
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 text-[#F59E0B]" />
                  <span className="flex-1 text-[12px] text-[#FBBF24]">GitHub not connected</span>
                  <button onClick={() => window.open("/api/github/auth?siteId=" + site._id, "github-oauth", "width=600,height=700,popup=yes")} className="text-[11px] font-medium text-[#0EA5E9] hover:text-[#38BDF8] transition">Connect</button>
                </>
              )}
            </div>
          )}

          {isWp && (() => {
            const ok = !!(site.wpUrl && site.wpUsername && site.wpAppPassword);
            return (
              <div className={"flex items-center gap-3 rounded-lg px-4 py-3 " + (ok ? "bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.12]" : "bg-[#F59E0B]/[0.04] border border-[#F59E0B]/[0.12]")}>
                {ok ? (<><Check className="h-4 w-4 text-[#22C55E]" /><span className="flex-1 text-[12px] text-[#4ADE80]">WordPress configured</span></>) : (<><KeyRound className="h-4 w-4 text-[#F59E0B]" /><span className="flex-1 text-[12px] text-[#FBBF24]">WordPress credentials missing</span></>)}
              </div>
            );
          })()}

          {isWebhook && (() => {
            const ok = !!site.webhookUrl;
            return (
              <div className={"flex items-center gap-3 rounded-lg px-4 py-3 " + (ok ? "bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.12]" : "bg-[#F59E0B]/[0.04] border border-[#F59E0B]/[0.12]")}>
                {ok ? (<><Check className="h-4 w-4 text-[#22C55E]" /><span className="flex-1 text-[12px] text-[#4ADE80]">Webhook configured</span></>) : (<><KeyRound className="h-4 w-4 text-[#F59E0B]" /><span className="flex-1 text-[12px] text-[#FBBF24]">Webhook URL not set</span></>)}
              </div>
            );
          })()}

          {isManual && (
            <div className="flex items-center gap-3 rounded-lg px-4 py-3 bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.12]">
              <Check className="h-4 w-4 text-[#22C55E]" />
              <span className="flex-1 text-[12px] text-[#4ADE80]">Ready — copy articles from the Articles page</span>
            </div>
          )}

          {!isManual && (
            <div className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
              <Shield className="h-3 w-3 shrink-0 text-[#22C55E]" />
              <p className="text-[10px] text-[#565A6E]">Credentials are <span className="text-[#8B8FA3]">encrypted at rest</span> and transmitted over <span className="text-[#8B8FA3]">HTTPS</span>.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ── Reusable settings components ── */

function SettingsSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Globe;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-white/[0.04]">
        <Icon className="h-4 w-4 text-[#0EA5E9]" />
        <p className="text-[13px] font-semibold text-[#EDEEF1]">{title}</p>
      </div>
      <div className="divide-y divide-white/[0.04]">{children}</div>
    </div>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="mb-2">
        <p className="text-[13px] font-medium text-[#EDEEF1]">{label}</p>
        <p className="text-[11px] text-[#565A6E]">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div>
        <p className="text-[13px] font-medium text-[#EDEEF1]">{label}</p>
        <p className="text-[11px] text-[#565A6E]">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
          value ? "bg-[#0EA5E9]" : "bg-white/[0.08]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            value ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function TagEditor({
  label,
  description,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  description: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState("");

  const addItem = () => {
    if (newItem.trim()) {
      onChange([...items, newItem.trim()]);
      setNewItem("");
      setAdding(false);
    }
  };

  return (
    <div className="px-5 py-4">
      <div className="mb-2">
        <p className="text-[13px] font-medium text-[#EDEEF1]">{label}</p>
        <p className="text-[11px] text-[#565A6E]">{description}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] border border-white/[0.06] px-2 py-1 text-[12px] text-[#EDEEF1]"
          >
            {item}
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-[#565A6E] hover:text-[#EF4444] transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem();
              if (e.key === "Escape") setAdding(false);
            }}
            onBlur={addItem}
            placeholder={placeholder}
            autoFocus
            className="w-36 rounded-md border border-white/[0.1] bg-[#0F1117] px-2 py-1 text-[12px] text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-white/[0.08] px-2 py-1 text-[11px] text-[#565A6E] hover:border-[#0EA5E9]/30 hover:text-[#0EA5E9] transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        )}
      </div>
    </div>
  );
}
