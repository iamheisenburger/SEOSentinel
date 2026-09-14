# SLC33 — local independent validation funding

Assignment `supervisor-20260914-slc-validation-integration-33`, based on accepted
local candidate `83af018813b90d0e1b6e38f0fbc2447285caaf89`. The final handoff gives
the exact new review commit. This is a dormant implementation, not deployment,
financial activation, a migration, or production acceptance. USD 0 spent.

## Change and financial boundary

The existing immutable cumulative-validation authorization can optionally carry
`independentFunding.scope = additional_provider_allowance` plus a separate,
explicit approval reference. That reference must differ from both the monthly
approval and the run approval. Existing approvals keep their original conjunctive
guards; an existing run cannot be upgraded, downgraded or reclassified.

New reservations copy this authority from the persisted, validated two-site run,
not a request flag. Ordinary and independent expenses remain in the same ledger.
An authoritative partition excludes only valid independent receipts from ordinary
account/day/month/incremental and fleet/day/month monetary totals. Ordinary work
cannot borrow the grant and does not lose capacity when independent work spends.
Historical reservations and old limits are unchanged. Malformed independent
receipts fail closed; their markers cannot silently become an exemption.

For explicitly authorized bound work only, the non-renewing lifetime run ceiling
(at most USD 20) substitutes for those legacy monetary caps. This is a scoped
additional allowance: if separately authorized and activated, combined spend can
exceed the old USD 35 fleet ceiling by the authorized additional amount. It is
not equivalent to leaving that ceiling conjunctive for validation work. No such
activation or financial-policy decision was made in this assignment.

Entitlement, account ownership, exact two-site/job/reservation lineage, provider
health/backoff, per-request/work ceilings, settlement and cumulative limits still
apply. Unknown charges retain their ceilings. Restart, UTC/day/month rollover,
monthly approval renewal, mode switching and changed-setup reconfirmation cannot
reset the run or fall back to ordinary money. Stop/expiry blocks new calls while
allowing already-started calls to record actual cost. Canonical financial deletion
tombstones retain their funding classification without granting execution.

Credential-free readiness and exact-site financial projections show ordinary and
independent scopes separately. The UI explains that ordinary headroom cannot
extend the separate allowance. No granting UI, feature flag, environment default,
second ledger, queue, table or index was introduced (two optional schema fields).
The legacy audit's source-relationship inventory was not expanded to content-work
jobs; new assertions verify financial partitioning, not a complete new orphan audit.

## Connected no-spend proof

Real registered admission, provider-call reservation, settlement, scheduler,
publication, verification and refill handlers run with explicitly mocked external
transports. Both permitted synthetic sites start empty while old ordinary holds
fully occupy account USD 32, incremental USD 4 and fleet USD 35. Both create fresh
work, pass substantive review, publish and verify three fixed-window cycles, and
finish with two newly replenished ready items each. Ten new jobs and 30 mocked
model calls settle 6,000 synthetic micro-USD units, not actual expenditure.

All times below are **synthetic September 11, 2026 UTC**, not production receipts.

| Cycle | Fixed deadline | reservoir.example publication | cedarcare.example publication | Ready after refill, each |
| --- | --- | --- | --- | --- |
| 1 | 12:10:00.000 | 12:05:00.012 | 12:05:00.013 | 2 |
| 2 | 12:40:00.000 | 12:35:00.055 | 12:35:00.056 | 2 |
| 3 | 13:10:00.000 | 13:05:00.031 | 13:05:00.032 | 2 |

The same setup without distinct explicit financial approval stays blocked.
Old hold rows remain byte-for-byte unchanged. Third same-owner and foreign sites
remain under ordinary guards; their admissions and headroom do not change because
of independent reservation, settlement or stop. Synthetic foreign fixtures are
not production tenant inspection.

Thirteen added test results (including stop/expiry subtests) cover concurrency and
idempotency; exact USD 20 occupancy; retained unknown costs across worker restart
and a new UTC month; a cheaper request still blocked despite refreshed ordinary
capacity; known-cost reservation renewal; stop/expiry settlement; mode/reconfirm;
run/reference omission; real bounded transient-provider recovery; provider health
and request ceilings; copied third/foreign scope; incomplete inventories; and the
existing deleted-account tombstone shape. The prior 17 scoped-run cases remain.

## Free release gates

- Focused SLC32/33: **30 passed, 0 failed, 0 skipped**, 6,778 ms.
- Full repository suite: **1,674 tests, 1,673 passed, 0 failed, 1 existing skip**,
  129,407 ms. The skipped sibling-consumer fixture remains an acceptance gap.
- Typecheck: passed. Schema compatibility: **61 tables, 296 indexes**, passed
  against accepted 83af018 and deployed b3994e0; no table/index removed.
- Lint: **0 errors, 157 existing warnings**.
- Build: passed with non-secret CI-equivalent public example configuration.
- Production dependency audit: **0 vulnerabilities**.
- Secret scan: **682 tracked files passed**, including the staged report.
- Browser: **26 passed, 2 genuine authenticated-session skips**, 5.5 seconds.
  The independent-funding component was checked at desktop/mobile sizes; its
  mobile screenshot was visually inspected. These are synthetic component tests,
  not authenticated acceptance. No skips were added.

An initial browser run overlapped build cleanup and encountered missing build
assets; rerunning build then browser resolved that race. The new currency assertion
was corrected from two decimals to the existing four-decimal display. A strengthened
UTC test initially failed because its synthetic control publisher receipt expired;
refreshing that fixture isolates financial admission without weakening the guard.
Final receipts are in `/tmp/pentra33-*-final.log` (ephemeral local gate output).

## Production and review prerequisites

No production reads/writes, provider requests, deployment, pricing activation,
cap/attempt/reservation changes, migration, owner account selection, repeated
approval question, task/automation creation or backlinks occurred in SLC33.
Production last verified at application commit
`b3994e0a5a10a24189a7fc767f11b8c3dbb1240a`; no new deployment verification is claimed.
Independent review and explicit scoped-funding authority are required before
activation. Prior pricing envelopes still do not guarantee USD 20 can complete
all live acceptance work; no paid probe was used to alter that conclusion.

The last production observations (September 14, 16:22:58–16:23:04 UTC) remain
historical: Pentra 0/4 buffer, last publication September 12 10:24:14.649 UTC,
missed deadline September 13 10:24:14.649 UTC; LeadPilot 0/12, last publication
September 7 22:15:34.409 UTC, missed deadline September 8 06:15:34.409 UTC.
LeadPilot publisher receipt, genuine authenticated acceptance, exact migration
consent and safely priced activation remain prerequisites. Actual provider credit
is unknown. No fresh live replenishment, monetizable SaaS acceptance or attributable
SEO growth is claimed. Stop for the supervisor's independent financial review.
