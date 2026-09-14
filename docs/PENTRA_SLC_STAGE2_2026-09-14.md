# Stage2 — selected-page work and conditional WordPress candidate

Assignment: `supervisor-20260914-slc-stage2-27`. Base:
`66f06de1c4a0596acb89bc626699e81c3893120b`, branch
`codex/simplified-article-admission`, isolated checkout `.claude/assignment24`.
The candidate commit is the commit containing this report; the final supervisor
handoff supplies its exact hash. **LOCAL ONLY, REVIEW REQUIRED.** No Stage3
implementation, production acceptance, deployment or migration is asserted.

## Working local chain

The existing authoritative `jobs.contentWork` now selects an authorized existing
page or a distinct new topic, prepares and reviews it using the retained quality
and budget gates, conditionally writes the reviewed artifact, verifies the full
rendered page, advances only the original fixed deadline and replenishes two
ready work items. Selected-page revisions use existing
`published_article_revisions`; drafts and consumed artifacts use `articles`.
There is no second Pentra queue or spend ledger. One exact-site stage index on
the existing jobs table recovers non-cadence rollback verification.

Connected fixtures cover SaaS, local services, retail, agency and publishing.
For **each of five businesses on each adapter**, they verify one selected-page
improvement, two fresh creations and two newly replenished ready items. GitHub
uses injected, stateful Git Data/Contents transports with non-fast-forward CAS.
WordPress uses actual core, application-password authentication, a database and
the rendered theme response. Both include a provider-free conditional rollback;
WordPress alternates existing posts and pages and tests a lost append response.
Mocked generation still executes the actual pipeline, quality mutations, billing
admission, worker claims and publisher handlers. Synthetic model output is not
evidence of real-model quality or production acceptance.

## Consent and protection

- Explicit owner preview and selection identify one file or WordPress resource.
  Source revision, current verified connection and confirmed profile are bound
  again at selection, admission and the final external-write fence. Safe UI
  projections omit credentials, grants, raw source and provider payloads.
- GitHub supports direct plain `.md`/`.mdx` files under the configured content
  directory. Unknown frontmatter/layouts, custom components, executable MDX,
  escaping paths and ambiguous source metadata are rejected before consent.
- WordPress import supports a deliberately narrow classic HTML subset. Blocks,
  shortcodes, custom layouts/templates, protected commerce/legal pages, private
  or password-protected content are rejected. Core edit/publish capabilities
  remain required. Pricing, checkout, legal text and unselected pages cannot be
  autonomously changed.
- Discretionary improvements preserve the original title and complete prose;
  additions must begin at a paragraph boundary and pass the existing audit and
  exact rendered-content gates. No-op/monitoring is never completion.
- Weekly opportunity review uses existing daily GSC ingestion/current epochs.
  Fourteen-day discretionary cooldown is enforced. Missing measurements permit
  unrelated creation and never fabricate demand, outcomes or completed work.
- Local revocation stops admission and writes immediately. WordPress revocation
  also has three bounded remote attempts, idempotent acknowledgement, version
  fencing against re-selection and safe pending/failed status. An already-
  authorized in-flight write is retained for reconciliation, not erased.

## Conditional writes and recovery

The installable WordPress connector is one PHP file. Its two tables are remote
adapter permission/idempotency receipts, not a replacement application queue.
One DB transaction contains the exact post-row compare-and-swap, permission,
metadata and receipt. Different concurrent updates to the same base cannot both
win. Same-request concurrent creates/retries produce one post. Different bytes
cannot reuse a key. The ordinary core editor race is exercised through a
separate PHP process holding a real DB transaction.

The connector rejects non-transactional storage. Tests execute WordPress7.1,
PHP8.5.10 and official SQLite Database Integration3.0.2 using its modern
BEGIN IMMEDIATE transaction implementation. **MySQL/InnoDB code has not been
executed against a real MySQL server in this assignment.** Arbitrary third-party
plugin side effects outside the transaction are not made transactional.

GitHub uses the exact imported file SHA and bytes plus a non-force branch update.
Idempotent recovery checks the exact current head twice. Rollback restores exact
retained source bytes, preserves original metadata absence, requires the current
delivered version and refuses subsequent customer changes. It has zero provider
budget/calls and does not consume or advance a cadence slot. Reviewed improvement
artifacts cannot be sent through legacy creation after a service-mode change.
Uncertain attempted selected-page deliveries block engine switching.

Live verification checks successful fetch, intended URL, one matching canonical,
title, metadata and the complete visible approved prose, excluding hidden text.
It owns a durable lease and at most five checks; duplicate/stale callbacks cannot
spend another attempt or advance a deadline twice. A watchdog recovers action
death after claim; the same job-stage index recovers a failed scheduled callback
before claim, including rollback jobs older than the next cadence deadline.
Failure remains visible without replenishment being misreported as success.

## Reproduced defects repaired in27

1. GitHub consent hashing previously used an adapter hash that is undefined for
   GitHub. Repository/branch/configuration and hashed credential generation are
   now part of the binding; confirmed pricing/founder facts also invalidate stale
   profile consent. No raw credential appears in a safe projection.
2. Real WordPress transformed reviewed punctuation through core typography.
   Client rendering now entity-encodes visible Unicode while preserving markup
   and KSES normalization. Exact content verification was **not** relaxed.
3. WordPress trailing-slash permalinks were rejected by the shared route contract;
   one conventional trailing slash is now supported, without allowing traversal.
4. A no-op/short reviewed draft entered transport recovery and replayed its cached
   rejected result until exhaustion. A typed quality rejection now enters the
   existing two-revision/one-distinct-replacement path within the original budget.
   The failing-before connected test and passing regression distinguish this
   from a provider failure. Unsupported content is not promoted.
5. Rollback verification can predate the next cadence deadline; it is now recovered
   through the existing job with an exact-site stage index rather than disappearing
   from the future-deadline scan. Source headers are refreshed after an improvement,
   so subsequent writes never slice raw content using an obsolete header length.

## Free release gates

Final candidate verification completed 2026-09-14 before 13:59 UTC:

- Repository tests:1,584 discovered;1,583 passed;0 failed;1 existing skip (missing
  sibling LeadPilot source module). Final full run97.56s.
- Real WordPress gate:13 passed;0 failed;0 skipped. Run via the reproducible npm
  bootstrap; real posts and pages, both rollback and post-consumption refill.
- Types and build pass;31 pages generated. Schema compatibility passes against
  baseline9fd01af:61 tables/295 indexes, one additive existing-job stage index.
- ESLint0 errors/157 existing warnings. Initial lint accidentally traversed the
  downloaded vendor runtime; that process was stopped and only the vendor runtime
  was excluded. A new fixture prefer-const error was corrected before final pass.
- Secret scan660 tracked files passed after all new source/tests were staged.
- Dependency audit0 vulnerabilities; staged diff whitespace check passes.
- Browser18 discovered/16 passed/2 existing authenticated skips. This is not
  authenticated selected-page UI or end-to-end SaaS acceptance.

Commands, run with the bundled Node runtime and explicit synthetic browser
environment:

```text
npm test
npm run test:wordpress
npm run typecheck
npm run lint
SCHEMA_BASE_REF=9fd01affd5bc57a681e8b32f2212ed671d3aab2c npm run check:schema
npm run scan:secrets
npm audit --audit-level=high
npm run build
npm run test:e2e
git diff --check
```

The real fixture bootstrap pins archive checksums, installs only inside ignored
`.wordpress-fixture`, preserves that synthetic DB, binds only 127.0.0.1:18927 and
shuts down its owned server after tests. No global PHP/MySQL installation occurs.
The fixture-only virtual-host configuration must never be installed publicly.
The vendor runtime is excluded from ESLint; connector and test source remain in
scope. See `connectors/wordpress/README.md` for reproduction and constraints.

## Open product/acceptance boundaries — do not hide these

- Autonomous selected-page work is **additive only**. Immediate owner-requested
  exact rollback exists and is explicitly separate from discretionary SEO work.
  A same-job flow for replacing/removing erroneous factual text or repairing
  arbitrary existing technical markup is **not implemented by this candidate**.
  The canonical plan's immediate-correction requirement remains incomplete;
  do not relabel additive improvements as factual corrections. Further bounded
  Stage2 work/review is needed before treating this as the complete contract.
- A second measurement-driven revision to an already enlarged page after fourteen
  days has not been demonstrated end to end. Cooldown boundaries are tested;
  existing maximum-length and quality gates still apply and can reject additions.
- Only supported classic/Markdown layouts are accepted. WordPress theme/plugin
  compatibility and real MySQL execution remain separate deployment prerequisites.
- Minimal exact-page selection/revocation/rollback and intent reporting are present.
  Full authenticated customer onboarding, billing, pause/resume, journey and
  reporting acceptance are Stage3, not complete here. Existing two authenticated
  browser skips and the missing sibling LeadPilot source-module test are gaps.
- Production fixed deadlines, publication timestamps, remaining buffers and
  reservations have **not been refreshed** in27. Historical observations in the
  handoff are not current state. All scheduler dates in runtime tests are virtual
  2026-09-11 fixture dates, not Pentra/LeadPilot publication timestamps.
- No proof of three ordinary production cycles, real provider generation, live
  post-consumption replenishment on either authorized tenant, real GSC follow-up
  or attributable organic-click growth. Technical delivery and SEO growth remain
  separate, both unaccepted in production. No backlinks work was started.

## Authority and spend

No production reads/writes, deployment, push, migration, cap change, real provider
calls, reservation/attempt resets, subscription changes, real-prospect contact
or production authentication changes in27. Paid provider expenditure: **USD0**.
The approved USD20 cumulative validation allowance remains inactive and unspent;
the older USD4 discovery envelope is separate and has not been reset. Account/
fleet limits and valid reservations are unchanged. Runtime downloads were free
public distributions; synthetic local WordPress account/password resets occurred
only in the isolated test DB. Keep Stage4 spending behind its existing review and
enforced cumulative allowance boundary.
