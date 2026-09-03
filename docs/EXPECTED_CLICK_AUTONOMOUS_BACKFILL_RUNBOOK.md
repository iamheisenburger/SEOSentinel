# Autonomous expected-click inventory backfill

This fleet advances the existing exact-demand and SERP/authority evidence
migrations for every explicitly enabled tenant. It does not discover topics,
call a model, generate or publish articles, change cadence, or add a provider
spend path.

## Schedule and order

- `expected-click-backfill-fleet` runs daily at **13:15 UTC**, after the 12:30
  UTC GSC sync and before the 13:30 UTC SEO growth scan.
- A deterministic five-minute daily jitter rotates tenant reservation order
  across every paginated page when the shared ledger is constrained.
- Each tenant runs exact demand first. A job stamped `autonomous_fleet` chains
  evidence only after demand is durably completed. A proven no-demand tenant
  may enter evidence directly.
- Operator canaries are stamped `operator_canary` and never auto-chain.
- `expected-click-backfill-recovery` runs hourly. It schedules only stale,
  unambiguous fleet-origin jobs and never creates a new reservation. Live
  leases, operator jobs, changed rollout epochs, ambiguous calls, and expired
  reservations with provider work remaining fail closed. Recovered demand
  explicitly suppresses its evidence continuation; the next ordinary daily
  fleet pass may start evidence only after the atomic prerequisite passes.
- Both paginated dispatchers checkpoint the exact current cursor in
  `expected_click_fleet_dispatch_runs` before scheduling their continuation.
  If that scheduling call fails or the action crashes, the hourly sweep
  resumes the stored page. Duplicate page execution is harmless because only
  one OCC cursor advancement wins and tenant queue mutations remain
  one-batch/day idempotent. Completed global cursor receipts are pruned after
  14 days in bounded batches; they contain no tenant credentials or provider
  response data.

## Tenant and replay fences

The fleet page contains only non-deleting sites with a user, autopilot enabled,
`expectedClickSchedulingEnabled === true`, and rollout mode `warm` or `live`.
The site action re-reads those fields immediately before every stage. Existing
atomic `by_site_day` checks still enforce at most one new demand job and one new
evidence job per site per UTC day.

The queue mutations also hold the cross-phase lock: demand refuses any same-day
evidence phase, while evidence requires no unresolved fleet job, a completed
same-day fleet demand receipt (or an atomic proof that no demand candidates
remain), and zero remaining demand candidates before reserving provider spend.

Recovery reads demand and evidence state together before invoking either
worker. Any ambiguous receipt blocks both phases, any live lease waits, and a
legacy coexistence state recovers exactly the oldest safe job. Demand and
evidence recovery are therefore never started concurrently.

Before each SERP HTTP call, Pentra stores a versioned topic/keyword/update-time
attempt receipt in the same transaction as the job attempt. A failed or
ambiguous request for that exact topic version cannot be purchased again in a
later daily job. Ambiguous historical evidence jobs block autonomous evidence
and emit an actionable operator log rather than being replayed.

## Spend ceiling

- Exact demand: at most 10 topics and one provider task, with a conservative
  reservation ceiling of **$0.10 per eligible site/day**.
- Evidence: at most 10 SERPs plus one bounded authority lookup, with a
  conservative reservation ceiling of **$0.10 per eligible site/day**.
- A site that needs both phases can therefore reserve at most **$0.20/day**.
- All tenants and provider features still share the existing **$2.60/day** and
  **$35/month** ledgers. No fleet action bypasses them. With no other provider
  reservations, the absolute daily envelope can fund at most twenty-five
  $0.10 phase reservations; daily jitter rotates priority rather than letting
  page order permanently starve later tenants.
- The hourly recovery sweep creates no reservation. Any remaining paid work
  is resumed only on the original reservation day; after that, recovery is
  permitted only when provider work is complete and persistence is all that
  remains.

These are reservation ceilings, not claims of actual provider charges. Inspect
aggregate tenant state with the internal status/readiness queries documented in
the demand and evidence runbooks. Never clear an ambiguous attempt marker or
manually copy a receipt without reconciling the provider billing record first.
