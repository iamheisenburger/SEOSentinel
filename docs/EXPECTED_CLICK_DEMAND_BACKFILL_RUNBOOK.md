# Exact keyword-demand provenance backfill

The operator canary for this migration measures up to ten exact keywords already bound
to a tenant's published or current sealed-ready articles. It exists only to
recover missing DataForSEO demand provenance before the separate SERP and
competitor-authority evidence backfill runs.

It does not discover or rewrite topics, call a model, generate an article,
change cadence, publish content, or promise traffic.

Eligible tenants may also advance through the separately fenced autonomous
fleet described in `EXPECTED_CLICK_AUTONOMOUS_BACKFILL_RUNBOOK.md`. The CLI
commands below remain operator canaries and never auto-chain evidence.

## Safety contract

- The tenant must explicitly have `expectedClickSchedulingEnabled === true`,
  autopilot enabled, and rollout mode `warm` or `live`.
- The action is internal and operator-only. No application client can queue it.
- One new job per site, policy version, and UTC day, with at most ten unique exact keywords.
- Exactly one `keywords_data/google_ads/search_volume/live` provider task. No
  keyword-difficulty task and no AI fallback.
- The complete batch reserves at most 100,000 microUSD ($0.10) through the
  shared $3.30/day and $35/month provider ledger.
- The free DataForSEO wallet endpoint is checked before reservation and again
  before the paid task.
- Each exact topic/keyword attempt is persisted before HTTP. If the paid task
  might have started but no response receipt was committed, current version 1
  will never replay that keyword automatically, even on a later day.
- Queue, call, and persistence recheck tenant deletion, rollout epoch, current
  locale, exact keyword/topic, linked article status and fingerprint, and
  deterministic tenant business fit.
- A zero-volume provider row is valid measured evidence. A missing row is
  recorded as missing and is never invented as zero.
- Search volume must be an actual finite nonnegative provider number. Null or
  malformed search volume is a missing receipt. Null CPC remains unknown and
  never clears an existing measured CPC; Google Ads competition is accepted
  only from numeric `competition_index / 100`, never the string level label.
- Null or malformed monthly trend entries are omitted. A literal numeric zero
  is retained as measured evidence.
- A completed demand receipt clears any prior derived expected-click audit so
  the existing SERP evidence backfill must recompute it from live evidence.

## Inspect safely

```sh
npx convex run expectedClickDemandBackfill:getStatusInternal '{"siteId":"SITE_ID"}' --prod --codegen disable
```

Confirm `enabled` and `activeRollout` are both true. Do not queue if today's
latest job is pending, running, partial, completed, or balance-unavailable.

## Queue the canary

Invoke the action, never the underlying `reserveAndQueue` mutation:

```sh
npx convex run actions/expectedClickDemandBackfill:queueExpectedClickDemandBackfill '{"siteId":"SITE_ID","policyVersion":1}' --prod --codegen disable
```

For a reviewed tenant, resolve the site ID from the private operator audit and
export it locally. Do not commit a production tenant ID or substitute another
tenant without a separate eligibility review:

```sh
PENTRA_SITE_ID='<reviewed-site-id>'
npx convex run actions/expectedClickDemandBackfill:queueExpectedClickDemandBackfill "{\"siteId\":\"$PENTRA_SITE_ID\",\"policyVersion\":1}" --prod --codegen disable
```

Safe no-spend outcomes include `rollout_ineligible`,
`no_eligible_legacy_topics`, `evidence_read_limit_exhausted`,
`daily_batch_exists`, `resume_required`, and a shared provider budget reason.

The status query reports only aggregate counts. It does not expose credentials,
wallet balance, raw provider responses, GSC rows, or keywords.

## Resume rules

If a partial job has no provider attempt, or already has a complete receipt,
resume that exact job:

```sh
npx convex run actions/expectedClickDemandBackfill:resumeExpectedClickDemandBackfill '{"siteId":"SITE_ID","jobId":"JOB_ID","policyVersion":1}' --prod --codegen disable
```

An unstarted request cannot resume after its original UTC reservation day. If
status reports `providerAttemptAmbiguous: true`, do not resume, queue another
version-1 batch for those keywords, or mutate the attempt markers. Review the
provider billing receipt before designing a separately versioned recovery.

## Feed the SERP evidence backfill

After a completed job reports `persistedTopics > 0`, inspect its status and the
topic inventory. On a later controlled batch, run the existing evidence-only
canary, which will now see the fresh locale-bound DataForSEO demand:

```sh
npx convex run actions/expectedClickEvidenceBackfill:queueExpectedClickEvidenceBackfill '{"siteId":"SITE_ID","policyVersion":1}' --prod --codegen disable
```

Do not run SERP evidence for a zero-volume or missing metric. The downstream
selector fails those rows closed without buying SERP or authority data.
