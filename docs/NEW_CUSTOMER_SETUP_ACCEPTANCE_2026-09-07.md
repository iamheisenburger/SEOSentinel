# New-customer setup acceptance — September 7, 2026

## Scope and limits

This is shared SaaS setup acceptance, not a Pentra/LeadPilot-specific path.
It executes the actual dashboard authentication boundary, SetupWizard and
SetupReadiness in desktop and mobile Chromium. Their save calls execute the
actual registered `sites.upsert` and `sites.saveOneSetupRequest` handlers
against a controlled in-memory database. The actual capacity query supplies
the account allowance. Unrecognized calls fail the test.

Authentication, transport, billing responses, readiness projection and the
provider action boundary are explicit fixtures. No new production tenant,
OAuth authorization, provider generation, email, or external publication is
performed. There is no production-accessible test endpoint or auth bypass.
These tests do **not** establish live fresh-account OAuth acceptance, sustained
article replenishment, all publishing adapters, or measured SEO growth.

## Reproduced and repaired

1. Shared Input/Textarea labels did not identify their associated controls.
   The browser could render the form but could not find the Website input by
   its visible label. Inputs now use stable React-generated IDs unless the
   caller supplies an ID. Error descriptions retain existing help references.
   Four component tests cover both controls, distinct IDs and error semantics.
2. Entering `1.5` in the whole-article cadence control rendered a blank value
   while leaving Start enabled. The browser test reproduced this. The form
   now preserves the typed value and explicitly requires a whole-number target
   before saving. The backend operational-rate predicate and all stored
   schedules remain unchanged; legacy fractional schedules are not migrated
   or silently rounded by this repair.

## Acceptance exercised

- Private setup queries do not mount before Convex authentication is ready.
- Missing publishing/sender acknowledgements prevent submission.
- Every whole-number selection from 1 through 21 remains selectable and
  visible; invalid and fractional input is blocked with an explanation.
- Actual saves preserve non-preset cadence 13/week and maximum 21/week.
- Publisher consent is persisted, but consent alone cannot invent a verified
  repository or promote an unconnected site to live publishing.
- A failed billing reconciliation leaves the saved request intact. Retrying
  calls the same request/configuration and does not create another site or
  provisioning request, or dispatch the planning action twice.
- After the browser closes, the saved bootstrap executes its real handler,
  creates one cadence-bound setup execution and schedules its recovery
  watchdog without manufacturing a provider job.
- Unsupported WordPress/webhook/managed-sender choices stay visibly disabled.

The backend fixture is shared with the existing runtime suite, which exercises
creation/save at every cadence, different-owner rejection, superseded wakes,
and billing recovery. No production tenant names or IDs appear in the test
logic.

## Local gates

- Repository tests: 1,410 passed, no failures or skips.
- Type-check and production build passed.
- Lint: zero errors, 157 pre-existing warnings, no new warnings.
- Additive schema check: 60 tables, 291 indexes; no schema change.
- Production dependency audit: zero vulnerabilities.
- Six new desktop/mobile functional browser checks passed in isolation.
- Full browser suite: 16 passed; two credential-dependent live dashboard
  checks remain skipped, explicitly not counted as acceptance.
- Tracked-file secret scan is repeated after staging the new test files.

## Production acceptance still open

At the last bounded read (12:56 UTC), Pentra held three sealed ready articles,
including the ordinary fresh generation/revision scored editorial 94 and
factual 100. LeadPilot held two sealed ready articles; its fresh planning
remained under existing rolling attempt/cooldown limits. Neither state is a
new advancement from this UI repair.

Next ordinary observations are the 13:15 UTC evidence fleet and LeadPilot's
14:15:15.201 UTC publication deadline. No schedule, limit, quality predicate,
or production article was changed by this acceptance work. Article acceptance
is not fully signed off, and the backlog has not been relabeled complete to
move to backlinks.
