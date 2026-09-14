# Pentra SLC release preflight31

Assignment `supervisor-20260914-slc-release-preflight-31`. Release the reviewed
application based on `09ee2bb5961b58bd3ed7832d848c78739088d6e2`, preserving
production publication commit `a66a085f909ca5bdb314eed05a99dcb2aa4ed12e`.
No tenant migration, activation, paid provider call or financial change is part
of this application release. The USD20 total additional validation allowance
remains inactive and unspent; the separate USD4 approval and all other caps stay.

## Small release corrections

The genuine authenticated acceptance test opens the real funding disclosure,
asserts its content and checks the exact authorized website route and displayed
site binding. It does not add mock authentication or broaden either skip.
WordPress onboarding and both publishing forms now link to installation steps
for the existing connector. No new integration or hosting migration was added.

The existing internal operator snapshot has an optional exact-site preflight
projection: business profile presence, publisher readiness, unchanged schedule,
measurement connection metadata and bounded unresolved revisions. It returns no
credentials and makes no provider call. Its regression checks another synthetic
tenant is absent. `scripts/release-preflight.mjs` can query only the two approved
production site IDs, suppresses raw failures and aggregates the reservation audit.

## Safe production observation before release

Observed 2026-09-14 16:16:02–16:16:07 UTC. These are current production receipts,
not synthetic acceptance. Other tenants and account/fleet ledger rows were not
inspected; combined site totals are a lower bound on account consumption and
computed headroom is an upper bound, not authority to spend.

| Exact website | Usable buffer / target | Last recorded publication UTC | Unchanged missed deadline UTC | Monthly consumption |
| --- | --- | --- | --- | --- |
| pentra.dev | 0 / 4 | 2026-09-12 10:24:14.649 | 2026-09-13 10:24:14.649 | $13.686640 |
| leadpilot.chat | 0 / 12 | 2026-09-07 22:15:34.409 | 2026-09-08 06:15:34.409 | $17.355920 |

Both latest natural runs ended `planning_blocked`; both current backfill paths
have zero eligible candidates. Neither fresh replenishment nor launch acceptance
is established. Publication timestamps are stored health receipts, not a new
verification of the live article during this preflight.

| Accounting component | Pentra | LeadPilot | Combined authorized sites |
| --- | --- | --- | --- |
| Verified settled actual cost | $1.436640 | $1.555920 | $2.992560 |
| Conservatively settled execution ceiling | $5.000000 | $7.000000 | $12.000000 |
| Outstanding retained ceiling | $7.250000 | $8.800000 | $16.050000 |
| Total counted once | $13.686640 | $17.355920 | $31.042560 |
| Separate $4 approval-window consumption | $2.060960 | $1.060480 | $3.121440 |

The account base is $28, current approved monthly ceiling $32; the independent
fleet ceiling is $35. Thus monthly headroom is at most $0.957440 and remaining
old approval headroom at most $0.878560. Reset/old-approval expiry is exactly
2026-10-01 00:00:00 UTC (2026-09-30 17:00:00 PDT). The shared reservation guard
returns `provider_account_monthly_budget_reserved`; its earlier
`approved_incremental_window` branch rejects requests above the separate old
approval remainder, before account-month and fleet checks. An article's complete
ceiling must fit atomically, not just a single low-cost call.

Both bounded audits are complete and report zero orphan nonreleased reservations,
duplicate source bindings, source amount mismatches, invalid settlements or
retained expired active leases. Completed/failed source jobs do retain ceilings
where provider cost is unresolved; terminal status alone does not prove no spend.
Settlement replaces a reservation's consumption rather than adding spend twice.
No reservation was removed or attempt reset. Actual provider credit balance was
not queried and remains unverified; the internal rejection does not establish
provider credit exhaustion.

Production `PENTRA_CONTENT_WORK_PRICING` is absent. It is left absent. The existing
month/account keyed authorization cannot express an independent cumulative $20
run across UTC rollover. Any smallest repair to that existing path must be a
separate local review candidate, not deployed or activated in this release.

## Release and authentication receipts

Final local application gates: 1643 repository tests,1642 passed,0 failed,
1 existing sibling-consumer skip (104.193961834s);26 browser tests,24 passed,
2 genuine authenticated skips (7.3s); production build/typecheck pass (31 routes);
changed-file lint clean, preceding full lint0 errors/157 existing warnings;
additive schema61 tables/295 indexes; dependency audit0 vulnerabilities;
677-file tracked/staged secret scan and staged whitespace pass. A preflight
status-literal inference type error was caught and corrected before this pass.

The final handoff will record the exact application commit, additive Convex
deployment, GitHub CI and Vercel production alias evidence. Local gates and
genuine owner acceptance are reported separately; skipped authentication is not
a pass. The existing Google account chooser awaits the owner's exact selection;
one action request was issued without guessing identity or changing credentials.
No all-user acceptance, paid live cycle, monetisation or attributable SEO result
is claimed by this release preflight.
