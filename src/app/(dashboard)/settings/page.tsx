"use client";

import { useAuth } from "@clerk/nextjs";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, Bell, CreditCard, ArrowUpRight, Zap, User, Mail, Shield, ExternalLink, Upload, GitBranch, Globe, Webhook, Copy, KeyRound, Check } from "lucide-react";
import { useState } from "react";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";
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

function PublishingSection({ pubSite }: { pubSite: any }) {
  const updateSite = useMutation(api.sites.upsert);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [wpUrl, setWpUrl] = useState(pubSite.wpUrl || "");
  const [wpUsername, setWpUsername] = useState(pubSite.wpUsername || "");
  const [wpAppPassword, setWpAppPassword] = useState(pubSite.wpAppPassword || "");
  const [webhookUrl, setWebhookUrl] = useState(pubSite.webhookUrl || "");
  const [webhookSecret, setWebhookSecret] = useState(pubSite.webhookSecret || "");
  const [repoOwner, setRepoOwner] = useState(pubSite.repoOwner || "");
  const [repoName, setRepoName] = useState(pubSite.repoName || "");

  const method = pubSite.publishMethod || "github";
  const labels: Record<string, string> = { github: "GitHub", wordpress: "WordPress", webhook: "Webhook", manual: "Copy & Paste" };
  const iconMap: Record<string, typeof GitBranch> = { github: GitBranch, wordpress: Globe, webhook: Webhook, manual: Copy };
  const MethodIcon = iconMap[method] || GitBranch;
  const isGithub = method === "github";
  const isWp = method === "wordpress";
  const isWebhook = method === "webhook";
  const isManual = method === "manual";
  const hasGithubToken = !!pubSite.githubToken;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: any = { id: pubSite._id, domain: pubSite.domain };
      if (isGithub) {
        updates.repoOwner = repoOwner.trim() || undefined;
        updates.repoName = repoName.trim() || undefined;
      }
      if (isWp) {
        updates.wpUrl = wpUrl.trim() || undefined;
        updates.wpUsername = wpUsername.trim() || undefined;
        updates.wpAppPassword = wpAppPassword.trim() || undefined;
      }
      if (isWebhook) {
        updates.webhookUrl = webhookUrl.trim() || undefined;
        updates.webhookSecret = webhookSecret.trim() || undefined;
      }
      await updateSite(updates);
      setEditing(false);
    } catch (e) {
      console.error("Failed to save publishing config:", e);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-white/[0.06] bg-[#0F1117] px-3 py-2 text-[13px] text-[#EDEEF1] placeholder-[#565A6E] outline-none focus:border-[#0EA5E9]/50";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
        <Upload className="h-4 w-4 text-[#0EA5E9]" />
        <p className="text-[13px] font-semibold text-[#EDEEF1]">Publishing</p>
        <span className="ml-auto text-[11px] text-[#565A6E]">{pubSite.domain}</span>
      </div>
      <div className="px-5 py-5">
        <div className="flex flex-col gap-4">
          {/* Current method badge */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.08]">
              <MethodIcon className="h-5 w-5 text-[#0EA5E9]" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-medium text-[#EDEEF1]">{labels[method] || method}</p>
              {isGithub && pubSite.repoOwner && !editing && (
                <p className="text-[12px] text-[#565A6E] font-mono">{pubSite.repoOwner}/{pubSite.repoName}</p>
              )}
              {isWp && pubSite.wpUrl && !editing && (
                <p className="text-[12px] text-[#565A6E]">{pubSite.wpUrl}</p>
              )}
              {isWebhook && pubSite.webhookUrl && !editing && (
                <p className="text-[12px] text-[#565A6E] truncate max-w-[300px]">{pubSite.webhookUrl}</p>
              )}
              {isManual && (
                <p className="text-[12px] text-[#565A6E]">Copy markdown or HTML from article pages</p>
              )}
            </div>
            {!isManual && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] font-medium text-[#8B8FA3] hover:text-[#0EA5E9] transition"
              >
                Edit
              </button>
            )}
          </div>

          {/* Inline editing form */}
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
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  {saving ? "Saving..." : "Save"}
                </button>
                <button onClick={() => setEditing(false)} className="text-[12px] text-[#8B8FA3] hover:text-[#EDEEF1] transition px-3 py-2">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Connection status */}
          {isGithub && (
            <div className={`flex items-center gap-3 rounded-lg px-4 py-3 ${hasGithubToken ? "bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.12]" : "bg-[#F59E0B]/[0.04] border border-[#F59E0B]/[0.12]"}`}>
              {hasGithubToken ? (
                <>
                  <Check className="h-4 w-4 text-[#22C55E]" />
                  <span className="flex-1 text-[12px] text-[#4ADE80]">GitHub connected</span>
                  <button
                    onClick={() => window.open("/api/github/auth?siteId=" + pubSite._id, "github-oauth", "width=600,height=700,popup=yes")}
                    className="text-[11px] text-[#565A6E] hover:text-[#0EA5E9] transition"
                  >
                    Reconnect
                  </button>
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 text-[#F59E0B]" />
                  <span className="flex-1 text-[12px] text-[#FBBF24]">GitHub not connected</span>
                  <button
                    onClick={() => window.open("/api/github/auth?siteId=" + pubSite._id, "github-oauth", "width=600,height=700,popup=yes")}
                    className="text-[11px] font-medium text-[#0EA5E9] hover:text-[#38BDF8] transition"
                  >
                    Connect
                  </button>
                </>
              )}
            </div>
          )}

          {isWp && (() => {
            const wpConfigured = !!(pubSite.wpUrl && pubSite.wpUsername && pubSite.wpAppPassword);
            return (
              <div className={`flex items-center gap-3 rounded-lg px-4 py-3 ${wpConfigured ? "bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.12]" : "bg-[#F59E0B]/[0.04] border border-[#F59E0B]/[0.12]"}`}>
                {wpConfigured ? (
                  <>
                    <Check className="h-4 w-4 text-[#22C55E]" />
                    <span className="flex-1 text-[12px] text-[#4ADE80]">WordPress configured</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4 text-[#F59E0B]" />
                    <span className="flex-1 text-[12px] text-[#FBBF24]">WordPress credentials missing</span>
                  </>
                )}
              </div>
            );
          })()}

          {isWebhook && (() => {
            const webhookConfigured = !!pubSite.webhookUrl;
            return (
              <div className={`flex items-center gap-3 rounded-lg px-4 py-3 ${webhookConfigured ? "bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.12]" : "bg-[#F59E0B]/[0.04] border border-[#F59E0B]/[0.12]"}`}>
                {webhookConfigured ? (
                  <>
                    <Check className="h-4 w-4 text-[#22C55E]" />
                    <span className="flex-1 text-[12px] text-[#4ADE80]">Webhook configured</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4 text-[#F59E0B]" />
                    <span className="flex-1 text-[12px] text-[#FBBF24]">Webhook URL not set</span>
                  </>
                )}
              </div>
            );
          })()}

          {isManual && (
            <div className="flex items-center gap-3 rounded-lg px-4 py-3 bg-[#22C55E]/[0.04] border border-[#22C55E]/[0.12]">
              <Check className="h-4 w-4 text-[#22C55E]" />
              <span className="flex-1 text-[12px] text-[#4ADE80]">Ready — copy articles from the Articles page</span>
            </div>
          )}

          <p className="text-[11px] text-[#565A6E] text-left">
            To change your publishing method, re-run onboarding from the Websites page.
          </p>
        </div>
      </div>
    </div>
  );
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
  const pubSite = activeSite ?? sites?.[0];

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
      {pubSite && (
        <PublishingSection pubSite={pubSite} />
      )}

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
