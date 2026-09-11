# Truthful tenant dashboard — assignment15 review candidate

Parent **20ea655a15cc1421b39109b992abff30a27fad23**. Local candidate only;
**not pushed or deployed**. Production remains **3b806c6b867ae94cb160a14b7c2c45a47ca2291d**.
No provider request, budget/reservation write, attempt reset, manual scheduler,
generation/revision, authentication change or consent acceptance. No other real
tenant was inspected. The dormant spending commit is not an ancestor.

## Fixed defects

**False healthy detail.** The actual cadence-health refresh and SLA audit now
use one exhaustive status/detail presenter. Only explicit `healthy` produces
the healthy scheduler/buffer/cadence sentence. All registered health statuses
have tested wording; unknown statuses are explicitly unverified. Planning
admission, cooldown, provider funding, internal spending allowance, article
quota, quality quarantine, external publication failure and pending live-URL
verification remain distinct. Existing status precedence, deadlines, counts,
quality gates and genuine recovery semantics are unchanged. Missed deadlines
remain in the detail even when a stale scheduler or incomplete inventory takes
status precedence. Partial/unknown inventory never gets an exact zero or healthy
message. Exact publication timestamps are untouched.

The owner-authorized health query also replaces only the old contradictory
healthy sentence on non-healthy stored rows, using that same presenter. This is
a read-only presentation correction: no record is repaired, no ordinary run is
forced, and all other specific operational detail remains unchanged. The UI need
not wait for another mutating audit to stop displaying the known false sentence.

**Selected-site activity.** The dashboard now requests `jobs:getDashboardActivity`
with the selected site, not account-wide `jobs:listAll`. Ownership is checked
before any job read. Existing exact-site indexes read nine newest job rows for
an eight-item display, plus at most51 pending and51 running rows separately.
Sentinels distinguish complete counts from lower bounds; busy peers cannot
starve another site's activity. The DTO allows only job ID, allowlisted type/
status and finite timestamps—no payload, progress text, results, errors or worker
capabilities. Unknown stored codes stay unknown. No new table/index is needed.

The rendered view checks the response's site binding again. Missing selection,
loading or a retained response from the previous site never becomes Idle, empty
history or another site's activity. Queued work is not labelled running; capped
counts display lower bounds, and truncated recent history is explicit. Unknown
recent job states cannot produce Idle. Errors propagate, rather than becoming
zero. Existing deep-link ownership remains authoritative before effects run.

## Narrow planning-window visibility

The read-only internal `jobs:inspectOrdinaryPlanWindow` closes14's specific gap
for checkpoint-enabled ordinary planning. It is explicitly **count/cooldown
only**, never selection, entitlement, funding, or permission to queue. It reads
at most201 exact-site recent plan rows,13 latest plan-history rows (the existing
failure observer examines12), and201 exact-site ready-summary rows. Every read
is site-indexed; no account/fleet month ledger or other tenant is read.

Atomic queue admission and this projection reuse the same reason-family/
proven-release predicate, ordinary cadence-plan predicate, buffer-shortfall
math, rolling limit, failure cooldown and expiry helpers. Moving these pure
predicates does not change admission behavior. The rolling count intentionally
includes every history status and all `topic_*` reasons, including manual topic
rows; only established pre-paid releases stop counting. Failure observation
still excludes manual/growth-parent work, exactly as before.

Receipts expose exact counts only for complete windows, otherwise lower bounds
and an explicit incomplete state. Latest counted-plan and failure-history
completeness are separate. Timestamp errors and capped ready inventory are
explicitly incomplete. Inclusive24h boundaries, the extra expiry second and
recorded non-semantic funding/budget deadlines are preserved. No mutation is
used as a preflight. The new query has **not been run in production**, where it
does not exist until an approved deployment.

## Verification receipts

- 18 focused tests exercise the actual registered health, ownership/activity and
  planning-window handlers, plus real dashboard React renders and actual query
  arguments. Two arbitrary business fixtures; cross-account denial only on
  synthetic records; no production foreign-tenant probe.
- Health tests cover every registered status, unchanged policy precedence,
  genuine recovered health, running work, missed/stale exact timestamps,
  partial and unknown inventory, and non-mutating legacy-copy correction.
- Activity tests cover selected-site busy-peer starvation, independent pending/
  running counts at0/50/51+, credential stripping, unknown fields, failed reads,
  loading/stale/switching responses, and owned/unauthorized deep links.
- Window tests cover done/failed/cancelled/expired/unknown/pending/running history,
  cross-reason/manual counting, exact pre-paid releases, inclusive expiry,
  semantic versus funding/budget cooldown, old latest counted receipts and
  saturated windows. Counts and next wake are compared against the actual
  atomic queue's local `recent_limit` result, with no provider reservation.
- Full final test-suite result: **1,527/1,527 pass**,0 failures/skips;70.354s,
  confirmed by15:01:02 UTC. Earlier gate iterations
  caught two source-pattern assertions tied to the old inline predicate location;
  both now verify the shared helper wiring and remain backed by runtime tests.
- Production build and typecheck pass with the same non-secret fixture config
  used in hosted CI. The first unconfigured build correctly failed closed for
  a missing public Convex URL; no real credentials were requested or changed.
- Lint passes:0 errors,157 existing warnings. Schema compatibility passes:
  unchanged61 tables/293 indexes. Production dependency audit:0 vulnerabilities.
- Public desktop/mobile browser gates:16 passed,2 explicit authenticated skips.
  They are not a substitute for the requested signed-in deployment check.
- Secret scan passes across643 tracked files; staged diff/whitespace checks pass.

## Deployment and funding review boundary

Review this combined candidate before any push/deployment. Because the frontend
calls a new query, an approved release must make the additive backend query
available before publishing the changed frontend. Then use the existing signed-
in Pentra/LeadPilot browser to verify health copy, distinct activity, cadence and
destination without saving settings or accepting setup terms. No live verification
of the repaired UI is claimed in this pre-deployment assignment.

The one-page **`PROVIDER_MONTHLY_AMENDMENT_DESIGN_2026-09-11.md`** is design only.
It retains the immutable original approval/window and valid exposure; exact
reference/predecessor binding, bounded append-only amendments, OCC/idempotency,
cumulative ceilings and additional-purpose scope must precede any future approved
implementation. It adds no endpoint/table/activation. Exact shared account/fleet
capacity remains unknown. Additional generation/research/media/revision spending
authority remains absent. No numeric increase is requested or executed.

## Production evidence / decisive acceptance requirement

One bounded production observation was made after the15:00 ordinary slot while
final validation was ongoing. Exact-site snapshots **15:00:54.475 Pentra** and
**15:00:56.234 LeadPilot UTC** show:

| Tenant | Natural scheduled | Started | Completed | Outcome | Buffer |
| --- | --- | --- | --- | --- | --- |
| Pentra | 15:00:29.025 | 15:00:31.408 | 15:00:35.390 | planning_blocked | 1/min3/target4 |
| LeadPilot | 15:00:29.025 | 15:00:34.521 | 15:00:41.873 | planning_blocked | 0/min9/target12 |

All times Sep11 UTC. Run IDs are respectively
`kd72k73485kq0wvm5nqkmagvpd8e64ka` and `kd7e86sw5ya5hc2k5stcfkzbyh8e733k`.
Both inventories are complete, active jobs are empty, and latest terminal plans
remain the old Sep8 receipts. Demand/evidence skip receipts are still old, not
fresh successes. LeadPilot's recorded health is now `planning_blocked`; its exact
overdue publication deadline is unchanged. Two old outcomes were not relabelled
as new successes: the ordinary runs really occurred, but **replenishment did not
progress**. No scheduler was forced. The new local preflight was not deployed or
called. Financial figures remain14's14:38 observation, not a new financial audit.

The decisive next acceptance requirement is still a **legitimately funded new
ordinary planning source**, then fresh generation and strict quality approval,
scheduled new-article publication with a verified live artifact, and replacement
after buffer consumption on both tenants. This reporting repair proves none of
those production outcomes. Pentra's last actual publication is Sep11
10:24:02.469 UTC; next exact deadline Sep12 10:24:02.469 is after the Sep12
07:00 UTC cutoff. LeadPilot last published Sep7 22:15:34.409 and has been overdue
since Sep8 06:15:34.409 UTC. Cadence was not altered to meet a test deadline.
No article acceptance, general SaaS-readiness, backlinks, or attributable SEO
growth claim is made.
