# Pentra signed inbound outreach relay

## Release boundary

Pentra uses each tenant's own dedicated secondary-domain Gmail mailbox. Manual
mode remains distinct: a prospect message is released only after an owner
approves and triggers that one message. When the separately audited
authority-autopilot release is enabled, the tenant owner's exact current,
versioned tenant-level consent can instead authorize one verified initial
outreach email and at most two timed follow-ups in the same provider thread for
each eligible opportunity. Remaining steps are cancelled after a reply,
exact-recipient STOP, hard bounce, verified link acquisition, tenant parking,
consent withdrawal or sender-configuration change. Tenants never share an outbound
identity or sending-domain reputation. New OAuth connections request
`gmail.send`, `openid`, and `email`; they do not request mailbox-read access.
The receiving adapter has no outbound-email capability and the webhook cannot
call any send path.

A syntactically valid relay domain and HMAC secret do **not** release outreach. Every send-only inbox stays blocked until an owner explicitly sends Pentra's fixed-recipient hard-bounce canary through that exact Gmail connection and the current receiving adapter returns the exact signed structured DSN. The resulting seal binds:

- tenant, site, inbox and inbox configuration version;
- site rollout/plan epoch and authenticated sender domain;
- relay domain, HMAC-secret set, adapter version and retention-policy digest; and
- the current per-inbox DSN-target generation and digest of the actual `dsn-*`
  envelope target observed by the adapter; and
- a real Gmail-origin hard DSN containing the independently random canary Message-ID and exact controlled rejection recipient.

The seal expires after 30 days. A reconnect, sender/profile/domain change, site epoch change, adapter/retention change, or relay-signing-secret rotation invalidates it. These changes do not rotate the Workspace target for the same mailbox. A changed mailbox, explicit owner target rotation, relay-domain change, or dedicated target-secret rotation does rotate that target. The delivery claim rechecks every fence atomically before any prospect send.

## Why Reply-To is not bounce routing

`Reply-To` routes human replies. SMTP delivery-status notifications are sent to the SMTP envelope sender/Return-Path. Gmail API `users.messages.send` accepts RFC 2822 MIME but does not expose a per-message SMTP envelope sender, so a per-message Reply-To alias cannot receive Gmail hard bounces by itself.

Before enablement, a Google Workspace administrator must configure a narrowly scoped routing/forwarding rule for delivery-status notifications received by each dedicated outreach sender mailbox. That rule must deliver the DSN to the receiving-only adapter. The adapter must parse the real `message/delivery-status` part and the returned/original message headers, recover the original Pentra `Reply-To` alias and Message-ID, and then submit the normalized signed event. A different outbound transport is acceptable only if it provides equivalent per-message envelope-sender or authenticated delivery webhook proof.

Do not claim automated bounce handling and do not release send-only outreach until this route passes the product's real canary.

## Owner-only external prerequisites

1. A stable dedicated inbound relay domain, separate from tenant website, transactional-mail, and sender domains.
2. Wildcard MX receipt for exact `reply-*` human-reply aliases and `dsn-*` Workspace delivery-status aliases in a receiving-only provider/worker with no Gmail, SMTP, Mailgun-send, Resend-send, or equivalent outbound credential.
3. The Google Workspace DSN routing rule described above for every outreach mailbox admitted to send-only mode.
4. A fixed, operator-controlled recipient address that reliably produces a permanent structured `5.x.x` DSN. It is configured server-side; owners cannot supply or change the canary recipient.
5. A randomly generated HMAC secret of at least 32 characters, installed without printing it in logs.
6. A separate randomly generated DSN-target derivation secret of at least 32
   characters. It must not be the relay signing secret.
7. A versioned adapter release and a SHA-256 digest of its reviewed retention policy.
8. A provider/worker privacy audit proving either no raw MIME persistence or a documented minimal TTL, purge procedure, and DPA. Attachments must be discarded after bounded parsing; request/retry/dead-letter logs must redact raw payloads, headers, aliases and addresses. Audit the actual production provider's retention, attachment disposal, log redaction and purge behavior end to end.
9. Provider-side limits no looser than 64 KiB per normalized event, 10 accepted events per alias per hour, and 60 accepted events per source IP per minute. Bound MIME depth, decompressed bytes, attachment bytes and parse time before the webhook.
10. A production-domain signed adapter canary covering MX receipt, aligned SPF/DKIM/DMARC assertion, Reply-To and Message-ID preservation, structured DSN extraction, replay, 425 retry and retention controls.

Do not point a tenant primary or sender-domain MX record at the relay.

## Required configuration

All fields below are required. Missing or invalid fields make the relay unavailable and all new send-only prospect sends fail closed.

```text
OUTREACH_INBOUND_RELAY_DOMAIN=inbound.example.net
OUTREACH_INBOUND_RELAY_SECRET=<at-least-32-random-characters>
OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET=<independent-at-least-32-random-characters>
OUTREACH_INBOUND_RELAY_ADAPTER_VERSION=relay-adapter-2026.08.23
OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH=<64-lowercase-hex-sha256>
OUTREACH_INBOUND_RELAY_RETENTION_AUDITED=true
OUTREACH_INBOUND_RELAY_CANARY_RECIPIENT=<fixed-controlled-permanent-reject-address>
OUTREACH_AUTONOMOUS_DELIVERY_ENABLED=false
```

Optional HMAC rotation overlap:

```text
OUTREACH_INBOUND_RELAY_SECRET_NEXT=<next-at-least-32-random-characters>
```

`OUTREACH_INBOUND_RELAY_RETENTION_AUDITED=true` is an operator assertion backed by the completed external audit and retained evidence; it is not a substitute for that audit. Configuration creates no fleet-wide admission. Each inbox still needs its current durable DSN seal.

## Authority-autopilot release (disabled by default)

`OUTREACH_AUTONOMOUS_DELIVERY_ENABLED=true` exposes the owner opt-in and allows
the internal fleet to release at most one due consent-authorized sequence
message per tenant per pass. It does not make an inbox eligible by itself. The current
tenant owner must accept the exact versioned policy for the current inbox and
sender-profile configuration, choose a cap of 1–30 messages per UTC day, have
an executing growth rollout, and pass the current hard-DSN canary. Each claim
then rechecks live SPF/DKIM/DMARC, the public opportunity and contact evidence,
suppression, warm-up, 30-minute spacing, daily cap, plan/lifecycle state and the
exact consent receipt before Gmail is called. A verified accepted initial
receipt schedules step one four days later; a verified accepted step-one
receipt schedules the final step five days later. Delays are measured from the
actual predecessor receipt and can only stretch the sequence. Every follow-up
must use the exact Gmail thread and RFC Message-ID chain from its immediate
predecessor. A reply, exact-recipient STOP, structured hard bounce, rejected
opportunity or verified live backlink cancels the remaining sequence. Manual
owner-approved messages remain a separate mode and are not released under
autonomous consent.

Disabling authority autopilot immediately blocks new delivery claims. It does
not erase an external provider attempt that was atomically claimed before the
disable transition: that exact attempt may settle once as accepted, failed or
delivery-unverified so Pentra records reality, but disablement cannot create a
retry, replacement or later sequence step.

Keep this flag **false** until all of the following external gates have retained
evidence:

1. Independent legal review has approved the launch jurisdictions and a
   recipient-classification policy. A public business email is not by itself
   proof of consent or a lawful basis, and Pentra cannot infer whether every
   mailbox belongs to a corporate or individual subscriber.
2. The tenant has confirmed its intended use is permitted by its mailbox
   provider's current terms. A low software cap is not provider authorization.
3. Postmaster/complaint monitoring and an operator suspension threshold exist
   for the tenant's own sending domain. Gmail does not provide a universal
   per-message complaint webhook at this volume, so reply/bounce/STOP handling
   is not a substitute for reputation monitoring.
4. An independent security review and a staged real-provider end-to-end test
   have covered opt-in, disable races, DNS loss, stale evidence, reply, STOP,
   hard bounce, the two-follow-up boundary and cancellation interleavings,
   link acquisition, token expiry and ambiguous Gmail outcomes.

There is deliberately no claim that a send, response, backlink, ranking or
revenue result is guaranteed. The code can guarantee only the authorization,
evidence, pacing and fail-closed boundaries it controls.

## Owner-triggered DSN canary

1. Connect/reconnect the secondary-domain Gmail mailbox with the strict send-only grant.
2. Complete sender name, physical address, SPF, DKIM and DMARC readiness.
3. In Backlinks, copy this inbox's owner-only 192-bit HMAC-derived **Workspace delivery-status route**
   and configure the Workspace administrator rule to preserve the original
   structured DSN. Pentra stores only its digest and non-secret generation.
4. In Backlinks, the owner clicks **Verify bounce routing** and confirms one canary send.
5. Pentra atomically claims a two-minute canary delivery lease bound to the current account, plan, site, inbox, credential configuration, sender, DSN-target digest/generation and live DNS evidence.
6. Pentra sends exactly one message through that Gmail credential to `OUTREACH_INBOUND_RELAY_CANARY_RECIPIENT`. There is no caller-supplied recipient, prospect, cron, fleet or automatic retry path.
7. Gmail acceptance does not mark readiness. The inbox remains blocked while Workspace routing delivers the resulting DSN to the adapter.
8. Only an exact signed structured hard-DSN webhook whose actual envelope-target digest matches the current inbox target seals readiness. Ambiguous Gmail outcomes are never retried automatically.

Site/account deletion, plan parking, domain changes and inbox reconnect/profile changes serialize against an active canary lease. A fast DSN may arrive before Gmail response finalization; the signed receipt may settle that exact claimed canary without creating a second send.

The server rejects a new canary while the current 30-day proof remains valid and enforces at most one canary attempt per inbox in any 24-hour window across accepted, failed, ambiguous and verified outcomes. This durable boundary also applies to direct action calls; the UI is not the rate-limit boundary.

## Signed request contract

The adapter sends exact UTF-8 JSON with `Content-Type: application/json` to:

```text
POST https://<deployment>.convex.site/webhooks/outreach-inbound
```

Headers:

```text
X-Pentra-Relay-Timestamp: <current Unix seconds>
X-Pentra-Relay-Event-Id: <stable provider event id, 8-200 safe characters>
X-Pentra-Relay-Signature: v1=<lowercase hex HMAC-SHA256>
```

The HMAC input is the exact byte sequence, without JSON reserialization:

```text
<timestamp>.<event-id>.<exact raw request bytes>
```

The header event ID must equal body `eventId`. Pentra rejects invalid UTF-8, non-JSON content, declared or streamed bodies over 64 KiB, weak configuration and signatures outside a five-minute window.

Example reply event:

```json
{
  "version": 1,
  "adapterVersion": "relay-adapter-2026.08.23",
  "retentionPolicyHash": "<64-lowercase-hex-sha256>",
  "eventId": "evt_20260823_abcdefgh",
  "receivedAt": 1787500000000,
  "recipient": "reply-<independent-random-token>@inbound.example.net",
  "from": "Editor <editor@publisher.example>",
  "messageId": "<reply-message@publisher.example>",
  "inReplyTo": "<pentra.<different-independent-token>@sender.example>",
  "references": ["<pentra.<different-independent-token>@sender.example>"],
  "subject": "Re: resource",
  "text": "Thanks, I will review it.",
  "autoSubmitted": "no",
  "authentication": {
    "verdict": "pass",
    "method": "dmarc",
    "alignedFrom": "editor@publisher.example"
  }
}
```

`authentication` is a trusted adapter assertion, never a copied untrusted header. Assert pass only after aligned SPF/DKIM/DMARC verification. Human replies require the exact outbound Message-ID in `In-Reply-To` or `References`. A same-domain handoff may count only as an ordinary reply; only the exact original recipient may create STOP/domain suppression.

## Structured hard-bounce contract

Add `dsn` only after parsing a real `message/delivery-status` MIME part. Subject/body phrases are never bounce proof.

```json
{
  "dsn": {
    "source": "message/delivery-status",
    "action": "failed",
    "status": "5.1.1",
    "finalRecipient": "editor@publisher.example",
    "originalRecipient": "editor@publisher.example",
    "originalMessageId": "<pentra.<independent-token>@sender.example>",
    "routingRecipientHash": "<sha256-of-actual-dsn-envelope-target>"
  }
}
```

Pentra requires an authenticated daemon, permanent `5.x.x` status, exact recipient, exact original Message-ID extracted from returned/original headers, and an exact match between the signed actual-envelope digest and the target bound to the inbox/message claim. Soft, malformed or ambiguous DSNs create neither state changes nor suppression.

## Retry contract

- Any `2xx` is terminal, including generic `202` for unknown/stale aliases.
- `425` means Gmail delivery is still settling. Honor `Retry-After`, reuse the same event ID and exact raw bytes, but issue a fresh timestamp header and recompute the HMAC over `<new timestamp>.<same event ID>.<same raw bytes>` on every attempt. Retry within the provider retention window.
- Retry bounded `5xx` responses with the same event ID and exact bytes, also using a fresh timestamp and recomputed HMAC for every attempt. Alert before provider TTL exhaustion.
- Drop other `4xx` responses after recording redacted status/byte-count telemetry. Never log the payload.

The adapter must be explicitly configured to retry `425`; many generic webhook products do not do this by default.

## Durable privacy, replay and isolation

Alias and outbound Message-ID tokens are independent. Pentra stores only their SHA-256 digests, so database state cannot reconstruct either identifier. For a due threaded follow-up, the outbound Message-ID is reconstructed transiently from a purpose-separated server HMAC binding to the exact site, inbox and persisted delivery attempt, proved against the stored digest, and discarded after the provider call. Raw MIME, attachments, subject and body never cross the durable mutation boundary. Accepted receipts contain bounded identifiers/digests and state; ignored mail is not stored. At most one receipt per accepted outcome kind can exist for a prospect message.

Event IDs and inbound Message-IDs are atomically deduplicated. Reuse with different payload evidence is rejected as a collision. Before settlement, Pentra rechecks exact tenant, site, inbox, original configuration, rollout epoch, sender domain, alias domain, delivery boundary, deletion tombstone and plan-transition rules. Parking or disabling authority autopilot blocks new claims but cannot erase the settlement, STOP, reply or bounce for an exact provider attempt claimed before the transition. That attempt may settle once and cannot create a retry or later sequence step after authorization changed. Deletion and domain conflict always fail closed.

Pseudonymous account-wide recipient/domain suppression and contact-cooldown
records survive ordinary site deletion. This prevents site deletion or
recreation from causing duplicate contact or bypassing an exact-recipient STOP.
A verified full-account deletion purges those account-wide records through the
resumable deletion process. Separately, a non-reversible global hashed sender
reputation and pacing record may be unlinked from the account and retained for
no more than 90 days across account deletion or sender transfer, preventing a
delete/reconnect/transfer from resetting warm-up or pacing. It contains no raw
address, message content, OAuth credential or reusable site content.

## Legacy readonly migration

Existing `gmail.readonly` rows remain a bounded compatibility drain for unbound pre-relay messages. Direct compound indexes find eligible unbound messages without relay-bound rows hiding them. Parking/reconciliation may settle pre-transition replies and exact-recipient STOP events, while deletion/conflict remains closed.

Legacy polling does **not** auto-classify DSNs or suppress bounce addresses: Gmail sender authentication cannot prove an attacker-authenticated daemon refers to Pentra's original Message-ID. Signed relay hard-DSN handling is the secure path.

Reconnect is blocked while any eligible unbound sent/reviewed/replied message remains in the 90-day window or any unbound `delivery_unverified` outcome exists. New callback grants are strict send-only, and a missing refresh token may be reused only when the existing stored scope set is already exactly send plus identity scopes **and** the authenticated Gmail address is unchanged. A changed mailbox requires its own refresh token and advances the DSN-target generation. Never overwrite a broader legacy token or reuse another mailbox's token.

## Rotation and operations

1. Install `SECRET_NEXT`; update the adapter to sign with it.
2. Verify production-domain signature, replay, 425 and retention behavior.
3. Promote it to `SECRET` and remove the old secret after the retry window.
4. Secret-set/configuration hash changes invalidate every inbox canary. Re-run the owner canary for each inbox before prospect sending resumes.
5. Re-canary every inbox at least every 30 days and immediately after Workspace routing, adapter, retention or sender configuration changes.

`OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET` is independent from this signing
rotation. Rotate it only as a deliberate fleet routing migration: every inbox
will receive a new owner-visible Workspace target and remain blocked until its
administrator updates the route and the owner completes a fresh canary. An
owner can instead rotate one compromised target from Backlinks; that advances
only that inbox's generation and never sends mail automatically.

Monitor only aggregate status codes, latency, byte counts, adapter version, seal age and bodyless receipt counts. Never log secrets, OAuth tokens, raw inbound content, attachments, aliases, addresses, Message-IDs or full signed bodies.

## Audited AWS SES classic adapter

The repository's receiving-only reference implementation lives in
`infra/outreach-inbound-relay/`. Its SAM stack is deliberately isolated from
the Pentra application deployment and has no outbound SES/mail permission.

The AWS route distinguishes two envelope aliases:

- `reply-<independent-per-message-token>@<relay-domain>` receives a human reply;
- `dsn-<independent-per-inbox-token>@<relay-domain>` receives only a
  Google Workspace-routed delivery-status notification.

The DSN alias is not a tenant selector. The adapter requires a structured
`message/delivery-status` permanent failure, recovers the original exact Pentra
Message-ID and `reply-*` alias from the returned-message part, and submits that
recovered reply alias as `recipient`. Missing, duplicated, wrapped, body-guessed
or conflicting evidence is terminal and creates no webhook.

SES admission requires TLS, spam and virus `PASS`, plus SES `DMARC PASS` or its
aligned `DKIM PASS`. Bare SPF is never sufficient. The synchronous guard runs
before the raw S3 action and atomically enforces 10 accepted messages per alias
per hour and 60 per trusted SES source IP per minute.

Raw MIME is swept every five minutes at a five-hour-forty-five-minute threshold
to preserve headroom before the six-hour privacy boundary, with age/heartbeat
and Lambda-error alarms plus a one-day lifecycle backstop. SQS and its DLQ carry
object pointers only. See the adapter README and exact retention-policy file
for deployment, Workspace routing, rotation, audit, recovery and $2/$5
budget-gate instructions. Because SES receipt charges cannot be cost-tagged,
the adapter may be deployed in an existing AWS account only after an operator
inventories every region and confirms there are no other SES sending or
receiving workloads. Its SES-service-filtered budget then covers all SES spend,
including untaggable inbound receipt charges, while the tagged infrastructure
budget remains diagnostic only. Passing unit tests or deploying the stack does
not set `OUTREACH_INBOUND_RELAY_RETENTION_AUDITED=true`; that operator
assertion still requires evidence from the real production route and the
product's signed owner canary.
