"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

export type BlogKitView = { state: "installing" | "deploying" | "live" | "not_live" | "failed"; segment: string | null; commit: string | null; detail: string | null };

/** P377 (Nov 6 2026): a Next.js site with no blog gets one from Pentra (convex/githubBlogKit.ts). This card offers it,
 * then shows it being added, deployed and live. */
export function BlogKitCard({ siteId, domain, repository, offer, kit }: {
  siteId: Id<"sites">; domain: string; repository: string | null;
  /** Detection's "Your site doesn't have a blog yet…" note, when Pentra can add one. */
  offer: string | null;
  kit: BlogKitView | null;
}) {
  const request = useMutation(api.githubBlogKit.requestInstall);
  const recheck = useMutation(api.githubBlogKit.recheckLive);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const host = domain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const address = kit?.segment ? `${host}/${kit.segment}` : null;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch (err) { setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Pentra couldn't do that. Try again in a minute."); }
    finally { setBusy(false); }
  };

  if (kit?.state === "installing") {
    return <p role="status" className="text-sm text-text">Adding a blog to your site… This takes under a minute.</p>;
  }
  if (kit?.state === "deploying") {
    return <p role="status" className="text-sm text-text">
      Pentra added your blog{kit.commit ? <> (commit <span className="font-mono">{kit.commit}</span>)</> : null}. Waiting for your site to
      deploy it{address ? <> at <span className="font-mono">{address}</span></> : null}. This usually takes a few minutes.
    </p>;
  }
  if (kit?.state === "live" && address) {
    return <p role="status" className="text-sm text-text">
      Your blog is live at <a className="underline" href={`https://${address}`} target="_blank" rel="noreferrer">{address}</a>. Pentra publishes
      your articles there. Add a link to it in your site&apos;s menu or footer so visitors find it too.
    </p>;
  }
  if (kit?.state === "not_live") {
    return <div className="space-y-2 text-sm text-text">
      <p role="status">{kit.detail}</p>
      <Button size="sm" disabled={busy} loading={busy} onClick={() => run(() => recheck({ siteId }))}>Check again</Button>
      {error && <p role="alert" className="text-red-400">{error}</p>}
    </div>;
  }
  if (!offer) return null;
  return <div className="space-y-2 text-sm text-text">
    <p>{offer}</p>
    <p className="text-text-2">
      It&apos;s one commit of new files to {repository ? <span className="font-mono">{repository}</span> : "your repository"}, shown in your
      site&apos;s own layout. Nothing else in your site changes and no packages are added. Pentra then publishes your articles there.
    </p>
    {kit?.state === "failed" && kit.detail && <p role="alert" className="text-rival">{kit.detail}</p>}
    <Button size="sm" disabled={busy} loading={busy} onClick={() => run(() => request({ siteId }))}>Add a blog to my site</Button>
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </div>;
}
