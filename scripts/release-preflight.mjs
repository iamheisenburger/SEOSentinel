// Read-only release evidence, deliberately limited to the two authorized sites.
// Never forwards raw CLI output, site documents, provider payloads or credentials.
import { spawnSync } from 'node:child_process';
const sites = [
  { name: 'Pentra', id: 'jh74txye54jna4t85m6y7p4d6h82v9ab' },
  { name: 'LeadPilot', id: 'jh7cccny67df67rdm4jp65tmtn8am982' },
];
const includeContentPreflight = process.argv.includes('--released');
const cli = `process.stdout._handle?.setBlocking(true); process.argv=['node','convex',...process.argv.slice(1)]; await import('./node_modules/convex/bin/main.js');`;
function query(name, args) {
  const p = spawnSync(process.execPath, ['--input-type=module', '-e', cli, 'run', name, JSON.stringify(args), '--prod'], {
    env: { ...process.env, CONVEX_DEPLOYMENT: 'prod:wary-starfish-773' }, encoding: 'utf8', timeout: 60_000, maxBuffer: 8_000_000,
  });
  if (p.status !== 0) throw new Error(`Read-only ${name} failed (exit ${p.status}); raw output withheld`);
  try { return JSON.parse(p.stdout); } catch { throw new Error(`Read-only ${name} returned incomplete JSON; raw output withheld`); }
}
for (const site of sites) {
  const operator = query('autopilot:getOperatorSnapshot', { siteId: site.id, ...(includeContentPreflight ? { includeContentPreflight: true } : {}) });
  if (operator.site.siteId !== site.id) throw new Error('Exact-site projection mismatch');
  const budget = query('providerBudget:getSiteReservationAudit', { siteId: site.id, comparisonSiteId: sites.find(s => s.id !== site.id).id });
  if (budget.siteId !== site.id) throw new Error('Exact budget scope mismatch');
  const { rows, ...totals } = budget;
  const byState = {};
  for (const r of rows) {
    const key = r.accountingState + ':' + r.sources.map(s => s.status).join(',');
    const group = byState[key] ??= { count: 0, consumedMicroUsd: 0 };
    group.count++; group.consumedMicroUsd += r.consumedMicroUsd;
  }
  console.log(JSON.stringify({ name: site.name, siteId: site.id, operator, budget: { ...totals, byState,
    orphanReservations: rows.filter(r => r.accountingState !== 'released' && r.sources.length === 0).length,
    duplicateSourceBindings: rows.filter(r => r.sources.length > 1).length,
    sourceAmountMismatches: rows.filter(r => r.sources.some(s => !s.reservationAmountMatches)).length,
    retainedExpiredLeases: rows.filter(r => r.accountingState === 'retained_ceiling' && r.sources.some(s => s.leaseExpired)).length,
  } }));
}
