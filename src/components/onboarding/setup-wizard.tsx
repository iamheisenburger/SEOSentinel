"use client";

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
} from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";

type Step = "domain" | "profile" | "audience" | "strategy" | "generate" | "done";

const STEPS: { key: Step; label: string; icon: typeof Globe }[] = [
  { key: "domain", label: "Website", icon: Globe },
  { key: "profile", label: "Profile", icon: Building2 },
  { key: "audience", label: "Audience", icon: Users },
  { key: "strategy", label: "Strategy", icon: Settings },
  { key: "generate", label: "Launch", icon: Zap },
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

  // Loading states
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Convex hooks
  const upsert = useMutation(api.sites.upsert);
  const crawlAndAnalyze = useAction(api.actions.pipeline.crawlAndAnalyze);
  const generatePlan = useAction(api.actions.pipeline.generatePlan);
  const generateNow = useAction(api.actions.pipeline.generateNow);

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
    setError(null);
    setAnalyzing(true);
    setStatusMsg("Creating site record...");

    try {
      // Create site
      const id = await upsert({
        domain: domain.trim(),
        publishMethod,
        repoOwner: repoOwner.trim() || undefined,
        repoName: repoName.trim() || undefined,
        wpUrl: wpUrl.trim() || undefined,
        wpUsername: wpUsername.trim() || undefined,
        wpAppPassword: wpAppPassword.trim() || undefined,
        webhookUrl: webhookUrl.trim() || undefined,
        webhookSecret: webhookSecret.trim() || undefined,
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

      // Populate all fields from analysis
      const a = result.analysis;
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

  // ─── Save strategy + generate ───────────────────────
  const handleSaveStrategyAndGenerate = async () => {
    if (!siteId) return;
    setError(null);
    setGenerating(true);

    try {
      // Save strategy settings
      setStatusMsg("Saving content strategy...");
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

      // Generate topic plan
      setStatusMsg("Generating SEO topic plan based on your site analysis...");
      await generatePlan({ siteId });

      // Generate first article
      setStatusMsg("Writing your first article — research, writing, fact-checking...");
      await generateNow({ siteId });

      setStatusMsg(null);
      setStep("done");
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

              {/* ── Platform-specific fields ── */}
              {publishMethod === "github" && (
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
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                    <p className="text-[11px] text-[#8B8FA3]">
                      <FileText className="inline h-3 w-3 mr-1 text-[#8B8FA3]" />
                      Articles are committed as MDX files to your repo. Works with Next.js, Astro, Hugo, Jekyll, and any static site generator.
                    </p>
                  </div>
                </div>
              )}

              {publishMethod === "wordpress" && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg bg-[#F59E0B]/[0.04] border border-[#F59E0B]/[0.1] p-3">
                    <p className="text-[11px] text-[#8B8FA3] leading-relaxed">
                      <KeyRound className="inline h-3 w-3 mr-1 text-[#F59E0B]" />
                      You&apos;ll need an <span className="text-[#EDEEF1]">Application Password</span> (not your login password).
                    </p>
                    <p className="text-[10px] text-[#565A6E] mt-1">
                      In your WP admin: <span className="text-[#8B8FA3]">Users → Profile → scroll to &ldquo;Application Passwords&rdquo; → enter a name like &ldquo;SEOSentinel&rdquo; → click &ldquo;Add New&rdquo;</span>. Copy the generated password.
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
                      placeholder="xxxx xxxx xxxx xxxx"
                      value={wpAppPassword}
                      onChange={(e) => setWpAppPassword(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {publishMethod === "webhook" && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.1] p-3">
                    <p className="text-[11px] text-[#8B8FA3] leading-relaxed">
                      <Webhook className="inline h-3 w-3 mr-1 text-[#22C55E]" />
                      We&apos;ll <span className="text-[#EDEEF1]">POST</span> a JSON payload with <span className="font-mono text-[#EDEEF1]">title</span>, <span className="font-mono text-[#EDEEF1]">markdown</span>, <span className="font-mono text-[#EDEEF1]">html</span>, and metadata to your endpoint.
                    </p>
                    <p className="text-[10px] text-[#565A6E] mt-1">
                      Add a secret to verify requests are from SEOSentinel. We&apos;ll sign the payload with HMAC-SHA256 and include it in the <span className="font-mono text-[#8B8FA3]">X-Signature</span> header.
                    </p>
                  </div>
                  <Input
                    label="Webhook URL"
                    placeholder="https://api.yoursite.com/articles"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                  />
                  <Input
                    label="Secret (optional)"
                    placeholder="your-webhook-secret"
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                  />
                </div>
              )}

              {publishMethod === "manual" && (
                <div className="rounded-lg bg-[#0EA5E9]/[0.04] border border-[#0EA5E9]/[0.1] p-3">
                  <p className="text-[12px] text-[#8B8FA3]">
                    <Copy className="inline h-3.5 w-3.5 mr-1 text-[#0EA5E9]" />
                    Articles will be generated and ready for you to copy. Use the <span className="text-[#EDEEF1]">Copy Markdown</span> or <span className="text-[#EDEEF1]">Copy HTML</span> buttons on each article to paste into any CMS — Wix, Squarespace, Shopify, Webflow, or anywhere else.
                  </p>
                </div>
              )}

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
              <div className="flex items-center gap-2 mb-2 px-3">
                <Target className="h-4 w-4 text-[#22C55E]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">Call to Action</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 px-3">
                <Input
                  label="CTA Text"
                  placeholder="Try it free"
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                />
                <Input
                  label="CTA URL"
                  placeholder="https://..."
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                />
              </div>
            </div>

            {/* Backlinks */}
            <div className="mb-4 border-t border-white/[0.04] pt-4">
              <div className="flex items-center gap-2 mb-2 px-3">
                <Link2 className="h-4 w-4 text-[#0EA5E9]" />
                <h3 className="text-[13px] font-medium text-[#EDEEF1]">Backlinks</h3>
              </div>
              <EditableList
                label="Priority anchor keywords for internal/external linking"
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
                  {[1, 2, 4, 7].map((n) => (
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
                  label="URL Structure"
                  value={urlStructure}
                  onChange={(e) => setUrlStructure(e.target.value)}
                  placeholder="/blog/[slug]"
                />
              </div>

              <div className="flex flex-col gap-0">
                <ToggleSetting
                  label="External linking"
                  description="Include outbound links to authoritative sources"
                  value={externalLinking}
                  onChange={setExternalLinking}
                />
                <ToggleSetting
                  label="Source citations"
                  description="Add numbered source references at the end"
                  value={sourceCitations}
                  onChange={setSourceCitations}
                />
                <ToggleSetting
                  label="YouTube embeds"
                  description="Embed relevant YouTube videos in articles"
                  value={youtubeEmbeds}
                  onChange={setYoutubeEmbeds}
                />
                <ToggleSetting
                  label="Approval required"
                  description="Review articles before they're published"
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
                onClick={handleSaveStrategyAndGenerate}
                loading={generating}
                icon={<Zap className="h-3.5 w-3.5" />}
                className="flex-[2]"
              >
                {generating ? "Generating..." : "Save & Generate First Article"}
              </Button>
            </div>

            {generating && (
              <p className="mt-3 text-center text-[11px] text-[#565A6E]">
                This may take 2-3 minutes — topic planning, research, writing, and fact-checking
              </p>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════
            Step 5: Generate (show progress)
            ════════════════════════════════════════════ */}
        {step === "generate" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <SectionHeader
              icon={FileText}
              title="Your first article"
              subtitle="Generating topic plan and first article"
            />

            {topics && topics.length > 0 && (
              <div className="mb-4 rounded-lg bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.1] p-3">
                <p className="text-[12px] text-[#4ADE80] mb-2">
                  <Check className="inline h-3.5 w-3.5 mr-1" />
                  {topics.length} topics generated
                </p>
                <div className="flex flex-col gap-1.5">
                  {topics.slice(0, 3).map((t) => (
                    <div
                      key={t._id}
                      className="flex items-center gap-2 text-[11px] text-[#8B8FA3]"
                    >
                      <Sparkles className="h-3 w-3 text-[#0EA5E9] shrink-0" />
                      <span className="truncate">{t.primaryKeyword}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {articles && articles.length > 0 && (
              <div className="mb-4 rounded-lg bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.1] p-3">
                <p className="text-[12px] text-[#4ADE80] mb-1">
                  <Check className="inline h-3.5 w-3.5 mr-1" />
                  Article created!
                </p>
                <p className="text-[12px] text-[#8B8FA3] line-clamp-1">
                  {articles[0].title}
                </p>
              </div>
            )}

            <Button
              onClick={() => setStep("done")}
              disabled={!articles || articles.length === 0}
              icon={<ArrowRight className="h-3.5 w-3.5" />}
              className="w-full"
            >
              Continue
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
              Your SEO engine is live!
            </h2>
            <p className="mt-2 text-[13px] text-[#8B8FA3] max-w-sm mx-auto">
              Your pipeline is fully configured with AI-analyzed site context.
              Articles will generate on schedule, or hit &ldquo;Generate Now&rdquo; anytime.
            </p>

            <div className="mt-5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-4 text-left max-w-xs mx-auto">
              <p className="text-[11px] text-[#565A6E] mb-2 font-medium">Configuration</p>
              <div className="flex flex-col gap-1.5 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-[#8B8FA3]">Site</span>
                  <span className="text-[#EDEEF1]">{siteName || domain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B8FA3]">Type</span>
                  <span className="text-[#EDEEF1]">{siteType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B8FA3]">Cadence</span>
                  <span className="text-[#EDEEF1]">{cadencePerWeek} articles/week</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B8FA3]">Approval</span>
                  <span className="text-[#EDEEF1]">{approvalRequired ? "Required" : "Auto-publish"}</span>
                </div>
              </div>
            </div>

            <Button
              onClick={() => window.location.reload()}
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
