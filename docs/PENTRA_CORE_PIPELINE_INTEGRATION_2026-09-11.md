# Ordinary core pipeline integration — 2026-09-11

Assignment: `supervisor-20260911-core-pipeline-integration-06`.

## Isolated release verification — assignment07

The reviewed core repair and tests have also been run on a clean production/main
base (`6f784df`, whose runtime is identical to `6c67e42`), without the dormant
spending framework or any of its ancestor commits. A new connected empty-yield
case proves that terminal discovery stops at ordinary admission/cooldown, closed
plans cannot replay, concurrent subsequent wakes create no extra plans or spend
receipts, and existing quality/lease/ownership/attempt gates remain intact.

Isolated gates: **1,454 full tests and 10 targeted tests pass**, typecheck/build
pass, lint has zero errors and 157 existing warnings, schema remains **61 tables
and 292 indexes with zero delta**, tracked secret scan617 passes, dependency
audit has zero findings, and local browser gates are16 pass/2 explicit auth
skips. Counts below describe the earlier dormant-branch offline run, not the
isolated release. Build and browser configuration were synthetic. Production
deployment and exact-site observations are separate acceptance steps.

Isolated synthetic artifact hashes differ from that earlier branch while every
seal/receipt/content equality assertion passes. Published ReservoirNote:
`a5e33245c898da6b16f497a6ea69b2dde782d3826b5456efeef6b261f9d6578c`;
StudioLedger: `22ea635036e65cfe16cf6b5ab94e2086176c91bd8855f2a1b2aaafc8df6bed09`.
First new replacements:
`c5ce4dfd665ec450e94e0cbfecc0db8cf82fa3b0514524030f805b0503d58980` and
`ffc170f0a20a1fc119c882139042b9879e673aa28be575a858b3f4ac8dd06bd1`.
IDs, virtual times and4/3 full-buffer results remain as below. No synthetic
receipt establishes a live customer outcome.

## Original assignment06 record

Status: local technical evidence only. No production query, provider expenditure,
cap change, push, deployment, real publication, customer acceptance, or SEO-growth
attribution was performed by this assignment. The dormant all-in spending feature
remains inactive and unpushed. No new spending approval is requested here.

## Reproduced defect and minimal repair

The connected test initially stalled after ReservoirNote's first verified
publication. Its already-admitted horizon plan returned duplicate-only discovery
results and correctly failed terminally. Five valid planned topics remained, but
the ordinary plan failure returned neither `planCompleted` nor
`planContinuationSettled`; `continueAutopilotAfterProcessedJob` therefore never
re-entered the scheduler. StudioLedger happened to discover a new niche anchor in
its second plan and continued. This was not a quality or reservation repair.

The production change adds `planFailed` only after an owned terminal planner
failure or exhausted planner retry is committed. A processed terminal plan then
re-enters the existing scheduler. The scheduler still owns topic eligibility,
cooldowns, quality, attempts, quota, account/fleet spending, and dispatch. A lost
claim, still-pending retry, or provider-balance/day-expiry/setup-supersession
preflight abort does not acquire this new continuation. The failed job stays
failed; no attempt or reservation is reset or removed. No tenant identifier,
cadence, deadline, quality threshold, schema, or spending constant changes.

The failing connected test existed before the repair. Without this handoff its
one-hour virtual-clock stall assertion fired with a zero replacement buffer;
with the repair it reaches the full policy-derived buffers below.

## What is real versus simulated

`tests/helpers/core-pipeline-fixture.ts` bundles and executes the actual registered
Convex handlers by function reference. It applies their exported argument
validators and the real schema's index ordering. No query/action/mutation result
is substituted. Core planning, admission, worker claim, draft checkpoint, review,
claim-evidence checking, deterministic links, sealing, scheduling, publication
lease, GitHub adapter, receipt settlement, and public verification all run.

The main connected test invokes the following actual interfaces along the chain:

1. `autopilot.dispatchSiteFollowup` and the scheduled `actions.pipeline.autopilotTick`.
2. `actions.scheduler.scheduleCadence`, `jobs.queuePlanIfAbsent`,
   `jobs.claimPending`, and `actions.pipeline.processNextJob`.
3. `jobs.queueTopicArticleIfAbsent`, `jobs.reserveGenerationSlot`,
   `jobs.reserveArticleProviderAttempt`, `articles.createDraftForJob`, and
   `jobs.yieldGeneratedArticleForReview`; the real review and link-seal code.
4. `jobs.queuePublicationIfAbsent`, `publisher.publishArticleInternal`, the real
   GitHub blob/tree/commit/ref adapter, and `articles.completePublication`.
5. `publisher.verifyPublicPublicationInternal`, real verified-publication
   settlement/follow-up, and the ordinary scheduler's fresh replacement jobs.

Only infrastructure is simulated: a monotonic clock, scheduled-function executor,
serializable in-memory mutation/rollback store, Blob storage, DNS/HTTP transport,
provider responses, and a stateful GitHub/public-site server. The store is not the
Convex service: it does not reproduce distributed action timing, optimistic
transaction retries, deployment/codegen validation, or full document-schema
validation. Cross-handler arguments and index names/order are checked.

Every configured provider response is synthetic. The real Anthropic/OpenAI SDK
serialization and DataForSEO parsing run, but model prose, scores, citations,
image bytes and image-review responses are fixtures. Articles vary by business
and keyword, but their deliberately repetitive advisory body is NOT evidence of
publishable model writing quality. Real deterministic gates still run; a high
synthetic audit score cannot approve the unsupported-number negative fixture.
Optional YouTube results are empty. Image visual correctness is not tested.

The GitHub server stores bytes produced by the real adapter. The public-site
fixture reads its committed file and renders its actual title/content; it never
reads an article row to invent a live receipt. This is not a deployed GitHub
repository, destination build, DNS propagation, or real Next.js blog renderer.
Unexpected transport destinations fail the test; direct socket/process APIs are
blocked. Synthetic keys are the only credentials supplied to core VM modules.

The main fixture seeds only two arbitrary businesses' configuration, owner
entitlements and one existing homepage each. Topics/articles start empty. The
real empty-database article-integrity migration runs before scheduling. It does
not seed seals, drafts, published rows, or success receipts. Negative spending
tests separately seed explicit synthetic historical budget/attempt ledgers.

The sites omit both expected-click opt-in and all-in approval configuration:
this proves the ordinary legacy path, not the opt-in checkpoint planner or One
Setup onboarding. Reading `provider_spend_approvals` fails the fixture, making
accidental dormant-feature entry explicit.

## Exact virtual trace — not actual publication times

Start: **2026-09-11 12:00:00.000 UTC**, epoch `1789128000000`.
Clock advances are simulated; millisecond durations are not performance claims.

| Field | ReservoirNote | StudioLedger |
| --- | --- | --- |
| Synthetic site | `sites:2` | `sites:5` |
| Cadence | 7/week | 2/week |
| Published article/topic | `articles:82` / `topic_clusters:29` | `articles:90` / `topic_clusters:48` |
| Publication | Sep 11 12:00:00.013 UTC | Sep 11 12:00:00.014 UTC |
| Public verification | Sep 11 12:00:00.015 UTC | Sep 11 12:00:00.016 UTC |
| First newly created replacement/topic | `articles:164` / `topic_clusters:30` | `articles:172` / `topic_clusters:49` |
| Replacement created | Sep 11 12:00:00.023 UTC | Sep 11 12:00:00.024 UTC |
| Next recorded cadence deadline | Sep 12 12:00:00.013 UTC | Sep 15 00:00:00.014 UTC |
| Final ready buffer | **4/4 target** | **3/3 target** |
| Visible committed artifacts | 1 | 1 |

Published artifact hashes, checked against the actual audit seal and receipt:

- ReservoirNote: `4495034dd537d93a677601ee172a5d6f66f0473113109126466675e0e31947df`
- StudioLedger: `1dc15e2ceab94fdf87a1a11f0744a885b0667630b8cfaa1bc8ebf01b9efb08c5`

First post-consumption replacement hashes:

- ReservoirNote: `5755d2a1e1d4ed4751a91ba4f6568704d67cf1cc486beaa3ed4497fe86e92327`
- StudioLedger: `a04889c667e5368393e2eb3d756e32bb45c2bfb511e682b5e317da11e0fbc300`

The tests assert that replacement creation follows `completePublication`, uses a
different topic/slug/article, receives a real queue-admission result, and passes
the current strict seal. Three concurrent later scheduler wakes and two replays
of each completed delivery job produce no early or duplicate publication. The
next cadence deadlines are checked but the second due-period publication is not
executed in this fixture.

## Rejection, concurrency and recovery evidence

- Concurrent plan admission and worker execution admit/process exactly one job.
  Wrong-site worker claims and cross-site topic admission fail.
- Duplicate-only discovery remains terminal with `already_known:6`, zero worker
  retries, and no duplicate topic rows. Valid existing inventory still refills.
- Actual monthly account spending denial returns
  `provider_account_monthly_budget_reserved`, leaves history untouched, performs
  no provider request, and does not prevent the other synthetic owner's admission.
- Duplicate article admission/claims and three attempt-reservation calls reuse
  one immutable receipt. Historical failed attempts count toward the 170-attempt
  enterprise allowance. Lost-worker and expired-lease calls fail before providers.
- An unsupported 37% operational claim fails captured-evidence checks despite a
  93-point model audit. A concrete low-editorial-quality result remains rejected
  after bounded remediation. Neither artifact reaches ready/published state.
- One GitHub ref-update HTTP 503 preserves the sealed artifact. Natural wakes
  eventually verify exactly one committed file without regenerating that article.

### Remaining retry limitation

The transient publication test deliberately retains the 15-minute ambiguity lease. The
first failure is at `12:00:00.007`; the `12:05:00.009` wake hits the still-active
site lease and records another publication failure without crossing the external
write boundary. The final allowed action commits at `12:15:00.011` and public
verification settles at `12:15:00.012`. There are **3 publisher actions, 2 HTTP
PATCH attempts, 1 visible commit**, with `publicationAttempts:2` retained on the
completed job. The exact artifact hash is
`1dfb04e663765268d51e8ba7978fcbe4d215bc6e8632820b455a9a71927886ac`.

This recovers the requested single transient outage, but consumes a retry on
lease contention and leaves less tolerance for another outage. That efficiency
and resilience risk is unresolved; this patch does not weaken ambiguous-write
protection or alter publication retries.

## Release gates and remaining acceptance boundary

- Full automated suite: **1,474 passed**, zero failed/skipped.
- Connected integration plus continuation runtime: **9 passed**.
- Typecheck: passed.
- Production build: passed with explicit synthetic required public configuration.
  A bare build without `NEXT_PUBLIC_CONVEX_URL` correctly failed configuration
  collection; no production credentials were needed for the passing build.
- Lint: zero errors, **157 existing warnings**, no new fixture warnings.
- Schema compatibility: **62 tables / 293 indexes**, unchanged.
- Production dependency audit: zero vulnerabilities.
- Local desktop/mobile browser gates: **16 passed / 2 skipped**. Dedicated
  authenticated-customer acceptance remains skipped, not claimed as passed.
- Secret scan: passed over **625 tracked/staged files**, including the new tests
  and report; the untracked credential file was never staged or printed.
- Independent applicability: the assignment-only staged patch passes
  `git apply --cached --check` against a separate index loaded from production
  commit `6c67e42fbdf61e81cb2a17c2a7c91ddc9bfbb3ff`. No dormant-feature commits
  are required by the patch. This is a patch check, not a second deployed run.

No fresh live tenant observation is made here. The production acceptance blockers
and funding boundary remain owned by the supervisor's separate scoped evidence.
This local repair does not establish that Pentra or overdue LeadPilot has fresh
live replenishment, that the product is ready for paid customers, or that article
acceptance produces attributable SEO growth. No backlinks work was started.
