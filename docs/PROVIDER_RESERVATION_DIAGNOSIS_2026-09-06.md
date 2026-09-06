# Provider reservation diagnosis — September 6, 2026

Provider wallet top-ups and Pentra's internal reservation ceilings are distinct.
At 16:28 UTC Pentra had three sealed articles and LeadPilot had four. Their next
new-article deadlines were September 7 11:45:12.262 UTC and September 6
22:14:51.187 UTC respectively. Buffer refill was not proven healthy.

## Reproduced reporting defect

Both account and fleet capacity evaluators checked daily consumption before
monthly consumption. If both windows denied the same request, One Setup mapped
the daily reason to tomorrow, despite the monthly limit also preventing that
request. The evaluators now report the monthly constraint first within their
respective account/fleet scopes. Existing ceilings and admission decisions are
unchanged. This is not a claim that every other independent queue constraint
has been inspected or will clear at that time.

The new `providerBudget:getSiteReservationSnapshot` internal query reads one
exact site's current-month reservations through the site/date index, at most
501 rows. It exposes aggregate reserved/settled/released counts and amounts,
marks truncation, and excludes rows belonging to a previous owner. It does not
read another site's reservations, return credentials, or infer free account or
fleet capacity from a single site's subtotal. Headroom is explicitly an upper
bound, never an authorization to spend.

Runtime tests cover two distinct tenants, foreign rows, previous ownership,
settled and released reservations, month boundaries, overflow, and absence of
credentials. Capacity tests cover simultaneous daily/monthly exhaustion at
every canonical tier, fleet exhaustion, and the corresponding One Setup UTC
monthly wake. No provider calls, topic replays, or spending-limit increases are
part of this repair.

Local release gates: 1,332 tests passed; type-check passed; lint zero errors and
157 pre-existing warnings; additive schema passed (60 tables, 291 indexes);
secret scan passed (580 tracked files); dependency audit zero vulnerabilities;
production build passed; public browser checks 10 passed, with two authenticated
checks explicitly skipped. These are software checks, not replenishment proof.
