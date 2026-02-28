"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  User,
  CreditCard,
  Bell,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Mail,
  ExternalLink,
} from "lucide-react";
import { useState } from "react";

export default function SettingsPage() {
  const sites = useQuery(api.sites.list);
  const resetAll = useMutation(api.sites.resetAll);
  const site = sites?.[0];
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      await resetAll();
      setDeleteMessage("All data has been deleted. Redirecting...");
      setTimeout(() => window.location.assign("/dashboard"), 1500);
    } catch {
      setDeleteMessage("Failed to delete data.");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (sites === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
        </div>
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5"
          >
            <div className="h-4 w-32 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-4 h-10 animate-pulse rounded-lg bg-white/[0.03]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Settings"
        subtitle="Manage your account, billing, and preferences"
      />

      {deleteMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-[#22C55E]/[0.06] border border-[#22C55E]/[0.1] px-4 py-2.5 text-[13px] text-[#4ADE80]">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {deleteMessage}
        </div>
      )}

      {/* ── Account ── */}
      <SettingsSection
        icon={<User className="h-3.5 w-3.5 text-[#0EA5E9]" />}
        title="Account"
        description="Your account details and preferences"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-4 py-3 border border-white/[0.04]">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0EA5E9]/[0.1]">
                <User className="h-4 w-4 text-[#0EA5E9]" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-[#EDEEF1]">
                  {site ? site.siteName ?? site.domain : "No site configured"}
                </p>
                <p className="text-[11px] text-[#565A6E]">
                  {site ? `${site.siteType ?? "Website"} · ${site.niche ?? "General"}` : "Set up your site from the dashboard"}
                </p>
              </div>
            </div>
            {site && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22C55E]/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#4ADE80]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                Active
              </span>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* ── Billing ── */}
      <SettingsSection
        icon={<CreditCard className="h-3.5 w-3.5 text-[#F59E0B]" />}
        title="Billing"
        description="Manage your subscription and payment method"
      >
        <div className="rounded-lg bg-white/[0.02] px-4 py-4 border border-white/[0.04]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-[#EDEEF1]">Free Plan</p>
              <p className="text-[11px] text-[#565A6E]">
                You&apos;re currently on the free tier
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled
              icon={<ExternalLink className="h-3 w-3" />}
            >
              Upgrade
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-[#EDEEF1]">
                {site?.cadencePerWeek ?? 4}
              </p>
              <p className="text-[10px] text-[#565A6E]">Articles/week</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-[#EDEEF1]">1</p>
              <p className="text-[10px] text-[#565A6E]">Site</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-[#EDEEF1]">
                {site?.approvalRequired ? "On" : "Off"}
              </p>
              <p className="text-[10px] text-[#565A6E]">Approval</p>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-[#565A6E]">
            Billing and subscriptions coming soon. Upgrade to unlock multiple sites,
            higher article cadence, and priority generation.
          </p>
        </div>
      </SettingsSection>

      {/* ── Notifications ── */}
      <SettingsSection
        icon={<Bell className="h-3.5 w-3.5 text-[#22C55E]" />}
        title="Notifications"
        description="Configure how you get notified about pipeline activity"
      >
        <div className="flex flex-col gap-0">
          <NotifToggle
            label="Article published"
            description="Get notified when an article is published to GitHub"
            enabled={false}
          />
          <NotifToggle
            label="Article pending review"
            description="Get notified when an article needs your approval"
            enabled={false}
          />
          <NotifToggle
            label="Pipeline failures"
            description="Get notified when a pipeline step fails"
            enabled={false}
          />
        </div>
        <p className="text-[11px] text-[#565A6E] px-3">
          Email notifications coming soon.
        </p>
      </SettingsSection>

      {/* ── Danger Zone ── */}
      <SettingsSection
        icon={<AlertTriangle className="h-3.5 w-3.5 text-[#EF4444]" />}
        title="Danger Zone"
        description="Irreversible actions — proceed with caution"
        danger
      >
        <div className="rounded-lg border border-[#EF4444]/[0.15] bg-[#EF4444]/[0.03] px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-[#EDEEF1]">
                Delete all data
              </p>
              <p className="text-[11px] text-[#565A6E]">
                Remove your site, all articles, topics, pages, and jobs. This cannot be undone.
              </p>
            </div>
            {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteAll}
                  loading={deleting}
                  icon={<Trash2 className="h-3 w-3" />}
                >
                  Confirm Delete
                </Button>
              </div>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                icon={<Trash2 className="h-3 w-3" />}
              >
                Delete Everything
              </Button>
            )}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

/* ── Shared components ── */

function SettingsSection({
  icon,
  title,
  description,
  children,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-[#0F1117] ${
        danger ? "border-[#EF4444]/[0.1]" : "border-white/[0.06]"
      }`}
    >
      <div className="flex items-center gap-3 border-b border-white/[0.04] px-5 py-3.5">
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
            danger ? "bg-[#EF4444]/[0.08]" : "bg-white/[0.04]"
          }`}
        >
          {icon}
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[#EDEEF1]">{title}</h3>
          <p className="text-[11px] text-[#565A6E]">{description}</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-5">{children}</div>
    </div>
  );
}

function NotifToggle({
  label,
  description,
  enabled,
}: {
  label: string;
  description: string;
  enabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center gap-3">
        <Mail className="h-3.5 w-3.5 text-[#565A6E]" />
        <div>
          <p className="text-[13px] text-[#EDEEF1]">{label}</p>
          <p className="text-[11px] text-[#565A6E]">{description}</p>
        </div>
      </div>
      <div
        className={`relative h-5 w-9 rounded-full cursor-not-allowed ${
          enabled ? "bg-[#0EA5E9]" : "bg-white/[0.08]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white/60 ${
            enabled ? "left-[18px]" : "left-0.5"
          }`}
        />
      </div>
    </div>
  );
}
