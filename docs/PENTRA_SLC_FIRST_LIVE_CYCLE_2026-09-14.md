# Release36 and blocked first live migration

Assignment `supervisor-20260914-slc-first-live-cycle-36`. Reviewed source
`c2a10c5373a712a659ed75fc0b97cd1474e462c5` was released. Actual operator migration
was attempted and failed before either schedule was saved. The resulting
tenant-generic migration repair is LOCAL ONLY; the final handoff supplies its
exact review SHA. It is not deployed. No grant was attached, pricing enabled,
provider request made or article generated/published in36. Actual cost USD0.

## Reviewed release receipts

The supervisor independently accepted35 after45 scoped passes (10.918s) and147
broader SLC/customer/process results (39.812s), with zero failures/skips; the
broader count includes a nonmatching authorization-file wrapper.

Fetching main found only40c4d90, already an ancestor of the reviewed candidate.
No source merge or article-history conflict was needed. Convex deployment used
the existing authenticated CLI, typechecking enabled and code generation disabled
to preserve the exact reviewed source. Deployment/schema validation succeeded,
no indexes deleted; success observed by2026-09-14 20:50:55 UTC. Main advanced
fast-forward40c4d90 → c2a10c5. Local repair changes below were made afterward and
were never pushed or redeployed.

- [Exact-SHA hosted CI34895295233](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34895295233)
  passed at2026-09-14 20:57:17 UTC, updated20:57:18. Full1689 tests/1688 passed/
  0 failed/1 existing skip,230016.489441ms; browser28 passed/2 genuine auth skips,
  44.0s. Types/build/schema61 tables296 indexes/secrets684/dependency audit pass;
  lint0 errors157 warnings; dependency findings0.
- Vercel's GitHub integration reports exact c2a10c5 Production deployment
  **6446198967**, created20:51:11 UTC, success20:51:12.
  [Vercel receipt](https://vercel.com/arshads-projects-836ebfbd/seo-sentinel/HGqmS9MrBKnJiWa7kp9C8FmczAnc),
  [deployment URL](https://seo-sentinel-ordrlyydl-arshads-projects-836ebfbd.vercel.app).
  This is the authenticated GitHub/Vercel release receipt. A temporary in-app
  dashboard tab showed Vercel login and was closed; no dashboard Current badge
  or customer authentication is claimed from that tab.

## Real migration attempt and exact blocker

Only Pentra `jh74txye54jna4t85m6y7p4d6h82v9ab` and LeadPilot
`jh7cccny67df67rdm4jp65tmtn8am982` were queried. Their exact records establish the
same owner, completed canonical entitlement and existing monthly approval
`sn756ejbtp5marqw1chdpdskp58e0j8y`, reference
`owner-approved-20260908-019fec9f`. Owner subject was used only in the existing
admin-authenticated CLI `--identity`; it was neither guessed nor treated as a
customer browser session. No credential was exported.

Both normal owner-checked readiness queries passed: confirmed profile present,
same GitHub repositories/main/domains, valid unchanged publisher receipts,
entitlement and current binding, complete inventory, no pending content job or
publication lease, no unresolved revision. Pricing was absent at20:49:52.056 and
again before mutation. Ordinary intervals are Pentra86400000ms (7/week) and
LeadPilot28800000ms (21/week); neither had a stored content timezone, so the
existing UTC default was used.

The deliberate proposed first deadline was **2026-09-14 21:58:07.252 UTC**, one
hour after the recorded attempt start20:58:07.252. It was NEVER saved or activated.
Old missed deadlines were not modified or reinterpreted.

The first Pentra invocation failed at20:58:10.292. Production public-function
errors are redacted as Server Error, so the wrapper could not see the local
exception message. After a read-only check confirmed no migration occurred,
one diagnostic retry with the same deadline/arguments failed at20:59:39.925,
request **f6ca41c57783c942**. LeadPilot's one invocation failed at20:59:43.785,
request **6784f93e0e43c76f**. There was no repeated generation, provider attempt,
attempt reset or financial mutation. Neither site selected growth-first mode.

The deployed migration guard used one generic terminal-status list for worker
jobs AND measured growth classifications. Exact readonly projections establish
that its rejecting predicate is true for both sites:

| Retained record state | Pentra | LeadPilot |
| --- | --- | --- |
| Micro-seed completed | 6 | 7 |
| Micro-seed missed | 46 | 47 |
| Micro-seed provider balance unavailable | 0 | 1 |
| Micro-seed provider response unverified | 3 | 1 |
| Micro-seed active worker lease / nonterminal work | 0 / 0 | 0 / 0 |
| Growth monitoring / open / resolved | 47 / 0 / 173 | 37 / 30 / 166 |
| Existing revisions, all verified | 2 | 11 |

The existing micro-seed watchdog explicitly treats missed, provider-balance-
unavailable and provider-response-unverified as closed execution states. The
four unknown-cost rows have completed timestamps and no worker token or lease;
their financial reservations correctly remain held. Growth rows are measured
classifications, not jobs; all linked revisions are present and verified.
Even resolved classifications blocked migration. No other tenant was inspected.

Identical registered-handler reproduction on deployed-source c2a10c5 failed:
`SLC36 closed legacy history and nonexecuting growth classifications do not
prevent owner migration`,0 pass/1 fail,230.437792ms, with
`Reconcile legacy growth work before switching engines`. The safe production
state plus source and local reproduction identify the guard defect; the public
production error itself does not expose a stack or plaintext cause.

## Small local repair, awaiting review

The normal owner-checked `selectServiceMode` now separates execution from history.
Closed micro-seed states retain their entire rows/attempts/reservations. Completed
and provider-balance-unavailable evidence/demand rows are closed; pending,
running, partial, unknown states and live leases remain blocking. Unknown-cost
evidence/demand work stays conservative. No blanket release or status rewrite.

Recognized open/monitoring/resolved/dismissed growth classifications remain
unchanged. Their real jobs must drain, and migration now checks ALL prepared,
leased, attempted, pending-verification and unresolved revisions, including
legacy revisions rather than only contentWork revisions. Missing/corrupt linked
revision identity and incomplete bounded inventories fail closed.

Existing growth actuation and legacy queue checks exclude growth-first sites.
Two legacy revision preparation mutations lacked the equivalent final-mode
fence: `prepareForGrowthAction` and `prepareForCadenceRecovery` now reject
growth-first mode themselves, so a stale earlier eligibility read cannot create
another legacy revision after the switch. Their existing revision delivery and
reconciliation handlers are unchanged. The shared new-engine revision path is
not disabled. No schema/index/endpoint/framework or tenant-specific logic added.

Six connected test results exercise more than40 fixture cases: retained history
and unknown holds; open/monitoring/resolved classifications; pending/partial/
unknown physical work and live terminal leases; legacy/content unfinished
revision states; malformed links and three inventory-overflow types; competing
legacy admission/migration commit orders; and actual migration of both synthetic
sites followed by three scoped discovery/create/review/publish/verify/refill
cycles under full old4/32/35 capacity. Original owner checks and all prior money,
quality, retry and settlement regressions remain.

The two-site fixture produces10 new jobs and finishes with2 newly ready items
per site. Original historical rows and old capacity reservations are byte-for-
byte unchanged. Exact SYNTHETIC timestamps on2026-09-11 UTC:

| Cycle | Deadline | ReservoirNote publication | CedarCare publication | Ready each |
| --- | --- | --- | --- | --- |
| 1 | 12:10:00.000 | 12:05:00.012 | 12:05:00.013 | 2 |
| 2 | 12:40:00.000 | 12:35:00.057 | 12:35:00.058 | 2 |
| 3 | 13:10:00.000 | 13:05:00.031 | 13:05:00.032 | 2 |

These are not production publications or cash expenditure. Final local gates:

- Full1695 tests/1694 passed/0 failed/1 existing skip;124793.849833ms.
- Focused32/33/35/36:51 passed/0 failed/0 skipped;17718.672625ms.
- Browser28 passed/2 genuine auth skips;7.3s. Types/build/schema compatibility
  againstc2a10c5 pass:61 tables296 indexes. Lint0 errors157 existing warnings;
  full dependency audit0 vulnerabilities; secret scan685 tracked files and
  staged whitespace check pass.
- Production-safe public browser8 passed/2 genuine auth skips;4.7s. The initial
  production command mistakenly also selected the local-only One Setup harness;
  its two viewport tests failed against the intentionally404 `/e2e-acceptance`
  route (`src/proxy.ts`). The corrected command excludes only that synthetic
  harness, not authenticated checks. No application gate or skip was changed.

Public `pentra.dev` responds200. The unique Vercel URL requires deployment
authentication, so bundle comparison through that URL is not asserted. No
authentication was reset or selected. The exact local candidate SHA accompanies
the final handoff; none of this local correction is live yet.

## Post-attempt production state and retained financial boundary

At2026-09-14 21:00:40.955 UTC both remained legacy, no schedule, no cumulative
validation or independent grant. Profiles, destinations, page selections and
legacy status counts compare unchanged. Seven pages per site; no selected-page
permissions added. Budget audits at21:00:43.413/21:00:47.200 confirm all monetary
fields identical to preflight, including settled/held/released consumption,
old4 window,32 cap and October reset. No active jobs or unresolved revisions.

| USD component | Pentra | LeadPilot | Authorized-site total |
| --- | --- | --- | --- |
| Verified actual settled | 1.436640 | 1.555920 | 2.992560 |
| Conservatively settled ceilings | 5.000000 | 7.000000 | 12.000000 |
| Outstanding held ceilings | 7.250000 | 8.800000 | 16.050000 |
| Ordinary consumed once | 13.686640 | 17.355920 | 31.042560 |
| Old4 window consumed | 2.060960 | 1.060480 | 3.121440 |
| Independent validation consumed | 0 | 0 | 0 |

Account32 headroom remains at most0.957440; old4 window at most0.878560. These are
upper bounds because other tenants/account-wide and fleet35 totals were not
inspected. Reset/old approval expiry:2026-10-01 00:00:00 UTC. Internal
`provider_account_monthly_budget_reserved` is not proof of provider credit
exhaustion; provider balance is unverified. Exact-site audits report0 invalid
settlements/orphans/duplicate bindings/amount mismatches/expired-active holds.
No reservation removal is justified. Original USD20 additional approval remains
valid but inactive; no new owner approval, recurring allowance or increase needed.

| Tenant | Remaining legacy buffer | Last actual publication UTC | Original missed deadline UTC |
| --- | --- | --- | --- |
| Pentra | 0/4 | 2026-09-12 10:24:14.649 | 2026-09-13 10:24:14.649 |
| LeadPilot | 0/12 | 2026-09-07 22:15:34.409 | 2026-09-08 06:15:34.409 |

## Open acceptance and next bounded step

Review this repair before any second deployment/migration attempt. After a
reviewed release, repeat narrow preflight, select BOTH schedules while unpriced,
bind the original single20 run with the accepted stable references, then enable
only the matching Sonnet5 configuration (2/10 microUSD per token;2.50/item).
Preserve original ordinary intervals and record a genuinely selected first test
deadline. The attempted21:58:07.252 window was never selected. No hidden partial
activation exists to resume. The full accepted sequence remains in35's report.

First fresh production publication, live canonical/title/body/commit verification
and refill remain unproved on BOTH sites. No live artifact, new publication time
or new buffer may be claimed. Genuine signed-in customer desktop/mobile
acceptance remains separate from successful admin-owner readiness queries.

Preserved supervisor fault-injection limitation: one GitHub ref-PATCH503 in the
offline fixture recovers and fully verifies at START+1200020 for deadline
START+600000,600020ms late, with its original3 model calls and one failed
publication attempt. This holds with active and stopped funding. The existing
15-minute uncertain-write lease plus5-minute first retry explains the delay.
It is not a deadlock or provider replay. No safety lease/deadline was shortened,
cleared or erased in36; universal on-time outage recovery is not claimed.

Correction to35 wording: fourteen days is the minimum BETWEEN discretionary
revisions of the SAME page (`lastImprovedAt`), not a mandatory wait after creation
or before the first measured improvement. Weekly review and actual measured
evidence still apply. The same finite20 covers the first test, three subsequent
ordinary cycles, refill and measured follow-up. No renewed grant, growth claim,
backlinks, prospects, purchase, subscription, new task or automation. Stop for
independent review with both production failures explicitly still open.
