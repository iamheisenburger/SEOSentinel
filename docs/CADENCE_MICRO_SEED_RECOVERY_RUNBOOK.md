# Cadence micro-seed recovery

Current policy: v4. A policy upgrade preserves every older paid receipt and
rotates to a new product-anchor pair; it never replays an earlier provider
request or relaxes keyword, authority, SERP, overlap, or publication gates.
Version 4 uses category-based Keyword Ideas because production proved that
literal Suggestions can return zero rows for valid, specific SaaS anchors.
It gives that slower live endpoint a bounded 60-second HTTP window; the
earlier v3 request that crossed the old 20-second boundary remains ambiguous
and is never replayed.

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
- It sends exactly one DataForSEO Labs `keyword_ideas/live` task with
  one tenant `anchorKeywords` or `keyFeatures` seed, at most 100 results, no
  SERP expansion, and no clickstream data.
- The task itself must report no more than $0.024, and its task-level and
  response-level cost receipts must agree.
- At most one candidate can become a staged topic. It must have positive
  demand, measured organic keyword difficulty, provider intent, current v5
  product fit, authority-compatible difficulty, no blocked brand, no exact
  reuse in any topic state, and no lexical/canonical overlap.
- If, and only if, that paid task durably completed with no usable candidate,
  Pentra may create one distinct fallback child and one distinct shared-ledger
  reservation capped at $0.05. The child uses the deterministic next current
  `anchorKeywords`/`keyFeatures` phrase; it never replays the original seed.
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
- Evidence creates a separate existing reservation capped at $0.10. It buys
  one fresh locale-bound SERP and one bounded competitor-authority snapshot.
- The primary combined ledger requirement is $0.20. After a consumed $0.10
  primary receipt, fallback admission requires the exact remaining $0.15:
  $0.05 fallback plus $0.10 evidence. With the terminal $2 plan, the complete
  ordinary worst-case account ledger is therefore exactly $2.25. During the
  bounded v4 migration, the immutable v1 and v2 primary/fallback receipts
  ($0.30), the one-time demand/evidence policy receipts ($0.20), the ambiguous
  v3 primary receipt ($0.10), and the v4 primary/fallback/evidence receipts
  ($0.25) can coexist with the source plan. The exact account ceiling is
  therefore $3.05 for this migration and still leaves the fixed $0.25
  other-account reserve inside the $3.30 fleet ceiling.
  This observes but does not lock evidence capacity; a later evidence race may
  still stop safely and report a cadence miss.

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

For a fallback inspection, copy its two additional parent fields and exact
smaller ceiling:

```sh
npx convex run actions/cadenceMicroSeed:recoverCadenceGap '{"siteId":"<SITE_ID>","mode":"apply","inspectionKey":"<INSPECTION_KEY>","reservationDay":"<YYYY-MM-DD>","rolloutEpoch":<ROLLOUT_EPOCH>,"sourcePlanId":"<SOURCE_PLAN_ID>","sourcePlanFingerprint":"<SOURCE_PLAN_FINGERPRINT>","attemptKind":"fallback","parentMicroSeedJobId":"<PARENT_MICRO_SEED_JOB_ID>","parentMicroSeedReceiptFingerprint":"<PARENT_ZERO_RESULT_FINGERPRINT>","providerCostCeilingMicroUsd":50000}' --prod --codegen disable
```

Apply performs a free $0.20 primary or $0.15 fallback wallet preflight. The
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
