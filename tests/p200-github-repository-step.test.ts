// P200 (Oct 26 2026): one of the first real signups connected GitHub and never chose a repository (P198's funnel counts).
// When GitHub's list was empty, or failed, the Publishing editor showed only two empty boxes and no reason.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/(dashboard)/sites/[siteId]/page.tsx", "utf8");

test("an empty or failed GitHub repository list says why and what to do", () => {
  assert.match(page, /const \[repoListError, setRepoListError\] = useState<string \| null>\(null\);/);
  assert.match(page, /\.catch\(\(error\) => \{ if \(live\) \{ setRepoListError\(userErrorMessage\(error, GITHUB_LIST_FAILED\)\); setRepoChoices\(\[\]\); \} \}\);/,
    "a failed list is no longer silently an empty one");
  assert.match(page, /\{isGithub && hasGithubToken && repoChoices && repoChoices\.length === 0 && \(\s*<p role="status"[^>]*>\{repoListError \?\? NO_GITHUB_REPOSITORIES\}<\/p>/);
  const none = /const NO_GITHUB_REPOSITORIES = ([\s\S]*?);\n/.exec(page)?.[1] ?? "";
  assert.match(none, /no repository Pentra can publish to/);
  assert.match(none, /approve Pentra for that organization in GitHub/, "organization repositories need the organization's approval");
  assert.match(none, /choose the platform it runs on above, or Copy & Paste/, "a site not built from GitHub has a way forward");
});
