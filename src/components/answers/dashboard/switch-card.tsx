"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { InlineError } from "@/components/answers/ui";
import { useAnswersActions, useAppHref } from "@/lib/answers/backend";
import { ASSISTANT_NAMES_SENTENCE, SNAPSHOT } from "@/lib/product-facts";
import { userErrorMessage } from "@/lib/user-error";

type LegacySite = { _id: string; domain: string; siteName?: string };

/**
 * On an articles site's dashboard: what Pentra Answers is, and one button to switch this site. The switch is
 * confirmed first (it changes what the dashboard shows); the articles already published stay where they are.
 */
export function SwitchToAnswersCard({ site }: { site: LegacySite }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section aria-labelledby="switch-answers-title" className="mb-6 rounded-card border border-border-strong bg-surface-1 p-5 sm:p-6">
      <p className="mono-caps text-text-3">Pentra Answers</p>
      <h2 id="switch-answers-title" className="mt-2 text-[18px] font-semibold leading-7 tracking-[-0.01em] text-text [overflow-wrap:anywhere]">
        See what AI assistants say about {site.domain}
      </h2>
      <p className="mt-1.5 max-w-[640px] text-[14px] leading-[22px] text-text-2">
        Pentra asks {ASSISTANT_NAMES_SENTENCE} the questions your buyers ask, shows who they name with every answer as proof, and writes pages that
        answer them. Your published articles stay where they are.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => setConfirming(true)} iconRight={<ArrowRight className="h-4 w-4" strokeWidth={1.5} />}>Switch to Pentra Answers</Button>
        <span className="text-[13px] text-text-3">You confirm what Pentra read about your business before any assistant is asked.</span>
      </div>
      {confirming && <SwitchConfirm site={site} onClose={() => setConfirming(false)} />}
    </section>
  );
}

function SwitchConfirm({ site, onClose }: { site: LegacySite; onClose: () => void }) {
  const actions = useAnswersActions();
  const router = useRouter();
  const href = useAppHref();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.switchToAnswers({ siteId: site._id });
      router.push(href(`/start?site=${encodeURIComponent(site._id)}`));
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't switch this site. Try again."));
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} dismissible={!busy} title={`Switch ${site.domain} to Pentra Answers?`}
      description="This changes what your dashboard shows for this site."
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={confirm} loading={busy} loadingLabel="Switching…">Switch this site</Button></div>}>
      <ol className="flex flex-col gap-2.5 text-[14px] leading-[22px] text-text-2">
        <li>1. Pentra reads {site.domain} and shows you what it understood.</li>
        <li>2. You confirm the business and its competitors.</li>
        <li>3. Pentra asks about {SNAPSHOT.questions} questions to {SNAPSHOT.assistants} assistants and writes your first {SNAPSHOT.draftPages} pages as drafts.</li>
      </ol>
      <p className="mt-4 text-[13px] leading-5 text-text-3">Your published articles stay on your site. Pentra stops writing new articles for this site and writes answer pages instead.</p>
      {error && <InlineError className="mt-4" title="Not switched">{error}</InlineError>}
    </Modal>
  );
}
