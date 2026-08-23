# Authoritative plan-entitlement rollout

This migration closes the legacy gap between Clerk Billing and Pentra's
account-level execution fence. It must use each account's current Clerk Billing
subscription plus trusted Clerk server metadata. Never infer a plan from a
site's cached `planFeatures`, and never turn an unreadable account into Free.

The rollout deliberately starts legacy-open. Existing tenants keep their
current behavior while the fleet is read and reconciled. The strict gate is
enabled only after every current Clerk account has a fresh, completed Convex
receipt.

## 1. Deploy the receipt and reconciliation code

Deploy the schema, internal plan endpoints, paged reconciliation, and execution
fences with `PENTRA_REQUIRE_ACCOUNT_PLAN_RECEIPT` unset or `false`. Do not enable
the strict gate yet.

The operator environment needs `CLERK_SECRET_KEY`, `PENTRA_INTERNAL_SECRET`, and
the production Convex URL configuration. Do not print or paste their values into
logs, tickets, or shell history.

## 2. Dry-run the complete Clerk fleet

From the repository root:

```bash
node --env-file=.env.local --experimental-strip-types scripts/reconcile-clerk-plan-entitlements.ts
```

The script reads every Clerk user in stable creation order. For each user it
re-reads the live user Billing subscription and resolves trusted private/legacy
metadata through the same canonical plan resolver used by login and webhooks.
It outputs only aggregate tenant counts by tier and blocked reason. It does not
output user IDs, domains, email addresses, metadata, credentials, or feature
payloads, and dry-run performs no Convex writes.

Stop if any account is blocked or any Clerk page/subscription read fails. Fix or
explicitly migrate the affected Clerk metadata, then rerun the complete dry-run.
Do not default that account to Free.

Independently verify the current total in Clerk immediately before apply. Do not
reuse a count from an earlier runbook, audit, or deployment: the operator must
rerun the complete dry-run and use its freshly verified total. The command
intentionally does not hard-code a fleet size.

## 3. Apply with an exact fleet-size guard

Replace `N` with the freshly verified Clerk total:

```bash
node --env-file=.env.local --experimental-strip-types scripts/reconcile-clerk-plan-entitlements.ts --apply --confirm-authoritative-clerk-read --expected-total=N
```

Apply is unavailable without both explicit flags. Before its first write, the
script performs a second complete authoritative Clerk read and requires the
same exact account, tier, feature, and expected-total snapshot. It then sends
canonical per-account receipts sequentially to Pentra. After the writes it
reads the complete Clerk fleet a third time and requires the exact applied
snapshot to remain current. Duplicate receipts are idempotent; a completed
matching receipt refreshes its authoritative verification timestamp without
pausing sites or bumping the reconciliation version.

After writing, the script polls the PII-free paginated entitlement audit. Do not
continue unless its final JSON reports all of the following:

- `applied` equals the independently verified Clerk total.
- `audit.scanned` equals that same total, proving no stale non-Clerk receipt is
  still capable of passing the strict execution fence.
- `audit.verifiedCompleted` equals that same total.
- `audit.verifiedReconciling` is `0`.
- `strictGateReady` is `true`.

If the fleet changes or a call fails mid-run, leave the strict gate off and
rerun. Receipts already written are safe and idempotent. If `audit.scanned` is
larger than the Clerk total, do not blindly delete a receipt: investigate the
extra account as a privileged billing/deletion incident, establish whether it
is an incomplete account deletion or an ownership mismatch, complete that
workflow, and rerun the full three-pass migration.

## 4. Enable fail-closed execution

Only after the audited completion proof above, enable the Convex execution
gate:

```bash
npx convex env set PENTRA_REQUIRE_ACCOUNT_PLAN_RECEIPT true --prod
```

An account without a completed authoritative receipt now fails closed for paid
provider work, generation, publishing, outreach claims, growth jobs, and other
write paths. Read-only dashboards and preserved configuration remain available.
Parked sites explain that their site's plan allowance must be upgraded or an
active site removed.

Run a read-only owner/dashboard smoke check and verify that the account audit
still matches the Clerk total. Billing lifecycle webhooks and authenticated
plan sync keep new, upgraded, and downgraded accounts current after migration.

## 5. Keep billing and deletion receipts current

Configure Clerk to deliver the complete lifecycle set recognized by Pentra to
`/api/webhooks/clerk-billing`:

- `subscription.created`
- `subscription.updated`
- `subscription.active`
- `subscription.pastDue`
- `subscriptionItem.created`
- `subscriptionItem.updated`
- `subscriptionItem.active`
- `subscriptionItem.canceled`
- `subscriptionItem.upcoming`
- `subscriptionItem.ended`
- `subscriptionItem.abandoned`
- `subscriptionItem.incomplete`
- `subscriptionItem.pastDue`
- `subscriptionItem.freeTrialEnding`
- `user.deleted`

Production must have `CLERK_WEBHOOK_SIGNING_SECRET` configured before this
route is considered live. The Next.js route verifies the Clerk signature first,
then sends only the bounded account identifier and optional event identifier to
Convex through the authenticated internal bridge. A verified `user.deleted`
event atomically sets the account entitlement to `deleting` before the webhook
is acknowledged, revokes the first bounded credential page, and leaves the
remaining purge to the durable recovery workflow.

After deployment, send an invalid-signature smoke request and verify the route
returns `400` rather than `404`; do not include a real user identifier. Then use
Clerk's signed test-delivery facility for a non-destructive billing event and
confirm a `200` response. Do not enable the strict receipt gate until this
webhook contract and the aggregate current-fleet audit both pass.

## Rollback

If the post-switch smoke check finds a receipt rollout problem, restore service
without deleting or rewriting tenant data:

```bash
npx convex env set PENTRA_REQUIRE_ACCOUNT_PLAN_RECEIPT false --prod
```

Correct the authoritative Clerk data or reconciliation issue, repeat the
complete dry-run/apply/audit, and only then re-enable the strict gate. Never
delete entitlement receipts as a rollback and never manufacture a plan from a
site-local cache.
