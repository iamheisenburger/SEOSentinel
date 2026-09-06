# Published revision delivery repair — 2026-09-06

## Reproduced production failures

The audited Pentra editorial correction `nh79j6vg5ye7jk91s6281m6cax8dxfj3`
received GitHub commit `90e1b0c19596352f3ed4496957f73b97df33ec69`, but the
dynamic public blog queried only the immutable original article. Readers still
saw the old article, so the independent verifier correctly did not accept it.
The GitHub renderer also merged serialized optional omissions over the original
row, retaining an old content score and audit hash. A separate runtime test
reproduced rejection of React's correctly escaped apostrophe in live metadata.

## Repair contract

- Public detail, listing and sitemap project only the latest acknowledged,
  article-bound revision with exact artifact hashes, receipt, key, destination
  and publication-date binding. Receipt-free preparation/attempts do not render.
  Serving cannot require live verification first: the independent verifier must
  be able to fetch the acknowledged content. An invalid acknowledged projection
  fails closed instead of silently serving superseded prose.
- The summary path avoids loading full Markdown for unchanged articles. Every
  revision lookup is article-indexed and bounded.
- Artifact renderer v2 explicitly clears absent optional artifact fields and
  writes the current sealed audit hash. Historical v1 rows retain their original
  exact rendering for conditional writes and receipt-only reconciliation.
  New version fields are bound into the revision identity and rechecked at the
  lease and external-write fences.
- A one-time additive `renderer_repair` can correct serialization of the latest
  verified legacy GitHub revision. It preserves its exact prose, scores, ledger,
  semantic hash and publication date, requires its original correction audit
  when applicable, and uses the normal conditional-write and live-verification
  flow. It does not call a model or rewrite the old receipt. It cannot roll back
  to stale renderer metadata.
- Numerical HTML entities are decoded for exact live metadata verification.
- None of these paths advances the new-article cadence clock or claims SEO growth.

## Acceptance

Runtime coverage exercises actual public query handlers, serialized optional
omissions through the real GitHub renderer/conditional-write path, duplicate
delivery, customer edits, exact migration authority, and unchanged cadence
history. Deployment and live receipts must be observed separately; local test
success is not evidence that the production correction is visible yet.

Pre-deployment checks: 1,328 repository tests passed; type-check passed; lint
reported zero errors and the same 157 existing warnings; additive schema check
passed (60 tables, 291 indexes); secret scan passed (577 tracked files);
dependency audit found zero vulnerabilities; production build passed; public
Playwright checks passed 10 with two authenticated checks skipped, not passed.
The production dry run validated the additive schema without index deletion.

## Observed production receipts

- Backend code: `ecbcdc22b406f17e9cb3e581bfbb731276fd848d`.
  GitHub quality run `34045185764` succeeded at 16:24:28 UTC.
  GitHub/Vercel production deployment `6295213391` succeeded; Convex
  `wary-starfish-773` deployed successfully before the next live verifier wake.
- At 16:25:29.363 UTC an independent bounded fetch passed the exact metadata and
  complete visible prose verifier for
  `https://pentra.dev/blog/fiverr-keywords-research`.
- The ordinary queued verifier settled correction
  `nh79j6vg5ye7jk91s6281m6cax8dxfj3` as **verified** at
  16:25:43.103 UTC (attempt 5). No fabricated live receipt or scheduler time was
  supplied.
- Controlled metadata-only migration `nh75v7j307rw3xq51s6a8jjez18dx0nv`
  produced GitHub commit `a527f5f4a3388c7e565208eb1d90c76f445f3640` and
  the normal live verifier settled it as **verified** at 16:26:09.913 UTC.
  The semantic artifact hash stayed
  `f6c8f49cdfe89851b2e49ddc71dca99937e4027b021adee7a09ee3926056bbc1`.
  The Git diff changes only the delivery key, audit hash and removal of the
  stale content score. It does not change the independently audited prose.
- Pentra's original publication timestamp remains `1788695112262`, with next
  new-article deadline `1788781512262`. No new-article credit was taken for
  either correction.

At the 16:22 UTC bounded cadence check, Pentra had three sealed articles and
`planning_blocked`; LeadPilot had four and `topic_replenishment_exhausted`.
Pentra's One Setup successor remained pending on
`provider_account_daily_budget_reserved`, next eligible 2026-09-07 00:00:01 UTC.
That is an internal reservation ceiling, not evidence that the topped-up
provider wallet is empty. The monthly allowance has not been proven available.

The overall cadence goal remains open: sustained inventory replenishment,
natural new-article delivery and generic onboarding still require their own
production evidence.
