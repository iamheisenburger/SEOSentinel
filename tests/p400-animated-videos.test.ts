// P400 (Nov 10 2026): animated answer videos rendered by Pentra. The scenes are checked (a hook first, a call to action
// last, at most one product scene, emphasis only on words the heading has), the brand's colour is read from its own
// site, and every scene lasts exactly as long as its own voice, with captions timed inside it. Cases from other trades:
// a Lisbon dental clinic (oklch colours), a Texas roofer (hex), a black-and-white law firm (no strong colour).
import { test } from "node:test";
import assert from "node:assert/strict";
import { brandAccent, parseVideoScenes, videoScenesRequest } from "../convex/lib/growthKit.ts";
import { captionPages, sceneFrames, timedCaptions, totalFrames, LEAD_FRAMES, TAIL_FRAMES, TRANSITION_FRAMES } from "../video/types.ts";

const scene = (kind: string, heading: string, narration: string, items: string[] = [], emphasis: string[] = []) => ({ kind, heading, narration, items, emphasis });
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";

test("the scenes are kept only in a shape a video can show", () => {
  const good = parseVideoScenes({ title: "How to fix a leaking roof", description: "d", tags: ["roof"], scenes: [
    scene("hook", "How do I fix a leaking roof?", words(20), [], ["leaking", "missing"]),
    scene("steps", "Find the leak first", words(40), ["Check the attic", "Look for stains", "Mark the spot", "Call a roofer", "Fifth is cut"]),
    scene("product", "Lone Star Roofing fixes it", words(30), ["Same-week repairs"]),
    scene("product", "A second product scene", words(10)),
    scene("checklist", "Signs it's urgent", words(30), ["Sagging", "Daylight", "Wet insulation"]),
    scene("cta", "Free inspections in Austin", words(15)),
  ] });
  assert.ok(good);
  assert.deepEqual(good!.scenes.map((s) => s.kind), ["hook", "steps", "product", "checklist", "cta"], "one product scene at most");
  assert.equal(good!.scenes[1].items.length, 4, "a list keeps four items at most");
  assert.deepEqual(good!.scenes[0].emphasis, ["leaking"], "emphasis only on words the heading has");
  assert.equal(parseVideoScenes({ title: "t", description: "d", scenes: [scene("steps", "x", words(90)), scene("cta", "y", words(40)), scene("hook", "z", words(10)), scene("statement", "w", words(10))] }), null,
    "a video starts with its hook");
  assert.equal(parseVideoScenes({ title: "t", description: "d", scenes: [scene("hook", "a", words(5)), scene("statement", "b", words(5)), scene("steps", "c", words(5)), scene("cta", "d", words(5))] }), null,
    "too little narration for a video");
  const req = videoScenesRequest({ question: "How do I fix a leaking roof?", businessName: "Lone Star Roofing", domain: "lonestarroofing.example", productEvidence: "Roof repairs in Austin." });
  assert.match(req.system, /never invent a feature, price, number, customer or result/);
  assert.match(req.system, /hook: always first/);
  assert.match(req.system, /cta: always last/);
});

test("the brand's colour is the strong colour its own site uses most, in any notation", () => {
  assert.equal(brandAccent([".btn{background:#E2A33B}.a{color:#e2a33b}.b{color:#2F62D0}", "<div style='color:#ffffff'></div>"]), "#E2A33B");
  const clinic = brandAccent([":root{--primary:oklch(0.62 0.17 155);--ring:oklch(0.62 0.17 155);--muted:oklch(0.97 0 0)}"]);
  assert.ok(clinic && /^#[0-9A-F]{6}$/.test(clinic), "oklch converts to a hex colour");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(clinic!.slice(i, i + 2), 16));
  assert.ok(g > r && g > b, "a green oklch stays green");
  assert.equal(brandAccent(["body{color:rgb(220, 38, 38)} a{color:rgba(220,38,38,.9)}"]), "#DC2626");
  assert.equal(brandAccent(["body{color:#111111;background:#FAFAFA;border-color:#E5E5E5}"]), null, "a black-and-white site has no strong colour");
});

test("every scene lasts as long as its own voice, and captions are timed inside it", () => {
  const scenes = [{ audioMs: 3000 }, { audioMs: 6000 }, { audioMs: 2000 }];
  assert.equal(sceneFrames({ audioMs: 3000 }), LEAD_FRAMES + 90 + TAIL_FRAMES + TRANSITION_FRAMES);
  assert.equal(totalFrames(scenes), scenes.reduce((n, s) => n + sceneFrames(s), 0) - 2 * TRANSITION_FRAMES);
  const caps = timedCaptions("Check the attic first. Then mark the wet spot.", 4000);
  assert.equal(caps.length, 9);
  assert.equal(caps[0].startMs, 0);
  assert.equal(caps[caps.length - 1].endMs, 4000);
  assert.ok(caps.every((c, i) => i === 0 || c.startMs === caps[i - 1].endMs), "words follow each other without gaps");
  assert.ok(caps[3].endMs - caps[3].startMs > caps[2].endMs - caps[2].startMs, "a sentence end holds a little longer");
  const pages = captionPages(timedCaptions("How do small agencies find their very first paying clients without ads? Ask.", 5000));
  assert.deepEqual(pages.map((p) => p.length), [6, 6, 1], "a long sentence splits into balanced pages; a new sentence starts a new page");
});
