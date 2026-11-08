"use client";

import type { ReactNode } from "react";
import { Notice, Panel, PanelSkeleton, ScreenHeader } from "@/components/answers/ui";
import { useAnswersQuery } from "@/lib/answers/backend";
import { plural } from "@/lib/answers/format";

/**
 * Billing for an Answers site: Pentra's own sites are never billed; everyone else sees the one plan and its checkout
 * (the same flow as /upgrade), with what upgrading does to the drafts already written.
 */
export function AnswersBilling({ siteId, checkout }: { siteId: string; checkout: ReactNode }) {
  const overview = useAnswersQuery("overview", { siteId });
  if (overview === undefined) return <><ScreenHeader title="Billing" /><PanelSkeleton lines={6} /></>;
  if (overview === null) return <Notice>Billing for this site isn&apos;t available.</Notice>;
  if (overview.access === "owner") {
    return (
      <>
        <ScreenHeader title="Billing" meta={overview.site.domain} />
        <Panel title="Pentra's own site">
          <p className="text-[14px] leading-[22px] text-text-2">
            {overview.site.domain} runs on Pentra by code and is never billed. Everything on the plan is on: publishing, weekly runs, new questions and the weekly email.
          </p>
        </Panel>
      </>
    );
  }
  const drafts = overview.pages.filter((p) => p.status === "draft" || p.status === "publish_failed").length;
  return (
    <>
      {overview.access === "free" && drafts > 0 && (
        <Notice tone="you">
          {plural(drafts, "draft page")} from your free hour {drafts === 1 ? "is" : "are"} ready. After you upgrade, {drafts === 1 ? "it publishes" : "they publish"} automatically within the hour,
          once you&apos;ve chosen where pages publish.
        </Notice>
      )}
      {checkout}
    </>
  );
}
