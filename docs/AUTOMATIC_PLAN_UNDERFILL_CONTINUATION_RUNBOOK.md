# Automatic topic-plan underfill continuation

Pentra reserves one immutable **$2** provider envelope for an automatic topic
plan: at most two **$1** executions. Execution two is used by exactly one of:

- the existing retry for an explicit transient transport/provider failure; or
- one rotated continuation after execution one successfully persists only
  1-6 verified topics.

It can never be both. Zero topics, a deterministic failure, an ambiguous
worker lease, a prior retry, a stale UTC reservation day, manual/growth work,
or a conflicting continuation marker receives no continuation. Strict product
fit, exact demand, live SERP, expected-click evidence, tenant/plan rollout,
article capacity, and all account/fleet provider ceilings remain unchanged.
The first and continuation executions together can persist at most the
original ten-topic plan capacity.

## Normal autonomous path

After a successful automatic `topic_*` plan, the worker atomically moves the
same job from `running` to `pending` with `workerAttempts=1` before scheduling
the continuation. It does not insert a job or provider reservation. The second
pass rotates the discovery sequence, receives only the remaining ten-topic
capacity, and repeats the free $1 DataForSEO balance preflight immediately
before paid work.

The pending continuation is the only plan job that does not block article
selection from execution one's verified inventory. Due publication remains
first, followed by strict buffer fill/repair; once those proved topics are
consumed or the three-article buffer is safe, the same pending plan receives
the next bounded worker slot. Other plan jobs keep the ordinary tenant lock.

The continuation settles terminally on success or failure. A failed second
execution is still counted and cannot grant a third attempt. Any topics proved
by execution one remain available to the scheduler, which is re-entered after
the continuation settles. Because those first-execution topics deliberately
run before execution two, the claimed worker atomically rechecks current
account article headroom, entitlement, epoch, reservation, and UTC day after
the free wallet preflight and immediately before paid planning. If article
quota reached zero in the meantime, execution two stops terminally without a
provider call, new reservation, or restored attempt.

## Reviewed completed-plan bridge

Recovery version 1 exists only for a successful underfilled plan that reached
`done` before the autonomous continuation code was deployed. The bridge
requires all of the following atomically:

1. stored result count is 1-6 and its provider receipt proves worker execution
   1 under the exact $2 job reservation;
2. the job is an automatic `topic_*` plan with no growth, manual, or migration
   routing and has `workerAttempts=0`;
3. site/account entitlement, rollout epoch, and the unreleased same-tenant
   provider receipt are still current on the same UTC reservation day;
4. no pending/running tenant job and no newer plan exists; and
5. no continuation/recovery marker exists.

Run the inspect-only command first. It performs no write and must return
`eligible: true`, `applied: false`, `reason: "ready"`, worker execution 2, and
the expected remaining capacity:

```sh
PENTRA_SITE_ID='<reviewed-site-id>'
PENTRA_JOB_ID='<reviewed-underfilled-plan-job-id>'
npx convex run actions/underfilledPlanRecovery:recoverCompletedUnderfilledPlanContinuation "{\"siteId\":\"$PENTRA_SITE_ID\",\"jobId\":\"$PENTRA_JOB_ID\",\"recoveryVersion\":1,\"apply\":false}" --prod --codegen disable
```

Only after reviewing that output and confirming the provider balance, run:

```sh
npx convex run actions/underfilledPlanRecovery:recoverCompletedUnderfilledPlanContinuation "{\"siteId\":\"$PENTRA_SITE_ID\",\"jobId\":\"$PENTRA_JOB_ID\",\"recoveryVersion\":1,\"apply\":true}" --prod --codegen disable
```

The action performs the free provider-balance preflight before the atomic
apply. Repeating the apply command returns `already_applied`; it cannot create
a job, reserve money, or schedule execution three. Never call the underlying
`jobs:recoverCompletedUnderfilledPlanContinuation` mutation directly.

For a reviewed incident, verify the expected provider reservation in the
private operator audit. The mutation resolves it from the job and requires the
exact site, user, purpose, amount, creation timestamp, UTC day, and unreleased
state. The reservation ID is intentionally not accepted as a caller-supplied
override.
