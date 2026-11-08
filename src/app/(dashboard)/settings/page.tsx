"use client";

import { useAuth } from "@clerk/nextjs";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, CreditCard, ArrowUpRight, Zap, User, Mail, Shield, ExternalLink, Upload, GitBranch, Globe, Webhook, Copy, KeyRound, Check } from "lucide-react";
import { useState } from "react";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { planDisplayName } from "@/lib/pricing";
import { useActiveSite } from "@/contexts/site-context";
import { useUser, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { ContentWorkService } from "@/components/content-work-service";
import { useVisibleQuery } from "@/hooks/useVisibleQuery";


type PublishingSettingsSite = {
  _id: Id<"sites">;
  domain: string;
  publishMethod?: string;
  wpUrl?: string;
  wpUsername?: string;
  webhookUrl?: string;
  repoOwner?: string;
  repoName?: string;
  githubConnected?: boolean;
  wordpressConfigured?: boolean;
  webhookSecretConfigured?: boolean;
};

type PublishingSiteUpdate = {
  id: Id<"sites">;
  domain: string;
  repoOwner?: string;
  repoName?: string;
  wpUrl?: string;
  wpUsername?: string;
  wpAppPassword?: string;
  webhookUrl?: string;
  webhookSecret?: string;
};

function PublishingSection({ pubSite }: { pubSite: PublishingSettingsSite }) {
  const updateSite = useMutation(api.sites.upsert);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [wpUrl, setWpUrl] = useState(pubSite.wpUrl || "");
  const [wpUsername, setWpUsername] = useState(pubSite.wpUsername || "");
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [webhookUrl, setWebhookUrl] = useState(pubSite.webhookUrl || "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [repoOwner, setRepoOwner] = useState(pubSite.repoOwner || "");
  const [repoName, setRepoName] = useState(pubSite.repoName || "");

  const method = pubSite.publishMethod || "github";
  const labels: Record<string, string> = { github: "GitHub", wordpress: "WordPress · Beta", webhook: "Webhook · Beta", manual: "Copy & Paste" };
  const iconMap: Record<string, typeof GitBranch> = { github: GitBranch, wordpress: Globe, webhook: Webhook, manual: Copy };
  const MethodIcon = iconMap[method] || GitBranch;
  const isGithub = method === "github";
  const isWp = method === "wordpress";
  const isWebhook = method === "webhook";
  const isManual = method === "manual";
  const hasGithubToken = !!pubSite.githubConnected;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: PublishingSiteUpdate = {
        id: pubSite._id,
        domain: pubSite.domain,
      };
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

  const inputCls = "w-full rounded-lg border border-white/[0.06] bg-surface-1 px-3 py-2 text-[13px] text-text placeholder-text-4 outline-none focus:border-[var(--border-focus)]";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface-1 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
        <Upload className="h-4 w-4 text-text-2" />
        <p className="text-[13px] font-semibold text-text">Publishing</p>
        <span className="ml-auto text-[11px] text-text-3">{pubSite.domain}</span>
      </div>
      <div className="px-5 py-5">
        <div className="flex flex-col gap-4">
          {/* Current method badge */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2/50">
              <MethodIcon className="h-5 w-5 text-text-2" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-medium text-text">{labels[method] || method}</p>
              {isGithub && pubSite.repoOwner && !editing && (
                <p className="text-[12px] text-text-3 font-mono">{pubSite.repoOwner}/{pubSite.repoName}</p>
              )}
              {isWp && pubSite.wpUrl && !editing && (
                <p className="text-[12px] text-text-3">{pubSite.wpUrl}</p>
              )}
              {isWebhook && pubSite.webhookUrl && !editing && (
                <p className="text-[12px] text-text-3 truncate max-w-[300px]">{pubSite.webhookUrl}</p>
              )}
              {isManual && (
                <p className="text-[12px] text-text-3">Copy markdown or HTML from article pages</p>
              )}
            </div>
            {!isManual && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] font-medium text-text-2 hover:text-text transition"
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
                    <label className="text-[12px] font-medium text-text-2">Owner</label>
                    <input value={repoOwner} onChange={(e) => setRepoOwner(e.target.value)} placeholder="acme" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-text-2">Repository</label>
                    <input value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="my-blog" className={inputCls} />
                  </div>
                </div>
              )}
              {isWp && (
                <>
                  <p className="text-[12px] text-text-2">WordPress publishing needs the Pentra plugin on your site. <a className="underline" href="/pentra-wordpress-plugin.zip" download>Download the plugin (ZIP)</a>, install it in WordPress (Plugins → Add New → Upload Plugin → Activate), then enter your site details below and save.</p>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-text-2">WordPress URL</label>
                    <input value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} placeholder="https://yoursite.com" className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[12px] font-medium text-text-2">Username</label>
                      <input value={wpUsername} onChange={(e) => setWpUsername(e.target.value)} placeholder="admin" className={inputCls} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[12px] font-medium text-text-2">App Password</label>
                      <input type="password" value={wpAppPassword} onChange={(e) => setWpAppPassword(e.target.value)} placeholder={pubSite.wordpressConfigured ? "Leave blank to keep current password" : "xxxx xxxx xxxx"} className={inputCls} />
                    </div>
                  </div>
                </>
              )}
              {isWebhook && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-text-2">Webhook URL</label>
                    <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://api.yoursite.com/articles" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-text-2">Secret (optional)</label>
                    <input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={pubSite.webhookSecretConfigured ? "Leave blank to keep current secret" : "your-webhook-secret"} className={inputCls} />
                  </div>
                </>
              )}
              <div className="flex items-center gap-2 mt-1">
                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-action px-4 py-2 text-[12px] font-medium text-on-action transition hover:bg-white disabled:opacity-50">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  {saving ? "Saving..." : "Save"}
                </button>
                <button onClick={() => setEditing(false)} className="text-[12px] text-text-2 hover:text-text transition px-3 py-2">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Connection status */}
          {isGithub && (
            <div className={`flex items-center gap-3 rounded-lg px-4 py-3 ${hasGithubToken ? "bg-named/[0.04] border border-named/[0.12]" : "bg-rival/[0.04] border border-rival/[0.12]"}`}>
              {hasGithubToken ? (
                <>
                  <Check className="h-4 w-4 text-named" />
                  <span className="flex-1 text-[12px] text-named">GitHub connected</span>
                  <button
                    onClick={() => window.open("/api/github/auth?siteId=" + pubSite._id, "github-oauth", "width=600,height=700,popup=yes")}
                    className="text-[11px] text-text-3 hover:text-text transition"
                  >
                    Reconnect
                  </button>
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 text-rival" />
                  <span className="flex-1 text-[12px] text-rival">GitHub not connected</span>
                  <button
                    onClick={() => window.open("/api/github/auth?siteId=" + pubSite._id, "github-oauth", "width=600,height=700,popup=yes")}
                    className="text-[11px] font-medium text-text-2 hover:text-text transition"
                  >
                    Connect
                  </button>
                </>
              )}
            </div>
          )}

          {isWp && (() => {
            const wpConfigured = !!pubSite.wordpressConfigured;
            return (
              <div className={`flex items-center gap-3 rounded-lg px-4 py-3 ${wpConfigured ? "bg-named/[0.04] border border-named/[0.12]" : "bg-rival/[0.04] border border-rival/[0.12]"}`}>
                {wpConfigured ? (
                  <>
                    <Check className="h-4 w-4 text-named" />
                    <span className="flex-1 text-[12px] text-named">WordPress configured</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4 text-rival" />
                    <span className="flex-1 text-[12px] text-rival">WordPress credentials missing</span>
                  </>
                )}
              </div>
            );
          })()}

          {isWebhook && (() => {
            const webhookConfigured = !!pubSite.webhookUrl;
            return (
              <div className={`flex items-center gap-3 rounded-lg px-4 py-3 ${webhookConfigured ? "bg-named/[0.04] border border-named/[0.12]" : "bg-rival/[0.04] border border-rival/[0.12]"}`}>
                {webhookConfigured ? (
                  <>
                    <Check className="h-4 w-4 text-named" />
                    <span className="flex-1 text-[12px] text-named">Webhook configured</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4 text-rival" />
                    <span className="flex-1 text-[12px] text-rival">Webhook URL not set</span>
                  </>
                )}
              </div>
            );
          })()}

          {isManual && (
            <div className="flex items-center gap-3 rounded-lg px-4 py-3 bg-named/[0.04] border border-named/[0.12]">
              <Check className="h-4 w-4 text-named" />
              <span className="flex-1 text-[12px] text-named">Ready — copy articles from the Articles page</span>
            </div>
          )}

          <p className="text-[11px] text-text-3 text-left">
            To change your publishing method, re-run onboarding from the Websites page.
          </p>

          {!isManual && (
            <div className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
              <Shield className="h-3 w-3 shrink-0 text-text-2" />
              <p className="text-[10px] text-text-3">
                Credentials are <span className="text-text-2">encrypted at rest</span> and transmitted over <span className="text-text-2">HTTPS</span>.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** D4: Pentra's emails about the owner's own sites, and the switch to stop them. */
function EmailUpdatesSection() {
  const contact = useQuery(api.customerEmails.mine);
  const setEmailUpdates = useMutation(api.customerEmails.setEmailUpdates);
  const [saving, setSaving] = useState(false);
  if (contact === undefined) return null;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface-1 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
        <Mail className="h-4 w-4 text-text-2" />
        <p className="text-[13px] font-semibold text-text">Email updates</p>
      </div>
      <div className="space-y-3 px-5 py-5">
        <p className="text-[13px] leading-relaxed text-text-2">
          Pentra emails you about your own sites: when your first article is live, when a scheduled article is late (with the reason), and once a month with what Pentra did and what Google showed.
          {contact ? <> They go to <span className="text-text">{contact.email}</span>, your account&apos;s email.</> : " They go to your account's verified email."}
        </p>
        <label className="flex items-center gap-3 text-[13px] text-text">
          <input type="checkbox" className="h-4 w-4 accent-text" checked={contact?.emailUpdates ?? true} disabled={!contact || saving}
            onChange={async (event) => {
              setSaving(true);
              try { await setEmailUpdates({ enabled: event.target.checked }); } finally { setSaving(false); }
            }} />
          Send me these emails
        </label>
        {!contact && <p className="text-[12px] text-text-3">This switch appears once your account&apos;s email is verified.</p>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { userId: _clerkId } = useAuth();
  const sites = useQuery(api.sites.list, _clerkId ? { clerkUserId: _clerkId } : {});
  const usageCount = useQuery(
    api.articles.countThisMonth,
    _clerkId ? { userId: _clerkId } : "skip",
  );
  const resetAll = useMutation(api.sites.resetAll);
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const { maxSites, maxArticles: legacyMaxArticles, tier, isFreePlan } = usePlanLimits();
  const { user } = useUser();
  const clerk = useClerk();
  const { activeSite } = useActiveSite();
  const pubSite = activeSite ?? sites?.[0];
  // Same subscription ContentWorkService already holds for this site.
  const contentState = useVisibleQuery(
    api.contentWork.readiness,
    pubSite ? { siteId: pubSite._id } : "skip",
  );

  const siteCount = sites?.length ?? 0;
  // Display name for the plan tier resolved by usePlanLimits (the one plan lives in src/lib/pricing.ts).
  const planName = planDisplayName(tier);

  // Growth-first sites are held to the published plan allowance of new
  // articles; older sites keep the account-wide immutable usage ledger.
  const growthFirst = contentState?.serviceMode === "growth_first";
  const allowance = growthFirst ? contentState?.ownerDraft.allowance ?? null : null;
  const maxArticles = allowance?.limit
    ?? (growthFirst ? contentState?.plan.articlesPerMonth : undefined)
    ?? legacyMaxArticles;
  const articlesThisMonth = allowance?.used ?? usageCount ?? 0;

  const handleReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      const result = await resetAll();
      if (result && "deferred" in result && result.deferred) {
        setResetError(
          "Nothing was deleted. Some outreach emails still need to be checked before your data can be removed. Email pentrahelp@gmail.com and we'll sort it out.",
        );
        setResetting(false);
        setShowReset(false);
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setResetError(
        "Nothing was deleted. Pentra may be publishing an article right now. Please try again in a few minutes.",
      );
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
      <div className="rounded-xl border border-white/[0.06] bg-surface-1 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <CreditCard className="h-4 w-4 text-text-2" />
          <p className="text-[13px] font-semibold text-text">
            Plan & billing
          </p>
          <Link
            href="/upgrade"
            className="text-text ml-auto inline-flex items-center gap-1 text-[12px] font-medium underline decoration-you-line underline-offset-[3px] hover:decoration-you"
          >
            Plans & billing
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-semibold text-text">
                  {planName} Plan
                </p>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    isFreePlan
                      ? "bg-white/[0.06] text-text-2"
                      : "bg-surface-2/50 text-text-2"
                  }`}
                >
                  {isFreePlan ? "Free" : "Active"}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-text-3">
                {siteCount} / {maxSites === 9999 ? "∞" : maxSites} site
                {maxSites !== 1 ? "s" : ""} · {articlesThisMonth} /{" "}
                {maxArticles} article{maxArticles !== 1 ? "s" : ""} this month
              </p>
            </div>
            {isFreePlan && (
              <Link
                href="/upgrade"
                className="inline-flex items-center gap-1.5 rounded-lg bg-action px-4 py-2 text-[13px] font-medium text-on-action transition hover:bg-white"
              >
                <Zap className="h-3.5 w-3.5" />
                Upgrade
              </Link>
            )}
          </div>

          {/* Usage bars */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-[11px] text-text-3 mb-1.5">
                <span>Sites</span>
                <span>
                  {siteCount} / {maxSites === 9999 ? "∞" : maxSites}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/[0.04]">
                <div
                  className="h-1.5 rounded-full bg-text-2 transition-all"
                  style={{
                    width: `${maxSites === 9999 ? 5 : Math.min((siteCount / maxSites) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] text-text-3 mb-1.5">
                <span>Articles this month</span>
                <span>
                  {articlesThisMonth} / {maxArticles}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/[0.04]">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    articlesThisMonth >= maxArticles
                      ? "bg-wrong"
                      : articlesThisMonth >= maxArticles * 0.8
                        ? "bg-rival"
                        : "bg-text-2"
                  }`}
                  style={{
                    width: `${Math.min((articlesThisMonth / maxArticles) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Change plan, billing period, payment method or cancel */}
          <p className="mt-4 text-[12px] text-text-2">
            To change or cancel your plan, or update your card, go to{" "}
            <Link
              href="/upgrade"
              className="text-text font-medium underline decoration-you-line underline-offset-[3px] hover:decoration-you"
            >
              Plans & billing
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Account */}
      <div className="rounded-xl border border-white/[0.06] bg-surface-1 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <User className="h-4 w-4 text-text-2" />
          <p className="text-[13px] font-semibold text-text">
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
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">
                      <User className="h-4 w-4 text-text-2" />
                    </div>
                  )}
                  <div>
                    <p className="text-[14px] font-semibold text-text">{user.fullName || "User"}</p>
                    <p className="text-[12px] text-text-3">{user.primaryEmailAddress?.emailAddress}</p>
                  </div>
                </div>
                <button
                  onClick={() => clerk.openUserProfile()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[12px] font-medium text-text-2 transition hover:bg-white/[0.05] hover:text-text"
                >
                  Edit profile
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>

              <div className="h-px bg-white/[0.04]" />

              {/* Info rows */}
              <div className="grid gap-3">
                <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-4 py-3">
                  <Mail className="h-4 w-4 text-text-3" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-text-3">Email</p>
                    <p className="text-[13px] text-text truncate">{user.primaryEmailAddress?.emailAddress}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-4 py-3">
                  <Shield className="h-4 w-4 text-text-3" />
                  <div className="flex-1">
                    <p className="text-[11px] text-text-3">Security</p>
                    <p className="text-[13px] text-text">
                      {user.twoFactorEnabled ? "2FA enabled" : "Password authentication"}
                    </p>
                  </div>
                  <button
                    onClick={() => clerk.openUserProfile()}
                    className="text-[11px] font-medium text-text-2 hover:text-text transition"
                  >
                    Manage
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <EmailUpdatesSection />

      {/* Publishing */}
      {pubSite && <ContentWorkService key={pubSite._id} siteId={pubSite._id} />}
      {pubSite && (
        <PublishingSection pubSite={pubSite} />
      )}

      {/* Danger Zone */}
      <div className="rounded-xl border border-wrong/20 bg-surface-1 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-wrong/10">
          <Trash2 className="h-4 w-4 text-wrong" />
          <p className="text-[13px] font-semibold text-wrong">
            Danger Zone
          </p>
        </div>
        <div className="px-5 py-5">
          <p className="text-[12px] text-text-2">
            Delete all your websites from Pentra, along with their topics,
            articles and saved publishing connections. Pentra stops all work
            for them right away. Pages already published on your website are
            not removed. Your subscription is not canceled; do that in Plans
            &amp; billing. This can&apos;t be undone.
          </p>
          {resetError && (
            <p role="alert" className="mt-3 text-[12px] text-wrong">
              {resetError}
            </p>
          )}
          {showReset ? (
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => setShowReset(false)}
                className="text-[12px] text-text-2 hover:text-text transition"
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
                Yes, delete everything
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
              Delete all Pentra data
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
