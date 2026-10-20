import assert from "node:assert/strict";
import test from "node:test";

import { pushableGithubRepositories } from "../convex/lib/githubRepositories.ts";

// D3 (Phase 4, Oct 20 2026): after connecting GitHub the owner picks the
// repository Pentra publishes to instead of typing its owner and name.
test("D3 the repo picker offers only repositories the account can push to", () => {
  const listed = pushableGithubRepositories([
    { name: "website", owner: { login: "acme" }, private: true, permissions: { push: true } },
    { name: "docs", owner: { login: "acme" }, private: false, permissions: { push: false } },
    { name: "old-blog", owner: { login: "acme" }, archived: true, permissions: { push: true } },
    { name: "marketing-site", owner: { login: "acme-org" }, permissions: { push: true } },
    { owner: { login: "acme" }, permissions: { push: true } },
    null,
  ]);
  assert.deepEqual(listed, [
    { owner: "acme", name: "website", private: true },
    { owner: "acme-org", name: "marketing-site", private: false },
  ]);
  assert.deepEqual(pushableGithubRepositories({ message: "Bad credentials" }), []);
});
