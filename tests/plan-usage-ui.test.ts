import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("every account quota display uses the immutable account-wide usage ledger", () => {
  for (const path of [
    "src/app/(dashboard)/dashboard/page.tsx",
    "src/app/(dashboard)/plan/page.tsx",
    "src/app/(dashboard)/articles/page.tsx",
    "src/app/(dashboard)/settings/page.tsx",
  ]) {
    const page = readFileSync(path, "utf8");
    assert.match(page, /api\.articles\.countThisMonth/);
    assert.doesNotMatch(
      page,
      /articles\?\.filter\(\(a\) => a\.createdAt >= monthStart\.getTime\(\)\)/,
    );
  }
});
