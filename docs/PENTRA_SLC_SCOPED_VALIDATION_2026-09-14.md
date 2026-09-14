# Scoped validation repair32 — local review only

Assignment `supervisor-20260914-slc-scoped-validation-32`. The rejected financial
candidate `79d40cb0f6c2dee1088e45bdc0449f09c416f1c8` was never deployed. This repair
is one local review candidate, not an activation or approval to spend. Deployed
application remains `b3994e0a5a10a24189a7fc767f11b8c3dbb1240a`. USD0 provider spend
in this assignment; the approved USD20 total additional validation run is inactive.

## Cause, reproduction and repair

Candidate31 attached the extra guard to the account entitlement. It then summed
all that owner's reservations, including ordinary third-site work and historical
unknown costs, and stopped all account work after an invented24-hour expiry.
That was an incorrect scope, not evidence of provider credit exhaustion.

An isolated `git archive` of exact79d40cb in `/tmp/pentra32-repro.919JrD` reproduced
all three failures through real `contentWork:advance` and registered approval
handlers. `tests/slc32-baseline.test.ts` contains the standalone reproduction:

```sh
node --experimental-strip-types --test --test-name-pattern='SLC32-baseline' tests/slc32-baseline.test.ts
```

Three failed/zero passed (264.258333ms): after ordinary c reserved0.50 the approved
a could not reserve its separate0.50; historical unknown28.05 wrongly consumed
additional20; expiry stopped unrelated c. All failures were the actual
`content_budget_exhausted` outcome instead of `buffer_fill`, not fixture setup
or schema errors. Running that IDENTICAL reproduction file with the corrected
checkout as working directory (the fixture bundles actual `convex/` handlers
relative to that directory) passes3/3,272.815375ms. The current connected
regressions also exercise these cases and the extended lifecycle below. No
production reservation was altered.

The existing monthly approval row now records the immutable run's exact two
site IDs, approval time, total and reference, plus optional explicit expiry and
idempotent stop time. No new ledger/table/framework. No default24-hour expiry.
Only those sites' saved content schedules carry the run ID. Atomic job admission
carries it to `jobs.contentWork`, then appends the existing provider reservation
with both job and run IDs in the same serializable mutation.

Provider attempts and settlement validate that lineage. Recovery, cached
responses, the two revisions, distinct replacement and UTC reservation renewal
retain it. New refill jobs inherit it from the same schedule. Tagged reservations
are summed via one additional `by_validation` index across all dates, not from
the account's ordinary ledger. A5001-row bounded read fails closed. Unknown new
cost retains the full ceiling; verified settlement replaces that ceiling once;
only existing proven-no-I/O release can free it. Historical unknown reservations
remain unchanged and fully count under their existing account/fleet guards, but
are not charged again against this additional run.

Stopping/expiring the grant rejects new bound provider attempts without falling
back to ordinary money. Original in-flight receipts can still settle. Ordinary
third-site work, including same-owner content and legacy planning, is neither
charged to nor disabled by this grant. Reattaching cannot change the total,
reference, sites, clock or expiry; monthly renewal cannot renew the run. Existing
nonterminal content work must be reconciled before initial attachment, so old
jobs cannot be retroactively adopted. No attachment/stop endpoint was invoked live.

The ordinary account/day/month, separate old4 window, fleet and provider-health
guards remain conjunctive. Internal admission returns a credential-free
`budgetBlocker` receipt with the existing reason, exact scope and numeric ceiling.
The four valid original monthly-authorization regressions remain; seven31 tests
that blessed account-wide interference were removed and replaced with connected
content admission/provider/lifecycle tests.

## Connected evidence and gates

Seventeen focused test results including nested lifecycle cases run in
`tests/core-pipeline-integration.test.ts`. No mocked business handlers: actual
registered admission, claim, provider-attempt, callback, settlement, scheduling,
quality, publication and rendered-artifact verification handlers. Only network
transport, storage and time are synthetic. Fixture restart drops handler memory
while retaining the database/scheduler. Serial mutation execution with rollback
models the committed ordering; the existing separate OCC retry test is retained.

Coverage includes approved sites a/b, same-owner c and foreign d; ordinary legacy
work; historical28.05 holds; old4/account32/fleet35 rejection; invalid/foreign or
retroactive attachment; exact job/reservation/schedule binding; concurrent
attachment/admission; idempotent settlement and stop; cancellation before/after
I/O; unknown costs; completed known costs; explicit expiry; continued ordinary
execution after expiry; restart and September→October renewal; known transient
provider rejection without replay before backoff; bounded revisions/replacement;
and both approved sites' three complete creation/publication/refill cycles.

The ordinary-success fixture creates10 fresh work items: initial2 ready per
site plus3 consumed/refilled per site. All10 reservations retain the same run
lineage and settle once (600 mock micro-units each from three100/100 usage
receipts). Those usage numbers are synthetic, not an estimate of real spend.

| Synthetic site | Cycle | Fixed deadline UTC, 2026-09-11 | Actual fixture publication UTC | Ready after refill |
| --- | --- | --- | --- | --- |
| reservoir.example | 1 | 12:10:00.000 | 12:05:00.012 | 2 |
| cedarcare.example | 1 | 12:10:00.000 | 12:05:00.013 | 2 |
| reservoir.example | 2 | 12:40:00.000 | 12:35:00.055 | 2 |
| cedarcare.example | 2 | 12:40:00.000 | 12:35:00.056 | 2 |
| reservoir.example | 3 | 13:10:00.000 | 13:05:00.031 | 2 |
| cedarcare.example | 3 | 13:10:00.000 | 13:05:00.032 | 2 |

Each exact live fixture artifact is verified; each refill contains work created
after consumption/verification. Neither browsing session nor process-local
state drives recurrence. Production acceptance is not inferred from this table.

Focused final suite17/17 passed,0 failures/skips,2817.429542ms.
Release gates: full suite1661 tests/1660 passed/0 failures/1 pre-existing
sibling-consumer skip,103.383189917s on the final rerun. Typecheck passes. Lint0 errors/157 existing
warnings. Schema compatibility against deployed origin/main passes:61 tables,
296 indexes (one additive index, no deletion). Final staged secret scan681
tracked/staged files passes. Production dependency audit0 vulnerabilities.
Build passes with CI-equivalent nonsecret placeholder public configuration;
initial unconfigured build correctly failed on absent NEXT_PUBLIC_CONVEX_URL.
Local browser24 passed/2 existing genuine authenticated skips,7.1s. No skip was
weakened. Final staged checks and exact candidate SHA are in the handoff.

## Cost envelope — no paid pricing probe or configuration change

The actual scoped provider is `contentWorkProvider.ts` → Anthropic Messages.
Its model comes only from `PENTRA_CONTENT_WORK_PRICING`, which remains absent in
the last live preflight. The existing legacy primary default in `pipeline.ts`
is `claude-sonnet-5`. This is therefore a planning envelope for that existing
model, not a claim it has been configured or live-tested in the new path.
No OpenAI substitution/model downgrade is proposed.

Sonnet5 standard first-party pricing is $2 per million input tokens and $10 per
million output tokens. Anthropic confirms the previously announced September1
increase was cancelled. These are provider token charges, not a verified wallet
balance or all-in invoice/tax total. [Official Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

The actual request enables no caching, thinking, images, web search, batch or
regional premium. SDK automatic retries are disabled. At most200,000 input
tokens are conservatively allowed using serialized UTF-8 bytes plus8,192 framing;
output is capped16,384. Each single call ceiling is at most$0.563840. The actual
quality-failure fixture records12 calls: draft/review/audit, then remediation/
review/audit twice, then one distinct draft/review/audit. Revisions and replacement
share the original job/envelope. The audit output cap scales4096–16384 with claim
count. Missing essential evidence still fails quality; optional research/images
are not silently invoked or priced as free.

| Work component | Calls | Recorded synthetic-request byte/output ceiling repriced at Sonnet5 | Absolute accepted-request ceiling |
| --- | --- | --- | --- |
| Initial draft plus both reviews | 3 | $0.503102 | $1.691520 |
| First targeted revision plus reviews | 3 | $0.519280 | $1.691520 |
| Second targeted revision plus reviews | 3 | $0.519280 | $1.691520 |
| Distinct replacement plus reviews | 3 | $0.503654 | $1.691520 |
| Complete bounded quality path/item | 12 | $2.045316 | $6.766080 |

The middle column deliberately charges maximum output, not the fake100/100
receipt. It is a reproducible illustrative prompt envelope, NOT an expectation
or bound for real Pentra/LeadPilot prose. Absolute right-column bound applies to
any accepted request. Transient recovery can consume more; the enforced20-call
hard stop is at most$11.276800 per job absent a lower configured item budget.
Provider rejection costs are not assumed zero. A smaller item limit legitimately
stops a job before all quality attempts if its remaining ceiling cannot fit.

For initial2-ready buffers and3 ordinary cycles on each site,10 items are needed.
If one accelerated publication per site precedes (rather than counts toward)
the3 ordinary cycles,12 items are needed including replacements of consumed work.
This is a minimum work-count plan, not authority to shift overdue deadlines.

| Complete quality-path planning envelope | 10 items | 12 items |
| --- | --- | --- |
| Illustrative recorded prompt ceilings | $20.453160 | $24.543792 |
| Shortfall versus finite$20 | $0.453160 | $4.543792 |
| Absolute12-call/item ceiling | $67.660800 | $81.192960 |
| Absolute-envelope shortfall versus$20 | $47.660800 | $61.192960 |

These are alternative cost bounds, not interchangeable estimates or spending
requests. Success without revisions has an absolute3-call ceiling$1.691520/item:
$16.915200 for10 or$20.298240 for12, before recovery. Real token usage might be
lower; free fixtures cannot prove it. A20-capped attempt can stop incomplete; it
cannot promise worst-case successful acceptance. No expanded approval is asked.

The immediate tighter prerequisite remains the independently enforced old4/
account32 gates, not merely the nominal20. Last exact-site headroom upper bounds
are$0.878560 old4 and$0.957440 account32. Even an illustrative complete item
reservation rounded to$2.05 lacks at least$1.171440 old-window capacity and
$1.092560 account capacity. A full12-call absolute$6.766080 reservation lacks
at least$5.887520/$5.808640 respectively; it also must fit daily/fleet limits.
The old4 remains discovery-only approval, not generation authorization. Any
change in its guard interaction or account lift needs a separately reviewed,
precisely bounded decision; this candidate does not make it. No missing balance,
readiness or essential evidence is inferred away to make these numbers fit.

## Unresolved production acceptance

No production financial refresh or activation in32. Use release31's exact-site
observation2026-09-14 16:22:58–16:23:04 UTC, explicitly historical now:
Pentra0/4 and LeadPilot0/12; both legacy and planning-blocked. Last publication
Pentra2026-09-12 10:24:14.649 UTC, deadlineSeptember13 same time; LeadPilot
2026-09-07 22:15:34.409 UTC, deadlineSeptember8 06:15:34.409 UTC. No new live
publication/refill is verified. LeadPilot publisher receipt remains an open
prerequisite from that observation. Exact-site consumption31.042560 comprises
2.992560 verified actual +12 settled execution ceilings +16.05 retained ceilings,
counted once. Reset/old monthly approval expiry2026-10-01 00:00:00 UTC.
Other tenant/account/fleet records and provider wallet were not inspected.

Read-only check of the existing owner browser at approximately16:48:46 UTC still
showed Google account selection. No identity selected, new prompt issued, auth
reset or other tenant inspected. Authenticated desktop/mobile acceptance remains
open. Independent financial review, actual owner session, LeadPilot destination,
exact migration consent and safely priced/admissible activation precede Stage4.
No deployment, paid call, new automation/task, attempt/reservation reset, cap
change, migration or backlink work. Technical production acceptance and
attributable organic SEO growth remain separate and unproved.
