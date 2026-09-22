# September 22: direct takeover and cleanup

This task now owns execution. Do not resume the old supervisor worker.
`supervise-pentra-completion` was deleted through the app. The prior worker's
last turn failed on a Codex usage limit; its last release commentary was not a
completion receipt. GitHub main is 50a0235173ccd0ebe965f3be50a29451d4879922;
quality run 35033271900 succeeded. Backend release identity still needs fresh
verification; the dashboard reports last deployment seven days ago.

## Completed workspace cleanup

Seven clean auxiliary Desktop worktrees were moved using `git worktree move`
into the parent workspace's `.claude/archived-worktrees`. Every HEAD remained
unchanged. No files, branches, credentials or production data were deleted.
See the parent `WORKSPACE.md` for exact names and restoration instructions.
The current source stays in this existing assignment24 checkout; no new tree.

## Actual cost evidence (dashboard, not estimates)

Convex current billing window: September 21–October 21, 2026. Team aggregate:
17K/1M calls, 0.58/20 GB-hours action compute, 296.71/512 MB database storage,
1 GB database I/O plus 699.99 MB overage, 455.65 MB/1 GB file storage,
157.16 MB/1 GB egress. These are resource figures, not a dollar invoice.
SEOSentinel database I/O: 1.68 GB. Largest production functions:

- searchPerformance.contentOutcome: 856.7 MB
- contentWork.readiness: 630.94 MB
- seoGrowth.listDueGrowthSitesInternal: 73.93 MB
- outreach.claimImapPollInternal: 39.02 MB

No other tenant records were inspected. No asset was deleted based on size or
the crowded schema. Convex is serving the signed-in dashboard, not currently
showing the old free-plan shutdown.

## Local changes, not yet deployed

1. Organic outcome reads once per dashboard mount and on explicit refresh,
   instead of a live subscription invalidated by unrelated site changes.
   Existing complete-window and missing-data semantics remain. Requests are
   scoped to the selected site; stale/unmounted responses cannot update UI.
2. Manual publish no longer reports a queued review for `already_attempted`
   or a queue result lacking an actual job. Existing active jobs are reused;
   no attempt limits, funding protections or quality checks are bypassed.
3. The existing owner-authenticated publisher verification now supports GitHub
   through the same guarded repository/default-branch check used internally.
   Website connection settings expose Verify repository and verify saved GitHub
   changes. No credential is returned or new access granted. Actual handler
   tests cover ownership, success without writes/spend, and provider failure.

Targeted action/onboarding tests: 18 passed. Customer render tests: 4 passed.
Type check passed. Desktop/mobile synthetic browser checks: 2 passed, including
one read on load, no read on rerender and explicit refresh showing true zero.
These are not authenticated publication acceptance. Full repository run:
1,780 passed, zero failures, one existing skip (213 seconds). Changed-file lint
and whitespace checks passed. Log: `/tmp/pentra-cleanup-20260922-tests.log`.

## Fresh customer state, not release acceptance

Signed-in LeadPilot dashboard: paused, 0/2, original September14 deadline
overdue, one item in quality review, destination verification required.
Search Console display: 17 clicks August23–September19 versus 5 in the
preceding full window. Displayed new-page cohorts have zero clicks. Do not
claim attribution or new release success from this.

## Remaining work

Reduce readiness I/O without hiding failure states; verify latest backend code,
destination and retained work; complete the approved narrowed review-and-publish
customer journey. Preserve existing commitments. Validate and deploy reviewed
changes before claiming savings or product readiness. Production content/assets
need reference and ownership checks before cleanup. No provider spend or paid
validation was performed in this cleanup pass.

## September22 continuation

Owner authentication through the existing Google account succeeded. Exact-site
read-only release preflight confirms both schedules remain paused, neither holds
a publication lease, and neither has unresolved publication revisions. Pentra's
destination receipt is current; LeadPilot's requires verification. GSC ingestion
is current through September19 for both; this is not attribution evidence.

Current candidate production build and type check pass. Full lint has zero
errors and the existing157 warnings. Schema compatibility passes61tables/
296indexes; production dependency audit has zero vulnerabilities. All20
desktop/mobile synthetic component checks pass, not authenticated acceptance.
Production dry-run succeeds against wary-starfish-773 with no deleted indexes.
The signed-in LeadPilot funding view confirms the existing independent20USD
validation run is active. No new grant, limit reset or provider call was made.
