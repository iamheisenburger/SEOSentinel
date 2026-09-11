# Isolated terminal-plan handoff release — September 11, 2026

Assignment `supervisor-20260911-core-handoff-release-07`. Evidence through
**12:30 UTC**. Today's user deadline is **September12 07:00 UTC** (end
September11 PDT). Technical release completed; customer acceptance **NOT READY**.

## Bound release and gates

Runtime **8e9e14739b2d4c217dccf40a3efcbfd37c548fe7**, parent
**6f784df5f7872ca9e232c1a77874ce1065bc0b4f**. That base has the identical runtime
to prior production6c67e42. Only the reviewed terminal-plan continuation change,
connected fixture/tests, continuation tests and their report were isolated.
No dormant spending framework, approval table, activation or ancestor commit
was included. No budget, cadence, quality threshold or schema change.

The repaired failure was reproduced by executing actual connected handlers:
a terminal duplicate-only horizon plan left valid planned topics waiting,
but no scheduler handoff. The new `planFailed` flag follows an owned, committed
terminal planner failure or exhausted planner retry. Existing scheduler admission
still decides the next bounded action. Failed jobs stay failed; nothing is reset.
Lost claims, pending retries and funding/day-expiry/setup preflight aborts do
not acquire this new continuation.

On the isolated production base, not merely a patch-application check:

- Full suite **1,454 passed**, no failures/skips; targeted connected and
  continuation suite **10 passed**.
- Typecheck and production build passed using synthetic required configuration.
- Lint zero errors,157 existing warnings. No new test warnings.
- Schema **61 tables /292 indexes**, zero delta; tracked secret scan617 passed.
- Production dependency audit zero findings.
- Local desktop/mobile browser gates **16 passed /2 explicit authenticated
  acceptance skips**. These skips are not customer acceptance.

The connected tests cover ordinary fresh planning through generation, strict
review, sealed publication, verified artifact and newly generated replacement
to full policy buffers for two synthetic businesses. Provider outputs and
infrastructure are simulated, not real customer-quality evidence. A new empty
discovery case terminates at normal admission/cooldown, cannot replay closed
plans, and creates no extra jobs/reservations under six concurrent subsequent
wakes. See `PENTRA_CORE_PIPELINE_INTEGRATION_2026-09-11.md` for exact virtual
traces, negative quality cases and simulation limitations.

Deployment receipts bound to the same release:

| Surface | Evidence | UTC |
| --- | --- | --- |
| Vercel production | GitHub deployment6392928166, success, exact8e9e147 | Sep11 12:22:04 |
| Convex production | Successful push to `wary-starfish-773`, schema validated, no index deletions | Confirmed Sep11 12:24:31 |
| Hosted quality gates | Run34598480701 /job103259760915, success, exact8e9e147 | Sep11 12:24:56 |

[Hosted CI](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34598480701)
passed all required steps. The three conditional OSV fallback steps were skipped
because npm audit succeeded. [Vercel deployment](https://vercel.com/arshads-projects-836ebfbd/seo-sentinel/6hiXiKH2dYadtMMmryY8DZ9uPoVv)
serves [the production build](https://seo-sentinel-eunlip10h-arshads-projects-836ebfbd.vercel.app).

Convex binding is the clean committed runtime plus successful CLI push and
native dashboard confirmation of the new deployment.12:24:31 is the confirmation
time, not a fabricated server-side deployment timestamp/Git-SHA receipt. Native
History is Pro-only; no upgrade was made. Existing signed-in CLI authentication
worked after sourcing the existing deployment-target environment instead of
passing its target-only file via `--env-file`, which bypassed existing global
authentication in the installed CLI. No new login, token, key or grant.

## Postdeployment tenant evidence

Only Pentra `jh74txye54jna4t85m6y7p4d6h82v9ab` and LeadPilot
`jh7cccny67df67rdm4jp65tmtn8am982` were queried. Exact-site queries and whitelisted
projections excluded credential values, other tenants and account/fleet ledger
enumeration. No manual provider-backed scheduler, generation, revision, replay
or cadence acceleration was invoked.

Operator snapshots: **12:25:03.911 /12:25:04.633 UTC**.

| Field | Pentra | LeadPilot |
| --- | --- | --- |
| Ready /minimum /target | **1 /3 /4** | **0 /9 /12** |
| Active jobs | 0 | 0 |
| Autopilot | live, epoch6,7/week | live, epoch9,21/week |
| Expected-click scheduling | enabled | enabled |
| Last natural completion | Sep11 12:00:18.112 | Sep11 12:00:24.739 |
| Natural result | `planning_blocked` | `planning_blocked` |
| Last actual publication | **Sep11 10:24:02.469** | **Sep7 22:15:34.409** |
| Current publication deadline | **Sep12 10:24:02.469**, scheduled | **Sep8 06:15:34.409**, missed |
| Bounded upcoming runs | exact cadence deadline present | none |

The latest natural results precede this deployment. Pentra's next article
deadline is after today's acceptance cutoff, not something to silently accelerate.
LeadPilot's deadline run ended `planning_blocked` at Sep8 06:15:44.386.

Topic snapshots12:28/12:29:

| Field | Pentra | LeadPilot |
| --- | ---: | ---: |
| Current topic rows | 145 | 243 |
| Planned | 1 | 6 |
| Used | 117 | 101 |
| Cannibalizing | 3 | 110 |
| Disqualified | 24 | 26 |
| **Scheduler-evidence-ready** | **0** | **0** |
| Opportunity decisions: coverage conflict /needs evidence /too thin | 139 /1 /5 | 229 /6 /8 |

Thus the ordinary repair's prerequisite—valid waiting inventory after a new
terminal plan—has not been demonstrated in these current live states. Both
sites have insufficient expected-click evidence. We did not reopen the old
terminal plans to manufacture a demonstration. The most recent fallback jobs
remain `missed/no_strict_candidate`, each receiving300 and admitting0 candidates,
with a completed$0.048 provider receipt. They remain exhausted.

Next configured UTC crons: legacy demand/evidence **13:15**, cadence **15:00**.
Micro-seed recovery runs every15minutes; its exact next execution receipt was
not read. Cron configuration is not a promise of discovery or publication.
The latest natural demand/evidence skips reported no eligible legacy/current
demand candidates. No postdeployment fresh plan failure, new generation,
publication or replacement is claimed from these observations.

The already-established Pentra public receipt for today's guide is verified
**10:24:15.343 UTC**, matching sealed/published hash
`3e2ba16ceef80de9bdbb9e4942973bd9b9e7709336ea38c6e5738edd6745c5bd` and Git
commit`1688fa227224d7d545a9c64e4413f193110a44d2`. This is earlier recovery
evidence documented in `PENTRA_RECOVERY_2026-09-11.md`, not a new postrelease
publication. Its remaining ready article was created September8. Full buffers
and fresh replacement after today's consumption remain unproven on both sites.

## Current budget cause and retained reservations

Complete exact-site/source audit windows at **12:29:40.385 /12:29:41.892 UTC**
confirmed shared ownership without enumerating another tenant. Pentra84 and
LeadPilot95 reservation rows, zero invalid settlements, orphan reservations,
duplicate source bindings or source amount mismatches. Neither has a retained
cancelled/expired source or a retained expired lease.

| USD | Pentra | LeadPilot | Permitted subtotal |
| --- | ---: | ---: | ---: |
| Verified actual settlements | 1.436640 | 1.555920 | **2.992560** |
| Settled spent-execution ceilings, not measured cash | 5.000000 | 7.000000 | **12.000000** |
| Retained reservation ceilings | 7.250000 | 8.800000 | **16.050000** |
| Internal capacity consumed | 13.686640 | 17.355920 | **31.042560** |
| Consumed since discovery approval | 2.060960 | 1.060480 | **3.121440** |

Retained Pentra: four done plans$5, twenty completed jobs$2, three ambiguous
provider responses$0.25. Retained LeadPilot: six failed plans$6, twenty-seven
completed jobs$2.70, one ambiguous response$0.10. Terminal status is not proof
that provider work cost nothing. Settlements replace original amounts in the
capacity sum, not add to them. This audit found no new evidence authorizing a
refund. Earlier proven accounting repairs are in `PROVIDER_BUDGET_AUDIT_2026-09-08.md`;
no reservation was removed or altered in this assignment.

`reserveSharedProviderBudget` checks the **approved incremental window** before
ordinary account capacity. Existing limits: account **$32/month** (base$28),
incremental discovery **$4**, fleet **$35/month**; daily account$9.60/fleet$9.85.
The two permitted sites alone leave at most **$0.957440** account monthly
headroom, with the tighter incremental ceiling at most **$0.878560**. These are
upper bounds, not full-account available balances. Another$1 single-execution
plan would return `provider_account_monthly_budget_reserved`, scope
`approved_incremental_window`; the independent account32 ceiling would also
deny it. No paid reservation was attempted merely to reconfirm this arithmetic.
Reset/approval expiry **October1 00:00:00 UTC**; not today's deadline.

The last provider-wallet check was the free DataForSEO preflight at
**10:29:27.120 UTC**, reporting **$26.720668** available. It was not rerun here;
this is historical numeric evidence, not a fresh wallet balance and not an
Anthropic/OpenAI balance claim. The diagnosed denial is Pentra's internal
spending admission, distinct from provider cash or the separately restored
Convex infrastructure threshold.

**$0 extra operator provider spend.** Limits and valid reservations unchanged.
The old$60 proposal remains declined, the later$12 proposal was withdrawn, and
the separate infrastructure15→20 authorization does not fund extra operator
generation/revision. No new spending approval is requested in assignment07.

## Remaining failure and acceptance boundary

The connected transient-publication test still exposes a retry weakness:
a+5-minute wake collides with a retained15-minute ambiguity lease and consumes
another failure without an external write. The artifact eventually publishes
once at+15minutes, but retry tolerance is unnecessarily reduced. The isolated
trace has3 publisher actions,2 PATCH attempts,1 visible commit, retained
`publicationAttempts:2`; hash
`a5098ce7d5eb0c62a40a8c3495a73a9b43de312cc5bfd4ac529a5fa3a6455ee7`.
That trace is synthetic. **This release does not fix the retry issue.** A next
bounded repair should defer contention without consuming a delivery attempt,
while preserving ambiguous-write protection and same-artifact ownership, with
concurrency/expiry/idempotency regressions. It needs its own reviewed scope.

No live fresh discovery→quality approval→full buffer→scheduled new publication
→verified artifact→new replacement chain has passed for overdue LeadPilot.
No SaaS monetisation sign-off, article acceptance or attributable SEO growth.
No backlinks work. This release is a verified generic technical repair, not a
claim that the user's end-to-end outcome is complete.
