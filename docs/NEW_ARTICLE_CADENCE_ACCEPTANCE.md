# New-article cadence acceptance

The customer promise is a new, useful article at the configured cadence.
An existing-page revision is a separate improvement, never a replacement
article and never a reason to postpone the new-article clock.

## Repair under verification, September 6, 2026

- Remove revision substitution from the scheduler and cadence health.
- Scale bounded refill attempts with cadence while preserving the shared
  account/fleet provider ledger, quotas, leases and quality gates.
- Reconsider a terminal semantic miss after 15 minutes when current sealed
  inventory is short. Queue a distinct discovery plan; never replay the failed
  provider job. Full-buffer click-goal work retains its daily limit.
- Avoid selecting candidates already guaranteed to fail the unchanged legacy
  coverage fallback. Fully fingerprinted coverage still uses live SERP intent.
- Count monthly plans against the purchased allocation, not a shrinking
  remaining-article allowance that double-charges fulfilled work.
- Preserve the next available rolling-window slot with an ordinary scheduler
  wake, independently of the older exact terminal-receipt observer.
- Apply tenant-known-topic, product-fit and existing-intent exclusions before
  the discovery shortlist limit and paid difficulty enrichment. Exhausted
  source rows no longer suppress bounded discovery fallbacks. Persist counts
  in a terminal discovery error so empty inventory has a concrete explanation.
- A positive-to-positive cadence-only edit retains its already verified live
  or warm rollout and destination receipt. It still cancels stale jobs under
  the configuration lock, increments the epoch, refreshes health and schedules
  immediate canonical deadline evaluation. Mixed configuration changes and
  resumption from observe mode still require readiness reconciliation.

## Observations

The first controlled refill after `b554435` failed with zero selected topics
(job `j97cmrscg745tey26jdw6n85218dw1hd`). Pentra still had zero sealed
articles. Its distinct-plan reconsideration was durably scheduled for
2026-09-06 00:44:25.893 UTC. This proves neither replenishment nor delivery;
it records a failed production test and the automatic recovery boundary.

Local regression fixtures cover 400 already-covered keywords crowding out
three usable topics, a covered source requiring bounded fallback, and an
entirely excluded source that must not buy another difficulty request.

## Not yet accepted

At the initial inspection Pentra had zero sealed articles; LeadPilot had two.
Both had publishing receipts, but this is not sustained refill proof.
The actual settings mutation is regression-tested for cadence changes,
unchanged saves, disable/resume, publisher changes, owner authentication and
in-flight delivery locks. The signed-in LeadPilot settings path subsequently
accepted a controlled 20/week to 21/week restoration without losing live mode;
this is settings acceptance, not sustained article-delivery acceptance.
The published bootstrap adapter matrix is still GitHub-only; general customer
onboarding and every advertised adapter require their own acceptance.

Acceptance requires sustained current-release generation, sealed inventory,
exact scheduled new-article delivery and public verification on both allowed
tenants, plus generic cadence-change/recovery tests. Quality scores and
publication tests do not establish SEO growth; measured organic visits,
search clicks and conversions must be reported separately.

## September 6 funded recovery and customer acceptance

The deployed Anthropic and OpenAI credentials both returned successful minimal
responses at 11:17 UTC after the owner restored funding. Preserved work resumed
through ordinary scheduler continuations, without a manual scheduler invocation.

LeadPilot published new article `j5753dvprnqbzd8c5jjmrxmmrd8dt9w8` at
06:14:43.010 UTC against its 06:14:34.458 deadline (8.552 seconds later).
The exact GitHub commit is `ac63fb190a0a380b595f8d9b374eeab755b75888`;
the durable live verification completed at 06:17:14.442 UTC, and a separate
11:19 UTC HTTP check returned 200 with the expected title at
https://leadpilot.chat/blog/automated-sales-workflow-decision-gates.
This is one new-article delivery, not a revision or evidence of SEO growth.

Pentra's preserved job produced article `j571r4bvpd7fydzxcz7ey5cs3h8dxnxb`.
Its exact-prose review found no material editorial defects, but deterministic
claim classification rejected author-proposed writing instructions containing
the bare word "evidence". Later remediation exposed an equivalent false
rejection when question marks were outside bold formatting in numbered reader
questions. These failures kept the ledger blocked and capped the score at 84.
They are software defects, not proof that the draft is inherently low quality.

The repair distinguishes an evidence input from an evidence assertion and
classifies numbered reader procedures independently of bold formatting. It
checks full procedure bodies so headings cannot hide unsupported facts.
Citation, numeric, product-claim, evidence-binding, and publication thresholds
remain enforced. Recovery v16 allows one re-audit of v15 claim-ledger-only
failures (including the deterministic 84 cap), durably fenced at queue admission.
It does not reopen unrelated defects or reset any failed provider job.

Customer acceptance also reproduced an authentication race on a fresh signed-in
Chrome tab: `sites:getCadenceCapacity` ran before Convex accepted the session and
crashed the route. The private dashboard now waits for Convex authentication
before mounting owner-only queries; failed authentication provides retry/sign-in
actions. Regression tests execute the real dashboard boundary. Separate runtime
tests execute new-site creation, consent, and durable setup handlers across
all supported integer cadences (1–21/week), owner isolation, configuration
supersession, browser closure, and delayed billing reconciliation.

These checks do not complete the goal. Pentra still needs production re-audit,
sealed inventory, new-article delivery, and continued replenishment.

### Bound deployment and live settings result, 11:40 UTC

- Source: `7c3e345436a897d55a7b8342f39f33b3cac41180`.
- GitHub quality run `34030726615`: succeeded. All 1,219 tests passed;
  type-check, additive schema, secret scan, dependency audit and production
  build passed. Lint: zero errors, 159 existing warnings. Public Playwright:
  10 passed, two authenticated harness cases skipped; separate signed-in
  production browser checks are recorded below.
- Convex deployment to `wary-starfish-773`: succeeded.
- GitHub production deployment `6292458647`: succeeded at 11:37:06 UTC;
  Vercel deployment `BVFdRxV8SozBAFHPwZd7nuGfpk2G`, served by `pentra.dev`.
- A fresh signed-in page load visibly transitioned from "Connecting your
  workspace" to settings, with no new Convex authentication/capacity errors.
  LeadPilot retained 21/week and Pentra retained 7/week; both showed GitHub
  connected. No settings were changed and no accounts were signed out.
- LeadPilot ordinary refill reached four sealed ready articles. The preserved
  funded job completed with `buffer_ready`, and a distinct refill job started.
- Pentra's saved draft still had its deployed-v15 failed ledger at the last
  read. Running the patched validator locally against that exact saved prose,
  ledger and hashed evidence passed with zero defects. This is a reproduction
  check, not a production seal or publication receipt. A different ordinary
  article job was already in flight when the repair deployed; the one-shot
  v16 re-audit must still be observed through normal scheduling.

The provider funding blocker and browser-control blocker are resolved. The
autonomous new-article cadence goal remains active and incomplete.

### Production delivery and recovery, 11:45–11:47 UTC

Pentra automatically published new article `j575539aga6nqkh50v4md4e4rs8dx8wf`
at 11:45:12.262 UTC, through GitHub commit
`8e117276cf6cecc867f6cff56b6b57b5340a45d2`. Its exact content receipt hash is
`9f7a8c24be946031978e75e3d8dbd34346adaa5339b9bdbd3d43d0608cb78c65`.
The 1,870-word article passed editorial (88), fact review (86), claim evidence,
media and publication gates, with quality recovery version 16. The durable
public-URL verification and an independent HTTP 200/title/canonical check both
confirm https://pentra.dev/blog/fiverr-keywords-research.

This is recovery of an overdue delivery, not an on-time result: the prior due
time was 09:35:25.931 UTC. The next normal 7/week deadline is September 7 at
11:45:12.262 UTC. Publication was not manually triggered.

The scheduler then admitted recovery job `j975kwv74v8aj1hewxkxah45e58dxwfc` for
the previously stranded draft `j571r4bvpd7fydzxcz7ey5cs3h8dxnxb`, persisting
attempt version 16 before worker execution. At 11:47:10.421 UTC the same draft
became ready with editorial score 88, fact score 100, passed claim evidence,
passed publication gates and no gate issues. Its total revision count is 3;
the migration did not reset history or create a replacement article.

### Markdown-preserving citation cleanup

A separate quality defect was reproduced from the deployed cleanup function:
pruning `[1]: URL` with no external source removed only the marker and left a
visible `: URL` line; its global whitespace cleanup also changed code indentation
and numeric examples. The replacement uses Markdown source ranges, preserves
code/images/ordinary links and formatting, removes unbound reference metadata
as a unit, and preserves verified citation slots. Claim detection uses the same
Markdown boundaries, so literal code cannot become a phantom citation or pass
as evidence. Tests cover native and bundled execution, escaped literals,
reference and inline links, adjacent/mixed slots, idempotence and malformed
source counts. This change does not lower any publication-quality threshold.

The Markdown repair deployed as `5eb08de2d5b1cc86f5e777c08f46893da375dcab`:
GitHub quality run `34031325869` succeeded (1,226 tests), Convex deployment
succeeded, and production deployment `6292569901` / Vercel
`HQLnUXxfs6pADZR9vwpt9GtNebjV` completed successfully.

### Preserve paid drafts before long reviews

LeadPilot job `j970z8gpkbqm702msz6q10mp0h8dx78e` started around 11:27 UTC
and retained its 11:33:59 scoring-step heartbeat without an article checkpoint
through the 12:00 natural cadence. Its lease did not expire until 12:03:59.
The application lease alone therefore could not establish live execution.
Convex documents a ten-minute Node action ceiling:
https://docs.convex.dev/production/state/limits.

Local inspection exposed two unsafe boundaries: the writer's output was not
persisted until all review/media/metadata requests finished, and both provider
SDKs inherited ten-minute request timeouts plus two transport retries. The
repair saves the exact writer output and verified source/product snapshots
before factual review. Later updates require the same current worker, tenant,
configuration epoch, unexpired lease, unchanged draft timestamp and artifact
hash. Edited, sealed or published content cannot be overwritten. Generation
quota settles once; interrupted review resumes the existing draft.

Provider requests now have a three-minute, no-transport-retry bound, and each
article worker shares an eight-minute provider budget including response-body
consumption. Concurrent workers have isolated deadlines; nested work cannot
extend its deadline. The remaining Node window is reserved for checkpointing,
settlement and durable continuation. Timeout classification preserves bounded
job recovery without using an ambiguous paid timeout to fan out to a second
provider. Actual editorial stages renew progress only when that stage starts.

Runtime tests exercise the registered draft mutation, stale-token/configuration
and content fences, one-time usage settlement, concurrent deadline isolation,
stalled response bodies, cancellation and both installed provider SDKs. None
of these changes lower publication gates or make unreviewed drafts publishable.
Production recovery and sustained next-deadline acceptance remain pending.

Local release gates passed: 1,235 tests, type-check, additive schema (59 tables,
289 indexes), dependency audit, production build, and 10 public Playwright
checks. Two authenticated harness checks remain skipped; the separate signed-in
production settings acceptance is recorded above. Lint remains at zero errors
and 159 pre-existing warnings. Running the new registered-handler tests against
the previous mutation reproduced two failures; the repaired mutation passes all
three runtime cases.

### Bound execution-budget release and controlled recovery, 12:09 UTC

The execution-budget repair is deployed as
`b319ece77e981afee651d5ed4cca5688759043cf` (including parent `19e77e3`).
The initial Convex bundle check rejected the new Node-only helper before
deployment; its explicit Node runtime directive and regression assertion were
added before a successful dry-run and production deployment. Convex now serves
this release on `wary-starfish-773`. GitHub quality run `34031967509` succeeded,
including all 1,235 repository tests and the public browser checks. GitHub
production deployment `6292691894` / Vercel
`G4KErem3HYmfBKGQuR3ng1NQPsgm` succeeded at 12:03:56 UTC.

Pentra's ordinary refill reached three sealed ready articles by 12:02:20.937
UTC: `j57cbdpkn5z37vqd3m27wq00xd8dwxhp`,
`j57bndnv12v8agerp1gs7z510d8dxp1x`, and
`j571r4bvpd7fydzxcz7ey5cs3h8dxnxb`. This meets its minimum of three;
the target of four is not yet filled. Its follow-up run
`kd730awbsw134h2kt53xn1fm5h8dwbm7` completed with `buffer_ready`.
This proves replenishment after the earlier overdue publication, not the next
on-time publication or organic search growth.

LeadPilot still had four sealed ready articles and its 14:14:43.010 UTC
September 6 publication deadline. Its old pre-repair job
`j970z8gpkbqm702msz6q10mp0h8dx78e` remained without a draft checkpoint after
its lease expired at 12:03:59.159 UTC. One explicitly controlled recovery was
dispatched through the canonical site scheduler, not directly to a provider:
run `kd7bt39jm1tsqpcg7jp4y65j6s8dwrr0`, scheduled at 12:09:12.812 UTC.
The scheduler settled the expired execution and stored worker attempt one's
eligibility time as 12:10:13.614 UTC. Subsequent inspection after that time found
the job still pending: the lease-reset mutation had not actually armed a wake.
No second manual recovery was dispatched. The retry's checkpoint, review
completion and inventory result remain to be observed.
This intervention is controlled recovery evidence, never natural-cadence proof.

Chrome control and both signed-in settings pages are working. The LeadPilot
settings tab was handed back without changing cadence, credentials or accounts.
The goal remains active: sustained current-release new-article delivery on
both sites and generic supported-customer acceptance are not yet complete.

### Atomic retry-wake correction

The controlled recovery exposed a generic liveness defect rather than a
provider-funding problem: `resetStuckJobs` committed `pending` and
`nextAttemptAt`, but never scheduled a function at that time. Ordinary transient
failure had a related interruption gap: its mutation persisted the retry,
while a later action call separately scheduled the wake.

Both retry transitions now atomically schedule the canonical site follow-up in
the same mutation. The action no longer schedules a duplicate. No retry limits,
paid-attempt receipts, tenant authorization, delivery priority or publication
gates are relaxed. Expired ambiguous planning jobs still follow their existing
terminal no-replay path. Existing pending work is not reset again by this change.

Registered-handler tests reproduce both missing-wake cases against the prior
code (two failures) and pass after the correction. They cover distinct tenant
IDs, saved-draft preservation, one-time reservation release, immutable attempt
settlement, fresh/foreign leases, exhausted retries and duplicate stale
completions. Actual scheduler delivery and exact-deadline tests now exercise
every integer cadence from 1 through 21 per week, not only sample rates.

Local gates passed for this correction: all 1,239 tests, type-check, zero lint
errors (159 existing warnings), schema compatibility, dependency audit,
production build, 10 public browser checks and Convex deployment dry-run.
The two authenticated browser harness cases remain explicitly skipped; the
actual signed-in settings acceptance above is separate evidence. A previously
stranded pending job does not acquire a historical wake merely by deploying
this fix; any controlled restart will be recorded separately.

The atomic-wake correction deployed as
`c2cfb5582c555a3d0818dde31945710306f61473`. Convex deployment succeeded;
GitHub production deployment `6292799828` / Vercel
`4kUtkaV5TGX6cFS4E3oLvx5D7yzt` completed at 12:15:55 UTC. GitHub quality
run `34032548286` subsequently succeeded (all 1,239 tests, all release gates,
10 public browser checks; the two authenticated harness cases remain skipped).

After CI passed, a second explicitly controlled scheduler invocation resumed
the already-eligible pre-correction pending job, without resetting it or
changing its attempt count: run `kd71xv9rg4z2p8jz87z018fx1d8dxbcj`, trigger
`operator_controlled_pending_retry_resume`. This is the follow-up needed for
the historical missing-wake state, not a claim that deployment retroactively
created a wake or that the restart was natural.

The restarted job entered writing at 12:19:19.164 UTC with worker attempt one.
At 12:20:51.366 UTC it persisted article `j570rhgqhyv3w5gs7keqsa2j158dxg5a`,
a 1,894-word draft with the product-evidence snapshot retained. A 12:21 UTC
job projection showed the same article ID while the worker was still at
"Reviewing editorial quality". The separate article projection confirmed it
was still an unsealed `draft`, not a ready/published artifact. This proves the
early durable checkpoint on the deployed worker without claiming quality
acceptance or scheduled delivery before either has happened.

### Saved-draft completion and research capability correction, 12:36 UTC

The controlled LeadPilot retry durably handed its saved draft to the final
review worker at 12:25:04.272 UTC. Article
`j570rhgqhyv3w5gs7keqsa2j158dxg5a` became sealed `ready` at
12:29:45.764 UTC: 2,049 words, editorial score 88, factual score 86, media and
publication gates passed, audit version 7, recovery version 16. Its original
job completed without another generation attempt. LeadPilot now has five
sealed ready articles; its minimum is nine and target twelve. This proves the
checkpoint/review handoff, not a new publication or full inventory acceptance.
A separate older draft's ordinary recovery subsequently ended explicitly as
`quality_quarantined`; it was not counted as ready or replayed manually.

The completed draft's intermediate research notes exposed a deterministic
provider request defect: the primary-source fallback passed domain filters to
`gpt-4o-mini`, which rejects that parameter. A local candidate using
`gpt-4.1-mini` passed simulated transport tests but also failed the live API
capability check with HTTP 400; that candidate was never deployed.

The final correction preserves the unfiltered `gpt-4o-mini` research tier and
uses `gpt-5-mini` with low reasoning only for the filtered primary-evidence
attempt. Search is required, the primary-domain list is unchanged, and only
provider-attributed citations become candidate sources. Subsequent strict
source filtering and captured-content validation remain unchanged. The
reasoning path has a bounded 4,096-token combined reasoning/output allowance;
the existing three-minute request deadline and zero transport retries remain.
Official capability guidance:
https://developers.openai.com/api/docs/guides/tools-web-search.

A live invocation of the exact repaired `webResearch` function using the
deployed OpenAI credential succeeded with one HTTP 200 request
`req_8f328c1749864e65abdadc14bcca85b7` and eight provider-attributed candidate
sources for LeadPilot's lead-scoring topic. This was a controlled, read-only
research acceptance call; it did not queue an article or claim those sources
had passed the later content-capture gate. Credentials were never displayed.

New runtime regressions exercise the actual research function and SDK request
serialization for both research tiers, citation provenance, insecure/duplicate
URL rejection, empty evidence, and visible non-replayed API failure. Additional
runtime tests exercise the actual GitHub transport across two generic owners,
empty repositories, exact byte delivery, lost acknowledgements, branch drift,
customer-owned file protection, and lost publication ownership. These are
simulated boundary tests, not additional live tenant publications.

Local release gates passed: all 1,248 tests, type-check, additive schema check,
secret scan of 560 tracked files, zero dependency vulnerabilities, production
build, and 10 public browser checks. Lint has zero errors and 157 warnings
(two fewer than the prior release); two authenticated harness cases remain
explicitly skipped rather than counted as passing.

The research correction deployed as
`609a4cbdf081f2e07b4d466331ca6c2cdec806f8`. Convex deployment succeeded;
GitHub production deployment `6293009287` completed at 12:37:49 UTC, and
GitHub quality run `34033640153` succeeded. An additional live invocation of
the exact unfiltered research branch also returned HTTP 200 in one request
(`req_7fb105eb846b4921a0659f6f99dbde8c`, four candidate citations), confirming
that requiring a search did not break the retained lower-cost tier.

### Capacity-deferral interruption safety

The same pending-without-wake interruption window fixed for expired leases
and transient failures also existed when provider account/fleet concurrency
deferred a job: the mutation saved the job, then the action scheduled its wake.
Registered-handler regression tests reproduced the missing wake, as well as
missing article/site guards, before the correction. The mutation now owns the
pending transition and exact canonical wake; the action no longer duplicates
it. Existing 30-second minimum pacing, retry counts, paid-attempt receipts,
saved drafts, and usage settlement are unchanged. Duplicate or stale workers,
non-article jobs and jobs without a site cannot mutate or schedule work.
Tests cover both concurrency reasons, both generic tenants and both saved-draft
states. This is interruption-boundary regression evidence, not a claim that
this particular failure was observed in a new production run.

The capacity correction passed all 1,250 repository tests, type-check,
zero-error lint (157 warnings), additive schema, secret scan, dependency audit,
production build, 10 public browser checks, and Convex deployment dry-run.
The two authenticated harness skips remain disclosed separately.

The capacity correction deployed as
`5e54e1c14448478cb0ad4bdae454c8747fbd3691`. Convex deployment succeeded;
GitHub production deployment `6293048682` completed at 12:41:59 UTC and
GitHub quality run `34033846494` succeeded (1,250 tests and all release gates).

Post-backend-deploy bounded projections showed both tenants still in live
mode: Pentra epoch 6 with three sealed ready articles; LeadPilot epoch 9 with
five. Neither had a pending or running article job in that projection. The
LeadPilot health warning refers to the separately quarantined older candidate,
not the newly sealed saved draft. Both measured topic portfolios still report
insufficient evidence; no SEO-growth claim is made.

The next configured new-article deadlines remain September 6 at 14:14:43.010
UTC for LeadPilot and September 7 at 11:45:12.262 UTC for Pentra. These are
future deadlines, not completed publications. The goal remains active pending
sustained current-release natural delivery and replenishment acceptance.

## September 6 bounded inventory and continuation audit

An actual registered-query regression reproduced the high-cadence budget
mismatch: a fifteen-candidate allowance was projected through a ten-row read.
The read now uses the same cadence-derived allowance, newest first, so the
oldest returned candidate gives the correct next rolling-window slot even
when older excess attempts exist. Fixtures cover two arbitrary tenants,
four cadence values, legacy/current domain bindings, foreign tenants and
expired attempts. The paid allowance and publication gates did not change.

An actual pipeline-function regression also reproduced missing immediate
dispatch after an admitted topic-replenishment plan. The continuation now
dispatches ordinary topic, portfolio-goal and portfolio-evidence plans through
the existing canonical dispatcher. Denied, cooling-down and unknown scheduler
results cannot dispatch work. Micro-seed evidence retains its own wake.

The credential-free operator snapshot now resolves the exact health-bound
publication deadline independently of its eight recent runs and projects
twelve upcoming runs. Allowlisted deadline kinds distinguish publication
from refill/quota wakes. This exposes durable scheduling intent; it does not
manufacture a successful execution or attest to provider availability.

These corrections passed all 1,255 repository tests, type-check, zero-error
lint (157 unchanged warnings), additive schema validation, tracked secret scan,
dependency audit, production build, ten public browser checks and Convex dry-run.
The two authenticated harness skips are not counted as passes.

The correction deployed as `768b1d89a8344184bf6508288f69c2d1263ec248`.
Convex deployment succeeded, GitHub quality run `34034600618` succeeded,
and GitHub production deployment `6293191804` reported success.

The post-deploy indexed projection at 12:57 UTC confirmed these exact rows:

- LeadPilot publication: `kd71xdrvjr666kj90g2pxshdgx8dxd2f`, scheduled for
  September 6 at 14:14:43.010 UTC.
- LeadPilot refill: `kd7dc11gc9ztaxze9f5jmmqg4h8dxcky`, scheduled for
  September 7 at 00:01:24.126 UTC. This matches the next rolling plan slot.
- Pentra publication: `kd7d8feh9t1jwj9w6wtm3f0rj58dx3td`, scheduled for
  September 7 at 11:45:12.262 UTC.

Pentra remained at three sealed articles (minimum three, target four);
LeadPilot at five (minimum nine, target twelve). No active article jobs were
projected. An older interrupted LeadPilot run still has a historical running
row; it is not counted as active work or successful convergence.

Provider-free prechecks before the 13:15 evidence fleet found ten Pentra
demand candidates and no LeadPilot demand/evidence candidates. LeadPilot's
last bounded micro-seed also had no strict candidate. These observations do
not authorize bypassing exclusions or replaying failed paid work. Await the
ordinary evidence/refill boundaries and exact publication executions; the goal
remains active, with sustained current-release delivery not yet accepted.

## Frozen-release deadline verification

With runtime release `768b1d8` unchanged, four additional local registered-
mutation tests verified exact deadline creation for both arbitrary tenants at
every integer cadence from 1 through 21 per week. Three duplicate calls per
deadline retained one run and one action; publication and the three allowed
refill/quota triggers did not suppress each other at a shared timestamp.
Disabled/manual/approval-only, parked, ownership-conflicted and entitlement-
mismatched sites could not arm publication. Injected scheduler-write failure
rolled back the run receipt and allowed a subsequent successful request.
All 1,259 local tests, type-check and targeted lint passed. These four tests
are not part of the earlier 1,255-test GitHub run and required no deployment.

A bounded read-only process in the active task observes only Pentra and
LeadPilot at 13:15/13:16/13:18 and around LeadPilot's 14:14:43 UTC deadline.
It creates no Codex automation and triggers no generation or publishing.
Its output must be inspected before calling either natural stage successful.

### Natural 13:15 UTC evidence fleet result

Pentra's post-release demand job `nn70zz33ab44ffh7b3t775awws8dwwvz`
ran with origin `autonomous_fleet` from 13:15:16.488 to 13:15:22.507 UTC.
Its ten exact keyword lookups completed, but all ten returned
`exact_metric_missing`: zero metric receipts and zero persisted topics.
The epoch-6 evidence inspection subsequently skipped at 13:15:23.038 UTC
with `no_current_demand_candidates`. Missing exact metrics are not proof of
zero market demand, failed funding, or a software defect; this paid batch
was not replayed and no search volume was invented.

LeadPilot's epoch-9 ordinary demand inspection skipped at 13:16:45.762 UTC
with `no_eligible_legacy_topics`; its evidence inspection skipped at
13:16:46.492 UTC with `no_current_demand_candidates`. The latest older
demand/evidence jobs were not relabelled as new fleet work. Neither tenant
gained ready inventory from this natural evidence window.

The 13:18 bounded projections still showed three sealed ready articles for
Pentra and five for LeadPilot, with no active article jobs. LeadPilot's exact
14:14:43.010 UTC publication row remained scheduled, not executed.

The local observation reader initially failed because the Convex CLI exited
before flushing piped stdout: an isolated reproduction returned precisely
8,192 bytes of incomplete JSON. Making the child CLI's stdout blocking
before importing its entry point returned a complete 13,853-byte JSON
snapshot. Only the faulty read-only observer process was terminated and
replaced; no production job was reset, replayed or restarted. The corrected
observer remains bound to the same two tenants and publication checkpoints.

Chrome's tab-debugger transport later reported `Debugger unattached`, but
native Chrome control successfully opened the already-signed-in Pentra
dashboard and Settings page. GitHub remained visibly connected. No account
was signed out and no publishing, credential or security setting was changed.

### Interruption accounting repair prepared locally (not deployed)

At 13:25 UTC the bounded LeadPilot snapshot still contained historical run
`kd7d4f2w60zhtrwp0dz82qyv858dx0wz`, running since 11:27:40.901 UTC
with no later heartbeat. Its saved article job had completed under a later
run. The stale run does not hold the article queue, but remains a false live
receipt and an operational acceptance blocker. A registered-handler test
confirmed that ordinary run claiming armed no terminal observer. Convex's
documented Node action limit is ten minutes:
https://docs.convex.dev/production/state/limits.

The local repair atomically arms one provider-free observer when an ordinary
run starts. After twelve minutes, it can mark that exact tenant/start-time
receipt `failed` with outcome `execution_interrupted`. It does not report a
successful article, change any job, advance the publication clock, or replay
provider work. Fenced long-lived plan continuations retain their own observers.
If a newer run owns tenant health, the historical settlement preserves that
health and its alerts. Late completion callbacks cannot overwrite the failure.

Runtime tests cover two unrelated tenant fixtures, duplicate claims and
observers, mutation rollback when observer scheduling fails, live and changed
execution fences, terminal receipts, fenced continuations, and newer-health
preservation. Production remains on `768b1d8` for the pending 14:14:43 UTC
publication observation; the historical production row has not been mutated.

### Documentation-source correction prepared locally (not deployed)

A public-artifact review at approximately 13:33 UTC found an overbroad
absence claim in Pentra's already-published Fiverr keyword article. A missing
retrieved source is not evidence that a platform publishes no documentation
or offers no measurement. Fiverr's own help centre publishes both search
and recommendation guidance and keyword analytics documentation:
https://help.fiverr.com/hc/en-us/articles/23429542870161-Fiverr-s-search-and-recommendation-system
and https://help.fiverr.com/hc/en-us/articles/6523401252881-Advanced-Analytics-for-Seller-plus.
The previous editorial score is not treated as proof that this wording was
correct. The published article has not yet been changed by this local repair.

A regression reproduced a generic source-filter gap: documentation under
`vendor.example/docs` was eligible, while documentation hosted at
`docs.vendor.example` or `help.vendor.example` was rejected. The local fix
recognizes dedicated documentation hosts as `official-doc`, not universal
research evidence. HTTPS validation, known community-host exclusions,
source capture, and exact-proposition review remain required. Fixtures cover
several unrelated vendors, insecure and local URLs, community subdomains,
marketing pages and misleading URL queries.

Research, final audit, revision and empty-research instructions now explicitly
separate a retrieval limitation from proof of nonexistence. They do not lower
quality thresholds, invent citations, replay provider work, change the research
model, or invalidate existing inventory by fiat. Seventy-five targeted tests
passed, followed by all 1,267 repository tests, type-check, lint with zero
errors and 157 existing warnings, additive schema validation, tracked-file
secret scan, dependency audit, production build and Convex deployment dry-run.
Ten public browser checks passed; two authenticated harness tests remained
skipped and are not counted as passes. Native Chrome inspection separately
confirmed signed-in Settings and the connected Pentra GitHub destination.
The specific published wording still needs a verified correction, which must
not count as a new article. These local changes are not deployed yet.

### Signed-in cadence and initial-plan readiness acceptance

Native Chrome inspection reached both existing tenants' website management
pages. LeadPilot displayed 21/week, Autopilot, connected GitHub publishing and
connected Search Console; its settings accepted the same 1–21/week range and
explained the monthly article allowance. Pentra displayed 7/week, Autopilot and
its connected GitHub destination. No settings were saved, credentials changed,
or article execution triggered through these checks. These are existing-tenant
read-only checks, not a completed clean new-customer onboarding run.

LeadPilot still requests the current One Setup migration. Pentra shows a
blocked initial-plan execution at 6/7 setup stages, with a generic message but
no visible failure reference. Neither state is being described as setup
completion. The local readiness UI now displays the existing reason code;
an indexed, credential-free internal projection can inspect the exact site's
current request, execution and bound plan without reading a global queue.
The specific Pentra execution must be inspected after deployment before any
repair or owner action can be selected.

A registered-query regression against the current deployed source reproduced
another generic defect: consuming the initial topics changed a completed
`Content plan prepared` stage back to queued. The local query now preserves
a current, positive, completed initial-plan receipt bound to the same job,
tenant, configuration and domain. It does not convert blocked or zero-yield
plans into success, generate topics, or claim the current publication buffer
is full. Four runtime tests cover both unrelated tenant fixtures, ownership
and configuration boundaries, missing/invalid receipts, readonly behavior,
and exclusion of credentials, sender details and provider output from the
operator projection. All 1,271 repository tests, type-check, zero-error lint
(157 existing warnings), additive schema validation, tracked-file secret scan,
dependency audit, production build and deployment dry-run passed. Ten public
browser checks passed; the two authenticated harness skips remain disclosed.

At 13:48 UTC, fresh bounded production projections still showed three sealed
Pentra articles and five LeadPilot articles, no active article jobs, and the
same future publication receipts. This unchanged state is a waiting condition,
not additional publication progress. Runtime release `768b1d8` remains frozen
until the 14:14:43.010 UTC LeadPilot execution has been observed.

### Bounded public-article audit, 13:58 UTC

One controlled diagnostic ran the actual locally revised `auditFinalArticle`
against the already-public Pentra Fiverr article. The deployed Anthropic
credential completed one request successfully (HTTP 200,
`req_011CenJc9rqLGfAcNdpgt4k2`, `claude-sonnet-5`, 6,064 input and 1,017 output
tokens). No production job, article, schedule or publication was mutated.
This is a controlled diagnostic, not a natural production acceptance receipt.

The auditor returned 83/100 and marked the article's unsupported assertion
that Fiverr publishes no ranking documentation as a material defect. It also
flagged the unsupported autocomplete-provenance assertion in its notes. This
confirms that the new audit instruction can reject the observed example; it
does not certify every future article. Its suggestion merely to soften an
absence claim is not accepted as a factual correction: the relevant official
documentation must be used, or the unsupported assertion removed.

Earlier local audit harness attempts stopped before any provider request
because their CommonJS/ESM bridge mishandled the Markdown parser default
imports. An offline transport test reproduced and corrected that harness
problem before the single real request. These zero-request failures are not
provider funding failures. The published wording remains uncorrected pending
a properly bound editorial revision; no existing-page edit may count as a
new-article cadence delivery.

### Strict evidence discovery no longer excludes unlisted official sources

The source-classifier repair alone was insufficient: the strict OpenAI search
request still sent a fixed `allowed_domains` list. Runtime regressions using
the actual research function and SDK reproduced exclusion of Stripe docs,
GitHub docs and NIST research, despite their eligibility under the unchanged
source policy. OpenAI documents this parameter as a discovery restriction:
https://developers.openai.com/api/docs/guides/tools-web-search#domain-filtering.

The local repair removes that fixed discovery list, retaining the same model,
required search capability, output allowance, transport deadline and no-retry
policy. Provider-attributed citations, strict source classification, bounded
DNS-pinned source capture, preserved excerpts and exact claim validation still
apply. Regression tests also verify that secondary/blog and marketing sources
remain ineligible; discovery is not evidence acceptance.

At approximately 14:03 UTC, one controlled request using the deployed OpenAI
credential and actual revised research function completed successfully:
`req_abf6f1a9313449d29b848271bcf497ae`, response
`resp_0d99470c1e79ea6f006a9d728d3b2887d1ab5ef5f49badf6e2`, HTTP 200,
`gpt-5-mini-2025-08-07`, one search call, 9,059 input and 2,894 output tokens.
It found seven official Fiverr help URLs plus a secondary PDF URL. This is
discovery evidence only, not an article or natural production receipt.

A subsequent provider-free capture of three returned help pages rejected all
three. A direct call through the actual safe outbound client confirmed HTTP
403 for the Creating a Gig page. No access control was bypassed and no search
summary was substituted for a preserved source excerpt. Thus the discovery
defect is repaired locally, but this host's current capture failure remains a
real evidence limitation. The published article remains uncorrected.

All 1,274 repository tests, type-check, lint (zero errors, 157 existing
warnings), additive schema check, tracked-source secret scan, dependency
audit, production build with the non-secret CI configuration, ten public
Playwright checks, and Convex dry-run passed. Two authenticated harness
tests remain skipped. Initial local build/deploy-dry-run invocations omitted
the established environment setup; rerunning with the correct non-secret
build settings and silently sourced deployment environment passed. They were
local invocation failures, not production or funding failures. No production
deployment has occurred during the pending LeadPilot cadence observation.
