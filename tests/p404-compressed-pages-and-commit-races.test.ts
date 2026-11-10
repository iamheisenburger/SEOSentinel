// P404 (Nov 10 2026): two general causes behind two of Dawnlist's comparison pages. BuiltWith's server sent its pages
// compressed though Pentra asked for none, and the bytes were read as text ("unreadable compressed binary data"); and two
// pages committed to the same GitHub branch at once, so the second was refused with 409 and left unpublished.
import { test } from "node:test";
import assert from "node:assert/strict";
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import { decodeBody } from "../convex/lib/safeOutbound.ts";
import { retryOnConflict } from "../convex/lib/retryOnConflict.ts";

test("a page sent compressed anyway is read as text, in every encoding servers use", () => {
  const html = "<html><head><title>Lone Star Roofing</title></head><body>Roof repairs in Austin.</body></html>";
  const raw = Buffer.from(html);
  assert.equal(decodeBody(gzipSync(raw), "gzip", 1_000_000).toString(), html);
  assert.equal(decodeBody(brotliCompressSync(raw), "br", 1_000_000).toString(), html);
  assert.equal(decodeBody(deflateSync(raw), "deflate", 1_000_000).toString(), html);
  assert.equal(decodeBody(deflateRawSync(raw), "deflate", 1_000_000).toString(), html, "raw deflate, as some servers send it");
  assert.equal(decodeBody(raw, "", 1_000_000).toString(), html);
  assert.equal(decodeBody(raw, "identity", 1_000_000).toString(), html);
  assert.equal(decodeBody(gzipSync(raw), "identity, gzip", 1_000_000).toString(), html);
});

test("a compressed body can't expand without bound", () => {
  const bomb = gzipSync(Buffer.alloc(20_000_000, 0));
  assert.throws(() => decodeBody(bomb, "gzip", 256_000));
});

test("a commit that lost a race is retried; any other answer returns at once", async () => {
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  let calls = 0;
  const won = await retryOnConflict(async () => ({ status: ++calls < 3 ? 409 : 201 }), 4, wait);
  assert.deepEqual([won.status, calls, waits.length], [201, 3, 2]);
  calls = 0;
  const refused = await retryOnConflict(async () => { calls++; return { status: 403 }; }, 4, wait);
  assert.deepEqual([refused.status, calls], [403, 1], "a real refusal isn't retried");
  calls = 0;
  const lost = await retryOnConflict(async () => { calls++; return { status: 409 }; }, 4, wait);
  assert.deepEqual([lost.status, calls], [409, 4], "it gives up after four tries");
});
