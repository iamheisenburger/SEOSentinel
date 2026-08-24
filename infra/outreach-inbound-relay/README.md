# Pentra receiving-only AWS SES relay

This SAM stack implements the provider side of Pentra's signed inbound relay.
It can receive and normalize mail but has no permission or code path to send
email. It is tenant-generic: Pentra's independently random per-message reply
alias binds the event to the correct tenant only after the signed webhook
reaches Convex.

Do not deploy this stack in a tenant's website or sender domain. Use a dedicated
relay subdomain/domain whose MX can point exclusively at SES classic inbound in
`us-east-1`. An existing AWS account is supported only when an operator has
inventoried every region and confirmed that the account has no other SES
sending or receiving workload. Unrelated non-SES workloads may remain. The
explicit `NoOtherSesWorkloadsAcknowledged=true` parameter is required at
deployment.

## Data flow and security boundary

1. SES requires TLS and scans every message for spam and malware.
2. A synchronous `RequestResponse` Lambda runs before storage. It accepts one
   and only one envelope recipient matching either
   `reply-<32..64 random token>@<relay-domain>` or
   `dsn-<32..64 random token>@<relay-domain>`.
3. The guard requires spam and virus `PASS`, plus SES `DMARC PASS` or SES
   aligned `DKIM PASS`. Bare SPF never qualifies. AWS documents DKIM `GRAY` as
   unsigned or From/signing-domain mismatch, so only its `PASS` state is used.
4. DynamoDB atomically enforces 10 accepted messages per alias per hour and 60
   per trusted SES source IP per minute. Keys are SHA-256 digests. Duplicate SES
   receipt invocations reuse one proof and do not consume the rate twice.
5. Only admitted MIME reaches the private, unversioned SSE-S3 bucket. Its S3
   notification places an object pointer, never content, on encrypted SQS.
6. The parser fetches the object and short-lived proof, enforces a 10 MiB raw
   limit, 100 MIME parts, depth 12, 512 KiB decoded text, 50,000 characters and
   a deterministic 64 KiB webhook maximum. Attachments are never decoded. A
   metadata-less second text body outside `multipart/alternative` is ambiguous
   and fails closed instead of being mistaken for body text.
7. Human mail is valid only on `reply-*`. Mail on `dsn-*` must be a real
   `multipart/report; report-type=delivery-status` with exactly one permanent
   failed `message/delivery-status` recipient and exactly one returned-message
   header set containing both `<pentra.<token>@sender.example>` and the exact
   original `reply-*` alias. The normalized recipient is that recovered reply
   alias. The signed DSN object also contains only the SHA-256 digest of the
   actual incoming `dsn-*` envelope target, allowing Pentra to compare it with
   the current inbox capability without exposing that target to logs or using
   it as a tenant selector. Ordinary forwarding, body phrases and ambiguous reports fail closed.
8. Exact deterministic bytes are HMAC-SHA256 signed and posted to Pentra. A 2xx
   deletes raw/proof state. `425` honors `Retry-After`; redirects and 5xx retry
   with bounded backoff and one stable event ID. Other 4xx delete as terminal.
9. A five-minute sweeper purges raw/proof state at five hours forty-five
   minutes, leaving ten minutes of normal scheduling headroom before the
   six-hour privacy boundary. S3's one-day lifecycle is an independent
   backstop. The DLQ contains pointers only.

The authoritative application-side request format and canary gates remain in
`docs/OUTREACH_INBOUND_RELAY_RUNBOOK.md`.

## External prerequisites and approvals

The stack does not purchase a domain, change DNS, create a mailbox, configure
Google Workspace, activate a receipt rule set or send a canary. Each is a
separate reviewed owner/operator action.

- An AWS account with no other SES workload in any region. Before acknowledging
  the deployment parameter, inventory SES sending, identities, configuration
  sets and receipt rule sets account-wide and review recent SES cost. SES
  classic receipt charges cannot be cost-tagged, so the service-filtered budget
  covers all `Amazon Simple Email Service` spend in the account, including
  inbound message/chunk charges. Do not acknowledge the parameter if any other
  SES workload exists or is planned. Unrelated non-SES workloads do not affect
  this gate.
- A dedicated relay domain with verified SES receipt identity in `us-east-1`.
- One globally unique, unused S3 bucket name.
- A Pentra production webhook ending in `/webhooks/outreach-inbound`.
- A Secrets Manager secret created out of band. Its `SecretString` is JSON:

  ```json
  {"current":"at-least-32-random-characters","signWith":"current"}
  ```

  During rotation, first add `next` and change `signWith` to `next` only after
  Pentra accepts both values. Promote later by moving that value to `current`
  and removing `next`. Never place either value in parameters, source, shell
  history, CloudFormation outputs or logs. Tag the secret itself with
  `PentraComponent=inbound-relay` so its cost is included in the tagged budget.
- An alert email that will confirm the SNS subscription and receive AWS Budget
  notifications.
- The `PentraComponent` cost-allocation tag activated in Billing before the
  tagged infrastructure budget is used for diagnostics. Cost-allocation
  activation can lag, and that filtered budget does not include untaggable SES
  receipt charges. The SES-service budget is authoritative for SES spend; the
  no-other-SES assertion is what makes those charges attributable to this
  relay. AWS Budgets alerts are not a real-time hard cap.

## Human reply and Workspace DSN routes

These are intentionally different routes:

- Pentra sends every approved outreach message with a unique
  `Reply-To: reply-<per-message-token>@<relay-domain>`. A human's ordinary reply
  reaches that exact envelope alias directly through the relay MX.
- For each dedicated send-only Workspace mailbox, copy Pentra's owner-only,
  HMAC-derived `dsn-<per-inbox-token>@<relay-domain>` target. The Workspace admin routing
  rule must add that target only for delivery-status notifications received by
  that mailbox, preserving the original `multipart/report` and returned-message
  part. A user-level forward that wraps or rewrites the DSN is not equivalent.

The DSN alias is only an authenticated intake channel. It never selects a
tenant or message. The parser signs its digest, then recovers the original
`reply-*` alias and exact Pentra Message-ID from the returned-message part;
Convex performs the final target, tenant, recipient, canary, replay, timestamp
and rollout checks. The target remains stable across same-mailbox reconnects,
profile edits, plan parking and relay signing-secret rotation. A changed
mailbox or explicit owner rotation advances its non-secret generation.

## Pre-deployment validation

From the repository root:

```sh
python3 -m unittest discover -s infra/outreach-inbound-relay/tests -v
python3 -m py_compile infra/outreach-inbound-relay/src/*.py
npm test
npx tsc --noEmit
```

With the AWS SAM CLI installed, additionally run:

```sh
sam validate --lint --template-file infra/outreach-inbound-relay/template.yaml
sam build --template-file infra/outreach-inbound-relay/template.yaml
```

Review the generated CloudFormation change set. The receipt rule defaults to
disabled. The stack deliberately does not activate its rule set because SES has
one active rule set per region and replacing it without reviewing existing
rules can drop mail.

The stack deliberately does not reserve function concurrency. AWS accounts
with a regional concurrency quota of 10 must leave all 10 executions unreserved,
so any function-level reservation makes the stack undeployable. Work remains
bounded without reservations: the parser's SQS event source has batch size 1
and maximum concurrency 2; the sweeper has one five-minute schedule and a
60-second timeout; and the synchronous guard atomically enforces its DynamoDB
alias and trusted-source rate limits. Confirm the account has enough unreserved
capacity for the receiving path, because a throttled guard fails closed.

## Release sequence

1. Review `RETENTION_POLICY.md` and calculate its SHA-256 digest. Configure the
   same digest and adapter version in both the SAM parameters and Pentra.
2. Confirm the HMAC secret is present in Secrets Manager and Pentra without
   printing it. Keep the receipt rule disabled.
3. Inventory every region and confirm the account has no other SES sending or
   receiving workload, then deploy the reviewed change set in `us-east-1` with
   `NoOtherSesWorkloadsAcknowledged=true`. Confirm the SES-service-filtered $5
   monthly budget exists, its 40% notification represents $2, its 100%
   notification is the $5 cap-review, and the alert subscription is confirmed.
   Confirm the second tagged budget exists only as an infrastructure diagnostic.
4. Verify bucket versioning is `Disabled`, default encryption is `AES256`, all
   public-access blocks are enabled, queue/DLQ retention is six hours/one day,
   and no Lambda role contains `ses:Send*`, `ses:SendBounce`, SMTP or IAM-write
   authority.
5. Inventory the account's current active SES rule set. Merge any required
   existing rules before explicitly activating this stack's rule set. Then
   enable only this exact receipt rule.
6. Add the dedicated relay-domain MX record only after all prior checks pass.
7. Send non-production fixtures through the relay and verify aggregate metrics,
   deterministic replay, `425` retry and raw deletion. Do not use a prospect.
8. Configure one Workspace DSN rule as described above. Owner-trigger Pentra's
   fixed reject-address canary. Gmail acceptance is insufficient; require the
   exact signed structured DSN seal in Pentra.
9. Repeat the DSN rule and owner canary per admitted outreach inbox. Keep all
   prospect sends blocked for any inbox without its current seal.

At the authoritative SES-service $5 notification, review and disable the
receipt rule while investigating unexpected usage. The template cannot impose
a reliable automatic monetary hard stop because AWS cost data and Budget
notifications are delayed. If any other SES workload is later introduced,
move this relay to an SES-isolated account before enabling its receipt rule.

## Retention audit and recovery

Audit with counts and ages only. Never fetch or print object bodies, DDB
`recipient` values, SQS bodies, MIME headers or signed webhook bodies. Confirm:

- no `raw/` object is older than six hours;
- the parser queue has no item older than 30 minutes;
- the DLQ is empty;
- expired DynamoDB rows are absent after the next five-minute sweep;
- the sweeper age/heartbeat and Lambda-error alarms are both healthy;
- CloudWatch logs contain only the aggregate schema described in the policy;
- the one-day lifecycle rule remains enabled.

If the parser or endpoint is unhealthy, disable the receipt rule first. Preserve
the queue for bounded retry, fix the fault, and re-enable only while every raw
object remains inside six hours. If that window expires, allow the sweeper to
delete raw state and re-run the owner canary. Never extend raw retention to
recover an event.

To retire the adapter, disable the receipt rule, remove the relay MX, wait for
the scheduled purge window, confirm bucket/queues are empty by count,
deactivate the rule set only after reviewing other SES rules, and then delete
the stack. Secret deletion and domain cancellation are separate owner-reviewed
actions.
