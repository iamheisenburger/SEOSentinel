import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { createElement, Fragment, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const code = buildSync({ entryPoints: ["src/components/ui/input.tsx"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false,
  jsx: "automatic" }).outputFiles[0].text;
const runtime = { exports: {} as Record<"Input" | "Textarea", ComponentType<Record<string, unknown>>> };
runInNewContext(code, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url) });

for (const name of ["Input", "Textarea"] as const) {
  test(`${name} associates its visible label and error while preserving caller-provided help`, () => {
    const html = renderToStaticMarkup(createElement(runtime.exports[name], {
      id: "customer-field", label: "Customer field", error: "Required field",
      "aria-describedby": "customer-help", defaultValue: "unchanged",
    }));
    assert.match(html, /<label for="customer-field"/);
    assert.match(html, /id="customer-field"/);
    const errorId = html.match(/<p id="([^"]+)"/)?.[1];
    assert.ok(errorId);
    assert.ok(html.includes(`aria-describedby="customer-help ${errorId}"`));
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /unchanged/);
  });
  test(`${name} generates distinct IDs without introducing a false error state`, () => {
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(runtime.exports[name], { label: "First" }),
      createElement(runtime.exports[name], { label: "Second" })));
    const labels = [...html.matchAll(/<label for="([^"]+)"/g)].map(match => match[1]);
    assert.equal(labels.length, 2);
    assert.equal(new Set(labels).size, 2);
    for (const id of labels) assert.ok(html.includes(`id="${id}"`));
    assert.doesNotMatch(html, /aria-invalid|aria-describedby/);
  });
}
