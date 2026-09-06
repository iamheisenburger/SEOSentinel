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

The overall cadence goal remains open: sustained inventory replenishment,
natural new-article delivery and generic onboarding still require their own
production evidence.
