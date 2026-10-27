// P224 (Oct 27 2026): pentra.dev's blog renders from Convex; the article files Pentra commits under content/ (every
// article and link repair) triggered a full Vercel build each time: one of the account's 100 daily deploys spent and
// Next's data cache purged (the 2.4 MB blog listing and sitemap re-read from Convex). A commit that changes nothing
// outside content/ since the last deployed commit now skips the build; anything else, or any doubt, builds.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/vercel-ignore-build.sh");
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "pentra-ignore-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.org" } }).trim();
  git("init", "-q");
  mkdirSync(join(dir, "src")); mkdirSync(join(dir, "content/blog"), { recursive: true });
  writeFileSync(join(dir, "src/page.tsx"), "export const a = 1;\n");
  writeFileSync(join(dir, "content/blog/first.md"), "# First\n");
  git("add", "."); git("commit", "-q", "-m", "code and content");
  const commit = (path: string, body: string, message: string) => {
    writeFileSync(join(dir, path), body); git("add", "."); git("commit", "-q", "-m", message); return git("rev-parse", "HEAD");
  };
  return { dir, head: () => git("rev-parse", "HEAD"), commit };
}
const decide = (dir: string, previous?: string) => spawnSync("bash", [script], { cwd: dir, encoding: "utf8",
  env: { ...process.env, ...(previous === undefined ? { VERCEL_GIT_PREVIOUS_SHA: "" } : { VERCEL_GIT_PREVIOUS_SHA: previous }) } }).status;

test("P224 a commit that only changes pentra.dev's article files skips the Vercel build; code changes and doubt build", () => {
  assert.equal(JSON.parse(readFileSync("vercel.json", "utf8")).ignoreCommand, "bash scripts/vercel-ignore-build.sh");
  const r = repo(), deployed = r.head();
  r.commit("content/blog/second.md", "# Second\n", "Pentra publish: second");
  r.commit("content/blog/first.md", "# First, repaired\n", "Pentra improve: first");
  assert.equal(decide(r.dir, deployed), 0, "only article files changed since the last deployed commit: skipped");
  r.commit("src/page.tsx", "export const a = 2;\n", "code change");
  assert.equal(decide(r.dir, deployed), 1, "a code change since the last deploy builds, even after content commits");
  assert.equal(decide(r.dir), 1, "no previous deployment known: builds");
  assert.equal(decide(r.dir, "0123456789abcdef0123456789abcdef01234567"), 1, "an unknown previous commit: builds");
});
