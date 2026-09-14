# Stage2 completion candidate28 — local, review required

Assignment `supervisor-20260914-slc-stage2-complete-28` continues reviewed
`19046a059605531958edf3233c1cfa5ab89ade36` in `.claude/assignment24`, branch
`codex/simplified-article-admission`. The final handoff supplies the exact commit.
This report supersedes27's remaining Stage2 gaps, not its historical evidence.
No Stage3–4 work, live acceptance, deployment or financial activation is implied.

## Repairs and failing-before evidence

1. A fresh verified creation did not enter the editable page inventory. The new
   connected regression failed on27 with “A verified Pentra-created page must
   enter its measured-improvement inventory.” Creation now retains its exact
   private source receipt with the article; only successful full verification
   enrolls that artifact in existing `pages`. GitHub retains raw bytes/path/blob
   revision; WordPress retains its exact resource revision and remote permission.
   Current owner/profile/connection and publication identity must match. Existing
   selection/revocation is never overwritten; unrelated content is not enrolled.
   The owner article DTO omits the creation source/grant. WordPress uses retained
   reviewed Markdown for its own output, not a lossy re-import of generated HTML.

2. Append-only improvements could not repeatedly improve full-length pages.
   Full-length pages now use one bounded, unique guidance paragraph. Exact facts,
   title, formatting, links and all unrelated prose remain unchanged. Unsupported
   layouts or absence of an eligible guidance paragraph decline before drafting.
   The replacement fits the existing word ceiling and must make a substantive
   non-cosmetic change; normal quality/evidence review is retained. Short imported
   pages may still receive a bounded reviewed addition under the original path.
   Capacity tests exercise exactly2600 words and a second distinct replacement.

   The connected regression exposed a further real pipeline defect: post-review
   linking rebuilt an unrelated Related reading section on the second revision.
   It now preserves the selected source's existing links instead of changing
   unrelated bytes after review. One transport-added final newline is normalized
   for Markdown comparison only; destination changes still replace just the exact
   retained raw span. A whitespace-variant confirmed fact also failed the new
   fact-protection test; evidence matching now normalizes whitespace and Unicode.
   Final review also reproduced an unflagged factual narrative being selectable.
   The editor now requires explicit reader-instruction prose in both the selected
   paragraph and replacement, in addition to claim checks. Missing a detector
   pattern cannot grant permission to rewrite an ordinary source narrative.

3. Immediate corrections reuse the same jobs, article snapshots, revision records,
   leases, CAS, retries, full rendered verification and conditional rollback.
   An owner confirms an exact current source revision and bounded paragraph:
   - Factual correction substitutes the exact current confirmed `siteSummary` or
     `productUsage` quote. No model invents or approves replacement facts. Pricing,
     founders, commerce/legal text, new destinations and arbitrary prose are out.
   - Supported technical repair preserves a simple inline link's label/prose and
     substitutes a verified same-tenant page. DNS-pinned checks must observe the
     original404/410 and replacement200 both at proposal and final write fence.
     Rendered verification checks the exact visible href in addition to full prose.
     Unsupported arbitrary layouts/repairs remain explicitly unsupported.

   These deterministic owner corrections have zero provider budget/calls and no
   fabricated editorial scores. An immutable base-bound request is idempotent,
   including retry after completed verification. They do not update discretionary
   cooldown, consume a delivery slot, advance an overdue deadline or erase lateness.
   Selected-page and connection authority is checked again immediately before the
   write. Remote/source ambiguity retains the existing bounded recovery behavior.
   The public correction endpoint is available for Stage3 UI integration; this
   report does not claim that authenticated customer-journey acceptance is done.

4. Real MySQL8.4.11/InnoDB execution now accompanies real WordPress7.1/PHP8.5.10
   and the retained official SQLite fixture. No mocked database is substituted.
   The official macOS ARM64 archive's published MD5 was checked:
   `6e89113f04f2af85d0a164573493db3a`; pinned SHA256:
   `b96e00493bc3499b9ffd7f08d65c5d64933af0383a8287d9873b64f94c2d6009`.
   Bootstrap, data, sockets, logs, synthetic users and separate WP tree stay under
   ignored `.wordpress-fixture`; no global package/service or real auth changed.
   `npm run test:wordpress:mysql` executes actual InnoDB row-lock core-editor races,
   concurrent create/update, replay/lost acknowledgement, targeted replacement,
   revocation/source drift, rollback after customer edits, and a real MyISAM receipt
   table rejection with InnoDB restored in `finally`.

## Connected acceptance evidence (synthetic, not production)

Five business types remain covered on both adapters: SaaS, local services, retail,
agency and publishing, with distinct configurations and schedules. Both adapters
add an empty-managed-inventory cycle with no manual reselection: create → complete
live verification → automatic editable inventory → synthetic current GSC evidence
→ reviewed targeted improvement → fresh replenishment → later post-change GSC
evidence → second reviewed improvement → freshly replenished two-item buffer.

The long managed page starts at2425 words and ends at2441, below2600. Source prose
and unrelated links survive both edits. Measurement rows for discretionary follow-up
must postdate the prior improvement; old measurements cannot replay the same work.
The test uses a seven-day synthetic schedule and explicitly advances its clock
after the first improvement; it never rewrites any deadline or deletes ready work.

Exact identical virtual receipts on GitHub and real WordPress/MySQL:

| Change | Immutable deadline UTC | Publication UTC | Full verification UTC |
| --- | --- | --- | --- |
| First measured improvement | 2026-09-25 12:10:00.000 | 2026-09-25 12:05:00.002 | 2026-09-25 12:05:00.003 |
| Second measured improvement | 2026-10-16 12:10:00.000 | 2026-10-16 12:05:00.002 | 2026-10-16 12:05:00.003 |

The second change is21 days later (minimum14 upheld). Both finish with2 ready
items and a newly created replacement job after consumption. The deliberate clock
jump can make an intervening queued item late; the fixture does not shift its
deadline or present that interval as uninterrupted production service.

Separate connected tests verify immediate factual correction, observed broken-link
repair and conditional rollback with no additional model calls/reservations and no
regular deadline change. Negative tests cover wrong owner/tenant, revoked access,
profile/source drift, malicious patch bytes, unsupported facts/figures/links,
no-op/cosmetic edits, customer-edit CAS, hidden href copies and completed retry.
Existing original-budget, initial+two-revision+one-replacement, concurrent-worker,
cancellation/expiry, ambiguity, settlement and tenant isolation tests are retained.

## Release gates

Final free gates completed by **2026-09-14 14:46:42 UTC**, after the final
instruction-only fact-protection repair:

- Repository:1602 discovered,1601 passed,0 failed,1 existing skip (missing sibling
  LeadPilot module). Final repeat96.60s; earlier full runs99.97s and93.94s also
  passed before the final additional narrative-protection assertion.
- New connected SLC28 subset:13 passed. New capacity/protection/patch-proof file:
  5 passed. No original quality or concurrency test was removed or skipped.
- WordPress/MySQL:18 passed,0 skipped,20.39s. WordPress/SQLite:17 passed,0 skipped,
  21.52s. Both execute the long-page cycle and provider-free repairs through actual
  PHP/core/database/rendered HTTP responses, with injected model calls.
- Type-check and optimized build pass;31 pages generated. Schema compatibility
  against9fd01af passes:61 tables/295 indexes, only optional existing-record fields
  added in28. No new queue/table/index/accounting ledger.
- ESLint:0 errors,157 existing warnings. Two test-only `prefer-const` errors in
  the first lint run were corrected; the final run is clean of errors.
- Dependency audit:0 vulnerabilities. Secret scan:665 tracked files, passed after
  explicit staging of new files. Staged whitespace/diff check passed.
- Browser:18 discovered,16 passed,2 explicitly authenticated skips;6.3s final
  repeat. Uses synthetic local test configuration, not the owner's production
  session. The two skips remain Stage3 acceptance gaps.

Reproduce with the npm test scripts, `npm run test:wordpress`,
`npm run test:wordpress:mysql`, `npm run typecheck`, `npm run lint`, schema/secret
scripts, `npm audit --audit-level=high`, build and local Playwright checks. The
fixture runtime is pinned for macOS ARM64; unsupported platforms fail explicitly.

## Authority and remaining acceptance

Provider expenditure in28: **USD0**. USD20 TOTAL additional Stage4 allowance remains
inactive and unspent; old USD4 discovery envelope and account/fleet ceilings are
unchanged. No provider/model endpoint was called outside injected transports.
The only test network surfaces are literal loopback WordPress/MySQL and permitted
free runtime/dependency distribution/downloads. No production tenant or provider
record was read. No push/deploy, migration, live probe, financial activation, cap,
reservation, attempt or schedule reset, subscription, contact or auth change.

This is not live Pentra/LeadPilot acceptance, monetizable-SaaS acceptance, a signed-in
onboarding/billing demonstration, or attributable SEO growth. Their last deadlines,
buffer observations and failures in the historical handoff have not been refreshed.
Stage3 authenticated journey and Stage4 scoped paid/live migration validation remain.
Destination-specific themes/plugins still require compatibility checks; unsupported
layouts remain unavailable, not silently converted. Existing bounded inventory reads
fail closed if incomplete. Keep backlinks out of scope and stop at this review
handoff before any next-stage work.
