/** P403: the businesses the AI recommends, as the dashboard counts them. Pure. */

/** One business under its spellings ("Apollo", "Apollo.io", "apollo"), matching how the server counts it. */
export const businessKey = (name: string) => name.toLowerCase().replace(/\.(com|io|ai|co|app|net|org)$/, "").replace(/[^a-z0-9]/g, "");

type LoggedAnswer = { assistant: string; status: string; named: boolean; businessesNamed?: readonly string[] | null; competitorsNamed: readonly string[] };
export type RecommendedRow = { name: string; you: boolean; tracked: boolean; total: number; byAssistant: Record<string, number> };

/** You and every business the answers recommend (not only the confirmed competitors, so a site whose setup found none
 * still sees who wins), counted per assistant, most-named first: the twelve most-named plus every tracked one. */
export function recommendedRows(log: readonly LoggedAnswer[], businessName: string, competitors: ReadonlyArray<{ name: string }>, assistants: readonly string[]): RecommendedRow[] {
  const answered = log.filter((c) => c.status === "answered");
  const youKey = businessKey(businessName);
  const display = new Map<string, string>();
  const named = answered.map((c) => {
    const keys = new Set<string>();
    for (const name of [...(c.businessesNamed ?? []), ...c.competitorsNamed]) {
      const key = businessKey(name);
      if (!key || key === youKey) continue;
      if (!display.has(key)) display.set(key, name);
      keys.add(key);
    }
    return { c, keys };
  });
  const counts = new Map<string, number>();
  for (const { keys } of named) for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const tracked = new Set(competitors.map((c) => businessKey(c.name)));
  for (const c of competitors) if (!display.has(businessKey(c.name))) display.set(businessKey(c.name), c.name);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([k]) => k);
  const perAssistant = (test: (c: LoggedAnswer, keys: Set<string>) => boolean) =>
    Object.fromEntries(assistants.map((a) => [a, named.filter(({ c, keys }) => c.assistant === a && test(c, keys)).length]));
  const rows: RecommendedRow[] = [
    { name: businessName, you: true, tracked: false, total: answered.filter((c) => c.named).length, byAssistant: perAssistant((c) => c.named) },
    ...[...new Set([...tracked, ...top])].map((k) => ({ name: display.get(k) ?? k, you: false, tracked: tracked.has(k), total: counts.get(k) ?? 0,
      byAssistant: perAssistant((_, keys) => keys.has(k)) })),
  ];
  return rows.sort((a, b) => b.total - a.total || Number(b.you) - Number(a.you));
}
