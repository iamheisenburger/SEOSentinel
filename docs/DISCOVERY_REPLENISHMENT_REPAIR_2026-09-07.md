# September 7 discovery replenishment repair

## Production evidence before the repair

LeadPilot's ordinary overnight planning jobs did not produce replenishment:

- `j979extdz1qws2nm4ya80c8hps8dy3kq`: 438 unique discovered keywords,
  20 preselection-eligible, 20 unused measured keywords, **zero** passing the
  authority ceiling.
- `j97ba3pwtk65amfrdbbkhvp26x8dyk6c`: 956 unique keywords,
  21 preselection-eligible, 15 unused measured keywords, **zero** passing the
  authority ceiling.
- `j972n24ws3by1v5p6v7egmcpyn8dyhgs`: its `lead scoring examples` candidate
  was excluded by the live-SERP cannibalization check. That intent is already
  represented by an independently published article; the check stays intact.
- `j973f54k2y57qytk14hb8nj50n8dynqv`: zero checkpoint candidates remained.

Two existing LeadPilot buffer articles nevertheless published automatically:
`j574t26k4t3qfww5snz1z53r498dwtfr` at September 6 22:15:05.548 UTC,
and `j573mdfakjad9pcavwdrb6pevx8dx4tv` at September 7 06:15:15.201 UTC.
They were 14.361 and 9.653 seconds after their respective deadlines. Both
had exact GitHub commit receipts, durable live verification, and independently
returned HTTP 200 with the expected visible article headings during inspection.
The buffer fell from four to two. This is delivery evidence, not refill success.

## Reproduced software defect

All three bounded Labs discovery sources requested high-volume rows without
the planner's authority/difficulty filter. The provider applies its response
limit before local filtering. Therefore 100 unreachable head terms (72 for
related queries) can hide every reachable lower-volume candidate. Local
sorting cannot recover rows that the provider never returned.

Provider-transport regression fixtures reproduced this for suggestions,
related keywords, and category ideas: the original code returned only the
unreachable head rows. After the repair, the same request count returns the
three reachable candidates, including measured KD zero and the existing
1,000-search volume allowance. These synthetic fixtures prove the query
selection defect; they do not prove that a particular live seed has more
eligible topics in the provider database.

## Repair and boundaries

The planner passes its actual difficulty ceiling, derived from fresh measured
authority and referring domains, into discovery. The three Labs request
filters apply that same ceiling before result truncation. The existing
additional ten difficulty points at volume >= 1,000 are preserved exactly.
Google Ads retains its separate unmeasured discovery lane and exact difficulty
enrichment. Existing callers that omit the option retain their old filter.
Malformed explicit ceilings fail before any provider request.

No request fan-out, result cap, provider budget, attempt allowance, keyword
admission threshold, SERP check, content-quality gate, or publication clock
was relaxed. The final independent difficulty measurement and all downstream
admission checks still apply. No paid job or failure receipt was reset.

Filter syntax and the distinct related-keyword field prefix were checked
against the official DataForSEO documentation:
[suggestions](https://docs.dataforseo.com/v3/dataforseo_labs-google-keyword_suggestions-live/),
[related keywords](https://docs.dataforseo.com/v3/dataforseo_labs-google-related_keywords-live/),
[ideas](https://docs.dataforseo.com/v3/dataforseo_labs-google-keyword_ideas-live/),
and [available filters](https://docs.dataforseo.com/v3/dataforseo_labs-filters/).

## Local release gates

- All 1,389 repository tests passed, including six new tests.
- Exhaustive filter equivalence checked seven authority ceilings, eight
  demand boundaries, and every integer KD from 0 to 100 for both field shapes.
- Type-check passed; lint had zero errors and the same 157 existing warnings.
- Additive schema check passed: 60 tables, 291 indexes.
- Dependency audit: zero vulnerabilities. Production build passed.
- Public Playwright: ten passed, two credential-dependent checks explicitly
  skipped, not counted as customer acceptance.
- Secret scan passed for the then-tracked files; re-scan after staging includes
  this document and the new policy module.

Deployment and post-deployment refill outcomes are not yet claimed. Sustained
new-article delivery, clean generic onboarding, autonomous outreach, and SEO
growth remain separate open requirements.
