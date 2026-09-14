import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildSync } from "esbuild";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) return [];
    return entry.isDirectory() ? sources(path) : entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

test("all Convex isolate entries bundle without Node-only transport imports", () => {
  const entryPoints = sources("convex").filter(path => !/^\s*["']use node["'];/m.test(readFileSync(path, "utf8")));
  assert.ok(entryPoints.length > 100);
  // Convex builds every helper as an entry, not only registered query exports.
  // Browser-platform resolution reproduces missing node:dns/https/net markers
  // locally without deployment credentials, network calls or generated files.
  assert.doesNotThrow(() => buildSync({ entryPoints, bundle: true, platform: "browser",
    format: "esm", outdir: "/unused-convex-test-output", write: false, logLevel: "silent", conditions: ["convex", "module"] }));
});
