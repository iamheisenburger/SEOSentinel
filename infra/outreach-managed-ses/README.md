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
- every send's durable external-attempt marker and provider receipt;
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

All five API routes are `POST` and accept deterministic JSON with `version: 1`:

- `/v1/provision` — `{operationKey, generation, adapterVersion}`
- `/v1/status` — `{kind: "resource"|"send", operationKey, adapterVersion}`
- `/v1/send` — `{operationKey, resourceOperationKey, generation,
  adapterVersion, toEmail, displayName, subject, text, replyTo,
  unsubscribeUrl}`
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

The independently permissioned `DispositionSecretArn` contains a separate
random string (or `{"key":"..."}` document) with at least 32 characters.
Rotate `current`/`next` using a dual-acceptance window. `resourceKey` and the
disposition secret are distinct from each other and from both request keys.
`resourceKey` is immutable for the lifetime of existing resources; replacing it
requires an explicit generation migration and release of all old resources.
The disposition signature is bound to the exact send/resource/generation,
fixed `quarantine_no_replay` decision and a five-minute authorization time.

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

## Privacy-reduced event path

SES publishes only this configuration set to EventBridge. An EventBridge input
transformer removes source, destination, headers, subject and provider detail
before SQS. The queue receives only event type/id/time, SES message ID and the
opaque Pentra attempt tag. The Lambda converts the provider message ID to a
digest, deduplicates the semantic event, and posts a signed bounded receipt to
Pentra. A generic HTTP 2xx is insufficient: Pentra must return the exact
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
2. Create the HMAC secret out of band. Never put its content in parameters,
   source, logs, shell history or CloudFormation outputs.
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
6. Run one non-prospect event canary through the exact application/provider
   generation. Only then permit the application reconciler to install the
   canonical `managed_ses` transport receipt.

The template creates the platform identity but cannot make DKIM valid without
the DNS records. It also cannot grant SES production access or resurrect the
currently rolled-back inbound relay stack. Those remain explicit release
receipts, never inferred readiness.

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
- signed provision/status/send/disposition/release request and response
  verification, including the purpose-separated disposition authority;
- external-attempt/no-replay settlement and event dedupe;
- delivery/bounce/complaint suppression plus signed human-reply relay;
- current event-canary readiness parallel to Gmail's DSN receipt;
- atomic quarantine and sequence cancellation before mode/domain/owner/delete
  release, with release delayed through every ambiguous send;
- tenant deletion tombstones and bounded paginated cleanup.

Until those conditions are implemented and production-proven, Gmail remains
the only current canonical transport and this adapter remains disabled.
