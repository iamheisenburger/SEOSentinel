# Expected-click evidence backfill runbook

This migration measures existing published/current sealed-ready topic coverage.
It does not discover topics, call a model, generate an article, change cadence,
publish content, or promise traffic.

The CLI entry below is an operator canary. Eligible tenants may also advance
through the separately fenced autonomous fleet described in
`EXPECTED_CLICK_AUTONOMOUS_BACKFILL_RUNBOOK.md`; operator-origin jobs never
auto-chain.

## Safety contract

- Internal operator entry points only.
- Explicit tenant opt-in: `expectedClickSchedulingEnabled === true`.
- Autopilot must be enabled and the tenant must be in `warm` or `live` rollout.
- Current tenant authority and exact DataForSEO demand must already be present.
- At most 10 legacy covered topics in one batch.
- At most one live top-10 SERP call per selected topic and one 50-domain bulk
  competitor-authority call for the whole batch.
- One new batch per site, policy version, and UTC day. A partial job resumes the same immutable
  reservation and snapshots; it does not create a second batch.
- The complete provider envelope is capped at 100,000 microUSD ($0.10) and is
  reserved through the shared $9.85/day, $35/month provider ledger.
- The free DataForSEO balance endpoint is checked before reservation and again
  immediately before paid work.
- A provider balance failure before any paid call releases capacity but retains
  the audit row. Once a paid call begins, the reservation is never released.
- Every topic write rechecks the current tenant, rollout epoch, exact topic,
  exact linked artifact fingerprint, locale-bound demand, and deterministic
  business fit. A changed/deleted tenant or artifact is skipped, never repaired.

## Inspect before queueing

Use the aggregate internal status query. It never returns credentials, provider
wallet balance, raw GSC rows, or another tenant's data.

```bash
npx convex run expectedClickEvidenceBackfill:getStatusInternal '{"siteId":"SITE_ID"}' --prod --codegen disable
```

Confirm all of the following before proceeding:

- `enabled` is `true`.
- `activeRollout` is `true`.
- There is no `pending`, `running`, `partial`, or `completed` batch for the same
  UTC day.
- The shared provider budget and owner-approved DataForSEO wallet funding are
  available. Do not raise either ceiling from this runbook.

## Queue one canary batch

The action performs the free account preflight before the atomic reservation.
Do not invoke `reserveAndQueue` directly.

```bash
npx convex run actions/expectedClickEvidenceBackfill:queueExpectedClickEvidenceBackfill '{"siteId":"SITE_ID","policyVersion":1}' --prod --codegen disable
```

Safe non-queued outcomes include:

- `rollout_ineligible`
- `tenant_authority_unavailable`
- `no_eligible_legacy_topics`
- `daily_batch_exists`
- `resume_required`
- a shared provider daily/monthly/cooldown reason

These outcomes make no paid request.

## Observe and verify

Poll the aggregate status query. A completed job reports selected/snapshot/
failure/persisted/insufficient/skipped counts separately. It never calls the
next batch automatically.

Then verify the canonical portfolio projection:

```bash
npx convex run topics:getInventoryAuditInternal '{"siteId":"SITE_ID","recentLimit":15}' --prod --codegen disable
```

Only rows with current exact demand, live locale-bound SERPs, compatible fresh
competitor authority, and current tenant authority can become `eligible`.
Measured `insufficient_evidence` is a valid audit outcome and must not be
replayed daily as if repeated spending could change the same receipt.

## Resume a partial batch

Resume only the exact job ID returned by status. Completed SERP snapshots are
not replayed. A failed paid SERP attempt is recorded and skipped so the job's
11-call ceiling remains absolute.

```bash
npx convex run actions/expectedClickEvidenceBackfill:resumeExpectedClickEvidenceBackfill '{"siteId":"SITE_ID","jobId":"JOB_ID","policyVersion":1}' --prod --codegen disable
```

If status reports `authority_attempt_ambiguous`, do not retry or queue another
batch that day. The single bulk call began without a durable response receipt;
manual provider billing review is required before a future versioned repair.

## Interpreting the result

This migration closes a measurement blind spot. It lets the portfolio audit
distinguish attainable existing pages from mathematically weak or unprovable
ones and prioritize future growth work. It does not itself create rankings,
clicks, backlinks, or conversions. Those outcomes remain proven only by the
tenant's GSC and outcome-receipt chain.
