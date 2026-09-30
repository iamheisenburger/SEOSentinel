"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  const opened = useRef(false);
  const links = draft ? xReplyLinks(draft) : null;
  const isPost = draft?.kind === "post";

  // Telegram opens links in its own browser, which is not signed in to X, so
  // the reply goes straight to the installed X app's composer, once.
  useEffect(() => {
    if (!links || opened.current) return;
    opened.current = true;
    window.location.href = links.app;
  }, [links]);

  if (draft === undefined) return null;
  if (draft === null || !links) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-6">
        <p className="text-[15px] text-[#D0D6E0]">
          This link is incomplete. Open the draft again from Telegram.
        </p>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      return true;
    } catch {
      setCopied(false);
      return false;
    }
  };
  const copyAndOpenSource = async () => {
    await copy();
    window.location.href = links.sourceApp;
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-[#62666D]">{isPost ? "Post on X" : "Reply on X"}</p>
        <h1 className="mt-2 text-[20px] font-medium text-[#F7F8F8]">
          {isPost ? "New post" : draft.author ? `Reply to @${draft.author}` : "Reply to this post"}
        </h1>
        <p className="mt-1 text-[13px] text-[#8A8F98]">The X app should open automatically with this {isPost ? "post" : "reply"} ready.</p>
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-5">
        <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-[#F7F8F8]">{draft.text}</p>
        <p className="mt-3 font-mono text-[12px] text-[#62666D]">{draft.text.length} characters</p>
      </div>
      <a href={links.app} className={`${BUTTON} bg-[#F7F8F8] text-[#08090A] hover:bg-white`}>
        {isPost ? "Open post in X app" : "Open reply in X app"}
      </a>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={copy} className={`${BUTTON} border border-white/[0.1] text-[#F7F8F8] hover:bg-white/[0.04]`}>
          {copied ? "Copied" : isPost ? "Copy post" : "Copy reply"}
        </button>
        <button type="button" onClick={copyAndOpenSource} className={`${BUTTON} border border-white/[0.1] text-[#F7F8F8] hover:bg-white/[0.04]`}>
          {isPost ? "Copy + open X" : "Copy + open post in X"}
        </button>
      </div>
      <p className="text-center text-[13px] text-[#62666D]">
        {isPost ? "If the X app opens without the text, use Copy + open X, then paste it." : "If the X app opens without the reply target, use Copy + open post, then paste your reply."}{" "}
        <a href={links.composer} className="underline underline-offset-4 hover:text-[#8A8F98]">Browser fallback</a>
        {" · "}
        <a href={links.source} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[#8A8F98]">{isPost ? "Open X on the web" : "View post on the web"}</a>
      </p>
      <p className="text-center text-[13px] text-[#62666D]">
        {isPost ? "Nothing is posted until you press Post in X." : "Nothing is posted until you press Reply in X. Skip the draft if it doesn\u2019t fit the post."}
      </p>
    </div>
  );
}
