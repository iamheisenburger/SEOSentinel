# September acceptance: authority, evidence, and spending boundaries

Updated: 2026-09-08 14:11 UTC. Only Pentra and LeadPilot are in scope.

## Approved discovery increase

The user approved a temporary shared-owner September account cap increase
from $28 to $32, with at most $4 incremental planning/discovery/evidence spend.
This does not authorize unlimited generation or a higher fleet cap.

The implementation uses an immutable, account-hash/month approval receipt and
an optional canonical-entitlement pointer. There are no tenant IDs in runtime
branches. The normal Enterprise default remains $28. The effective override
expires by the UTC billing clock at **2026-10-01 00:00:00 UTC** (September 30,
17:00 PDT); no scheduled reversion mutation is required. Daily account $9.60,
daily fleet $9.85, monthly fleet $35, attempt, lease, idempotency and quality
limits are unchanged.

Two independent money fences apply: $32 total monthly consumption and $4
consumption from reservations created at/after the approval timestamp. Older
receipt settlements cannot expand this incremental test envelope. Duplicate
approval calls reuse the original receipt and timestamp; changed contracts
fail closed. Expired approvals, account/plan mismatches, invalid dates and
oversized amounts cannot raise the default. Concurrent admission tests model
Convex serializable OCC retries across two sites sharing one account.

Installed at **2026-09-08 14:01:35.681 UTC**, receipt
`sn756ejbtp5marqw1chdpdskp58e0j8y`, reference
`owner-approved-20260908-019fec9f`. Post-deployment exact-site audits at
14:01:58–14:02:00 confirmed the same approval on both tenants, $32 effective
cap, $28 unchanged base, $4 incremental fence, and the October 1 expiry.
Both complete site/source windows reported zero invalid settlements, duplicate
source references, source-less reservations or active jobs. The allowed
ledgers remain **$27.921120** consumed ($2.871120 verified actual + $12 spent
execution ceilings + $13.05 retained ceilings). New approved-window consumption
is **$0**. Monthly headroom from these allowed rows is at most $4.078880;
the separate incremental fence limits newly approved testing to **at most $4**.
Other tenants/account rows were not inspected; these are scoped upper bounds,
not a fresh fleet-capacity or provider-wallet balance assertion.
An exact production replay of the approval returned `created: false`, the same
receipt and original approval timestamp, the same ceilings, and the same expiry.
It did not restart the incremental spending window or add another authorization.

Functional release **dcdd93183acf03850619a294a892c88d29ee7589** is pushed and
deployed to Convex `wary-starfish-773`. Vercel Production deployment
**6329350578** succeeded at 14:01:26 UTC. Local gates: 1,430 tests passed,
typecheck/build/schema (61 tables, 292 indexes)/secret scan (602 tracked files)
passed; dependency audit: 0 vulnerabilities; lint: 0 errors/157 existing warnings;
browser: 16 pass/2 explicit authenticated skips. [CI run 34235513786](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34235513786)
completed successfully at 14:10:12 UTC, including the hosted browser checks.
The repaired preselection-empty execution remains
prospective: it was exercised locally, not by replaying a historical paid job.
Post-deploy `recoverCadenceGap` inspections on both tenants returned
`source_plan_fallback_already_attempted`, with **0 provider calls, 0 new
reservations, 0 refunds and 0 settlements**. Pentra examined 53 micro-seed rows;
LeadPilot 52. The budget configuration is installed, but these exhausted source
attempts have not been reopened and fresh admission has not been proven.

## Receipt-led zero-yield diagnosis; no new paid searches

The four live searches and following plan in the budget audit were the last
operator-paid discovery calls. The September 8 continuation has inspected only
existing allowed-tenant records; it has not reset or replayed those attempts.

LeadPilot fallback `pd72gkx5mwr7b6s16yaskxad6n8e0cb1` received 300 rows:
101 invalid metrics, 47 difficulty, 3 brand, 137 business fit, 3 duplicate and
9 overlap rejections. Pentra fallback `pd7et9ewzk9qy03r5qtxrjn2an8e0970`
received 300: 75 invalid metrics, 165 difficulty, 2 brand, 43 business fit,
1 duplicate, 14 overlap. The invalid raw provider rows were not persisted;
their individual missing fields cannot be reconstructed from the aggregate.

Primary discovery probes use exact keyword-overview queries, not keyword
ideas. LeadPilot's composed phrases returned zero rows; Pentra returned eight.
Fallback keyword ideas produced a broader pool dominated by difficult,
off-product, or already-covered queries. This is not provider-wallet exhaustion.

Two evidenced generic repairs:

1. Generic product offerings used exact surface words while the rest of fit
   used inflection roots. Thus "sales lead generation tools" could fail even
   when its title was identical, while singular "tool" passed. Offering roots
   now use the existing shared-root contract: a shared offering plus another
   shared concept, with all business-model, title, practitioner, anchor,
   difficulty and cannibalization checks intact. Business-fit audit version
   advances 9 to 10; **micro-seed attempt policy stays v37**.
2. A strict plan whose measured candidates were eliminated before selection
   threw before staging its empty checkpoint. The latest LeadPilot plan
   `j97f61bthmsffykjztccrs4t9h8e0m0x` is such a failed, no-checkpoint execution;
   normal source selection therefore correctly refuses to treat it as a
   verified exhausted source. Future qualifying executions now pass an empty
   list through the normal exact-lease, exact-reservation staging mutation and
   then fail closed without model, fresh-metric, or SERP calls. Empty staging
   replays are idempotent while the same worker is live; closed/changed leases
   remain rejected. Historical jobs are not backfilled with fabricated proof.

Read-only replay against current allowed-tenant inventory found **zero
survivors after either repair**. The offering repair moved four LeadPilot
candidates past fit, but three were duplicates and one overlapped coverage.
Result: LeadPilot fit 133 / duplicate 6 / overlap 10; Pentra fit 43 / duplicate 3 /
overlap 12. Other rejection categories were unchanged. Current inventory read:
LeadPilot 243 topics/134 article summaries; Pentra 143/126. This is diagnostic
re-evaluation, not a new paid execution, a persisted shortlist, or acceptance.

## Generation authority is separate

Safe exact-name production configuration reads confirmed both
`ARTICLE_PRIMARY_MODEL` and `ARTICLE_FALLBACK_MODEL` are unset. Deployed defaults
are therefore Claude Sonnet 5 and GPT-5.6 Terra. No credential values were
printed or stored. OpenAI Docs was used to verify current pricing, not to
substitute a cheaper quality model.

Standard USD per million tokens: Sonnet 5 input $2 / output $10; Terra short
context $2 / $12 and long context $4 / $18; GPT-5 mini $0.25 / $2; GPT-4o mini
$0.15 / $0.60. The configured GPT Image 1.5 medium 1536×1024 output is $0.05
per image plus applicable input; web search has a $0.01 call fee plus token
charges. Sources: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[OpenAI pricing](https://developers.openai.com/api/docs/pricing), and
[configured image model](https://developers.openai.com/api/docs/models/gpt-image-1.5).

Code bounds include 8-minute article execution time, 3-minute HTTP timeouts,
zero SDK transport retries, structured-response correction bounds, max
16,384 output tokens for long writer/revision calls, up to two ordinary quality
revisions, and account/fleet concurrency 2/3. Several helper model calls do not
set an output-token cap. The existing article guard is an execution-count
allowance (150 purchased articles → 170 provider executions), **not a dollar
meter**. Wall-clock and attempt bounds alone cannot establish a $4 all-provider
generation spending guarantee.

The user **declined** the one consolidated request for **$60 all-in incremental
acceptance testing**, including the already-approved $4 discovery allocation
and at most $56 for model generation/reviews/revisions, research and media.
The user selected **"Keep only the approved $4 discovery allowance."** No
additional generation/revision testing is authorized by this decision; do not
ask again in this run. Existing product-owned publication schedules remain
intact. The following is an unapproved proposal, retained only for audit:
Planning allocation: $48 model work (16 × $3) plus $8 research/media (16 ×
$0.50). Working estimate $40–$55 is a planning estimate, not a billed-cost
receipt or guaranteed success. Correction/fallback usage can consume the
budget sooner. A hard cumulative enforcement boundary would have been required
before any generation/revision test against that envelope; it is not active.

The proposed proof would require 16 successful fresh articles: 2 to restore
Pentra from 2 to target 4, 12 to establish LeadPilot's target 12, then 1 replacement
per tenant after consuming a newly generated scheduled article. Existing
sealed inventory publishing alone does not qualify. Any failed generation or
revision consumes the same financial allowance; no attempt resets, valid
reservation removal, limit bypass or quality weakening. If the budget runs out
before this proof, report the shortfall rather than silently spending more.

## Still not accepted

Pentra: sealed buffer 2/minimum 3/target 4. September 8 publication deadline
12:00:19.580 UTC; actual 12:00:27.426, verified live 12:00:29.554 (7.846s late).
Next exact deadline September 9 12:00:27.426 UTC. LeadPilot: sealed 0/minimum 9/
target 12; last publication September 7 22:15:34.409; September 8 06:15:34.409
deadline missed. Its 13:42:37.322 refill check finished 13:42:47.893 with
`planning_blocked`. Next legitimate plan reconsideration September 9
13:27:38.322 UTC. Current exhausted source attempts remain exhausted.

No new generation, publication or post-consumption refill is proven by these
repairs. No backlinks work has started. Technical release evidence and any
future article acceptance remain separate from attributable organic traffic
and conversions.
