# Pentra SES inbound relay retention policy

Policy version: `ses-classic-receiving-v1`

This policy covers the receiving-only AWS adapter in this directory.

- Unsafe mail is stopped by the synchronous SES guard before S3 persistence.
- Accepted raw MIME is stored in one private, unversioned, SSE-S3 bucket under
  `raw/`. The parser deletes it after any terminal webhook result.
- A scheduled sweeper runs every five minutes and deletes raw MIME at five
  hours forty-five minutes. Under normal scheduling, deletion therefore occurs
  by five hours fifty minutes, leaving ten minutes of headroom before the
  six-hour privacy boundary.
- A one-day S3 lifecycle expiration is the independent backstop if the sweeper
  is unavailable.
- The DynamoDB proof row contains one short-lived envelope alias because the S3
  event contains only an object pointer. The table is encrypted at rest, has no
  stream and no point-in-time backups. Proof rows expire at five hours
  forty-five minutes, and the parser or five-minute sweeper deletes them.
  Rate-limit rows contain only SHA-256 digests and counters.
- The primary SQS queue retains only S3 pointer events for at most six hours.
  The dead-letter queue retains pointer events for at most one day. Neither
  queue receives MIME, headers, bodies, aliases, addresses, or signing secrets.
- Attachments are never decoded or copied. Returned-message headers are read
  only to bind a structured DSN to an exact Pentra Message-ID and reply alias.
- The normalized webhook is deterministic and no larger than 64 KiB. Raw MIME,
  attachment data and unbounded provider responses never cross the webhook.
- CloudWatch records only aggregate outcomes, status classes, bounded retry
  delays, byte buckets, deletion counts and oldest-object age. It never records
  event bodies, headers, aliases, addresses, provider message IDs, exception
  text or secrets. Alarms cover sweeper errors, a missing fifteen-minute
  heartbeat and any observed raw-object age at or beyond six hours.
- Lambda log groups retain aggregate records for 14 days.
- No component has an outbound SES action, SMTP credential, Gmail credential,
  `ses:Send*`, `ses:SendBounce`, or IAM mutation authority.

Compute the release binding from the exact reviewed bytes without editing this
file to include the result:

```sh
shasum -a 256 infra/outreach-inbound-relay/RETENTION_POLICY.md
```
