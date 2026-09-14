# Legacy dispatch retirement39 — release receipt and local review candidate

Assignment `supervisor-20260914-slc-retire-legacy-dispatch-39`. This is an
implementation/verification report, not a replacement plan. The sole canonical
contract remains the parent `docs/PENTRA_SLC_PLAN.md`. The final handoff gives
the exact clean LOCAL39 commit;39 must be independently reviewed before release.

## Reviewed recovery38 is released; retirement39 is not

Released exact source `47f82d108d801b813b6acb88c7515e060c3f36d0` from a clean
checkout, after independent review and the38 free gates. Origin's production
content commit `20e8ebbe5998c8a6837c3bb24f9d4e57e53f7253` was already an ancestor;
the fast-forward to47f82d preserved it. No force push or content replacement.

- Convex `prod:wary-starfish-773`: explicit production deploy from that clean
  exact source completed by2026-09-14 22:02:12 UTC. Type checking and schema
  validation succeeded; no indexes were deleted. This is the deployment-command
  receipt, not a claim that a live credit-recovery action was exercised.
- Origin/main: exact47f82d, independently re-read at22:15 UTC.
- Hosted CI [34902030316](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34902030316),
  job104169972539: completed success at22:07:03 UTC for exact47f82d.
  Full1717 discovered/1716 passed/0 failed/1 existing skip; browser32 passed/
  2 genuine-auth skips; types/build/schema61 tables296 indexes/secrets687/
  dependency audit0 pass; lint0 errors157 warnings.
- Vercel production deployment6447358365: exact47f82d, success22:03:10 UTC;
  [immutable deployment](https://seo-sentinel-4c6ralh8s-arshads-projects-836ebfbd.vercel.app).
- Actual `https://pentra.dev` public browser smoke:8 passed/2 genuine-auth skips,
  8.0s. Desktop/mobile sign-in, sign-up, unsubscribe and invalid-OAuth boundaries.
  This did not publish, subscribe, authorize OAuth or purchase anything.

No39 deployment, live funding-restoration attestation, owner retry, provider
probe/call, purchase, allowance/cap/schedule/attempt reset, manual release,
new task/automation or backlinks work. Existing grants and reservations remain.

## Reproduction and minimal generic retirement

On47f82d the connected mixed-mode fleet test failed: the actual shared selector
returned all4 synthetic sites rather than the2 ordinary legacy sites. This is
unnecessary legacy selection/dispatch, NOT evidence of a new paid dual-engine
replay: the existing shared budget guard already rejects non-`content_work`
spending for migrated sites.

The candidate changes only the following legacy boundaries:

1. The existing expected-click fleet page/state selector excludes
   `serviceMode === "growth_first"`. Demand/evidence daily and recovery fleets,
   plus micro-seed fleet dispatch, consequently omit migrated sites.
2. Demand/evidence readiness, recovery lookup, direct reserve/queue, worker
   claim, pre-provider boundary and resume reject migrated work. Direct queue
   rejection occurs before old skip receipts can be overwritten. A response
   already in flight can still record its receipt, but cannot chain another
   legacy evidence/cadence wake.
3. Micro-seed readiness, admission, claim, pre-provider boundary, semantic and
   successful-candidate continuation, stale handoff, scheduling, watchdog and
   finalization are fenced locally. Scheduling is rejected before ordinary
   live-readiness demotion can mutate a migrated rollout.
4. An exact already-started micro-seed response still passes all original
   ownership, worker, request, source-plan, amount and receipt checks. Its
   actual cost settles once, and the candidate receipt is retained. Migration
   prevents topic materialization or continuation, without inventing zero cost.

No broad `siteExecutionActive`/`siteExecutionAuthorized` change, tenant allowlist,
new queue, scheduler, accounting ledger or schema change. Ordinary legacy
customers retain their behavior. `content_work` execution, daily Search Console
ingestion, existing financial reconciliation, publication-write reconciliation
and audit-history queries remain available. Unknown paid holds stay held.

## Connected offline evidence

The tests invoke the registered handlers, original argument validators and
transactional fixture. Provider, GitHub and Google responses are synthetic;
unexpected network requests fail. They are NOT customer or production acceptance.

- Mixed ownership/service mode: same-owner sites differ in mode; another owner
  also has each mode. Only legacy sites appear in all3 planning fleets, while
  all4 remain in measurement ingestion.
- Six real queued fleet wakes captured before actual service-mode migration
  become inert after a runtime restart. No provider I/O, reservation, legacy
  job or overwritten dispatch/skip history.
- Concurrent direct claims allow one ordinary worker and no migrated worker.
  Direct demand/evidence/micro-seed admission, resume and watchdog cannot replay
  stale migrated work. Final pre-provider fences also cover a claim/migration race.
- An already-started demand receipt still completes without an evidence wake.
  A valid nonempty micro-seed response settles12,240 microUSD exactly once,
  preserves its candidate and source reservation, creates no topic and cannot
  be submitted again under the closed worker lease.
- Micro-seed semantic continuation, evidence handoff, scheduling and finalizers
  leave the migrated site/job/history untouched and emit no legacy wake.
- Real daily GSC action: synthetic OAuth refresh,28 exact daily query rows per
  site and complete page-total ingestion across all4 sites, including both
  migrated sites. Data-through2026-09-08; no paid planning reservation.
- Original actual-cost reconciliation still settles known12,240 microUSD once;
  unknown attempted costs stay reserved; no retry/wake or job-history rewrite.
- Both migrated synthetic businesses complete creation, quality approval,
  scheduled publication, exact live-artifact verification and3 consumption/
  fresh-refill cycles, restoring2 ready items each time. Ten durable jobs remain
  exclusively `content_work`; legacy tables stay empty. Original ordinary-core
  and uncertain-write reconciliation regressions are included in the full suite.

Free gates on39: final full suite 1726 discovered / 1725 passed / 0 failed /
1 existing skip, 135,002.491125ms. Final retirement selection 9 passed / 0 failed /
0 skipped, 2326.577ms, including the nonempty late receipt. Type checking,
production build with synthetic nonsecret
configuration, schema61/296 against47f82d, secret scan688, dependency audit0 and whitespace pass.
Lint0 errors157 existing warnings. Local browser32 passed/2 genuine-auth skips,
7.2s. Broader SLC32/33/35/36/37/38/39 selection82 passed/0 failed/0 skipped,
26,789.12575ms before strengthening the nonempty late-receipt assertion.

## Live acceptance and financial facts remain separate

The current established provider blocker is the actual Anthropic HTTP400
`invalid_request_error` insufficient-credit response from both first draft
attempts, not Pentra's internal monthly guard. Numeric wallet balance, billed
cost and provider reset time are unknown. Deployment cannot restore funding.
No exact funding event has been attested and no paid retry was issued in39.

Last successful safe exact-site audit is38 at2026-09-14 21:44:20.426 UTC:

| Authorized site | Existing failed job | Retained hold | Ready buffer | New publication |
| --- | --- | ---: | ---: | --- |
| Pentra `jh74txye54jna4t85m6y7p4d6h82v9ab` | `j9703g7paa6atyya4fzr56ngs58ecn07` | USD2.50 | 0/2 | none verified |
| LeadPilot `jh7cccny67df67rdm4jp65tmtn8am982` | `j973nq40csygxhcg0bchsmx6zd8ecq9h` | USD2.50 | 0/2 | none verified |

The SAME original independent20 run `sn756ejbtp5marqw1chdpdskp58e0j8y` has5 held,
0 VERIFIED settlement and15 remaining, not a renewal. Zero verified settlement
does not prove zero provider billing. The ordinary32 monthly, old4 allowance
and35 fleet limits remain unchanged. The last37 ordinary audit was:

| USD, authorized records only | Settled actual | Settled conservative ceiling | Outstanding held | Consumed |
| --- | ---: | ---: | ---: | ---: |
| Pentra | 1.436640 | 5.000000 | 7.250000 | 13.686640 |
| LeadPilot | 1.555920 | 7.000000 | 8.800000 | 17.355920 |
| Combined | 2.992560 | 12.000000 | 16.050000 | 31.042560 |

Ordinary account32 headroom AT MOST0.957440; old4 headroom AT MOST0.878560
(consumed3.121440). Other tenants/fleet contents were not enumerated. Ordinary
account-month reset2026-10-01 00:00:00 UTC; independent20 never resets. No new
accounting evidence justifies removing terminal unknown-cost holds.

The post-release exact-site `contentWork:readiness` refresh failed locally at
22:13:19.368 UTC before any production handler request ID, with "You don't have
access to the selected project." A safe diagnostic of the same read-only call
confirmed that access error; no credentials or tenant payload were output.
The available Chrome profile also redirected the exact authorized Pentra site
to branded sign-in. No authentication reset was attempted. Consequently the
last successful tenant audit above is NOT represented as a fresh39 state read,
and authenticated customer acceptance stays incomplete.

At 2026-09-14 22:19:25 UTC the original delivery deadline had elapsed without
verified new-publication evidence. This is a missed acceptance deadline; the
blocked state refresh does not establish whether an unobserved external change
occurred. No actual publication time is invented or moved into the window.

Both original saved delivery windows remain2026-09-14
22:14:14.420–22:19:14.420 UTC. Pentra's original daily cadence and LeadPilot's
every8h cadence are unchanged. No deadline was moved. Last known older actual
publications: Pentra2026-09-12 10:24:14.649 UTC; LeadPilot2026-09-07
22:15:34.409 UTC. Older misses remain Pentra2026-09-13 10:24:14.649 UTC and
LeadPilot2026-09-08 06:15:34.409 UTC. New delivery timestamps and replenishment
cannot be claimed without fresh verified production evidence.

Pentra fresh topic selection was observed in37; LeadPilot reused a September4
topic, so fresh LeadPilot discovery remains unproven. Neither live repeated
replenishment nor attributable SEO growth is accepted. The14-day minimum
between discretionary same-page revisions remains. No backlinks work started.
