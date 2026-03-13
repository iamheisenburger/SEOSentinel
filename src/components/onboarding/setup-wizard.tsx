"use client";

import { useAuth } from "@clerk/nextjs";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  Globe,
  Search,
  Users,
  Settings,
  FileText,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  Sparkles,
  AlertCircle,
  Building2,
  Target,
  Shield,
  Link2,
  Zap,
  Plus,
  X,
  Pencil,
  GitBranch,
  Webhook,
  Copy,
  KeyRound,
  Palette,
  Eye,
  BarChart3,
  Share2,
} from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";

type Step = "domain" | "profile" | "audience" | "strategy" | "integrations" | "preview" | "generate" | "done";

const STEPS: { key: Step; label: string; icon: typeof Globe }[] = [
  { key: "domain", label: "Website", icon: Globe },
  { key: "profile", label: "Profile", icon: Building2 },
  { key: "audience", label: "Audience", icon: Users },
  { key: "strategy", label: "Strategy", icon: Settings },
  { key: "integrations", label: "Connect", icon: BarChart3 },
  { key: "preview", label: "Preview", icon: Eye },
  { key: "generate", label: "Content Plan", icon: Target },
];

// ── Editable Field Components ──────────────────────────

function EditableField({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="group">
        <label className="text-[11px] font-medium text-[#8B8FA3] mb-1 block">{label}</label>
        {multiline ? (
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            placeholder={placeholder}
            autoFocus
            className="text-[13px]"
          />
        ) : (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
            placeholder={placeholder}
            autoFocus
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="group cursor-pointer rounded-lg px-3 py-2 hover:bg-white/[0.02] transition-colors"
      onClick={() => setEditing(true)}
    >
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-[#8B8FA3]">{label}</label>
        <Pencil className="h-3 w-3 text-[#565A6E] opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <p className="text-[13px] text-[#EDEEF1] mt-0.5 whitespace-pre-wrap">
        {value || <span className="text-[#565A6E] italic">Not set</span>}
      </p>
    </div>
  );
}

function EditableList({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
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
    <div className="rounded-lg px-3 py-2">
      <label className="text-[11px] font-medium text-[#8B8FA3] mb-2 block">{label}</label>
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
          <div className="inline-flex items-center gap-1">
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
          </div>
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

function ToggleSetting({
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
    <div className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
      <div>
        <p className="text-[13px] text-[#EDEEF1]">{label}</p>
        <p className="text-[11px] text-[#565A6E]">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
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

// ── Section Header ──────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Globe;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.08]">
        <Icon className="h-5 w-5 text-[#0EA5E9]" />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold text-[#EDEEF1]">{title}</h2>
        <p className="text-[12px] text-[#565A6E]">{subtitle}</p>
      </div>
    </div>
  );
}

// ── Main Wizard ─────────────────────────────────────────

export function SetupWizard() {
  const [step, setStep] = useState<Step>("domain");
  const [siteId, setSiteId] = useState<Id<"sites"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Domain form
  const [domain, setDomain] = useState("");
  const [publishMethod, setPublishMethod] = useState<string>("github");
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState("");
  const [wpUrl, setWpUrl] = useState("");
  const [wpUsername, setWpUsername] = useState("");
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  // AI-analyzed profile (editable by user)
  const [siteName, setSiteName] = useState("");
  const [siteType, setSiteType] = useState("");
  const [siteSummary, setSiteSummary] = useState("");
  const [blogTheme, setBlogTheme] = useState("");
  const [keyFeatures, setKeyFeatures] = useState<string[]>([]);
  const [pricingInfo, setPricingInfo] = useState("");
  const [founders, setFounders] = useState("");
  const [niche, setNiche] = useState("");
  const [tone, setTone] = useState("");

  // Target audience (editable)
  const [targetCountry, setTargetCountry] = useState("");
  const [language, setLanguage] = useState("en");
  const [targetAudienceSummary, setTargetAudienceSummary] = useState("");
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [productUsage, setProductUsage] = useState("");

  // Strategy (editable)
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [ctaText, setCtaText] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [anchorKeywords, setAnchorKeywords] = useState<string[]>([]);
  const [cadencePerWeek, setCadencePerWeek] = useState(4);
  const [externalLinking, setExternalLinking] = useState(true);
  const [sourceCitations, setSourceCitations] = useState(true);
  const [youtubeEmbeds, setYoutubeEmbeds] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [urlStructure, setUrlStructure] = useState("/blog/[slug]");

  // Brand detection (from crawl)
  const [brandPrimaryColor, setBrandPrimaryColor] = useState<string | null>(null);
  const [brandAccentColor, setBrandAccentColor] = useState<string | null>(null);
  const [brandFontFamily, setBrandFontFamily] = useState<string | null>(null);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);

  // Integrations
  const [gscConnected, setGscConnected] = useState(false);
  const [gscEmail, setGscEmail] = useState("");
  const [mediumToken, setMediumToken] = useState("");
  const [linkedinToken, setLinkedinToken] = useState("");
  const [syndicationEnabled, setSyndicationEnabled] = useState(false);

  // Loading states
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Convex hooks
  const { userId: clerkUserId, isLoaded: authLoaded } = useAuth();
  const upsert = useMutation(api.sites.upsert);
  const crawlAndAnalyze = useAction(api.actions.pipeline.crawlAndAnalyze);
  const generatePlan = useAction(api.actions.pipeline.generatePlan);

  // After OAuth popup closes, server has saved token directly to Convex.
  // We just need to detect when the popup closes to update local UI state.
  const startOAuthPopup = (popupSiteId: string) => {
    const popup = window.open("/api/github/auth?siteId=" + popupSiteId, "github-oauth", "width=600,height=700,popup=yes");
    if (!popup) return;
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        // Popup closed — server saved the token, update local UI
        setGithubConnected(true);
      }
    }, 500);
  };

  // Reactive queries
  const topics = useQuery(
    api.topics.listBySite,
    siteId ? { siteId } : "skip",
  );
  const articles = useQuery(
    api.articles.listBySite,
    siteId ? { siteId } : "skip",
  );

  const currentIdx = STEPS.findIndex((s) => s.key === step);

  // ─── Step 1: Save domain + crawl + AI analysis ──────
  const handleStartAnalysis = async () => {
    if (!domain.trim()) return;
    if (!clerkUserId) {
      setError("Authentication not ready. Please wait a moment and try again.");
      return;
    }
    setError(null);
    setAnalyzing(true);
    setStatusMsg("Creating site record...");

    try {
      // Create site
      const id = await upsert({
        domain: domain.trim(),
        ...(clerkUserId ? { clerkUserId } : {}),
        publishMethod,
        cadencePerWeek: 4,
        approvalRequired: true,
        autopilotEnabled: true,
        inferToneNiche: true,
        language: "en",
      });
      setSiteId(id);

      // Crawl + AI analysis in one shot
      setStatusMsg("Crawling your website and running AI analysis — this takes 30-60 seconds...");
      const result = await crawlAndAnalyze({ siteId: id });

      // Populate all fields from analysis (may be null if analysis failed)
      const a = result.analysis;
      if (a) {
        setSiteName(a.siteName);
        setSiteType(a.siteType);
        setSiteSummary(a.siteSummary);
        setBlogTheme(a.blogTheme);
        setKeyFeatures(a.keyFeatures);
        setPricingInfo(a.pricingInfo);
        setFounders(a.founders);
        setNiche(a.niche);
        setTone(a.tone);
        setTargetCountry(a.targetCountry);
        setTargetAudienceSummary(a.targetAudienceSummary);
        setPainPoints(a.painPoints);
        setProductUsage(a.productUsage);
        setCompetitors(a.suggestedCompetitors);
        setAnchorKeywords(a.suggestedAnchorKeywords);
      }

      // Populate brand fields
      if (result.brand) {
        setBrandPrimaryColor(result.brand.primaryColor);
        setBrandAccentColor(result.brand.accentColor);
        setBrandFontFamily(result.brand.fontFamily);
        setBrandLogoUrl(result.brand.logoUrl);
      }

      setStatusMsg(null);
      setStep("profile");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setStatusMsg(null);
    } finally {
      setAnalyzing(false);
    }
  };

  // ─── Save profile + move to audience ────────────────
  const handleSaveProfile = async () => {
    if (!siteId) return;
    setError(null);
    try {
      await upsert({
        id: siteId,
        domain,
        siteName,
        siteType,
        siteSummary,
        blogTheme,
        keyFeatures,
        pricingInfo,
        founders,
        niche,
        tone,
      });
      setStep("audience");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    }
  };

  // ─── Save audience + move to strategy ───────────────
  const handleSaveAudience = async () => {
    if (!siteId) return;
    setError(null);
    try {
      await upsert({
        id: siteId,
        domain,
        language,
        targetCountry,
        targetAudienceSummary,
        painPoints,
        productUsage,
      });
      setStep("strategy");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save audience");
    }
  };

  // ─── GSC OAuth popup ──────────────────────────────
  const startGscOAuth = () => {
    if (!siteId) return;
    const popup = window.open("/api/gsc/auth?siteId=" + siteId, "gsc-oauth", "width=600,height=700,popup=yes");
    if (!popup) return;
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        setGscConnected(true);
      }
    }, 500);
  };

  // ─── Save integrations + move to preview ────────
  const handleSaveIntegrations = async () => {
    if (!siteId) return;
    setError(null);
    try {
      await upsert({
        id: siteId,
        domain,
        // Platform credentials collected in this step
        repoOwner: repoOwner.trim() || undefined,
        repoName: repoName.trim() || undefined,
        wpUrl: wpUrl.trim() || undefined,
        wpUsername: wpUsername.trim() || undefined,
        wpAppPassword: wpAppPassword.trim() || undefined,
        webhookUrl: webhookUrl.trim() || undefined,
        webhookSecret: webhookSecret.trim() || undefined,
        // Syndication
        mediumToken: mediumToken.trim() || undefined,
        linkedinAccessToken: linkedinToken.trim() || undefined,
        syndicationEnabled: syndicationEnabled || undefined,
      });
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save integrations");
    }
  };

  // ─── Save strategy + move to integrations ────────────────
  const handleSaveStrategy = async () => {
    if (!siteId) return;
    setError(null);
    try {
      await upsert({
        id: siteId,
        domain,
        competitors,
        ctaText: ctaText || undefined,
        ctaUrl: ctaUrl || undefined,
        anchorKeywords,
        cadencePerWeek,
        externalLinking,
        sourceCitations,
        youtubeEmbeds,
        approvalRequired,
        urlStructure,
      });
      setStep("integrations");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save strategy");
    }
  };

  // ─── Generate from preview step ───────────────────
  const handleGenerateFromPreview = async () => {
    if (!siteId) return;
    setError(null);
    setGenerating(true);

    try {
      // Persist brand overrides
      if (brandPrimaryColor || brandAccentColor || brandFontFamily) {
        await upsert({
          id: siteId,
          domain,
          brandPrimaryColor: brandPrimaryColor ?? undefined,
          brandAccentColor: brandAccentColor ?? undefined,
          brandFontFamily: brandFontFamily ?? undefined,
          brandLogoUrl: brandLogoUrl ?? undefined,
        });
      }

      setStatusMsg("Generating your content plan — about 30 seconds...");
      await generatePlan({ siteId });

      setStatusMsg(null);
      setStep("generate");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStatusMsg(null);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col items-center py-6 sm:py-10">
      {/* ─── Progress Steps ──────────────────────── */}
      <div className="mb-8 flex items-center gap-0">
        {STEPS.map((s, i) => {
          const isComplete = i < currentIdx || step === "done";
          const isCurrent = i === currentIdx && step !== "done";
          return (
            <div key={s.key} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
                    isComplete
                      ? "bg-[#22C55E] text-white"
                      : isCurrent
                        ? "bg-[#0EA5E9] text-white shadow-[0_0_20px_rgba(14,165,233,0.3)]"
                        : "bg-white/[0.04] text-[#565A6E]"
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <s.icon className="h-4 w-4" />
                  )}
                </div>
                <span
                  className={`mt-2 text-[11px] font-medium ${
                    isComplete
                      ? "text-[#22C55E]"
                      : isCurrent
                        ? "text-[#0EA5E9]"
                        : "text-[#565A6E]"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-2 mt-[-18px] h-px w-8 sm:w-14 ${
                    i < currentIdx || step === "done"
                      ? "bg-[#22C55E]/40"
                      : "bg-white/[0.06]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Step Content ────────────────────────── */}
      <div className="w-full max-w-xl">
        {/* Error */}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-[#EF4444]/[0.08] px-4 py-3 text-[13px] text-[#F87171]">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Status message */}
        {statusMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-[#0EA5E9]/[0.08] px-4 py-3 text-[13px] text-[#38BDF8]">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* ════════════════════════════════════════════
            Step 1: Domain + Crawl + AI Analysis
            ════════════════════════════════════════════ */}
        {step === "domain" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <SectionHeader
              icon={Globe}
              title="Add your website"
              subtitle="We'll crawl and analyze your site with AI to auto-configure everything"
            />

            <div className="flex flex-col gap-4">
              <Input
                label="Website URL"
                placeholder="example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !analyzing && handleStartAnalysis()}
              />

              {/* ── Platform Picker ── */}
              <div>
                <label className="text-[11px] font-medium text-[#8B8FA3] mb-2 block">
                  How do you publish content?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "github", label: "GitHub", icon: GitBranch, desc: "Next.js, Astro, Hugo" },
                    { key: "wordpress", label: "WordPress", icon: Globe, desc: "WP REST API" },
                    { key: "webhook", label: "Webhook", icon: Webhook, desc: "Custom endpoint" },
                    { key: "manual", label: "Copy & Paste", icon: Copy, desc: "Any platform" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setPublishMethod(opt.key)}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
                        publishMethod === opt.key
                          ? "border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.06] shadow-[0_0_12px_rgba(14,165,233,0.1)]"
                          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]"
                      }`}
                    >
                      <opt.icon className={`h-4 w-4 shrink-0 ${
                        publishMethod === opt.key ? "text-[#0EA5E9]" : "text-[#565A6E]"
                      }`} />
                      <div>
                        <p className={`text-[12px] font-medium ${
                          publishMethod === opt.key ? "text-[#EDEEF1]" : "text-[#8B8FA3]"
                        }`}>{opt.label}</p>
                        <p className="text-[10px] text-[#565A6E]">{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Brief description of chosen method ── */}
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                <p className="text-[11px] text-[#8B8FA3]">
                  {publishMethod === "github" && (
                    <>
                      <GitBranch className="inline h-3 w-3 mr-1 text-[#0EA5E9]" />
                      Articles are committed as MDX files to your GitHub repo. Works with Next.js, Astro, Hugo, Jekyll, and any static site generator. You&apos;ll connect your repo in the <span className="text-[#EDEEF1]">Connect</span> step.
                    </>
                  )}
                  {publishMethod === "wordpress" && (
                    <>
                      <Globe className="inline h-3 w-3 mr-1 text-[#F59E0B]" />
                      Articles are published directly to your WordPress site via the REST API. You&apos;ll enter your credentials in the <span className="text-[#EDEEF1]">Connect</span> step.
                    </>
                  )}
                  {publishMethod === "webhook" && (
                    <>
                      <Webhook className="inline h-3 w-3 mr-1 text-[#22C55E]" />
                      We&apos;ll POST article data (title, markdown, HTML, metadata) to your endpoint. You&apos;ll configure the URL in the <span className="text-[#EDEEF1]">Connect</span> step.
                    </>
                  )}
                  {publishMethod === "manual" && (
                    <>
                      <Copy className="inline h-3 w-3 mr-1 text-[#0EA5E9]" />
                      Articles will be generated and ready for you to copy. Use the Copy Markdown or Copy HTML buttons to paste into any CMS — Wix, Squarespace, Shopify, Webflow, or anywhere else.
                    </>
                  )}
                </p>
              </div>

              <div className="mt-1 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                <p className="text-[12px] text-[#8B8FA3]">
                  <Sparkles className="inline h-3.5 w-3.5 mr-1 text-[#0EA5E9]" />
                  After clicking Continue, we&apos;ll crawl your site and use AI to auto-fill your site profile,
                  target audience, and content strategy. You can review and edit everything.
                </p>
              </div>

              <Button
                onClick={handleStartAnalysis}
                disabled={!domain.trim()}
                loading={analyzing}
                icon={<Search className="h-3.5 w-3.5" />}
                className="mt-1 w-full"
              >
                {analyzing ? "Analyzing your website..." : "Crawl & Analyze"}
              </Button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            Step 2: Site Profile (AI-filled, editable)
            ════════════════════════════════════════════ */}
        {step === "profile" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <SectionHeader
              icon={Building2}
              title="Site Profile"
              subtitle="AI-generated from your website — click any field to edit"
            />

            <div className="rounded-lg bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.1] px-3 py-2 mb-4">
              <p className="text-[11px] text-[#4ADE80]">
                <Sparkles className="inline h-3 w-3 mr-1" />
                Auto-filled from crawl — review and adjust anything that&apos;s not right
              </p>
            </div>

            <div className="flex flex-col gap-1 divide-y divide-white/[0.04]">
              <EditableField label="Site Name" value={siteName} onChange={setSiteName} />
              <EditableField label="Type" value={siteType} onChange={setSiteType} />
              <EditableField label="Niche" value={niche} onChange={setNiche} />
              <EditableField label="Tone of Voice" value={tone} onChange={setTone} />
              <EditableField
                label="Summary"
                value={siteSummary}
                onChange={setSiteSummary}
                multiline
              />
              <EditableField
                label="Blog Theme"
                value={blogTheme}
                onChange={setBlogTheme}
                multiline
                placeholder="What should the blog focus on?"
              />
              <EditableList label="Key Features" items={keyFeatures} onChange={setKeyFeatures} placeholder="Add feature" />
              <EditableField
                label="Pricing"
                value={pricingInfo}
                onChange={setPricingInfo}
                multiline
              />
              <EditableField label="Founders" value={founders} onChange={setFounders} />
            </div>

            {/* ── Detected Branding ── */}
            {(brandPrimaryColor || brandFontFamily || brandLogoUrl) && (
              <div className="mt-4 border-t border-white/[0.04] pt-4">
                <div className="flex items-center gap-2 mb-3 px-3">
                  <Palette className="h-4 w-4 text-[#0EA5E9]" />
                  <h3 className="text-[13px] font-medium text-[#EDEEF1]">Detected Branding</h3>
                </div>

                {brandPrimaryColor && (
                  <div className="flex items-center gap-3 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-8 w-8 rounded-lg border border-white/[0.1]"
                        style={{ backgroundColor: brandPrimaryColor }}
                      />
                      <div>
                        <p className="text-[11px] text-[#8B8FA3]">Primary</p>
                        <p className="text-[12px] text-[#EDEEF1] font-mono">{brandPrimaryColor}</p>
                      </div>
                    </div>
                    {brandAccentColor && (
                      <div className="flex items-center gap-2 ml-4">
                        <div
                          className="h-8 w-8 rounded-lg border border-white/[0.1]"
                          style={{ backgroundColor: brandAccentColor }}
                        />
                        <div>
                          <p className="text-[11px] text-[#8B8FA3]">Accent</p>
                          <p className="text-[12px] text-[#EDEEF1] font-mono">{brandAccentColor}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {brandFontFamily && (
                  <div className="px-3 py-2">
                    <p className="text-[11px] text-[#8B8FA3]">Font Family</p>
                    <p className="text-[13px] text-[#EDEEF1]">{brandFontFamily}</p>
                  </div>
                )}

                {brandLogoUrl && (
                  <div className="px-3 py-2">
                    <p className="text-[11px] text-[#8B8FA3] mb-1">Logo</p>
                    <img src={brandLogoUrl} alt="Detected logo" className="h-8 max-w-[160px] object-contain" />
                  </div>
                )}

                <p className="px-3 text-[10px] text-[#565A6E] mt-1">
                  Detected programmatically from your website. Used to style your article previews.
                </p>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => setStep("domain")}
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleSaveProfile}
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                className="flex-[2]"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            Step 3: Target Audience (AI-filled, editable)
            ════════════════════════════════════════════ */}
        {step === "audience" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <SectionHeader
              icon={Target}
              title="Target Audience"
              subtitle="Who are you writing for? AI-inferred from your site content"
            />

            <div className="flex flex-col gap-1 divide-y divide-white/[0.04]">
              <EditableField
                label="Country / Region"
                value={targetCountry}
                onChange={setTargetCountry}
              />
              <EditableField
                label="Language"
                value={language}
                onChange={setLanguage}
              />
              <EditableField
                label="Audience Summary"
                value={targetAudienceSummary}
                onChange={setTargetAudienceSummary}
                multiline
              />
              <EditableList
                label="Pain Points"
                items={painPoints}
                onChange={setPainPoints}
                placeholder="Add pain point"
              />
              <EditableField
                label="Product Usage"
                value={productUsage}
                onChange={setProductUsage}
                multiline
                placeholder="How does your audience use your product?"
              />
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => setStep("profile")}
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleSaveAudience}
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                className="flex-[2]"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            Step 4: Content Strategy
            ════════════════════════════════════════════ */}
        {step === "strategy" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <SectionHeader
              icon={Settings}
              title="Content Strategy"
              subtitle="Configure how your articles are generated and published"
            />

            {/* Competitors */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2 px-3">
                <Shield className="h-4 w-4 text-[#F59E0B]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">Competitors</h3>
              </div>
              <EditableList
                label="Never mention these competitors in articles"
                items={competitors}
                onChange={setCompetitors}
                placeholder="competitor.com"
              />
            </div>

            {/* CTA */}
            <div className="mb-4 border-t border-white/[0.04] pt-4">
              <div className="flex items-center gap-2 mb-1 px-3">
                <Target className="h-4 w-4 text-[#22C55E]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">Call to Action <span className="text-[11px] font-normal text-[#565A6E]">(optional)</span></h3>
              </div>
              <p className="text-[11px] text-[#565A6E] px-3 mb-2">Add a button at the end of each article to drive readers to your site</p>
              <div className="grid grid-cols-2 gap-3 px-3">
                <Input
                  label="Button text"
                  placeholder="e.g. Try it free"
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                />
                <Input
                  label="Button link"
                  placeholder="https://yoursite.com/signup"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                />
              </div>
            </div>

            {/* SEO Keywords */}
            <div className="mb-4 border-t border-white/[0.04] pt-4">
              <div className="flex items-center gap-2 mb-1 px-3">
                <Link2 className="h-4 w-4 text-[#0EA5E9]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">SEO Keywords</h3>
              </div>
              <p className="text-[11px] text-[#565A6E] px-3 mb-2">Keywords your articles should rank for — used in headings, links, and meta tags</p>
              <EditableList
                label=""
                items={anchorKeywords}
                onChange={setAnchorKeywords}
                placeholder="Add keyword"
              />
            </div>

            {/* Advanced Settings */}
            <div className="border-t border-white/[0.04] pt-4">
              <div className="flex items-center gap-2 mb-3 px-3">
                <Settings className="h-4 w-4 text-[#8B8FA3]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">Advanced</h3>
              </div>

              <div className="px-3 mb-3">
                <label className="text-[11px] font-medium text-[#8B8FA3] block mb-1">
                  Articles per week
                </label>
                <div className="flex items-center gap-3">
                  {[1, 2, 4, 7, 14, 21].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCadencePerWeek(n)}
                      className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${
                        cadencePerWeek === n
                          ? "bg-[#0EA5E9] text-white shadow-[0_0_12px_rgba(14,165,233,0.2)]"
                          : "bg-white/[0.04] text-[#8B8FA3] hover:bg-white/[0.06]"
                      }`}
                    >
                      {n}/wk
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-3 mb-3">
                <Input
                  label="Article URL path"
                  value={urlStructure}
                  onChange={(e) => setUrlStructure(e.target.value)}
                  placeholder="/blog/[slug]"
                />
                <p className="text-[10px] text-[#565A6E] mt-1">[slug] is replaced by the article title, e.g. /blog/how-to-grow-your-business</p>
              </div>

              <div className="flex flex-col gap-0">
                <ToggleSetting
                  label="Link to sources"
                  description="Articles include links to trusted external resources"
                  value={externalLinking}
                  onChange={setExternalLinking}
                />
                <ToggleSetting
                  label="Reference list"
                  description="Add a numbered list of sources at the end of each article"
                  value={sourceCitations}
                  onChange={setSourceCitations}
                />
                <ToggleSetting
                  label="YouTube videos"
                  description="Find and include relevant YouTube videos in articles"
                  value={youtubeEmbeds}
                  onChange={setYoutubeEmbeds}
                />
                <ToggleSetting
                  label="Review before publishing"
                  description="You approve each article before it goes live"
                  value={approvalRequired}
                  onChange={setApprovalRequired}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => setStep("audience")}
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleSaveStrategy}
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                className="flex-[2]"
              >
                Continue to Preview
              </Button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            Step 5: Integrations (optional)
            ════════════════════════════════════════════ */}
        {step === "integrations" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <SectionHeader
              icon={BarChart3}
              title="Connect Your Tools"
              subtitle="Set up publishing and connect optional integrations"
            />

            {/* ── Publishing Platform Config ── */}
            {publishMethod === "github" && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <GitBranch className="h-4 w-4 text-[#0EA5E9]" />
                  <h3 className="text-[13px] font-medium text-[#EDEEF1]">GitHub Publishing</h3>
                  <span className="ml-auto text-[10px] rounded-full px-2 py-0.5 bg-[#0EA5E9]/[0.08] text-[#38BDF8]">Required</span>
                </div>
                <p className="text-[11px] text-[#565A6E] px-1 mb-3">
                  Enter your repo details and connect your GitHub account so Pentra can commit articles as MDX files.
                </p>

                <div className="flex flex-col gap-3">
                  <div className="rounded-lg bg-[#0EA5E9]/[0.04] border border-[#0EA5E9]/[0.1] p-3">
                    <p className="text-[11px] text-[#8B8FA3] leading-relaxed">
                      <GitBranch className="inline h-3 w-3 mr-1 text-[#0EA5E9]" />
                      Find these from your GitHub repo URL: <span className="text-[#EDEEF1] font-mono">github.com/<span className="text-[#0EA5E9]">owner</span>/<span className="text-[#0EA5E9]">repo</span></span>
                    </p>
                    <p className="text-[10px] text-[#565A6E] mt-1">
                      Example: for <span className="font-mono text-[#8B8FA3]">github.com/acme/my-blog</span>, owner is <span className="text-[#EDEEF1]">acme</span> and repo is <span className="text-[#EDEEF1]">my-blog</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="GitHub Owner"
                      placeholder="acme"
                      value={repoOwner}
                      onChange={(e) => setRepoOwner(e.target.value)}
                    />
                    <Input
                      label="GitHub Repo"
                      placeholder="my-blog"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                    />
                  </div>

                  {githubConnected ? (
                    <div className="flex items-center gap-3 rounded-lg bg-[#22C55E]/[0.06] border border-[#22C55E]/[0.15] px-4 py-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22C55E]/[0.12]">
                        <Check className="h-4 w-4 text-[#22C55E]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#22C55E]">GitHub connected</p>
                        {githubUsername && (
                          <p className="text-[11px] text-[#565A6E]">Signed in as @{githubUsername}</p>
                        )}
                      </div>
                      <button
                        onClick={() => startOAuthPopup(siteId || "")}
                        className="text-[11px] text-[#565A6E] hover:text-[#0EA5E9] transition"
                      >
                        Reconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startOAuthPopup(siteId || "")}
                      className="flex items-center justify-center gap-2 w-full rounded-lg bg-[#0EA5E9] px-4 py-3 text-[13px] font-medium text-white transition hover:bg-[#0EA5E9]/90"
                    >
                      <GitBranch className="h-4 w-4" />
                      Connect GitHub Account
                    </button>
                  )}
                </div>
              </div>
            )}

            {publishMethod === "wordpress" && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Globe className="h-4 w-4 text-[#F59E0B]" />
                  <h3 className="text-[13px] font-medium text-[#EDEEF1]">WordPress Publishing</h3>
                  <span className="ml-auto text-[10px] rounded-full px-2 py-0.5 bg-[#F59E0B]/[0.08] text-[#FBBF24]">Required</span>
                </div>
                <p className="text-[11px] text-[#565A6E] px-1 mb-3">
                  Enter your WordPress credentials so Pentra can publish articles directly to your site via the REST API.
                </p>

                <div className="flex flex-col gap-3">
                  <div className="rounded-lg bg-[#F59E0B]/[0.04] border border-[#F59E0B]/[0.1] p-3">
                    <p className="text-[11px] text-[#8B8FA3] leading-relaxed">
                      <KeyRound className="inline h-3 w-3 mr-1 text-[#F59E0B]" />
                      You&apos;ll need an <span className="text-[#EDEEF1]">Application Password</span> (not your login password).
                    </p>
                    <p className="text-[10px] text-[#565A6E] mt-1">
                      In your WP admin: <span className="text-[#8B8FA3]">Users → Profile → scroll to &ldquo;Application Passwords&rdquo; → enter a name like &ldquo;Pentra&rdquo; → click &ldquo;Add New&rdquo;</span>. Copy the generated password.
                    </p>
                  </div>
                  <Input
                    label="WordPress URL"
                    placeholder="https://yoursite.com"
                    value={wpUrl}
                    onChange={(e) => setWpUrl(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Username"
                      placeholder="admin"
                      value={wpUsername}
                      onChange={(e) => setWpUsername(e.target.value)}
                    />
                    <Input
                      label="Application Password"
                      type="password"
                      placeholder="xxxx xxxx xxxx xxxx"
                      value={wpAppPassword}
                      onChange={(e) => setWpAppPassword(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
                    <Shield className="h-3.5 w-3.5 shrink-0 text-[#22C55E]" />
                    <p className="text-[10px] text-[#565A6E]">
                      Your credentials are <span className="text-[#8B8FA3]">encrypted at rest</span> and transmitted securely over <span className="text-[#8B8FA3]">HTTPS</span>. We never store plain-text passwords.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {publishMethod === "webhook" && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Webhook className="h-4 w-4 text-[#22C55E]" />
                  <h3 className="text-[13px] font-medium text-[#EDEEF1]">Webhook Publishing</h3>
                  <span className="ml-auto text-[10px] rounded-full px-2 py-0.5 bg-[#22C55E]/[0.08] text-[#4ADE80]">Required</span>
                </div>
                <p className="text-[11px] text-[#565A6E] px-1 mb-3">
                  We&apos;ll POST a JSON payload with the article title, markdown, HTML, and metadata to your endpoint whenever an article is published.
                </p>

                <div className="flex flex-col gap-3">
                  <Input
                    label="Webhook URL"
                    placeholder="https://api.yoursite.com/articles"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                  />
                  <Input
                    label="Secret (optional)"
                    type="password"
                    placeholder="your-webhook-secret"
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                  />
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                    <p className="text-[10px] text-[#565A6E]">
                      If you add a secret, we&apos;ll sign the payload with HMAC-SHA256 and include it in the <span className="font-mono text-[#8B8FA3]">X-Signature</span> header so you can verify requests are from Pentra.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {publishMethod === "manual" && (
              <div className="mb-5">
                <div className="flex items-center gap-3 rounded-lg bg-[#22C55E]/[0.06] border border-[#22C55E]/[0.15] px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22C55E]/[0.12]">
                    <Check className="h-4 w-4 text-[#22C55E]" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#22C55E]">No setup needed</p>
                    <p className="text-[11px] text-[#565A6E]">Articles will be ready for you to copy and paste into any CMS.</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Google Search Console ── */}
            <div className="border-t border-white/[0.04] pt-5 mb-5">
              <div className="flex items-center gap-2 mb-2 px-1">
                <BarChart3 className="h-4 w-4 text-[#F59E0B]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">Google Search Console</h3>
                <span className="ml-auto text-[10px] rounded-full px-2 py-0.5 bg-[#F59E0B]/[0.08] text-[#FBBF24]">Recommended</span>
              </div>
              <p className="text-[11px] text-[#565A6E] px-1 mb-3">
                Pentra uses GSC to track your keyword rankings, detect when articles lose traffic, and automatically refresh declining content. Without it, we can still write and publish — but we can&apos;t monitor or maintain your rankings.
              </p>

              {gscConnected ? (
                <div className="flex items-center gap-3 rounded-lg bg-[#22C55E]/[0.06] border border-[#22C55E]/[0.15] px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22C55E]/[0.12]">
                    <Check className="h-4 w-4 text-[#22C55E]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#22C55E]">Search Console connected</p>
                    {gscEmail && <p className="text-[11px] text-[#565A6E]">{gscEmail}</p>}
                  </div>
                  <button onClick={startGscOAuth} className="text-[11px] text-[#565A6E] hover:text-[#0EA5E9] transition">
                    Reconnect
                  </button>
                </div>
              ) : (
                <div>
                  <button
                    onClick={startGscOAuth}
                    className="flex items-center justify-center gap-2 w-full rounded-lg border border-white/[0.1] bg-white/[0.02] px-4 py-3 text-[13px] font-medium text-[#EDEEF1] transition hover:bg-white/[0.05] hover:border-[#F59E0B]/30"
                  >
                    <BarChart3 className="h-4 w-4 text-[#F59E0B]" />
                    Connect Google Search Console
                  </button>
                  <div className="mt-2 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
                    <p className="text-[10px] text-[#565A6E] leading-relaxed">
                      <strong className="text-[#8B8FA3]">Which account?</strong> Sign in with the Google account that owns your site&apos;s Search Console property.
                      This is usually the account you used to verify your site in{" "}
                      <span className="text-[#8B8FA3]">search.google.com/search-console</span>.
                      We only request <strong className="text-[#8B8FA3]">read-only</strong> access — we never modify your site.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ── Content Syndication ── */}
            <div className="border-t border-white/[0.04] pt-5">
              <div className="flex items-center gap-2 mb-2 px-1">
                <Share2 className="h-4 w-4 text-[#A78BFA]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">Content Syndication</h3>
                <span className="ml-auto text-[10px] rounded-full px-2 py-0.5 bg-white/[0.04] text-[#565A6E]">Optional</span>
              </div>
              <p className="text-[11px] text-[#565A6E] px-1 mb-3">
                Automatically cross-post your articles to Medium and LinkedIn when they&apos;re published. Each post includes a canonical URL pointing back to your site so you get the SEO credit — no duplicate content penalty.
              </p>

              <div className="flex flex-col gap-3">
                <ToggleSetting
                  label="Auto-Syndicate"
                  description="Automatically distribute articles to connected platforms when published"
                  value={syndicationEnabled}
                  onChange={setSyndicationEnabled}
                />

                {syndicationEnabled && (
                  <div className="flex flex-col gap-3 pl-1">
                    <div>
                      <Input
                        label="Medium Integration Token"
                        type="password"
                        placeholder="Get it from medium.com/me/settings/security"
                        value={mediumToken}
                        onChange={(e) => setMediumToken(e.target.value)}
                      />
                      <p className="text-[10px] text-[#565A6E] mt-1 px-1">
                        In Medium: Settings → Security → Integration tokens → generate one. Articles are posted as drafts with a canonical URL to your site.
                      </p>
                    </div>
                    <div>
                      <Input
                        label="LinkedIn Access Token"
                        type="password"
                        placeholder="OAuth access token for LinkedIn"
                        value={linkedinToken}
                        onChange={(e) => setLinkedinToken(e.target.value)}
                      />
                      <p className="text-[10px] text-[#565A6E] mt-1 px-1">
                        Each article gets an AI-written LinkedIn post linking back to the original.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => setStep("strategy")}
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleSaveIntegrations}
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                className="flex-[2]"
              >
                {gscConnected || syndicationEnabled ? "Continue" : "Skip for Now"}
              </Button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            Step 6: Article Preview
            ════════════════════════════════════════════ */}
        {step === "preview" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <SectionHeader
              icon={Eye}
              title="Article Preview"
              subtitle="This is how your articles will look with your brand styling"
            />

            {/* ── Mock Article (light background, simulating user's blog) ── */}
            <div
              className="rounded-xl border border-white/[0.1] overflow-hidden"
              style={{ fontFamily: brandFontFamily ? `"${brandFontFamily}", system-ui, sans-serif` : "system-ui, sans-serif" }}
            >
              {/* Hero area */}
              <div className="h-36 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                <div className="text-center">
                  {brandLogoUrl ? (
                    <img src={brandLogoUrl} alt="Logo" className="h-8 mx-auto mb-2 object-contain" />
                  ) : (
                    <div className="h-8 w-8 mx-auto mb-2 rounded-lg bg-gray-300" />
                  )}
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">
                    {siteName || "Your Blog"} Preview
                  </p>
                </div>
              </div>

              {/* Article content */}
              <div className="bg-white p-6">
                <h1 className="text-[22px] font-bold leading-tight mb-2" style={{ color: "#1a1a1a" }}>
                  10 Proven Strategies to Boost Your {niche ? niche.split(" ")[0] : "Business"} Growth in 2026
                </h1>

                <div className="flex items-center gap-3 mb-4 text-[11px] text-gray-400">
                  <span>8 min read</span>
                  <span>&middot;</span>
                  <span>3,800 words</span>
                  <span>&middot;</span>
                  <span>March 1, 2026</span>
                </div>

                <p className="text-[14px] text-gray-600 leading-relaxed mb-4">
                  In today&apos;s competitive landscape, {siteName || "businesses"} need
                  data-driven strategies to stand out. This comprehensive guide covers
                  the latest approaches backed by industry research and real case studies...
                </p>

                {/* H2 with brand color */}
                <h2
                  className="text-[18px] font-bold mb-2"
                  style={{ color: brandPrimaryColor || "#1a1a1a" }}
                >
                  1. Understanding Your Target Audience
                </h2>

                <p className="text-[14px] text-gray-600 leading-relaxed mb-3">
                  Before implementing any strategy, it&apos;s essential to understand who you&apos;re serving.{" "}
                  <a href="#" className="underline underline-offset-2" style={{ color: brandPrimaryColor || "#0EA5E9" }}>
                    Recent research [1]
                  </a>{" "}
                  shows that companies with clearly defined buyer personas see 73% higher conversion rates.
                </p>

                {/* Expert blockquote with accent color */}
                <blockquote
                  className="my-4 py-3 pl-4 pr-4 text-[14px] text-gray-500 italic rounded-r-lg"
                  style={{
                    borderLeft: `3px solid ${brandAccentColor || brandPrimaryColor || "#0EA5E9"}`,
                    backgroundColor: `${brandAccentColor || brandPrimaryColor || "#0EA5E9"}08`,
                  }}
                >
                  &ldquo;The most successful companies don&apos;t just find customers — they understand them deeply.&rdquo;
                  <span className="block mt-1 text-[12px] text-gray-400 not-italic">&mdash; Industry Expert</span>
                </blockquote>

                {/* Mini comparison table */}
                <div className="my-4 overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr style={{ backgroundColor: `${brandAccentColor || brandPrimaryColor || "#0EA5E9"}0D` }}>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Strategy</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Impact</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Difficulty</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-600">Content Marketing</td>
                        <td className="px-3 py-2 text-gray-600">High</td>
                        <td className="px-3 py-2 text-gray-600">Medium</td>
                      </tr>
                      <tr className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-600">SEO Optimization</td>
                        <td className="px-3 py-2 text-gray-600">Very High</td>
                        <td className="px-3 py-2 text-gray-600">Medium</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* CTA preview */}
                {ctaText && (
                  <div className="mt-4 mb-3">
                    <a
                      href="#"
                      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white"
                      style={{ backgroundColor: brandPrimaryColor || "#0EA5E9" }}
                    >
                      {ctaText}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}

                {/* Fade-out */}
                <div className="h-12 bg-gradient-to-b from-transparent to-white" />
                <p className="text-center text-[11px] text-gray-400 -mt-2">Article continues...</p>
              </div>
            </div>

            {/* ── Customize Your Style ── */}
            <div className="mt-5 border-t border-white/[0.04] pt-4">
              <div className="flex items-center gap-2 mb-3 px-1">
                <Palette className="h-4 w-4 text-[#0EA5E9]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">Customize Your Style</h3>
                <span className="text-[10px] text-[#565A6E] ml-auto">Changes update the preview above</span>
              </div>

              <div className="space-y-3">
                {/* Primary color */}
                <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2.5">
                  <input
                    type="color"
                    value={brandPrimaryColor || "#0EA5E9"}
                    onChange={(e) => setBrandPrimaryColor(e.target.value.toUpperCase())}
                    className="h-8 w-8 rounded-lg border border-white/[0.1] bg-transparent cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#EDEEF1]">Primary color</p>
                    <p className="text-[10px] text-[#565A6E]">Used for headings, links, and the CTA button</p>
                  </div>
                  <input
                    type="text"
                    value={brandPrimaryColor || ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (/^#[0-9A-Fa-f]{6}$/.test(v)) setBrandPrimaryColor(v.toUpperCase());
                    }}
                    placeholder="#0EA5E9"
                    className="w-[90px] rounded-lg border border-white/[0.06] bg-[#0F1117] px-2 py-1.5 text-[12px] text-[#EDEEF1] font-mono outline-none focus:border-[#0EA5E9]/50"
                  />
                </div>

                {/* Accent color */}
                <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2.5">
                  <input
                    type="color"
                    value={brandAccentColor || brandPrimaryColor || "#0EA5E9"}
                    onChange={(e) => setBrandAccentColor(e.target.value.toUpperCase())}
                    className="h-8 w-8 rounded-lg border border-white/[0.1] bg-transparent cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#EDEEF1]">Accent color</p>
                    <p className="text-[10px] text-[#565A6E]">Used for blockquote borders, table headers, and highlights</p>
                  </div>
                  <input
                    type="text"
                    value={brandAccentColor || ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (/^#[0-9A-Fa-f]{6}$/.test(v)) setBrandAccentColor(v.toUpperCase());
                    }}
                    placeholder={brandPrimaryColor || "#0EA5E9"}
                    className="w-[90px] rounded-lg border border-white/[0.06] bg-[#0F1117] px-2 py-1.5 text-[12px] text-[#EDEEF1] font-mono outline-none focus:border-[#0EA5E9]/50"
                  />
                </div>

                {/* Font family */}
                <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2.5">
                  <div className="h-8 w-8 rounded-lg border border-white/[0.1] bg-white/[0.03] flex items-center justify-center shrink-0">
                    <span className="text-[14px] font-bold text-[#8B8FA3]">Aa</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#EDEEF1]">Font</p>
                    <p className="text-[10px] text-[#565A6E]">Applied to headings and body text</p>
                  </div>
                  <input
                    type="text"
                    value={brandFontFamily || ""}
                    onChange={(e) => setBrandFontFamily(e.target.value || null)}
                    placeholder="System default"
                    className="w-[120px] rounded-lg border border-white/[0.06] bg-[#0F1117] px-2 py-1.5 text-[12px] text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
                  />
                </div>

                {/* Logo */}
                {brandLogoUrl && (
                  <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2.5">
                    <img src={brandLogoUrl} alt="Logo" className="h-8 w-8 rounded-lg border border-white/[0.1] object-contain bg-white p-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-[#EDEEF1]">Logo</p>
                      <p className="text-[10px] text-[#565A6E] truncate">{brandLogoUrl}</p>
                    </div>
                  </div>
                )}
              </div>

              {brandPrimaryColor && (
                <p className="text-[10px] text-[#565A6E] mt-2 px-1">
                  <Sparkles className="inline h-3 w-3 mr-0.5 text-[#0EA5E9]" />
                  Detected from your website — adjust anything that doesn&apos;t look right
                </p>
              )}
            </div>

            {/* Navigation */}
            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => setStep("integrations")}
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleGenerateFromPreview}
                loading={generating}
                icon={<Zap className="h-3.5 w-3.5" />}
                className="flex-[2]"
              >
                {generating ? "Generating..." : "Generate Content Plan"}
              </Button>
            </div>

            {generating && (
              <p className="mt-3 text-center text-[11px] text-[#565A6E]">
                Generating your content plan — this takes about 30 seconds
              </p>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════
            Step 6: Content Plan (topic roadmap)
            ════════════════════════════════════════════ */}
        {step === "generate" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <SectionHeader
              icon={Target}
              title="Your Content Roadmap"
              subtitle="These are the topics we'll write articles about"
            />

            {/* Topic count summary */}
            {topics && topics.length > 0 && (
              <div className="mb-4 rounded-lg bg-[#0EA5E9]/[0.04] border border-[#0EA5E9]/[0.1] px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-[#38BDF8]">
                    {topics.length} topics planned
                  </p>
                  <p className="text-[11px] text-[#565A6E]">
                    {cadencePerWeek} articles/week
                  </p>
                </div>
              </div>
            )}

            {/* Topic list */}
            {topics && topics.length > 0 && (
              <div className="mb-4 flex flex-col divide-y divide-white/[0.04]">
                {topics.map((t, i) => (
                  <div
                    key={t._id}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.04] text-[10px] font-bold text-[#565A6E] shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#EDEEF1] truncate">
                        {t.label}
                      </p>
                      <p className="text-[10px] text-[#565A6E] truncate">
                        {t.primaryKeyword}
                      </p>
                    </div>
                    {t.intent && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${
                        t.intent === "commercial"
                          ? "bg-[#F59E0B]/[0.08] text-[#FBBF24]"
                          : t.intent === "transactional"
                            ? "bg-[#22C55E]/[0.08] text-[#4ADE80]"
                            : "bg-[#0EA5E9]/[0.08] text-[#38BDF8]"
                      }`}>
                        {t.intent}
                      </span>
                    )}
                    {t.priority && (
                      <span className="shrink-0 text-[10px] text-[#565A6E]">
                        {"★".repeat(Math.min(t.priority, 5))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Autopilot notice */}
            <div className="mb-4 rounded-lg bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.1] px-4 py-3">
              <div className="flex items-start gap-2">
                <Zap className="h-3.5 w-3.5 text-[#4ADE80] mt-0.5 shrink-0" />
                <div>
                  <p className="text-[12px] font-medium text-[#4ADE80]">
                    Autopilot is ready
                  </p>
                  <p className="text-[11px] text-[#565A6E] mt-0.5">
                    Hit &ldquo;Generate Now&rdquo; from the dashboard to write your first article, or let autopilot pick it up on its next run.
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => setStep("done")}
              icon={<ArrowRight className="h-3.5 w-3.5" />}
              className="w-full"
            >
              Go to Dashboard
            </Button>
          </div>
        )}

        {/* ════════════════════════════════════════════
            Done
            ════════════════════════════════════════════ */}
        {step === "done" && (
          <div className="rounded-xl border border-[#22C55E]/[0.15] bg-[#22C55E]/[0.03] p-8 text-center">
            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-[#22C55E]/[0.1]">
              <Check className="h-7 w-7 text-[#22C55E]" />
            </div>
            <h2 className="mt-4 text-[17px] font-semibold text-[#EDEEF1]">
              Your content engine is running!
            </h2>
            <p className="mt-2 text-[13px] text-[#8B8FA3] max-w-sm mx-auto">
              {topics && topics.length > 0
                ? `${topics.length} topics planned`
                : "Topics planned"}{" "}
              &middot; Autopilot will generate {cadencePerWeek} articles per week.
              Hit &ldquo;Generate Now&rdquo; from the dashboard to start your first one.
            </p>

            <div className="mt-5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-4 text-left max-w-xs mx-auto">
              <p className="text-[11px] text-[#565A6E] mb-2 font-medium">Your Setup</p>
              <div className="flex flex-col gap-1.5 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-[#8B8FA3]">Site</span>
                  <span className="text-[#EDEEF1]">{siteName || domain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B8FA3]">Topics</span>
                  <span className="text-[#EDEEF1]">{topics?.length ?? "—"} planned</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B8FA3]">Cadence</span>
                  <span className="text-[#EDEEF1]">{cadencePerWeek} articles/week</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B8FA3]">Mode</span>
                  <span className="text-[#EDEEF1]">Autopilot</span>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-[#0EA5E9]/[0.06] border border-[#0EA5E9]/[0.12] px-4 py-3 max-w-xs mx-auto">
              <p className="text-[11px] text-[#0EA5E9]">
                Click &ldquo;Generate Now&rdquo; on the dashboard to create your first article, or autopilot will handle it.
              </p>
            </div>

            <Button
              onClick={() => window.location.assign("/dashboard")}
              icon={<ArrowRight className="h-3.5 w-3.5" />}
              className="mt-6"
            >
              Go to Dashboard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
