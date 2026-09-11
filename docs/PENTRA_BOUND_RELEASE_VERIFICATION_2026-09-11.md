# Bound release verification — assignment 12

2026-09-11, postdeploy observation 14:12:31–14:13:32 UTC. **Release complete;
fresh replenishment and end-to-end SaaS acceptance remain NOT READY.**
Machine-readable, credential-free receipts accompany this report in
`PENTRA_BOUND_RELEASE_VERIFICATION_2026-09-11.json`.

## Exact release and gates

Released exactly `55d9f10949221538a364b5c530003c3f58920cfe`, the independently
reviewed combined 08–11 amendment. Previous production/main
`8e9e14739b2d4c217dccf40a3efcbfd37c548fe7` was verified as its ancestor.
Dormant spending-framework commit `345616986eba32429cd8caa84f5f93c2252db5d3`
is not an ancestor. Runtime/schema workspace matched the commit; no unrelated
files were staged. One non-force fast-forward push moved main to the exact SHA.

- Convex: deployed to `wary-starfish-773` at
  `https://wary-starfish-773.convex.cloud`; CLI success confirmed by the client
  clock at **14:05:17 UTC**. This is a confirmation timestamp, not a fabricated
  server deployment timestamp/ID. Saved global authorization was used with
  Node 24 and the existing target-only environment file; no `--env-file`, new
  keys, login, credential retrieval or authentication changes.
- Convex upload, bindings, typecheck and schema validation succeeded. No index
  deletions; added `jobs.by_site_article` on
  `siteId,articleId,status,_creationTime`. Additive optional deferral/inventory/
  lower-bound receipts preserve existing documents (61 tables/293 indexes).
  Both exact-site production readers returned the new typed inventory. Pentra's
  nonempty reader exercised the indexed failed-history query successfully,
  verifying the index is usable rather than only declared in source.
- Vercel: GitHub deployment **6394741539**, status **18228228745**, exact SHA,
  Production, succeeded **14:04:46 UTC**. Deployment URL:
  `https://seo-sentinel-ozvek7dg7-arshads-projects-836ebfbd.vercel.app`.
  Its unauthenticated URL returned a Vercel SSO redirect; it was not followed.
  Public `https://pentra.dev` returned HTTP 200 at **14:12:41.954 UTC** with the
  Pentra title. Public production route health is not an authenticated UI test.
- Hosted CI **34607929090**, job **103290864500**, succeeded **14:08:14 UTC**:
  install, full tests, lint, types, additive schema, tracked-source secrets,
  production dependency audit, build and public browser tests all passed.
  OSV fallback steps were skipped because the primary audit succeeded.
  [Hosted CI receipt](https://github.com/iamheisenburger/SEOSentinel/actions/runs/34607929090).
  Prior exact-candidate local gates were 1,502 tests, 62 selected regressions,
  lint 0 errors/157 existing warnings, browser 16 pass/2 explicit authenticated
  skips; these are technical gates, not live customer acceptance.

Deployment codegen added four type-only module-map declarations locally. Those
self-generated lines were removed with a precise patch after inspection to
restore the reviewed working tree; no runtime code or user change was removed.
The documentation in this assignment is subsequent local evidence, not a new
runtime release or a second push/deployment.

## Bounded production verification

Only the two authorized site IDs were queried. Six read-only projections per
site: operator snapshot, article autopilot state, topic inventory audit,
topic-readiness precheck, operational-readiness precheck and latest micro-seed
status. No fleet listing, raw site credentials, other-tenant records, mutations,
provider calls, job dispatches, reservation changes or attempt resets.

An initial reporting attempt read Pentra's operator and article projections,
but the local CLI exited before flushing its 131,072-byte article JSON output.
The failure was reproduced offline: a 200,011-byte JSON write was truncated to
65,536 bytes without blocking stdout and was complete with blocking stdout.
The same CLI was then launched with blocking stdout, and the bounded bundle
completed. This repeated two read-only projections, not any paid operation.
No source-code change or production retry was needed for this local transport
issue. Raw responses were not persisted; the evidence file is allowlisted.

| Current observation | Pentra | LeadPilot |
| --- | --- | --- |
| Operator snapshot UTC | Sep 11 14:12:31.466 | Sep 11 14:12:51.039 |
| Mode / epoch | live / 6 | live / 9 |
| Usable inventory | complete, exact **1** | complete, exact **0** |
| Minimum / target | 3 / 4 | 9 / 12 |
| Inventory blockers | none | none |
| Active jobs in bounded pending/running views | none | none |
| Health | planning_blocked | missed |
| Scheduler-evidence-ready topics | **0** | **0** |
| Planned topics lacking evidence | 1 | 6 |
| Current topic rows | 145 | 243 |
| Last natural completion UTC | Sep 11 12:00:18.112, planning_blocked | Sep 11 12:00:24.739, planning_blocked |
| Last actual new publication UTC | Sep 11 10:24:02.469 | Sep 7 22:15:34.409 |
| Exact publication deadline UTC | Sep 12 10:24:02.469, scheduled | Sep 8 06:15:34.409, missed |

The inventory totals are exact because both receipts are `complete`, not
because a lower bound was mislabeled. The migration marker is complete.
Pentra's one sealed ready article was created Sep 8; it is not fresh postrelease
production. The recent-article projections contain zero new rows in the last
24 hours. Review row counts are bounded views (5 and 25), not asserted totals.

Pentra's exact deadline receipt is `kd7f0ggjnq6vgdz291gsqht73x8e675v`, scheduled.
LeadPilot's is `kd73v5sa5rgdz6jmzz0da695wh8dzsyy`, completed planning_blocked
Sep 8 **06:15:44.386 UTC**. LeadPilot's bounded future-run list is empty; this
does not mean the global ordinary cron is absent. The next configured ordinary
cadence slot is **Sep 11 15:00 UTC**; it was not manually triggered or observed
in this package. All returned natural-run completions predate this release.
The successful postdeploy query is not evidence of a new natural completion.

## Live artifacts: old publications remain available

Both latest publication summaries carry matching audited and published hashes,
audit version 7, a passed gate and predeployment verified-URL receipts.

- Pentra article `j57001e1fe3a93x7em70dmcybh8dy0wf`,
  [Search Engine Optimization Content Writing: A Practical Guide](https://pentra.dev/blog/search-engine-optimization-content-writing-guide).
  Published Sep 11 **10:24:02.469 UTC**; stored verification **10:24:15.343**.
  Fresh GET **14:13:30.449**: HTTP 200, expected final URL, visible title and
  canonical URL verified using the existing live-publication verifier.
  Stored artifact hash:
  `3e2ba16ceef80de9bdbb9e4942973bd9b9e7709336ea38c6e5738edd6745c5bd`.
  Fresh HTML SHA-256:
  `59041ddd825524dc994b95ea090ba217e9da2b2ab9528de16f5ef848777fc6d2`.
- LeadPilot article `j570rhgqhyv3w5gs7keqsa2j158dxg5a`,
  [SaaS Lead Scoring: An Evidence-Based Framework for Prioritizing Website Leads](https://leadpilot.chat/blog/saas-lead-scoring-framework).
  Published Sep 7 **22:15:34.409 UTC**; stored verification **22:18:06.407**.
  Fresh GET Sep 11 **14:13:32.368**: HTTP 200, expected final URL, visible title
  and canonical URL verified. Stored artifact hash:
  `969dae96a850e9fa04184f585ad0b8486ad2d7966c09cd7fa7fd11bd075febdd`.
  Fresh HTML SHA-256:
  `a98e2ae1818fe939dc3d05a522464178599d05838dd37c004bac4b70b9b4f700`.

The HTML does not embed either canonical artifact hash. HTML SHA-256 identifies
the fetched rendered response; it is NOT the publication artifact digest.
Matching stored seals plus URL/title/canonical checks do not independently
recompute the entire served artifact or prove a new postdeployment delivery.
No immutable GitHub destination receipt was newly retrieved in this package.

## Customer/operator status and remaining admission boundary

The direct authenticated `growthLoop:getStatus`/UI check was **not performed**.
No retained verified owner identity was available; the supervisor explicitly
confirmed not to invent one or fetch raw site credentials to obtain it.
The deployed customer buffer contract, applied to the safe current inventories,
would return `waiting_pentra` / `sealed_buffer_below_minimum` for both sites.
This is a code/current-data inference only: the operator projection overlays
current inventory on health and is not a direct raw stored-health or customer
API response. No claim is made about all customer stages or signed-in UI.

Topic and operational prechecks are `ready:true` on both sites, with remaining
article quota 113, but `schedulerTopicAvailable:false`. Those prechecks mean
only their bounded prerequisites passed; they are NOT budget admission,
source-plan replay authorization or evidence-ready topics.

The outstanding planned keywords are:

- Pentra: `automated content calendar SEO`.
- LeadPilot: `software sales`, `agent sales representative`,
  `ai sales automation`, `sales integration`, `sales conversation example`,
  `sales chatbot`.

Each lacks current auditable exact-keyword demand and all five required fresh
page-one authority measurements. Topic IDs and exact reasons are in the JSON.
Counts classify Pentra as 139 coverage conflicts/1 needs evidence/5 too thin;
LeadPilot as 229 coverage conflicts/6 needs evidence/8 too thin. These are
planning classifications, not permission to relax fit, coverage or quality.

Latest demand receipts are `no_eligible_legacy_topics`, evaluated Pentra
**10:24:15.646** / LeadPilot **10:26:08.065 UTC**. Latest evidence receipts are
`no_current_demand_candidates`, evaluated **10:24:15.939** / **10:26:08.806**.
The planned-gate-blocked counts are 28/170 in those historical candidate views.
No new postdeploy backfill reservation or success receipt was present. In
particular, these old timestamps do not prove the 13:15 dispatcher ran.

Both latest micro-seed jobs are terminal fallback `missed/no_strict_candidate`:
Pentra `pd7374xpbxq1qg750cntkjx75s8e3cgf` completed Sep 9 **12:30:44.390 UTC**;
LeadPilot `pd71z1mck1kehvcynqghsk9sfs8e00cm` completed Sep 8 **15:30:56.922**.
Each received 300, accepted 0 and records $0.048 actual discovery cost. Neither
is new work. Full current source-policy ledgers were not queried; do not infer
that their exhausted fallback may be replayed from the two readiness checks.

## Budget boundary — previous evidence, not a new financial audit

Assignment 07's Sep 11 **12:29:40–41 UTC** authorized-site audit remains the
latest financial evidence: actual verified $2.992560, spent execution ceilings
$12.000000, retained ceilings $16.050000; authorized-site owner subtotal
$31.042560. At most $0.957440 owner-month headroom under $32. Incremental use
$3.121440 leaves at most $0.878560 of the approved $4 discovery allowance.
The $1 plan could not fit either bound. The first rejection was the approved
incremental window within `reserveSharedProviderBudget`, using
`provider_account_monthly_budget_reserved`, not a provider-wallet exhaustion.
The last free DataForSEO balance receipt was $26.720668 at **10:29:27.120 UTC**.

That prior audit found no orphaned/invalid/duplicate settlement or incorrectly
retained cancelled/expired source; verified settlements replace ceilings rather
than add the same spend twice. A terminal job does not prove a retained ceiling
is free to remove. Owner-month resets **Oct 1 00:00 UTC**; this does not renew
the one-off $4 approval. The $32 owner/$35 fleet/$4 incremental boundaries were
not changed. No new generation/revision allowance is authorized in this task.
See assignment 07 for exact scope and previous financial reconciliation.

## Completion versus next runnable action

**Done:** exact reviewed release through CI/Convex/Vercel; additive index and
typed readers work in production; scoped postdeploy inventory/deadline/topic
checks; fresh HTTP identity checks on both last publications; safe handoff.

**Not done:** a postrelease ordinary run; fresh discovery to a usable topic;
generation and quality approval from that topic; full buffers; a scheduled
fresh publication and replacement after consumption on both tenants; direct
authenticated customer acceptance; independently reconstructed live artifact
hash; attributable SEO growth. No backlinks were started.

**Next concrete engineering action for supervisor retasking:** trace the seven
exact planned-topic admission decisions through `plannedTopicDemandAdmission`
and `plannedTopicEvidenceAdmission`, and distinguish per-topic rejection from
the older aggregate `plannedGateBlocked` receipts. Reproduce the resulting
boundary with local synthetic fixtures before any proposed generic repair.
In the same bounded diagnosis, reconcile the terminal fallback's source-policy
no-replay ledger; a ready operational precheck must never restart it. This is
not another $1 discovery attempt or a request to revise quality/coverage gates.
Existing snapshots alone do not establish which admission rule rejected each
planned topic, so do not invent that cause. A narrow safe per-topic projection
may be required in a separately reviewed assignment; no new production writes
or reads were added here for that investigation.

The supervisor's existing natural monitoring can observe **15:00 UTC** and
compare a genuinely postrelease run receipt against this baseline. No new
monitor was created. Ordinary scheduling is not a promise that prerequisites
or funding will have changed. Pentra's next actual cadence deadline remains
**Sep 12 10:24:02.469 UTC**, later than today's acceptance cutoff **Sep 12
07:00 UTC** (end of Sep 11 America/Los_Angeles); it was not moved forward to
manufacture acceptance. LeadPilot is already overdue and has no sealed article
to deliver. The product remains **NOT READY**, regardless of passing gates.
