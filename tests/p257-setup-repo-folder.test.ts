// P257 (Oct 30 2026): Cowork's fresh-account setup (ops/COWORK-FRESH-ACCOUNT-RESULTS-OCT30.md, items 8b and 13): Settings
// said articles go to content/blog in a Jekyll repository Pentra had never read; after switching from a Contentful template
// to that repository the Contentful message stayed; and Start was disabled with no word. A repository's result now belongs
// to that repository, Settings says what Pentra found or that it hasn't checked, and Start says why it can't start.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { currentGithubBlog, githubBlogNote } from "../convex/lib/githubBlogState.ts";

const site = { publishMethod: "github", repoOwner: "madmanhakim", repoName: "madmanhakim.github.io" };
const contentful = { reason: "headless_cms", detail: "Your blog's posts come from Contentful.", at: 1 };

test("P257 only the current repository's result counts", () => {
  assert.deepEqual(currentGithubBlog({ ...site, githubLayoutFailure: { ...contentful, repo: "madmanhakim/pentra-cms-test" } }), { layout: null, failure: null });
  assert.deepEqual(currentGithubBlog({ ...site, githubLayoutFailure: { ...contentful, repo: "madmanhakim/madmanhakim.github.io" } }).failure,
    { reason: "headless_cms", detail: "Your blog's posts come from Contentful." });
  assert.ok(currentGithubBlog({ ...site, githubLayoutFailure: contentful }).failure, "a failure from before P257 stands until the next check");
  assert.deepEqual(currentGithubBlog({ ...site, publishMethod: "manual", githubLayoutFailure: contentful }), { layout: null, failure: null },
    "a site that pastes its articles shows no repository message");
  assert.equal(currentGithubBlog({ ...site, githubLayout: { framework: "jekyll", postsDir: "_posts", repo: "madmanhakim/other" } }).layout, null);
  assert.deepEqual(currentGithubBlog({ ...site, githubLayout: { framework: "jekyll", postsDir: "_posts", repo: "madmanhakim/madmanhakim.github.io" } }).layout,
    { framework: "jekyll", postsDir: "_posts" });
});

test("P257 Settings says what Pentra found, why it can't publish there, or that it hasn't checked: never a default folder for a new site", () => {
  assert.deepEqual(githubBlogNote({ ...site, githubLayout: { postsDir: "_posts", repo: "madmanhakim/madmanhakim.github.io" } }, false), { state: "detected", postsDir: "_posts" });
  assert.equal(githubBlogNote({ ...site, githubLayoutFailure: { ...contentful, repo: "madmanhakim/madmanhakim.github.io" } }, false)!.state, "failed");
  assert.deepEqual(githubBlogNote(site, false), { state: "unchecked" });
  assert.deepEqual(githubBlogNote(site, true), { state: "existing" }, "a site that already publishes keeps its folder (pentra.dev, LeadPilot)");
  assert.equal(githubBlogNote({ ...site, publishMethod: "manual" }, false), null);
  const settings = readFileSync("src/app/(dashboard)/sites/[siteId]/page.tsx", "utf8");
  assert.doesNotMatch(settings, /site\.githubLayout\?\.postsDir \?\? githubContentFolder/);
  assert.match(settings, /site\.githubBlog\?\.state === "failed"/);
  assert.match(settings, /connectionVerified && site\.githubBlog\?\.state !== "failed" && <p role="status"/);
});

test("P257 a new repository is read afresh, and the pause between checks is per repository", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(sites, /patch\.repoDefaultBranch = undefined;[\s\S]{0,300}patch\.githubLayout = undefined;\n    patch\.githubLayoutFailure = undefined;/);
  const detect = readFileSync("convex/githubLayoutDetect.ts", "utf8");
  assert.match(detect, /githubLayoutFailure: \{ \.\.\.failure, repo, at: Date\.now\(\) \}/);
  assert.match(detect, /site\.githubLayoutFailure\.repo === `\$\{site\.repoOwner\}\/\$\{site\.repoName\}` \? site\.githubLayoutFailure\.at : null/);
});

test("P257 Start never does nothing silently", () => {
  const choice = readFileSync("src/components/pentra-setup-choice.tsx", "utf8");
  assert.match(choice, /: noBlog \? "Pentra can't publish to this repository's blog \(see above\)\. Choose Review and paste instead, or try another repository\." : null;/);
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /if \(blog\.failure\) throw new ConvexError\(/);
  assert.doesNotMatch(work, /throw new Error\("(?:Confirm the current business and audience first|Connect a supported website destination first|Verify the exact website connection first|Current plan entitlement is required)"\)/);
});
