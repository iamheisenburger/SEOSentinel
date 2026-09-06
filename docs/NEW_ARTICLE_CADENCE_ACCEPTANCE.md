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
