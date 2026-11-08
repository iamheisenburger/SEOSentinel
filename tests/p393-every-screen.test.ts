// P393 (Nov 8 2026): every screen on the redesign's system. The assistant names in the dashboard's "By assistant" card
// fit whole ("Google AI Overviews" was cut to "Google AI Overvi…" at 1440), the Questions header says how many are
// paused (it said "32 tracked" over a list of 33), and the press images that directory listings load from
// pentra.dev/press show the new mark and screens, not the old blue pen-nib logo and the article dashboard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG (what Playwright writes) into rows of RGB pixels. */
function decodePng(path: string) {
  const b = readFileSync(path);
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20), depth = b[24]!, colour = b[25]!, interlace = b[28]!;
  assert.equal(depth, 8); assert.equal(interlace, 0); assert.ok(colour === 2 || colour === 6, `colour type ${colour}`);
  const channels = colour === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let at = 8; at < b.length;) {
    const length = b.readUInt32BE(at), type = b.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") chunks.push(b.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= channels ? out[y * stride + x - channels]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? out[(y - 1) * stride + x - channels]! : 0;
      const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
      const predictor = [0, left, up, (left + up) >> 1, pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft][filter]!;
      out[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, pixel: (x: number, y: number) => {
    const i = y * stride + x * channels; return [out[i]!, out[i + 1]!, out[i + 2]!] as const;
  } };
}

test("the By assistant card fits every assistant's full name", () => {
  const charts = readFileSync("src/components/answers/charts.tsx", "utf8");
  const width = Number(charts.match(/@\[22rem\]:w-\[(\d+)px\] @\[22rem\]:shrink-0/)?.[1]);
  // A 20px mark, an 8px gap and "Google AI Overviews" at 13px medium (about 140px) need about 170px.
  assert.ok(width >= 170, `label column is ${width}px`);
});

test("the Questions header counts the paused questions next to the tracked ones", () => {
  const questions = readFileSync("src/components/answers/dashboard/questions.tsx", "utf8");
  assert.match(questions, /const paused = overview\.questions\.filter\(\(q\) => q\.status === "paused"\)\.length;/);
  assert.match(questions, /tracked\$\{paused \? ` · \$\{paused\} paused` : ""\}/);
});

test("the press images directory listings load show the new mark and screens, not the old blue pen", () => {
  const logo = decodePng("public/press/pentra-logo-1080x1080.png");
  assert.deepEqual([logo.width, logo.height], [1080, 1080]);
  let blue = 0;
  for (let y = 0; y < logo.height; y += 6) for (let x = 0; x < logo.width; x += 6) {
    const [r, g, b] = logo.pixel(x, y);
    if (b - r > 40 && b - g > 10) blue++;
  }
  assert.equal(blue, 0, "the old logo was a blue pen nib; the new mark is light on the dark canvas");
  const [r, g, b] = logo.pixel(540, 300);
  assert.ok(r > 230 && g > 230 && b > 230, "the light rounded square sits in the middle");
  const sizes = { "screenshot-1-home.png": [1440, 900], "screenshot-2-dashboard.png": [1440, 640], "screenshot-5-pricing.png": [1440, 720] };
  for (const [file, size] of Object.entries(sizes)) {
    const shot = decodePng(`public/press/${file}`);
    assert.deepEqual([shot.width, shot.height], size, file);
    const [cr, cg, cb] = shot.pixel(700, 5);
    assert.ok(cr < 20 && cg < 20 && cb < 20, `${file} is on the redesign's dark canvas`);
  }
});
