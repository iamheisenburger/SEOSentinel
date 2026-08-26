# Pentra managed SES transport

This stack is the provider-side transport for Pentra's default managed outreach
path. A Pentra customer does **not** connect Gmail, buy a Workspace seat, give
Pentra AWS credentials, or configure DNS. Pentra configures one platform-owned
sending domain and one signed adapter; each customer receives a deterministic,
opaque SES tenant and a unique sender address on that domain.

This directory is deployable infrastructure, but its presence in source is not
an operational claim. Do not enable managed outreach until the application-side
`managed_ses` installer, signed event webhook, pacing receipt, suppression
settlement, reply relay, event canary, production IAM review, DNS receipts and
SES production-access receipt all pass on the exact released version.

## What is isolated per tenant

- an Amazon SES tenant with `TENANT` suppression scope for both bounce and
  complaint;
- a 128-bit HMAC-derived sender local part guarded by an immutable DynamoDB
  collision tombstone;
- a resource generation and opaque application operation key;
- a conservative adapter-side daily warm-up counter based on distinct days
  with settled sends—not mailbox age—and a 30-minute minimum send spacing, in
  addition to Pentra's application pacing;
- every send's durable external-attempt marker, exact sequence/parent binding,
  provider digest, RFC Message-ID digest and opaque thread receipt;
- an opaque HMAC message binding that prevents one operation key from adopting
  a receipt for different mail without persisting a raw content hash;
- bounce, complaint, delivery, delay, reject and send events correlated only by
  an opaque attempt tag.

SES permits one verified identity and configuration set to be associated with
multiple tenants while keeping tenant reputation and suppression separate. The
stack uses that native model; it never creates a customer-domain identity. See
the official [SES tenant guide](https://docs.aws.amazon.com/ses/latest/dg/tenants.html),
[tenant suppression guide](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list-tenant-level.html),
and [`SendEmail` tenant contract](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).

Provision/status reports `ready` only after a live provider read proves SES
production access and account sending are enabled, the platform identity is
verified with DKIM signing enabled and successful, the configuration set is
sending-enabled, its exact default-bus EventBridge destination is enabled for
every required event, and the
tenant has exactly the expected identity/configuration associations plus
tenant-level bounce/complaint suppression.

## Signed adapter protocol

All six API routes are `POST` and accept deterministic JSON with `version: 1`:

- `/v1/provision` — `{operationKey, generation, adapterVersion}`
- `/v1/status` — `{kind: "resource"|"send", operationKey, adapterVersion}`
- `/v1/send` — `{operationKey, resourceOperationKey, generation,
  adapterVersion, sequenceStep, purpose, toEmail, displayName, subject, text,
  replyTo, unsubscribeUrl, parent?}`. `parent` is forbidden at step zero and is
  exactly `{operationId, threadReceipt}` at every later step. `purpose` is
  `outreach`, per-resource `inbound_relay_canary`, or the one
  deployment-global bootstrap `rfc_message_id_canary`.
- `/v1/inbound-canary` — `{operationKey, resourceOperationKey, generation,
  adapterVersion, inboxBinding, classifications:["reply","stop"],
  relayConfigurationHash, retentionPolicyHash, verifiedAt, relayReceipt}`;
  accepted only for the matching controlled canary send and independently
  signed inbound-relay receipt
- `/v1/disposition` — `{operationKey, resourceOperationKey, generation,
  adapterVersion, decision: "quarantine_no_replay", authorizedAt,
  authorizationReceipt}`; this is accepted only after 72 hours and requires
  the independent disposition key
- `/v1/release` — `{operationKey, generation, adapterVersion}`

The caller sends:

```text
X-Pentra-Timestamp: <epoch seconds>
X-Pentra-Nonce: <32..96 character opaque nonce>
X-Pentra-Signature: HMAC-SHA256(secret,
  "v1\nPOST\n<path>\n<timestamp>\n<nonce>\n<SHA256(body)>")
```

Requests expire after five minutes and every nonce is atomically consumed for
ten minutes. Responses are deterministic JSON and carry a separate response
signature bound to the request nonce. The Secrets Manager document is:

```json
{
  "current": "at-least-32-random-characters",
  "next": "optional-next-signing-key",
  "signWith": "current",
  "resourceKey": "independent-stable-at-least-32-character-key"
}
```

The independently permissioned `DispositionSecretArn` and
`InboundCanarySecretArn` each contain separate random strings (or
`{"key":"..."}` documents) with at least 32 characters.
Rotate `current`/`next` using a dual-acceptance window. `resourceKey` and the
disposition and inbound-canary secrets are all distinct from each other and
from both request keys.
`resourceKey` is immutable for the lifetime of existing resources; replacing it
requires an explicit generation migration and release of all old resources.
The disposition signature is bound to the exact send/resource/generation,
fixed `quarantine_no_replay` decision and a five-minute authorization time.

A send/status receipt always returns `state`, `operationKey`,
`resourceOperationKey`, `generation`, `adapterVersion`, `sequenceStep`,
`purpose`, and `updatedAt`. Once provider identity is established it also
returns `providerMessageIdDigest`, `rfcMessageIdDigest`, and `threadReceipt`.
`quarantined_integrity` is terminal and returns `noReplay:true` plus
`code:"provider_receipt_mismatch"`; its established identity remains visible
for reconciliation, but it can never authorize a child.
When a bounce, complaint, rejection, or rendering failure is durably known,
send/status also returns
`terminalDeliveryEvent:{eventType,occurredAt,eventReceipt}`. This is the same
canonical receipt used by the signed event webhook, so a delayed webhook cannot
make generic `event_confirmed` look like successful delivery. A partial or
unknown terminal event object is never adoptable.

## Send no-replay boundary

Before calling SES, one DynamoDB transaction:

1. creates the immutable send operation in `external_attempted`;
2. increments the resource's unsettled external-attempt count and seals the
   latest attempt time;
3. consumes one tenant/day warm-up allowance.

The warm-up ledger creates at most fourteen immutable distinct-day guards per
resource. After the maximum 30/day tier is reached, settlement no longer adds
guards or increments the warm-up count.

If the SES response is lost, the same operation can never call `SendEmail`
again. The dedicated SES send client is configured for one total SDK attempt,
so botocore cannot turn a timeout into a second provider request inside the
same call. A privacy-reduced signed SES event bearing the same opaque attempt tag
may settle that ambiguity without replay after a two-minute response-settlement
grace. During that grace, an event retries from SQS so a conflicting synchronous
provider receipt is quarantined instead of allowing the event to win the race.
While any attempt is unsettled,
release fails closed. Provider rejection, successful submission, or a matching
SES event atomically settles the send and decrements that count. If no event
arrives, the attempt remains locked for at least 72 hours. Only the separately
signed reviewed disposition can then quarantine it without replay and preserve
the durable attempt/authorization receipt; a late event is still recorded
without a second decrement.

The adapter accepts one recipient and plain text only. It persists no recipient,
display name, subject, body, reply alias or unsubscribe URL. The raw message
includes `Reply-To`, `List-Unsubscribe`, and `List-Unsubscribe-Post`; SES assigns
its own `Message-ID`, as documented in [SES header behavior](https://docs.aws.amazon.com/ses/latest/dg/header-fields.html).

## Exact reply threading and inbound activation

Every root send requires `sequenceStep: 0` and no parent. Every follow-up must
name the exact preceding operation and its opaque thread receipt. Before the
child crosses the SES boundary, the adapter verifies the entire chain is on the
same resource, generation, adapter version and keyed recipient binding, with
strictly consecutive steps. It decrypts only the minimum ancestor RFC
Message-IDs and emits one `In-Reply-To` plus one root-to-parent `References`
header. CR/LF, multiple-header/list syntax, duplicates and oversized unfolded
headers are rejected. The existing durable marker still permits exactly one
`SendEmail` call per child operation.

Bounce, complaint, rejection, and rendering-failure events set a monotonic
terminal disposition on the exact send row. Parent validation rejects that
disposition, and the child-marker transaction rechecks the direct parent so an
out-of-order terminal event cannot race a child across the SES boundary. A
lost-response recovery seals provider identity and an adverse disposition in
the same DynamoDB transaction; there is no parent-eligible intermediate state.
A later delivery event never clears the terminal disposition.

The SES API/event identifier and the RFC header form have separate SHA-256
digests. The canonical RFC identifier is never stored plaintext: a retained,
rotating CMK encrypts it with exact operation/resource/generation/adapter/
recipient context. Only the adapter may decrypt; the event recovery Lambda may
encrypt but cannot decrypt. Public send/status receipts and signed events bind
`operationKey`, `resourceOperationKey`, generation, adapter version,
`sequenceStep`, purpose, both digests and the opaque thread receipt. Any
response/event disagreement quarantines the send without replay.

Normal outreach is fail-closed behind two distinct activations. First, exactly
one deployment-global `rfc_message_id_canary` send is allowed for the configured
opaque operation and SHA-256-bound controlled recipient. Only its exact SES
`delivered` event with a present, matching `commonHeaders.messageId` creates the
durable RFC marker. That marker is HMAC-bound to adapter version, configured
operation, recipient hash, suffix, provider digest, RFC digest, thread receipt,
and event key. It is verified from DynamoDB on every gated path; no environment
receipt or arbitrary 64-hex value can activate it. The global event settles
inside the adapter and is never sent to Pentra's per-tenant webhook.

After that global marker exists, every resource runs its own
`inbound_relay_canary` with an arbitrary fresh operation, the controlled
recipient, and a unique Reply-To alias. Its signed event uses the normal tenant
webhook. After Pentra's inbound webhook settles bodyless controlled `reply` and
`stop` classifications, it calls `/v1/inbound-canary` with a separate
purpose-key HMAC bound to adapter version, resource/generation/operation/keyed inbox, current
relay-configuration hash, retention-policy hash and time. The adapter stores
and returns only those opaque bindings plus its own activation receipt. A
resource must have a receipt no older than 30 days, and application readiness
must compare both hashes to the current inbound runtime configuration.

## Privacy-reduced event path

SES publishes only this configuration set to EventBridge. An EventBridge input
transformer removes source, destination, subject and provider detail before
SQS. One mutually exclusive rule extracts only `commonHeaders.messageId`; a
second valid-JSON route handles its absence. Absence retries until the explicit
canary invariant is active, after which the configured exact suffix may derive
the canonical form. A present but mismatched common header quarantines the
send. The queue otherwise receives only event type/id/time, the two message-ID
forms and the opaque Pentra attempt tag. The Lambda converts both identifiers
to digests, deduplicates the semantic event, and posts a signed bounded receipt
to Pentra only for `outreach` and `inbound_relay_canary`. A generic HTTP 2xx is insufficient: Pentra must return the exact
`{version:1, ok:true, eventReceipt}` body with a valid response signature bound
to the event nonce before SQS may delete the event.

EventBridge documents SES service events as best-effort. Therefore Pentra must
not call the transport ready merely because provisioning succeeded. Production
readiness requires a current signed send/delivery-event canary and healthy queue,
DLQ and webhook receipts. See the official [SES EventBridge schema](https://docs.aws.amazon.com/ses/latest/dg/monitoring-eventbridge.html).

## Delete-wins release

Release on an operation that has not yet created a resource atomically seals a
permanent released tombstone. A reordered or delayed provision with that exact
operation/generation can therefore never materialize after release.

Provisioning holds a 90-second external-call lease and records its exact
provider-boundary time. Release cannot cross while that lease, the 15-minute
provision ambiguity horizon, or an unsettled send exists. It then removes the
tenant's exact persisted shared-resource associations and tenant, waits another
120 seconds, and requires a second exact `GetTenant` not-found inspection
before sealing the resource released. This second pass prevents a timed-out
late `CreateTenant` from materializing after the first delete. Live resources,
send attempts, events, release receipts and immutable sender collision guards
have no TTL.

`managed-ses-v1`, the stack namespace, sender domain (`mail.pentra.dev`) and
reply domain (`reply.pentra.dev`) are CloudFormation allowlisted constants.
They are resource-contract identifiers, not build numbers. An incompatible v2
must deploy beside v1 with its own endpoint/table/event destination while v1
continues serving status, late events and release for every v1 resource.

## Platform DNS and AWS prerequisites

These are one-time Pentra platform operations, not customer setup:

1. Use a dedicated reviewed AWS account and `us-east-1`; inventory every SES
   identity, configuration set, tenant, quota and existing workload before
   acknowledging the deployment parameter.
2. Create the request HMAC, disposition and inbound-canary secrets out of band
   with distinct key material. Never put their content in parameters, source,
   logs, shell history or CloudFormation outputs.
3. Deploy first with no application `managed_ses` activation. Add the three
   emitted Easy-DKIM CNAME records to the Pentra-controlled sender domain.
4. Confirm the alarm-topic email subscription, then verify SES identity/DKIM,
   production access, sending enabled, configuration event destination, tenant
   APIs, $25 SES budget notifications, both Lambda alarms, API 5xx,
   EventBridge failed invocations, durable-ledger growth, queue age and empty
   DLQ. Alarm messages contain aggregate metadata only; the SNS topic is left
   unencrypted because the AWS-managed SNS key cannot authorize CloudWatch
   publishers and this stack does not introduce a separate CMK lifecycle.
5. Deploy and verify the separate receiving-only reply relay. Its Lambda roles
   must continue to have no `ses:Send*` authority.
6. Configure the exact global opaque RFC-canary operation, hash of the
   controlled recipient, and canary-observed suffix (empty or
   `@email.amazonses.com`). Run that one `rfc_message_id_canary`. Its exact
   delivered common-header event must create the verified DynamoDB marker;
   there is no environment receipt and no Pentra tenant webhook row for it.
7. For every managed resource, run a fresh `inbound_relay_canary`. Drive
   bodyless controlled reply and STOP settlements through its unique alias,
   then submit `/v1/inbound-canary` with current relay and retention hashes.
   Only after both the global marker and current per-resource activation exist
   may the application reconciler install normal `managed_ses` outreach.

The template creates the platform identity but cannot make DKIM valid without
the DNS records. It also cannot grant SES production access or prove the
separately deployed inbound relay healthy. Those remain explicit release
receipts, never inferred readiness.

## Operator bootstrap

`bootstrap.py` makes the one-time account work reproducible without turning a
source review into a deployment. Its default command is a credential-free-of-
Pentra, read-only AWS inventory that prints counts and statuses only:

```sh
python3 infra/outreach-managed-ses/bootstrap.py inventory
```

The `deploy` command refuses any region other than `us-east-1`, requires the
exact authenticated account id plus an explicit dedicated-account
acknowledgement, creates three purpose-separated Secrets Manager documents
without putting key material in argv or output, then runs the reviewed SAM
build/deploy. It does **not** request SES production access, change DNS, send a
canary, or enable application delivery. The alert address, webhook URL,
controlled-recipient SHA-256 and stable opaque canary operation key are all
required explicitly; use `--help` for the exact flags.

## Local verification

No AWS credentials or network calls are needed:

```sh
python3 -m py_compile infra/outreach-managed-ses/src/*.py
python3 -m unittest discover -s infra/outreach-managed-ses/tests -v
```

With a current SAM CLI, additionally run `sam validate --lint` and `sam build`
against this template. Do not run `sam deploy`, create DNS, request SES
production access, send a canary, or call a provider as part of source review.

## Application integration that still must land

This infrastructure intentionally does not patch Convex. The audited app merge
must add all of the following before release:

- provider-discriminated canonical inbox provenance bound to operation,
  generation, adapter version and transport kind;
- unique `fromEmail` tenant ownership while allowing the shared Pentra sender
  domain;
- pacing keys bound to transport/account/tenant/mailbox rather than global
  sender-domain ownership;
- signed provision/status/send/inbound-canary/disposition/release request and response
  verification, including the purpose-separated disposition authority;
- external-attempt/no-replay settlement and event dedupe;
- delivery/bounce/complaint suppression plus signed human-reply relay;
- current event-canary readiness parallel to Gmail's DSN receipt;
- atomic quarantine and sequence cancellation before mode/domain/owner/delete
  release, with release delayed through every ambiguous send;
- tenant deletion tombstones and bounded paginated cleanup.

Until those conditions are implemented and production-proven, Gmail remains
the only current canonical transport and this adapter remains disabled.
