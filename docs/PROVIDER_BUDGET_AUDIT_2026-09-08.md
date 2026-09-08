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
