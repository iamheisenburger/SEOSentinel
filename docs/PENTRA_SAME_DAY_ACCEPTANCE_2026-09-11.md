# September 11 same-day acceptance

Updated 2026-09-11 10:56 UTC. Deadline: **September 11, 2026, end of day
America/Los_Angeles** (cutoff September 12, 07:00 UTC). This deadline is not
moved to the next provider-budget reset. Current verdict: **NOT READY**.

Scope is only Pentra `jh74txye54jna4t85m6y7p4d6h82v9ab` and LeadPilot
`jh7cccny67df67rdm4jp65tmtn8am982`. No other tenant records were inspected.
The September 11 infrastructure outage is resolved; its receipts and exact
budget audit are in `PENTRA_RECOVERY_2026-09-11.md`.

## Demonstrated discovery defect and repair

Read-only offline input: LeadPilot fallback
`pd71z1mck1kehvcynqghsk9sfs8e00cm`, source plan
`j978nhrc6f7ax2z3wntx2n7z6n8e0fc5`, policy37. Only safe whitelisted profile,
topic, article-summary and candidate fields were retained in session memory.
The complete current-domain scope contains 243 topics / 134 article summaries.
The production coverage construction was reproduced: 67 reserved/published
intents + 6 active topics + 8 terminal content-failure topics = 81 coverage
entries, 75 with reliable SERP fingerprints. Failed content remains coverage.

The persisted provider receipt had 300 rows, 101 invalid rows rejected before
storage and 199 valid persisted candidates. The current local implementation
exactly reproduced all remaining exclusions: 41 difficulty, 2 brand, 145
business-fit/anchor, 3 exact duplicates, 8 overlap, **zero selected**.

`selectCadenceMicroSeedCandidate` incorrectly used the *final* overlap gate
before a candidate had its own SERP. That necessarily used lexical fallback,
even when the historical topic had a complete fingerprint. Ordinary planning
already avoids this: it rejects lexical overlap early only against coverage
without a reliable fingerprint, leaving the final decision to fresh evidence.
The fallback now uses that same `blockedByUnfingerprintedCoverage` rule.

Actual saved-candidate replay after repair: **8 pre-SERP survivors**, with the
same 41/2/145/3 exclusions. The unchanged shortlist limit keeps only three:

| Candidate | Observed monthly demand | Measured difficulty |
| --- | ---: | ---: |
| tool for lead generation | 70 | 5 |
| sales qualification process | 20 | 5 |
| sales qualified lead definition | 70 | 18 |

These are **not approved topics**, and no new live SERP was purchased. Fresh
SERPs may still prove every candidate duplicates existing intent or cannot win
traffic. The real evidence-persistence and scheduler boundaries retain the
full SERP/lexical overlap gate. Regression tests first failed on the old code,
then passed for three synthetic business categories, distinct/same/missing
candidate SERPs, incomplete/duplicate-only historical SERPs, mixed coverage
and exact reuse. No difficulty, business-fit, quality or publication standard
changed. Policy37, attempt limits, immutable receipts and terminal jobs remain
unchanged: **the saved exhausted job was not reopened or replayed**.

Audience-qualified business-fit wording remains a separate possible issue.
It was not relaxed to improve yield; this release changes only the demonstrated
pre-SERP sequencing defect.

## Demonstrated customer handoff defect and repair

The existing signed-in Chrome session successfully loaded both exact site
pages. LeadPilot displayed 134 articles / 240 visible topics, but the global
site selector still displayed Pentra. Global Topics/Activity/Generate links
therefore carried the wrong selected website. No generation was clicked.

`SiteProvider` now makes a directly addressed *owned* site authoritative before
effects run, persists it for subsequent global navigation, and navigates the
detail page when the owner intentionally switches sites. An unknown site ID
never falls back to another owned tenant. Storage failure preserves in-memory
selection; ownership validation remains in every backend query/mutation.
Real-provider runtime tests cover the initial render, route-to-global handoff,
unowned routes, switching, stale selection and disabled local storage.

## Whole-product acceptance checklist

| Requirement | Evidence / unresolved requirement |
| --- | --- |
| Owner authentication and isolation | Both real exact-site pages loaded in the signed-in session. Synthetic ownership/route regressions pass. Two automated authenticated browser checks remain explicitly skipped; manual site-page inspection is separate evidence. |
| New-customer setup and cadence selection | Synthetic desktop/mobile wizard tests pass for auth readiness, exact chosen cadence, saved-site billing retry, closed-browser wake, invalid cadence and unavailable adapters. No new production customer or payment was created. |
| Existing tenant setup | Pentra shows 7/7 setup complete. LeadPilot shows 3/7 and an unadopted legacy One Setup contract: plan, automation authorization, destination verification and mailbox remain action-needed. Existing GitHub connection is visible; this is not the current contract's consent receipt. No sender consent or backlink work was started. |
| Customer billing / paid entitlements | Existing entitlement and quota regressions pass. A fresh production checkout/charge-to-entitlement-to-cadence purchase has not been established in this pass. No real purchase is authorized by the infrastructure approval. |
| Fresh relevant discovery | Defect reproduced and repaired offline. Live fresh evidence after repair remains untested; old exhausted attempts remain closed. |
| Generation and strict quality | Pentra has one September8 fresh generated/sealed replacement (factual100/editorial96). LeadPilot has no new accepted article in this pass. No quality threshold reduced. |
| Advance buffer and replacement after consumption | Latest verified Pentra buffer1/min3/target4; LeadPilot0/min9/target12. Neither full-buffer acceptance nor refill after today's consumption is established. |
| Natural scheduled NEW publication | Pentra recovered publication September11 10:24:02.469 UTC, live verified10:24:15.343. LeadPilot last publication September7 22:15:34.409, verified22:18:06.407; deadline September8 06:15:34.409 remains missed. An old live page is not new delivery. |
| Exact next deadline | Pentra September12 10:24:02.469 UTC is **after today's cutoff**. Cadence acceleration requires separate authority and would be labelled controlled, not natural-cadence proof. LeadPilot remains overdue. |
| Publishing adapters | Existing GitHub artifacts are independently live. Bootstrap UI exposes GitHub; unavailable WordPress/signed-webhook/managed choices remain gated in browser tests. No universal adapter certification claimed. |
| Failure recovery and cost containment | Full regression suite covers budgets, concurrent admission, retries/idempotency, cancellation, expiry, settlement, outage recovery and publication fencing. Resolved infrastructure outage has real recovery evidence. This is not a guarantee of outage-free cadence. |
| Backlink workflows and attributable SEO growth | Explicitly deferred while article acceptance fails. No prospect contact or new outreach; technical receipts do not establish acquired links, organic growth or conversions. |

## Funding decision pending — do not silently spend

The new explicit request is **$12 all-in**, only after a demonstrated offline
selection repair: at most two fresh planning executions and two new articles,
one natural publication plus one fresh replacement. Estimate $6–$10, hard stop
$12 including discovery/models/research/images/revisions. Required September
internal changes are account **$32→$34**, incremental discovery **$4→$6**;
fleet remains **$35**. This is a smaller bottleneck test, **not** acceptance of
the full 4/12 buffers or the entire SaaS.

**No approval response has been received. No limit has changed.** Existing
account32/incremental4/fleet35 still apply. Permitted subtotal31.042560 and
incremental consumption3.121440 leave at most0.878560 under the tighter fence;
a fresh $1 plan cannot fit. Provider wallet26.720668 was confirmed separately
with the free preflight, not inferred from the internal ledger. The rejection
is `provider_account_monthly_budget_reserved`, scope
`approved_incremental_window`, and the account ceiling independently also
blocks that plan. Reset October1 00:00 UTC / September30 17:00 PDT.

If approved, first implement and verify an auditable generic all-in dollar
boundary across model/research/media/revision calls; existing article-attempt
counts do not enforce that dollar cap. Amend the existing monthly approval
without erasing its historical baseline/consumption or changing retry policy.
Only then admit *new legitimate* work. Do not replay the saved failed job,
reset attempts, remove valid reservations or bypass fleet/account admission.
Operator paid-provider calls in this pass: **0**.

## Release gates

Local: 1,446 tests pass; typecheck/schema/dependency audit pass (61 tables /
292 indexes; zero dependency findings). Browser16 pass / 2 explicit auth skips.
Production build passes with the same non-secret example configuration as CI;
the first config-less local build correctly failed for missing Convex URL.
Release commit, deployment and post-deployment receipts will be added below.
