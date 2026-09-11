# Publication review amendments — assignment 09

2026-09-11. Offline candidate on `codex/publication-contention-repair`, parent
`d1d9fad0eaba21f65e85d7d2682809735fab2857`. **Review required; not pushed or deployed.**
The assignment08 report remains the source for its contention/ownership design.
This report records the two review findings, their reproductions, and the
additional read-budget guard. No provider budget, attempt history, reservation,
quality seal, owner permission, or production configuration was changed.

## Findings reproduced before repair

1. A genuinely reviewed oldest ready article A waited behind another article
   B's real pristine destination lease. Four registered deferral callbacks closed
   A's delivery at the existing one-hour limit, with zero failed deliveries.
   B's actual owner then invoked the existing `releasePublication` mutation.
   The real scheduler still selected A and returned
   `publication_deferral_exhausted`, rather than delivering eligible B.
2. A real publication-only delivery produced three synthetic GitHub PATCH 503s.
   Each retry occurred 16 minutes after the preceding failure, beyond the
   15-minute lease. No contention/deferral receipt was created. The third failure
   closed the job with `publicationAttempts=3`, but `queuePublicationIfAbsent`
   returned `queued=true`, creating a fresh attempt-zero job for the same article.

The original tests failed on precisely these two assertions before runtime edits.
Both pass after the repair, with actual registered handlers and provider-only
transport doubles. No test clears an attempted external ambiguity to make progress.

## Minimal shared eligibility repair

- Existing failed job receipts are the authority. Three exhausted publication
  attempts close the article even without a deferral receipt. Historical jobs
  without a recorded hash are conservatively closed by exact site/article ID;
  changing a timestamp/configuration is not proof of new reviewed work. A
  distinct genuinely reviewed article has its own receipt history.
- The assignment08 additive index now contains `[siteId, articleId, status]`.
  Every eligibility query constrains **all three fields**, with status `failed`.
  Done/pending/running job bodies are not read for this check. No fallback scans
  other sites by article ID, and payload/article binding conflicts fail closed.
- The same read-only projection supplies scheduler selection, run completion,
  health, operator snapshots, and promotion checks. Terminal records are excluded
  from usable inventory without changing an article's ready/passed state, audit
  hash, quality score, topic consumption, or the closed job. Operator projections
  include an allowlisted blocker and receipt ID, not raw job errors/payloads.
- The scheduler selects the oldest eligible artifact. A terminal A cannot
  poison B or inflate the refill count. If another workflow still owns the
  destination fence, including an expired ambiguous one, the scheduler returns
  `publication_destination_contended` and creates neither new delivery nor
  generation. Existing lease owner/recovery remains the only release authority.
- Incomplete history or a saturated candidate window is explicit, not permission
  to spend on alleged buffer shortage. A saturated individual history still
  permits a later independently validated clean artifact to deliver when due.
- No optional stored field or table was added by09. The combined08/09 schema
  remains61 tables/293 indexes, one additive index above production/main.

## Connected evidence (virtual UTC, not customer acceptance)

| Scenario | Exact observed result |
| --- | --- |
| Pure-contention terminal A; legitimate pristine-owner release; B delivery | Due Sep12 12:00:00.007; A terminal after four callbacks at13:00:00.007; B published13:00:00.040, verified13:00:00.041; fresh replacement created13:00:00.043 |
| B replacement artifact | `00356f9b6685a3107bae31a72fc5df0384d233272cb2135c471c4201a0771611`; A remains sealed ready but unusable; its closed job and zero failures are unchanged |
| Three writes, publication-only, no deferral | Sep11 12:00:00.007,12:16:00.007,12:32:00.007; failed count3, zero visible commits; repeated queue and natural scheduler wakes cannot grant new attempts |
| Three writes, original generation job, no deferral | Sep11 12:00:00.001,12:16:00.001,12:32:00.001; failed count3, zero commits; article retains `review` under its immutable publication fence |
| Generation-origin queue distinction | This original shape was already rejected by the ready-only queue guard; no escape reproduced. Repeated queue requests throw the strict-ready error, worker wakes cannot reclaim the closed job, and no workflow reset is manufactured. The separate historical-ready receipt test covers prior ready-shaped records with no deferral |
| Attempted B ambiguity | Existing release mutation rejects; repeated scheduler wakes return exact destination blocker; jobs, provider-call count, model-call count, and fence remain unchanged |
| All four deliveries closed | Usable count0 in scheduler/operator/health; ordinary bounded fresh refill is admitted; no closed delivery is replayed |
| Overflow, ordering, cross-site and concurrent wakes | Saturated A closes only A; malformed other-site history cannot control B; three concurrent scheduler wakes create one B delivery |
| Beyond the old25-row window |25 older metadata-only closed rows plus real terminal A do not hide genuinely reviewed B. Existing article-created indexes, not summary/migration insertion time, control the read ordering |
| Candidate saturation |51 closed metadata rows produce `publication_buffer_scan_incomplete`; no delivery, generation, or provider call is authorized |
| Legacy-domain saturation | A separately reproduced full51-row old-domain window previously filtered to an apparent empty pool. It now fails closed as `article_summary_domain_window_incomplete`; the actual scheduler preserves that explicit blocker, with no provider call |

The B scenario proves a fresh replacement after consumption, not full restored
target4: this finite fixture has one remaining unused topic and usable buffer3.
All assignment08 cases remain, including ordinary fresh two-cadence pipelines,
second due period, transient retry/reconciliation, stale claims, four/60-minute
wait limits, quality quarantine, provider budgets, expiry and idempotency.
Metadata-only load/history rows are explicitly not generated-article acceptance.
The fixture serializes mutations and validates real handler arguments/indexes;
it does not simulate distributed Convex OCC or production provider quality.

## Read amplification and finite inspection

The earlier25×101 full-history approach was replaced before final review.
One projection inspects at most50 candidate summaries plus one sentinel, and
keeps at most25 usable rows. Supported maximum buffer target is12 (21/week);
the extra candidate allowance permits closed records to be skipped. The oldest
candidate window is finite; if it cannot establish inventory, that limitation
is surfaced and refill is blocked, never represented as a confirmed empty pool.
For legacy domain bindings, filtering old-domain records out of a full window
cannot establish an empty pool. The query now reports a bounded-domain-window
error, which the scheduler classifies explicitly; read-only operator queries
surface that error instead of returning a fictitious zero-buffer projection.

Failed-history allowance is128 returned rows per projection, plus at most one
sentinel for each of50 candidates: **at most178 failed-job rows**. The individual
history completeness limit remains100 failed records; the shared budget may
stop inspection sooner and explicitly mark that article's history incomplete.
Even with the shared budget spent, a one-row sentinel can prove a later article
has no failed history. The queue mutation independently rechecks its selected
article under its original100-record completeness bound, in the write transaction.

Measured registered-query fixture results (serialized JSON payload bytes, not
Convex billable database/index bytes):

| Buffer/history fixture | Failed-job index calls | Failed rows / bytes | Ready-summary read |
| --- | ---: | ---: | --- |
|4 clean metadata rows |4 |0 /0 | One bounded ready range |
|12 clean metadata rows |12 |0 /0 | One bounded ready range |
|4 actual ready artifacts, one terminal |4 |1 /1,023 | One bounded ready range |
|25 candidates with101 failed rows each |25 |152 /81,924 |1 range;25 rows /60,189 bytes |
|50 candidates with101 failed rows each |50 |177 /95,849 |1 range;50 rows /120,464 bytes |

The25-case stored representative history was1,399,305 bytes, versus81,924 read.
The operator query repeats exactly the same25/152/81,924 result, not multiple
eligibility calls within its single projection. `growthLoop.getStatus` has **zero
new calls** to this helper; its production read-reduction implementation is untouched.
No article markdown/body is loaded by the eligibility projection.

Costs still multiply across consumers: normal scheduler state plus run completion
is two separate projections; audit refresh can re-read state, and an atomic
delivery queue adds one selected-artifact check. Each fleet reader is already
capped at50 sites. A deliberately pathological50-site fleet at the measured
50-candidate shape would contribute2,500 failed-job ranges/8,850 failed rows and
2,500 summaries, about10.82 MB of representative JSON, before its other existing
reads. This is a bound/illustration, not proof of safe production billing or of
arbitrarily large historic job payloads. No fleet records were inspected.
Convex's actual transaction constraints include16 MiB read data,32,000 scanned
documents, and4,096 index ranges; payload/index overhead and other function reads
must also fit. [Official limits](https://docs.convex.dev/production/state/limits).
No cache/framework or schema-wide migration was introduced. Final review must
consider this residual worst-case amplification before deployment; ordinary
clean buffers add index probes, not completed generation payload reads.

## Release gates

Final Node24 full suite: **1,474 passed,0 failed/cancelled/skipped**, including
26 core-pipeline cases plus3 continuation cases. Typecheck and production build
pass; schema compatibility is61 tables/293 indexes (+1 additive index vs
production); secret scan passes622 tracked files; production dependency audit
has0 vulnerabilities with package/lockfiles unchanged. Lint has0 errors and157
existing warnings, none in the new eligibility helper. Desktop/mobile browser
gate:16 passed/2 explicit authenticated skips; these are not authenticated
customer acceptance. Build/browser configuration used synthetic test keys.

Test-maintenance changes retain all previous assertions: the run-count source
anchor follows the shared eligibility helper, the recent-candidate assertion
selects its exact index rather than the first `*_created` read, and the small
cadence harness now returns promises matching the real ActionCtx contract.
The full suite passes after those fixture corrections and the added legacy
window regression. `git diff --check` passes. No runtime edit follows these gates.

## One permitted production observation, after13:15

Only Pentra `jh74txye54jna4t85m6y7p4d6h82v9ab` and LeadPilot
`jh7cccny67df67rdm4jp65tmtn8am982` were read. One bounded bundle used the
credential-free operator/evidence-status queries; no triggers or repeat polling.
Pentra snapshot13:15:42.784, observed13:15:44.638; LeadPilot snapshot13:15:45.623,
observed13:15:47.853 UTC on Sep11.

- Pentra1 ready/minimum3/target4, no active job, `planning_blocked`, one missing
  topic-evidence item. Last actual publication Sep11 10:24:02.469 UTC;
  scheduled next publication Sep12 10:24:02.469 UTC. Deadline receipt remains
  scheduled. Latest natural completion12:00:18.112, before deployed07.
- LeadPilot0/minimum9/target12, no active job, `missed`, six missing topic-evidence
  items. Last actual publication Sep7 22:15:34.409 UTC; missed deadline Sep8
  06:15:34.409 UTC. That deadline completed `planning_blocked`; no upcoming run
  appeared in the bounded projection. Latest natural completion12:00:24.739.
- Observed evidence skip receipts still say `no_current_demand_candidates` with
  zero eligible candidates (Pentra evaluated10:24:15.939; LeadPilot10:26:08.806).
  These receipts do not prove that a13:15 fleet evaluation executed or failed.
  No newer demand receipt or financial audit was requested in this bundle.

The latest full financial audit remains assignment07 at12:29 UTC: verified
actual2.992560 USD, settled execution ceilings12 USD, outstanding ceilings
16.05 USD, permitted subtotal31.042560 USD. Headroom then was at most0.957440
against the32 USD account cap and0.878560 against the approved4 USD incremental
discovery window (3.121440 used); a1 USD planning reservation was legitimately
blocked internally. Account/month reset Oct1 00:00 UTC does not authorize a
renewed incremental spending allowance. No invalid terminal reservations or
double-counting were found in that audit. The historical free DataForSEO balance
26.720668 USD at10:29:27.120 was not wallet exhaustion and says nothing about
other provider balances. These financial figures were **not refreshed by09**.
The exact rejection is `provider_account_monthly_budget_reserved` from the
internal reservation admission in `convex/lib/providerSpendReservation.ts`,
first scope `approved_incremental_window`; the independent32 USD owner/month
ceiling also lacks room for the1 USD request. The35 USD fleet ceiling is
unchanged. No other tenants were inspected to infer additional headroom.

**NOT READY remains the live acceptance verdict.** No fresh LeadPilot replenishment,
both-tenant full buffer restoration, new customer monetisation acceptance, or
attributable SEO growth is claimed. Today's cutoff is Sep12 07:00 UTC; Pentra's
existing natural next deadline lies after it. No early publishing, cap increase,
extra operator generation/revision spend, backlink work, push, or deployment was
performed. The production runtime remains8e9e147 until a separately approved release.
