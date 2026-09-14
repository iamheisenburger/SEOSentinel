# Pentra SLC Stage3 — customer journey candidate29

Assignment `supervisor-20260914-slc-stage3-29`. Local candidate based on
`1961e3450d2e4ab0d473d339b631e836f30c6a23`, branch
`codex/simplified-article-admission`, isolated checkout `.claude/assignment24`.
The final handoff supplies the exact candidate commit. Review is required;
this report does not authorize deployment or Stage4.

## Outcome and acceptance boundary

The content-only customer UI now connects saved facts/audience, existing billing,
exact publisher verification, explicit publication/service consent, five-minute
delivery windows, spending readiness, page permissions, pause/resume, correction
previews and organic-click reporting. These reuse existing owner checks, billing,
jobs, reservations, articles, revisions and Search Console ingestion.

The connected local fixtures now start with no sites or page inventory, save
through the owner handler, connect the publisher, select the service, prepare,
deliver, verify and replenish. Five business types execute on each adapter.
After three deliveries, they pause across the next fixed deadline, preserve work
and reservations, resume with no browser identity, deliver the original overdue
item and prepare a genuinely fresh replacement. Two ready items remain.

**Authenticated customer-browser acceptance is NOT complete.** Registered-handler
identity, billing entitlement, clocks, models and Google measurements are synthetic.
GitHub's trusted connection callback is simulated, not a real OAuth acceptance
test. WordPress uses real core/application-password authentication, conditional
connector writes and rendered responses on loopback with real databases. Browser
component transport mocks are explicitly labelled synthetic and do not count as
a signed-in journey. Public authentication rendering does not prove owner access.

## Reproduced defects and repairs

1. An empty GitHub connection made readiness throw while deriving a destination
   hash. Incomplete setup now remains visible as unverified, never authorized.
   Existing page permissions also remain readable/revocable when a publisher
   becomes incomplete; changed bindings cannot authorize new editing.
2. The stronger empty-account test reproduced `autopilotEnabled: false` after
   service selection. Explicit automatic-publication consent now starts only
   warm preparation. Activation remains false until two distinct sealed items
   and authorized capacity pass the existing guards. Selection without that
   consent does not silently start a disabled customer's service.
3. With no legacy crawl inventory, initial drafts failed the unchanged strict
   internal-link gate. The linking action may use the confirmed business root
   only after a fresh safe read verifies the exact current-domain root. It does
   not invent a page, demand, crawl receipt or editable permission. Unreachable
   homepages still exhaust bounded review without approval or publication.
4. The old measured-follow-up fixture put its first observation before creation.
   Its virtual clock now advances beyond publication before adding observations;
   assertions enforce this chronology on both adapters.
5. WordPress fixture teardown now awaits bounded shutdown of retained owned child
   handles, including startup/interrupt failures. A stubborn-child test verifies
   escalation without signalling an unrelated sibling. No PID/port discovery is
   used to kill processes; databases are retained.

## Customer behavior

- New empty onboarding saves owner-confirmed business facts, audience, product
  use and real customer questions. It calls existing billing sync and site
  allowance enforcement. It starts no paid legacy bootstrap or outreach.
- GitHub destination shows exact repository, branch and content directory.
  WordPress content setup requires the conditional connector handshake, not
  just a working core REST credential. Unsupported editors/layouts stay blocked.
- Growth-first consent is bound to current profile/connection and invalidated
  when they change. Legacy fixed-article mode is retained absent explicit switch.
  Previously selected deadlines, interval and timezone cannot be reset by toggles.
- Funding distinguishes settled receipt-backed cost from conservative retained
  ceilings, and available/blocked/unknown/unconfigured. It exposes only safe
  aggregates, configured limits and UTC resets. Actual provider wallet credit is
  explicitly unverified. A pricing configuration is not a reservation or funding.
- Read-only readiness calls the same shared-budget inspection used immediately
  before atomic insertion. No account/fleet ceiling, reservation semantics,
  retry counter, accounting window or spending authorization was changed.
- Pause stops admissions and unstarted writes without cancelling valid work or
  deleting reservations. Resume/recheck re-enter the same workflow. Already
  started selected-page writes can still be verified while paused. Changed owner,
  profile, connection or entitlement fails closed without resetting history.
- Page selection requires exact source preview and current consent. Managed pages
  appear automatically; unselected/protected content remains excluded. The UI
  shows pending verification and remote revocation failures without raw provider
  errors, remote grants or credentials.
- Exact factual/broken-link correction shows before/after first and binds approval
  to the current source/profile. Rollback shows the retained versions and uses
  the existing conditional-write protocol; it cannot erase later customer edits.
- The dashboard separates upcoming work, verified changes, organic clicks and
  actionable issues. Growth-first avoids the old dashboard's duplicate legacy
  queries. Missing/incomplete data is not zero; prepared work is not delivery.

## Local financial regression, not a production account observation

The safe owner-readiness fixture has a 700,000 micro-USD reservation settled to
120,000 actual, a 600,000 hold, and a released 400,000 receipt. It reports 120,000
actual plus 600,000 held, excludes the released amount and does not double count
the settled reservation. Exhausted-capacity fixtures cannot activate despite
having two prepared items. Wrong-owner access fails. Unconfigured pricing is
explicit. Existing concurrency, idempotency, cancellation, expiry, rollover,
ambiguous-I/O and settlement regressions remain in the full suite.

No fresh production budget or provider-wallet receipt was obtained in29. Historical
`provider_account_monthly_budget_reserved` findings and Pentra/LeadPilot buffers
must not be presented as current from these tests. This candidate neither proves
that live guard is cleared nor raises or bypasses it.

## Exact synthetic chronology

These are virtual fixture times, NOT Pentra/LeadPilot production observations.

| Scenario | Fixed deadline UTC | Publication UTC | Verification UTC | Remaining ready |
| --- | --- | --- | --- | --- |
| GitHub, all five businesses, post-pause consumption | 2026-09-11 13:40:00.000 | 2026-09-11 13:40:00.023 | 2026-09-11 13:40:00.027 | 2, including fresh replacement |
| WordPress, all five businesses, post-pause consumption | 2026-09-11 13:40:00.000 | 2026-09-11 13:40:00.019 | 2026-09-11 13:40:00.023 | 2, including fresh replacement |
| Both adapters, first measured targeted improvement | 2026-09-25 12:10:00.000 | 2026-09-25 12:05:00.002 | 2026-09-25 12:05:00.003 | 2 |
| Both adapters, second measured targeted improvement | 2026-10-16 12:10:00.000 | 2026-10-16 12:05:00.002 | 2026-10-16 12:05:00.003 | 2 |

Measured observations are `2026-09-12` and `2026-10-08`, after the relevant
publications. The same long page changes 21 days apart, 2425→2441 words. Neither
synthetic observations nor live-artifact technical verification establish SEO
causality or attributable growth.

## Measurement semantics

The owner query uses current-domain/property binding and current date/epoch
receipts, with bounded exact-site rows. It compares two complete 28-day windows.
No current complete window means missing/incomplete, never an invented zero;
an incomplete prior window has no comparison. New-page cohorts begin on the first
full Search Console calendar day after publication. Too-new cohorts are unknown.
Old epochs and a wrong property cannot leak into results. A delayed data-through
date is visible; no causal claim is made. Real post-publication ingestion and an
executed measurement-driven production edit remain Stage4 acceptance gaps.

## Free release receipts

All commands use the bundled Node24 runtime on this checkout. No production
environment file was loaded. Build/browser keys are the existing synthetic
example fixtures, not account credentials.

| Gate | Observed result |
| --- | --- |
| Full `npm test`, final application tree | 1623 discovered, 1622 passed, 0 failed, 1 pre-existing skip; 99.685420083s |
| Previous full repeat | 1623 discovered, 1622 passed, 0 failed, 1 skip; 100.013944583s |
| Focused `SLC29` registered-handler cases | 18 passed, 0 failed/skipped; 1.861652792s |
| Real WordPress7.1 / PHP8.5.10 / MySQL8.4.11 InnoDB | 18 passed, 0 failed/skipped; 26.313014708s |
| Real WordPress / SQLite Integration3.0.2 | 17 passed, 0 failed/skipped; final cleanup repeat26.410588209s; preceding run28.593513291s |
| TypeScript | `tsc --noEmit`, exit0 |
| Lint | 0 errors, 157 pre-existing warnings |
| Build | exit0, 31 routes; final compile504ms / typecheck7.7s |
| Schema against9fd01affd5bc57a681e8b32f2212ed671d3aab2c | Pass, 61 tables / 295 indexes; optional fields only |
| Dependency audit | `npm audit --audit-level=high`, 0 vulnerabilities |
| Secret scan | Pass, 674 tracked/staged files, including every new file |
| Public/synthetic desktop+mobile browser | 24 discovered, 22 passed, 2 authenticated skips; 6.5s |
| Diff whitespace | `git diff --cached --check`, pass |

The full-suite skip is the pre-existing sibling LeadPilot consumer-module check:
`../LeadPilot/src/lib/blog.ts` is absent relative to this isolated checkout. It
does not prove LeadPilot's deployed consumer. The browser skips require a real
authorized owner session and a reviewed deployed candidate, not substitute mocks.
Both database gates exit0 without manual termination; read-only listener/process
checks found no surviving fixture listener on18927/18928 or harness child. Local
databases remain retained. Two additional interruption fences before spawn close
the signal-during-port-probe race; the passing SQLite cleanup repeat follows that
change. Final no-listener/no-child check:2026-09-14 15:31:09 UTC. All six synthetic
desktop/mobile screenshots were visually reviewed; no horizontal overflow was
observed. Final harness-only lint also passes with zero errors/warnings.

Reproduce with `npm test`, `npm run test:wordpress:mysql`,
`npm run test:wordpress`, `npm run typecheck`, `npm run lint`, `npm run build`,
`npm run test:e2e`, `npm run scan:secrets`, `npm audit --audit-level=high`, and
`SCHEMA_BASE_REF=9fd01affd5bc57a681e8b32f2212ed671d3aab2c npm run check:schema`.
Build/browser require the explicit synthetic example environment described in
`playwright.config.ts`; do not source the production secret to run free gates.

## Browser artifacts and prerequisites

Six screenshot files are generated under ignored `test-results/` by
`tests/e2e/content-service-components.spec.ts`: overview, controls and empty start,
each desktop and Pixel7. UTF-8 and real device viewport metadata are present;
each asserts no horizontal overflow. These use real components with synthetic
transport and contain an explicit synthetic-session banner. No credential-bearing
browser storage or screenshot is committed.

Read-only production prerequisite check: the exact authorized Pentra site URL
redirected to Pentra sign-in. Its existing Google login flow reached an account
chooser with more than one saved identity. No identity was guessed, no new account
was created and no auth state/token was extracted. The chooser is left open for
the owner to select the existing Pentra owner. No production tenant records were
read or enumerated in this check; LeadPilot was not queried.

Required next prerequisites are (1) independent review and explicit permission
to deploy this candidate with its backend/frontend together, and (2) the existing
authorized owner session. The read-only authenticated browser gate requires both
`PENTRA_E2E_AUTH_STATE` and exact authorized `PENTRA_E2E_CONTENT_SITE_ID`, plus a
reviewed deployed base URL. Do not commit authentication state or use a mock-hook
fixture to satisfy it. A separate disposable authorized environment is required
for an actual mutating onboarding/control browser journey; production29 is
read-only and this report does not grant that expansion.

## Spending and stop boundary

Provider expenditure in29: **USD0**. The canonical finite USD20 Stage4 provider
validation allowance remains inactive and unspent. The old USD4 allowance is
separate; no cap, attempt, reservation, deadline or authorization was reset.
No infrastructure threshold change, purchase, subscription, real generation,
push, deployment, migration, production mutation, authentication reset or
backlinks work occurred. Existing loopback databases were retained.

Unresolved: genuine authenticated UI acceptance, reviewed deployment, safely
bounded live-validation funding, current exact authorized-tenant guard/buffer/
deadline evidence, ordinary repeated production delivery/refill, real measured
follow-up, and technical SaaS acceptance. Attributable SEO growth is a separate
unproven outcome. Stop at this one local review handoff, before Stage4.
