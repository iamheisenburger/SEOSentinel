# Cadence micro-seed recovery

Current policy: v29. A policy upgrade preserves every older paid receipt; it
never replays the same endpoint/seed envelope or relaxes keyword, authority,
SERP, overlap, article-quality, publication, or live-verification gates.
Version 25 first measures a deterministic portfolio of tenant-grounded exact
queries with Keyword Overview. If that receipt proves no usable candidate, a
separately receipted Keyword Ideas fallback explores the tenant's product
categories. This replaces the sparse Suggestions/Related Keywords lottery
that production proved can return no rows for legitimate B2B product phrases.
Version 26 binds the successful free DataForSEO balance preflight to the same
atomic reservation admission. The worker validates that fresh receipt instead
of immediately repeating the remote preflight, which previously let a
transient second check consume the one-shot fallback marker before any paid
request. The paid no-replay boundary and every downstream SERP, article-quality,
publication, and live-verification gate remain unchanged.
Version 28 closes the category-relevance failure observed after that repair.
The Keyword Ideas fallback now uses DataForSEO's native phrase-match mode.
Production rejected a redundant derived-regex variant after the live provider
returned an upstream 5xx; phrase-match supplies the provider-side relevance
fence without that unstable query plan. The unchanged two-concept tenant-fit,
difficulty, SERP, expected-click, article-quality, publication, and live-
verification gates still evaluate every returned row.
Version 29 removes a finite-rotation dead end exposed by repeated bounded
recovery generations. It expands the direct-metric probe rotation with
deterministic high-intent variants—such as pricing, comparison, implementation,
workflow, ROI, and case-study queries—derived only from each tenant's complete
product phrases. Long phrases receive a bounded product-concept form before a
modifier is added. Wrapper terms never count toward the two-concept anchor
gate, and every downstream quality boundary remains unchanged.
Actual-cost reconciliation is paginated into small tenant-scoped transactions
before admission. Accumulating immutable recovery history can therefore never
overflow the mutation time budget and silently prevent a mature tenant from
using the next valid recovery generation.
Exhausted source-plan resolution is likewise paginated in four-plan pages with
a hard 50-plan horizon. The one-second eligibility and execution transactions
re-read only the selected exact plan, reservation, and checkpoint partition;
they never walk historical plans or the monthly provider ledger. Shared fleet
and account capacity remains fail-closed in the serializable reservation
mutation immediately before a provider job can exist.

This is a last-resort, tenant-generic recovery for an imminent cadence window
with a sealed buffer below the cadence-derived launch minimum, no scheduler-ready
topic, and no active content or evidence work after the ordinary two-execution
topic plan is terminal. It does not reopen that plan or release, replace, or
discount its immutable $2 reservation.

The exact terminal plan remains admissible for at most seven days, including
across UTC-day rollover. Its recorded reservation day must still match its own
creation day, its immutable source fingerprint must remain unchanged, and each
current tenant, domain, rollout, authority, coverage, quota, and provider-ledger
gate is re-read before the micro-seed receives a new current-day reservation.
This prevents a midnight boundary from stranding a missed cadence without
turning old historical plans into reusable spend authority.

The source may be either the exhausted legacy two-execution continuation or an
exact terminal single-execution candidate checkpoint whose immutable partition
proves a retained no-replay reservation and fewer usable topics than its
required verified yield. Checkpoint identity, candidate partition, persistence
commit, reservation, current domain, and rollout epoch are fingerprinted and
re-read at the provider boundary; a merely underfilled result cannot qualify.

The recovery is automatic for every eligible warm/live autopilot tenant. The
15-minute fleet pass is provider-free for ineligible sites and isolates each
tenant. Current plan entitlement, site allowance, article quota, rollout
epoch, verified planning mode, fresh tenant authority, and shared account and
fleet ledgers are recomputed before any reservation or provider call.

## Exact paid envelope

- Primary discovery creates one new shared-ledger reservation capped at $0.10.
- It sends exactly one DataForSEO Labs `keyword_overview/live` task with a
  deterministic batch of at most 32 exact tenant product queries. Those
  queries are either configured product anchors or bounded informational and
  commercial-intent variants derived from those anchors. Each is 2-6 words
  and at most 80 characters, and wrapper terms cannot satisfy product match.
  The endpoint
  may return at most one metric row per requested query; no unrequested row is
  eligible.
- The task itself must report no more than $0.10, and its task-level and
  response-level cost receipts must agree.
- At most one candidate can become a staged topic. It must have positive
  demand, measured organic keyword difficulty, provider intent, current v5
  product fit, authority-compatible difficulty, no blocked brand, no exact
  reuse in any topic state, and no lexical/canonical overlap.
- If, and only if, that paid task durably completed with no usable candidate,
  Pentra may create one distinct fallback child and one distinct shared-ledger
  reservation capped at $0.10. The child sends exactly one DataForSEO Labs
  `keyword_ideas/live` task with a deterministic batch of at most 32 current
  tenant product phrases, at most 300 results, native phrase-match expansion,
  no SERP expansion, and no clickstream data. It never replays an earlier
  Keyword Ideas seed envelope.
  The parent receipt must prove either zero rows or a complete one-to-one audit
  where every returned row was rejected by exactly one strict metric, intent,
  difficulty, brand, business-fit, duplicate, or overlap gate. Accepted,
  partially accounted, malformed, ambiguous, or already-materialized results
  cannot authorize the fallback. The fallback applies the same gates and does
  not weaken content quality to manufacture an opportunity.
- The terminal primary receipt remains eligible for at most 24 hours, including
  across UTC rollover. Its own reservation and every provider timestamp must
  remain bound to its creation day; the fallback receives a new current-day
  reservation after all tenant, ledger, profile, and source fences are re-read.
- The fallback remains one-shot even if its free wallet preflight releases its
  own reservation. A timeout after its durable attempt is terminal, and there
  is no third anchor attempt.
- Each candidate can create a separate existing evidence reservation capped
  at $0.10 for one fresh locale-bound SERP and one bounded competitor-authority
  snapshot. At most three candidates are retained, so inspection requires
  $0.40 of current headroom: $0.10 discovery plus $0.30 evidence. Verified
  provider receipts settle to actual cost before later admission. This
  observes but does not lock evidence capacity; a later cross-tenant race may
  still stop safely and report an exact budget miss.

No article is queued until the evidence job persists an eligible expected-click
receipt for the exact staged topic. A timeout after a durable provider attempt
is terminal and is never retried. Crash recovery can resume only before a paid
attempt or from an exact persisted receipt.

## Provider-free inspection

Automatic fleet operation does not require an operator. For incident review,
inspection is still the only safe first command:

```sh
npx convex run actions/cadenceMicroSeed:recoverCadenceGap '{"siteId":"<SITE_ID>","mode":"inspect"}' --prod --codegen disable
```

`ready: true` returns the exact UTC day, rollout epoch, source plan ID, source
plan fingerprint, attempt kind, optional parent job/fingerprint, tenant seed,
dynamic discovery ceiling, and `inspectionKey`. Inspection creates no provider
reservation and makes no provider request.

A completed natural demand batch may leave additional historical artifacts for
later demand days. That backlog does not block an imminent below-minimum-buffer
micro-seed only when the latest autonomous receipt proves a full ten-topic
artifact batch, one completed exact-metric call, zero metric receipts, ten
one-to-one `exact_metric_missing` failures, zero persistence/skips, the current
rollout epoch, and an unreleased matching shared-ledger reservation. The exact
receipt is bound into the micro inspection and expires after 24 hours. Ordinary
daily recovery remains enabled for the lower-priority artifacts; this merely
prevents one saturated negative batch from suppressing cadence rescue for four
days. After materialization, the exact micro topic already has current demand
and may advance to its guarded evidence job ahead of those demand-only rows.
Any evidence-ready or planned-recovery topic still has priority, and an
incomplete, ambiguous, active, stale, partially matched, or non-natural demand
receipt remains a hard stop.

## Reviewed apply

Copy the inspection values without editing them:

```sh
npx convex run actions/cadenceMicroSeed:recoverCadenceGap '{"siteId":"<SITE_ID>","mode":"apply","inspectionKey":"<INSPECTION_KEY>","reservationDay":"<YYYY-MM-DD>","rolloutEpoch":<ROLLOUT_EPOCH>,"sourcePlanId":"<SOURCE_PLAN_ID>","sourcePlanFingerprint":"<SOURCE_PLAN_FINGERPRINT>","attemptKind":"primary","providerCostCeilingMicroUsd":100000}' --prod --codegen disable
```

For a fallback inspection, copy its two additional parent fields and the same
bounded ceiling:

```sh
npx convex run actions/cadenceMicroSeed:recoverCadenceGap '{"siteId":"<SITE_ID>","mode":"apply","inspectionKey":"<INSPECTION_KEY>","reservationDay":"<YYYY-MM-DD>","rolloutEpoch":<ROLLOUT_EPOCH>,"sourcePlanId":"<SOURCE_PLAN_ID>","sourcePlanFingerprint":"<SOURCE_PLAN_FINGERPRINT>","attemptKind":"fallback","parentMicroSeedJobId":"<PARENT_MICRO_SEED_JOB_ID>","parentMicroSeedReceiptFingerprint":"<PARENT_ZERO_RESULT_FINGERPRINT>","providerCostCeilingMicroUsd":100000}' --prod --codegen disable
```

Apply performs a free $0.40 primary or fallback wallet preflight. The
reservation mutation then
recomputes the complete inspection and uses OCC to reject any entitlement,
quota, tenant profile, authority, coverage, active-work, day, epoch, source
plan, or ledger drift. Never call the reservation mutation directly.

## Audit status

```sh
npx convex run cadenceMicroSeed:getStatusInternal '{"siteId":"<SITE_ID>"}' --prod --codegen disable
```

Review these durable fields:

- provider attempt/completion and reported task cost;
- attempt kind, parent receipt (for fallback), and exact reservation ceiling;
- candidate received/accepted counts and selected demand/KD;
- exact staged topic and evidence job IDs;
- evidence/finalizer state and any stable miss reason; and
- the cadence scheduling receipt. A successful recovery is complete only when
  the exact topic is durably queued/used or linked to an article. A scheduler
  action return value by itself is not success evidence.

Operational pre-call evidence blocks leave the staged topic planned but
unschedulable; they are not false SEO rejections. Semantic SERP, authority,
overlap, or expected-click failures disqualify the exact staged topic. A paid
or conflicting evidence handoff also disqualifies it so an unverified eligible
field cannot leak into ordinary scheduling.
