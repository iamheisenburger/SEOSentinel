"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Copy, Globe, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, fieldStyles } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { InlineError, Notice, Panel, PanelSkeleton, ScreenHeader, ScrollX } from "@/components/answers/ui";
import { describeDestination } from "@/components/answers/dashboard/destination";
import { useAnswersActions, useAnswersBackend, useAnswersQuery, useNow, type AnswersActions, type ConnectionInput } from "@/lib/answers/backend";
import { hostedStatusLabel, plural, shortStamp, timeAgo } from "@/lib/answers/format";

import type { GithubRepository, Overview, SetupState, SiteConnection } from "@/lib/answers/types";
import { CMS_DEFAULT_COLLECTION, CMS_PLATFORM_LABELS, CMS_SETUP_STEPS } from "../../../../convex/lib/cmsDestinations";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

export function AnswersSettings({ siteId }: { siteId: string }) {
  const overview = useAnswersQuery("overview", { siteId });
  const setup = useAnswersQuery("setupState", { siteId });
  if (overview === undefined || setup === undefined) {
    return <><ScreenHeader title="Settings" /><PanelSkeleton lines={6} /><PanelSkeleton lines={6} /></>;
  }
  if (overview === null || setup === null) return <Notice>This site&apos;s settings aren&apos;t available.</Notice>;
  return (
    <>
      <ScreenHeader title="Settings" meta={overview.site.domain} />
      <BusinessFacts setup={setup} />
      <Publishing overview={overview} />
      <Preferences overview={overview} />
    </>
  );
}

/** After a destination is connected: pages that failed for lack of one publish at once (answerPublish.retryFailed). */
async function retryWaiting(actions: AnswersActions, siteId: string) {
  try {
    await actions.retryFailed({ siteId });
  } catch (error) {
    // The backend adds this mutation alongside the UI; until it's deployed the dispatcher still retries hourly.
    console.warn("Pentra: retrying waiting pages didn't run", error);
  }
}

/* ─── Business facts ───────────────────────────────────────────────────── */

function BusinessFacts({ setup }: { setup: SetupState }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [name, setName] = useState(setup.name ?? "");
  const [sells, setSells] = useState(setup.sells);
  const [buyers, setBuyers] = useState(setup.buyers);
  const [offerings, setOfferings] = useState(setup.offerings.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const list = offerings.split("\n").map((o) => o.trim()).filter((o) => o.length > 1);
  const changed = name !== (setup.name ?? "") || sells !== setup.sells || buyers !== setup.buyers || list.join("|") !== setup.offerings.join("|");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!name.trim() || sells.trim().length < 10) return;
    setBusy(true);
    setError(null);
    try {
      await actions.updateBusiness({ siteId: setup.siteId, name, sells, buyers, offerings: list });
      toast("Saved. Pages Pentra writes from now on use these facts.", "success");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't save the business facts."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel id="business" title="Business facts" description="What Pentra writes from. Published pages keep their words until they're rewritten.">
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Input label="Business name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={touched && !name.trim() ? "Enter the business's name." : undefined} />
        <Input label="Website" value={setup.domain} readOnly disabled />
        <Textarea label="What it sells" value={sells} onChange={(e) => setSells(e.target.value)} rows={3} maxLength={600}
          error={touched && sells.trim().length < 10 ? "Say what the business sells in a sentence." : undefined} />
        <Textarea label="Who buys it" value={buyers} onChange={(e) => setBuyers(e.target.value)} rows={3} maxLength={300} />
        <div className="lg:col-span-2">
          <Textarea label="What it offers (one per line, up to 10)" value={offerings} onChange={(e) => setOfferings(e.target.value)} rows={Math.min(10, Math.max(4, offerings.split("\n").length + 1))} />
        </div>
        {error && <div className="lg:col-span-2"><InlineError title="Not saved">{error}</InlineError></div>}
        <div className="lg:col-span-2">
          <Button type="submit" disabled={!changed} loading={busy} loadingLabel="Saving…">Save business facts</Button>
        </div>
      </form>
    </Panel>
  );
}

/* ─── Publishing ───────────────────────────────────────────────────────── */

type Choice = "site" | "hosted";

function Publishing({ overview }: { overview: Overview }) {
  const { site } = overview;
  const connection = useAnswersQuery("siteConnection", { siteId: site.siteId });
  const destination = describeDestination(site.publishing, site.publishing?.target === "hosted" ? null : connection);
  const [choice, setChoice] = useState<Choice>(site.publishing?.target === "hosted" ? "hosted" : "site");
  const waiting = overview.pages.filter((p) => p.status === "publish_failed").length;

  return (
    <Panel id="publishing" title="Where pages publish" description="Your site's own blog, or answers on a subdomain Pentra hosts for you.">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 rounded-control border border-border bg-surface-2/50 px-4 py-3">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-3">Now</p>
          {destination.kind === "loading" ? <Skeleton className="h-5 w-48" /> : (
            <p className="flex flex-wrap items-center gap-2 text-[14px] text-text">
              {destination.kind === "none" ? "Not connected. Pages wait in Drafts until they have somewhere to go." : `Publishing to ${destination.label}`}
              {destination.kind === "hosted" && <StatusPill kind={hostedStatusLabel(destination.status).pill}>{hostedStatusLabel(destination.status).label}</StatusPill>}
              {destination.kind === "site" && <StatusPill kind="published">Connected</StatusPill>}
            </p>
          )}
          {waiting > 0 && <p className="text-[13px] text-text-3">{plural(waiting, "page")} couldn&apos;t publish yet; they go out as soon as a destination works.</p>}
        </div>

        <div role="radiogroup" aria-label="Where pages publish" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ChoiceCard checked={choice === "site"} onSelect={() => setChoice("site")} title="Your site's blog"
            body="WordPress, Webflow, Shopify, Ghost, GitHub, or any CMS with a signed webhook. Pages live on your own domain." />
          <ChoiceCard checked={choice === "hosted"} onSelect={() => setChoice("hosted")} title={`answers.${site.domain}`}
            body="Hosted by Pentra on your subdomain: one DNS record, nothing to install. IndexNow tells Bing the moment a page is live." />
        </div>

        {choice === "site" && connection && <SearchConsoleRow siteId={site.siteId} connected={Boolean(connection.gscConnected)} />}
        {choice === "site" ? (
          connection === undefined ? <Skeleton className="h-40 w-full" /> : connection === null ? (
            <Notice>Pentra couldn&apos;t read this site&apos;s connection.</Notice>
          ) : (
            <SiteConnectionForm siteId={site.siteId} domain={site.domain} connection={connection} usingHosted={site.publishing?.target === "hosted"} />
          )
        ) : (
          <HostedAddress overview={overview} />
        )}
        <p className="text-[12px] leading-[18px] text-text-3">
          After a page is live, Pentra tells search engines: IndexNow (Bing) for hosted pages and GitHub-published Next.js or Astro sites, and your sitemap to Google through
          your own Search Console when it&apos;s connected.
        </p>
      </div>
    </Panel>
  );
}

/** Google gets the sitemap through the owner's own Search Console, so Pentra asks them to connect it once. */
function SearchConsoleRow({ siteId, connected }: { siteId: string; connected: boolean }) {
  const { synthetic } = useAnswersBackend();
  const { toast } = useToast();
  const connect = () => {
    if (synthetic) { toast("In the app this opens Google to connect Search Console.", "info"); return; }
    window.open(`/api/gsc/auth?siteId=${encodeURIComponent(siteId)}`, "gsc-connect", "width=600,height=720,popup=yes");
  };
  return (
    <div className="flex flex-col gap-2 rounded-control border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[14px] text-text">
          Google Search Console {connected && <StatusPill kind="published">Connected</StatusPill>}
        </p>
        <p className="mt-0.5 text-[13px] leading-5 text-text-3">
          {connected
            ? "Pentra sends your sitemap to Google through it after each page on your site goes live."
            : "Connect it once and Pentra sends your sitemap to Google after each page goes live. Without it, Google finds pages on its own schedule."}
        </p>
      </div>
      {!connected && <Button variant="secondary" size="sm" onClick={connect} className="shrink-0">Connect Search Console</Button>}
    </div>
  );
}

function ChoiceCard({ checked, onSelect, title, body }: { checked: boolean; onSelect: () => void; title: string; body: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect}
      className={cx("flex flex-col items-start gap-1 rounded-card border p-4 text-left transition-colors duration-[var(--d-instant)]",
        checked ? "border-[var(--border-focus)] bg-you-tint" : "border-border hover:border-border-strong hover:bg-surface-2")}>
      <span className="flex w-full items-center gap-2">
        <span aria-hidden="true" className={cx("flex h-4 w-4 items-center justify-center rounded-full border", checked ? "border-you" : "border-border-strong")}>
          {checked && <span className="h-2 w-2 rounded-full bg-you" />}
        </span>
        <span className="text-[14px] font-medium text-text [overflow-wrap:anywhere]">{title}</span>
      </span>
      <span className="pl-6 text-[13px] leading-5 text-text-3">{body}</span>
    </button>
  );
}

const METHODS = [
  { id: "github", label: "GitHub" },
  { id: "wordpress", label: "WordPress" },
  { id: "webflow", label: "Webflow" },
  { id: "shopify", label: "Shopify" },
  { id: "ghost", label: "Ghost" },
  { id: "webhook", label: "Webhook" },
] as const;
type Method = (typeof METHODS)[number]["id"];

const GITHUB_LIST_FAILED = "Pentra couldn't list your GitHub repositories. Reconnect GitHub and try again, or type the repository below.";
const NO_GITHUB_REPOSITORIES = "This GitHub account has no repository Pentra can publish to. If your website's repository belongs to an organization, approve Pentra for that organization in GitHub (Settings → Applications → Authorized OAuth Apps → Pentra → Grant), then reconnect.";

function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

/** The site's own connection, saved and checked the way the legacy Settings section does it. */
function SiteConnectionForm({ siteId, domain, connection, usingHosted }: { siteId: string; domain: string; connection: SiteConnection; usingHosted: boolean }) {
  const actions = useAnswersActions();
  const { synthetic } = useAnswersBackend();
  const { toast } = useToast();
  const current = (connection.publishMethod && connection.publishMethod !== "manual" ? connection.publishMethod : null) as Method | null;
  const [method, setMethod] = useState<Method>(current ?? "github");
  const [repoOwner, setRepoOwner] = useState(connection.repoOwner ?? "");
  const [repoName, setRepoName] = useState(connection.repoName ?? "");
  const [wpUrl, setWpUrl] = useState(connection.wpUrl ?? "");
  const [wpUsername, setWpUsername] = useState(connection.wpUsername ?? "");
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [webhookUrl, setWebhookUrl] = useState(connection.webhookUrl ?? "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [cmsEndpoint, setCmsEndpoint] = useState(connection.cmsEndpoint ?? "");
  const [cmsClientId, setCmsClientId] = useState(connection.cmsClientId ?? "");
  const [cmsSecret, setCmsSecret] = useState("");
  const [cmsCollection, setCmsCollection] = useState(connection.cmsCollection ?? "");
  const [repos, setRepos] = useState<GithubRepository[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "verify" | "switch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const githubReady = Boolean(connection.githubAuthorized || connection.githubConnected);

  useEffect(() => {
    if (method !== "github" || !githubReady || repos) return;
    let live = true;
    actions.listGithubRepositories({ siteId })
      .then((list) => { if (live) { setRepoError(null); setRepos(list); } })
      .catch((e) => { if (live) { setRepoError(userErrorMessage(e, GITHUB_LIST_FAILED)); setRepos([]); } });
    return () => { live = false; };
  }, [method, githubReady, repos, actions, siteId]);

  const connectGithub = () => {
    setError(null);
    if (synthetic) { toast("In the app this opens GitHub to approve Pentra.", "info"); return; }
    const popup = window.open(`/api/github/auth?siteId=${encodeURIComponent(siteId)}`, "github-oauth", "width=600,height=700,popup=yes");
    if (!popup) setError("Your browser blocked the GitHub window. Allow pop-ups for pentra.dev, then click Connect again.");
  };

  const input = (): ConnectionInput => {
    const base = { siteId, domain };
    if (method === "github") return { ...base, publishMethod: "github", repoOwner: repoOwner.trim() || undefined, repoName: repoName.trim() || undefined };
    if (method === "wordpress") return { ...base, publishMethod: "wordpress", wpUrl: wpUrl.trim() || undefined, wpUsername: wpUsername.trim() || undefined, wpAppPassword: wpAppPassword.trim() || undefined };
    if (method === "webhook") return { ...base, publishMethod: "webhook", webhookUrl: webhookUrl.trim() || undefined, webhookSecret: webhookSecret.trim() || undefined };
    return { ...base, publishMethod: method, cmsEndpoint: method === "webflow" ? undefined : cmsEndpoint.trim() || undefined,
      cmsClientId: method === "shopify" ? cmsClientId.trim() || undefined : undefined, cmsSecret: cmsSecret.trim() || undefined,
      cmsCollection: method === "ghost" ? undefined : cmsCollection.trim() || undefined };
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("save");
    setError(null);
    setVerified(false);
    try {
      await actions.saveConnection(input());
      await actions.verifyConnection({ siteId });
      await actions.usePublishingConnection({ siteId });
      await retryWaiting(actions, siteId);
      setVerified(true);
      setWpAppPassword(""); setWebhookSecret(""); setCmsSecret("");
      toast("Connected and checked. Pages publish here from now on.", "success");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't save or check this connection. Check the details and try again."));
    } finally {
      setBusy(null);
    }
  };
  const verify = async () => {
    setBusy("verify");
    setError(null);
    setVerified(false);
    try {
      await actions.verifyConnection({ siteId });
      setVerified(true);
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't check this connection. Check the details and try again."));
    } finally {
      setBusy(null);
    }
  };
  const switchBack = async () => {
    setBusy("switch");
    setError(null);
    try {
      await actions.usePublishingConnection({ siteId });
      await retryWaiting(actions, siteId);
      toast("Pages publish to your site's blog from now on.", "success");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't switch where pages publish."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4 rounded-card border border-border p-4 sm:p-5">
      {usingHosted && current && (
        <Notice actions={<Button size="sm" variant="secondary" onClick={switchBack} loading={busy === "switch"} loadingLabel="Switching…">Publish here instead</Button>}>
          Your site is connected through {METHODS.find((m) => m.id === current)?.label}, but pages publish to your answers address now.
        </Notice>
      )}
      <div>
        <p className="mb-2 text-[13px] font-medium text-text-2">Your site runs on</p>
        <div role="radiogroup" aria-label="Publishing method" className="flex flex-wrap gap-1.5">
          {METHODS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={method === m.id} onClick={() => { setMethod(m.id); setError(null); setVerified(false); }}
              className={cx("inline-flex h-8 items-center gap-1.5 rounded-control border px-3 text-[13px] font-medium transition-colors duration-[var(--d-instant)]",
                method === m.id ? "border-border-strong bg-surface-3 text-text" : "border-border text-text-3 hover:bg-surface-2 hover:text-text")}>
              {m.label}{current === m.id && <span className="text-[11px] text-named">· connected</span>}
            </button>
          ))}
        </div>
      </div>

      {method === "github" && (
        <>
          {!githubReady ? (
            <div className="flex flex-col gap-2 rounded-control border border-border bg-surface-2/50 p-4">
              <p className="text-[14px] text-text">Connect the GitHub repository your Next.js, Astro, Hugo, Jekyll or Gatsby site builds from.</p>
              <p className="text-[13px] text-text-3">GitHub opens in a small window. Pentra commits each page as a Markdown file in your blog&apos;s folder.</p>
              <div><Button variant="secondary" size="sm" onClick={connectGithub}>Connect GitHub</Button></div>
            </div>
          ) : repos === null ? (
            <Skeleton className="h-10 w-full" />
          ) : repos.length > 0 ? (
            <Field>
              <label htmlFor="repo-choice" className="text-[13px] font-medium text-text-2">Repository</label>
              <select id="repo-choice" className={cx(fieldStyles, "select-field h-10")}
                value={repos.some((r) => r.owner === repoOwner && r.name === repoName) ? `${repoOwner}/${repoName}` : ""}
                onChange={(e) => { const r = repos.find((x) => `${x.owner}/${x.name}` === e.target.value); if (r) { setRepoOwner(r.owner); setRepoName(r.name); } }}>
                <option value="">Choose the repository Pentra publishes to</option>
                {repos.map((r) => <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>{r.owner}/{r.name}{r.private ? " (private)" : ""}</option>)}
              </select>
            </Field>
          ) : (
            <p role="status" className="text-[13px] leading-5 text-text-2">{repoError ?? NO_GITHUB_REPOSITORIES}</p>
          )}
          {githubReady && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Owner" value={repoOwner} onChange={(e) => setRepoOwner(e.target.value)} placeholder="acme" />
              <Input label="Repository" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="website" />
            </div>
          )}
        </>
      )}

      {method === "wordpress" && (
        <>
          <p className="text-[13px] leading-5 text-text-3">
            Pentra publishes to WordPress through a small plugin. <a className="text-text-2 underline decoration-border-strong underline-offset-2 hover:text-text" href="/pentra-wordpress-plugin.zip" download>Download the plugin (ZIP)</a>,
            install it (Plugins → Add New → Upload Plugin → Activate), then create an Application Password under Users → Profile.
          </p>
          <Input label="WordPress address" value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} placeholder="https://yoursite.com" inputMode="url" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Username" value={wpUsername} onChange={(e) => setWpUsername(e.target.value)} placeholder="admin" autoComplete="username" />
            <Input label="Application password" type="password" value={wpAppPassword} onChange={(e) => setWpAppPassword(e.target.value)}
              placeholder={connection.wordpressConfigured ? "Leave blank to keep the current one" : "xxxx xxxx xxxx xxxx"} autoComplete="new-password" />
          </div>
        </>
      )}

      {(method === "webflow" || method === "shopify" || method === "ghost") && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-5 text-text-3">
            {CMS_SETUP_STEPS[method].map((step) => <li key={step}>{step}</li>)}
          </ol>
          {method !== "webflow" && (
            <Input label={method === "shopify" ? "Store address" : "Ghost API URL"} value={cmsEndpoint} onChange={(e) => setCmsEndpoint(e.target.value)}
              placeholder={method === "shopify" ? "your-store.myshopify.com" : "https://yoursite.ghost.io"} />
          )}
          {method === "shopify" && (
            <Input label="Client ID" value={cmsClientId} onChange={(e) => setCmsClientId(e.target.value)} placeholder="Leave blank if you use an shpat_ access token" />
          )}
          <Input label={method === "shopify" ? "Client secret (or shpat_ access token)" : method === "webflow" ? "Site API token" : "Admin API key"} type="password"
            value={cmsSecret} onChange={(e) => setCmsSecret(e.target.value)} placeholder={connection.cmsSecretConfigured ? "Leave blank to keep the current one" : method === "ghost" ? "id:secret" : ""} autoComplete="new-password" />
          {method !== "ghost" && (
            <Input label={method === "shopify" ? "Blog handle" : "Blog collection slug"} value={cmsCollection} onChange={(e) => setCmsCollection(e.target.value)} placeholder={CMS_DEFAULT_COLLECTION[method] ?? ""} />
          )}
          <p className="text-[12px] text-text-3">Save checks the connection with {CMS_PLATFORM_LABELS[method]} (read-only) before anything is published.</p>
        </>
      )}

      {method === "webhook" && (
        <>
          <Input label="Webhook address" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://api.yoursite.com/pentra" inputMode="url" />
          <Input label="Signing secret (32+ characters)" type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={connection.webhookSecretConfigured ? "Leave blank to keep the current one" : ""} autoComplete="new-password" />
          <p className="text-[12px] leading-[18px] text-text-3">
            Pentra sends signed JSON (X-Pentra-Signature-256 is the HMAC-SHA256 of &quot;timestamp.body&quot; with your secret) for each page. Reply with the page&apos;s public https URL, or Pentra uses yoursite.com/blog/slug.
          </p>
        </>
      )}

      {error && <InlineError title="Not connected">{error}</InlineError>}
      {verified && !error && <p role="status" className="inline-flex items-center gap-1.5 text-[13px] text-named"><Check className="h-4 w-4" strokeWidth={1.5} />Checked: Pentra can publish here.</p>}
      <div className="flex flex-wrap gap-2">
        {!(method === "github" && !githubReady) && <Button type="submit" loading={busy === "save"} loadingLabel="Checking…">Save and check</Button>}
        {current === method && <Button variant="secondary" onClick={verify} loading={busy === "verify"} loadingLabel="Checking…" icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />}>Test connection</Button>}
      </div>
    </form>
  );
}

/** A record value with its own copy button beside it. */
function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-text">{value}</span>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); } }}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-control text-text-3 transition-colors duration-[var(--d-instant)] hover:bg-surface-2 hover:text-text">
        {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-named" strokeWidth={1.5} /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />}
      </button>
    </span>
  );
}

/** answers.<domain>: one CNAME record, then Pentra checks it every hour and publishes as soon as it's live. */
function HostedAddress({ overview }: { overview: Overview }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const now = useNow(60_000);
  const { site } = overview;
  const host = `answers.${site.domain}`;
  const publishing = site.publishing;
  const set = publishing?.target === "hosted" && publishing.hostedDomain === host;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.setHostedDomain({ siteId: site.siteId, domain: host });
      await retryWaiting(actions, site.siteId);
      toast(`Add the DNS record below. Pentra publishes to ${host} as soon as it's live.`, "success");
    } catch (e) {
      setError(userErrorMessage(e, `Pentra couldn't set up ${host}. Try again.`));
    } finally {
      setBusy(false);
    }
  };
  if (!set) {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-border p-4 sm:p-5">
        <p className="flex items-center gap-2 text-[14px] text-text"><Globe aria-hidden="true" className="h-4 w-4 text-text-3" strokeWidth={1.5} />{host}</p>
        <p className="text-[13px] leading-5 text-text-3">Pentra hosts your answer pages here, under your business&apos;s name. You add one DNS record where you manage your domain.</p>
        {error && <InlineError title="Not set up">{error}</InlineError>}
        <div><Button onClick={start} loading={busy} loadingLabel="Setting up…">Use {host}</Button></div>
      </div>
    );
  }
  const status = hostedStatusLabel(publishing?.hostedStatus);
  const live = publishing?.hostedStatus === "live";
  const steps = [
    { label: "Address chosen", state: "done" as const },
    { label: "DNS record found", state: live ? ("done" as const) : publishing?.hostedStatus === "error" ? ("failed" as const) : ("current" as const) },
    { label: "Pages live", state: live ? ("done" as const) : ("next" as const) },
  ];
  return (
    <div className="flex flex-col gap-4 rounded-card border border-border p-4 sm:p-5">
      <ol aria-label="Hosted address setup" className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center gap-2" aria-current={step.state === "current" ? "step" : undefined}>
            {i > 0 && <span aria-hidden="true" className="h-px w-5 bg-border-strong" />}
            <span className={cx("inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
              step.state === "done" ? "bg-named-tint text-named" : step.state === "current" ? "bg-you-tint text-you" : step.state === "failed" ? "bg-wrong-tint text-wrong" : "border border-border-strong text-text-4")}>
              {step.state === "done" ? <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2} /> : i + 1}
            </span>
            <span className={cx("text-[12px] font-medium", step.state === "next" ? "text-text-4" : "text-text-2")}>{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-text">{host}</span>
        <StatusPill kind={status.pill}>{status.label}</StatusPill>
        {publishing?.hostedCheckedAt && <span className="mono-label text-text-4">checked {timeAgo(publishing.hostedCheckedAt, now)}</span>}
      </div>
      {publishing?.hostedStatus === "live" ? (
        <p className="text-[13px] leading-5 text-text-2">Live. Pages publish to {host} and are sent to IndexNow the moment they&apos;re up.</p>
      ) : (
        <>
          <p className="text-[13px] leading-5 text-text-2">Add this record where you manage {site.domain}&apos;s DNS. Pentra checks every hour and publishes waiting pages as soon as it works.</p>
          <ScrollX className="rounded-control border border-border">
            <table className="w-full min-w-[460px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-border">{["Type", "Name", "Value", "Status"].map((h) => <th key={h} scope="col" className="mono-caps px-3 py-2 font-normal text-text-3">{h}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3 py-2.5 font-mono text-text">CNAME</td>
                  <td className="px-3 py-2"><CopyValue value="answers" label="the record name" /></td>
                  <td className="px-3 py-2"><CopyValue value="cname.vercel-dns.com" label="the record value" /></td>
                  <td className="px-3 py-2"><StatusPill kind={status.pill}>{publishing?.hostedStatus === "error" ? "Not attached" : "Not found yet"}</StatusPill></td>
                </tr>
              </tbody>
            </table>
          </ScrollX>
          {publishing?.hostedError && <p className="text-[13px] leading-5 text-text-3">Last check: {publishing.hostedError}</p>}
          <p className="text-[12px] leading-[18px] text-text-4">Keep the record once it works: removing it takes the hosted pages offline.</p>
          {publishing?.hostedStatus === "error" && <InlineError title={`${host} needs attention`}>{publishing.hostedError ?? "Pentra couldn't attach the address."} Email us if it doesn&apos;t clear within an hour.</InlineError>}
        </>
      )}
    </div>
  );
}

/* ─── Preferences ──────────────────────────────────────────────────────── */

function Toggle({ checked, onChange, label, description, disabled, busy }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: ReactNode; disabled?: boolean; busy?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-text">{label}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-text-3">{description}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled || busy} onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-[var(--d-state)] disabled:opacity-40",
          checked ? "border-transparent bg-action" : "border-border-strong bg-surface-3")}>
        <span className={cx("inline-block h-3.5 w-3.5 rounded-full transition-[translate] duration-[var(--d-state)] ease-out", checked ? "translate-x-[18px] bg-on-action" : "translate-x-[3px] bg-text-3")} />
      </button>
    </div>
  );
}

function Preferences({ overview }: { overview: Overview }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const plan = overview.access !== "free";
  const lastRun = overview.runs[0] ?? null;
  const set = async (key: "autopublish" | "weeklyEmail", value: boolean) => {
    setBusy(key);
    try {
      await actions.setPreferences({ siteId: overview.site.siteId, [key]: value });
      toast("Saved.", "success");
    } catch (e) {
      toast(userErrorMessage(e, "Pentra couldn't save this setting."), "error");
    } finally {
      setBusy(null);
    }
  };
  const runNow = async () => {
    setBusy("run");
    setRunError(null);
    try {
      await actions.runNow({ siteId: overview.site.siteId });
      toast("Asking every question again. Counts update when the run finishes.", "success");
    } catch (e) {
      setRunError(userErrorMessage(e, "Pentra couldn't start a run."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel id="preferences" title="Publishing and reports" description={plan ? undefined : "These start with the plan."}>
      <div className="flex flex-col divide-y divide-border">
        <Toggle checked={overview.site.autopublish} onChange={(v) => set("autopublish", v)} disabled={!plan} busy={busy === "autopublish"} label="Autopublish"
          description="Publish each page as soon as it's written and checked. Off: pages wait in Drafts for you to publish." />
        <Toggle checked={overview.site.weeklyEmail} onChange={(v) => set("weeklyEmail", v)} disabled={!plan} busy={busy === "weeklyEmail"} label="Weekly email"
          description="What was asked, who was named, what was published and what changed, every week." />
        <div className="flex flex-col gap-3 py-4 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-text">Ask the assistants again</p>
            <p className="mt-0.5 text-[13px] leading-5 text-text-3">
              Pentra asks every question weekly. You can ask now, at most every six hours.{lastRun ? ` Last run started ${shortStamp(lastRun.createdAt)}.` : ""}
            </p>
            {runError && <p role="alert" className="mt-1.5 text-[13px] leading-5 text-wrong">{runError}</p>}
          </div>
          <Button variant="secondary" onClick={runNow} disabled={!plan} loading={busy === "run"} loadingLabel="Starting…" icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />}>Ask now</Button>
        </div>
      </div>
    </Panel>
  );
}
