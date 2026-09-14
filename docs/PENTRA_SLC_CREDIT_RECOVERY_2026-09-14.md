# Credit-refusal recovery38 — local review, not production acceptance

Assignment `supervisor-20260914-slc-credit-recovery-38`, based on independently
reviewed diagnostic candidate `f0a9328776fc0816bd7401877872c24798bc1f12`.
The final handoff supplies this implementation's exact clean LOCAL commit.
No38 deployment, production mutation, provider call/probe, funding purchase,
grant/schedule/cap/attempt reset, new task/automation or backlinks. Actual provider
expenditure in38 is USD0: all recovery execution below uses offline fixtures.
Production remains `20e8ebbe5998c8a6837c3bb24f9d4e57e53f7253` from37.

## Cause and preserved financial boundary

The earlier `provider_account_monthly_budget_reserved` is an internal Pentra
admission reason, not evidence of an empty provider wallet. The existing shared
reservation guard reports a concrete `budgetScope`; account-month, approved
incremental-window and cumulative-validation denials can share that reason.
The exact37 activation legitimately used the already-approved independent,
non-renewing20 run, not an increased ordinary account/fleet limit.

Both actual first draft calls then reached Anthropic and returned HTTP400,
`invalid_request_error`, with the exact insufficient-credit message. This is
the current live generation blocker. Provider usable credit was insufficient
for those requests; numeric wallet balance, billing cost and a provider reset
time remain unknown. Raising Pentra's internal cap would not fix that response.
The following ordinary values are the last exact-site financial audit from37,
at2026-09-14 21:29:21.199/21:29:23.016 UTC, not a new38 account-wide inspection:

| USD scope | Verified actual | Settled conservative ceilings | Outstanding held | Total consumed |
| --- | ---: | ---: | ---: | ---: |
| Pentra ordinary | 1.436640 | 5.000000 | 7.250000 | 13.686640 |
| LeadPilot ordinary | 1.555920 | 7.000000 | 8.800000 | 17.355920 |
| Combined authorized ordinary sites | 2.992560 | 12.000000 | 16.050000 | 31.042560 |
| Separate20 validation run | 0 verified | 0 | 5.000000 | 5.000000 |

Ordinary limit32; headroom AT MOST0.957440. Old4 allowance consumed3.121440,
headroom AT MOST0.878560. Fleet35 is unchanged and unenumerated. Account-month
reset2026-10-01 00:00:00 UTC; independent20 never resets and has15 remaining.
Zero verified actual is NOT verified zero billing. No defect justifying removal
of terminal-job holds, double settlement or erased unknown costs was established.
Every original hold remains; the new recovery code never settles/reduces one.

## Smallest generic recovery

The prior supervisor reproduced an actual400 refusal, restored fixture funding,
then normal owner Retry still returned `content_failed_slot`. The missing
transition is now implemented on the SAME existing durable job:

1. The actual SDK boundary captures a valid, nonconflicting provider request ID
   with the precise400/type/message refusal, original call hash, stage and time.
   Missing/mismatched IDs or other failures remain ambiguous and unreplayable.
   A tracking-version marker prevents new ambiguous calls from masquerading as
   pre-receipt historical calls.
2. New INTERNAL `contentWork:confirmCreditRestoration` records an exact platform
   attestation after funding is genuinely restored. It requires site/job/call,
   original request hash, provider request ID and immutable funding-event
   reference. This is not a grant, receipt of cost, wallet top-up, provider probe
   or wake. It checks current entitlement, consent, profile/destination/page,
   rollout, pricing, original run and held-reservation lineage. It cannot approve
   cancelled, retired, leased, exhausted, settled or released work.
3. Existing owner `contentWork:control` Retry accepts the opaque exact retry
   token returned by normal readiness. One atomic consumption resumes prepare
   or review and wakes the ordinary dispatcher. Duplicate/concurrent clicks
   consume it only once. Availability alone, Resume or a heartbeat cannot replay
   the refused call. Customers do not create funding attestations.
4. Worker/provider/publisher/verification/refill retain every existing guard.
   Successful cached calls and hashes are reused; original worker-attempt rows,
   deadline, price, grant and per-item cap remain. Only the existing bounded
   recovery counter advances. Three total recoveries and20 total calls remain
   finite; a repeated credit refusal needs a fresh platform event reference and
   consumes another remaining recovery, never a new allowance.

Every rejected call retains its ceiling as uncertain cost. The entire original
reservation stays held even after the recovered job succeeds: no invented zero
cost or speculative release. Independent-run accounting already includes that
hold across all dates, so an acknowledged refusal can use its remaining original
envelope after day/month rollover. Ordinary dated holds cannot be borrowed on a
later day; they remain blocked for review. Real-time authority/expiry checks are
not frozen or bypassed.

Rollover fixtures exposed a second real defect: the rebuilt draft's current-date
string changed its request hash, preventing same-request recovery. Prompt-only
date/year now derive from the durable job's original creation time. New work has
a new date; admission, expiry, leases, publication and verification use the real
clock. Any other changed prompt input still fails the unchanged hash guard.
No stale artifact is relabelled as newly reviewed or newly published.

Customer UI says this is a Pentra-side generation interruption, not a request
to top up an Anthropic wallet or change plan. After exact confirmation the same
Retry control resumes interrupted preparation. Original lateness stays visible;
internal references remain in the existing technical disclosure.

## Existing production attempts: sufficient narrow evidence, not reconciled

A credential-free, read-only38 projection at2026-09-14 21:44:20.426 UTC inspected
ONLY these two exact site/job/run records and bounded site-scoped run windows.
Each window was complete and contained exactly one run for its failed job.
Both jobs had one worker attempt, one unresolved first draft call, no article,
result or actual-cost receipt, and zero publication attempts. Their finalized
durable run retained exact400/type/message/request-ID evidence.

| Reference | Pentra | LeadPilot |
| --- | --- | --- |
| Site | jh74txye54jna4t85m6y7p4d6h82v9ab | jh7cccny67df67rdm4jp65tmtn8am982 |
| Same failed job | j9703g7paa6atyya4fzr56ngs58ecn07 | j973nq40csygxhcg0bchsmx6zd8ecq9h |
| Durable refusal run | kd76xtwwz0x9epjf5sxbfp6s7h8edmhz | kd7b3vcravejwsh9mn0pa9sgmh8ed2xt |
| Provider request | req_011Cf42zxY2q9yG39aW7hnqF | req_011Cf431ERkqdB4pREzeTFb8 |
| Retained reservation | n576sgrs11b9dzc5mg0fjbm21n8echcx | n5727h3mka0ekryf5a90ggsj8s8edf7v |
| Original hold / first call ceiling, microUSD | 2500000 / 295194 | 2500000 / 282202 |
| Job created UTC | 21:23:20.975 | 21:23:24.477 |
| Failure / finalized run UTC | 21:23:25.533 / 21:23:25.660 | 21:23:29.238 / 21:23:29.464 |

Both call keys are `0:0:draft:submit_article:0`. Exact original hashes:

- Pentra: `b404c356bd31320392cc4fd362313b931878fecc979b73e8d842952a5b7ff350`.
- LeadPilot: `38060b80799baa44b4606a85db8b274a3e4dbe5cab158a837061a27386051e7e`.

The new confirmation's optional `evidenceRunId` can reconcile ONLY this narrow
pre-receipt first-call shape. It requires exact site/job/run/request/hash and
bounded timestamp lineage, one attempt/call/run, zero article/checkpoint/cost,
and no new tracking marker. It validates strict SDK error structure, rejects
extra success/usage data, and refuses incomplete or conflicting run inventories.
It stores source-run ID and evidence hash; immutable source evidence is checked
again at customer Retry and before every new paid call. The run, original request
hash, reservation, old counters and deadline are never rewritten.

The observed two production records have the required historical shape. Current
authority and funding restoration still must be checked at actual execution.
No attestation, reconciliation or retry was executed in production in38. This is
not authority to reconcile arbitrary old attempts, later-call ambiguity or a
possibly successful response. Such cases need missing exact refusal evidence.

## Connected free evidence

All new execution tests use actual registered handlers and the SDK, with an
explicit in-memory database, clock and offline network fixtures. Synthetic
operator confirmation is clearly separate from restoring provider availability.
The same saved jobs traverse normal owner Retry → worker → quality → publisher →
rendered artifact verification → fresh refill. Both sites preserve their original
two-minute-late deadlines and publish exactly once; each ends with two DISTINCT
ready items and a newly admitted topic/article after the consumed job verifies.

Synthetic2026-09-11 UTC (NOT real Pentra/LeadPilot publications):

| Refusal phase / fixture | Original deadline | Actual fixture publication | Verification | Buffer after refill |
| --- | --- | --- | --- | --- |
| Draft / ReservoirNote | 12:10:00.000 | 12:12:00.032 | 12:12:00.036 | 2 |
| Draft / CedarCare | 12:10:00.000 | 12:12:00.034 | 12:12:00.039 | 2 |
| After draft / ReservoirNote | 12:10:00.000 | 12:12:00.028 | 12:12:00.032 | 2 |
| After draft / CedarCare | 12:10:00.000 | 12:12:00.030 | 12:12:00.035 | 2 |
| Historical first-call evidence | 12:10:00.000 | 12:12:00.026 | 12:12:00.030 | 2 |

Further new cases cover day/month recovery from both draft and audit refusal;
restart; wrong owner/site/job/hash/request/token; missing/changed/conflicting
source evidence; revoked profile/destination/entitlement/consent/pricing/grant;
cancelled/retired jobs and unavailable holds; item/run exhaustion; repeated
refusals, reused funding events, exact-once concurrent retries and cached calls.
Existing32/33/35/36/37 regressions retain concurrent admission, cancellation,
expiry, actual settlement, prepared-work delivery after funding stop, finite
quality revisions and three subsequent synthetic cycles.

Final free gates on the implementation source:

- Full repository1717 discovered,1716 passed,0 failed,1 existing skip;
  131626.586292ms.
- Focused32/33/35/36/37/38 plus customer rendering:73 passed,0 failed,0 skipped;
  21576.716375ms. New38-only18 passed,0 failed,0 skipped;6557.541458ms.
- Typecheck and fixture-configured production build passed. Schema compatibility
  againstf0a9328 passed:61 tables,296 indexes, no deleted contracts.
- Full dependency audit0 vulnerabilities; lint0 errors,157 existing warnings.
  Staged whitespace check and final secret scan687 tracked files passed.
- Browser32 passed/2 genuine authenticated skips,6.1s; both desktop/mobile new
states pass interaction checks. Desktop outage and mobile restored screenshots
were visually inspected: notice/deadline/actions are visible, no overflow.
Synthetic browser hooks do not prove genuine signed-in customer acceptance.

## Production acceptance still open

The REAL first delivery window remains2026-09-14 **22:14:14.420–22:19:14.420 UTC**
(15:14:14.420–15:19:14.420 PDT). Do not move it even if it becomes overdue.
At the last exact production observation both SLC buffers were0/2, neither job
had an article/publication/live verification/refill, and both failed slots stayed
fenced. Last historical actual publication: Pentra September12 10:24:14.649 UTC;
LeadPilot September7 22:15:34.409 UTC. Old misses remain September13
10:24:14.649 and September8 06:15:34.409 UTC, respectively.

Next requires independent local review, explicitly authorized exact deployment,
genuine platform funding restoration within the SAME original20, then exact
attestation and normal owner retry of the same jobs. No extra customer budget
request is made here. A successfully funded provider call is not guaranteed by
an internal allowance. Do not call production accepted before BOTH live
generation/quality/verification/fresh refill chains succeed. Genuine owner UI,
three later ordinary cycles, measurement ingestion and attributable organic
growth remain separate open gates. Fourteen days remains BETWEEN same-page
discretionary revisions, not a delay after creation. No backlinks or prospects.
