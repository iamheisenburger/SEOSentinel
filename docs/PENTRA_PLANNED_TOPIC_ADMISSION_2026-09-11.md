# Exact planned-topic admission — assignment 13

2026-09-11. **The seven topics are not runnable fresh replenishment. No
circular/stale admission defect was established, and no behavioral repair or
paid work was performed.** The diagnostic-only release is
`3b806c6b867ae94cb160a14b7c2c45a47ca2291d`, based on reviewed55d9f10 plus
assignment12's documentation. It preserves existing scheduling, admission,
quality, cost, epoch, ownership and no-replay rules. Safe machine-readable
receipts are in `PENTRA_PLANNED_TOPIC_ADMISSION_2026-09-11.json`.

## Corrected diagnosis: exact rule order matters

Both current site-level planned gates pass: 37 active article-usage units of
150, remaining113, live modes, epochs Pentra6/LeadPilot9. Tenant authority is
fresh and domain-bound: Pentra rank0 measured Aug28 13:14:16.517UTC (45-day
expiry Oct12 13:14:16.517); LeadPilot rank4 measured Aug20 20:44:27.329
(expiry Oct4 20:44:27.329). Source is
`dataforseo:backlinks_bulk_pages_summary:one_hundred` on both.

All seven topics are current-domain `planned`, have no linked current-domain
article or active article job, and have no checkpoint terminal or SERP-attempt
receipt. All seven stored fit receipts exactly match recomputation under fit
version10 (eligibility, score, version and reasons). These are NOT stale-fit,
site-entitlement, article-quota, active-worker or checkpoint blockers.

The exact phase matrix, observed **14:25:44.756/47.563 UTC**, is:

| Tenant / planned keyword | Demand / measured KD | Demand-phase first result | Evidence-phase first blocker |
| --- | --- | --- | --- |
| Pentra — automated content calendar SEO | Both absent | `keyword_difficulty_unverified` | `keyword_difficulty_unverified` |
| LeadPilot — software sales | 1,900/month; KD0 measured | `demand_already_current` | `exact_evidence_already_attempted`, v2 |
| LeadPilot — agent sales representative | 40/month; KD0 measured | `demand_already_current` | `exact_evidence_already_attempted`, v2 |
| LeadPilot — ai sales automation | 260/month; KD21 measured | `demand_already_current` | Actual pre-SERP coverage conflict with **sales automation tools** |
| LeadPilot — sales integration | 40/month; KD3 measured | `demand_already_current` | `exact_evidence_already_attempted`, v2 |
| LeadPilot — sales conversation example | 30/month; KD0 measured | `demand_already_current` | `exact_evidence_already_attempted`, v2 |
| LeadPilot — sales chatbot | 140/month; KD7 measured | `demand_already_current` | `exact_evidence_already_attempted`, v2 |

All six LeadPilot demand receipts are positive, current, sourced from
`dataforseo:keyword_metrics`, location2840/languageen. No topic has persisted
SERP URLs, SERP locale/time provenance, or page-one authority rows. Pentra has
no exact demand receipt and no measured keyword difficulty.

**Correction to assignment12:** its complete-portfolio projection described
LeadPilot's demand as missing/stale/not auditable. That is not the recovery
demand predicate's verdict. `expectedClickTopicFromStoredEvidence` withholds
the portfolio's demand input unless demand AND SERP locales are bound; missing
SERP provenance therefore also yields the portfolio's generic missing-demand
message. The actual `hasCurrentExactDemand` and
`hasCurrentExpectedClickDemand` predicates accept all six existing LeadPilot
demand receipts. This reporting conflation must not be used to justify buying
the same demand again. No estimator/reporting behavior was changed here.

## Provenance and attempts

All dates below are UTC; exact topic IDs appear in the JSON.

| LeadPilot keyword | Exact demand measured | Existing evidence attempt |
| --- | --- | --- |
| software sales | Sep4 01:35:29.522 | Sep4 01:35:35.836, v2 |
| agent sales representative | Sep4 04:34:27.240 | Sep4 04:34:32.040, v2 |
| ai sales automation | Sep4 09:32:24.638 | None |
| sales integration | Sep4 19:20:58.653 | Sep4 19:23:22.843, v2 |
| sales conversation example | Sep4 20:46:23.533 | Sep4 20:53:34.589, v2 |
| sales chatbot | Sep6 00:31:03.948 | Sep6 00:31:09.575, v2 |

The five exact-keyword attempt fences persist even if generic `updatedAt` or
business-fit audits change. An absent usable SERP is not evidence that the
provider request never happened. This package did not retrieve original
provider-response bodies or infer each historical request's semantic failure
from a marker alone. It did verify the ordinary fleet's present eligibility
and absence of a resumable fleet evidence job; it did not clear or repurchase
these attempts. Their historical micro-seed versions9/14/31/35 are provenance,
not new spending authority under a newer software policy.

For `ai sales automation`, both actual phase admission functions passed. The
diagnostic correctly returned `requires_ordinary_selection`, not `eligible`.
The existing exact-topic coverage audit at **14:27:05.818 UTC** then inspected
the current67-item canonical covered-intent corpus, without a read-limit
failure, and found **sales automation tools** as the conflict. That covered
topic has a reliable stored SERP fingerprint; the candidate has none.
`filterPlannedTopicRecoveryCoverage` deliberately strips unverified candidate
SERPs and calls the existing conservative lexical coverage gate before buying
a fresh SERP. Thus this is a real selection refusal, not a stalled callback or
a need to reinterpret a false zero count.

Fresh actual evidence fleet readiness at **14:27:07.442 UTC** returned
`ready:false`, `no_current_demand_candidates`, candidateCount0,
alreadyAttempted5, plannedUnmaterialized0, eligible0. The ordinary recovery
query at **14:27:08.591 UTC** returned `action:none / no_fleet_job`. No current
daily-batch or unresolved-ambiguous-provider gate preempted the returned
zero-candidate selection diagnosis. These are read-only observations, not new
dispatcher completion receipts.

## Exact current source-policy ledger

Source-plan readiness and current-policy ledgers were read once per tenant at
**14:22:45.621–50.077 UTC**. Both source plans are valid exhausted sources, but
both already contain the maximum primary AND fallback attempt under current
micro-seed policy37, in their current rollout epochs. All four attempts record
providerCallAttempted=true, providerCallCompleted=true, status=missed.

| Tenant | Source plan | Primary | Fallback |
| --- | --- | --- | --- |
| Pentra | j97424bc4zey6wwkqhnrh875an8e0h2t | pd7af8sk2nve939ksts3xsaefx8e2kne | pd7374xpbxq1qg750cntkjx75s8e3cgf |
| LeadPilot | j978nhrc6f7ax2z3wntx2n7z6n8e0fc5 | pd714w0bp882tavxjx6kxvt26s8e1qqp | pd71z1mck1kehvcynqghsk9sfs8e00cm |

The actual current-policy admission rejects a two-job source ledger with
`source_plan_fallback_already_attempted`. A successful readiness inspection
does not reset this ledger; a later software version or policy edit is not an
approved way to replay spent seeds. No broad historical-policy scan or source
record mutation was performed.

## What would be lawfully runnable

There is **no presently selectable planned-topic evidence purchase among these
seven**, and no current fallback envelope to replay. The stages are ordered,
not circular: a legitimate newly discovered, product-fit, distinct candidate
must first have measured difficulty; current exact positive demand then allows
the one-time SERP/authority phase; usable current evidence then allows the
existing generation/quality/publication path. Pentra's unmeasured legacy row
does not satisfy the deliberately narrower planned-recovery contract.

The next legitimate replenishment input is a **new genuinely distinct,
measured candidate from an ordinarily admitted new planning source**, or
reconciliation of an existing receipt if independent evidence later proves it
was incorrectly recorded. Neither has been established as available here.
Purchasing another $1 planning reservation remains subject to the unchanged
owner-month and approved incremental discovery windows: assignment07's last
12:29 scoped audit showed at most $0.957440/$0.878560 headroom, respectively.
Those figures were not refreshed in this assignment. No new spend approval,
generation/revision budget, cost-limit increase or withdrawn proposal was
assumed. It would be misleading to call more engineering a substitute for an
absent lawful discovery input or owner-approved funding.

**Engineering conclusion:** no scheduling/admission/spend behavioral repair is
justified by these seven-topic records. The required visibility gap is repaired
by the read-only diagnostic. The portfolio's demand wording is a separate
reporting inconsistency, not the reason these rows can generate or replenish.
Do not relax measured KD, fresh demand/SERP, fit, coverage, quality, attempt
fences or source-policy limits merely to turn the buffer green.

## Diagnostic release and safety receipts

Only `plannedTopicDiagnostics:inspectAdmission` was added as an internal query.
It accepts one exact site plus1–8 unique topic IDs, resolves topic IDs through
that site's index (foreign IDs never dereference another tenant's topic), and
caps topic/summary inventories at512+sentinel and active jobs at50+sentinel per
status. It requires completed summary migration and fails closed on truncated
inventory. It reads no full article Markdown and exposes no raw site/profile,
credentials, payloads, recovery capability fingerprints or arbitrary failure
texts. Current authority sources, hashes, counters, timestamps and finite
first-rule codes are allowlisted. Actual inspected sizes: Pentra145 topics/
128 summaries/0 active jobs; LeadPilot243/134/0.

Three unchanged pure demand/attempt predicates gained `export` for reuse.
Their source bodies were mechanically compared with55d9f10 and matched
exactly after removing those export modifiers. No scheduling/admission/spend
function body, schema, index, budget, attempt, reservation, cadence or auth
setting changed. Existing publication read-amplification repairs remain intact.
Generated API declarations include the new query and two previously existing
publication helper module declarations; these are type-only.

Seven registered-handler regression tests cover arbitrary florist-inventory
and restaurant-reservation businesses, exact site/authority ordering, missing
KD, fit drift, linked/active work, terminal checkpoints, artifact routing,
paid exact-keyword fences despite update churn, foreign IDs, input/read caps,
summary migration, and no secrets/providers/mutations/scheduler calls.

Final local gates: **1,509/1,509 tests pass**, typecheck/build/schema pass,
61 tables/293 indexes unchanged, secret scan629 pass, dependency audit0
vulnerabilities, lint0 errors/157 existing warnings; public browser16 pass/
2 explicit authenticated skips. The final query amendment was re-tested with
the full suite, focused lint, typecheck and production build.

One normal non-force push released exact3b806c6 to main. Convex deployed to
`wary-starfish-773`, CLI success confirmed by **14:25:43 UTC**; schema validation
completed with no deleted indexes. Both new production projections succeeded.
Vercel deployment **6395125259**, status **18229131543**, exact SHA Production,
succeeded **14:25:47 UTC**. Hosted CI **34609981874**, job **103297742904**,
passed **14:29:49 UTC**, including full tests, lint, types, schema, secrets,
dependency audit, production build and public browser tests; OSV fallback
was not needed. [Hosted CI receipt](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34609981874).
No credentials were printed/retrieved,
other tenants inspected, provider calls made, or new automations created.

## Acceptance remains separate

Latest complete buffer/publication baseline remains assignment12:
Pentra1/min3/target4, LeadPilot0/min9/target12, zero scheduler-ready topics;
no fresh generated article or replacement after consumption. The diagnostic
reads do not turn historical articles into postrelease delivery evidence.

Pentra last actual publication **Sep11 10:24:02.469 UTC**, next exact deadline
**Sep12 10:24:02.469**. LeadPilot last actual publication **Sep7 22:15:34.409**,
missed deadline **Sep8 06:15:34.409**. Latest ordinary completions in the baseline
remain Sep11 **12:00:18.112/24.739**, planning_blocked. The next configured
ordinary slot is **15:00 UTC**; no run was forced or observed early.
Today's Los_Angeles cutoff is **Sep12 07:00 UTC**, before Pentra's next cadence
deadline. No direct authenticated customer acceptance or attributable SEO
growth has been demonstrated. Backlinks remain out of scope. **NOT READY.**
