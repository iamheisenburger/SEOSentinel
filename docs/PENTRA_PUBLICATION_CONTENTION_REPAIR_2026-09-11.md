# Publication contention repair — offline review candidate

Assignment **supervisor-20260911-publication-contention-repair-08**.
Branch `codex/publication-contention-repair`, based on local doc-only
`8a26176ab42f47c47fe8ca9c8ef6972bfe352025`; its runtime parent is the deployed
`8e9e14739b2d4c217dccf40a3efcbfd37c548fe7`. No dormant spending framework,
approval table or ancestor commit is included. **No push or deployment.**

Today's user cutoff remains **September12 07:00 UTC**, end September11 PDT.
This is a technical reliability repair, not monetisation or article acceptance.

## Reproduced failure and exact scope

Before changing runtime, the actual connected publisher regression failed:
`Pure lease contention must not consume a failed delivery attempt: 2 !== 1`.
A GitHub ref PATCH returned503 at virtual12:00:00.007. The job's normal+5minute
retry encountered the retained15minute site/immutable-artifact lease and did
not make an external write, but `markPublishFailed` consumed another attempt.

The repaired path uses structured `publication_lease_contention` results, never
exception-text/substring classification. `articles.beginPublication` keeps the
rollout, exact artifact/config, shared destination, and optional worker-claim
checks. An active or unresolved lease returns its retry timing without acquiring,
clearing or extending another workflow's lock. An unresolved revision without
a usable lease remains a fail-closed policy rejection, not guessed free capacity.

The worker's atomic `jobs.markPublicationDeferred` re-reads the exact current
job/site/article and lease state. Only a still-owned, unexpired worker may
commit the transition. It records the owner key, article, content/config and
destination hashes, rollout epoch, initial deadline, generation and wake ID;
preserves publication/worker failures; keeps the exact article and publish-only
checkpoint; settles only the already-completed generation-attempt lifecycle;
and arms one coalesced exact-generation callback. It does not touch spend
reservations, regenerate content or invoke a provider.

`jobs.resumePublicationAfterContention` ignores early/stale/wrong-site/generation
callbacks, rejects a changed immutable boundary, and observes the current lease.
A renewal re-arms the bounded wait. At expiry, it dispatches the existing exact
job through the actual ordinary claim and pipeline handlers. Both ordinary
claim entry points revalidate the stored deferral boundary, so a competing
natural wake cannot bypass it. Completion or a real subsequent failure cancels
a superseded pending callback. Real delivery/ambiguous-write failures still use
the unchanged3-failure allowance and existing backoff.

Scheduled job claims now also travel through publication lease acquisition and
the final pre-external-mutation receipt. Stale/expired claims cannot start a new
write or charge a stale publication failure. Direct owner actions and existing
exact-envelope receipt recovery keep their separate existing authorization paths.
The owner-facing publish action cannot interpret a structured deferral as success.
No worker token or raw owner identity is exposed by the new public response.

Two related path defects were covered within this repair:

- A pristine pre-provider lease can expire without any failed external attempt.
  Proven cleanup now reloads the artifact and runs all ordinary quality/config/
  claim gates, without recursion or a fabricated failure. Attempted/ambiguous
  leases still require destination reconciliation, never this cleanup.
- Historical quality-retry jobs retain their provenance when they acquire a
  `publishOnly` checkpoint. A failing regression showed that the old branch
  order re-entered review and failed on the locked artifact instead of deferring.
  The publication checkpoint now takes precedence; initial quality review is
  unchanged, and publication itself still applies the normal strict gate.
  This focused regression adds the historical provenance flag to a real
  pipeline-produced job; its subsequent worker execution is real, but it does
  not separately reproduce the first quality-recovery-origin generation.

## Finite wait and schema contract

The independent wait budget is **at most4 scheduled deferrals** and **60minutes
from the first deferral**, whichever ends first. A wake is at the observed lease
expiry, clipped to the fixed deadline and never earlier than now+1second. An
expired foreign/unresolved or malformed historical lease is not stolen: it gets
at most one further ordinary15minute observation per remaining wait generation.
These are waiting limits, not additional failed-write or generation allowances.

Repeated legitimate renewals, an elapsed wait deadline, or changes to owner,
article/config/destination seal, domain or rollout terminally close the waiting
job. Its failure counts, artifact and external ambiguity locks remain intact;
there is no reset/replay or promise that a stalled destination eventually clears.
The same immutable article/config cannot gain a fresh publication job to escape
that terminal receipt. The queue history is exact-site/article indexed, bounded
to101 rows and fail-closed on overflow. A genuinely new reviewed artifact is a
different contract, not an automatic mutation of the old one.

Additive schema only: optional `jobs.publicationDeferral` and
`jobs.by_site_article`. **61 tables /293 indexes**, one added index; no table
addition, deletion, migration, monetary framework or spending activation.
The new index must be deployed before relying on the production queue guard.

## Connected and focused evidence

All times below are **virtual UTC**, not actual publication times or latency
claims. The fixture executes actual registered handlers and exported argument
validators, not hand-written successful query/action results.

| Scenario | PATCH calls /visible commits | Failed delivery count | Virtual outcome |
| --- | --- | ---: | --- |
| Before repair: one503 + lock collision | 2 /1 | **2** | Published12:15:00.011; verified.012 |
| After repair: one503 + deferral | 2 /1 | **1** | Published12:15:00.008; verified.009 |
| Commit succeeded, response lost | **1 /1** | **1** | Destination read reconciles12:15:00.008; verified.009 |
| Two real503 failures, interleaved contention | 3 /1 | **2** | Published12:30:00.009; verified.010 |
| Three real503 failures | 3 /0 | **3** | Terminal; no fresh-job escape |
| Pristine worker death before any write | No duplicated artifact | **0** | Proven cleanup, current seal recheck, verified publication |

The single-failure artifact hash remains
`a5098ce7d5eb0c62a40a8c3495a73a9b43de312cc5bfd4ac529a5fa3a6455ee7`.
It is not regenerated during recovery. The three publisher actions remain
failure, structured deferral, and successful/reconciled delivery; only the
failure count changes from2 to1.

Focused real-handler cases cover:

- Concurrent same/different sealed-article lease acquisitions at one destination;
  only one owner wins, with independent publication on a different synthetic site.
- Repeated pre-expiry worker attempts, stale deferral callbacks and replayed
  mutation results: no external I/O, new failure or altered lease; one pending wake.
- Concurrent expiry callbacks and worker claims: one resumption and publication.
  A natural worker winning before its callback cancels that pending callback;
  late callbacks cannot reschedule or write again.
- Lost-response reconciliation against the fake Git repository's actually
  committed bytes, not an article-row-generated receipt; unchanged Git head and
  exactly one visible commit.
- The correct remaining real-failure budget, including actual third-failure
  exhaustion; no failure resets or same-artifact fresh queue escape.
- Changed owner/content/destination/epoch, wrong site, stale/expired worker,
  direct natural claim, prolonged/renewed/malformed lease, and one-hour cutoff.
- Pristine expiry and retained quality-retry provenance without another paid
  review, content mutation or failed attempt.

The ordinary connected two-business scenario still starts from no topics or
articles, runs fresh discovery through strict quality seal/publication/verification,
and reaches policy buffers4 and3 using newly generated post-consumption articles.
It now also executes the daily business's **second configured due period**:
due **Sep12 12:00:00.013**, published **.065**, verified **.066**, new replacement
created **.068**, restored buffer **4**, two visible commits total. Replacement:
`7c9ebc30b9155f4cce5a1a36b5c619716c67bf7e30c1e8ec31c57be577cc7c7c`.
The other business's second due period was not executed. No synthetic time
advance changes a customer's production cadence.

## Gates and limitations

Final gates on Node24, completed before the review handoff:

- **1,465 tests passed**, zero failed, cancelled or skipped. This includes
  **21 connected/continuation tests** (18 core and3 continuation).
- Typecheck and production build passed with explicit non-secret synthetic
  Convex/Clerk/site configuration. No production build credentials were needed.
- Lint **0 errors /157 existing warnings**, no new helper/fixture warnings.
- Additive schema gate passed against origin/main: **61 tables /293 indexes**.
- Tracked/staged-source secret scan passed: **620 files**; the untracked
  credential target file and supervisor state were never staged or printed.
- Production dependency audit: **0 vulnerabilities**, unchanged lockfile.
- Local desktop/mobile browser gates: **16 passed /2 explicit authenticated
  customer-acceptance skips**. Those skips are not accepted customer flows.
- Whitespace/diff checks passed. No hosted CI, deployment or production
  acceptance is asserted for this offline candidate.

The fixture supplies serialized mutation/rollback, index ordering, scheduled
execution and a controlled clock. It does **not** model distributed Convex OCC
retries, real concurrent action timing, deployment/index construction or a
full stored-document validator. Exported handler argument validators are real.
Provider prose/audits/images, DNS/HTTP, storage and GitHub are synthetic. The lost
response is a503 returned after the fake Git destination commits, not a real
network outage. Deliberately repetitive synthetic prose and stub image reviews
are not customer-quality evidence. Existing negative quality tests still reject
unsupported claims and poor editorial output; no gate was weakened.

An early full gate exposed an existing text-range assertion that accidentally
included newly placed helpers in a historical settlement handler's source slice.
The helper block was moved after the existing handler group; the original
assertion was preserved. Final runtime checks and release gates are required,
not that failed interim run.
A second source assertion's branch anchor was updated for the explicit
`!payload.publishOnly` exclusion; its tenant-topic-before-spend checks remain.

No production query or paid/provider-backed scheduler, generation, revision or
publication was invoked in assignment08. No auth/purchase/budget/cadence change,
attempt reset, valid-reservation removal, prospect/other-tenant inspection or
new automation. The13:15 evidence fleet was not run early. Existing provider
limits **$32 owner /$4 incremental discovery /$35 fleet** remain unchanged.

Last live evidence is assignment07 (12:25–12:29UTC), not a fresh observation in
this offline package: Pentra1/4 and LeadPilot0/12, zero eligible fresh topics and
no active jobs. LeadPilot's last publication was Sep7 22:15:34.409UTC, missed
deadline Sep8 06:15:34.409. Pentra last published Sep11 10:24:02.469, next due
Sep12 10:24:02.469. These are actual historical receipts, unlike the virtual
traces above. Fresh live replenishment, article acceptance and monetisation
readiness remain unproven. No backlinks work or attributable SEO-growth claim.
