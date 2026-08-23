# Exact organic outcome attribution

Pentra's outcome endpoint records a server-asserted, tenant-isolated chain:

`organic_landing -> signup -> activation -> paid_conversion`

This is deliberately separate from Google Search Console. GSC proves aggregate
organic clicks and rankings. Outcome receipts prove what the customer's own
backend says happened after one of those visits. Pentra reports both and does
not manufacture session-level identity from GSC aggregates.

## Safety contract

- The endpoint is `POST /outcomes/v1/receipts` on the deployment's
  `*.convex.site` origin.
- It is server-to-server only. Browser fetch metadata is rejected and there is
  no CORS route.
- Each site has a distinct 256-bit bearer credential. Only its tenant-bound
  digest is stored by Pentra, and the raw token is returned once on rotation.
- The public article identifier is the sealed `pentraDeliveryKey` already
  embedded in Pentra publication frontmatter. It is not a secret. Base
  publication resolution is indexed by `(siteId, publicationDeliveryHash)`;
  a new landing resolves a revision key only when it is the article's latest
  final live revision. Later funnel stages retain that landing's sealed key,
  even if Pentra revises the article in the meantime. Both paths still require
  the site's bearer credential, exact external publication receipt, verified
  live URL, and exact canonical `articleUrl`.
- Event ids are immutable and idempotent per tenant. Reusing an event id with
  different data or submitting two different event ids for the same funnel
  stage fails closed.
- A session cannot cross a tenant, article, URL, or configured goal. A later
  stage is accepted only after every earlier stage and cannot predate it.
- Daily accepted, rejected, and bad-token request limits are durable. Token
  failures back off without allowing an attacker who knows a site id to block
  valid authenticated traffic.

## Customer backend contract

The customer backend must create a random opaque `sessionId` when it confirms
an organic search landing on a Pentra article. It should persist that id with
the eventual account and billing customer so later trusted lifecycle handlers
can reuse it. Do not send email addresses, names, raw user ids, checkout data,
or the Pentra bearer token to browser JavaScript.

Each request sends exactly one of `publicationDeliveryKey` or the legacy
internal `articleId`. New integrations should use `publicationDeliveryKey`:

```json
{
  "siteId": "<Pentra site id>",
  "publicationDeliveryKey": "pentra:<64 lowercase hex characters>",
  "eventId": "<stable provider or application event id>",
  "eventType": "organic_landing",
  "articleUrl": "https://customer.example/blog/exact-slug",
  "sessionId": "<opaque attribution id retained by the backend>",
  "goalKey": "<the site's configured outcome goal>",
  "occurredAt": 1787500000000
}
```

Send the secret only as `Authorization: Bearer <site token>` and use
`Content-Type: application/json`. Replays must retain the same event id and
all other fields. `202` is a new receipt, `200` is an exact replay, and a
validation or conflict response must not be rewritten into success by the
customer connector.

The first event must be `organic_landing`. Then submit `signup`, `activation`,
and `paid_conversion` with the same site, publication key, canonical article
URL, session id, and goal key. Use the application's immutable event id for
signup and activation and the billing provider's immutable event id for the
paid conversion.

## Controlled activation

1. Rotate a site credential with
   `actions/outcomeCredentials.rotateIngestCredential` and place the raw token
   in that customer's private backend secret store.
2. Install the backend connector and confirm it can retain the attribution id
   through account creation, activation, and billing webhooks.
3. Set both deployment variables:
   - `OUTCOME_INGEST_ENABLED=true`
   - `OUTCOME_INGEST_SAFETY_VERSION=organic-funnel-v1`
4. Deploy once, then call
   `actions/outcomeCredentials.getIngestRuntimeReadiness` as the site owner.
   It must report `ready: true`.
5. Exercise a synthetic four-stage chain against a verified published article
   and confirm the owner-only outcome summary reports one at every stage.
6. Rotate the credential immediately if it was ever logged, pasted into a
   browser bundle, or exposed outside the destination backend.

Leaving either deployment variable absent or stale keeps the public route dark
with HTTP 404. Enabling the route alone is insufficient because a site without
an active credential remains unauthorized.
