# Expected-click plan migration runbook

This is a one-shot, operator-only compatibility bridge for a reviewed tenant
whose legacy plan history blocks the expected-click rollout. It is not a
general customer or scheduler entrypoint.

## Production command

Run this only after the matching backend has been deployed and the target site
has been reviewed:

```sh
npx convex run actions/expectedClickMigration:queueExpectedClickPlanMigration '{"siteId":"<site-id>","migrationVersion":1}' --prod --codegen disable
```

The exported function is an `internalAction`. Convex's authenticated CLI can
run internal functions, while normal application clients cannot call it. The
module path is `actions/expectedClickMigration`; there is no
`jobs:queueExpectedClickPlanMigration` export.

Do not invoke
`jobs:queueExpectedClickPlanMigrationAfterPreflight` directly. That internal
mutation is deliberately callable only by the action after the free provider
account-balance preflight succeeds.

## Funding and rollback contract

1. The action checks the migration version and calls DataForSEO's free account
   endpoint for the immediately executing $1 provider ceiling before any
   database mutation. Pentra's separate atomic ledger still reserves the full
   $2 initial-plus-retry envelope.
2. If that first preflight fails, no job, provider reservation, or site marker
   is created.
3. After the atomic reservation and marker mutation, the worker repeats the
   free preflight immediately before paid work.
4. If the worker's first preflight fails, it releases the untouched shared
   reservation, clears the migration marker bound to that exact job, and keeps
   a failed audit row. The migration can then be retried after the provider
   account is funded and its short fleet cooldown expires.
5. Once provider work may have started, the reservation is not released and
   the one-shot marker is not rolled back because spend is ambiguous.

## Reviewed zero-insert recovery

The historical-topic dedupe incident has one separately versioned recovery.
It is not a general terminal-plan retry. The action accepts only the exact
failed migration job, its exact terminal error, its still-active $2 receipt,
and the same UTC reservation day. It free-preflights the remaining $1 worker
execution, atomically records recovery version 1, consumes `workerAttempts=1`,
and schedules that exact job once. Repeating the command is idempotent and can
never create a job, reservation, or third execution.

After resolving the reviewed IDs from the private operator audit, export them
locally. Do not commit production identifiers or substitute another terminal
job:

```sh
PENTRA_SITE_ID='<reviewed-site-id>'
PENTRA_JOB_ID='<reviewed-terminal-job-id>'
npx convex run actions/expectedClickMigration:recoverExpectedClickPlanMigration "{\"siteId\":\"$PENTRA_SITE_ID\",\"jobId\":\"$PENTRA_JOB_ID\",\"migrationVersion\":1,\"recoveryVersion\":1}" --prod --codegen disable
```

If the free provider-balance check fails, the recovery mutation is never
called and the version marker and retry slot remain untouched.
