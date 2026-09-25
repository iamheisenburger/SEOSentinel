"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { parseXReplyHandoff, xReplyLinks } from "@/lib/x-reply-handoff";

const BUTTON = "flex w-full items-center justify-center rounded-full px-5 py-3 text-[15px] font-medium transition";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function XReplyHandoffView() {
  // The draft lives in the URL fragment, which only the browser can read.
  const location = useSyncExternalStore(
    subscribe,
    () => `${window.location.hash}\n${window.location.search}`,
    () => null,
  );
  const draft = useMemo(() => {
    if (location === null) return undefined;
    const [hash, search] = location.split("\n");
    return parseXReplyHandoff(hash, search);
  }, [location]);
  const [copied, setCopied] = useState(false);

  if (draft === undefined) return null;
  if (draft === null) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-6">
        <p className="text-[15px] text-[#D0D6E0]">
          This reply link is incomplete. Open the draft again from Telegram.
        </p>
      </div>
    );
  }

  const links = xReplyLinks(draft);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-[#62666D]">Reply on X</p>
        <h1 className="mt-2 text-[20px] font-medium text-[#F7F8F8]">
          {draft.author ? `Reply to @${draft.author}` : "Reply to this post"}
        </h1>
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-5">
        <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-[#F7F8F8]">{draft.text}</p>
        <p className="mt-3 font-mono text-[12px] text-[#62666D]">{draft.text.length} characters</p>
      </div>
      <a href={links.composer} className={`${BUTTON} bg-[#F7F8F8] text-[#08090A] hover:bg-white`}>
        Open reply in X
      </a>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={copy} className={`${BUTTON} border border-white/[0.1] text-[#F7F8F8] hover:bg-white/[0.04]`}>
          {copied ? "Copied" : "Copy reply"}
        </button>
        <a href={links.app} className={`${BUTTON} border border-white/[0.1] text-[#F7F8F8] hover:bg-white/[0.04]`}>
          Open X app
        </a>
      </div>
      <a href={links.source} target="_blank" rel="noopener noreferrer" className="block text-center text-[14px] text-[#8A8F98] underline-offset-4 hover:underline">
        View the original post
      </a>
      <p className="text-center text-[13px] text-[#62666D]">
        Nothing is posted until you press Reply in X. Skip the draft if it doesn&apos;t fit the post.
      </p>
    </div>
  );
}
