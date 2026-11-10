// P405 (Nov 10 2026): answer videos in the business's own look. Arshad: "the colours do not match the theme of dawnlist
// at all ... this should be applicable for all sites." The background and text come from the site's rendered homepage,
// the accent and font from its stylesheets, and every colour pair stays readable. Cases: a white SaaS site with a pale
// amber accent (Dawnlist's kind), a dark developer-tool site, a bakery with a strong red, a black-and-white law firm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, pageColors, siteFont, videoTheme } from "../video/theme.ts";
import { corePipelineFixture } from "./helpers/core-pipeline-fixture.ts";

function page(width: number, height: number, bg: [number, number, number], ink: [number, number, number], accent: [number, number, number]) {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const isText = y % 20 < 4 && x > 40 && x < width - 40;
    const isLogo = y < 12 && x < 12;
    const c = isLogo ? accent : isText ? ink : bg;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return px;
}

test("the background and text colours come from the page as it renders", () => {
  const white = pageColors(page(200, 200, [255, 255, 255], [28, 29, 31], [226, 163, 59]), 200, 200);
  assert.equal(white.background, "#FFFFFF");
  assert.equal(white.text, "#1C1D1F");
  const dark = pageColors(page(200, 200, [12, 13, 16], [236, 238, 241], [94, 106, 210]), 200, 200);
  assert.equal(dark.background, "#0C0D10");
  assert.equal(dark.text, "#ECEEF1");
});

test("the site's font is found from its body, a next/font variable or any font-family", () => {
  assert.equal(siteFont(["body{background:var(--bg);color:var(--ink);font-family:var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif}"]), "Geist");
  assert.equal(siteFont([".x{color:red} body { font-family: 'Plus Jakarta Sans', sans-serif; }"]), "Plus Jakarta Sans");
  assert.equal(siteFont(["h1{font-family:\"DM Sans\",Arial}"]), "DM Sans");
  assert.equal(siteFont(["body{font-family:Georgia, serif}"]), null, "a font the video can't load is left to the default");
});

test("every colour pair stays readable: a pale accent marks words, a strong one colours them, buttons follow suit", () => {
  const dawn = videoTheme({ background: "#FFFFFF", text: "#1C1D1F", accent: "#E2A33B", font: "Geist" });
  assert.deepEqual([dawn.mode, dawn.emphasis, dawn.font], ["light", "marker", "Geist"], "amber on white is too pale for text: it marks words");
  const bakery = videoTheme({ background: "#FFF8F0", text: "#2A1A12", accent: "#C8102E" });
  assert.deepEqual([bakery.mode, bakery.emphasis], ["light", "color"], "a strong red reads on cream: it colours words");
  assert.ok(contrast(bakery.accentInk, bakery.accent) >= 4.5, "text on the accent button is readable");
  const devtool = videoTheme({ background: "#0C0D10", text: "#ECEEF1", accent: "#5E6AD2" });
  assert.equal(devtool.mode, "dark");
  const lawFirm = videoTheme({ background: "#FFFFFF", text: "#111111", accent: null });
  assert.equal(lawFirm.accent, "#111111", "without a brand colour, the text colour leads");
  const unreadable = videoTheme({ background: "#FFFFFF", text: "#DDDDDD", accent: null });
  assert.ok(contrast(unreadable.text, unreadable.background) >= 4.5, "a text colour that wouldn't read is replaced");
  for (const t of [dawn, bakery, devtool, lawFirm]) assert.ok(contrast(t.text, t.background) >= 4.5);
});

test("a video made before P405 gets its look read once, and keeps it", async () => {
  const f = corePipelineFixture(async () => new Response("{}", { status: 200 }), {}, {});
  const now = f.now();
  const siteId = f.add("sites", { domain: "https://www.sourdoughco.example/", userId: "user_bakery", siteName: "Sourdough Co", publishMethod: "manual",
    answers: { enabled: true, enabledAt: now, source: "signup" }, createdAt: now, updatedAt: now });
  const videoId = f.add("answer_videos", { siteId, question: "Where can I buy real sourdough in Leeds?", status: "ready", version: 2, createdAt: now, updatedAt: now,
    costMicroUsd: 0, accent: "#3DA5F5" });
  assert.deepEqual(await f.invoke("answerGrowthKit:videoLookState", { videoId }), { domain: "sourdoughco.example", screenshotId: null, hasTheme: false });
  const theme = videoTheme({ background: "#FFF8F0", text: "#2A1A12", accent: "#C8102E", font: "DM Sans" });
  await f.invoke("answerGrowthKit:saveVideoLook", { videoId, theme });
  assert.deepEqual(f.get(videoId)!.theme, theme);
  assert.equal(f.get(videoId)!.accent, "#C8102E");
  assert.equal((await f.invoke("answerGrowthKit:videoLookState", { videoId })).hasTheme, true);
});
