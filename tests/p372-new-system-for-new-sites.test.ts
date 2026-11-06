/** P372 (Nov 6 2026, Arshad): the whole new system opens to every site added from now on (and the landing page says what
 * it does). Sites added before keep what they signed up for: their owners are asked first (and Estiflow is never touched). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEW_SYSTEM_START, topicChoiceRollout } from "../convex/lib/topicVerdict.ts";

test("a site added after the opening is marked and runs every engine; one added before is not changed", () => {
  assert.equal(NEW_SYSTEM_START, Date.UTC(2026, 10, 6, 3));
  assert.equal(topicChoiceRollout("newcustomer.example", NEW_SYSTEM_START + 1000), true);
  assert.equal(topicChoiceRollout("oldcustomer.example"), false);
  assert.equal(topicChoiceRollout("pentra.dev"), true);
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(sites, /\.\.\.\(now\(\) >= NEW_SYSTEM_START \? \{ newSystemAt: now\(\) \} : \{\}\),/, "marked only when created after the opening");
  assert.doesNotMatch(sites, /patch\([^)]*newSystemAt/, "no existing site is ever switched by code");
  const diagnosis = readFileSync("convex/siteDiagnosis.ts", "utf8");
  assert.match(diagnosis, /typeof site\.newSystemAt === "number" \|\| DIAGNOSIS_ROLLOUT_DOMAINS\.includes\(bareDomain\(site\.domain\)\);/);
  const engines = ["convex/contentWork.ts", "convex/selectedPages.ts", "convex/searchSnippets.ts", "convex/actions/siteDiagnosis.ts", "convex/contentHealth.ts", "convex/actions/growthTopics.ts"];
  for (const f of engines) assert.doesNotMatch(readFileSync(f, "utf8"), /topicChoiceRollout\([^,()]*(?:\([^()]*\))?[^,()]*\)/, `${f}: every switch reads the site's mark`);
});
