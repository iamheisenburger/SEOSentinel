# Provider budget audit — September 8, 2026

Scope: only Pentra (`jh74txye54jna4t85m6y7p4d6h82v9ab`) and LeadPilot
(`jh7cccny67df67rdm4jp65tmtn8am982`). The safe audit confirmed that they share
an owner account. No other site's records were queried or enumerated by the
operator audit. Account/fleet ledger enumeration is not an operator diagnostic.

## Exact rejection and baseline

`cadenceMicroSeed.reserveAndQueue` calls `reserveSharedProviderBudget`, which
resolves Enterprise from the canonical account entitlement and calls
`evaluateProviderAccountCapacity`. It refuses when monthly consumed capacity
plus the requested reservation exceeds $28. The scope is **owner account across
sites and features**, not one site, article quota, or the provider's cash wallet.
The fleet still has its independent $35/month and $9.85/day guards; the account
daily limit is $9.60. None of these limits changed.

At 13:11:38–40 UTC the complete permitted current-month windows contained 78
Pentra and 89 LeadPilot reservations, each linked to exactly one source job.
There were no invalid settlements, duplicate source references, unmatched
amounts, or orphan reservations in these windows.

| USD, September UTC window | Pentra | LeadPilot | Permitted combined |
| --- | ---: | ---: | ---: |
| Verified actual provider-cost settlements | 1.314720 | 1.435440 | 2.750160 |
| Settled first-execution ceilings, not measured cash | 5.000000 | 6.000000 | 11.000000 |
| Retained reservation ceilings | 5.350000 | 8.800000 | 14.150000 |
| Total charged against internal capacity | 11.664720 | 16.235440 | 27.900160 |
| Released original reservations, excluded above | 0 | 2.100000 | 2.100000 |

The two authorized sites alone left **at most $0.099840** of account monthly
headroom: a $0.10 primary reservation exceeded it by $0.000160. This is a
sufficient mathematical explanation of the rejection without reading other
sites. It is not a claim that the site's subtotal is the whole account ledger.
September resets **2026-10-01 00:00:00 UTC** (September 30, 17:00 PDT). Daily
capacity resets September 9, 00:00 UTC, but that does not clear a monthly denial.

The 12:21 controlled apply had passed the free DataForSEO balance preflight
before the internal atomic guard refused it. Current primary preflight checks
$0.40 (discovery $0.10 plus three $0.10 evidence envelopes). Thus that refusal
was not evidence of depleted provider credit. No cash balance was inferred from
internal reservation totals, and no paid discovery occurred for that refusal.

## Accounting defects reproduced

1. A terminal micro-seed before its paid boundary retained $0.10. Pentra's v11
   job `pd7e1fnmnjpraywedw6xghqp618dr9hy`, created September 4 at
   02:56:27.751 UTC, ended `missed` / `execution_fence_changed` at
   02:56:31.830, with both paid-call flags explicitly false and no paid receipt.
   Historical v11 source `d2a1851` commits the attempt flag/timestamp/tag before
   provider HTTP. The real terminal mutation failed a local regression because
   it closed the job but did not release unused capacity.
2. LeadPilot's September 4 plan `j9701h22cb85fga39p4mrsc7ks8drjt0` failed with
   a semantic-zero-yield receipt and a single-execution `empty` checkpoint.
   Contingency retirement accepted `terminal_blocked` but omitted the equally
   terminal, zero-candidate `empty` manifest. The local regression reproduced
   retention of the full legacy $2 envelope instead of preserving $1 for the
   spent first execution and retiring the unused second $1.

The generic repairs do not delete reservations, clear attempts, reopen jobs,
change policy versions, or relax quality. Pre-call release requires explicit
false flags, no attempted timestamps/tag/cost/results, a terminal closed job,
no remaining lease, matching ownership/purpose/version/day/amount, and no
settlement. Old or ambiguous contracts fail closed. Worker terminalization,
cancellation/day expiry, watchdog exhaustion and paginated normal recovery use
the same proof. Retrying reconciliation cannot reclaim the same money twice.

Empty-plan contingency retirement additionally requires exact ledger binding,
zero candidate/fingerprint/output arrays, no activation, a bounded completion
timestamp, one execution, and a terminal semantic failure. It retains the full
first-execution ceiling and fences future provider work via the settled receipt.
Normal exact-site cadence reconciliation checks these plan contingencies too.

## Reservations that must remain

The remaining completed demand/evidence jobs performed paid calls but do not
store exact monetary receipts: keep their ceilings rather than invent a refund.
Four micro-seed jobs have ambiguous paid responses ($0.35 combined); keep those
ceilings. New $1 single-execution plans have no second execution to retire.
Pentra's legacy One Setup $2 plan has no single-execution contract/checkpoint;
do not reinterpret it as a new $1 plan. No cancellation or expired active lease
was hidden in the complete audit windows. Expiry after paid work is not proof
of zero cost. Actual settlements replace original reservation amounts in the
capacity sum; they are not added on top.

## Deployment and acceptance

First repair `40083f66ec575cb69d76c5c0ee0a630cfd0c39a4` was pushed and deployed
to Convex `wary-starfish-773`. At **13:20:56.265 UTC**, production confirmed the
normal Pentra reconciliation examined 51 micro-seed receipts, released exactly
one $0.10 no-call reservation, and settled no monetary receipts. The original
reservation remains $0.10 with zero consumption; job status, attempts and
completion timestamp are unchanged. No provider call or new job was created
by this inspection.

Further deployment, admission and article-chain outcomes are recorded below.
Technical accounting verification is not article acceptance or attributable
SEO growth. LeadPilot remains overdue until a new quality-approved article is
actually published and fresh post-consumption replenishment is proven.

### Final release and paid verification

Second repair `2985b44dad237aa6f559b2d4a0ed2ad5c83787d1` passed GitHub quality
run **34231769293**; first repair passed **34231316181**. Convex production
deployment succeeded. GitHub/Vercel production deployment **6328639443** is
successful, with receipt URL
`https://seo-sentinel-fk73kngw4-arshads-projects-836ebfbd.vercel.app`.
Local final gates: **1,423 tests**, type-check, build, additive schema (60 tables,
291 indexes), tracked-source secret scan (598 files), dependency audit (zero
vulnerabilities), and 16 browser tests passed. Lint has zero errors and the same
157 existing warnings; two authenticated browser checks remain explicitly skipped.
Tests cover real mutation handlers, synthetic distinct tenants, historical v11
reconciliation, cancellation, expiry, invalid/mismatched proof, exact settlement,
idempotency, and concurrent closures/reservations under simulated serializable
transaction retries. This simulation is not a production concurrency load test.

The normal LeadPilot inspection retired exactly one unused $1 contingency.
Its subsequent ordinary primary admission at **13:25:10.392 UTC** succeeded.
The canonical admission receipt reported the actual account aggregate after
reserving $0.10: **$26.900160 consumed / $28 limit / $1.099840 headroom**. That
aggregate exactly matched the two authorized site subtotals at admission; no
other site's records were inspected to obtain it. The new job independently
passed the free **$0.40** DataForSEO funding check at 13:25:10.385 UTC.

| Site / v37 attempt | Exact start–finish UTC, September 8 | Job | Actual provider cost | Candidate result |
| --- | --- | --- | ---: | --- |
| LeadPilot primary | 13:25:10.392–13:25:11.202 | `pd740ygx22j3850sc8wb9f1vzn8e0qy4` | $0.012000 | received 0, accepted 0 |
| LeadPilot fallback | 13:26:01.030–13:26:17.089 | `pd72gkx5mwr7b6s16yaskxad6n8e0cb1` | $0.048000 | received 300, accepted 0 |
| Pentra primary | 13:26:10.528–13:26:11.777 | `pd782r8bmavn45zhgtfspbsyv98e1p7c` | $0.012960 | received 8, accepted 0 |
| Pentra fallback | 13:27:11.712–13:27:16.840 | `pd7et9ewzk9qy03r5qtxrjn2an8e0970` | $0.048000 | received 300, accepted 0 |

All four finished `no_strict_candidate` and settled their original $0.10 ceilings
to actual cost, **$0.120960 total**. No evidence job, article-generation job or
quality approval resulted. LeadPilot's fallback rejected 101 invalid metrics,
47 difficulty failures, 3 brands, 137 business-fit failures, 3 duplicates and 9
overlaps. Pentra's primary rejected 2 invalid metrics, 1 difficulty failure and
5 overlaps; its fallback rejected 75 invalid metrics, 165 difficulty failures,
2 brands, 43 business-fit failures, 1 duplicate and 14 overlaps. Gates were not
weakened and these attempts must not be replayed.

One normal LeadPilot scheduler follow-up (`kd79bmpr867rn2p3fz48pc1dfs8e1b00`)
admitted new single-execution plan `j97f61bthmsffykjztccrs4t9h8e0m0x` at
**13:27:37.322**. It failed at **13:28:07.971**, `strict_zero_yield`, execution
one / workerAttempts zero, no saved topic and no checkpoint. Its $1 spent
execution ceiling remains valid. It is not an exact billed-cost receipt.
The normal reconsideration receipt is **2026-09-09 13:27:38.322 UTC**; the
separate scheduled refill check is **2026-09-08 13:42:37.322 UTC**. Neither
timestamp promises that a monthly budget or fresh-topic blocker will clear.

### State at 13:29–13:32 UTC

| USD capacity | Pentra | LeadPilot | Permitted combined |
| --- | ---: | ---: | ---: |
| Verified actual settlements | 1.375680 | 1.495440 | 2.871120 |
| Settled spent-execution ceilings | 5.000000 | 7.000000 | 12.000000 |
| Retained ceilings, exact cost unavailable | 5.250000 | 7.800000 | 13.050000 |
| Total internal consumption | 11.625680 | 16.295440 | **27.921120** |

No active provider/article jobs remained in the permitted snapshots. All retained
amounts are historical ceilings, not pending-job claims or proof of actual cash
spend. Monthly account headroom is now **at most $0.078880**, below a $0.10
micro-seed or $1 plan reservation. This later scoped subtotal does not assert
that no other account-owned row could have changed after the canonical admission
snapshot. The reset remains **October 1, 00:00:00 UTC**.

Final normal inspections on both sites reclaimed/settled **zero**, made zero
provider calls/reservations, and reported **`source_plan_fallback_already_attempted`**.
Thus a budget increase alone does not make the exhausted source attempts replayable.
No further paid apply was issued merely to obtain another predictable denial.

- Pentra: **2 ready / minimum 3 / target 4**. Last new article published September
  8 at **12:00:27.426 UTC**, against **12:00:19.580** (7.846 seconds late), and
  was live-verified at **12:00:29.554**. HTTP 200, exact canonical and H1 were
  reverified at this audit's close for
  `https://pentra.dev/blog/intelligent-content-automation`. Next publication
  deadline: **September 9, 12:00:27.426 UTC**. That article came from existing
  inventory; the consumed buffer has not replenished.
- LeadPilot: **0 ready / minimum 9 / target 12**. Last publication remains
  **September 7, 22:15:34.409 UTC**. The **September 8, 06:15:34.409 UTC**
  deadline remains missed. No new article, fresh quality approval or live
  artifact emerged from this verification.

### Approval required before further funded testing

Proposed September-only increase for this shared owner account: **$28 → $32
(+$4)**, reverting at **October 1, 00:00 UTC**. Preserve the $35 fleet ceiling,
daily guards, all other accounts' limits, attempt fences and quality rules.
Implement any approved override through generic account/window configuration,
not hard-coded tenant logic or a global Enterprise-tier increase.

The incremental discovery/planning/evidence test envelope is **at most $4**:
up to three normally eligible $1 single-execution plans, four normally eligible
$0.10 discovery attempts and six $0.10 evidence attempts. Receipt-backed
actual cost may be lower (the four completed micro-seed calls above cost
$0.120960). Article-generation token/image charges are not recorded in this
ledger, so $4 is **not** an all-provider cash-cost estimate; existing article
quotas and execution bounds would still apply.

The expenditure would test fresh topic admission, generation and unchanged
quality approval, scheduled new-article publication/live verification on both
sites, then another fresh buffer refill after consumption. It funds bounded
attempts, not guaranteed candidate yield or acceptance. It does not authorize
replaying the exhausted v37 sources or accelerating either tenant's cadence.
Stop at the approved envelope or a new hard blocker and report the result.
No limit has been raised; no further paid testing has been scheduled by the
operator. Product-owned schedules remain unchanged. No backlinks work or
attributable SEO-growth claim is part of this audit.
