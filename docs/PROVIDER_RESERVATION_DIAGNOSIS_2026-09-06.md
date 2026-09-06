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

## Service recovery and exact worker-lease observer

A fresh exact-site query at 17:11:50.092 UTC succeeded. Subsequent Pentra and
LeadPilot projections and the signed-in Pentra UI also responded. The cause of
this service restoration is unknown; no billing purchase was made by the agent.
The local monthly-yield repair `5c12696dbe8ccd51fb4fef1e421bf557597a8c8c` was
pushed after this observation and passed GitHub quality run `34047890223`.
Its Convex deploy was held while the interrupted job's recovery was inspected.

The interrupted article job still had workerAttempts zero, no saved article, and its
last progress heartbeat at 16:59:45.546 UTC. Its lease expires at 17:29:45.546
UTC. The ordinary parent-run observer had correctly recorded
`execution_interrupted` at 17:10:44.520 UTC. That parent receipt is not proof
that the separate job lease has expired, so no early reset was performed.

A runtime regression exposed a separate liveness gap: `markRunning` and
`claimPending` acquired a worker lease without atomically arming its expiry
observer. `resetStuckJobs` already scheduled bounded retries after detecting an
expired lease, but detection depended on another scheduler tick. Both claim
paths now arm one exact job/site/worker-token observer in the same mutation.
The observer follows a renewed expiry without scheduling on every heartbeat.
At expiry it uses the existing ambiguous-attempt settlement, checkpoint
preservation, retry budget and canonical follow-up. No provider call is made
by the observer itself. Ambiguous topic plans remain terminal without replay.

The exact scheduled path reads only its job, cannot reap a sibling or foreign
job, and ignores replaced tokens, completed jobs, missing/malformed leases and
onboarding jobs whose separate claim system owns recovery. Duplicate expired
observers cannot increment attempts or schedule the retry twice. Existing
site/global sweep interfaces are retained as fallback; no fleet sweep was
manually invoked during this investigation.

Local runtime tests reproduce the previously missing claim-time wake and cover
both claim paths on two synthetic tenants, actual heartbeat renewal, saved
draft versus no-draft recovery, exact retry timing, replay/ownership fences,
sibling isolation, exhausted attempts and terminal ambiguous plans. The full
suite passes 1,359 tests, type-check passes, lint remains zero errors/157
existing warnings, schema stays additive, dependency audit reports zero
vulnerabilities, and the production build passes. The tracked-source secret
scan passes (581 files). Public Playwright checks passed 10/10 with two
authenticated checks explicitly skipped. The existing signed-in production
Pentra page also recovered from its error screen; no credentials or sign-outs
were needed. Release and recovery evidence follow after completion.

### Bound deployment and controlled attachment of the historical lease

Release `6aac18033fe4b53f30fcdd7e158cc689993ec1ef` includes the monthly-yield
repair and exact lease observer. GitHub quality run `34048215580` passed in
2m28s. GitHub/Vercel production deployment `6295792203` reported success at
17:19:43 UTC; Convex deployment to `wary-starfish-773` completed by 17:22:15 UTC.
The source worktree remained clean except for the untracked production env.

At 17:22:44.012 UTC the historical article job's exact current token was used
internally to attach the observer while its lease was still unexpired. The
mutation returned zero resets, zero terminalizations and zero reservation
releases. A read-back confirmed unchanged token, workerAttempts zero, `running`
status and the original 17:29:45.546 UTC expiry. No token was printed, no
provider work was manually replayed, and no cadence setting was changed.
This attachment is explicitly controlled recovery setup, not a natural claim
or proof that the future observer/retry has executed.

A bounded read-only process observes this one job from just after its lease
boundary until terminal state or 18:00 UTC, with one-minute reads and output
only when state changes or a read fails. It follows any saved article ID only
after checking the same exact tenant. The process invokes no mutation/provider,
and no Codex scheduled automation was created.

Both existing signed-in Chrome tabs recovered after refresh. LeadPilot's
settings still show GitHub connected and 21/week; Pentra still shows 7/week.
No accounts were signed out, no credentials were exposed, and no settings were
saved. The goal remains open pending actual recovery, sealed refill and
subsequent natural new-article delivery on both sites.

At 17:29:51.744 UTC the read-only observer recorded the first real transition:
the historical job was `pending`, workerAttempts 1, updatedAt
`1788715785821` (17:29:45.821 UTC), with nextAttemptAt `1788715845821`
(17:30:45.821 UTC). The recovery mutation therefore executed 275 ms after
the original lease expiry without an early lease reset or manual scheduler
trigger. The next ordinary retry and its article outcome are not yet proven
by this pending-state observation.

An exact Pentra projection at 17:31:29.241 UTC then confirmed the same job
`running`, workerAttempts 1. Ordinary follow-up run
`kd7039qtn2xrvp1bxfeymnzdmx8dwj4h` was scheduled at 17:30:46.043 UTC and
started at 17:30:47.525 UTC. Health moved to `recovering`; approvedBufferCount
remained 3 and nextPublicationDueAt remained `1788781512262`. This proves
automatic retry dispatch after expiry, not successful article generation,
quality acceptance, or a new publication.

At 17:33:59.226 UTC the bounded observer found the same retry at step 8,
`Fact-checking claims`, with saved draft `j578gjsyg41fan5r8nx640h1ms8dx32x`
(1,745 words, updated 17:33:36.910 UTC). The durable draft checkpoint now
exists; no quality scores, sealed state or new publication were asserted at
this checkpoint. The job remains on workerAttempts 1.

The observer terminated after reading the job as `done` at 17:42:20.434 UTC;
this means terminal processing, **not** article acceptance. The article was
saved in `review` at 17:41:20.109 UTC, 1,562 words, factual score 93,
editorial score 84, media passed, claim evidence failed and publication blocked.
Parent run `kd7039qtn2xrvp1bxfeymnzdmx8dwj4h` completed as
`quality_quarantined`. The ordinary follow-up created quality-recovery job
`j975dc4v50j0k9873mkde8fg198dxsb5` for the same saved article at
17:41:32.216 UTC; no manual replay or new topic was requested. The three
previous sealed articles and next publication deadline remained unchanged.

### Reproduced sentence-specific repair feedback gap

A provider-free diagnostic evaluated the actual source matcher against the
saved article and its exact captured excerpts. It identified four mismatched
cited sentences grouped into three paragraph-level issues: one unmatched
named phrase (`Google Search Console`, where the excerpt uses `Search Console`)
and three low-overlap sentences. One also added a location/device mechanism
not stated by that captured excerpt. The earlier remediation notes guessed
different underlying causes because they received only ledger entry numbers,
not the actual failed sentence or matching condition. This is not evidence
that every rejected proposition is false or every other proposition is true.

Two failing regressions reproduce the uninformative feedback using unrelated
synthetic vendor names, missing numeric details and low-overlap claims. The
local repair adds bounded sentence-specific diagnostics and tells the editor
to use only the narrower proposition the excerpt supports, without alias
assumptions or keyword stuffing. Exact-detail checks, the overlap predicate,
independent semantic review, issue counts and quality thresholds are unchanged.
Corrected supported fixture claims pass; all unsupported fixture variants
remain blocked. Long/many-failure diagnostics are bounded and disclose omitted
failure counts. This change does not force a production quality retry, change
the algorithm version, or claim the current article now passes. Full release
gates and production acceptance are still pending at this local checkpoint.

The local release gates then passed: 1,361 repository tests, type-check,
lint with zero errors and the same 157 existing warnings, additive schema
validation, zero dependency vulnerabilities, production build, and ten public
Playwright checks. Two authenticated harness checks remain explicitly skipped.
Native Chrome's existing signed-in acceptance path was verified separately.
A provider-free before/after comparison evaluated the new reviewed draft and
the exact seven existing sealed Pentra/LeadPilot drafts against both validator
versions. Passed/failed results, issue counts and required-claim counts were
identical for all eight. This does not recertify old media annotations or
convert the newly failed article into accepted content; no article was mutated.
