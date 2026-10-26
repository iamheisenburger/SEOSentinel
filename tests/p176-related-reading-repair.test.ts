// P176 (Oct 24 2026): a live scan of the owner sites found 34 Related reading entries cut at the old 8-word anchor cap
// ("What Is an AI Sales Agent? How It", on 9 LeadPilot pages). Autopilot completes them on its own enrolled pages
// through the exact correction path; this repair can only extend a cut title into the whole title.
import test from "node:test";
import assert from "node:assert/strict";
import { cutOfTitle, planCorrectiveChange, RELATED_REPAIR_SPACING_MS, RELATED_REPAIR_VERSION, relatedReadingRepairProposal, relatedRepairAllowed } from "../convex/lib/contentCorrection.ts";
import { relatedReadingTitle } from "../convex/lib/internalLinks.ts";

const titles = new Map([
  ["/blog/ai-sales-agent", "What Is an AI Sales Agent? How It Works and Why Websites Need One"],
  ["/blog/lead-scoring", "How to Build a B2B Lead Scoring System That Actually Works"],
  ["/blog/exit-intent", "Exit Intent Detection"],
]);
const list = "- [What Is an AI Sales Agent? How It](/blog/ai-sales-agent)\n- [Exit Intent Detection](/blog/exit-intent)\n- [How to Build a B2B Lead Scoring System](/blog/lead-scoring)";
const markdown = `Intro paragraph that stays exactly as it was written.\n\n## Related reading\n\n${list}\n\n## Sources\n\n1. [A source](https://example.org/a)`;
const page = (body: string, kind = "github") => ({ editable: { active: true, kind, markdown: body, sourceContent: `---\ntitle: "T"\n---\n\n${body}\n` } }) as never;

test("a cut Related reading title is completed; whole titles and other entries stay", () => {
  assert.equal(cutOfTitle("What Is an AI Sales Agent? How It", titles.get("/blog/ai-sales-agent")!), true);
  assert.equal(cutOfTitle("Exit Intent Detection", "Exit Intent Detection"), false);
  const proposal = relatedReadingRepairProposal(markdown, titles, relatedReadingTitle)!;
  assert.equal(proposal.before, list);
  assert.equal(proposal.replacement, "- [What Is an AI Sales Agent? How It Works and Why Websites Need One](/blog/ai-sales-agent)\n" +
    "- [Exit Intent Detection](/blog/exit-intent)\n- [How to Build a B2B Lead Scoring System That Actually Works](/blog/lead-scoring)");
  const patch = planCorrectiveChange({} as never, page(markdown), { kind: "related_reading_titles", before: proposal.before,
    replacement: proposal.replacement, reason: "Autopilot completes cut Related reading titles." });
  assert.equal(patch.after, proposal.replacement);
  assert.equal(patch.sourceAfter, proposal.replacement, "the GitHub source changes in exactly that list");
  assert.equal(relatedReadingRepairProposal(markdown.replace(list, proposal.replacement), titles, relatedReadingTitle), null, "a repaired list needs nothing");
});

test("the repair only extends cut titles in Pentra's Related reading list", () => {
  const reason = "Autopilot completes cut Related reading titles.";
  const attempt = (replacement: string, body = markdown, kind = "github") =>
    () => planCorrectiveChange({} as never, page(body, kind), { kind: "related_reading_titles", before: list, replacement, reason });
  assert.throws(attempt(list.replace("/blog/exit-intent", "/blog/other")), /cannot change a link/);
  assert.throws(attempt(list.replace("Exit Intent Detection", "A Different Article Name")), /only completes a cut title/);
  assert.throws(attempt(list.split("\n").slice(0, 2).join("\n")), /keeps the exact list/);
  assert.throws(attempt(list), /no cut title/);
  assert.throws(attempt(list.replace("How It](", "How It Works](") , markdown.replace("## Related reading", "## Further reading")), /Only Pentra's Related reading list/);
  assert.throws(attempt(list.replace("How It](", "How It Works]("), markdown, "wordpress"), /only to a GitHub Markdown source/);
});

// P218 (Oct 26 2026): pentra.dev's Related reading lists linked pages consolidated away (P193): the site sent each to
// the surviving page under the merged page's title, and two merged pages in one list became one page linked twice
// (45 links on 19 live pages). Autopilot's repair now points such a link at the page it leads to, by that page's
// title, and drops an entry that then repeats an earlier one or leads to the page itself. Other sites keep every link.
test("P218 on pentra.dev a link to a consolidated page goes to the page it leads to; repeats and self-links go", () => {
  const selfUrl = "https://pentra.dev/blog/how-to-detect-ranking-drops-seo";
  const entries = [
    "- [How to Refresh Blog Posts for SEO](/blog/how-to-refresh-blog-posts-for-seo)",
    "- [Content Refresh SEO: An Automated Strategy](/blog/content-refresh-seo-automated-strategy)",
    "- [Why Articles Stop Ranking](/blog/why-articles-stop-ranking-content-decay)",
    "- [What Is an AI Sales Agent? How It](/blog/ai-sales-agent)",
  ];
  const merged = entries.join("\n");
  const body = `Intro paragraph that stays exactly as it was written.\n\n## Related reading\n\n${merged}\n\n## Sources\n\n1. [A source](https://example.org/a)`;
  const survivorTitle = "Article Refresh Strategy: When to Update a Post and What to Change";
  const known = new Map([...titles, ["/blog/article-refresh-strategy-guide", survivorTitle]]);
  const onSite = { domain: "pentra.dev", selfHref: "/blog/how-to-detect-ranking-drops-seo" };
  const proposal = relatedReadingRepairProposal(body, known, relatedReadingTitle, onSite)!;
  const expected = `- [${relatedReadingTitle(survivorTitle)}](/blog/article-refresh-strategy-guide)\n` +
    "- [What Is an AI Sales Agent? How It Works and Why Websites Need One](/blog/ai-sales-agent)";
  assert.equal(proposal.replacement, expected, "the first merged link leads to its page by its title; the repeat and the self-link go");
  const pentraPage = { ...(page(body) as object), url: selfUrl } as never, reason = "Autopilot repairs its Related reading list.";
  const plan = (replacement: string, site: object = { domain: "pentra.dev" }, on = pentraPage) =>
    planCorrectiveChange(site as never, on, { kind: "related_reading_titles", before: merged, replacement, reason });
  assert.equal(plan(expected).after, expected);
  assert.equal(relatedReadingRepairProposal(body.replace(merged, expected), known, relatedReadingTitle, onSite), null, "a repaired list needs nothing");
  // A repair made before P218 (cut titles completed, merged links kept) is still accepted while in flight.
  const earlier = entries.map(line => line.replace("How It](", "How It Works and Why Websites Need One](")).join("\n");
  assert.equal(plan(earlier).after, earlier);
  // Nothing else may change: another destination, a unique entry dropped, or a retarget on any other site.
  assert.throws(() => plan(expected.replace("/blog/article-refresh-strategy-guide", "/blog/some-other-page")), /cannot change a link/);
  assert.throws(() => plan(expected.split("\n")[0]), /keeps the exact list|cannot change a link/);
  assert.throws(() => plan(expected, { domain: "leadpilot.chat" }, { ...(page(body) as object), url: "https://leadpilot.chat/blog/x" } as never), /cannot change a link/);
});

// P220 (Oct 26 2026): the repair walks a site's pages in one pass, then rests a week. P218 changed its rules mid-pass on
// pentra.dev, so the pages already passed (one still links the same page twice) would have waited. A pass now records
// the rules it ran under, and a site whose last finished pass ran under earlier rules is due again.
test("P220 a change to the repair's rules runs one fresh pass over every page", () => {
  const now = Date.UTC(2026, 9, 26, 12), hour = 3_600_000;
  const site = (schedule: object) => ({ serviceMode: "growth_first", autopilotEnabled: true, publishMethod: "github",
    contentSchedule: { autopilotSelectedAt: 1, autopublishConsentAt: 1, nextDeadlineAt: now + 24 * hour, ...schedule } }) as never;
  const resting = { relatedRepairCursor: 0, relatedRepairCleanAt: now - hour };
  assert.equal(relatedRepairAllowed(site({ ...resting, relatedRepairCleanVersion: RELATED_REPAIR_VERSION }), now), false, "a pass under today's rules rests");
  assert.equal(relatedRepairAllowed(site(resting), now), true, "a pass finished before the rules had a version runs again");
  assert.equal(relatedRepairAllowed(site({ ...resting, relatedRepairCleanVersion: RELATED_REPAIR_VERSION - 1 }), now), true);
  assert.equal(relatedRepairAllowed(site({ ...resting, nextDeadlineAt: now + hour }), now), false, "still never near a slot");
});

// P221 (Oct 26 2026): the old engine also dropped a title's leading "What" before cutting it, so LeadPilot's lists read
// "Makes a B2B Qualified Lead—And How to Spot" and "Is B2B Sales? A Beginner's Guide to B2B": not a cut from the start,
// so the repair left them. A run of the title's words after a dropped leading question or filler word is a cut too.
test("P221 a title cut after a dropped leading 'What' is completed; other texts stay", () => {
  const whole = "What Makes a B2B Qualified Lead—And How to Spot One Before Sales Wastes Time";
  assert.equal(cutOfTitle("Makes a B2B Qualified Lead—And How to Spot", whole), true);
  assert.equal(cutOfTitle("Is B2B Sales? A Beginner's Guide to B2B", "What Is B2B Sales? A Beginner's Guide to B2B Sales Strategy and Lead Qualification"), true);
  assert.equal(cutOfTitle("a B2B Qualified Lead—And How", whole), false, "only the first word may be missing");
  assert.equal(cutOfTitle("Makes a", whole), false, "at least three words");
  assert.equal(cutOfTitle("Lead Scoring Template", "Free Lead Scoring Template for B2B Teams"), false, "a leading word that isn't a question or filler word stays");
  assert.equal(cutOfTitle("Exit Intent Detection: How It Works and What It Can Do for Your Website",
    "Exit Intent Detection: How It Works and What It Can (and Can't) Do for Your Website"), false, "an aside left out is not a cut");
  const entry = "- [Makes a B2B Qualified Lead—And How to Spot](/blog/b2b-qualified-lead)";
  const body = `Intro paragraph that stays exactly as it was written.\n\n## Related reading\n\n${entry}\n\n## Sources\n\n1. [A source](https://example.org/a)`;
  const proposal = relatedReadingRepairProposal(body, new Map([["/blog/b2b-qualified-lead", whole]]), relatedReadingTitle)!;
  assert.equal(proposal.replacement, `- [${whole}](/blog/b2b-qualified-lead)`);
  assert.equal(planCorrectiveChange({} as never, page(body), { kind: "related_reading_titles", before: entry, replacement: proposal.replacement,
    reason: "Autopilot completes cut Related reading titles." }).after, proposal.replacement);
});

// P222 (Oct 26 2026): every repair is a commit and every commit a deploy on the owner's hosting. Vercel's Hobby plan
// allows 100 deploys a day across the account; pentra.dev's repository feeds two projects, and two 30-minute repair
// chains plus the day's ships used them up at 11:51Z, so LeadPilot's repair (and possibly its 18:00Z refresh) could
// not go live. Repairs are two hours apart: about nine a site a day, leaving room for publications.
test("P222 link repairs are spaced to leave the owner's daily deploys for publications", () => {
  assert.ok(RELATED_REPAIR_SPACING_MS >= 2 * 3_600_000, `${RELATED_REPAIR_SPACING_MS} ms between repairs`);
  const perSiteDay = Math.ceil(18 * 3_600_000 / RELATED_REPAIR_SPACING_MS); // the window is closed 6 hours before each daily slot
  assert.ok(2 * perSiteDay + perSiteDay <= 30, "both owner sites' repairs (pentra.dev's twice) stay a small share of 100 deploys a day");
});
