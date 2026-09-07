# September 7 sealed-delivery worker isolation

## Production failure and local reproduction

Pentra had three sealed ready articles at its September 7 11:45:12.262 UTC
deadline. The scheduler queued publication job
`j97dwa4hr480hapgeq8n5172d58dyr4j` at 11:45:13.418, targeting sealed article
`j571r4bvpd7fydzxcz7ey5cs3h8dxnxb`. The job was still pending at the
11:47:59.616 observation and the next inspection around 11:52.
The bounded 11:56:31.856 production snapshot confirmed the exact deadline run
`kd7d8feh9t1jwj9w6wtm3f0rj58dx3td` ended as `claim_lost`; the publication
remained pending after the background review finished.

The unrelated buffered quality-review job
`j97bna0hgdf4fy8qcjefv56t0n8dyan9` was running at the deadline. It targeted
draft `j579j19sftmhs4p5xqyqj0ja1n8dyew1`, with `qualityRetry: true` and
`bufferFill: true`. It completed at 11:48:29.755 without passing the seal.
That rejection must not block delivery of a different already-sealed article.

Although scheduler ordering prioritized delivery correctly, `claimPending`
rejected every job while any authorized same-site job was running. Tests
executing the actual registered handler reproduced the rejection with two
tenant fixtures. This was an execution-lock defect, not a reason to relax the
quality gate or change the publication clock.

## Narrow concurrency contract

Both atomic claim entry points now use the same conflict check. Only an exact
`publishOnly` + `bufferDelivery` job for a current-domain sealed ready article
may claim alongside a background worker. Each concurrent worker must be one of:

- A buffer-only or manual article generation/review with a known disjoint
  article or topic target. These branches do not publish.
- A topic-planning job with no reference to the publication's article/topic.
- A links-only job targeting a different current-domain article/topic.

Same-artifact work, direct-publishing generation/review, another publisher,
unknown workers/targets, foreign or stale artifacts, and ambiguous flags remain
serialized. An incoming background job still waits; paid generation concurrency
is not expanded. Every running worker is checked, not merely the first one.

The pending-to-running transition, worker token and automatic recovery wake
remain atomic. The publisher still requires its existing site/destination
lease, exact content/configuration seal, current entitlement and rollout epoch.
No quality score, audit requirement, retry budget or provider allowance changes.
No prospect outreach is performed.

## Verification

Eight regression tests exercise both real claim handlers across the two tenant
fixtures, supported background branches, duplicate claims, conflicting work,
invalid seals/configurations and retry timing. The original due-delivery case
failed before the repair and passes afterward.

- All 1,397 repository tests passed.
- Type-check, production build and additive schema check passed.
- Lint: zero errors, unchanged 157 existing warnings.
- Production dependency audit: zero vulnerabilities.
- Public browser acceptance: ten passed, two authenticated checks explicitly
  skipped, not counted as customer acceptance.
- Secret scan and final deployment status are recorded at release time.

These local fixtures alone do not establish uninterrupted production cadence or
successful replenishment. Historical late deliveries remain late; no timestamp,
attempt receipt, cadence configuration or failure record is rewritten.
