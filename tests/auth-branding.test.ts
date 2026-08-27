import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Regression for unbranded authentication.
 *
 * Protected routes are guarded with auth.protect(). Without an explicit
 * signInUrl, Clerk redirects to its hosted Account Portal on
 * accounts.pentra.dev, which shows a generic card with no Pentra logo, no
 * product context and a "Secured by Clerk" footer — while the branded pages
 * already existed at /sign-in and /sign-up and were never reached.
 *
 * The first screen an unauthenticated customer sees is the product.
 */

const layout = readFileSync(
  new URL("../src/app/layout.tsx", import.meta.url),
  "utf8",
);

test("Clerk redirects to Pentra's own sign-in, never the hosted portal", () => {
  assert.match(layout, /signInUrl=["']\/sign-in["']/);
  assert.match(layout, /signUpUrl=["']\/sign-up["']/);
});

test("the branded auth pages exist and carry Pentra context", () => {
  for (const [route, heading] of [
    ["sign-in", /Welcome back/],
    ["sign-up", /./],
  ] as const) {
    const page = readFileSync(
      new URL(`../src/app/${route}/[[...${route}]]/page.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(page, /Pentra/, `${route} must name the product`);
    assert.match(page, heading);
  }
});
