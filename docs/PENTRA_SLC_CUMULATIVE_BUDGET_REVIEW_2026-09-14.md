# Cumulative validation cap — local review candidate31

Do not deploy or activate without separate review. The deployed application is
`b3994e0a5a10a24189a7fc767f11b8c3dbb1240a`; this financial change is local only.
Provider spend in this assignment remains USD0 and the USD20 run is inactive.

## Why the existing contract is insufficient

`providerBudgetAuthorization` is tied to one UTC account month, and its existing
incremental limit cannot exceed the monthly lift ($32−$28=$4 here). Reusing or
renewing it for the approved additional20 would change the old discovery grant
and reset at midnight on October1. The safe production observations show the
old4 is still present and only at most0.878440 remains. No accounting defect that
permits releasing the16.05 retained ceilings was demonstrated.

## Small extension of the same system

An optional immutable `cumulativeValidation` receipt attaches to the existing
authorization row. A stable optional entitlement pointer keeps that same anchor
when the independent monthly approval changes. No new table, spending ledger,
usage counter or queue is introduced; every admission still calls the same
serializable `reserveSharedProviderBudget` path and writes its original ledger.

The internal attachment boundary requires two exact same-owner authorized sites,
the exact existing monthly approval/reference, a positive total no greater than
USD20, an explicit expiry no later than24 hours after activation and a scrubbed
approval reference. It never changes the old monthly or incremental receipt.
Identical retry returns the original clock; different limits/references/expiry
or a second attachment fail. This endpoint was not invoked in production.

The extra guard sums the original account ledger across all dates and sites,
including scrubbed site IDs. New reservations and older unresolved amounts count
conservatively. A known cost permanently settled before activation is excluded;
an older unknown cost that settles during the run remains counted once at its
verified amount. An incomplete settlement retains its full ceiling. This can
consume validation headroom conservatively for historical ambiguity; it never
pretends those amounts are verified new charges. Normal no-I/O cancellation and
immutable settlement remain the only ways to change consumption.

The bounded5001-row indexed account read fails closed if incomplete. UTC rollover,
process restart, old hold age, tenant deletion and monthly-pointer change cannot
renew the total. Expiry is a spending stop, never a fallback to ordinary funding.
No automatic deactivation/renewal is provided. Denials retain the existing guard
code with explicit `cumulative_validation` scope and invalid/expired/incomplete/
exhausted state; ordinary monthly resets do not restore this capacity.

All old account/day/month, old4, fleet, entitlement and provider-health gates are
still conjunctive. This extra guard does NOT unblock the current old4/monthly
constraint or grant new spend outside it. Unknown existing reservations may also
reduce the nominal20's usable amount. A separate reviewed decision would still
be needed if the fixed production limits cannot admit the priced test envelope.
No spending increase should be inferred from these local schema/code additions.

## Regression evidence

The actual registered approval mutation and shared reservation/settlement/release
functions are exercised with isolated synthetic data. Tests cover shared total
across two sites, serializable concurrent admission, concurrent approval retries,
restart/replay, invalid first approval, immutable clocks, full unknown ceilings,
settlement replacing rather than doubling cost, valid no-I/O cancellation twice,
wrong-site cancellation rejection, UTC rollover, stable anchor after monthly
pointer change, expired-run stop, deleted site reference, foreign owner/anchor,
existing4/month/fleet limits and complete-inventory requirements.

Focused final authorization suite:11 passed,0 failures/skips,127.729292ms. Final
full repository suite:1651 discovered,1650 passed,0 failed,1 existing sibling
consumer skip,102.197410167s; preceding repeat1650/1649 pass,103.144896959s.
Production build/typecheck pass (31 routes,474ms compile/7.7s typecheck);
full lint0 errors/157 existing warnings; schema61 tables295 indexes, no removals;
680-file tracked/staged secret scan and staged whitespace pass. The deployed
application's separate full CI/dependency audit/browser receipts remain in the
release report. No financial candidate was pushed or deployed for these gates.
The initial focused failure was cross-VM prototype equality in a test
assertion; structured cloning normalizes the comparison without weakening it.
This is local accounting acceptance, not approved activation or a paid live test.
