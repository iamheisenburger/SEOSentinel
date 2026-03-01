"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Globe,
  Trash2,
  Clock,
  ArrowRight,
  Plus,
  Settings,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import type { Id } from "../../../../convex/_generated/dataModel";

export default function WebsitesPage() {
  const sites = useQuery(api.sites.list);
  const loading = sites === undefined;

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5"
            >
              <div className="h-5 w-40 animate-pulse rounded bg-white/[0.04]" />
              <div className="mt-3 h-10 animate-pulse rounded-lg bg-white/[0.03]" />
              <div className="mt-3 h-4 w-32 animate-pulse rounded bg-white/[0.03]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Websites"
        subtitle={`${sites.length} website${sites.length !== 1 ? "s" : ""} configured`}
        actions={
          <Button
            size="sm"
            onClick={() => window.location.assign("/dashboard?setup=new")}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add Website
          </Button>
        }
      />

      {sites.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
          <Globe className="mx-auto h-10 w-10 text-[#565A6E]/30" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            No websites configured yet. Add one to get started.
          </p>
          <Button
            className="mt-4"
            onClick={() => window.location.assign("/dashboard?setup=new")}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add Your First Website
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sites.map((site) => (
            <SiteCard key={site._id} site={site} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Site Card ── */

function SiteCard({
  site,
}: {
  site: {
    _id: Id<"sites">;
    domain: string;
    siteName?: string;
    siteType?: string;
    niche?: string;
    cadencePerWeek?: number;
    autopilotEnabled?: boolean;
    brandPrimaryColor?: string;
    createdAt: number;
    updatedAt: number;
  };
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteSite = useMutation(api.sites.deleteSite);

  const articles = useQuery(api.articles.listBySite, { siteId: site._id });
  const topics = useQuery(api.topics.listBySite, { siteId: site._id });

  const articleCount = articles?.length ?? 0;
  const topicCount = topics?.length ?? 0;
  const publishedCount =
    articles?.filter((a) => a.status === "published").length ?? 0;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSite({ siteId: site._id });
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const brandColor = site.brandPrimaryColor || "#0EA5E9";

  return (
    <div className="group relative rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden transition-all hover:-translate-y-0.5 hover:border-white/[0.1] hover:shadow-lg hover:shadow-black/20">
      {/* Color accent bar */}
      <div className="h-1" style={{ backgroundColor: brandColor }} />

      {/* Card body */}
      <Link href={`/sites/${site._id}`} className="block px-5 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
            style={{ backgroundColor: `${brandColor}15` }}
          >
            <Globe className="h-4.5 w-4.5" style={{ color: brandColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold text-[#EDEEF1] truncate">
                {site.siteName || site.domain}
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#22C55E]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#4ADE80] shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                Active
              </span>
            </div>
            <p className="text-[11px] text-[#565A6E] mt-0.5 truncate">
              {site.domain}
              {site.siteType ? ` · ${site.siteType}` : ""}
              {site.niche ? ` · ${site.niche}` : ""}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-[#565A6E] opacity-0 group-hover:opacity-100 transition shrink-0 mt-1" />
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2 text-center">
            <p className="text-[15px] font-bold text-[#EDEEF1]">
              {publishedCount}
            </p>
            <p className="text-[10px] text-[#565A6E]">Published</p>
          </div>
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2 text-center">
            <p className="text-[15px] font-bold text-[#EDEEF1]">
              {articleCount - publishedCount}
            </p>
            <p className="text-[10px] text-[#565A6E]">Drafts</p>
          </div>
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2 text-center">
            <p className="text-[15px] font-bold text-[#EDEEF1]">
              {topicCount}
            </p>
            <p className="text-[10px] text-[#565A6E]">Topics</p>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-3 flex items-center gap-3 text-[10px] text-[#565A6E]">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {site.cadencePerWeek ?? 4} articles/week
          </span>
          <span>·</span>
          <span>
            {site.autopilotEnabled !== false ? "Autopilot" : "Manual"}
          </span>
          <span>·</span>
          <span>
            Added {formatDistanceToNow(site.createdAt, { addSuffix: true })}
          </span>
        </div>
      </Link>

      {/* Action bar */}
      <div className="flex items-center justify-between border-t border-white/[0.04] px-5 py-2.5">
        <Link
          href={`/sites/${site._id}`}
          className="inline-flex items-center gap-1.5 text-[11px] text-[#8B8FA3] hover:text-[#0EA5E9] transition"
        >
          <Settings className="h-3 w-3" />
          Manage
        </Link>

        {showDeleteConfirm ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="text-[11px] text-[#8B8FA3] hover:text-[#EDEEF1] transition"
            >
              Cancel
            </button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              loading={deleting}
              icon={<Trash2 className="h-3 w-3" />}
            >
              Delete
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1 text-[11px] text-[#565A6E] hover:text-[#EF4444] transition"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
