import Link from "next/link";
import { notFound } from "next/navigation";

/** Dev-only index of the Answers harness: every onboarding state and dashboard screen with synthetic data. */
const LINKS: [string, string][] = [
  ["Start · signed out, no domain", "reading~free~signed-out/start"],
  ["Start · signed out, with domain", "reading~free~signed-out/start?domain=kettlewooddecks.com"],
  ["Start · creating the site", "reading~free/start?domain=kettlewooddecks.com"],
  ["Start · one site per account", "reading~free/start?domain=another-business.com"],
  ["Start · reading the site", "reading~free/start?site=site_kettlewood"],
  ["Start · here's what we understood", "understood~free/start?site=site_kettlewood"],
  ["Start · read failed", "read-error~free/start?site=site_kettlewood"],
  ["Start · first hour (62 of 150)", "first-hour~free/start?site=site_kettlewood"],
  ["Start · first hour, played live", "understood~free~live/start?site=site_kettlewood"],
  ["Start · setup error", "setup-error~free/start?site=site_kettlewood"],
  ["Start · run stopped", "run-failed~free/start?site=site_kettlewood"],
  ["Start · snapshot, pages being written", "results~free/start?site=site_kettlewood"],
  ["Start · snapshot", "drafts~free/start?site=site_kettlewood"],
  ["Start · drafts", "drafts~free/start?site=site_kettlewood&view=drafts"],
  ["Start · a draft", "drafts~free/start?site=site_kettlewood&page=p_19_v1"],
  ["Dashboard · overview", "dashboard~paid/dashboard"],
  ["Dashboard · overview (free)", "drafts~free/dashboard"],
  ["Dashboard · just upgraded", "new-plan~paid/dashboard?upgraded=1"],
  ["Dashboard · loading", "dashboard~paid~loading/dashboard"],
  ["Dashboard · error", "dashboard~paid~error/dashboard"],
  ["Dashboard · articles site", "dashboard~paid~legacy/dashboard"],
  ["Questions", "dashboard~paid/dashboard/questions"],
  ["Answer pages", "dashboard~paid/dashboard/pages"],
  ["Answer pages · drafts", "dashboard~paid/dashboard/pages?tab=drafts"],
  ["Answer page · published", "dashboard~paid/dashboard/pages/p_0_v1"],
  ["Answer page · publish failed", "dashboard~paid/dashboard/pages/p_5_v1"],
  ["Citations", "dashboard~paid/dashboard/citations"],
  ["Citations · empty", "new-plan~paid/dashboard/citations"],
  ["Competitors", "dashboard~paid/dashboard/competitors"],
  ["Settings", "dashboard~paid/dashboard/settings"],
  ["Settings · nothing connected", "new-plan~paid/dashboard/settings"],
  ["Billing · free", "drafts~free/dashboard/billing"],
  ["Billing · owner", "dashboard~owner/dashboard/billing"],
];

export default function HarnessIndex() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-[720px] px-6 py-12">
      <p className="mono-caps text-text-3">Dev harness · synthetic data</p>
      <h1 className="mt-2 text-[24px] font-semibold text-text">Pentra Answers screens</h1>
      <ul className="mt-6 divide-y divide-border rounded-card border border-border">
        {LINKS.map(([label, path]) => (
          <li key={path}><Link href={`/e2e-acceptance/answers/${path}`} className="flex justify-between gap-4 px-4 py-2.5 text-[14px] text-text-2 hover:bg-surface-2 hover:text-text">
            <span>{label}</span><span className="truncate font-mono text-[11px] text-text-4">{path}</span>
          </Link></li>
        ))}
      </ul>
    </main>
  );
}
