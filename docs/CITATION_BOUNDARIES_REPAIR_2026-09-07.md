# September 7 citation-boundary repair

## Reproduced defects

The unchanged Pentra draft `j579j19sftmhs4p5xqyqj0ja1n8dyew1` had eight
deterministic ledger defects during its second ordinary quality review. Five
were source-list entries mistaken for factual prose because the reference rows
were separated by single newlines. Two compared an entire multi-citation
sentence with each source, importing a preceding source's numbers and wording
into a different proposition. This is not a reason to waive factual quality.

Regression tests reproduced both false rejections. They also exposed two unsafe
acceptance cases: the old parser inspected only the first occurrence of a
repeated citation ordinal, and an uncited factual clause after the final marker
could escape the citation-free sentence check.

## Repair contract

- Recognize a multi-line bibliography only if every nonempty line is a
  recognized reference row. Anchor URL-only bullet matching to the whole line;
  a reference-looking prefix cannot exempt following factual prose.
- Bind each inline source marker to the proposition since the preceding
  marker. Adjacent markers continue to share the complete proposition. Inspect
  every occurrence, including repeated uses of the same source.
- Independently check uncited text after a sentence's final citation. Reader
  advice retains its existing exemption; factual assertions require evidence.
- Include the exact bounded uncited text in remediation feedback instead of
  forcing the editor to guess which part of the paragraph needs correction.

No editorial threshold, exact number/entity requirement, evidence hash check,
independent model audit, or source/tenant binding was weakened. No production
draft, audit result, paid attempt, or quality-recovery allowance was reset.

## Read-only production replay

The new validator was applied locally to the unchanged, stored Pentra draft
and its exact source/product snapshots. It now reports two uncited factual
claims, rather than the false bibliography/cross-source failures. It still
returns `passed: false`: this article is not certified or published by this
repair. The freshly published product-marketing article
`j571r4bvpd7fydzxcz7ey5cs3h8dxnxb` also passed a local replay unchanged.

Five new tests cover multi-line references and mixed prose, independently cited
clauses, repeated ordinals, adjacent/comma-grouped citations, and uncited tails.
The first, second, repeated-ordinal and trailing-claim cases failed before the
repair. Source similarity remains a coarse validation check, not proof of
truth or future search traffic; the independent factual/editorial review stays.

Full local gates passed: 1,402 tests; type-check; zero lint errors with the same
157 pre-existing warnings; additive schema check (60 tables, 291 indexes);
zero production dependency vulnerabilities; production build; and ten public
browser checks. Two credential-dependent automated checks remain skipped.

## Other acceptance observed during this work

- Sealed delivery repair `9e298cebb3fccffe6f59b4afb902f50846df300c` passed
  GitHub quality run `34119269044`, reached production deployment `6308174375`,
  and completed Convex deployment before September 7 12:01:03 UTC.
- Pentra's exact queued product-marketing article published naturally at
  12:00:19.580 UTC, with GitHub commit
  `5752158d8735e25a6dd13c8b6eb8c0ab2ea37c7d`, content hash
  `3ec8d4f4fdad584d02c436b3f9156d6dd94b352d793d01d68002a6e1b4817816`,
  and durable live verification at 12:00:21.121 UTC. It was **15 minutes
  7.318 seconds late**, not on time. The background review had already finished,
  so this publication alone does not prove production worker overlap isolation.
  An independent HTTP fetch of
  `https://pentra.dev/blog/product-marketing-content-system` returned 200 with
  the expected visible heading.
- Signed-in Chrome settings were inspected through native controls without
  changing credentials, cadence, or publishing configuration. Pentra showed
  7/week and its GitHub repository; LeadPilot showed 21/week and its GitHub
  repository. LeadPilot's stale error tab recovered after a normal reload.
  This is a read-only settings check, not clean-account onboarding acceptance.

LeadPilot's new planning execution remains behind its existing cooldowns.
Sustained replenishment, every supported onboarding path, autonomous backlink
outcomes, and attributable SEO growth are not established by these repairs.

## Bound production deployment

- Source commit `0dc898e` was normally merged with Pentra's independent natural
  article publication, preserving both changes. Final pushed release:
  `24183313b98fdea47c04a2904e94d19fbefeb9fb`.
- GitHub quality run `34119997540`: succeeded, including all 1,402 tests.
- GitHub production deployment `6308301231`: success at September 7
  12:06:08 UTC.
- Convex deployment to `wary-starfish-773`: succeeded before September 7
  12:10:35 UTC, with type-check and schema validation and no deleted indexes.
- The unrelated provider-diagnosis note was not staged or committed.
  `.codex-convex-prod.env` remained untracked and was not printed.

At 12:10 UTC Pentra retained two sealed ready articles after publication; its
ordinary refill job `j9773cy9jkppbcqp2549bnff6x8dywwn` was reviewing saved draft
`j57001e1fe3a93x7em70dmcybh8dy0wf`. Factual score 94 alone is not a final
quality seal. Its next configured publication deadline was September 8
12:00:19.580 UTC. LeadPilot retained two sealed ready articles with its next
deadline September 7 14:15:15.201 UTC.

A bounded, owner-requested LeadPilot plan queue request was denied before
dispatch: `plan_headroom_exhausted`, 18 counted plans against maximum 15.
No job or provider call was started by that request. This is the manual plan
allowance, not evidence that the topped-up provider balance failed. The
existing automatic plan cooldowns and reservations were left intact; the
earliest observed automatic eligibility remains September 8 00:01:30.615 UTC.

## Follow-on first-party repair feedback

The ordinary Pentra refill above completed at 12:13:24.171 UTC as quarantined,
not ready. Its independent factual score was 93, while two deterministic
first-party ledger mismatches capped its editorial score at 84. Both complete
product paragraphs included navigation to the article's own Step 5, Step 6,
or Step 7. Those numbers were not in the product snapshot. The old generic
error quoted only the first 220 characters, so the editor could not see the
actual mismatching detail and repeated the paragraphs across its bounded edits.

A read-only replay confirmed that the stored product snapshot hash was valid.
Removing only the three article-local cross-reference clauses in a local copy
of the prose and its matching ledger changed the existing validation result
from two failures to passed. No production prose or ledger was modified.

The follow-on repair reuses the existing bounded number, named-phrase and
overlap diagnostics for first-party claims. Missing or invalid product hashes
are reported separately as provenance failures that prose edits cannot fix.
The normal remediation prompt now tells the editor to separate numbered
reader navigation from evidence-bound product facts, without relabeling or
altering a factual quantity to evade validation. The evidence predicates,
quality thresholds, paid retry allowances and stored audits are unchanged.

Three regression cases failed before the feedback change and pass afterward:
two generic products with navigation/quantity/alias mismatches, missing and
invalid snapshot hashes, and a late unmatched number beyond the old quote
limit with bounded feedback. All 1,405 tests, type-check, lint (zero errors;
unchanged 157 warnings), schema check, dependency audit and secret scan passed.
The production build and public browser acceptance command also passed.
The final deployment result follows separately.
