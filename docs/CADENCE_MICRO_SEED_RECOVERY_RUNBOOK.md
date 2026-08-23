# Cadence micro-seed recovery

This is a last-resort, tenant-generic recovery for an imminent cadence window
with no sealed buffer, no scheduler-ready topic, and no active content or
evidence work after the ordinary two-execution topic plan is terminal. It does
not reopen that plan or release, replace, or discount its immutable $2
reservation.

The recovery is automatic for every eligible warm/live autopilot tenant. The
15-minute fleet pass is provider-free for ineligible sites and isolates each
tenant. Current plan entitlement, site allowance, article quota, rollout
epoch, verified planning mode, fresh tenant authority, and shared account and
fleet ledgers are recomputed before any reservation or provider call.

## Exact paid envelope

- Primary discovery creates one new shared-ledger reservation capped at $0.10.
- It sends exactly one DataForSEO Labs `keyword_suggestions/live` task with
  one tenant `anchorKeywords` or `keyFeatures` seed, at most 100 results, no
  SERP expansion, and no clickstream data.
- The task itself must report no more than $0.024, and its task-level and
  response-level cost receipts must agree.
- At most one candidate can become a staged topic. It must have positive
  demand, measured organic keyword difficulty, provider intent, current v5
  product fit, authority-compatible difficulty, no blocked brand, no exact
  reuse in any topic state, and no lexical/canonical overlap.
- If, and only if, that paid task durably completed with zero returned rows,
  Pentra may create one distinct fallback child and one distinct shared-ledger
  reservation capped at $0.05. The child uses the deterministic next current
  `anchorKeywords`/`keyFeatures` phrase; it never replays the original seed.
  A response with rows that failed fit, difficulty, brand, or overlap gates is
  not a zero-row receipt and cannot authorize the fallback.
- The fallback remains one-shot even if its free wallet preflight releases its
  own reservation. A timeout after its durable attempt is terminal, and there
  is no third anchor attempt.
- Evidence creates a separate existing reservation capped at $0.10. It buys
  one fresh locale-bound SERP and one bounded competitor-authority snapshot.
- The primary combined ledger requirement is $0.20. After a consumed $0.10
  primary receipt, fallback admission requires the exact remaining $0.15:
  $0.05 fallback plus $0.10 evidence. With the terminal $2 plan, the complete
  worst-case account ledger is therefore exactly $2.25. This observes but does
  not lock evidence capacity; a later evidence race may still stop safely and
  report a cadence miss.

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
