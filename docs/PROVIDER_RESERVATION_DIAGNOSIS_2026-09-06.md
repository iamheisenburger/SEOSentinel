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

The sentence-specific feedback repair was committed and pushed as
`5fa0f3120604a7fec2e180460e78ed439f032412`. GitHub quality run
`34049703910` passed in 2m17s; GitHub/Vercel production deployment
`6296070556` reported success. Convex deployed to `wary-starfish-773`
before the 17:51:09 UTC checkpoint. The tracked-source secret scan passed,
and the production env remained untracked.

At 17:51:01.640 UTC the article remained blocked at revision count 1, with
another ordinary recovery job `j97fv0n2gmedtsgx70y59m82ch8dwbvg` running.
That job started before this deployment; its eventual outcome cannot be
attributed to the new feedback without further evidence. No recovery ordinal
was reset, no version-bump replay was introduced, and no new generation was
manually triggered. Sustained new-article refill and subsequent exact natural
cadence publications remain open acceptance requirements.

The next post-deployment run `kd7567h4gxeazkggpremyfbvs18dxfmj` started
at 17:51:54.513 UTC with job `j97f0qcx9s402gs4kq8tn8dz2n8dx0sq`.
The active-job projection alone does not identify its article. An exact job
read at 17:58:21.712 UTC established that this is **new generation for the
next topic**, `Daily Rank Tracker`, with saved draft
`j57b4nfqjmn4gybphxj47mzr918dwjms`, not another recovery pass for the
earlier Agency Rank Tracking article. The earlier article remained blocked
after two ordinary quality revisions. Statements about the new run must not
be misattributed to that earlier article. The new job was at its exact-audit
remediation step; no acceptance verdict was yet available.

At 18:00:18.802 UTC the Daily Rank Tracker job had yielded to its durable
review continuation. Its saved draft had 1,805 words, factual score 86,
editorial score 84 and media passed. Its first bounded remediation still left
two evidence defects. Production notes now include the new exact cited
sentence and `insufficient source wording overlap` reason, directly proving
use of the deployed diagnostics; this is not proof of successful remediation.
The read-only observer for the earlier article was stopped after its identity
was distinguished from this new generation. No production worker was stopped.

The natural 18:00 scheduler wake completed for both scoped sites without a
manual invocation. Pentra run `kd798ytgvrpt0h7kzscqw25qyn8dxr8j` completed
at 18:00:50.642 UTC as `work_in_progress`, with the exact active Daily Rank
Tracker job present. LeadPilot run `kd78khdp32zsz9reh5sb76395d8dw82v`
completed at 18:01:02.568 UTC as `topic_replenishment_exhausted`, with no
active job. Sealed inventories remained three and four respectively, and
both future publication deadlines remained armed. These unchanged inventories
are not new publication or growth evidence. Final review of the new Pentra
draft remains pending.

At 18:05:58.998 UTC the exact job read showed processing `done`, while
Daily Rank Tracker remained `review` and `blocked`: 1,806 words, factual
score 93, editorial score 84, media passed, claim evidence failed, revision
count zero. The final saved issues identify an unsupported standalone-tool
comparison table and a position-bias claim not matching its preserved source.
The final review therefore did **not** yield a sealed article. This corrects
any inference that terminal job completion or deployed feedback is successful
buffer replenishment. No article was published or manually marked ready.
The goal remains active and incomplete; the next task is improving genuine
source-grounded generation/remediation while observing its bounded ordinary
recovery, not reducing the publication threshold or resetting replay limits.

### Ordinary run watchdog incorrectly interrupted a valid review continuation

The exact subsequent run projection exposed another deterministic lifecycle
defect. Parent `kd7567h4gxeazkggpremyfbvs18dxfmj`, started 17:51:54.513
UTC, was marked `execution_interrupted` at 18:03:54.549 UTC even though the
generation action had already acknowledged a durable review handoff at
17:59:58 UTC. That separately scheduled review action legitimately completed
the job at 18:05:17.876 UTC. This was a false parent interruption, not evidence
of a provider-credit failure. The article itself still failed quality; fixing
the parent receipt must not turn it into a successful publication.

Registered-handler runtime tests reproduce the premature failure using the
actual job handoff and ordinary run observer. The local repair binds the parent
to its exact acknowledged job/article handoff and atomically arms one further
12-minute observation window for that second Node action. The original start
time remains unchanged. A live job lease or heartbeat alone cannot extend the
parent, and the same job cannot repeatedly acquire review handoff windows.
Foreign, malformed, stale and mismatched handoff proofs do not defer timeout;
an unacknowledged review still becomes interrupted after the bounded window.
Manual and separately fenced plan-owned continuations retain their own paths.
Scheduling failure rolls back both parent and job writes; duplicate observers
do not schedule provider work or additional timers. No schema field or index
change is required. Historical failed receipts have not been rewritten.

At 18:12:11.266 UTC Daily Rank Tracker remained blocked after its first quality
revision (1,905 words, factual 93, editorial 84). Ordinary recovery job
`j97ftcqe9mb24wsf9e2ytbrwz58dwmrd` was running under run
`kd76vtxr8xk187vgjjnx53vvhn8dw7sk`; the buffer remained three. The newer
feedback is deployed and observable, but successful new sealed inventory has
not yet followed. This is still an unfinished generation/remediation outcome.

The parent-watchdog repair passed all 1,368 repository tests, type-check,
lint (zero errors; 157 existing warnings), the additive 60-table/291-index
schema check, the 582-tracked-file secret scan, dependency audit (zero
vulnerabilities), production build and 10 public Playwright checks. The two
credential-dependent Playwright checks remained explicitly skipped. Native
Chrome inspection of the two signed-in settings pages is separate evidence,
not a substitute for those skipped tests or clean new-user onboarding.

The 18:16:21 UTC bounded projection showed Daily Rank Tracker's second quality
revision had completed as `quality_quarantined`: 1,909 words, still blocked,
no active article job, and no increase in Pentra's three sealed articles.
Its original publication deadline remains armed for September 7 11:45:12 UTC.
Passing the watchdog release gates does not settle this quality outcome.

The watchdog repair was committed as
`831a2b0a47667d274d44fdfa1ee6c57fb417fffa`. GitHub quality run
`34051209296` succeeded. Production deployment `6296350831` succeeded at
18:17:42 UTC; Convex `wary-starfish-773` deployment completed by 18:20:35 UTC.
No historical run outcome was changed to success.

### Cross-paragraph citation contamination in exact-ledger coverage

The saved Daily Rank Tracker article's evidence-required paragraph four has
an exact, supported, unnumbered first-party ledger entry. Nevertheless the
coverage matcher reported a missing numbered inline citation. It used every
entry with 30% shared vocabulary, so a different paragraph's research citation
contaminated the first-party paragraph. The same defect also affected Agency
Rank Tracking's paragraph ten. This is a false binding requirement, not proof
that the article as a whole is safe or ready.

Independent HarborDesk and CedarWorks fixtures reproduce this failure without
tenant names, production data, or provider calls. Another regression verifies
the converse: an exact entry with a missing source binding must not borrow it
from a similar neighboring entry. The local repair prefers the exact complete
paragraph receipt required by the current auditor contract. Legacy summarized
ledgers retain the existing similarity fallback only when no exact entry is
present. Every ledger entry still undergoes independent source/hash/detail,
unsupported-claim and citation checks; no score, threshold, retry allowance,
quality version or stored receipt changes.

A provider-free before/after comparison covered the seven currently sealed
articles and both blocked new drafts, scoped only to Pentra and LeadPilot.
All seven sealed articles had identical raw-ledger results (including three
pre-existing reviewed-media annotation mismatches). Both new drafts remained
blocked; only their erroneous cross-paragraph missing-citation issue was
removed. Agency Rank Tracking retained eight defects; Daily Rank Tracker
retained four. No published or ready artifact was rewritten or promoted.

The exact-receipt repair passed 1,371 repository tests, type-check, lint
(zero errors; 157 existing warnings), additive schema check, the 582-file
secret scan, dependency audit (zero vulnerabilities), production build and
10 public Playwright checks. The two authenticated Playwright checks were
explicitly skipped. Native Chrome control was independently reconfirmed on
the signed-in LeadPilot settings page; no reconnect, sign-out or owner action
was necessary and no settings were changed.

The exact-receipt repair is deployed as
`94bf51638136d96b0eb159a2ebca55eb051173df`: GitHub quality run
`34051551275` succeeded, production deployment `6296412315` succeeded at
18:23:48 UTC, and Convex `wary-starfish-773` deployment completed by 18:27:43
UTC. Convex regenerated the type-only `lib/autopilotRunLease` API declaration;
that generated declaration remains a local follow-up change, not a new
runtime behavior or independently deployed repair.

Scoped production reads at 18:27:35–37 UTC still showed Pentra with three
sealed articles and no active job, and LeadPilot with four sealed articles
and no active job. Their exact publication deadlines remain armed. This
unchanged inventory does not prove replenishment or sustained cadence.

Next bounded engineering check: `reviewExistingArticleHandler` supplies fresh
`audit.materialDefects` to its within-action remediation but does not persist
those required corrections in `editorialQualityNotes` passed to
`articles.applyQualityReview`. Its next quality retry reads only those stored
notes and publication gate issues, truncated to twenty entries. This can
discard the auditor's most actionable required corrections while preserving
general praise. Reproduce the real handler's persistence and next-attempt
feedback flow with a stubbed provider transport before implementing the
repair; preserve the bounded paid-attempt ledger and reject poor revisions.
This omission is diagnosed in code but has not yet been repaired or tested.
Separately, the initial recovery edit is adopted before comparison with the
stored artifact; do not describe recovery as non-regressing until that path
is tested. Neither concern authorizes resetting spent retries or rewriting
historical success/failure receipts. The overall cadence goal remains active.

### Required review feedback survives the next bounded attempt

The real `reviewExistingArticleHandler` was reproduced with stubbed provider
transport and durable query/mutation boundaries. Before the repair, both
persistence and subsequent-feedback assertions failed: the concrete editorial
corrections were missing. No production provider or external crawler was
called by these tests.

The repair persists the selected exact audit's `materialDefects`, prioritizes
explicit editorial/evidence corrections ahead of general comments within the
existing twenty-note retry bound, and removes duplicate stored notes. Fresh
within-action feedback likewise puts corrections first. Five runtime tests
cover independent Harbor/Cedar fixtures, long legacy gate summaries, duplicate
notes, rejected-candidate isolation, resolved-defect replacement, and a clean
audit without invented defects. The unchanged fixture still fails quality;
the tests prove feedback plumbing, not real article quality or SEO growth.
The original six/seven-call failed-review fixtures and three-call clean
fixture remain bounded; no paid attempt, quality version, threshold or retry
allowance was increased.

Local checks passed: all 1,376 repository tests, type-check, lint with zero
errors and the same 157 existing warnings, additive schema compatibility
(60 tables, 291 indexes), dependency audit (zero vulnerabilities), and
production build. Deployment and browser checks are recorded separately
after completion. This fixes the feedback omission only; the separately
identified initial-edit non-regression concern remains open.

Public Playwright acceptance passed all ten runnable checks; two
credential-dependent checks remained explicitly skipped. The type-only
`autopilotRunLease` declaration generated by the previous deployment is
included in this release's source control, with no runtime change.

The feedback repair is deployed as
`ebea4b5ec1f22ac659dc6fe4892eabe623279830`. GitHub quality run
`34053972230` succeeded in 3m19s. Production deployment `6296863113`
succeeded at 19:10:00 UTC; Convex `wary-starfish-773` deployment completed
before the scoped 19:13:24 UTC production queue check. The 583-file secret
scan passed and the production environment file remained untracked.

Exactly one controlled `jobs.queuePlanIfAbsent` request per authorized site
used the ordinary `topic_horizon_replenishment` reason, without manual mode,
retry reset, migration-version change, or budget override. Pentra returned
`recent_limit` with three counted attempts; LeadPilot returned `recent_limit`
with five. Neither queued a new job or called a paid provider. These are
rolling internal planning limits, not newly verified provider-credit errors.
The scoped 19:13:47–49 UTC follow-up still showed three/four sealed articles,
no active jobs, and both exact publication deadlines scheduled. Existing
earliest refill deadlines remained armed: Pentra at `1788740966893`,
LeadPilot at `1788739284126`. No natural publication or successful new-draft
replenishment is claimed by this repair.

### Recovery preserves the freshly stronger draft

The next runtime counterexample reproduced the separate initial-edit defect:
a length-valid recovery replaced the stored article with a candidate whose
fresh editorial score was 80 rather than the baseline's 82. The previous
within-action guard only compared later edits against this already-weakened
candidate. Another case raised the editorial score while lowering factual
accuracy; the old selection logic did not protect that dimension either.

The repair obtains a fresh factual and exact-evidence audit of a complete
baseline before the initial recovery edit, using the same current product
and source snapshots as the candidate. It does not trust historical scores.
A truncated or non-improving/regressing candidate cannot replace this freshly
audited complete baseline. Already-incomplete baselines cannot be used as a
fallback to erase successful length recovery. The existing strict publication
gate still decides whether the selected artifact can publish.

Generation, first recovery selection, and later recovery selection now share
one fail-closed comparison: editorial/factual scores cannot fall, deterministic
evidence/material-defect counts cannot rise, and at least one dimension must
improve. Invalid assessment values reject the candidate. Independent runtime
fixtures cover weaker edits, higher editorial scores hiding lower factual
accuracy or new unledgered claims, stale saved scores, truncation, legitimate
improvement, and incomplete original drafts. Pure comparison tests cover each
dimension and invalid values. The generation call site uses this tested shared
comparison; it is not claimed as a full provider-backed generation acceptance.

The fresh baseline replaces one later recovery pass. For the ordinary
length-valid path the maximum remains three factual checks and three exact
audits, with two rather than three editor calls. This does not expand the
provider envelope, length-recovery bound, or durable paid-attempt allowance.
The unchanged-revision fixture now uses nine calls rather than seven, still
below the previous ten-call maximum; this is not described as a cost saving
for every outcome. No threshold, publication audit version or recovery
migration version changed, and no historical receipts were rewritten.

Local checks passed all 1,383 tests, type-check, lint with zero errors and the
same 157 existing warnings, additive schema compatibility, zero-vulnerability
dependency audit, and production build. Browser, secret-scan and deployment
results follow when complete. Production generation has not exercised this
repair yet: both controlled refill requests remain subject to the previously
recorded rolling planning window.

The ten public Playwright checks and 583-file secret scan also passed. The
two credential-dependent Playwright checks remained explicitly skipped.
