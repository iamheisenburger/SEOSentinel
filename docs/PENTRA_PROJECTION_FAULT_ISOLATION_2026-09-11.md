# Publication inventory fault isolation — assignment 10

2026-09-11. Local candidate on `codex/publication-contention-repair`, parent
`b7997a444483e61de63ea509c01b643e4f2fbebf`. **Review required before push or
deployment. No new production reads or provider-backed calls in this assignment.**
This amends09; neither09 nor08 alone includes these fixes. It does not change
the approved spending boundary or establish customer article acceptance.

## Reproduced failures

Before implementation, actual registered-handler tests reproduced both review
findings: a legacy ready-summary window containing51 old-domain rows made
`getFleetReadiness` throw instead of returning the healthy peer, and made
`markRunFinished` roll back its transaction, retaining `status=running` with no
completion time. Both tests now pass without catching database exceptions.

A strengthened actual warm `autopilotTick` test with stale content-analysis
binding also failed before its early-stop repair: incomplete inventory fell
through to onboarding and attempted synthetic network work. It now finishes
blocked before onboarding or pending provider-backed work. The local transport
rejects unexpected network requests; no real provider was contacted.

An additional failing test caught a deadline regression in the first draft:
recomputing from unavailable publication summaries could overwrite a previously
recorded exact cadence deadline. Completion now preserves that recorded clock;
only health without any recorded deadline uses two bounded publication reads
and the existing site-created/cadence fallback. Actual publication-success
receipts retain their existing authoritative timestamp update.

## Typed completeness contract

The shared reader returns `{ rows, inventory }`. `inventory` has a literal
`status` (`complete`, `partial`, or `unknown`), `usableCountLowerBound`,
`inspectedCandidates`, and an allowlisted blocker array. The exact blockers are:

- `article_summary_domain_window_incomplete`
- `publication_buffer_scan_incomplete`
- `publication_history_incomplete`
- `publication_history_binding_mismatch`

`complete` means the bounded result is exhaustive and the usable count is exact.
`partial` means at least one usable article is verified, but the total is not
known. `unknown` means no usable article was established and inspection is
incomplete; its zero lower bound is **not** an empty-buffer assertion.
Exhaustively inspected terminal deliveries legitimately produce complete/zero.

Incomplete projections never emit an exact `approvedBufferCount`,
`sealedBufferCount`, or scheduler `bufferCount`. Stale persisted exact counts
are removed when health is reconciled. The typed receipt is stored as optional
`bufferInventory` on the existing health and run documents, so a completed run
retains the evidence that blocked it. No table, cache, spending framework,
pagination loop, or migration was introduced.

## All changed shared-reader consumers

| Consumer | Complete versus incomplete behavior |
| --- | --- |
| `articles.getAutopilotState` | Existing article list plus typed inventory; an empty returned list alone no longer authorizes refill |
| `autopilot.promoteWarmSiteIfReady` | Automatic promotion requires complete inventory; blocked return contains exact codes and lower bound, not a fabricated total |
| `autopilot.markRunFinished` | Expected incompleteness durably completes the run with `publication_inventory_incomplete`, timestamp and receipt; no rollback to running |
| `autopilot.auditSla` | Evaluates cadence/staleness independently, records incomplete inventory for that site, and continues through healthy peers |
| `autopilot.refreshSiteCadenceHealth` | Preserves independent publication/deadline fields and distinguishes unknown inventory from empty/healthy |
| `autopilot.reconcileSealedBufferCount` | Clears stale exact counts on incompleteness; recovered completeness returns to pending health reevaluation, not automatic healthy status |
| `autopilot.getOperatorSnapshot` | Current typed inventory in root/health and historical receipt in runs; exact indexed deadline lookup remains independent |
| `autopilot.getFleetReadiness` | Returns both affected and healthy tenants; incomplete tenant cannot claim warm/live readiness or an exact total |
| `sites.setAutopilotRollout` | Controlled live promotion rejects an incomplete inventory as an explicit invalid mutation request, without changing rollout state |

The indirect customer-health consumer `growthLoop.getStatus` is also covered.
A final-sweep runtime test reproduced its old nullish fallback from an absent
health count to raw ready-summary labels, incorrectly marking unknown inventory
as ready. It now respects complete/partial/unknown health, reports the inventory
receipt and a dedicated blocker, and never uses that fallback for typed
incompleteness. This adds **zero database reads** and changes no other growth,
outreach or backlinks behavior. Legacy health without the new optional receipt
keeps its prior bounded fallback; no migration is claimed.

The scheduler consumes the typed state without exception-text matching. It
returns a dedicated blocked mode before refill. An independently validated,
already-sealed due article B remains deliverable when only article A's bounded
history is incomplete, preserving09's no-starvation guarantee; that permission
does not authorize refill, early delivery, or promotion. Other incomplete
candidate/domain/binding cases remain blocked. The actual tick handles the
blocked mode before onboarding or processing unrelated pending jobs.

Health records a separate inventory alert and resolves misleading empty/low
alerts when the total is unknown. Missed-publication and scheduler-staleness
alerts are still computed and retained. Run completion retains immutable
recovery bindings; duplicate completion remains an idempotent no-op.

Real database, schema and authentication failures remain errors. Tests inject
the same literal text formerly used as a sentinel into a genuine database
exception and verify the actual scheduler still rejects it. There is no broad
catch converting infrastructure failures into inventory data.

## Regression evidence and limits

The new19-test registered-handler suite covers the original two failures,
blocked warm onboarding, all four blocker types with the affected tenant first
and last, healthy peer SLA/fleet output, operator deadline receipts, health
refresh/reconciliation, durable completion, pending-job non-execution, partial
positive lower bounds, both promotion paths, actual complete-empty refill
entry, recovery of completeness, real errors, exact-deadline preservation,
and duplicate completion/recovery-binding preservation.
The additional customer-status regression covers unknown, partial and complete
health while preserving the existing zero-body-scan read budget.

These are synthetic local records. Projection-only metadata fixtures are not
generated-article or quality-approval acceptance. The retained26 connected
core tests and3 continuation tests separately exercise genuine registered
generation/review/seal/delivery handlers with provider transport doubles,
including full-buffer consumption/replacement, repeated due periods,
concurrent reservations, retry ceilings, deferred-callback cancellation and lease-expiry guards,
contention, lost commit responses, no duplicate writes, a usable article beyond
25 closed rows, and bounded reads. The fixture serializes mutations with
rollback; it is not a claim of testing Convex's distributed OCC implementation.

The09 query envelope is unchanged:51 candidate summary rows, at most50 exact
site/article/failed-history index checks,128 history-budget rows plus at most
one sentinel per candidate (observed177 rows for the50-candidate fixture).
No done/pending/running history bodies or article bodies are added to eligibility
reads. Typical clean4/12 buffers still read zero failed-job rows. The repeated
pathological operator fixture retains the09 measured bounds. No projection
cache was added. Incomplete health adds bounded alert reconciliation; an
incomplete run with no recorded cadence deadline adds at most two indexed
publication `.first()` reads. Existing healthy/incomplete-with-deadline paths
do not add those publication reads. Arbitrarily large allowed job payloads and
a50-site pathological fleet remain the residual byte-size risks documented09.

## Release gates

Final local runtime checks on Node24:

- **1,494/1,494 tests pass**, zero failures/skips (including26 core integration,
  3 continuation,19 new projection-isolation cases and1 new customer-status
  regression). Final rerun completed by **13:46:31 UTC**.
- TypeScript and optimized Next.js production build pass.
- Browser suite: **16 pass,2 explicit authenticated-acceptance skips**; this is
  not signed-in live-customer acceptance.
- ESLint: **0 errors,157 existing warnings**; no new warnings in the new helper
  or projection test file.
- Schema compatibility passes against `origin/main`: **61 tables,293 indexes**;
  assignment10 adds only optional fields on existing run/health documents.
- Production dependency audit: **0 vulnerabilities**.
- Whitespace/diff and final secret scan pass (**624 tracked files**).

## Production and acceptance remain separate

No push, deployment, production read, scheduler wake, generation/revision,
purchase, cap change, attempt reset, reservation removal, or new automation was
performed in assignment10. No other tenant/prospect records were inspected.

Last allowed production observation remains09's **13:15:42–47 UTC** bundle:
Pentra **1/minimum3/target4**, LeadPilot **0/minimum9/target12**, no active jobs,
and no fresh verified replenishment. Pentra's last actual publication was
**Sep11 10:24:02.469 UTC**, with next recorded deadline
**Sep12 10:24:02.469 UTC**. LeadPilot's last actual publication was
**Sep7 22:15:34.409 UTC** and its missed deadline was
**Sep8 06:15:34.409 UTC**. These are historical observations, not a new audit.
The project's end-of-day cutoff is **Sep12 07:00:00 UTC**; Pentra's recorded
next deadline is later than that cutoff. No deadline was accelerated here.

The last full financial audit remains07's12:29:40.385/41.892: verified actual
$2.992560 + settled execution ceilings$12 + retained ceilings$16.05 =
$31.042560 permitted subtotal. Against the unchanged owner/month$32 and
incremental discovery$4 limits, at most$0.957440 account and$0.878560 incremental
headroom remained; another$1 plan did not fit. The October1 00:00UTC monthly
reset does not renew incremental approval. No reservation accounting defect
was found in that scoped audit. The last free DataForSEO wallet preflight
(Sep11 10:29:27.120) showed$26.720668, so that internal rejection was not a
DataForSEO wallet-exhaustion result. No claim about other provider balances.

**NOT READY:** live fresh discovery → generation → quality approval → full
buffer → scheduled new publication → verified live artifact → replacement after
consumption remains unproven on both authorized tenants. LeadPilot is still
overdue in the last evidence. Passing local technical gates is not SaaS
monetisation acceptance or attributable SEO growth. No backlinks work began.
