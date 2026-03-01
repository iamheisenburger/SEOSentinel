"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Trash2, Bell, CreditCard } from "lucide-react";
import { useState } from "react";

export default function SettingsPage() {
  const sites = useQuery(api.sites.list);
  const resetAll = useMutation(api.sites.resetAll);
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const siteCount = sites?.length ?? 0;

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

      {/* Billing */}
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
              <p className="text-[13px] font-medium text-[#EDEEF1]">
                Free Plan
              </p>
              <p className="mt-0.5 text-[11px] text-[#565A6E]">
                {siteCount} website{siteCount !== 1 ? "s" : ""} configured
              </p>
            </div>
            <span className="inline-flex items-center rounded-full bg-[#0EA5E9]/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#38BDF8]">
              Current Plan
            </span>
          </div>
          <p className="mt-3 text-[11px] text-[#565A6E]">
            Upgrade options coming soon.
          </p>
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
