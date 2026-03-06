"use client";

import { useAuth } from "@clerk/nextjs";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Trash2, Bell, CreditCard, ArrowUpRight, Zap, User, Mail, Shield, ExternalLink, Upload, GitBranch, Globe, Webhook, Copy, KeyRound, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";
import { Input } from "@/components/ui/input";
import { useUser, useClerk } from "@clerk/nextjs";
import Link from "next/link";

const PLAN_NAMES: Record<string, string> = {
  max_articles_3: "Free",
  max_articles_10: "Starter",
  max_articles_25: "Pro",
  max_articles_60: "Scale",
  max_articles_150: "Enterprise",
};

function getPlanName(features: string[]): string {
  // Pick the highest article tier feature
  const articleFeature = features
    .filter((f) => f.startsWith("max_articles_"))
    .sort((a, b) => {
      const numA = parseInt(a.split("_").pop() || "0");
      const numB = parseInt(b.split("_").pop() || "0");
      return numB - numA;
    })[0];
  return PLAN_NAMES[articleFeature] || "Free";
}

export default function SettingsPage() {
  const { userId: _clerkId } = useAuth();
  const sites = useQuery(api.sites.list, _clerkId ? { clerkUserId: _clerkId } : {});
  const articles = useQuery(
    api.articles.listBySite,
    sites?.[0]?._id ? { siteId: sites[0]._id } : "skip",
  );
  const resetAll = useMutation(api.sites.resetAll);
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { maxSites, maxArticles, features, isFreePlan } = usePlanLimits();
  const { user } = useUser();
  const clerk = useClerk();
  const { activeSite } = useActiveSite();
  const updateSite = useMutation(api.sites.updateSite);
  const [publishSaving, setPublishSaving] = useState(false);
  const [publishSaved, setPublishSaved] = useState(false);
  const [pubMethod, setPubMethod] = useState(activeSite?.publishMethod ?? "github");
  const [pubRepoOwner, setPubRepoOwner] = useState(activeSite?.repoOwner ?? "");
  const [pubRepoName, setPubRepoName] = useState(activeSite?.repoName ?? "");
  const [pubGithubToken, setPubGithubToken] = useState(activeSite?.githubToken ?? "");
  const [pubWpUrl, setPubWpUrl] = useState(activeSite?.wpUrl ?? "");
  const [pubWpUsername, setPubWpUsername] = useState(activeSite?.wpUsername ?? "");
  const [pubWpAppPassword, setPubWpAppPassword] = useState(activeSite?.wpAppPassword ?? "");
  const [pubWebhookUrl, setPubWebhookUrl] = useState(activeSite?.webhookUrl ?? "");
  const [pubWebhookSecret, setPubWebhookSecret] = useState(activeSite?.webhookSecret ?? "");

  useEffect(() => {
    if (activeSite) {
      setPubMethod(activeSite.publishMethod ?? "github");
      setPubRepoOwner(activeSite.repoOwner ?? "");
      setPubRepoName(activeSite.repoName ?? "");
      setPubGithubToken(activeSite.githubToken ?? "");
      setPubWpUrl(activeSite.wpUrl ?? "");
      setPubWpUsername(activeSite.wpUsername ?? "");
      setPubWpAppPassword(activeSite.wpAppPassword ?? "");
      setPubWebhookUrl(activeSite.webhookUrl ?? "");
      setPubWebhookSecret(activeSite.webhookSecret ?? "");
    }
  }, [activeSite]);

  const handleSavePublishing = async () => {
    if (!activeSite?._id) return;
    setPublishSaving(true);
    try {
      await updateSite({
        siteId: activeSite._id,
        publishMethod: pubMethod,
        repoOwner: pubRepoOwner.trim() || undefined,
        repoName: pubRepoName.trim() || undefined,
        githubToken: pubGithubToken.trim() || undefined,
        wpUrl: pubWpUrl.trim() || undefined,
        wpUsername: pubWpUsername.trim() || undefined,
        wpAppPassword: pubWpAppPassword.trim() || undefined,
        webhookUrl: pubWebhookUrl.trim() || undefined,
        webhookSecret: pubWebhookSecret.trim() || undefined,
      });
      setPublishSaved(true);
      setTimeout(() => setPublishSaved(false), 2000);
    } catch {}
    finally { setPublishSaving(false); }
  };

  const siteCount = sites?.length ?? 0;
  const planName = getPlanName(features);

  // Count articles this month
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const articlesThisMonth =
    articles?.filter((a) => a.createdAt >= monthStart.getTime()).length ?? 0;

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetAll();
      window.location.assign("/dashboard");
    } catch {
      setResetting(false);
      setShowReset(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Settings"
        subtitle="Manage your account and preferences"
      />

      {/* Plan & Billing */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <CreditCard className="h-4 w-4 text-[#0EA5E9]" />
          <p className="text-[13px] font-semibold text-[#EDEEF1]">
            Plan & Billing
          </p>
        </div>
        <div className="px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-semibold text-[#EDEEF1]">
                  {planName} Plan
                </p>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    isFreePlan
                      ? "bg-white/[0.06] text-[#8B8FA3]"
                      : "bg-[#0EA5E9]/[0.08] text-[#38BDF8]"
                  }`}
                >
                  {isFreePlan ? "Free" : "Active"}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-[#565A6E]">
                {siteCount} / {maxSites === 9999 ? "∞" : maxSites} site
                {maxSites !== 1 ? "s" : ""} · {articlesThisMonth} /{" "}
                {maxArticles} articles this month
              </p>
            </div>
            {isFreePlan && (
              <Link
                href="/upgrade"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0EA5E9] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#38BDF8]"
              >
                <Zap className="h-3.5 w-3.5" />
                Upgrade
              </Link>
            )}
          </div>

          {/* Usage bars */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-[11px] text-[#565A6E] mb-1.5">
                <span>Sites</span>
                <span>
                  {siteCount} / {maxSites === 9999 ? "∞" : maxSites}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/[0.04]">
                <div
                  className="h-1.5 rounded-full bg-[#0EA5E9] transition-all"
                  style={{
                    width: `${maxSites === 9999 ? 5 : Math.min((siteCount / maxSites) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] text-[#565A6E] mb-1.5">
                <span>Articles this month</span>
                <span>
                  {articlesThisMonth} / {maxArticles}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/[0.04]">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    articlesThisMonth >= maxArticles
                      ? "bg-[#EF4444]"
                      : articlesThisMonth >= maxArticles * 0.8
                        ? "bg-[#F59E0B]"
                        : "bg-[#22C55E]"
                  }`}
                  style={{
                    width: `${Math.min((articlesThisMonth / maxArticles) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Manage subscription / upgrade */}
          <div className="mt-4 flex items-center gap-3">
            {!isFreePlan && (
              <a
                href="/upgrade"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#8B8FA3] hover:text-[#0EA5E9] transition"
              >
                Manage subscription
                <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
            {!isFreePlan && (
              <Link
                href="/upgrade"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#8B8FA3] hover:text-[#0EA5E9] transition"
              >
                Change plan
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Account */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <User className="h-4 w-4 text-[#0EA5E9]" />
          <p className="text-[13px] font-semibold text-[#EDEEF1]">
            Account
          </p>
        </div>
        <div className="px-5 py-5">
          {user && (
            <div className="space-y-4">
              {/* Profile row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {user.imageUrl ? (
                    <img src={user.imageUrl} alt="" className="h-10 w-10 rounded-full border border-white/[0.06]" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0EA5E9]/[0.1]">
                      <User className="h-4 w-4 text-[#0EA5E9]" />
                    </div>
                  )}
                  <div>
                    <p className="text-[14px] font-semibold text-[#EDEEF1]">{user.fullName || "User"}</p>
                    <p className="text-[12px] text-[#565A6E]">{user.primaryEmailAddress?.emailAddress}</p>
                  </div>
                </div>
                <button
                  onClick={() => clerk.openUserProfile()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[12px] font-medium text-[#8B8FA3] transition hover:bg-white/[0.05] hover:text-white"
                >
                  Edit profile
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>

              <div className="h-px bg-white/[0.04]" />

              {/* Info rows */}
              <div className="grid gap-3">
                <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-4 py-3">
                  <Mail className="h-4 w-4 text-[#565A6E]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-[#565A6E]">Email</p>
                    <p className="text-[13px] text-[#EDEEF1] truncate">{user.primaryEmailAddress?.emailAddress}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-4 py-3">
                  <Shield className="h-4 w-4 text-[#565A6E]" />
                  <div className="flex-1">
                    <p className="text-[11px] text-[#565A6E]">Security</p>
                    <p className="text-[13px] text-[#EDEEF1]">
                      {(user as any).twoFactorEnabled ? "2FA enabled" : "Password authentication"}
                    </p>
                  </div>
                  <button
                    onClick={() => clerk.openUserProfile()}
                    className="text-[11px] font-medium text-[#8B8FA3] hover:text-[#0EA5E9] transition"
                  >
                    Manage
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>


      {/* Publishing */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <Upload className="h-4 w-4 text-[#0EA5E9]" />
          <p className="text-[13px] font-semibold text-[#EDEEF1]">Publishing</p>
          {activeSite && (
            <span className="ml-auto text-[11px] text-[#565A6E]">{activeSite.domain}</span>
          )}
        </div>
        <div className="px-5 py-5 flex flex-col gap-4">
          {/* Method selector */}
          <div>
            <p className="text-[11px] text-[#565A6E] mb-2">Publish method</p>
            <div className="grid grid-cols-4 gap-2">
              {([
                { key: "github", label: "GitHub", icon: GitBranch },
                { key: "wordpress", label: "WordPress", icon: Globe },
                { key: "webhook", label: "Webhook", icon: Webhook },
                { key: "manual", label: "Copy & Paste", icon: Copy },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setPubMethod(opt.key)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-center transition ${
                    pubMethod === opt.key
                      ? "border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.06]"
                      : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  <opt.icon className={`h-4 w-4 ${pubMethod === opt.key ? "text-[#0EA5E9]" : "text-[#565A6E]"}`} />
                  <span className={`text-[11px] font-medium ${pubMethod === opt.key ? "text-[#EDEEF1]" : "text-[#8B8FA3]"}`}>
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* GitHub fields */}
          {pubMethod === "github" && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Input label="GitHub Owner" placeholder="acme" value={pubRepoOwner} onChange={(e) => setPubRepoOwner(e.target.value)} />
                <Input label="GitHub Repo" placeholder="my-blog" value={pubRepoName} onChange={(e) => setPubRepoName(e.target.value)} />
              </div>
              <Input label="Personal Access Token" placeholder="ghp_xxxxxxxxxxxx" value={pubGithubToken} onChange={(e) => setPubGithubToken(e.target.value)} type="password" />
              <p className="text-[10px] text-[#565A6E]">
                <KeyRound className="inline h-3 w-3 mr-1" />
                Create at GitHub &rarr; Settings &rarr; Developer settings &rarr; Personal access tokens. Grant Contents: Read and write.
              </p>
            </div>
          )}

          {/* WordPress fields */}
          {pubMethod === "wordpress" && (
            <div className="flex flex-col gap-3">
              <Input label="WordPress URL" placeholder="https://yoursite.com" value={pubWpUrl} onChange={(e) => setPubWpUrl(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Username" placeholder="admin" value={pubWpUsername} onChange={(e) => setPubWpUsername(e.target.value)} />
                <Input label="Application Password" placeholder="xxxx xxxx xxxx xxxx" value={pubWpAppPassword} onChange={(e) => setPubWpAppPassword(e.target.value)} type="password" />
              </div>
            </div>
          )}

          {/* Webhook fields */}
          {pubMethod === "webhook" && (
            <div className="flex flex-col gap-3">
              <Input label="Webhook URL" placeholder="https://api.yoursite.com/articles" value={pubWebhookUrl} onChange={(e) => setPubWebhookUrl(e.target.value)} />
              <Input label="Secret (optional)" placeholder="your-webhook-secret" value={pubWebhookSecret} onChange={(e) => setPubWebhookSecret(e.target.value)} type="password" />
            </div>
          )}

          {/* Manual */}
          {pubMethod === "manual" && (
            <p className="text-[12px] text-[#8B8FA3]">
              <Copy className="inline h-3.5 w-3.5 mr-1 text-[#0EA5E9]" />
              Articles will be ready to copy as Markdown or HTML from the article page.
            </p>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSavePublishing}
              disabled={publishSaving || !activeSite}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0EA5E9] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#38BDF8] disabled:opacity-50"
            >
              {publishSaved ? <><Check className="h-3.5 w-3.5" /> Saved</> : publishSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

            {/* Notifications */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <Bell className="h-4 w-4 text-[#0EA5E9]" />
          <p className="text-[13px] font-semibold text-[#EDEEF1]">
            Notifications
          </p>
        </div>
        <div className="px-5 py-5">
          <p className="text-[12px] text-[#565A6E]">
            Email notification preferences coming soon.
          </p>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-[#EF4444]/20 bg-[#0F1117] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#EF4444]/10">
          <Trash2 className="h-4 w-4 text-[#EF4444]" />
          <p className="text-[13px] font-semibold text-[#EF4444]">
            Danger Zone
          </p>
        </div>
        <div className="px-5 py-5">
          <p className="text-[12px] text-[#8B8FA3]">
            This will permanently delete all your websites, articles, topics,
            and pipeline jobs. This action cannot be undone.
          </p>
          {showReset ? (
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => setShowReset(false)}
                className="text-[12px] text-[#8B8FA3] hover:text-[#EDEEF1] transition"
              >
                Cancel
              </button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleReset}
                loading={resetting}
                icon={<Trash2 className="h-3 w-3" />}
              >
                Yes, Delete Everything
              </Button>
            </div>
          ) : (
            <Button
              variant="danger"
              size="sm"
              className="mt-4"
              onClick={() => setShowReset(true)}
              icon={<Trash2 className="h-3 w-3" />}
            >
              Reset All Data
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
