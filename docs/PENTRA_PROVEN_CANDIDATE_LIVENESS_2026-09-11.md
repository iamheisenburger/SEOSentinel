# Proven-candidate liveness — assignment 11

2026-09-11. Amendment to parent `404bf5fbb5621f6a10244370f68ed6900d0847ac` on
`codex/publication-contention-repair`. **Independent review required before
push/deployment. Nothing in this package was run against production.**

## Reproduction and correction

Three failing-first registered-handler tests reproduced the regression:

1.26 clean current ready entries returned `publication_inventory_incomplete`,
  no delivery, and partial inventory with lower bound25/inspected25.
2.The same26-entry pool could not promote a configured warm site.
3.A mixed, scan-capped prefix containing a real pipeline-produced sealed B
  returned no delivery job under three concurrent due calls, although B's own
  history and seal were valid. Later load rows made the total incomplete.

The defect was treating an unknown exact total as proof that no safe action
could be taken. No25/50 cap was raised. The shared threshold predicate now asks
whether the verified lower bound proves the required minimum; the scheduler
separately asks whether an independently inspected due article exists.

| Decision | Evidence required | What incomplete excess cannot authorize |
| --- | --- | --- |
| Already-live delivery | At least one independently eligible inspected article, due cadence, autonomous mode and all existing selected-artifact/queue/worker guards | Early/manual/approval-only delivery; skipping the selected article's unresolved history; taking another destination owner's fence |
| Automatic or controlled live promotion | Verified lower bound reaches the cadence-specific minimum, plus existing owner/setup/adapter/rollout/ambiguity prerequisites | Promotion with zero or insufficient known inventory, missing prerequisites or shared ambiguity |
| Customer buffer stage | Verified lower bound reaches its configured minimum | An invented exact count or readiness of unrelated product stages |
| Fresh refill | Existing complete-inventory shortage and ordinary funding/topic/attempt/quality admission | Any shortage inferred from a partial/unknown total |

All four scoped incomplete conditions may coexist with a separately proven
candidate/minimum: candidate scan cap, filtered legacy-domain window, another
article's saturated history, and another article's history-binding mismatch.
This is not a whitelist of supposedly safe error strings. Each counted unit
already passed its own domain/seal/history projection; invalid or uninspected
rows do not contribute. The selected article still undergoes the existing exact
transactional queue recheck, and the worker retains content/config/domain/
owner/rollout seals, failure ceilings, quality checks and destination leases.
Actual database/schema/authentication errors still propagate as errors.

The actual tick permits a partial-inventory continuation only for due delivery
or its already-pending delivery job. Other partial outcomes finish before
onboarding or unrelated provider work. A successful warm promotion already
owns a separate durable follow-up; its originating tick must not also process
unrelated jobs. Run completion keeps10's truthful incomplete-total receipt even
when a separately authorized publication succeeded.

## Minimal consumers and stored evidence

- Scheduler: independent due-candidate and warm-minimum predicates; no refill
  falls through the incomplete-total guard.
- Automatic/controlled promotion: same minimum predicate and unchanged strict
  row checks. A negative test also exposed a missing-owner controlled-promotion
  precondition; controlled live promotion now explicitly rejects an ownerless
  site, matching the automatic path's existing restriction. No actor role,
  authentication configuration or production owner/cadence setting changed.
- Fleet: exposes `bufferMinimumMet` independently of the total and preserves
  partial inventory, missing exact count and incomplete health status. Existing
  complete-inventory prerequisite semantics remain unchanged.
- Customer buffer stage: accepts a proven minimum without raw-count fallback
  for insufficient/unknown typed inventory. The total remains explicitly partial
  in `bufferInventory`; unrelated stages and their overall verdict are unchanged.
- Promotion run: one optional `sealedBufferCountLowerBound` field preserves the
  immutable promotion-time minimum. `sealedBufferCount` is omitted when the
  total was partial. Completion's different `bufferInventory` cannot overwrite
  the original promotion minimum. Operator and natural-loop proof readers use
  that explicit bound; older exact-count receipts keep their prior fallback.

No new table/index, cache, pagination framework, history cleanup, reservation
edit, attempt reset or quality relaxation. The new threshold checks perform no
database reads.09/10's51-summary candidate read,50 article-history checks and
128-row shared history budget plus sentinels remain unchanged, as do the
representative pathological read-budget regressions. The schema stays61 tables
and293 indexes; assignment11 adds only the optional promotion-run field.

## Evidence (synthetic virtual UTC, not customer acceptance)

Metadata load fixtures remain labeled as metadata-only. They prove bounded
projection/admission and minimum decisions, not article quality or live content.
The connected B test instead uses the actual plan/generation/review/seal pipeline
with synthetic provider transports, followed by real registered scheduling,
queue, `autopilotTick`, worker, completion and public-verification handlers.

In its final targeted trace:

- Requested due time: **Sep12 12:00:00.007 UTC**. The fixture deliberately waits
  through the earlier terminal-contention scenario before releasing the real
  pristine destination owner; no attempted ambiguity is cleared.
- B: `articles:114`; partial lower bound3, inspected50, with
  `publication_history_incomplete` and `publication_buffer_scan_incomplete`.
- Three concurrent scheduler calls create exactly **one** pending B delivery.
- Actual synthetic publication: **Sep12 13:00:00.040 UTC**; public verification:
  **13:00:00.042 UTC**. This is intentionally after that fixture's due time,
  not evidence of meeting a customer SLA.
- Artifact hash: `f2f7753e5c55e10aedbfd8f8ef17ab15a3e9c2f71850fb039c5b4557cd0f3c20`.
  Markdown/hash unchanged, **zero additional model calls**, no new article,
  and all historical terminal job receipts preserved.
- Natural run completes with `publication_inventory_incomplete`, retaining
  truthful total-state evidence alongside the article's publication receipt.

Additional cases cover minimum3 at cadence7 and minimum9 at cadence21,
26-entry automatic/controlled promotion, immutable minimum through completion,
each scoped incomplete type with a minimum met/not met, insufficient positive
bounds, future deadlines, manual/approval modes, missing owner/adapter,
attempted shared ambiguity, and an inspected article whose own history changes
before its exact queue recheck. Zero-known-valid and all-closed capped windows,
genuine DB errors, peer isolation, no-refill-on-unknown, retries, lost responses,
concurrent reservations, full-buffer consumption/replacement and read budgets
remain in the retained regression suite. Local mutation serialization is not a
claim of testing Convex's distributed OCC implementation.

## Final release gates

- **1,502/1,502 tests pass**, zero failures/skips. This includes the62 selected
  core/continuation/projection/customer-status cases (28/3/25/6), with all
  earlier retry, loss-response, accounting, isolation and read-budget coverage.
- TypeScript and optimized Next.js build pass.
- Browser suite: **16 pass,2 explicit authenticated-acceptance skips**. Synthetic
  Clerk-loading warnings are not evidence of signed-in customer acceptance.
- ESLint: **0 errors,157 existing warnings**.
- Schema compatibility: **61 tables,293 indexes**, additive field only in11.
- Production dependency audit: **0 vulnerabilities**.
- Secret scan: **625 tracked files pass**; staged diff/whitespace check passes.

Final code remains unpushed and undeployed pending independent review.

## Live state and remaining acceptance

No production reads, provider-backed actions, push/deployment, purchases,
financial proposal, budgets, auth configuration, cadence settings, ledgers,
other tenant/prospect inspection, or automation changes in this assignment.
The dormant/user/secret/supervisor files are untouched.

Production remains runtime **8e9e147**. Last authorized observations are still
09's13:15:42–47 UTC snapshots: Pentra **1/minimum3/target4**, LeadPilot
**0/minimum9/target12**, no active jobs and no fresh verified replenishment.
Pentra last published **Sep11 10:24:02.469 UTC**, next exact deadline
**Sep12 10:24:02.469 UTC**. LeadPilot last published
**Sep7 22:15:34.409 UTC**, missed deadline **Sep8 06:15:34.409 UTC**.
Today's project cutoff remains **Sep12 07:00:00 UTC**, before Pentra's recorded
next deadline. No publication was accelerated to fit that cutoff.

Funding/topic blockers remain those in10's handoff; no new financial audit or
approval is claimed. Full fresh discovery → generation → approval → buffer →
scheduled new publication → verified live artifact → replacement after
consumption is still unproven on the two authorized live tenants. **NOT READY**
for SaaS monetisation sign-off. Technical local evidence is separate from
customer acceptance and attributable SEO growth. No backlinks work began.
