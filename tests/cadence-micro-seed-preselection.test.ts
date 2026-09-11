import assert from "node:assert/strict";
import test from "node:test";
import {
  CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES,
  selectCadenceMicroSeedCandidate,
} from "../convex/lib/cadenceMicroSeed.ts";
import {
  filterNonCannibalizingIntentTopics,
  type SerpCoverageTopic,
} from "../convex/lib/autopilotBuffer.ts";

const fingerprint = (prefix: string) => Array.from(
  { length: 5 }, (_, index) => `https://${prefix}-${index}.example/article`,
);

function select(keyword: string, coverage: SerpCoverageTopic[], exact: string[] = []) {
  return selectCadenceMicroSeedCandidate({
    seed: keyword,
    metrics: [{
      keyword, searchVolume: 70, difficulty: 5, difficultyMeasured: true,
      intent: "commercial", competition: 0.1, cpc: 1, trend: [],
    }],
    maximumDifficulty: 20,
    existingExactKeywords: new Set(exact),
    coveredTopics: coverage,
    businessFitEligible: () => true,
  });
}

test("micro-seed preselection defers fingerprinted overlap to fresh SERP evidence", () => {
  for (const [keyword, coveredKeyword] of [
    ["sales qualification process", "sales qualification frameworks"],
    ["residential construction cost estimation", "residential construction cost calculator"],
    ["invoice approval workflow", "invoice approval software"],
  ]) {
    const coverage = [{ primaryKeyword: coveredKeyword, serpTopUrls: fingerprint("existing") }];
    const result = select(keyword, coverage);
    assert.equal(result.accepted, 1, keyword);
    assert.equal(result.rejected.overlap, 0);
    assert.ok(result.acceptedCandidates.length <= CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES);

    // Preselection is not admission: missing candidate evidence still fails
    // the unchanged final gate, and only distinct fresh SERPs clear it.
    assert.equal(filterNonCannibalizingIntentTopics([{ primaryKeyword: keyword }], coverage).length, 0);
    assert.equal(filterNonCannibalizingIntentTopics([{
      primaryKeyword: keyword, serpTopUrls: fingerprint("distinct"),
    }], coverage).length, 1);
    assert.equal(filterNonCannibalizingIntentTopics([{
      primaryKeyword: keyword,
      serpTopUrls: [...fingerprint("existing").slice(0, 3), ...fingerprint("distinct").slice(0, 2)],
    }], coverage).length, 0);
  }
});

test("missing, incomplete and duplicate-only historical SERPs retain the early lexical fence", () => {
  for (const serpTopUrls of [undefined, [], fingerprint("existing").slice(0, 4), Array(5).fill("https://same.example/article")]) {
    const result = select("invoice approval workflow", [{ primaryKeyword: "invoice approval software", serpTopUrls }]);
    assert.equal(result.accepted, 0);
    assert.equal(result.rejected.overlap, 1);
  }
});

test("mixed coverage and exact reuse cannot be hidden behind one complete fingerprint", () => {
  const keyword = "invoice approval workflow";
  const complete = { primaryKeyword: "invoice approval software", serpTopUrls: fingerprint("existing") };
  assert.equal(select(keyword, [complete, { primaryKeyword: "invoice approval process" }]).rejected.overlap, 1);
  const exact = select(keyword, [complete], [keyword]);
  assert.equal(exact.accepted, 0);
  assert.equal(exact.rejected.duplicate, 1);
  assert.equal(exact.rejected.overlap, 0);
});
