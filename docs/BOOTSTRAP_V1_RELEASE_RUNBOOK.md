# Pentra bootstrap v1 release runbook

This runbook is the operating contract for the zero-additional-cost release
profile. It never authorizes `full_managed`, WordPress, signed-webhook
publishing, Smartlead, or automatic prospect delivery.

## Supported matrix

- Publishing: GitHub only.
- Measurement: owner-authorized Google Search Console.
- Outreach: customer-managed SMTP/IMAP, owner approval and owner-triggered
  delivery for every message.
- Production canaries: Pentra is the primary natural-loop tenant. LeadPilot is
  the independent secondary tenant and may finish with either a natural loop
  or an exact `opportunity_space_exhausted` receipt.
- Cost ceiling: no new paid provider or infrastructure resource.

## Required production configuration

`OUTREACH_CREDENTIAL_ENCRYPTION_KEY_ID` names the current AES-256-GCM key and
`OUTREACH_CREDENTIAL_ENCRYPTION_KEY_V1` contains its base64-encoded 32 bytes.
Never print either value. During rotation,
`OUTREACH_CREDENTIAL_ENCRYPTION_KEYRING_V1` may temporarily contain a JSON map
of old key IDs to their old base64 keys. New writes always use the current key;
a successful SMTP/IMAP verification re-encrypts an old envelope and clears the
legacy plaintext field.

Keep `PENTRA_FULL_MANAGED_BETA_ENABLED` and
`NEXT_PUBLIC_PENTRA_FULL_MANAGED_BETA` unset. Customer-managed automatic
delivery is also rejected at the serializable final provider boundary, so an
old `live` inbox cannot bypass bootstrap approval mode.

## One Setup

The owner completes Pentra One Setup once: Pentra domain and business profile,
two articles per week, GitHub destination and authorization, existing Search
Console authorization, Full Autopilot publishing consent, SMTP/IMAP sender,
and versioned sender/compliance/canary consents. The owner enters the truthful
physical mailing address and Gmail app password directly in the browser. They
must never appear in chat, screenshots, commands, logs, or release receipts.

Every incomplete capability must expose a durable blocker, responsible party,
`nextEligibleAt`, and automatic wake. Do not manually describe a scheduler run
as natural and do not activate or inspect an unrelated tenant.

## Controlled outreach canaries

Use only `pentrahelp@gmail.com`, `leadpilotchat@gmail.com`, the controlled
invalid recipient, and a user-owned link page. Never contact a prospect.

1. Verify SMTP and IMAP sockets. The credential must be encrypted before the
   inbox can become ready.
2. Owner-approve and owner-trigger one delivery to the controlled recipient.
3. Reply in the same thread, send an exact STOP message in a separate controlled
   thread, and use the fixed invalid recipient for the hard-bounce canary.
4. Let the 15-minute inbound fleet consume IMAP naturally. It parses at most 25
   messages and 256 KB per message, persists only hashes/classifications, and
   advances the UIDVALIDITY/UID cursor only after settlement.
5. Verify account-wide suppression and that every later follow-up is blocked or
   skipped. No raw body or attachment may cross the durable mutation boundary.

## Release acceptance

Canary evidence must postdate the bound Convex/Vercel deployment. Record the
primary natural tenant separately from the secondary convergence tenant. The
immutable `bootstrap_v1` release receipt is allowed only after GitHub
publication verification, GSC improvement execution, isolated conversion
ingest, SMTP delivery, IMAP reply/bounce/STOP, follow-up cancellation,
controlled acquired-link verification, and a clean 10% to 50% to 100% staged
observation with no severe incident or silent running state.

If any receipt is absent, Pentra remains incomplete and reports the exact
blocker. A controlled backlink proves detection machinery only; it is not an
authority or ranking claim.
