"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import {
  Zap,
  Globe,
  Map,
  FileText,
  Search,
  ShieldCheck,
  GitBranch,
  Activity,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow, formatDuration, intervalToDuration } from "date-fns";

export default function JobsPage() {
  const jobs = useQuery(api.jobs.listAll);
  const [activeTab, setActiveTab] = useState("all");

  const filtered = useMemo(() => {
    if (!jobs) return [];
    if (activeTab === "all") return jobs;
    return jobs.filter((j) => j.status === activeTab);
  }, [jobs, activeTab]);

  const runningCount = jobs?.filter((j) => j.status === "running").length ?? 0;
  const failedCount = jobs?.filter((j) => j.status === "failed").length ?? 0;

  const tabs = [
    { id: "all", label: "All", count: jobs?.length ?? 0 },
    {
      id: "running",
      label: "In progress",
      count: runningCount,
    },
    {
      id: "done",
      label: "Finished",
      count: jobs?.filter((j) => j.status === "done").length ?? 0,
    },
    {
      id: "failed",
      label: "Stopped",
      count: failedCount,
    },
  ];

  if (jobs === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#0E0F11]">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.04] last:border-0">
              <div className="h-8 w-8 animate-pulse rounded-lg bg-white/[0.04]" />
              <div className="flex-1">
                <div className="h-3.5 w-32 animate-pulse rounded bg-white/[0.04]" />
              </div>
              <div className="h-3 w-16 animate-pulse rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Activity"
        subtitle={
          runningCount > 0
            ? `Pentra is working on ${runningCount} task${runningCount > 1 ? "s" : ""} now.`
            : "What Pentra has been doing for your website recently."
        }
      />

      {/* Status indicator */}
      {runningCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-[#0EA5E9]/[0.06] border border-[#0EA5E9]/[0.1] px-4 py-2.5">
          <span className="flex h-2 w-2">
            <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-[#0EA5E9] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0EA5E9]" />
          </span>
          <span className="text-[13px] text-[#38BDF8]">
            Pentra is working on your website now
          </span>
        </div>
      )}

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Job Timeline */}
      {filtered.length > 0 ? (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[19px] top-6 bottom-6 w-px bg-white/[0.04] hidden sm:block" />

          <div className="flex flex-col gap-0">
            {filtered.map((job) => {
              const duration =
                job.status === "done"
                  ? getDuration(job.createdAt, job.updatedAt)
                  : null;
              const problem = explainJobProblem(job);
              const articleId = jobArticleId(job);

              return (
                <div
                  key={job._id}
                  className="flex items-start gap-3 sm:gap-4 px-0 sm:pl-1 py-3"
                >
                  {/* Timeline dot */}
                  <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    job.status === "done"
                      ? "bg-[#22C55E]/[0.08]"
                      : job.status === "running"
                        ? "bg-[#0EA5E9]/[0.1] ring-1 ring-[#0EA5E9]/20"
                        : job.status === "failed"
                          ? "bg-[#EF4444]/[0.08]"
                          : "bg-white/[0.04]"
                  }`}>
                    <JobIcon
                      type={job.type}
                      className={`h-3.5 w-3.5 ${
                        job.status === "done"
                          ? "text-[#22C55E]"
                          : job.status === "running"
                            ? "text-[#0EA5E9]"
                            : job.status === "failed"
                              ? "text-[#EF4444]"
                              : "text-[#62666D]"
                      }`}
                    />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-medium text-[#F7F8F8]">
                        {jobLabel(job)}
                      </p>
                      {job.status === "done" && (
                        <CheckCircle2 className="h-3 w-3 text-[#22C55E]" />
                      )}
                      {job.status === "running" && (
                        <span className="flex items-center gap-1 text-[10px] text-[#0EA5E9]">
                          <span className="h-1 w-1 rounded-full bg-[#0EA5E9] animate-pulse" />
                          in progress
                        </span>
                      )}
                      {job.status === "failed" && (
                        <span className="text-[10px] text-[#F87171]">stopped</span>
                      )}
                    </div>

                    {/* Step progress (live) */}
                    {job.status === "running" && job.stepProgress && (
                      <div className="mt-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1 flex-1 rounded-full bg-white/[0.04]">
                            <div
                              className="h-1 rounded-full bg-[#0EA5E9] transition-all duration-700 ease-out"
                              style={{
                                width: `${(job.stepProgress.current / job.stepProgress.total) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-[#0EA5E9] tabular-nums shrink-0">
                            {job.stepProgress.current}/{job.stepProgress.total}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#38BDF8]">
                          {job.stepProgress.stepLabel}
                        </p>
                      </div>
                    )}

                    {/* What happened, in plain words, and what to do next */}
                    {problem && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded bg-[#EF4444]/[0.04] px-2.5 py-1.5">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-[#F87171]" />
                        <div className="min-w-0 text-[11px] leading-relaxed">
                          <p className="text-[#F87171]">{problem.message}</p>
                          <p className="text-[#8A8F98]">
                            {problem.next}
                            {problem.action && (
                              <>
                                {" "}
                                <Link href={problem.action.href} className="underline hover:text-[#F7F8F8]">
                                  {problem.action.label}
                                </Link>
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#62666D]">
                      <span>
                        {formatDistanceToNow(job.createdAt, { addSuffix: true })}
                      </span>
                      {duration && (
                        <>
                          <span className="text-white/[0.08]">·</span>
                          <span>took {duration}</span>
                        </>
                      )}
                      {articleId && (
                        <>
                          <span className="text-white/[0.08]">·</span>
                          <Link href={`/articles/${articleId}`} className="text-[#0EA5E9] hover:text-[#38BDF8]">
                            Open article
                          </Link>
                        </>
                      )}
                      {job.retries != null && job.retries > 0 && (
                        <>
                          <span className="text-white/[0.08]">·</span>
                          <span className="text-[#F59E0B]">
                            attempt {job.retries + 1}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-[#0E0F11] p-12 text-center">
          <Zap className="mx-auto h-10 w-10 text-[#62666D]/30" />
          <p className="mt-3 text-[13px] text-[#62666D]">
            {activeTab !== "all"
              ? "Nothing to show here."
              : "No activity yet. Pentra will list its work here as it happens."}
          </p>
        </div>
      )}
    </div>
  );
}


type JobProblem = {
  message: string;
  next: string;
  action?: { href: string; label: string };
};

const NOT_PUBLISHED = "Nothing was published.";
const CONTACT = { href: "/contact", label: "Contact support" };
const ARTICLES = { href: "/articles", label: "Go to Articles" };
const SETTINGS = { href: "/settings", label: "Open Settings" };
const PLANS = { href: "/upgrade", label: "See plans" };

const STOPPED: JobProblem = {
  message: `Pentra hit a problem and stopped this run. ${NOT_PUBLISHED}`,
  next: "If this keeps happening,",
  action: { ...CONTACT, label: "contact support." },
};

const QUALITY: JobProblem = {
  message: `This draft did not pass Pentra's quality review. ${NOT_PUBLISHED}`,
  next: "Read the reviewer's notes on the article, then fix or accept them.",
};

const SERVICE_UNAVAILABLE: JobProblem = {
  message: `Pentra's writing service was unavailable. ${NOT_PUBLISHED}`,
  next: "You don't need to do anything or change your plan.",
};

const ALLOWANCE_USED: JobProblem = {
  message: `You've used all your articles for this month. ${NOT_PUBLISHED}`,
  next: "Upgrade your plan or wait until next month.",
  action: PLANS,
};

// Known stop reasons, recorded as short codes, mapped to plain explanations.
const JOB_PROBLEMS: Record<string, JobProblem> = {
  owner_rejected_draft: {
    message: "You declined this draft, so it will not be published.",
    next: "You can request a new draft whenever you like.",
    action: ARTICLES,
  },
  owner_edited_draft: {
    message: "You edited this draft, so Pentra reviewed your new version instead.",
    next: "Your edited version is in Articles.",
    action: ARTICLES,
  },
  owner_review_needed: {
    message: "This draft is waiting for your review.",
    next: "Open the article to approve or edit it.",
  },
  bounded_content_quality_exhausted: QUALITY,
  content_quality_exhausted: QUALITY,
  content_review_rejected: QUALITY,
  content_recovery_attempts_exhausted: {
    message: `Pentra tried several times but could not finish this article. ${NOT_PUBLISHED}`,
    next: "You can request a new draft. If this keeps happening,",
    action: { ...CONTACT, label: "contact support." },
  },
  job_retry_exhausted: {
    message: `Pentra tried several times but could not finish this run. ${NOT_PUBLISHED}`,
    next: "If this keeps happening,",
    action: { ...CONTACT, label: "contact support." },
  },
  job_lease_exhausted: {
    message: `Pentra tried several times but could not finish this run. ${NOT_PUBLISHED}`,
    next: "If this keeps happening,",
    action: { ...CONTACT, label: "contact support." },
  },
  content_model_response_invalid: {
    message: `The writing service sent back an incomplete article. ${NOT_PUBLISHED}`,
    next: "You can request a new draft.",
    action: ARTICLES,
  },
  content_provider_credit_unavailable: SERVICE_UNAVAILABLE,
  provider_credit_unavailable: SERVICE_UNAVAILABLE,
  provider_balance_insufficient: SERVICE_UNAVAILABLE,
  provider_balance_unavailable: SERVICE_UNAVAILABLE,
  article_provider_funding_unavailable: SERVICE_UNAVAILABLE,
  content_provider_result_ambiguous_reconciliation_required: {
    message: `Pentra could not confirm how this run ended, so it stopped to be safe. ${NOT_PUBLISHED}`,
    next: "If this keeps happening,",
    action: { ...CONTACT, label: "contact support." },
  },
  content_publication_failed_reconciliation_required: {
    message: "Pentra could not confirm whether this article reached your website.",
    next: "Check your website before publishing it again. If it is missing,",
    action: { ...CONTACT, label: "contact support." },
  },
  public_url_failed: {
    message: "Pentra could not confirm that this article is live on your website.",
    next: "Check your publishing connection.",
    action: SETTINGS,
  },
  improvement_live_artifact_not_verified: {
    message: "Pentra could not confirm the live page, so it did not change it.",
    next: "Check that the page is live on your website.",
  },
  candidate_rejected_before_draft: {
    message: `Pentra decided this topic was not a good fit and did not write it. ${NOT_PUBLISHED}`,
    next: "No action needed.",
  },
  article_quota_reached: ALLOWANCE_USED,
  article_quota_no_headroom: ALLOWANCE_USED,
  article_provider_monthly_attempt_limit: ALLOWANCE_USED,
};

/** Plain explanation and next step for a job that stopped or is retrying.
 * Raw error text and codes are never shown to the owner. */
function explainJobProblem(job: Doc<"jobs">): JobProblem | null {
  if (job.status === "done") return null;
  const raw = (job.contentWork?.failure ?? job.error ?? "").trim();
  if (!raw) return null;
  const stopped = job.status === "failed";
  const known = JOB_PROBLEMS[raw];
  if (known) return known;

  const lower = raw.toLowerCase();
  const retrying: JobProblem = {
    message: "Pentra hit a temporary problem and is trying again.",
    next: "No action needed.",
  };
  if (/content recovery \d+\/\d+ scheduled|retrying after failure/.test(lower)) {
    return stopped ? STOPPED : retrying;
  }
  if (lower.includes("unauthorized") || lower.includes("bad credentials")) {
    return {
      message: "Pentra could not sign in to your website to publish.",
      next: "Reconnect publishing in Settings.",
      action: SETTINGS,
    };
  }
  if (lower.includes("not found") && lower.includes("branch")) {
    return {
      message: "Pentra could not find the place in your repository it publishes to.",
      next: "Check your publishing settings.",
      action: SETTINGS,
    };
  }
  if (lower.includes("article limit") || lower.includes("articles in your plan this month")) {
    return ALLOWANCE_USED;
  }
  if (lower.includes("remove excess sites")) {
    return {
      message: "Your account has more websites than your plan allows.",
      next: "Remove a website or upgrade your plan.",
      action: PLANS,
    };
  }
  if (lower.includes("site not found")) {
    return { message: "This website was removed, so this run was no longer needed.", next: "No action needed." };
  }
  if (lower.includes("topic not found")) {
    return {
      message: `The topic was removed before the article was written. ${NOT_PUBLISHED}`,
      next: "No action needed.",
    };
  }
  if (lower.includes("permanently killed") || lower.includes("cleaned up")) {
    return { message: `This run was cancelled. ${NOT_PUBLISHED}`, next: "No action needed." };
  }
  if (lower.includes("reset from stuck")) {
    return stopped ? STOPPED : { message: "This run stalled, so Pentra restarted it.", next: "No action needed." };
  }
  if (/rate limit|timeout|timed out|network|fetch failed|econnrefused/.test(lower)) {
    return stopped
      ? {
          message: `A temporary problem interrupted this run. ${NOT_PUBLISHED}`,
          next: "If this keeps happening,",
          action: { ...CONTACT, label: "contact support." },
        }
      : retrying;
  }
  return stopped ? STOPPED : retrying;
}

function jobArticleId(job: Doc<"jobs">): string | undefined {
  if (job.articleId) return job.articleId;
  const fromPayload = (job.payload as { articleId?: unknown } | undefined)?.articleId;
  return typeof fromPayload === "string" && fromPayload ? fromPayload : undefined;
}

function JobIcon({ type, className }: { type: string; className?: string }) {
  const cn = className ?? "h-3.5 w-3.5";
  switch (type) {
    case "onboarding":
      return <Globe className={cn} />;
    case "plan":
      return <Map className={cn} />;
    case "article":
      return <FileText className={cn} />;
    case "links":
      return <Search className={cn} />;
    case "factcheck":
      return <ShieldCheck className={cn} />;
    case "publish":
      return <GitBranch className={cn} />;
    default:
      return <Activity className={cn} />;
  }
}

function jobLabel(job: Doc<"jobs">): string {
  switch (job.type) {
    case "onboarding":
      return "Reading your website";
    case "plan":
      return "Choosing article topics";
    case "article":
      if (job.contentWork?.ownerRequest?.sourceArticleId) return "Reviewing your edits";
      if (job.contentWork?.intent === "improve") return "Improving a page";
      return "Writing an article";
    case "links":
      return "Adding internal links";
    case "scheduler":
      return "Planning the schedule";
    case "publish":
      return "Publishing";
    case "factcheck":
      return "Fact check";
    default:
      return "Background task";
  }
}

function getDuration(start: number, end: number): string {
  const duration = intervalToDuration({ start, end });
  return formatDuration(duration, { format: ["minutes", "seconds"] }) || "< 1s";
}
