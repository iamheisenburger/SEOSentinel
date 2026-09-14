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

First deployment attempt stopped at local bundling before upload: the existing
WordPress conditional helper imported Node DNS/HTTPS without a `use node`
declaration. The helper is used exclusively by Node actions; adding that marker
preserves behavior and prevents isolate bundling. A new offline regression
bundles every isolate entry using browser resolution (1 passed,238.552042ms).
No production state changed in that failed attempt.

Application release: `b3994e0a5a10a24189a7fc767f11b8c3dbb1240a`, including
merge/preflight `7906ecb6684028ed20a0b200087b454fa8c0494d`. Convex deployment
to `wary-starfish-773` succeeded before2026-09-14 16:22:48 UTC. It added only
`jobs.by_site_content_deadline` and `jobs.by_site_content_stage` indexes and
reported no index deletion; schema validation/typecheck passed. The exact clean
application commit was pushed fast-forward to main, preserving the new article.

GitHub deployment6441514701 reports Production success at16:23:44 UTC for that
exact SHA. The signed-in Vercel deployment page independently shows Ready,
Production, Current Domains `pentra.dev`, source main/b3994e0 and completion
2026-09-14 09:23:40 PDT. Deployment:
https://vercel.com/arshads-projects-836ebfbd/seo-sentinel/HVVWUgjavVUZaFUpxhaoyBaVAVAQ
URL: https://seo-sentinel-q6vpu6u83-arshads-projects-836ebfbd.vercel.app
CI: https://github.com/iamheisenburger/SEOSentinel/actions/runs/34868247839

That exact CI run completed successfully2026-09-14 16:29:19 UTC:1644 tests,
1643 passed,0 failed,1 existing sibling-consumer skip (189.081242463s);
types/lint/schema/secrets678/audit/build all pass; public/component browser24
passed,2 genuine authenticated skips (39.8s). OSV fallback was not needed because
the primary dependency audit succeeded. CI authenticates no production customer.

Actual production public desktop/mobile smoke:8 passed,2 genuine authenticated
skips,4.0s. An initial12-test invocation incorrectly included the local synthetic
One Setup harness; its two production requests correctly returned404, as the
existing proxy explicitly requires. The repeat selected real public routes only;
no test or authentication skip was weakened and the harness remains unavailable
in production. Local synthetic One Setup coverage still passes on both sizes.

Post-deployment exact-site projections at16:22:58–16:23:04 UTC confirm:
both remain `legacy_articles`, profile present, no content schedule, no held
publication lease, no unresolved revision in the complete bounded inventory.
Pentra's current publisher receipt verifies; LeadPilot's does not, despite an
otherwise complete legacy GitHub configuration. LeadPilot needs exact owner
connection verification before growth-first selection. GSC is connected to each
exact domain, data through2026-09-11, last synced2026-09-14 12:30:12.883 UTC and
12:30:18.952 UTC respectively. Financial totals, empty buffers, missed deadlines
and planning blockers are unchanged. The companion JSON retains safe projections.

The existing Chrome Google account chooser still awaits the owner's selection
for Pentra. One action request was issued; no identity guessed, credential changed
or auth state exported. Genuine authenticated desktop/mobile acceptance remains
open, not replaced by Vercel authentication or public route tests. No all-user
acceptance, paid live cycle, monetisation or attributable SEO result is claimed.

The financial delta described in `PENTRA_SLC_CUMULATIVE_BUDGET_REVIEW_2026-09-14.md`
is a separate local candidate AFTER the deployed commit. It was not pushed,
deployed or invoked. No allowance activation, pricing configuration, tenant
migration, publication attempt/reset or paid provider request occurred in31.
