# Provider reservation diagnosis — September 6, 2026

Provider wallet top-ups and Pentra's internal reservation ceilings are distinct.
At 16:28 UTC Pentra had three sealed articles and LeadPilot had four. Their next
new-article deadlines were September 7 11:45:12.262 UTC and September 6
22:14:51.187 UTC respectively. Buffer refill was not proven healthy.

## Reproduced reporting defect

Both account and fleet capacity evaluators checked daily consumption before
monthly consumption. If both windows denied the same request, One Setup mapped
the daily reason to tomorrow, despite the monthly limit also preventing that
request. The evaluators now report the monthly constraint first within their
respective account/fleet scopes. Existing ceilings and admission decisions are
unchanged. This is not a claim that every other independent queue constraint
has been inspected or will clear at that time.

The new `providerBudget:getSiteReservationSnapshot` internal query reads one
exact site's current-month reservations through the site/date index, at most
501 rows. It exposes aggregate reserved/settled/released counts and amounts,
marks truncation, and excludes rows belonging to a previous owner. It does not
read another site's reservations, return credentials, or infer free account or
fleet capacity from a single site's subtotal. Headroom is explicitly an upper
bound, never an authorization to spend.

Runtime tests cover two distinct tenants, foreign rows, previous ownership,
settled and released reservations, month boundaries, overflow, and absence of
credentials. Capacity tests cover simultaneous daily/monthly exhaustion at
every canonical tier, fleet exhaustion, and the corresponding One Setup UTC
monthly wake. No provider calls, topic replays, or spending-limit increases are
part of this repair.

Local release gates: 1,332 tests passed; type-check passed; lint zero errors and
157 pre-existing warnings; additive schema passed (60 tables, 291 indexes);
secret scan passed (580 tracked files); dependency audit zero vulnerabilities;
production build passed; public browser checks 10 passed, with two authenticated
checks explicitly skipped. These are software checks, not replenishment proof.

## Deployment and bounded production observations

Release `070837dc2ddd070b4fc04d72a70fd557a3f5672c`: GitHub quality run
`34045895904` passed; GitHub/Vercel deployment `6295346944` succeeded; Convex
`wary-starfish-773` deployed successfully. At 16:39 UTC the new production query
returned complete exact-site current-month windows (76 Pentra reservations,
79 LeadPilot reservations), with no previous-owner rows.

| Exact site | Today's consumed reservation | Month's consumed reservation | Settled rows | Released rows |
| --- | ---: | ---: | ---: | ---: |
| Pentra | $2.100000 | $8.664720 | 52 | 0 |
| LeadPilot | $5.274040 | $12.001040 | 49 | 2 |

These are reservation-accounting amounts, not measured cash spend. Both resolve
to Enterprise: $9.60 daily account ceiling and $28 monthly account ceiling.
No other site's reservations or complete account/fleet ledger was inspected;
these site totals alone cannot authorize another provider call. They also do
not establish that a monthly limit currently blocks these tenants. The monthly
precedence defect was reproduced locally, not asserted from these subtotals.

Pentra remains three sealed articles (`planning_blocked`); LeadPilot remains
four (`topic_replenishment_exhausted`), with no active refill jobs at this check.
The exact next publication run receipts remain scheduled and unchanged.

Native Chrome control is working. The actual customer settings show Pentra
7/week and LeadPilot 21/week, both GitHub-connected, with 119/150 article credits
remaining. No settings were changed. LeadPilot shows Search Console connected
with sitemap repair active; Pentra still requests reconnect for sitemap
submission permission. After refresh, Pentra's setup card explicitly shows
6/7, planning waiting on an internal reservation, and a September 7 00:00:01 UTC
retry; it does not claim generation is active. LeadPilot's legacy setup remains
3/7 and requires confirmation of its current setup contract.

## Work identified at 16:39 UTC

Automatic checkpoint plans currently permit exactly one paid execution but
reserve the legacy two-execution envelope. Terminal contingency settlement
reduces some old reservations, but admission still needs both execution
ceilings up front. A prospective one-execution reservation contract needs
end-to-end queue, paid-boundary, retry, checkpoint, settlement and operator
receipt tests before it can safely replace that envelope. Legacy/ambiguous
receipts must not be rewritten or replayed. Also verify capacity-change wakes
instead of assuming that a stale daily-denial receipt will recheck promptly.

No replenishment success or overall goal completion is claimed by this release.

## Prospective single-execution envelope repair

New automatic checkpoint plans now carry `planProviderEnvelopeVersion: 2` and
reserve $1, matching their existing single paid-execution ceiling. This is not
a provider price change or a reduction in the quality requirements. Queue-time
inventory, cadence, entitlement, local/account/fleet capacity and recent-failure
checks remain in force. Manual, One Setup, migration and marker-absent jobs keep
their original $2 contract. No historical job or ledger amount is rewritten.

The shared amount validator requires the exact versioned checkpoint target for
the reduced envelope. It is used by worker authorization, checkpoint staging,
candidate paid admission, cancellation, known pre-provider failure release,
terminal projections and bounded exhausted-plan recovery. Unknown versions,
missing targets, mixed contracts and job/ledger amount disagreement fail closed.
An explicitly missing ledger amount is not treated as an omitted ledger check.
The ordinary topic writer still refuses a reduced-envelope job; it must use the
checkpoint writer. Existing failed/ambiguous work cannot gain another execution.

Runtime tests exercise the actual queue, paid-boundary, checkpoint and worker
handlers, not only source-text assertions. They cover two synthetic tenants at
7/week and 21/week, duplicate queue requests, original $2 compatibility,
affordable $1 admission with unchanged account caps, monthly-count/lifecycle
fences, checkpoint persistence and replay, per-candidate exactly-once admission,
worker timeouts without replay/refund, underfilled continuation rejection,
pre-provider release, and cancellation of pending versus running jobs. Legacy
contingency settlement is also tested not to refund a new $1 reservation.

Local gates: 1,345 tests passed; type-check passed; lint zero errors and 157
existing warnings; additive schema passed (60 tables, 291 indexes); dependency
audit zero vulnerabilities; production build passed; public browser checks
10 passed, two authenticated checks explicitly skipped. Deployment evidence and
actual refill outcomes must be recorded separately.

At 16:51 UTC, before deployment, production still had three ready Pentra
articles and four ready LeadPilot articles, no active jobs, and the same exact
publication deadlines. This unchanged observation is not progress. The repair
does not erase the existing semantic-failure cooldown or prove sustained refill.

### Bound deployment and controlled production check

Release `624ca493071786545e588095dea294c68be7dfd3` passed GitHub quality run
`34046828746` (3m23s), GitHub/Vercel production deployment `6295527017`, and the
Convex production deploy to `wary-starfish-773`. The tracked-source secret scan
passed (581 files); `.codex-convex-prod.env` remained untracked.

At 16:56:49.859 UTC a controlled call to the ordinary `queuePlanIfAbsent`
boundary admitted Pentra plan `j973g2vmf8eb42erf3jmjczh098dxeg9`, with envelope
version 2, checkpoint mode 1, and both job and ledger reserved for $1. The normal
worker completed at 16:58:03.398 UTC, execution one, workerAttempts zero. The
durable checkpoint is `inline_completed` with two usable/saved topics; its
required target remains seven. The scoped operator projection validates the
new reservation as `retained_no_replay`. This is real provider-backed planning
and persistence evidence, not natural-cadence or new-article publication proof.

LeadPilot's single controlled admission check returned `recent_limit` with five
counted plans. Its existing cooldown run `kd70p56f1hya86c0szynfcc19x8dwvm5` was
reused rather than duplicated. No additional LeadPilot plan/provider execution
was started and its cadence was not changed.

A single controlled Pentra follow-up was dispatched through the existing
scheduler boundary: run `kd70n1995gbj8j3245mh9k8n418dx03d`, labelled
`controlled_refill_acceptance`. At 16:58:56 UTC it had queued article job
`j975xfypmfbte17nenr54yg1sx8dx73s`; three sealed articles and the September 7
11:45:12.262 UTC publication deadline were unchanged. No natural-run timestamps
were advanced by this controlled check. Article generation and quality outcome
remain to be verified from the resulting ordinary receipts.

### New external production suspension

At 17:01:18.318 UTC the new article worker was still running execution one at
step 7/11, writing "Agency Rank Tracking". No article ID or sealed artifact had
yet been returned. A later exact-job query failed because Convex reported that
the deployment had exceeded its free-plan limits and had been disabled.

An independent, credential-free exact-site operator query confirmed the same
deployment suspension at 17:02:38.728 UTC. The service's error requests a Pro
upgrade or contact with Convex support. The specific exhausted quota and any
paid-plan price have not been inspected. No subscription purchase or further
production test was attempted after confirmation.

This is an infrastructure-capacity blocker, separate from provider-wallet
funding and internal reservation ceilings. Restore Convex production capacity
before resuming verification. The running article's final outcome is unknown;
after restoration, inspect its existing job/checkpoint receipts before any
retry, because paid work may have started. Do not reset/replay that job or count
it as a published article. The goal and sustained cadence proof remain open.

## Local repair while production is suspended: separate topic yield from spend

The production suspension was revalidated with one bounded exact-site query at
17:03:42.630 UTC. No additional provider test or production deployment was
attempted. The following repair is local only until capacity is restored.

The monthly plan-attempt policy assumed that each plan supplies its maximum of
ten usable topics. For example, an Enterprise allowance of 150 articles stopped
planning after 15 plans even if each plan yielded only two topics and article
quota remained. The latest controlled production plan actually yielded two of
seven requested topics. That motivates the regression; it does not establish
that these production tenants have already reached the monthly attempt cap.

The actual queue handler reproduced this premature `plan_headroom_exhausted`
denial. New single-execution checkpoint refills now use the queue's verified
inventory shortfall, current article quota, rolling attempt limits, and the
existing local/account/fleet monetary reservation instead of the fictitious
ten-topic-per-execution assumption. They skip the redundant monthly job-count
read. A null monthly attempt allowance means that count policy is inapplicable,
not unlimited money or unlimited attempts. Legacy/manual/One Setup/migration
paths retain their previous attempt-count policy and execution envelopes.

No dollar ceiling, article entitlement, provider execution count, failure
cooldown, quality gate or publication rule was increased or bypassed. Historical
reservations still consume account and fleet capacity, including reservations
for another site or a deleted site of the same account. No historical job or
reservation is rewritten, released, or replayed by this change.

Runtime regression checks cover all five canonical plan tiers: refill after
underfilled plans with available funding, rejection at the actual monthly
dollar ceiling, real quota exhaustion and one-article remaining headroom,
cross-site accounting, both fleet ceilings, pause/reconciliation fences, and
rolling attempt limits with a future automatic wake. Existing duplicate queue,
checkpoint/worker lease, no-replay, and unchanged daily-dollar tests still pass.
The complete repository suite passes 1,354 tests. Type-check, additive schema,
dependency audit (zero vulnerabilities), production build, and lint (zero
errors, the same 157 existing warnings) pass. Public Playwright checks passed
10/10, with two authenticated checks explicitly skipped. The tracked-source
secret scan passed (581 files); the production environment file remains
untracked. The repair is saved locally and has not been pushed or deployed
while Convex production is suspended.

This repair does not guarantee that current provider budgets can fund the full
advertised article volume at observed discovery yield. That economics/capacity
constraint remains separate from this demonstrably false attempt-count stop.
Production acceptance, the interrupted article's outcome, and sustained refill
on both sites remain unproven while the deployment is disabled.
