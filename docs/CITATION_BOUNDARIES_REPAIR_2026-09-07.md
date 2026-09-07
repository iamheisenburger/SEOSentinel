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
