import assert from "node:assert/strict";
import test from "node:test";

import { dataForSeoLanguageCode } from "../convex/lib/dataForSeoLocale.ts";

test("tenant locales are normalized to DataForSEO base language codes", () => {
  assert.equal(dataForSeoLanguageCode("en-AU"), "en");
  assert.equal(dataForSeoLanguageCode("fa_IR"), "fa");
  assert.equal(dataForSeoLanguageCode("DE"), "de");
  assert.equal(dataForSeoLanguageCode(""), "en");
  assert.equal(dataForSeoLanguageCode("english"), "en");
});
