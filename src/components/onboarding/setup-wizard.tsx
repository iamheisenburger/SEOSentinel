"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Globe,
  Search,
  Map,
  FileText,
  ArrowRight,
  Check,
  Loader2,
  Sparkles,
  AlertCircle,
  GitBranch,
  Zap,
} from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";

type Step = "domain" | "crawl" | "plan" | "generate" | "done";

const STEPS: { key: Step; label: string; icon: typeof Globe }[] = [
  { key: "domain", label: "Your Site", icon: Globe },
  { key: "crawl", label: "Crawl", icon: Search },
  { key: "plan", label: "Topics", icon: Map },
  { key: "generate", label: "Article", icon: FileText },
];

export function SetupWizard() {
  const [step, setStep] = useState<Step>("domain");
  const [siteId, setSiteId] = useState<Id<"sites"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Domain form
  const [domain, setDomain] = useState("");
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");

  // Loading states
  const [crawling, setCrawling] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Status messages for long-running ops
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Convex hooks
  const upsert = useMutation(api.sites.upsert);
  const onboard = useAction(api.actions.pipeline.onboardSite);
  const generatePlan = useAction(api.actions.pipeline.generatePlan);
  const generateNow = useAction(api.actions.pipeline.generateNow);

  // Reactive queries (once we have a siteId)
  const pages = useQuery(
    api.pages.listBySite,
    siteId ? { siteId } : "skip",
  );
  const topics = useQuery(
    api.topics.listBySite,
    siteId ? { siteId } : "skip",
  );
  const articles = useQuery(
    api.articles.listBySite,
    siteId ? { siteId } : "skip",
  );

  const currentIdx = STEPS.findIndex((s) => s.key === step);

  // ─── Step 1: Save domain ──────────────────────────
  const handleSaveDomain = async () => {
    if (!domain.trim()) return;
    setError(null);
    try {
      const id = await upsert({
        domain: domain.trim(),
        repoOwner: repoOwner.trim() || undefined,
        repoName: repoName.trim() || undefined,
        cadencePerWeek: 4,
        approvalRequired: true,
        autopilotEnabled: true,
        inferToneNiche: true,
        language: "en",
      });
      setSiteId(id);
      setStep("crawl");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save site");
    }
  };

  // ─── Step 2: Crawl ────────────────────────────────
  const handleCrawl = async () => {
    if (!siteId) return;
    setCrawling(true);
    setError(null);
    setStatusMsg("Crawling your site — this takes 30-60 seconds...");
    try {
      await onboard({ siteId });
      setStatusMsg(null);
      setStep("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Crawl failed");
      setStatusMsg(null);
    } finally {
      setCrawling(false);
    }
  };

  // ─── Step 3: Generate topics ──────────────────────
  const handlePlan = async () => {
    if (!siteId) return;
    setPlanning(true);
    setError(null);
    setStatusMsg("Generating topic ideas from your site content...");
    try {
      await generatePlan({ siteId });
      setStatusMsg(null);
      setStep("generate");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Topic generation failed");
      setStatusMsg(null);
    } finally {
      setPlanning(false);
    }
  };

  // ─── Step 4: Generate article ─────────────────────
  const handleGenerate = async () => {
    if (!siteId) return;
    setGenerating(true);
    setError(null);
    setStatusMsg("Researching, writing, and fact-checking your first article...");
    try {
      await generateNow({ siteId });
      setStatusMsg(null);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Article generation failed");
      setStatusMsg(null);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col items-center py-8 sm:py-12">
      {/* ─── Progress Steps ──────────────────────── */}
      <div className="mb-10 flex items-center gap-0">
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
                  className={`mx-3 mt-[-18px] h-px w-10 sm:w-16 ${
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
      <div className="w-full max-w-lg">
        {/* Error */}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-[#EF4444]/[0.08] px-4 py-3 text-[13px] text-[#F87171]">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Status message for long ops */}
        {statusMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-[#0EA5E9]/[0.08] px-4 py-3 text-[13px] text-[#38BDF8]">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* ── Step 1: Domain ────────────────────── */}
        {step === "domain" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.08]">
                <Globe className="h-5 w-5 text-[#0EA5E9]" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-[#EDEEF1]">
                  Add your website
                </h2>
                <p className="text-[12px] text-[#565A6E]">
                  We&apos;ll crawl it to understand your content and niche
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Input
                label="Domain"
                placeholder="example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveDomain()}
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="GitHub Owner"
                  placeholder="username"
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
              <p className="text-[11px] text-[#565A6E] -mt-2">
                Optional — for publishing articles via GitHub commit
              </p>

              <Button
                onClick={handleSaveDomain}
                disabled={!domain.trim()}
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                className="mt-2 w-full"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Crawl ─────────────────────── */}
        {step === "crawl" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.08]">
                <Search className="h-5 w-5 text-[#0EA5E9]" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-[#EDEEF1]">
                  Crawl your site
                </h2>
                <p className="text-[12px] text-[#565A6E]">
                  We&apos;ll analyze your pages to understand your niche, tone, and existing content
                </p>
              </div>
            </div>

            <div className="mb-5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-[13px] text-[#EDEEF1]">
                <Globe className="h-4 w-4 text-[#0EA5E9]" />
                {domain}
              </div>
            </div>

            {/* Show crawl results if pages exist */}
            {pages && pages.length > 0 && (
              <div className="mb-4 rounded-lg bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.1] p-3">
                <p className="text-[12px] text-[#4ADE80]">
                  <Check className="inline h-3.5 w-3.5 mr-1" />
                  Found {pages.length} pages
                </p>
              </div>
            )}

            <Button
              onClick={handleCrawl}
              loading={crawling}
              icon={<Search className="h-3.5 w-3.5" />}
              className="w-full"
            >
              {crawling ? "Crawling..." : "Start Crawl"}
            </Button>
          </div>
        )}

        {/* ── Step 3: Topics ────────────────────── */}
        {step === "plan" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.08]">
                <Map className="h-5 w-5 text-[#0EA5E9]" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-[#EDEEF1]">
                  Generate topic plan
                </h2>
                <p className="text-[12px] text-[#565A6E]">
                  AI analyzes your niche and creates SEO-optimized article topics
                </p>
              </div>
            </div>

            {/* Show crawl summary */}
            {pages && pages.length > 0 && (
              <div className="mb-4 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                <p className="text-[12px] text-[#8B8FA3]">
                  <Check className="inline h-3.5 w-3.5 mr-1 text-[#22C55E]" />
                  {pages.length} pages crawled from {domain}
                </p>
              </div>
            )}

            {/* Show topics if they exist */}
            {topics && topics.length > 0 && (
              <div className="mb-4 rounded-lg bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.1] p-3">
                <p className="text-[12px] text-[#4ADE80] mb-2">
                  <Check className="inline h-3.5 w-3.5 mr-1" />
                  {topics.length} topics generated
                </p>
                <div className="flex flex-col gap-1.5">
                  {topics.slice(0, 5).map((t) => (
                    <div
                      key={t._id}
                      className="flex items-center gap-2 text-[11px] text-[#8B8FA3]"
                    >
                      <Sparkles className="h-3 w-3 text-[#0EA5E9] shrink-0" />
                      <span className="truncate">{t.primaryKeyword}</span>
                      {t.intent && (
                        <span className="shrink-0 rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#565A6E]">
                          {t.intent}
                        </span>
                      )}
                    </div>
                  ))}
                  {topics.length > 5 && (
                    <p className="text-[10px] text-[#565A6E]">
                      +{topics.length - 5} more
                    </p>
                  )}
                </div>
              </div>
            )}

            <Button
              onClick={topics && topics.length > 0 ? () => setStep("generate") : handlePlan}
              loading={planning}
              icon={
                topics && topics.length > 0 ? (
                  <ArrowRight className="h-3.5 w-3.5" />
                ) : (
                  <Map className="h-3.5 w-3.5" />
                )
              }
              className="w-full"
            >
              {planning
                ? "Generating topics..."
                : topics && topics.length > 0
                  ? "Continue"
                  : "Generate Topics"}
            </Button>
          </div>
        )}

        {/* ── Step 4: Generate ──────────────────── */}
        {step === "generate" && (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.08]">
                <FileText className="h-5 w-5 text-[#0EA5E9]" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-[#EDEEF1]">
                  Generate your first article
                </h2>
                <p className="text-[12px] text-[#565A6E]">
                  Web research → AI writing → fact-check → publish
                </p>
              </div>
            </div>

            {/* Show topic count */}
            {topics && topics.length > 0 && (
              <div className="mb-4 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                <p className="text-[12px] text-[#8B8FA3]">
                  <Check className="inline h-3.5 w-3.5 mr-1 text-[#22C55E]" />
                  {topics.length} topics ready — picking the best one
                </p>
              </div>
            )}

            {/* Show article if generated */}
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
              onClick={articles && articles.length > 0 ? () => setStep("done") : handleGenerate}
              loading={generating}
              icon={
                articles && articles.length > 0 ? (
                  <ArrowRight className="h-3.5 w-3.5" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )
              }
              className="w-full"
            >
              {generating
                ? "Generating article..."
                : articles && articles.length > 0
                  ? "Go to Dashboard"
                  : "Generate Article"}
            </Button>

            <p className="mt-3 text-center text-[11px] text-[#565A6E]">
              This may take 2-3 minutes — research, writing, and fact-checking
            </p>
          </div>
        )}

        {/* ── Done ──────────────────────────────── */}
        {step === "done" && (
          <div className="rounded-xl border border-[#22C55E]/[0.15] bg-[#22C55E]/[0.03] p-8 text-center">
            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-[#22C55E]/[0.1]">
              <Check className="h-7 w-7 text-[#22C55E]" />
            </div>
            <h2 className="mt-4 text-[17px] font-semibold text-[#EDEEF1]">
              You&apos;re all set!
            </h2>
            <p className="mt-2 text-[13px] text-[#8B8FA3] max-w-sm mx-auto">
              Your pipeline is configured. Articles will generate on your
              schedule, or hit &ldquo;Generate Now&rdquo; from the dashboard anytime.
            </p>
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
