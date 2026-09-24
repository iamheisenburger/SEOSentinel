import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// The one-click download must always contain the exact current connector.
test("the downloadable WordPress plugin ZIP matches the connector source", () => {
  const zip = readFileSync("public/pentra-wordpress-plugin.zip");
  const source = readFileSync("connectors/wordpress/pentra-conditional-publisher.php");
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "local file header");
  const method = zip.readUInt16LE(8), compressed = zip.readUInt32LE(18), nameLength = zip.readUInt16LE(26), extra = zip.readUInt16LE(28);
  const name = zip.subarray(30, 30 + nameLength).toString("utf8");
  assert.equal(name, "pentra-conditional-publisher/pentra-conditional-publisher.php");
  const body = zip.subarray(30 + nameLength + extra, 30 + nameLength + extra + compressed);
  const content = method === 8 ? inflateRawSync(body) : body;
  assert.ok(content.equals(source), "rebuild public/pentra-wordpress-plugin.zip after changing the connector");
});
