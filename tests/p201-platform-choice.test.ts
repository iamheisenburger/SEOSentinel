// P201 (Oct 26 2026): new sites default to GitHub, so a fresh site's Publishing settings opened on "GitHub not connected:
// Connect", and an owner on WordPress, Shopify, Webflow or Ghost had to find Edit to switch. One of the first real
// signups stopped inside GitHub's step (P198's counts). A site set up through the content service with nothing
// connected yet first says where it runs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/(dashboard)/sites/[siteId]/page.tsx", "utf8");

test("a new site with nothing connected is asked where its website runs before anything says GitHub", () => {
  assert.match(page, /const choosingPlatform = Boolean\(site\.contentSetupRequestedAt\) && method === "github" && !hasGithubToken && !site\.repoOwner && !editing;/);
  assert.match(page, /\{choosingPlatform \? "Not connected yet" : labels\[method\] \|\| method\}/, "the heading doesn't claim GitHub");
  assert.match(page, /\{isGithub && !choosingPlatform && \(/, "the GitHub status box waits for the choice");
  assert.match(page, /<p className="[^"]*">Where does your website run\?<\/p>/);
  const choices = /const PLATFORM_CHOICES[^=]*= (\[[^\n]*\]);/.exec(page)?.[1] ?? "";
  for (const platform of ["wordpress", "shopify", "webflow", "ghost"]) assert.ok(choices.includes(`"${platform}"`), platform);
  assert.match(page, /<button onClick=\{connectGithub\} className=\{PLATFORM_CHOICE_CLS\}>GitHub \(a Markdown blog in content\/blog\)<\/button>/);
  assert.match(page, /<button onClick=\{\(\) => choose\("manual"\)\} className=\{PLATFORM_CHOICE_CLS\}>Something else: paste the articles yourself<\/button>/);
  assert.match(page, /const choose = \(value: string\) => \{ setConnectionError\(null\); setConnectionVerified\(false\); setMethod\(value\); setEditing\(true\); \};/,
    "a choice opens that platform's connection form");
});
