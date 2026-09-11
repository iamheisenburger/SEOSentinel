# Next ordinary planning source — assignment14

Read-only preflight, **2026-09-11 14:38–14:41 UTC**. Runtime remains
`3b806c6b867ae94cb160a14b7c2c45a47ca2291d`. No deployment, provider request,
reservation, scheduler invocation, attempt reset, consent or configuration write.
Safe machine-readable receipts are in the adjacent JSON. Only Pentra and
LeadPilot were targeted. This is a decision package, not article acceptance.

## Next-source decision

**Neither tenant can fund a new ordinary $1 plan under the current limits.**
The first financial rejection is `provider_account_monthly_budget_reserved`,
scope `approved_incremental_window`; the ordinary account-month ceiling would
also reject the request independently. This follows from current scoped lower
bounds plus the actual guard order, not from attempting a mutating queue call.
Waiting until 15:00 UTC does not reset either monthly restriction.

The next source must be a **new ordinary `topic_portfolio_evidence_replenishment`
plan**, if the scheduler's unchanged live checks admit it. It is not another
execution of either exhausted source plan, nor another primary/fallback under
the same source/policy37. Assignment13 established that those exact paid sources
and five exact LeadPilot evidence attempts cannot replay. No new source job ID
exists yet. Current target math requests up to seven verified topics for Pentra
and ten for LeadPilot; those are bounded targets, not yield guarantees.

| Preflight | Pentra | LeadPilot |
| --- | --- | --- |
| Observed mode / cadence | Live, Autopilot, 7/week | Live, Autopilot, 21/week |
| Exact usable buffer / minimum / target | 1 / 3 / 4 | 0 / 9 / 12 |
| Account article quota | 37 used / 150; 113 remain | Same account quota |
| Active pending/running jobs at 14:38 | None | None |
| Underfilled-buffer rolling plan limit | 3 per rolling 24h | 5 per rolling 24h |
| Local plan dollar ceiling per UTC day | $6 | $10 |
| Authorized-site provider consumption today | $0 | $0 |
| Latest observed terminal plan created | Sep8 15:01:57.230 UTC | Sep8 15:00:44.299 UTC |
| Latest observed terminal plan result | Done, one persisted topic | Failed, semantic zero yield |
| That plan's 24h + 1s boundary | Sep9 15:01:58.230 UTC | Sep9 15:00:45.299 UTC |
| Latest observed plan's failure cooldown | None | Underfilled semantic recheck Sep8 15:15:44.299; stored Sep9 boundary also elapsed |
| Next configured ordinary dispatch | Sep11 15:00 UTC | Sep11 15:00 UTC |

The read-only receipts show no recent plans in the supported pending/running/
done/failed lifecycle, and the latest observed terminal plans are over 24 hours
old. **They do not certify the atomic query's exact all-status rolling count or
latest counted plan.** The safe DTO omits reason/release fields, and the schema
allows arbitrary status strings. `countRecentTopicReplenishments` is NOT a
substitute: it counts only `topic_overlap_replenishment`. No raw job payloads or
worker tokens were retrieved to fill this gap. A bounded count/reason/earliest-
expiry projection from the actual ordinary admission predicates is missing.

Latest site-gate evidence from assignment13 at14:25 passes canonical entitlement,
ownership/deletion/parking, operational cadence, article quota and fresh tenant
authority. The current UI independently confirms113 credits remain;14:38 shows
both still live with no active jobs. At commit time all authorization and live
inventory checks must run again. LeadPilot's incomplete modern One Setup receipt
is a separate customer setup issue, not evidence that its existing legacy
ordinary scheduler is currently stopped by that contract.

## Guard order and money

Ordinary scheduler quality recovery, candidate quota and topic fit/evidence/
coverage remain ahead of new planning. The current seven topics cannot supply
an eligible fresh article (see assignment13). Atomic plan admission checks site
activity, active-plan deduplication, live/warm mode, canonical entitlement,
bounded inventory need, all-`topic_*` rolling history and failure cooldown before
reserving. Single-execution checkpoint planning uses **$1**, not the legacy $2
initial-plus-retry envelope. Site-local article and daily plan capacity are
checked again. Valid old contingency reconciliation is internal to that mutation;
the operator did not invoke it or discard reservations.

Shared reservation order in `convex/lib/providerSpendReservation.ts:354` is:
canonical owner/entitlement → approved incremental window → account month →
account day → five-minute shared provider-preflight cooldown → fleet month →
fleet day → reservation insert. Thus no provider request is needed to explain
the current rejection. No actual provider-credit exhaustion is established.

Fresh snapshots: Pentra14:38:06.905, LeadPilot14:38:09.215 UTC, exact-site windows
complete at84/95 reservations, unmatched-owner counts zero:

| USD | Pentra | LeadPilot | Authorized two-site sum |
| --- | ---: | ---: | ---: |
| Month consumed for admission | 13.686640 | 17.355920 | 31.042560 |
| Since Sep8 14:01:35.681 approval | 2.060960 | 1.060480 | 3.121440 |
| Today | 0 | 0 | 0 |

Existing caps: **$32 account/month** (base$28), **$4 approved incremental window**,
**$35 fleet/month**, $9.60 account/day and $9.85 fleet/day. The two sites share an
owner, established by assignment07's exact comparison. They provide lower bounds
on account/fleet consumption, NOT complete shared totals. Remaining account-month
headroom is **at most $0.957440**; approved-window headroom **at most $0.878560**.
A $1 reservation therefore fails even with no additional account/fleet usage.
Reset and one-off approval expiry: **Oct1 00:00 UTC**. The temporary approval does
not renew; the base limit resumes. No current provider wallet balance was checked.

The historical12:29 accounting audit classified the same two-site$31.042560 as
$2.992560 verified actual provider cost + $12 consumed execution ceilings +
$16.05 retained conservative ceilings. These are not $31.04 of verified cash
charges. The refreshed snapshots confirm the total, not a new per-row settlement
audit. Prior binding/expiry/terminal checks found no invalid settlement, duplicate
spend or removable valid reservation. Terminal or ambiguous work alone does not
prove zero cost. No new accounting defect is established here.

**No runnable funding approval can be quoted yet.** The current
`providerBudget:approveAccountMonthBudget` intentionally allows only immutable
same-month replay: a different cap, incremental allowance or reference throws
“A different monthly budget approval already exists.” Four existing authorization
tests passed locally, including this rejection, concurrency/OCC, idempotency and
guard preservation. There is no approved amendment operation to execute a new
number. Exact account/fleet capacity also has no aggregate-only safe projection
in this runtime. Do not read other tenants' records to obtain it.

Missing before any concrete owner expenditure request: a reviewed, bounded,
non-mutating ordinary-plan eligibility/aggregate-capacity receipt; and an explicit
decision on whether to design a narrowly scoped, idempotent amendment that retains
the original approval clock and every spent/retained amount. Neither was built or
authorized here. A $1 plan reservation is only a discovery execution ceiling,
not an actual-price quote and not an all-in article completion budget. Generation,
research, images and revisions require separate spending authority beyond the
discovery-only approval. No new spending request is being presented now.

## Direct signed-in UI findings and bounded repair proposals

Existing Chrome authentication worked; no login or credentials were requested.
Opened only the two exact site routes, their settings tabs and their selected
dashboards. No Save, Reconnect, Generate, Finish One Setup or terms action was
used. The native Mac lock did not prevent the existing Chrome session working.

- Pentra:7/week, Autopilot, connected `iamheisenburger/SEOSentinel`,
  `/blog/[slug]`, setup7/7. Dashboard shows **Blocked** and **Sealed buffer below
  minimum**, but incorrectly says **“Scheduler, quality buffer, and cadence are
  healthy.”**
- LeadPilot:21/week, Autopilot, connected `iamheisenburger/LeadPilot`,
  `/blog/[slug]`. Dashboard correctly says **Publication cadence deadline missed**
  and buffer below minimum. Current One Setup is3/7 and asks the owner to confirm
  existing choices. No confirmation was made. Historical publication “Ready” is
  not proof of today's cadence or fresh replenishment.
- Exact selected names, destinations, articles and health differed appropriately.
  **Activity and running-job counts do not obey that selection.** The dashboard
  reads account-wide `jobs.listAll` and uses `jobs.slice(0,8)` and an unscoped status
  filter. Both dashboards showed the same activity. This is a same-account site-
  attribution defect, not a demonstrated cross-account authorization breach.

Two local reproductions, zero network calls, no runtime edits:

1. With `corePipelineFixture`, create one synthetic live7/week site, a complete
   one-item sealed metadata buffer and a newer completed `planning_blocked` run.
   Invoke the actual `autopilot:refreshSiteCadenceHealth` and `autopilot:auditSla`
   handlers. Both persist `{status: planning_blocked, approvedBufferCount:1,
   bufferMinimum:3, detail: "Scheduler, quality buffer, and cadence are healthy."}`.
   Cause: `autopilotHealthStatus` returns fail-closed outcomes, but both detail
   switches fall through to a healthy default (`convex/autopilot.ts:2675,2816`).
   Proposal: one exhaustive status-to-detail presenter; only explicit `healthy`
   can emit healthy copy. Test all fail-closed statuses plus missed/stale/partial
   inventory and genuine recovery in the actual handlers.
2. Parse and execute the actual `runningJobs`/`recentJobs` initializer expressions
   in `src/app/(dashboard)/dashboard/page.tsx:105` against two synthetic authorized
   sites. Selecting either returns both sites' activity; a running job in the
   opposite site changes the selected site's running count. Proposal: an
   owner-authorized bounded exact-site job projection, selected-site query and
   loading-state handling; do not just filter the already globally truncated50
   jobs, which can hide one site's history. Test two-site switching, empty/loading,
   deep links and unauthorized IDs. No real foreign-tenant probe was performed.

These are reproducible, focused customer-reporting repairs. They do not warrant
relaxing quality, replaying discovery, increasing budgets or claiming acceptance.
They are proposals only, awaiting a bounded implementation assignment.

## Next action / owner package

Supervisor can assign the two proven reporting repairs independently of paid
acceptance. Before asking the owner to spend again, resolve the exact count/
aggregate-only funding receipt and immutable-amendment limitation above. Owner
review of LeadPilot's modern setup choices is also outstanding; do not silently
accept those choices as an engineering repair. No numeric increase is requested.

Latest publication/buffer evidence remains: Pentra actual publication **Sep11
10:24:02.469 UTC**, buffer1/4, next exact publication deadline **Sep12
10:24:02.469 UTC** (after today's Sep12 07:00 UTC cutoff); LeadPilot actual
publication **Sep7 22:15:34.409 UTC**, buffer0/12, overdue since **Sep8
06:15:34.409 UTC**. Both latest natural runs completed planning_blocked at12:00.
15:00 has not arrived during this useful preflight and was not forced or waited
for. Neither fresh topic→article→quality→publication nor replacement after
consumption is proven. Existing Search Console counts are not attributable growth
from this work. No backlinks work was started.
