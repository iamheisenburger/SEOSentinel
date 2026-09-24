"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

const shortDate = (at: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);

/** Other platforms: after pasting, the owner gives the live address and Pentra
 * checks the public page for this article before counting it as live. */
export function PastedLiveCheck({ articleId, domain }: { articleId: Id<"articles">; domain: string }) {
  const state = useQuery(api.pastedPublication.forArticle, { articleId });
  const confirm = useMutation(api.pastedPublication.confirm);
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const latest = state?.latest;
  return <div className="basis-full space-y-2 rounded-lg border border-white/[0.06] bg-[#0E0F11] p-3">
    {state?.liveSince ? <p className="text-sm text-[#22C55E]">Live on your site since {shortDate(state.liveSince)}. Pentra found it at{" "}
      <a className="underline" href={state.liveUrl ?? undefined} target="_blank" rel="noopener noreferrer">{state.liveUrl}</a> and counts it in your results.</p>
      : <p className="text-sm text-[#F7F8F8]">Published it? Paste the article&apos;s address on {domain} and Pentra will check that it&apos;s live.</p>}
    {!state?.liveSince && <form className="flex flex-wrap gap-2" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try { await confirm({ articleId, url }); }
      catch (err) { setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Couldn't start the check. Try again."); }
      finally { setBusy(false); }
    }}>
      <input aria-label="Live article address" type="url" required placeholder={`https://${domain}/blog/…`} value={url} onChange={e => setUrl(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-white/[0.1] bg-[#08090A] px-3 py-1.5 text-sm text-[#F7F8F8]" />
      <Button size="sm" type="submit" loading={busy || latest?.status === "checking"}>Check it&apos;s live</Button>
    </form>}
    {latest?.status === "checking" && <p className="text-xs text-[#8A8F98]">Checking {latest.url}…</p>}
    {!state?.liveSince && latest?.status === "not_found" && <p role="alert" className="text-xs text-[#F59E0B]">
      {latest.titleFound === false ? "Pentra couldn't find this article's title on that page." : `Only ${latest.matched ?? 0} of ${latest.total ?? 0} paragraphs were found on that page.`}
      {" "}Check the address (and that the post is published, not a draft), then try again.</p>}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </div>;
}
