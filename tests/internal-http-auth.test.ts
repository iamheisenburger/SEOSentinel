import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedInternalBearer } from "../convex/lib/internalHttpAuth.ts";

test("internal HTTP auth accepts either secret during a bounded rotation", () => {
  assert.equal(
    isAuthorizedInternalBearer("Bearer current-secret", [
      "current-secret",
      "next-secret",
    ]),
    true,
  );
  assert.equal(
    isAuthorizedInternalBearer("Bearer next-secret", [
      "current-secret",
      "next-secret",
    ]),
    true,
  );
});

test("internal HTTP auth rejects empty, malformed, and unknown credentials", () => {
  for (const authorization of [
    null,
    "",
    "current-secret",
    "Basic current-secret",
    "Bearer ",
    "Bearer unknown-secret",
  ]) {
    assert.equal(
      isAuthorizedInternalBearer(authorization, [
        "current-secret",
        undefined,
      ]),
      false,
    );
  }
  assert.equal(
    isAuthorizedInternalBearer("Bearer anything", [undefined, "   "]),
    false,
  );
});
