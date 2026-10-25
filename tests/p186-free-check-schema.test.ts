// P186 (Oct 25 2026): P184 added "verified" to the free check's diagnostics but not to the free_checks table, so
// every check's final write was refused by the schema and the check stayed "running" at its last step. The fixture
// does not validate writes against the schema, so the table and the check's diagnostics must agree field for field.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
function load(name: string): Record<string, unknown> {
  const code = buildSync({ entryPoints: [`convex/${name}.ts`], bundle: true, platform: "node", format: "cjs", write: false,
    external: ["@anthropic-ai/sdk", "openai", "zod", "convex/*", "@clerk/backend", "nodemailer", "imapflow", "mailparser"] }).outputFiles[0].text;
  const bundle = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", code)(bundle, bundle.exports, require);
  return bundle.exports;
}
type FieldJson = { fieldType: { type: string; value?: Record<string, FieldJson> }; optional: boolean };

test("the free_checks table stores every diagnostics field a check writes", () => {
  const schema = JSON.parse((load("schema").default as { export: () => string }).export());
  const table = schema.tables.find((t: { tableName: string }) => t.tableName === "free_checks");
  const stored = (table.documentType.value.diagnostics as FieldJson).fieldType.value!;
  const written = (load("freeCheck").checkDiagnostics as { json: { value: Record<string, FieldJson> } }).json.value;
  assert.deepEqual(Object.keys(stored).sort(), Object.keys(written).sort());
  assert.ok("verified" in stored, "the live Google check's counts (P184)");
  assert.deepEqual(stored.verified, written.verified);
});
