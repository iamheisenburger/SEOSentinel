# Pentra SLC Stage3 — changed-setup recovery candidate30

Assignment `supervisor-20260914-slc-stage3-recovery-30`, based on reviewed
`17cb93ceeb7aa4cc02140965c124ea3598daaa11`. One local review candidate in
`.claude/assignment24`, branch `codex/simplified-article-admission`. The final
handoff supplies its exact commit. Stop before Stage4: no deployment or spending
is authorized by this report. Candidate29 evidence is retained below as history.

## Candidate30 outcome and reproduced causes

The reported ready2 → pause → legitimate `sites.upsert` business-fact change
dead end is repaired through explicit, current-token owner reconfirmation.
Same-mode selection no longer has to be used as a recovery mechanism. Resume
still refuses changed bindings; the customer gets **Review changed setup**.
The action stops admissions, resolves prior execution, retires stale work through
normal terminal accounting, and prepares newly generated/reviewed artifacts.
Old seals are never rebound. Old Markdown, audit bytes, attempts, settled spend,
ambiguous ceilings, interval/timezone and missed deadline remain retained.

Two additional causal defects were reproduced while exercising the full path:

- An already-delivered creation could not finish verification after profile or
  credentials changed because it also tried to enroll the page under the new
  setup. Recording its exact live receipt is now separate from granting editing
  permission. Changed bindings require a separate page selection.
- WordPress fact changes invalidated its adapter verification but readiness
  still reported the destination verified. Readiness and reconfirmation now
  include the same adapter blockers as activation. The owner must run the
  existing exact-destination verification in website settings before confirming;
  no work is retired while that prerequisite is missing. Real-core tests follow
  that action, rather than injecting a replacement verification receipt.

## Recovery boundaries

- Normal settings updates retain existing rollout cancellation. A still-running
  retained legacy/callback worker waits for its existing exact lease watchdog.
  This is not an operator attempt reset. Late workers lose execution authority.
- Receipt-backed creation and selected-page deliveries finish bounded, read-only
  live verification before reconfirmation proceeds. Verification never restores
  revoked/reselected permissions, changes old receipt bytes or publishes again.
- Unknown initial/revision writes block with an exact retained-article owner
  review link. Existing owner-reviewed unverified-delivery disposition remains
  available only after the exact lease expiry. It retains the attempt/audit and
  never asserts publication. A possibly delivered creation's reader intent stays
  excluded from fresh selection, preventing it from being replayed as new work.
- An exact expired pristine selected lease may close only with no external
  attempt/receipt and both lease bounds elapsed. Its old revision is terminally
  retained with its source and attempt count, not merely unlocked.
- Concurrent/repeated confirmations retire one batch. Repeating confirmation
  cannot re-enable a subsequently paused service, renew an allowance or recreate
  work. Wrong owner, stale token and missing explicit consent fail closed.
- Only the existing proven-unspent quota/provider hold closure is reused. Paid
  or ambiguous reservations are not erased. Fresh work must independently pass
  unchanged account/fleet, attempt, concurrency and substantive quality gates.
  Exhausted headroom still blocks admission after reconfirmation.

Preparation count, active/paused/stopped state, original deadline and primary
actions now precede details. Native disclosures hold saved setup, detailed money,
service-mode consent and history. Changed-setup review opens when required.
Funding blockers, provider-credit distinction, protected content and essential
consent remain visible. Retired failures remain history, not new active failures.

## Candidate30 connected acceptance and exact fixture chronology

These are **synthetic clocks/provider responses/owner identities**, not current
Pentra or LeadPilot observations. GitHub transport is mocked. WordPress uses real
core7.1, PHP8.5.10, application-password authentication, conditional connector HTTP
and MySQL8.4.11 InnoDB / SQLite Integration3.0.2 on loopback.

New cases cover empty work inventory, two ready items, cancelled and retained
running workers, unknown provider results, repository/credential changes,
revoked selected permission, old receipt verification, pristine/attempted selected
leases, lost external acknowledgement, concurrent/idempotent confirmation,
wrong-owner rejection and exhausted funds. Recovery cases continue through fresh
publication, exact live verification and **new work created after consumption**,
ending with two ready items. They do not stop at a successful rejection.

| Recovery scenario | Original deadline UTC | Fresh publication UTC | Verification UTC | Ready afterward |
| --- | --- | --- | --- | --- |
| GitHub and WordPress, empty stock | 2026-09-11 12:10:00.000 | 2026-09-11 12:10:00.021 | 2026-09-11 12:10:00.023 | 2 |
| GitHub and WordPress, stale ready2 | 2026-09-11 12:10:00.000 | 2026-09-11 12:10:00.025 | 2026-09-11 12:10:00.027 | 2 |
| WordPress rotated credentials | 2026-09-11 12:10:00.000 | 2026-09-11 12:10:00.025 | 2026-09-11 12:10:00.027 | 2 |
| WordPress, after retained creation/selected receipt | 2026-09-11 12:40:00.000 | 2026-09-11 12:35:00.002 | 2026-09-11 12:35:00.004 | 2 |
| WordPress, after unknown delivery disposition | 2026-09-11 12:10:00.000 | 2026-09-11 12:20:00.027 | 2026-09-11 12:20:00.029 | 2 |

The receipt case legitimately advanced the prior slot only when that prior actual
delivery verified; reconfirmation itself never moved a deadline. The unknown
delivery remains unverified history and is not counted as the fresh publication.

## Candidate30 release receipts

| Free gate | Final observed result |
| --- | --- |
| Full repository suite, final application tree | 1642 discovered,1641 passed,0 failed,1 existing skip;104.809631375s |
| Prior full repeat | 1642 discovered,1641 passed,0 failed,1 skip;105.282438042s |
| Focused SLC30 registered-handler cases | 19 passed,0 failed/skipped;6.590079125s |
| Real WordPress/MySQL recovery plus existing core suite | 25 passed,0 failed/skipped;35.868189959s; preceding pass35.172077417s |
| Real WordPress/SQLite recovery plus existing core suite | 24 passed,0 failed/skipped;37.990498208s |
| Actual-component/public desktop and mobile browser | 26 discovered,24 passed,2 explicit authenticated skips;7.0s |
| TypeScript | `tsc --noEmit`, exit0; final build typecheck also passes |
| Full lint / changed-file repeat | 0 errors,157 existing warnings / 0 errors or warnings |
| Production build with explicit synthetic configuration | exit0,31 routes;450ms compile,1.253s typecheck |
| Schema compatibility against9fd01affd5bc57a681e8b32f2212ed671d3aab2c | pass,61 tables/295 indexes; two optional nested job fields |
| Dependency audit | 0 vulnerabilities |
| Secret scan | pass,674 tracked/staged files |
| Staged whitespace | `git diff --cached --check`, pass |

The full-suite skip remains the missing sibling `../LeadPilot/src/lib/blog.ts`
relative to this isolated checkout, not proof of the deployed consumer. Browser
skips require actual owner authentication and a reviewed deployment. All ten
synthetic screenshots were visually reviewed: eight primary desktop/mobile views
and two expanded funding views. No horizontal overflow. The new browser action
test invalidates a checked consent when the actual component receives a changed
review token, then submits only the newly confirmed token.

One build invocation without the synthetic environment failed closed for missing
`NEXT_PUBLIC_CONVEX_URL`; the explicit example-configured repeat above passed.
No production environment was loaded to fix that. Earlier test failures exposed
the described WordPress adapter-readiness defect and a fixture page below the
existing80-character exact-body threshold; the fixture now supplies substantive
source text and the quality threshold was not changed.

At2026-09-14 16:02:15 UTC, read-only listener/process checks found no retained
WordPress fixture listener on18927/18928 or owned harness child. Both database
suites exited normally; their databases remain retained. No manual process kill.

## Stage3 gaps and Stage4 prerequisites — not executed

Authenticated customer-browser acceptance remains open, not replaced by mocked
hooks or handler identities. The existing owner browser handoff is left intact;
no new identity was selected, authentication reset or repeated sign-in prompt
issued in30. A reviewed deployed candidate and an authorized exact-site session
are both required. No current production budget, buffer or deadline was read.

After independent acceptance of this local candidate, the execution order is:

1. Authorize/deploy the reviewed commit and verify deployed identity/schema;
   use the existing owner session to complete real desktop/mobile acceptance.
2. Read credential-free budget/ledger, outstanding-work and deadline projections
   for only Pentra `jh74txye54jna4t85m6y7p4d6h82v9ab` and LeadPilot
   `jh7cccny67df67rdm4jp65tmtn8am982`. Distinguish internal limits from actual
   provider balance. Reconcile outstanding deliveries before any mode change.
3. Preserve legacy commitments until explicit migration consent. Confirm exact
   profile/destination/page permissions and fixed deadlines. Activate the
   canonical USD20 TOTAL allowance only through its approved bounded spending
   guard; old USD4 remains separate, account/fleet limits unchanged. A legitimate
   exhausted guard is an approval blocker, not a bypass opportunity.
4. With browser closed, verify both tenants' fresh selection → generation →
   quality approval → ready buffer → natural scheduled delivery → exact live
   artifact → genuinely fresh replacement. Record original deadlines, actual
   publication/verification times, remaining buffer and every unresolved failure.
5. Verify selected-page permissions/conditional edits and current Search Console
   ingestion. Attribute growth only from adequate subsequent measurement, never
   test counts, publication receipts or synthetic click observations.

Provider expenditure in30: USD0. USD20 is inactive/unspent. No production reads or
writes, paid probes, push/deploy/migration, purchases, cap increase, reservation or
attempt reset, tenant enumeration, outreach or backlinks. The protected parent
diagnosis/secret/supervisor state remain untouched. Local technical recovery is
not yet deployed SaaS acceptance, current LeadPilot replenishment or SEO growth.

---

# Historical candidate29 — customer journey

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
