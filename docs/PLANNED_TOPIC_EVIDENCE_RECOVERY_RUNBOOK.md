# Planned-topic expected-click recovery

This operator-only bridge is for a tenant whose bounded topic-plan attempts are
already terminal but which still has an exact, strict-fit `planned` topic row.
It never reopens a plan job or its provider reservation. It never discovers a
keyword, calls a model, generates content, changes cadence, or publishes.

Planned inventory remains measurement-only and does not reserve search intent.
The ordinary scheduler can consider the topic only after fresh exact demand,
SERP intent, attainability, cannibalization, competitor authority, and
expected-click evidence all pass.

Legacy `serpTopUrls` without an observation timestamp and exact locale are
observational only. They may not authorize either phase. Demand admission can
still buy the exact keyword metric because it creates no content; evidence
then buys and durably records a new locale-bound SERP before any competitor
authority request. Only that fresh receipt can update the topic at final
expected-click persistence.

## Hard limits

- Demand uses the existing one-call, one-job/site/UTC-day reservation capped at
  $0.10.
- Evidence uses the existing SERP plus one bulk-authority reservation capped at
  $0.10.
- Combined worst case is $0.20. The shared account and fleet ledgers can still
  reject either phase if another reservation consumes the remaining headroom.
- A paid or ambiguous attempt is terminal for that exact normalized keyword in
  policy version 1. Never clear attempt markers or replay a timeout.
- Covered artifacts always go first. Planned recovery is admitted only when
  the exact phase has zero covered-artifact candidates.

## Inspect with no provider work

```sh
npx convex run actions/plannedTopicEvidenceRecovery:recoverPlannedTopicEvidence '{"siteId":"SITE_ID","mode":"inspect"}' --prod --codegen disable
```

`ready: true` returns `phase`, `inspectionDay`, `rolloutEpoch`, and an
`inspectionKey`. The key binds the exact site, day, phase, epoch, zero covered
artifact candidates, and ordered topic ID/keyword/fingerprint set. Inspect
creates no reservation and makes no provider call.

## Apply exactly the inspected phase

Copy the four returned values without editing them:

```sh
npx convex run actions/plannedTopicEvidenceRecovery:recoverPlannedTopicEvidence '{"siteId":"SITE_ID","mode":"apply","phase":"demand","inspectionDay":"YYYY-MM-DD","rolloutEpoch":0,"inspectionKey":"INSPECTION_KEY"}' --prod --codegen disable
```

The action recomputes the inspection. The atomic reservation mutation then
recomputes it again and compares the complete ordered descriptors. Any site,
profile, locale, domain, plan, quota, article/job, topic, evidence, day, or
rollout drift returns a no-spend stale/precondition result.

After demand completes, inspect again. If the exact measured demand is positive
and current, the new inspection will return `phase: "evidence"`. Apply that
fresh inspection as a separate step. Never reuse the demand inspection key.

Use the ordinary aggregate status queries between phases:

```sh
npx convex run expectedClickDemandBackfill:getStatusInternal '{"siteId":"SITE_ID"}' --prod --codegen disable
npx convex run expectedClickEvidenceBackfill:getStatusInternal '{"siteId":"SITE_ID"}' --prod --codegen disable
```
