# September 10: deployment outage and release-gate repair

Assignment: `supervisor-20260910-refresh-and-convergence-01`.
Refresh: **2026-09-10 20:03 UTC**; public observations 19:52–20:01. All times
below are UTC.
Only Pentra (`jh74txye54jna4t85m6y7p4d6h82v9ab`) and LeadPilot
(`jh7cccny67df67rdm4jp65tmtn8am982`) were targeted. No other tenant was queried
or enumerated. The supervisor owns follow-up scheduling; no automation added.

## Current critical path: Convex is disabled

Exact-site `autopilot:getOperatorSnapshot`, `providerBudget:getSiteReservationAudit`
and the narrower `providerBudget:getSiteReservationSnapshot` could not execute.
The CLI returned a server error stating that free-plan limits were exceeded
and deployments disabled. A separate exact LeadPilot snapshot at
**19:52:10.497** confirmed the same failure and returned no tenant records.
This blocks receipt inspection as well as normal database-backed work.

This is a **Convex platform quota failure**, distinct from Pentra's internal
`provider_account_monthly_budget_reserved` guard and DataForSEO wallet credit.
The exact exhausted Convex resource, usage, limit, disable timestamp, and reset
time are **unknown**. The deploy-key CLI context cannot fetch the team billing
diagnostics; no broader team/project/tenant inspection was attempted. An owner
must establish the quota/restoration path through the existing Convex account.
No upgrade, purchase, support contact, quota change, or authentication reset was
performed. October 1 is the internal provider-budget boundary, **not an observed
Convex restoration time**. Convex documents separate platform limits and
[deployment disabling](https://docs.convex.dev/production/usage-limits).

## Delivery and inventory: new evidence versus unavailable receipts

| Tenant / event | Exact evidence | What remains unverified |
| --- | --- | --- |
| Pentra September 9 delivery | Last recorded deadline **2026-09-09 12:00:27.426**. New repository article frontmatter date **12:00:29.865** (+2.439 seconds); Git commit **12:00:31**. | Backend finalized publication time and live-verification receipt are inaccessible. Artifact time is not a substitute. |
| Pentra new live artifact | `/blog/digital-marketing-keyword-guide` returned **HTTP 500 at September 10 19:52:26.521**. | No currently verified live article at that URL. |
| Pentra earlier artifact | `/blog/intelligent-content-automation` returned **HTTP 500 at 19:52:26.883**. | Its September 8 HTTP 200 receipt is historical, not current availability. |
| LeadPilot planning | Last recorded reconsideration **September 9 13:27:38.322**, run `kd74aatqn944yza0grsd5cp8518e02j0`. | Whether it ran, its result, later exact deadlines, and September 9/10 natural demand/evidence receipts cannot be read. |
| LeadPilot public site | Sitemap HTTP 200 at **19:52:28.134**. Two older article URLs HTTP 200 at **19:54:04.007 / 19:54:04.350**, with matching H1/canonical. | Those pages report March publication dates; they do not establish September 9/10 delivery or refill. |

The new Pentra artifact is `content/blog/digital-marketing-keyword-guide.md`,
title “Digital Marketing Keywords: How to Find and Organize the Terms That
Actually Drive Traffic”, commit **`f3e0334bcc24a84bd79ab71bb1d9590f97c87484`**.
Frontmatter records publication gate v7, factual 86/editorial 85/content 72,
media passed, audited hash
`62af6f6631b2cc62a324ca593ea4790f2c618f42d63b80b2b4b64c9648b029b5`.
Vercel Production **6349187733** was created September 9 **12:01:05** and
reported success **12:01:06**. Repository and deployment receipts prove an
artifact delivery, not current HTTP availability or a fresh replenishment chain.

Current sealed buffers, new topics, active jobs, quality approvals, and
post-consumption replacements are **unknown on both tenants**. Last exact
September 8 14:02 snapshots were Pentra 2/min 3/target 4 and LeadPilot 0/min 9/target 12.
Do not subtract a presumed consumption to invent a September 10 count. The last
verified LeadPilot publication was September 7 **22:15:34.409**; the recorded
September 8 **06:15:34.409** deadline was missed. It has not been shown recovered.

Pentra's public article route is dynamic and directly awaits
`api.blog.getPublishedBySlug` in `src/app/blog/[slug]/page.tsx`. A failed backend
query therefore prevents rendering; the observed 500s are consistent with the
confirmed backend outage. No static Markdown fallback was added: repository
frontmatter cannot independently establish current ownership, revocation, or
the authoritative publication/quality state while the database is unavailable.

## Provider money: no new expenditure or accounting mutation

This refresh made **zero paid provider calls, zero reservations, zero refunds,
zero settlements, zero attempt resets, and zero generation/revision tests**.
Operator incremental provider expenditure in this assignment: **$0**.
Natural jobs since September 8 cannot be reconciled while Convex is disabled;
the current remaining $4 allowance and provider wallet balance are unknown.
Do not report the allowance as fully unspent today.

Last verified configuration, installed September 8 **14:01:35.681**:

| Internal USD scope | Last verified value |
| --- | ---: |
| Shared-owner September monthly effective limit / unchanged base | 32 / 28 |
| Separate incremental discovery/planning/evidence limit | 4 |
| Shared-owner daily limit | 9.60 |
| Fleet monthly / daily limits | 35 / 9.85 |
| Verified actual-cost settlements, two authorized sites | 2.871120 |
| Settled spent-execution ceilings, not measured cash | 12.000000 |
| Retained ceilings, not an active-job count | 13.050000 |
| Combined internal consumption | 27.921120 |
| Scoped monthly headroom upper bound / incremental-window bound then | 4.078880 / 4.000000 |

The original guard is `reserveSharedProviderBudget` →
`evaluateProviderAccountCapacity` in `convex/lib/providerSpendReservation.ts`:
owner-account current UTC-month consumption plus the request must fit the
effective ceiling. The approved incremental window can now return the same
reason with `budgetScope: approved_incremental_window`; it independently counts
post-approval reservations. No September 10 receipt identifies a new guard
rejection because the platform refuses execution first. Actual settlement
replaces reserved consumption, rather than being added a second time.

Two prior proven accounting defects were repaired and production-verified on
September 8, restoring exactly **$1.10**. Valid paid/ambiguous ceilings remain.
See `PROVIDER_BUDGET_AUDIT_2026-09-08.md` for terminal/cancellation/expiry,
settlement/idempotency, and simulated serializable-concurrency regressions.
The immutable $4 approval expires **2026-10-01 00:00:00 UTC**; the $28 base
continues. The $60 all-in proposal was declined. No repeated request is made.

## Advance replenishment capacity: existing contracts, not live proof

The current code already scales buffer minimums to a 72-hour outage horizon
and targets one additional publishing day. For the last verified cadences
7/week and 21/week this means min 3/target 4 and min 9/target 12. Underfilled buffers
allow respectively **3 and 5 distinct plans per rolling day**, not one.
Terminal semantic-zero-yield failures can become eligible for a distinct
strategy after 15 minutes; funding, transport, budget, and ambiguous failures
preserve their own deadlines. Exhausted paid jobs do not become replayable.

New single-execution checkpoint plans reserve at most $1 each; their ten-topic
capacity is a maximum, not a promise of usable output. They are not subject to
the legacy/manual `ceil(article allowance / 10)` monthly plan-count rule, but
article quota, bounded rolling planning, shared-account/fleet money, and strict
quality/evidence gates remain mandatory. No capacity limits were changed.

The last paid receipts had either no candidates or candidates eliminated by
metrics/difficulty/business fit/duplicates/overlap; no fresh verified topic
survived. September 8 read-only business-fit repair replay also yielded zero.
There is no current evidence of an additional scheduler defect to justify a
blind cooldown/attempt-policy change. Faster eligibility cannot by itself
repair zero yield or a disabled backend. Live evidence and spend must be
refreshed after legitimate platform restoration before another paid hypothesis.

## Generic release-gate repair

September 9 quality run
[34348571008](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34348571008)
failed at the fail-closed OSV step **12:02:51–12:02:52** on real dependency
advisories, not article-quality rejection. OSV identified four affected packages
and eight vulnerabilities. The runtime Next.js 16.3.0 and Nodemailer 9.0.5 and
transitive Sharp 0.35.3/js-yaml 4.3.1 needed fixes.

Narrow patched dependency tree: **Next.js 16.3.4, Nodemailer 9.1.1,
Mailparser 3.9.20 (also using Nodemailer 9.1.1), Sharp 0.35.4, js-yaml 4.3.2**.
No vulnerable nested Nodemailer is left. Main/runtime and full-tree npm audits
report zero vulnerabilities after clean installation. Quality gates were not
weakened. Primary advisories:
[Next.js](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4),
[Nodemailer](https://github.com/advisories/GHSA-8m3c-c648-2xjj),
[Sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c),
[js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

Local verification: **1,430 tests pass**, type-check, production build, schema
compatibility (61 tables/292 indexes), secret scan (603 tracked files), full-tree
and production npm audits (zero vulnerabilities) pass. Lint: 0 errors/157 existing
warnings. Browser: 16 pass/2 explicit authenticated skips using non-secret test
configuration. Patch **`707748b5610b1ab88250312ebff34a4d82914677`** is pushed.
Vercel Production **6380017618** reported success **September 10 20:00:46** for
that exact SHA; receipt URL
`https://seo-sentinel-ebgdlbxva-arshads-projects-836ebfbd.vercel.app`.
Post-deploy public checks: homepage **HTTP 200 at 20:01:10.610**; new article
**HTTP 500 at 20:01:11.717**; earlier article **HTTP 500 at 20:01:12.304**. The
dependency patch does not restore backend availability or article delivery.
Hosted [CI 34523644575](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34523644575)
passed for that exact SHA: job completed **20:03:02**, run finalized **20:03:03**.
Hosted browser checks passed; the independent OSV fallback was correctly skipped
because npm audit passed, not bypassed or disabled. No Convex backend deployment
has been performed during the outage, so the backend dependency update is not
claimed live. Its last known functional code release
remains `dcdd93183acf03850619a294a892c88d29ee7589`.

## Safe next decision

Owner/platform restoration is the immediate external prerequisite; there is no
known safe restoration deadline. Once restored, refresh only the two exact-site
snapshots and ledgers, reconcile the approved $4 envelope, and inspect the
September 9 wake/deadline plus September 9/10 demand→evidence receipts before
dispatching anything. Preserve natural schedules; do not replay exhausted work.
Nominal next fleet slots are **September 10 21:00 UTC** (article cadence) and
**September 11 13:15 UTC** (demand→evidence), conditional on a running backend.
They are not confirmed scheduled receipts or promises of recovery. Micro-seed
maintenance is every 15 minutes and receipt-safe recovery/SLA checks hourly.

Acceptance still requires fresh topic→generation→quality→buffer→scheduled new
publication→verified live artifact on both tenants, followed by replacement
after consumption. None of that full chain is newly proven here. Dependency
gates are technical evidence only; no backlink work or attributable SEO-growth
claim is justified while LeadPilot recovery and fresh replenishment are unproven.
