import { test } from "node:test";
import assert from "node:assert/strict";

// P153 (Oct 21 2026): the Compost Notes test site's first article listed a University of Georgia Extension
// circular in its Sources as "C 1097 2", the PDF's file name.
test("a source titled with a file name is shown as the site it comes from; real titles are kept", async () => {
  const { readableSourceTitle } = await import("../convex/lib/sourceQuality.ts");
  assert.equal(readableSourceTitle("C 1097 2", "https://secure.caes.uga.edu/extension/publications/files/pdf/C%201097_2.PDF"), "caes.uga.edu (PDF)");
  assert.equal(readableSourceTitle(undefined, "https://www.extension.psu.edu/composting-poultry-manure"), "extension.psu.edu");
  assert.equal(readableSourceTitle("Using Chicken Manure Safely in Home Gardens and Landscapes", "https://extension.unr.edu/publication.aspx?PubID=3028"),
    "Using Chicken Manure Safely in Home Gardens and Landscapes");
  assert.equal(readableSourceTitle("Extension Publications (ASC-242)", "https://publications.mgcafe.uky.edu/asc-242"), "Extension Publications (ASC-242)");
  assert.equal(readableSourceTitle("Lead  scoring", "https://docs.oracle.com/lead-scoring.pdf"), "Lead scoring");
});
