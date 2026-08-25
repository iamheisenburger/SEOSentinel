# Managed SES adapter data and retention policy

## Persisted state

The adapter DynamoDB table may contain only:

- opaque application operation keys and their SHA-256 digests;
- HMAC-derived SES tenant names and Pentra-owned sender addresses;
- generation, adapter version, lifecycle state and timestamps;
- send attempt state and an SES message-ID digest;
- aggregate warm-up/day counters;
- at most fourteen immutable warm-up day guards per resource;
- event ID/message ID digests and finite event types;
- immutable sender collision guards.

It must never contain a customer/user/site identifier, customer domain,
prospect address, sender display name, subject, body, reply alias, unsubscribe
URL, provider response body, AWS access key, HMAC secret or arbitrary error.

API Gateway data tracing is disabled. Lambda code catches exceptions and emits
only aggregate finite metrics. X-Ray must not be configured to capture request
or response bodies. EventBridge removes SES source/destination/header/detail
fields before SQS.

## Durations

- request nonces: 10-minute DynamoDB TTL;
- resource, send, event, disposition and release receipts: retained without
  DynamoDB TTL because they are the immutable resource/no-replay ledger;
- release-before-provision tombstones: retained without TTL so delayed create
  requests cannot resurrect deleted resources;
- daily pacing counters: 8-day DynamoDB TTL;
- distinct warm-up day guards: retained without TTL, capped at fourteen per
  resource because no additional guard affects the maximum daily tier;
- sanitized event queue: one day;
- sanitized event DLQ: 14 days;
- Lambda logs: 14 days;
- sender collision guards: retained without TTL so an old sender address is not
  silently reassigned to a different operation.

DynamoDB TTL is used only for replay nonces and aggregate day counters; it is
asynchronous and is not a deletion SLA. A scheduled bounded age/count
projection must alert on durable-ledger growth without returning row content.
Every hour a least-privilege Lambda calls only `DescribeTable`, emits the
approximate item count as `Pentra/ManagedSES/DurableLedgerItemCount`, and the
stack evaluates a two-hour window and alarms on a missing metric or a count
above 250,000. The count itself may lag because DynamoDB updates its approximate
table statistic less frequently; the hourly emission is the liveness heartbeat.
Investigation must use aggregate counts, never raw message or tenant data.

## Incident response

If request content or an untransformed SES event appears in logs or a queue:

1. disable the API stage and SES configuration-set event destination;
2. keep application `managed_ses` claims disabled;
3. preserve only aggregate counts needed for the incident record;
4. purge the affected log/queue under the approved incident process;
5. rotate the HMAC signing keys without changing the stable resource key;
6. require fresh signed canary receipts before reactivation.

If a send is `external_attempted` without a provider/event receipt, never retry
that operation. Quarantine it, wait for the bounded event path, and surface an
honest no-replay ambiguity. After the 72-hour event window, only the separate
purpose-key-signed owner/operator disposition may decrement the resource lock;
it persists the authorization receipt and never erases the attempt. A later SES
event is still accepted as `event_confirmed_after_disposition` without changing
the already-decremented resource count.
