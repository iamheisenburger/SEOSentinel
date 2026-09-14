# Pentra SLC Stage 1 — local implementation review

Assignment: `supervisor-20260914-slc-stage1-25`, 2026-09-14.
Candidate branch: `codex/simplified-article-admission`.
Baseline: `9fd01affd5bc57a681e8b32f2212ed671d3aab2c`.
Implementation checkout: `/Users/madmanhakim/Desktop/SEOSentinel-managed-integrated/.claude/assignment24`.
Canonical contract remains the single parent-workspace
[PENTRA_SLC_PLAN.md](/Users/madmanhakim/Desktop/SEOSentinel-managed-integrated/docs/PENTRA_SLC_PLAN.md).
This report is evidence, not another plan or an acceptance receipt.

## Outcome and scope

Working local GitHub creation slice: explicit service selection, confirmed
business inventory, fresh draft, substantive review, two-item preparation,
fixed-window publication, rendered artifact verification, and fresh refill.
Five business fixtures each complete three delivery/refill cycles: 25 fresh
mocked articles, 15 verified mocked publications, 10 remaining ready articles.
There are no production observations or production changes in this assignment.
Pentra and LeadPilot are NOT accepted; current live buffers, deadlines and
publication times were not re-read and historical numbers are not current proof.

The interrupted global admission relaxation was reviewed and removed from this
candidate. Reused positive-intent logic is confined to explicit growth-first
mode. Legacy fixed-article contracts retain their existing admission policy.
No dormant historical recovery framework was merged wholesale.

## Execution and quality

- Existing `jobs` is the only execution queue. Its optional `contentWork`
  checkpoint owns preparation, review, delivery and verification; the same job
  ID survives draft checkpoint, revision, replacement and publication.
- Existing scheduler dispatch, leases, account/fleet concurrency, attempt
  allowances, article records, quality gates, artifact seals, GitHub publisher
  and live verification are reused. No new table; one bounded job index.
- Growth-first is owner-selected, GitHub-only in this slice, and requires a
  completed current entitlement and confirmed current-domain business/profile
  and connection bindings. Legacy article, plan and paid-growth admissions are
  disabled for migrated sites. Migration/rollback reject unresolved work.
- Two distinct ready items are required before initial schedule activation.
  Five-minute windows end at saved immutable deadlines. Live verification
  advances from the prior deadline, never from a late publication's timestamp.
  Duplicate wakes do not create duplicate work. Failed slots remain outstanding.
- Candidate selection uses current-domain, business-fit, uncovered first-party
  reader questions. Forecasts can order work but missing forecasts do not veto
  it. Existing page/article/topic intent is checked without inventing metrics.
  Finite input exhaustion is explicit, not an endless series of renamed topics.
- At most one initial draft, two targeted revisions total and one distinct
  replacement share the original work budget. No hidden paid length-repair,
  metadata, optional image/research or provider fallback ladder. Optional
  first-party HTTP failure does not universally veto supported guidance.
- Strict factual/evidence, business-fit and artifact gates remain. Unsupported
  quantitative claims fail. Growth review does not silently rewrite/prune a
  failed claim into a claimed acceptance outside the targeted revision budget.
- GitHub creation cannot overwrite a pre-existing customer or earlier
  Pentra-owned path. An uncertain write is reconciled through existing leases
  before retry. Verification checks actual URL, canonical, title/description
  and the complete rendered approved body, not just API acknowledgment.
- Settings exposes consent and funding/preparation readiness. This is the
  Stage 1 interface, not completed Stage 3 authenticated customer acceptance.

## Reservation safety and financial boundary

`content_work` uses existing `provider_spend_reservations` and unchanged
account/fleet ceilings. The source job and full work reservation are atomic.
Keyed call receipts on that job precede I/O and prevent retry/idempotency replay
from starting another paid call. Model pricing is deployment-owned and absent
by default; no pricing/allowance was configured here. Unknown cost blocks work.

Known complete provider usage settles the shared reservation once, including
terminal quality failure. Proven terminal no-I/O cancellation/expiry releases
only the unused reservation by appending release metadata. Pending work remains
reserved; incomplete provider receipts retain the original full ceiling.
Stale workers cannot start calls, settlement does not reset attempts, and an
old UTC-day reservation cannot fund new-day calls. No reservation is deleted.

Approved additional USD 20 provider validation allowance remains **inactive and
unspent**. The old USD 4 discovery envelope is neither renewed nor reset. No
account/fleet cap, production financial receipt or infrastructure limit changed.
Stage 4 still requires an enforceable cumulative USD 20 scope binding within
existing accounting and reviewed real model prices before any paid validation.
Deployment pricing alone must not be mistaken for that authorization.

Test-isolation incident: the first exploratory SDK wrapper omitted injected
`fetch`, allowing one request with a literal synthetic test key and synthetic
`.example` fixture data to reach Anthropic. It returned HTTP 401 invalid API key;
no model generation ran and billable provider expenditure was USD 0. No real
credentials or production tenant data were accessed. The wrapper now explicitly
injects `fetch` and disables SDK retries; subsequent runtime tests assert their
mock transport boundary. This report does not claim zero provider requests.

## Connected regression evidence

Fourteen new SLC runtime tests invoke actual registered handlers with the
existing serializable in-memory database/scheduler and explicit mock HTTP/model
transports. Coverage includes five business types, empty starting inventories,
different schedules, three cycles each, exhausted/unknown budgets and attempts,
provider failure, two revisions/replacement, interrupted checkpoint, duplicate
workers/admissions, optional-source failure, isolation, migration consent,
lost publication response, corrupted live canonical/title/body, current-access
revocation, owner approval, stale leases, cancellation, UTC expiry and terminal
settlement. Existing legacy/shared-reservation tests remain in the full suite.

These are virtual timestamps on **2026-09-11 UTC**, not real publication times.
Each listed deadline has a window beginning exactly five minutes earlier.
Each cycle below finishes with **2 ready items**, including fresh replacements.

| Fixture / business | Deadlines (cycles 1 / 2 / 3) | Mock publication times (cycles 1 / 2 / 3) | Mock verification times (cycles 1 / 2 / 3) |
| --- | --- | --- | --- |
| ReservoirNote / SaaS | 12:10 / 12:30 / 12:50 | 12:05:00.007 / 12:25:00.021 / 12:45:00.023 | 12:05:00.010 / 12:25:00.024 / 12:45:00.026 |
| CedarCare / local service | 12:10 / 12:40 / 13:10 | 12:05:00.007 / 12:35:00.028 / 13:05:00.016 | 12:05:00.010 / 12:35:00.031 / 13:05:00.019 |
| ClayShelf / retail | 12:10 / 12:50 / 13:30 | 12:05:00.007 / 12:45:00.028 / 13:25:00.019 | 12:05:00.010 / 12:45:00.031 / 13:25:00.022 |
| BriefHarbor / agency | 12:10 / 13:00 / 13:50 | 12:05:00.007 / 12:55:00.028 / 13:45:00.019 | 12:05:00.010 / 12:55:00.031 / 13:45:00.022 |
| FieldPress / publishing | 12:10 / 13:10 / 14:10 | 12:05:00.007 / 13:05:00.028 / 14:05:00.019 | 12:05:00.010 / 13:05:00.031 / 14:05:00.022 |

In the lost-response case the later persisted publication timestamp is the
reconciliation observation, not proof of the exact initial external visibility
time. Deliberately late/failing scenarios preserve overdue deadlines and are
not counted as on-time deliveries. Mock quality scores are not real-model
content-quality evidence.

## Final free gates

- Full Node 24 repository suite: 1,545 tests; 1,544 passed, 0 failed, 1 skipped
  (81,551.827209ms), on the final frozen source candidate.
- Next production build: passed, 31 static pages; separate typecheck passed.
- Lint: 0 errors, 157 existing warnings.
- Schema compatibility against the baseline: passed, 61 tables, 294 indexes.
- Production dependency audit: 0 vulnerabilities.
- Playwright desktop/mobile: 16 passed, 2 authenticated tests skipped (6.1s).
  The automated signed-in fixture is absent; this is not a claim that the owner
  is signed out. The new authenticated settings UI is not yet verified live.
- Tracked-file secret scan: passed, 647 tracked files including new source.
  Staged whitespace check: passed.

One repository test is intentionally skipped because its relative LeadPilot
sibling-consumer fixture is unavailable inside this isolated checkout. No
unauthorized sibling or production tenant was inspected to satisfy it.
The skipped repository/browser tests remain explicit acceptance gaps.

## Remaining stages — no overall SaaS or growth acceptance

Stage 2: selected editable-page import and safe improvement, prior versions,
conditional rollback, completed WordPress atomic/idempotent connector and real
WordPress/database integration, weekly opportunity review and fourteen-day
discretionary revision cooldown.

Stage 3: complete authenticated onboarding/permissions/billing/schedule
activation/pause/resume/reporting journey and real authenticated UI checks.

Stage 4: enforce the approved cumulative validation scope; review deployment
and migration; reconcile only Pentra and LeadPilot without erasing unresolved
history; observe three consecutive ordinary live delivery/refill cycles per
tenant with fixed deadlines and actual artifacts; execute real post-publication
Search Console ingestion and an evidence-backed verified follow-up improvement.
Report organic-click complete-window comparisons, new-page cohorts and missing
data separately from technical delivery and without unsupported causality.

No push, deployment, production migration, paid validation, prospect contact or
backlinks work occurred. The exact candidate needs supervisor review before the
next bounded assignment. Local test success does not resolve LeadPilot's live
overdue status or establish monetisation readiness.
