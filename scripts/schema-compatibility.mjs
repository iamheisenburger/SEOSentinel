import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function gitText(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
  } catch {
    return null;
  }
}

function contracts(source) {
  const tables = new Set();
  const indexes = new Set();
  let currentTable = null;
  for (const line of source.split("\n")) {
    const table = line.match(/^\s{2}([a-zA-Z0-9_]+): defineTable\(/)?.[1];
    if (table) {
      currentTable = table;
      tables.add(table);
    }
    const index = line.match(/\.index\("([a-zA-Z0-9_]+)"/)?.[1];
    if (currentTable && index) indexes.add(`${currentTable}.${index}`);
  }
  return { tables, indexes };
}

const schemaPath = "convex/schema.ts";
const current = contracts(readFileSync(schemaPath, "utf8"));
const requestedBase = process.env.SCHEMA_BASE_REF?.trim();
const baseCandidates = [requestedBase, "origin/main", "HEAD^"]
  .filter((value, index, all) => value && all.indexOf(value) === index);
let baseText = null;
let baseRef = null;
for (const candidate of baseCandidates) {
  baseText = gitText(candidate, schemaPath);
  if (baseText !== null) {
    baseRef = candidate;
    break;
  }
}
if (!baseText || !baseRef) {
  console.error("Could not resolve a schema compatibility base.");
  process.exit(1);
}
const base = contracts(baseText);
const removed = [
  ...[...base.tables].filter((name) => !current.tables.has(name)).map((name) => `table ${name}`),
  ...[...base.indexes].filter((name) => !current.indexes.has(name)).map((name) => `index ${name}`),
];
if (removed.length) {
  console.error(`Schema compatibility failed against ${baseRef}:\n${removed.join("\n")}`);
  process.exit(1);
}
console.log(`Schema compatibility passed against ${baseRef} (${current.tables.size} tables, ${current.indexes.size} indexes).`);
