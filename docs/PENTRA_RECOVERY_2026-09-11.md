# September 11 recovery and acceptance evidence

Updated 2026-09-11 10:37 UTC. Only Pentra
`jh74txye54jna4t85m6y7p4d6h82v9ab` and LeadPilot
`jh7cccny67df67rdm4jp65tmtn8am982` were queried. No other tenant records,
execution logs, or project data were inspected. Shared infrastructure billing
aggregates were read with the owner's signed-in Convex account.

## Restored platform; corrected diagnosis

The earlier CLI error described a free-plan resource limit. The signed-in
dashboard established the actual cause: the existing **Starter** plan had a
**$15/month team usage spending disable threshold**, with a $10 warning.
The projects were disabled for exceeding that dollar threshold, not for being
on the Free plan. The owner approved the specific $15 to $20 request on
September 11. Saved threshold is now **$20/month**, warning remains $10,
Starter remains unchanged, and the disabled banner disappeared. No subscription
upgrade, credential change, payment-method change or provider cap increase.

Exact-site reads succeeded at 10:24:12.011 (Pentra) and 10:24:13.933
(LeadPilot). The previous unsuccessful reads were 10:08:32.251 and
10:08:34.188. Restoration also resumed existing natural jobs; none was manually
forced. This does not establish the original outage start time.

The billing page displays subscription renewal September 20, 2026. The usage
selector displays August 21–September 21. **An exact UTC spending-limit reset
time is not established.** Neither date is Pentra's October 1 provider-budget
reset. [Convex team spending limits](https://docs.convex.dev/dashboard/teams/teams)
apply across team projects; the approved increase may resume other existing
projects, but those projects were not inspected.

SEOSentinel project billing aggregates: 351K function calls, 14 GB-hours action
compute, 251.37 MB database storage, **49.14 GB database I/O**, 455.65 MB files,
1.36 GB egress. Top database-I/O function aggregates were:

| Production function | I/O this displayed billing window |
| --- | ---: |
| growthLoop.getStatus | 10.92 GB |
| cadenceMicroSeed.inspectInternal | 7.20 GB |
| cadenceMicroSeed.listLegacyAnchorMismatchRepairsInternal | 5.02 GB |
| expectedClickEvidenceBackfill.getFleetReadinessInternal | 4.67 GB |
| expectedClickDemandBackfill.getFleetReadinessInternal | 3.75 GB |
| cadenceMicroSeed.reconcileVerifiedProviderCosts | 3.15 GB |

These are aggregates, not per-tenant measurements. Exact incremental billed
infrastructure cost is not yet available. The approved addition is capped at
$5; targeted validation was estimated under $1, not represented as an invoice.

## Current provider accounting, separate from infrastructure

Complete scoped audits at 10:24:58.298 and 10:25:02.006 confirmed shared
ownership, complete current-month reservation/source windows and zero invalid
settlements. No valid reservation was removed, attempt reset or job reopened.

| USD | Pentra | LeadPilot | Permitted subtotal |
| --- | ---: | ---: | ---: |
| Verified actual provider-cost settlements | 1.436640 | 1.555920 | 2.992560 |
| Settled spent-execution ceilings, not measured cash | 5.000000 | 7.000000 | 12.000000 |
| Retained ceilings for used/ambiguous work | 7.250000 | 8.800000 | 16.050000 |
| Internal capacity consumed | 13.686640 | 17.355920 | 31.042560 |
| Since the September 8 discovery approval | 2.060960 | 1.060480 | 3.121440 |

Effective account monthly limit remains **$32**, base/default $28; separate
incremental discovery limit remains **$4**; fleet monthly $35, account daily
$9.60 and fleet daily $9.85 remain unchanged. From these two sites alone,
account monthly headroom is **at most $0.957440**; the incremental fence is
tighter at **at most $0.878560**. Other account/fleet rows were not inspected,
so these are upper bounds, not assertions of full-account available capacity.
Both internal monthly windows expire **2026-10-01 00:00:00 UTC**
(September 30, 17:00 PDT).

`reserveSharedProviderBudget` checks the approved incremental window before
`evaluateProviderAccountCapacity`. A fresh $1 single-execution plan would
therefore fail `provider_account_monthly_budget_reserved`, scope
`approved_incremental_window`: $3.121440 + $1 exceeds $4. Even without that
fence, the permitted subtotal plus $1 exceeds $32. This is sufficient to
explain blocked $1 admission without querying another tenant or attempting a
paid reservation. Smaller discovery envelopes remain subject to normal source,
attempt, quality and account-wide guards; remaining money does not authorize
replaying exhausted micro-seed attempts.

Completed demand/evidence calls without exact cost receipts retain their
ceilings. Failed plans that made paid calls retain their spent execution;
ambiguous provider responses retain their reservation. Terminal status or an
expired lease is not proof of zero cost. Settled values replace, rather than
add to, original reservation amounts. The earlier two proven defects and
exact $1.10 repair remain documented in
`PROVIDER_BUDGET_AUDIT_2026-09-08.md`; this pass found no new evidence permitting
additional refunds. Both sites had zero active article jobs at the snapshot.

A fresh free DataForSEO account preflight at **10:29:27.120 UTC** reported
**$26.720668 available**, exceeding the $0.40 checked requirement. No search
was made. Thus current internal admission constraints are not provider-wallet
exhaustion. The [provider's user-data endpoint](https://docs.dataforseo.com/v3/appendix-user-data/)
is free; only its numeric balance projection was emitted, never credentials or
other account details. No Anthropic/OpenAI wallet balance is inferred from this.

The owner approved infrastructure recovery, not the previously declined $60
all-in article acceptance envelope. Additional operator generation/revision
tests remain unauthorized. Operator paid-provider spend in this pass is $0.

## Reproduced generic repairs and release

Source **f1e881d1d3314bf1abd9fb7860654e6b08377ece**:

1. Real `growthLoop.getStatus` loaded up to 500 full article bodies only to
   calculate counts. A 120-article synthetic regression failed on that bulk
   read. It now uses compact summaries only after the existing integrity
   migration completes; only purported verified publications hydrate originals
   to validate current ownership/status/receipt/live proof. Unmigrated or
   overflow inventories preserve the previous bounded authoritative path.
   Synthetic serialized read bytes fall by over 98%; this is **not a measured
   production-wide savings percentage**. Ownership and revoked/missing receipt
   tests remain fail-closed.
2. The legacy anchor repair repeatedly read all article bodies and active jobs
   when there was no eligible legacy topic. The real-handler regression failed
   before repair. It now short-circuits after the bounded topic check. Actual
   legacy candidates still require the authoritative published-article and
   active-job checks. Read limits, domain/ownership and quarantine guards remain.
3. `/sitemap.xml` was statically prerendered with no revalidation. A build-time
   backend outage became a permanent static-only sitemap until redeploy. The
   production manifest confirmed this. The sitemap is now dynamic and fails
   closed on an outage, rather than reporting an incomplete list as complete.
   Runtime tests cover outage → recovery → revocation → outage for two synthetic
   domains. The production build now marks `/sitemap.xml` dynamic. No stale
   article-body fallback, revoked-content cache or weakened publication gate.

Local gates: **1,438 tests passed**, typecheck, build, additive schema (61 tables,
292 indexes), secret scan (609 tracked files), dependency audit (0 findings),
lint (0 errors, 157 existing warnings), browser (16 passed, 2 explicit
authenticated skips). Browser fixtures are not production customer acceptance.

Convex deployment succeeded **10:29:23.818 UTC**, with no index deletion and
successful schema validation; this also finally deployed the September 10
backend dependency update. Deployed owner-identity CLI status checks at
10:29:52.364 and 10:29:56.874 succeeded: Pentra 128 articles / 9 verified
published URLs, LeadPilot 134 / 32. Both correctly retain planning/buffer blockers.
Deployed legacy repair queries returned empty topic IDs for both sites.
These are read-only CLI diagnostics, not authenticated browser acceptance or
proof of newly restored buffers. Hosted CI/frontend deployment receipts follow.

[Hosted quality run 34589663799](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34589663799)
passed at **10:36:04 UTC** for **9e52d80ab52ab924b92319a80e7f5c2e5c073525**,
which contains the same runtime repair plus generated type bindings and the
handoff. All required gates passed, including hosted browser acceptance (16
passed / 2 explicit authenticated skips). The earlier f1e881d run34589422208
was superseded/cancelled by this follow-up push, not claimed as successful.
Frontend deployment **6391273907** for 9e52d80 succeeded at **10:32:29 UTC**,
receipt `https://seo-sentinel-c71ant8hf-arshads-projects-836ebfbd.vercel.app`.
Final evidence-only documentation updates do not change the deployed runtime.

Production frontend deployment **6391231526** for f1e881d succeeded at
**10:29:41 UTC**, receipt
`https://seo-sentinel-kpr0el83d-arshads-projects-836ebfbd.vercel.app`.
The production sitemap returned **HTTP 200 at 10:31:50.826**, 121 URLs,
including the exact recovered guide URL, no double-slash blog paths and a
Vercel cache MISS. This verifies the deployed sitemap, not simulated outage
recovery in production (no outage was deliberately induced).

Normal deployed recovery inspections at **10:32:14.886 / 10:32:18.867**
returned `source_plan_fallback_already_attempted` for Pentra / LeadPilot.
They examined 55 / 54 micro-seed rows and made **0 provider calls, 0 new
reservations, 0 refunds and 0 settlements**. Legitimate remaining discovery
headroom does not reopen exhausted source attempts.

Closing audits at **10:33:27.913 / 10:33:29.529** confirmed unchanged money
totals across 84 / 95 reservations, complete windows, **zero** invalid
settlements, duplicate source references, orphan reservations, amount
mismatches, expired leases, active sources, or unreleased cancelled/expired
sources. A local replay of the actual account-capacity function with only the
permitted $31.042560 subtotal rejected a $1 request against $32, without a
production mutation.

## Exact article evidence; acceptance remains open

Pentra's September 9 digital-marketing article has now been read from the
authoritative database: published **12:00:32.637 UTC**, live verified
**12:00:34.113**, against September 9 deadline **12:00:27.426** (5.211s late).
This corrects the earlier Git-file timestamp of 12:00:29.865: a repository
timestamp was not the completed publication receipt.

After restoration, the existing natural pipeline published
`search-engine-optimization-content-writing-guide` at
**2026-09-11 10:24:02.469 UTC**, verified **10:24:15.343**. Its receipt names
commit `1688fa227224d7d545a9c64e4413f193110a44d2`; audited and published hash
`3e2ba16ceef80de9bdbb9e4942973bd9b9e7709336ea38c6e5738edd6745c5bd`, audit v7,
factual 100/editorial 94. Current cadence's next exact scheduled deadline is
**2026-09-12 10:24:02.469 UTC**. The preceding daily deadline inferred from the
September 9 actual publication is September 10 12:00:32.637, making recovery
22h23m29.832s late; the old deadline row was not independently retrieved here.

Pentra buffer is **1 sealed / minimum 3 / target 4**, still `planning_blocked`.
There is newly established partial replenishment evidence from September 8:
topic `jn7f3tr8wcmns0r7gsf7jc2fnx8e0x02` was created **15:28:51.176**, article
`j57dwbw5k5qv80tx7w136w52218e0mzz` created **15:31:07.468**, and sealed at
**15:41:41.989** (factual 100/editorial 96, v7). It is linked to the completed
September 8 plan/checkpoint and remains the one ready article. This proves a
fresh topic-to-sealed-article result after September 8 consumption; it does
**not** prove a full buffer or fresh replacement after today's consumption.

LeadPilot buffer remains **0 / minimum 9 / target 12**, no active article jobs
or new recent articles, and `planning_blocked`. Last actual publication:
**2026-09-07 22:15:34.409 UTC**. Exact missed deadline:
**2026-09-08 06:15:34.409 UTC**; its deadline run completed `planning_blocked`.
The latest natural run after restoration also completed `planning_blocked` at
**2026-09-11 10:24:27.317**. Its latest plan checkpoint is empty / semantic zero
yield; historical exhausted attempts remain closed. No scheduled new LeadPilot
publication or post-consumption refill is proven.

Independent public checks: Pentra's recovered guide HTTP 200 at
**10:27:40.038**, digital-marketing article 200 at **10:27:40.398**, and
LeadPilot's existing SaaS lead-scoring framework 200 at **10:27:42.231**.
All had exact expected canonical URLs and H1s. Old LeadPilot HTTP 200 is not
fresh article acceptance.

No backlinks work, new article-acceptance sign-off, attributable SEO growth or
monetisation-readiness claim. Live checks must still prove LeadPilot's fresh
quality article and scheduled publication, both target buffers, and replacement
after consumption. A natural cron's nominal next time is not a promise that
funding, opportunity or quality blockers will clear.
