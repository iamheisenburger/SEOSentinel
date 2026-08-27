"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Inbox,
  Link2,
  Loader2,
  Mail,
  Search,
  Send,
  ShieldCheck,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  OUTREACH_AUTONOMY_CONSENT_TEXT,
  OUTREACH_AUTONOMY_CONSENT_VERSION,
  OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP,
  OUTREACH_AUTONOMY_POLICY_HASH,
} from "../../../../convex/lib/outreachAutonomy";
import { Button } from "@/components/ui/button";
import { useActiveSite } from "@/contexts/site-context";

type Notice = { tone: "success" | "error"; text: string } | null;
type Tab = "opportunities" | "outreach";

const OPPORTUNITY_STYLES: Record<string, string> = {
  verified: "border-[#0EA5E9]/20 bg-[#0EA5E9]/10 text-[#38BDF8]",
  outreach_prepared: "border-[#A78BFA]/20 bg-[#A78BFA]/10 text-[#C4B5FD]",
  contacted: "border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#FBBF24]",
  acquired: "border-[#22C55E]/20 bg-[#22C55E]/10 text-[#4ADE80]",
  rejected: "border-white/[0.08] bg-white/[0.03] text-[#707589]",
};

const MESSAGE_STYLES: Record<string, string> = {
  draft: "border-[#0EA5E9]/20 bg-[#0EA5E9]/10 text-[#38BDF8]",
  blocked: "border-[#EF4444]/20 bg-[#EF4444]/10 text-[#F87171]",
  approved: "border-[#A78BFA]/20 bg-[#A78BFA]/10 text-[#C4B5FD]",
  sending: "border-[#0EA5E9]/20 bg-[#0EA5E9]/10 text-[#38BDF8]",
  delivery_unverified: "border-[#EF4444]/20 bg-[#EF4444]/10 text-[#F87171]",
  delivery_reviewed_sent: "border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#FBBF24]",
  sent: "border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#FBBF24]",
  replied: "border-[#22C55E]/20 bg-[#22C55E]/10 text-[#4ADE80]",
  failed: "border-[#EF4444]/20 bg-[#EF4444]/10 text-[#F87171]",
  bounced: "border-[#EF4444]/20 bg-[#EF4444]/10 text-[#F87171]",
};

function labelStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatTime(value?: number) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function externalUrl(url: string) {
  return /^https:\/\//i.test(url) ? url : "#";
}

export default function BacklinksPage() {
  const { activeSite: site } = useActiveSite();
  const [tab, setTab] = useState<Tab>("opportunities");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [autonomyConsentAccepted, setAutonomyConsentAccepted] = useState(false);
  const [autonomyDailyCap, setAutonomyDailyCap] = useState(5);

  const opportunities = useQuery(
    api.seoAuthority.listForSite,
    site?._id ? { siteId: site._id, limit: 200 } : "skip",
  );
  const messages = useQuery(
    api.outreach.listMessages,
    site?._id ? { siteId: site._id, limit: 200 } : "skip",
  );
  const inbox = useQuery(
    api.outreach.getInbox,
    site?._id ? { siteId: site._id } : "skip",
  );
  const autonomyConsentConfigurationKey = [
    String(site?._id ?? ""),
    String(inbox?._id ?? ""),
    String(inbox?.configurationVersion ?? ""),
  ].join(":");
  useEffect(() => {
    setAutonomyConsentAccepted(false);
    setAutonomyDailyCap(5);
  }, [autonomyConsentConfigurationKey]);

  const analyzeBacklinks = useAction(api.actions.backlinks.analyzeBacklinks);
  const prepareOutreach = useAction(api.actions.outreach.prepareOutreach);
  const sendApproved = useAction(api.actions.outreach.sendApprovedOutreach);
  const sendBounceCanary = useAction(api.actions.outreach.sendInboundRelayDsnCanary);
  const sendGmailSelfTest = useAction(
    api.actions.outreach.sendGmailConnectionSelfTest,
  );
  const syncInbound = useAction(api.actions.outreach.syncInboundReplies);
  const verifyLinks = useAction(api.actions.outreach.verifyAcquiredLinks);
  const approveMessage = useMutation(api.outreach.approveMessage);
  const discardMessage = useMutation(api.outreach.discardMessage);
  const setComplianceProfile = useMutation(api.outreach.setInboxComplianceProfile);
  const enableAutonomousOutreach = useMutation(
    api.outreach.enableAutonomousOutreach,
  );
  const setInboxMode = useMutation(api.outreach.setInboxMode);
  const rotateDsnRoutingTarget = useMutation(
    api.outreach.rotateInboundRelayDsnRoutingTarget,
  );
  const suppressRecipient = useMutation(api.outreach.suppress);
  const resolveUnverified = useMutation(api.outreach.resolveUnverifiedDelivery);

  const counts = useMemo(() => {
    const opportunityCounts: Record<string, number> = {};
    const messageCounts: Record<string, number> = {};
    for (const opportunity of opportunities ?? []) {
      opportunityCounts[opportunity.status] =
        (opportunityCounts[opportunity.status] ?? 0) + 1;
    }
    for (const message of messages ?? []) {
      messageCounts[message.status] = (messageCounts[message.status] ?? 0) + 1;
    }
    return { opportunityCounts, messageCounts };
  }, [messages, opportunities]);

  const messageByOpportunity = useMemo(
    () => new Map((messages ?? []).map((message) => [message.opportunityId, message])),
    [messages],
  );
  // A rejected opportunity is evidence that no longer reconfirmed on a live
  // page. Counting it as an "opportunity" advertises a queue of work that
  // cannot be acted on, so the badge and the default list show only what the
  // tenant can actually pursue.
  const actionableOpportunities = (opportunities ?? []).filter(
    (opportunity) => opportunity.status !== "rejected",
  );
  const rejectedOpportunities = (opportunities ?? []).filter(
    (opportunity) => opportunity.status === "rejected",
  );
  const visibleOpportunities = showRejected
    ? [...actionableOpportunities, ...rejectedOpportunities]
    : actionableOpportunities;

  const ownerApprovedCount = (messages ?? []).filter(
    (message) =>
      message.status === "approved" &&
      message.approvalKind !== "account_autopilot",
  ).length;
  const inboxNeedsReconnect = !inbox ||
    !Boolean(inbox.credentialsPresent) ||
    ["disconnected", "suspended"].includes(String(inbox.status));
  const dsnRoutingAddress =
    typeof inbox?.inboundRelayDsnRoutingTargetAddress === "string"
      ? inbox.inboundRelayDsnRoutingTargetAddress
      : "";
  const storedAutonomyConsentActive = Boolean(
    inbox?.autonomousConsentActive,
  );
  const effectiveAutonomyLive = Boolean(inbox?.autonomousDeliveryEnabled);
  const isLoading = Boolean(site?._id) &&
    (opportunities === undefined || messages === undefined || inbox === undefined);

  async function runOperation(
    key: string,
    operation: () => Promise<void>,
  ) {
    setPending(key);
    setNotice(null);
    try {
      await operation();
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "The operation failed.",
      });
    } finally {
      setPending(null);
    }
  }

  function connectGmail() {
    if (!site?._id) return;
    const url = `/api/outreach/gmail/auth?siteId=${encodeURIComponent(site._id)}&returnTo=${encodeURIComponent("/backlinks")}`;
    const popup = window.open(
      url,
      "pentra-outreach-gmail",
      "width=600,height=720,popup=yes",
    );
    if (!popup) {
      setNotice({ tone: "error", text: "Allow popups, then try connecting Gmail again." });
      return;
    }
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        window.location.reload();
      }
    }, 500);
  }

  if (!site) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] px-6 py-16 text-center">
        <Link2 className="mx-auto mb-3 h-8 w-8 text-[#565A6E]" />
        <h1 className="text-[15px] font-semibold text-[#EDEEF1]">Add a site first</h1>
        <p className="mt-2 text-[13px] text-[#565A6E]">
          Backlink discovery and outreach are isolated to one site at a time.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#EDEEF1]">Backlinks</h1>
          <p className="mt-1 text-[13px] text-[#565A6E]">
            Evidence-backed opportunities and approval-first outreach for {site.domain}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {String(inbox?.inboundMonitoringMode) === "legacy_gmail" && (
            <Button
              variant="secondary"
              onClick={() => runOperation("inbound", async () => {
                const result = await syncInbound({ siteId: site._id });
                setNotice({
                  tone: result.stopped ? "error" : "success",
                  text: result.stopped
                    ? result.stopped
                    : `Checked ${result.checked} inbound message${result.checked === 1 ? "" : "s"}. ${result.replied} replies, ${result.optedOut} opt-outs, and ${result.bounced} hard bounces recorded.${result.partial ? " More Gmail pages remain queued for the next bounded sync." : ""}`,
                });
              })}
              loading={pending === "inbound"}
              icon={<Inbox className="h-3.5 w-3.5" />}
            >
              Check replies (legacy)
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => runOperation("verify", async () => {
              const result = await verifyLinks({ siteId: site._id, limit: 200 });
              setNotice({
                tone: "success",
                text: `Checked ${result.checked} page${result.checked === 1 ? "" : "s"}. ${result.acquired} exact link${result.acquired === 1 ? "" : "s"} acquired, ${result.lost} lost.`,
              });
            })}
            loading={pending === "verify"}
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
          >
            Verify links
          </Button>
          <Button
            onClick={() => runOperation("scan", async () => {
              const result = await analyzeBacklinks({ siteId: site._id });
              const found = (result.mentions?.length ?? 0) + (result.brokenLinks?.length ?? 0);
              setNotice({
                tone: "success",
                text: `Analysis finished. ${found} ${found === 1 ? "opportunity" : "opportunities"} passed live-page verification.`,
              });
            })}
            loading={pending === "scan"}
            icon={<Search className="h-3.5 w-3.5" />}
          >
            Discover opportunities
          </Button>
        </div>
      </div>

      {notice && (
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
          notice.tone === "success"
            ? "border-[#22C55E]/20 bg-[#22C55E]/[0.06]"
            : "border-[#EF4444]/20 bg-[#EF4444]/[0.06]"
        }`}>
          {notice.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4ADE80]" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#F87171]" />
          )}
          <p className={`text-[13px] ${notice.tone === "success" ? "text-[#86EFAC]" : "text-[#FCA5A5]"}`}>
            {notice.text}
          </p>
        </div>
      )}

      <section className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0EA5E9]/10">
              <Inbox className="h-5 w-5 text-[#38BDF8]" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14px] font-semibold text-[#EDEEF1]">Sending inbox</h2>
                {inbox && (
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    ["active", "warming"].includes(String(inbox.status))
                      ? "border-[#22C55E]/20 bg-[#22C55E]/10 text-[#4ADE80]"
                      : "border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#FBBF24]"
                  }`}>
                    {String(inbox.status)}
                  </span>
                )}
              </div>
              {inbox ? (
                <>
                  <p className="mt-1 truncate text-[13px] text-[#8B8FA3]">
                    {String(inbox.fromEmail)} · {String(inbox.mode ?? "approval")} mode
                  </p>
                  <p className="mt-1 text-[11px] text-[#565A6E]">
                    Sent today: {Number(inbox.sentToday ?? 0)}/{Number(inbox.effectiveDailyCap ?? 0)} safe warm-up allowance
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-[13px] text-[#8B8FA3]">
                    Connect a secondary-domain Gmail inbox. Your primary transactional domain stays isolated.
                  </p>
                  <p className="mt-1 text-[11px] text-[#565A6E]">
                    New inboxes remain in approval mode and start at the safe warm-up allowance.
                  </p>
                </>
              )}
              {Boolean(inbox?.lastError) && (
                <p className="mt-2 text-[11px] text-[#F87171]">{String(inbox?.lastError)}</p>
              )}
              {Boolean(inbox?.inboundLastError) && (
                <p className="mt-2 text-[11px] text-[#F87171]">
                  Reply monitoring: {String(inbox?.inboundLastError).replaceAll("_", " ")}
                </p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-[#707589]">
                New connections grant Gmail send access only. Before any prospect message can be
                released, an owner-triggered hard-bounce canary must prove this mailbox&apos;s Workspace
                routing into the audited receiving-only relay. Inbound bodies and attachments are
                discarded after transient parsing; Pentra stores only evidence digests.
              </p>
              {dsnRoutingAddress && (
                <div className="mt-3 rounded-lg border border-[#0EA5E9]/15 bg-[#0EA5E9]/[0.05] p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[#38BDF8]">
                    Workspace delivery-status route
                  </p>
                  <code className="mt-1 block break-all text-[11px] text-[#BAE6FD]">
                    {dsnRoutingAddress}
                  </code>
                  <p className="mt-2 text-[10px] leading-relaxed text-[#707589]">
                    Route structured delivery-status notifications for this exact sender to this
                    address. It is unique to this inbox and stays stable across routine reconnects,
                    profile edits, plan parking, and relay signing-key rotation.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => runOperation("copy-dsn-route", async () => {
                        await navigator.clipboard.writeText(dsnRoutingAddress);
                        setNotice({ tone: "success", text: "Workspace routing target copied." });
                      })}
                      loading={pending === "copy-dsn-route"}
                      icon={<Copy className="h-3.5 w-3.5" />}
                    >
                      Copy target
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => runOperation("rotate-dsn-route", async () => {
                        if (!window.confirm("Rotate this inbox's Workspace routing target? This revokes the old target for readiness and new sends, and bounce routing must be verified again. Already-sent messages remain bound to the target used when they were sent.")) return;
                        await rotateDsnRoutingTarget({ siteId: site._id });
                        setNotice({
                          tone: "success",
                          text: "Routing target rotated. Update Workspace, then verify bounce routing again.",
                        });
                      })}
                      loading={pending === "rotate-dsn-route"}
                      icon={<RefreshCw className="h-3.5 w-3.5" />}
                    >
                      Rotate target
                    </Button>
                  </div>
                </div>
              )}
              {inbox && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ReadinessBadge label="Gmail OAuth" ready={Boolean(inbox.credentialsPresent)} />
                  <ReadinessBadge
                    label={String(inbox.inboundMonitoringMode) === "legacy_gmail" ? "Legacy reply sync" : "Inbound relay"}
                    ready={Boolean(inbox.inboundMonitoringReady)}
                  />
                  <ReadinessBadge
                    label="Bounce routing canary"
                    ready={Boolean(inbox.inboundRelayDsnRoutingReady)}
                  />
                  <ReadinessBadge label="SPF" ready={Boolean(inbox.spfVerifiedAt)} />
                  <ReadinessBadge label="DKIM" ready={Boolean(inbox.dkimVerifiedAt)} />
                  <ReadinessBadge label="DMARC" ready={Boolean(inbox.dmarcVerifiedAt)} />
                  {Boolean(inbox.dnsCheckedAt) && (
                    <span className="self-center text-[10px] text-[#565A6E]">
                      DNS checked {formatTime(Number(inbox.dnsCheckedAt))}
                    </span>
                  )}
                  {Boolean(inbox.inboundLastCompletedAt) && (
                    <span className="self-center text-[10px] text-[#565A6E]">
                      Inbound processed {formatTime(Number(inbox.inboundLastCompletedAt))}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {inbox &&
              String(inbox.provider) === "gmail" &&
              Boolean(inbox.credentialsPresent) &&
              !["disconnected", "suspended"].includes(String(inbox.status)) && (
                <Button
                  variant="secondary"
                  loading={pending === "gmail-self-test"}
                  onClick={() => runOperation("gmail-self-test", async () => {
                    if (!window.confirm("Send exactly one Pentra connection test back to this same Gmail mailbox? No prospect will be contacted and outreach readiness will not change.")) return;
                    const result = await sendGmailSelfTest({ siteId: site._id });
                    setNotice({ tone: "success", text: result.message });
                  })}
                  icon={<Send className="h-3.5 w-3.5" />}
                >
                  Send Gmail self-test
                </Button>
              )}
            {inbox &&
              Boolean(inbox.inboundRelayConfigured) &&
              !Boolean(inbox.inboundRelayDsnRoutingReady) &&
              String(inbox.inboundMonitoringMode) !== "legacy_gmail" && (
                <Button
                  variant="secondary"
                  loading={pending === "bounce-canary"}
                  onClick={() => runOperation("bounce-canary", async () => {
                    if (!window.confirm("Send exactly one routing canary to Pentra's fixed controlled rejection address? No prospect is contacted.")) return;
                    const result = await sendBounceCanary({ siteId: site._id });
                    setNotice({
                      tone: result.accepted ? "success" : "error",
                      text: result.accepted
                        ? "Gmail accepted the canary. Outreach remains blocked until its exact signed hard-bounce receipt arrives."
                        : result.reason,
                    });
                  })}
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                >
                  Verify bounce routing
                </Button>
              )}
            <Button
              variant={inboxNeedsReconnect ? "primary" : "secondary"}
              onClick={connectGmail}
              icon={<Mail className="h-3.5 w-3.5" />}
            >
              {inboxNeedsReconnect ? (inbox ? "Reconnect Gmail" : "Connect Gmail") : "Refresh Gmail connection"}
            </Button>
          </div>
        </div>
        {inbox && (
          <form
            className="mt-5 grid gap-3 border-t border-white/[0.05] pt-5 md:grid-cols-[1fr_2fr_auto] md:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void runOperation("compliance", async () => {
                const result = await setComplianceProfile({
                  siteId: site._id,
                  fromName: String(data.get("fromName") || ""),
                  physicalMailingAddress: String(data.get("physicalMailingAddress") || ""),
                });
                setNotice({
                  tone: result.ready ? "success" : "error",
                  text: result.ready
                    ? "Sender identity saved. The inbox is ready in approval mode."
                    : "Sender identity saved. DNS still needs attention before sending.",
                });
              });
            }}
          >
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">
                Sender name
              </span>
              <input
                name="fromName"
                required
                minLength={2}
                maxLength={100}
                defaultValue={String(inbox.fromName ?? "")}
                autoComplete="name"
                className="h-9 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-[12px] text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
                placeholder="Real person or business name"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">
                Physical mailing address
              </span>
              <input
                name="physicalMailingAddress"
                required
                minLength={15}
                maxLength={300}
                defaultValue={String(inbox.physicalMailingAddress ?? "")}
                autoComplete="street-address"
                className="h-9 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-[12px] text-[#EDEEF1] outline-none focus:border-[#0EA5E9]/50"
                placeholder="Required in every outreach footer"
              />
            </label>
            <Button type="submit" size="sm" loading={pending === "compliance"}>
              Save sender profile
            </Button>
          </form>
        )}
        {inbox && (
          <div className="mt-5 border-t border-white/[0.05] pt-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-[#EDEEF1]">
                    Authority autopilot
                  </h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                    effectiveAutonomyLive
                      ? "border-[#22C55E]/20 bg-[#22C55E]/10 text-[#4ADE80]"
                      : storedAutonomyConsentActive
                        ? "border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#FBBF24]"
                      : "border-white/[0.08] bg-white/[0.03] text-[#707589]"
                  }`}>
                    {effectiveAutonomyLive
                      ? "live"
                      : storedAutonomyConsentActive
                        ? "paused"
                        : "off"}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-[#707589]">
                  {OUTREACH_AUTONOMY_CONSENT_TEXT}
                </p>
                {!storedAutonomyConsentActive && (
                  <label className="mt-3 flex items-start gap-2 text-[11px] text-[#B8BBC7]">
                    <input
                      type="checkbox"
                      checked={autonomyConsentAccepted}
                      onChange={(event) =>
                        setAutonomyConsentAccepted(event.target.checked)
                      }
                      className="mt-0.5"
                    />
                    <span>I understand and accept this tenant-level authorization.</span>
                  </label>
                )}
              </div>
              <div className="flex shrink-0 items-end gap-2">
                {!storedAutonomyConsentActive && (
                  <label className="block">
                    <span className="mb-1 block text-[9px] font-medium uppercase tracking-wider text-[#565A6E]">
                      Daily cap
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP}
                      value={autonomyDailyCap}
                      onChange={(event) =>
                        setAutonomyDailyCap(Number(event.target.value))
                      }
                      className="h-8 w-20 rounded-lg border border-white/[0.08] bg-black/20 px-2 text-[12px] text-[#EDEEF1]"
                    />
                  </label>
                )}
                {storedAutonomyConsentActive ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pending === "disable-autonomy"}
                    onClick={() => runOperation("disable-autonomy", async () => {
                      const result = await setInboxMode({
                        siteId: site._id,
                        mode: "approval",
                      });
                      setNotice({
                        tone: "success",
                        text: result.inFlightMayComplete
                          ? "Authority autopilot disabled. No new claim can start; the one message already claimed by Gmail may still complete."
                          : "Authority autopilot disabled immediately. No queued automatic message can send.",
                      });
                    })}
                  >
                    Disable
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={
                      !Boolean(inbox.autonomousDeliveryReleaseAvailable) ||
                      !autonomyConsentAccepted ||
                      !Boolean(inbox.inboundRelayDsnRoutingReady)
                    }
                    loading={pending === "enable-autonomy"}
                    onClick={() => runOperation("enable-autonomy", async () => {
                      const result = await enableAutonomousOutreach({
                        siteId: site._id,
                        expectedInboxId: inbox._id as Id<"outreach_inboxes">,
                        expectedInboxConfigurationVersion: Number(
                          inbox.configurationVersion ?? 0,
                        ),
                        consentVersion: OUTREACH_AUTONOMY_CONSENT_VERSION,
                        consentPolicyHash: OUTREACH_AUTONOMY_POLICY_HASH,
                        dailySendCap: autonomyDailyCap,
                        confirmsAutomaticSending: true,
                        confirmsBusinessRecipientsAndLawfulBasis: true,
                        confirmsSenderIdentityAndAddress: true,
                        acceptsMailboxReputationRisk: true,
                      });
                      setAutonomyConsentAccepted(false);
                      setNotice({
                        tone: "success",
                        text: `Authority autopilot enabled at ${result.dailySendCap}/day. ${result.authorizedDrafts} existing safe draft${result.authorizedDrafts === 1 ? "" : "s"} authorized.`,
                      });
                    })}
                  >
                    Enable autopilot
                  </Button>
                )}
              </div>
            </div>
            {!Boolean(inbox.autonomousDeliveryReleaseAvailable) && (
              <p className="mt-2 text-[10px] text-[#FBBF24]">
                {storedAutonomyConsentActive
                  ? "Autonomous delivery is paused by the environment, but your stored authorization remains active. Use Disable to prevent it from resuming when the release switch returns."
                  : "This environment has not released autonomous delivery."}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Verified queue"
          value={counts.opportunityCounts.verified ?? 0}
          icon={<Search className="h-3.5 w-3.5 text-[#38BDF8]" />}
        />
        <SummaryCard
          label="Drafts to review"
          value={counts.messageCounts.draft ?? 0}
          icon={<Mail className="h-3.5 w-3.5 text-[#C4B5FD]" />}
        />
        <SummaryCard
          label="Contacted"
          value={counts.opportunityCounts.contacted ?? 0}
          icon={<Send className="h-3.5 w-3.5 text-[#FBBF24]" />}
        />
        <SummaryCard
          label="Verified links"
          value={counts.opportunityCounts.acquired ?? 0}
          icon={<Check className="h-3.5 w-3.5 text-[#4ADE80]" />}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-[#0F1117] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
          <TabButton active={tab === "opportunities"} onClick={() => setTab("opportunities")}>
            Opportunities <CountBadge value={actionableOpportunities.length} />
          </TabButton>
          <TabButton active={tab === "outreach"} onClick={() => setTab("outreach")}>
            Outreach <CountBadge value={messages?.length ?? 0} />
          </TabButton>
        </div>
        {tab === "opportunities" ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={(counts.opportunityCounts.verified ?? 0) === 0}
            loading={pending === "prepare"}
            onClick={() => runOperation("prepare", async () => {
              const result = await prepareOutreach({ siteId: site._id, limit: 25 });
              setTab("outreach");
              setNotice({
                tone: "success",
                text: `Prepared ${result.drafted} draft${result.drafted === 1 ? "" : "s"}. ${result.blocked} blocked with a visible reason; ${result.skipped} skipped.${result.partial ? ` This bounded run ended with at least ${result.deferredAtLeast} verified opportunit${result.deferredAtLeast === 1 ? "y" : "ies"} still queued (${result.stopReason}).` : " The bounded queue was fully processed."}`,
              });
            })}
            icon={<Mail className="h-3.5 w-3.5" />}
          >
            Prepare verified outreach
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={ownerApprovedCount === 0 || !Boolean(inbox?.inboundMonitoringReady)}
            loading={pending === "send"}
            onClick={() => runOperation("send", async () => {
              if (!window.confirm("Send exactly one approved email now? Pentra will not send the remaining approvals automatically.")) return;
              const result = await sendApproved({ siteId: site._id, max: 1 });
              setNotice({
                tone: result.failed > 0 || result.stopped ? "error" : "success",
                text: `Sent ${result.sent}; failed ${result.failed}.${result.stopped ? ` ${result.stopped}` : ""}`,
              });
            })}
            icon={<Send className="h-3.5 w-3.5" />}
          >
            Send next owner-approved (1 of {ownerApprovedCount})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-white/[0.06] bg-[#0F1117] py-16">
          <Loader2 className="h-7 w-7 animate-spin text-[#38BDF8]" />
        </div>
      ) : tab === "opportunities" ? (
        <div className="flex flex-col gap-3">
          {actionableOpportunities.length === 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6 text-center">
              <p className="text-[14px] font-medium text-[#F1F5F9]">
                No actionable opportunities right now
              </p>
              <p className="mt-1 text-[13px] text-[#8A8FA3]">
                {rejectedOpportunities.length > 0
                  ? `${rejectedOpportunities.length} previously found ${rejectedOpportunities.length === 1 ? "opportunity" : "opportunities"} no longer reconfirm on a live page, so Pentra will not pitch them. Discovery runs automatically; use Discover opportunities to search now.`
                  : "Discovery runs automatically. Use Discover opportunities to search now."}
              </p>
            </div>
          )}
          {rejectedOpportunities.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRejected((value) => !value)}
              className="self-start rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[12px] font-medium text-[#8A8FA3] transition hover:text-[#F1F5F9]"
            >
              {showRejected ? "Hide" : "Show"} {rejectedOpportunities.length} unconfirmed
            </button>
          )}
          {visibleOpportunities.map((opportunity) => {
            const message = messageByOpportunity.get(opportunity._id);
            return (
              <article key={opportunity._id} className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${OPPORTUNITY_STYLES[opportunity.status] ?? OPPORTUNITY_STYLES.rejected}`}>
                        {labelStatus(opportunity.status)}
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-[#565A6E]">
                        {opportunity.type === "broken_link" ? "Broken link" : "Unlinked mention"}
                      </span>
                      {message && (
                        <span className="text-[10px] text-[#707589]">Message: {labelStatus(message.status)}</span>
                      )}
                    </div>
                    <h2 className="mt-2 truncate text-[14px] font-semibold text-[#EDEEF1]">
                      {opportunity.sourceDomain || safeHost(opportunity.sourceUrl)}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[#8B8FA3]">
                      {opportunity.context}
                    </p>
                  </div>
                  {typeof opportunity.domainRank === "number" && (
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] uppercase tracking-wide text-[#565A6E]">Domain rank</p>
                      <p className="mt-0.5 text-[16px] font-semibold text-[#EDEEF1]">{opportunity.domainRank}</p>
                    </div>
                  )}
                </div>

                <div className="mt-4 grid gap-3 border-t border-white/[0.05] pt-4 md:grid-cols-2 xl:grid-cols-4">
                  <EvidenceLink label="Verified source page" url={opportunity.sourceUrl} />
                  <EvidenceLink label="Requested exact href" url={opportunity.targetUrl} />
                  <EvidenceValue label="Anchor evidence" value={opportunity.anchorText || "Page context verified"} />
                  <EvidenceValue label="Last evidence check" value={formatTime(opportunity.lastCheckedAt)} />
                </div>

                {opportunity.status === "acquired" && opportunity.acquiredLinkUrl && (
                  <div className="mt-4 flex flex-col gap-2 rounded-lg border border-[#22C55E]/20 bg-[#22C55E]/[0.05] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4ADE80]" />
                      <p className="text-[11px] text-[#86EFAC]">
                        Exact href observed on the requested page at {formatTime(opportunity.acquiredAt)}.
                      </p>
                    </div>
                    <a
                      href={externalUrl(opportunity.acquiredLinkUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#4ADE80] hover:underline"
                    >
                      View receipt <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                {opportunity.status === "rejected" && (
                  <p className="mt-4 flex items-center gap-2 text-[11px] text-[#707589]">
                    <XCircle className="h-3.5 w-3.5" />
                    A later live-page scan did not reconfirm this evidence, so it is not actionable.
                  </p>
                )}
              </article>
            );
          })}
          {(opportunities ?? []).length === 0 && (
            <EmptyState
              icon={<Link2 className="h-8 w-8" />}
              title="No verified opportunities yet"
              detail="Run discovery. Pentra only stores an opportunity after it verifies the evidence on the live source page."
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(messages ?? []).map((message) => {
            const reasons = [
              message.blockedReason,
              message.pacingReason,
              message.status === "delivery_reviewed_sent" ? undefined : message.failureReason,
              ...(message.complianceIssues ?? []),
            ].filter((reason): reason is string => Boolean(reason));
            const approveKey = `approve:${message._id}`;
            const discardKey = `discard:${message._id}`;
            const suppressKey = `suppress:${message._id}`;
            const reviewSentKey = `review-sent:${message._id}`;
            const reviewNotSentKey = `review-not-sent:${message._id}`;
            return (
              <article key={message._id} className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${MESSAGE_STYLES[message.status] ?? OPPORTUNITY_STYLES.rejected}`}>
                        {labelStatus(message.status)}
                      </span>
                      <span className="truncate text-[11px] text-[#707589]">{message.toEmail || message.toDomain}</span>
                    </div>
                    <h2 className="mt-2 text-[14px] font-semibold text-[#EDEEF1]">{message.subject}</h2>
                    <p className="mt-1 text-[10px] text-[#565A6E]">Created {formatTime(message.createdAt)}</p>
                  </div>
                  {message.status === "draft" && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={pending === discardKey}
                        onClick={() => runOperation(discardKey, async () => {
                          await discardMessage({ siteId: site._id, messageId: message._id });
                          setNotice({ tone: "success", text: "Draft discarded. Nothing was sent." });
                        })}
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        loading={pending === approveKey}
                        onClick={() => runOperation(approveKey, async () => {
                          await approveMessage({ siteId: site._id, messageId: message._id });
                          setNotice({ tone: "success", text: "Draft approved. It has not been sent yet." });
                        })}
                        icon={<Check className="h-3.5 w-3.5" />}
                      >
                        Approve
                      </Button>
                    </div>
                  )}
                  {["sent", "replied", "delivery_unverified", "delivery_reviewed_sent"].includes(message.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={pending === suppressKey}
                      onClick={() => runOperation(suppressKey, async () => {
                        if (!window.confirm(`Permanently suppress ${message.toEmail || message.toDomain} for this site?`)) return;
                        await suppressRecipient({
                          siteId: site._id,
                          kind: "domain",
                          value: message.toDomain,
                          reason: "manual",
                        });
                        if (message.toEmail) {
                          await suppressRecipient({
                            siteId: site._id,
                            kind: "email",
                            value: message.toEmail,
                            reason: "manual",
                          });
                        }
                        setNotice({
                          tone: "success",
                          text: "Recipient opt-out recorded. Pentra will not contact this domain or address again.",
                        });
                      })}
                    >
                      Record opt-out
                    </Button>
                  )}
                  {message.status === "delivery_unverified" && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={pending === reviewNotSentKey}
                        onClick={() => runOperation(reviewNotSentKey, async () => {
                          if (!window.confirm("After checking Gmail's Sent folder, confirm this message was not sent? A fresh draft and approval will be required.")) return;
                          await resolveUnverified({
                            siteId: site._id,
                            messageId: message._id,
                            resolution: "confirmed_not_sent",
                          });
                          setNotice({ tone: "success", text: "Manual review recorded as not sent. This draft will not be retried." });
                        })}
                      >
                        Not in Sent
                      </Button>
                      <Button
                        size="sm"
                        loading={pending === reviewSentKey}
                        onClick={() => runOperation(reviewSentKey, async () => {
                          if (!window.confirm("Confirm that you found this exact message in Gmail's Sent folder?")) return;
                          await resolveUnverified({
                            siteId: site._id,
                            messageId: message._id,
                            resolution: "confirmed_sent",
                          });
                          setNotice({ tone: "success", text: "Manual Gmail review recorded as sent. The audit trail identifies it as manually verified." });
                        })}
                      >
                        Found in Sent
                      </Button>
                    </div>
                  )}
                </div>

                {reasons.length > 0 && (
                  <div className="mt-4 rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/[0.05] px-3 py-2.5">
                    <p className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-[#FCA5A5]">
                      <AlertCircle className="h-3.5 w-3.5" /> Why this message cannot proceed
                    </p>
                    <ul className="space-y-1 pl-5 text-[11px] text-[#F87171]">
                      {reasons.map((reason, index) => <li key={`${reason}-${index}`} className="list-disc">{reason}</li>)}
                    </ul>
                  </div>
                )}

                <div className="mt-4 whitespace-pre-wrap rounded-lg border border-white/[0.05] bg-black/10 p-4 text-[12px] leading-relaxed text-[#B8BBC7]">
                  {message.body}
                </div>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#565A6E]">
                  {message.sentAt && <span>Sent {formatTime(message.sentAt)}</span>}
                  {message.repliedAt && <span>Replied {formatTime(message.repliedAt)}</span>}
                  {message.bouncedAt && <span>Bounced {formatTime(message.bouncedAt)}</span>}
                  {message.inboundReceiptKind && message.inboundReceiptAt && (
                    <span className="text-[#4ADE80]">
                      Inbound {labelStatus(String(message.inboundReceiptKind))} receipt sealed {formatTime(message.inboundReceiptAt)}
                    </span>
                  )}
                  {message.status === "approved" && (
                    <span className="flex items-center gap-1 text-[#C4B5FD]">
                      <Clock3 className="h-3 w-3" />{
                        message.approvalKind === "account_autopilot"
                          ? ` Autopilot-authorized${message.scheduledAt ? ` for ${formatTime(message.scheduledAt)}` : ""}`
                          : " Approved and waiting for your send command"
                      }
                    </span>
                  )}
                  {message.status === "delivery_reviewed_sent" && (
                    <span className="text-[#FBBF24]">
                      Confirmed manually in Gmail&apos;s Sent folder; Pentra did not capture a provider receipt.
                    </span>
                  )}
                </div>
              </article>
            );
          })}
          {(messages ?? []).length === 0 && (
            <EmptyState
              icon={<Mail className="h-8 w-8" />}
              title="No durable outreach records yet"
              detail="Prepare outreach from the verified queue. Drafts, approvals, send receipts, automatic reply and bounce receipts, failures, and suppressions remain visible."
            />
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-[#EDEEF1]">{value}</p>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
        active ? "bg-white/[0.06] text-[#EDEEF1]" : "text-[#565A6E] hover:text-[#8B8FA3]"
      }`}
    >
      {children}
    </button>
  );
}

function CountBadge({ value }: { value: number }) {
  return (
    <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-white/[0.06] px-1 text-[9px] text-[#8B8FA3]">
      {value}
    </span>
  );
}

function ReadinessBadge({ label, ready }: { label: string; ready: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium ${
      ready
        ? "border-[#22C55E]/20 bg-[#22C55E]/[0.07] text-[#4ADE80]"
        : "border-[#F59E0B]/20 bg-[#F59E0B]/[0.07] text-[#FBBF24]"
    }`}>
      {ready ? <Check className="h-2.5 w-2.5" /> : <Clock3 className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function EvidenceLink({ label, url }: { label: string; url: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-medium uppercase tracking-wider text-[#565A6E]">{label}</p>
      <a
        href={externalUrl(url)}
        target="_blank"
        rel="noreferrer"
        className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-[#38BDF8] hover:underline"
      >
        <span className="truncate">{safeHost(url)}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}

function EvidenceValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-medium uppercase tracking-wider text-[#565A6E]">{label}</p>
      <p className="mt-1 truncate text-[11px] text-[#B8BBC7]" title={value}>{value}</p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0F1117] px-6 py-14 text-center">
      <div className="mb-3 text-[#565A6E]/50">{icon}</div>
      <h2 className="text-[14px] font-semibold text-[#EDEEF1]">{title}</h2>
      <p className="mt-2 max-w-lg text-[12px] leading-relaxed text-[#565A6E]">{detail}</p>
    </div>
  );
}
