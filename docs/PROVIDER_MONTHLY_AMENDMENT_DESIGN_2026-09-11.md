# Monthly approval amendment — review-only design

**Not implemented, deployed, activated, or approved for spending.** Existing
September authority remains account$32/month, discovery approval$4, fleet$35/month.
The immutable original approval began **Sep8 14:01:35.681 UTC** and expires
**Oct1 00:00 UTC**. No new numeric cap is proposed without a runnable capacity
receipt. The withdrawn$12 and rejected all-in allowance are not revived.

**Append-only contract.** Keep the original authorization unchanged. A small
amendment receipt must bind its exact ID, original approval reference, account
key, month, original approvedAt and expiry; the expected preceding amendment
(or explicit original root); one unique owner-approved amendment reference;
expected prior cumulative limits; explicit new cumulative month/incremental
limits; and a separately bounded additional purpose/scope allowance. Include
who approved it and when for audit, but never treat that new timestamp as the
spending-window start. Limit the chain to a small fixed bound; overflow fails
closed and cannot silently select the newest row.

**One serializable transaction.** Re-read canonical ownership/entitlement, the
original authorization and its exact amendment chain. Reject changed owners,
base plan, reference, month/expiry, malformed or non-integer micro-USD limits,
unapproved scope, and a stale preceding-receipt/prior-limit expectation. An
identical retry of the same amendment reference returns the same immutable
receipt; any changed payload with that reference rejects. Indexed uniqueness
and Convex OCC make competing appends re-read the committed predecessor: two
concurrent approvals cannot both enlarge the same prior state. No reservation
is created by approval itself.

**Enforcement, not a credit reset.** Ordinary admission reads the original plus
the bounded valid chain. Count every valid settled or retained reservation from
the original month and original approvedAt exactly as today. All cumulative
account and incremental ceilings must hold. Any reservation using additional
headroom must match the explicitly approved purpose, carry the amendment
binding atomically, and remain within its additional-scope exposure cap; an
unapproved purpose cannot inherit the lift. No old reservation, paid-attempt
marker or ambiguous expense may be reset, detached, refunded or relabelled.
Existing owner/day$9.60, fleet/day$9.85, fleet/month$35, concurrency, quality and
source no-replay limits remain unchanged. The original October expiry ends the
entire chain; it does not renew. Invalid amendment data fails closed.

**Evidence required before an executable owner request.** Obtain a fresh exact-
site ordinary planning-window receipt, then an authoritative aggregate-only
account/fleet exposure and cooldown receipt without retrieving other tenants'
records. Only two-site consumption lower bounds exist now; exact account/fleet
headroom remains unknown. Original-reference binding also needs a safe receipt.
Quote explicit proposed cumulative limits and bounded additional scope against
that evidence, not against an assumed empty remainder of the fleet. A next
ordinary plan reserves$1, which is a conservative discovery execution ceiling,
not verified cash cost or promised topics. It would test new distinct measured
topic discovery and admission—not article completion. Generation, research,
media and revisions still lack any additional operator acceptance-test spending
authority. If those stages cannot lawfully run, say so before asking for money.

**Review/verification gate.** First review this design; implementation requires a
separate bounded assignment. Tests must cover simultaneous appends/admissions,
exact retries and mismatched replay, stale predecessors, wrong owner/reference,
scope escape, partial settlement versus retained exposure, expiry and original-
clock preservation. A later explicit owner spending approval must specify the
actual amounts and purpose before any live amendment. No all-in pricing system,
provider request, aggregate ledger scan, or amendment endpoint was added here.
