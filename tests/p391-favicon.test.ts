// P391 (Nov 8 2026): the browser tab, search results and iOS home screen show the redesign's mark (a line of an answer
// with one name highlighted), never the old pen-nib logo. The favicon is drawn from the same paths as PentraMark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pngSize = (path: string) => { const b = readFileSync(path); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };

test("the favicon is the redesign's mark, drawn from the same paths as PentraMark", () => {
  const mark = readFileSync("src/components/marketing/wordmark.tsx", "utf8");
  const svg = readFileSync("src/app/icon.svg", "utf8");
  const paths = [...mark.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 4);
  for (const d of paths) assert.ok(svg.includes(`d="${d}"`), d);
  assert.match(svg, /rx="5\.5"/);
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/, "the white mark on dark tabs, the dark mark on light tabs");
  assert.deepEqual(pngSize("src/app/icon.png"), { width: 512, height: 512 }, "not the old 864px pen-nib icon");
  assert.deepEqual(pngSize("src/app/apple-icon.png"), { width: 180, height: 180 });
  const ico = readFileSync("src/app/favicon.ico");
  assert.equal(ico.readUInt16LE(4), 3, "16, 32 and 48 px");
});
