"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { StartFlow, type StartAuth } from "@/components/answers/onboarding/start-flow";
import { AnswersMain, AnswersSidebar } from "@/components/answers/dashboard/answers-sidebar";
import { AnswersScreen } from "@/components/answers/dashboard/frame";
import { AnswersOverview } from "@/components/answers/dashboard/overview";
import { AnswersQuestions } from "@/components/answers/dashboard/questions";
import { AnswersPages, AnswersPageScreen } from "@/components/answers/dashboard/pages";
import { AnswersCitations } from "@/components/answers/dashboard/citations";
import { AnswersCompetitors } from "@/components/answers/dashboard/competitors";
import { AnswersSettings } from "@/components/answers/dashboard/settings";
import { AnswersBilling } from "@/components/answers/dashboard/billing";
import { SwitchToAnswersCard } from "@/components/answers/dashboard/switch-card";
import { BillingPreview } from "@/components/billing/billing-preview";
import { AnswersBackendProvider, useAnswersQuery, type AnswersBackend, type QueryMap, type QueryName } from "@/lib/answers/backend";
import { createSyntheticStore, HARNESS_SCENARIOS, type HarnessOptions, type HarnessScenario, type SyntheticStore } from "@/lib/answers/synthetic";
import { SYN_LEGACY_SITE_ID, SYN_SITE_ID, SYNTHETIC_NOW } from "@/lib/answers/synthetic-data";
import type { AnswersAccess } from "@/lib/answers/types";

/*
 * DEV-ONLY HARNESS. Renders the real onboarding and dashboard components against SYNTHETIC data shaped exactly like
 * ops/design/answers-api.md, so they can be screenshotted and clicked through without a signed-in session. The route
 * returns 404 in production (layout.tsx) and on every host but the local acceptance port (src/proxy.ts).
 *
 * The first path segment is the configuration: `<scenario>~<access>[~loading|~error|~live|~legacy|~signed-out]`,
 * e.g. /e2e-acceptance/answers/dashboard~paid/dashboard/questions. In-app links keep it (backend.base).
 */

export type HarnessConfig = HarnessOptions & { legacy: boolean; auth: StartAuth; base: string };

export function parseConfig(raw: string): HarnessConfig {
  const parts = decodeURIComponent(raw).split("~");
  const scenario = (HARNESS_SCENARIOS as readonly string[]).includes(parts[0] ?? "") ? (parts[0] as HarnessScenario) : "dashboard";
  const access = (["owner", "paid", "free"] as const).find((a) => parts.includes(a)) ?? (scenario === "dashboard" || scenario === "new-plan" ? "paid" : "free");
  return {
    scenario, access: access as AnswersAccess,
    state: parts.includes("loading") ? "loading" : parts.includes("error") ? "error" : "ready",
    live: parts.includes("live"), legacy: parts.includes("legacy"),
    auth: parts.includes("signed-out") ? "signed-out" : parts.includes("auth-loading") ? "loading" : "signed-in",
    base: `/e2e-acceptance/answers/${raw}`,
  };
}

const StoreContext = createContext<SyntheticStore | null>(null);
const ConfigContext = createContext<HarnessConfig | null>(null);

function useHarnessBackend(store: SyntheticStore, config: HarnessConfig): AnswersBackend {
  return useMemo<AnswersBackend>(() => {
    const started = Date.now();
    const live = config.live;
    return {
      base: config.base,
      synthetic: true,
      useQuery<K extends QueryName>(name: K, args: QueryMap[K][0] | "skip") {
        const key = JSON.stringify(args);
        return useSyncExternalStore(
          store.subscribe,
          () => store.get(name, key === '"skip"' ? "skip" : (JSON.parse(key) as QueryMap[K][0])),
          () => store.get(name, key === '"skip"' ? "skip" : (JSON.parse(key) as QueryMap[K][0])),
        );
      },
      useActions: () => store.actions,
      useNow(intervalMs: number) {
        const [now, setNow] = useState(SYNTHETIC_NOW);
        useEffect(() => {
          if (!live) return;
          const id = window.setInterval(() => setNow(SYNTHETIC_NOW + (Date.now() - started)), Math.min(intervalMs, 1000));
          return () => window.clearInterval(id);
        }, [intervalMs]);
        return now;
      },
    };
  }, [store, config.base, config.live]);
}

export function HarnessProvider({ rawConfig, children }: { rawConfig: string; children: ReactNode }) {
  const config = useMemo(() => parseConfig(rawConfig), [rawConfig]);
  const store = useMemo(() => createSyntheticStore(config), [config]);
  useEffect(() => () => store.dispose(), [store]);
  const backend = useHarnessBackend(store, config);
  return (
    <ConfigContext.Provider value={config}>
      <StoreContext.Provider value={store}>
        <AnswersBackendProvider backend={backend}>
          <ToastProvider>{children}</ToastProvider>
        </AnswersBackendProvider>
      </StoreContext.Provider>
    </ConfigContext.Provider>
  );
}

function useConfig(): HarnessConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("Harness config missing");
  return config;
}

/** Stands in for Clerk's account menu, and labels every harness screen as synthetic. */
function HarnessAccount() {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="h-7 w-7 rounded-full bg-surface-3" />
      <span className="font-mono text-[10px] uppercase leading-[14px] tracking-[0.08em] text-text-4">Dev harness<br />synthetic data</span>
    </span>
  );
}

export function HarnessScreen({ screen }: { screen: string[] }) {
  const config = useConfig();
  const [first, second, third] = screen;
  if (first === "start" || !first) return <StartFlow auth={config.auth} account={<HarnessAccount />} />;
  return <DashboardShell>{dashboardScreen(second, third, config)}</DashboardShell>;
}

function dashboardScreen(section: string | undefined, id: string | undefined, config: HarnessConfig): ReactNode {
  const siteId = SYN_SITE_ID;
  if (config.legacy && !section) return <LegacyPlaceholder />;
  const wrap = (node: ReactNode) => <AnswersScreen siteId={siteId} domain="kettlewooddecks.com">{node}</AnswersScreen>;
  switch (section) {
    case undefined: return wrap(<AnswersOverview siteId={siteId} />);
    case "questions": return wrap(<AnswersQuestions siteId={siteId} />);
    case "pages": return wrap(id ? <AnswersPageScreen siteId={siteId} pageId={decodeURIComponent(id)} /> : <AnswersPages siteId={siteId} />);
    case "citations": return wrap(<AnswersCitations siteId={siteId} />);
    case "competitors": return wrap(<AnswersCompetitors siteId={siteId} />);
    case "settings": return wrap(<AnswersSettings siteId={siteId} />);
    case "billing": case "upgrade": return wrap(<AnswersBilling siteId={siteId} checkout={<BillingPreview plan={config.access === "paid" ? "pentra" : "free"} />} />);
    default: return <p className="text-text-3">Unknown harness screen.</p>;
  }
}

function LegacyPlaceholder() {
  return (
    <div className="flex flex-col gap-6">
      <SwitchToAnswersCard site={{ _id: SYN_LEGACY_SITE_ID, domain: "oakhollowirrigation.com", siteName: "Oak Hollow Irrigation" }} />
      <div className="rounded-card border border-dashed border-border-strong px-6 py-16 text-center text-[14px] text-text-3">
        The articles dashboard renders here in the app, unchanged. The harness shows only the switch card above it.
      </div>
    </div>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  const config = useConfig();
  const pathname = usePathname();
  const router = useRouter();
  const sites = useAnswersQuery("mySites", {});
  const activeSiteId = config.legacy ? SYN_LEGACY_SITE_ID : SYN_SITE_ID;
  return (
    <div className="min-h-dvh bg-bg">
      <AnswersSidebar
        sites={sites ?? []}
        activeSiteId={activeSiteId}
        onSelectSite={(id) => router.push(`/e2e-acceptance/answers/${id === SYN_LEGACY_SITE_ID ? `dashboard~${config.access}~legacy` : `dashboard~${config.access}`}/dashboard`)}
        pathname={pathname}
        account={<HarnessAccount />}
      />
      <AnswersMain>{children}</AnswersMain>
    </div>
  );
}
