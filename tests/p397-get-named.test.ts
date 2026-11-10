// P397 (Nov 10 2026): Get named. The map of pages the assistants read, sorted by what can be done about each; the threads
// worth a reply; the reply's request (facts only from the business's own profile, disclosure, never posted by Pentra).
// Cases from other trades and countries: a Toronto physio, a Berlin language school, a US roofing company.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isThread, kindTotals, parsePostDraft, platformOf, postCandidates, postDraftRequest, redditThreadText, sourceKind, sourceMap } from "../convex/lib/answerGrowth.ts";

test("each page the assistants read is sorted by what can be done about it", () => {
  const rivals = ["roofmax.com"];
  assert.equal(sourceKind("www.reddit.com", rivals), "community");
  assert.equal(sourceKind("quora.com", rivals), "community");
  assert.equal(sourceKind("youtube.com", rivals), "video");
  assert.equal(sourceKind("g2.com", rivals), "directory");
  assert.equal(sourceKind("yelp.ca", rivals), "directory");
  assert.equal(sourceKind("linkedin.com", rivals), "social");
  assert.equal(sourceKind("blog.roofmax.com", rivals), "rival");
  assert.equal(sourceKind("homeguide.example.org", rivals), "article");
});

test("the map counts each page once per answer, most-cited first, never the business's own pages", () => {
  const src = (url: string, own = false) => ({ url, domain: new URL(url).hostname, own, title: url.includes("reddit") ? "Best physio in Toronto?" : undefined });
  const checks = [
    { status: "answered", question: "Who is the best physio in Toronto for back pain?", assistant: "chatgpt",
      sources: [src("https://www.reddit.com/r/toronto/comments/abc123/best_physio/"), src("https://www.reddit.com/r/toronto/comments/abc123/best_physio/"), src("https://kingwestphysio.ca/back", true)] },
    { status: "answered", question: "Physio for sports injuries in Toronto?", assistant: "perplexity",
      sources: [src("https://www.reddit.com/r/toronto/comments/abc123/best_physio/"), src("https://healthguide.example.ca/physio")] },
    { status: "error", question: "x", assistant: "gemini", sources: [src("https://ignored.example.com/a")] },
  ];
  const map = sourceMap(checks, []);
  assert.deepEqual(map.map((s) => [s.url, s.answers, s.kind]), [
    ["https://www.reddit.com/r/toronto/comments/abc123/best_physio/", 2, "community"],
    ["https://healthguide.example.ca/physio", 1, "article"],
  ]);
  assert.deepEqual(map[0].assistants, ["chatgpt", "perplexity"]);
  assert.equal(map[0].questions.length, 2);
  assert.equal(map[0].title, "Best physio in Toronto?");
  assert.equal(kindTotals(map).community, 2);
});

test("only real threads are offered for a reply, never one already drafted", () => {
  assert.equal(isThread("https://www.reddit.com/r/berlin/comments/xyz789/language_schools/"), true);
  assert.equal(isThread("https://www.reddit.com/r/berlin/"), false);
  assert.equal(isThread("https://www.quora.com/Which-is-the-best-German-language-school-in-Berlin"), true);
  assert.equal(isThread("https://www.quora.com/profile/Someone"), false);
  assert.equal(platformOf("https://www.quora.com/x"), "Quora");
  const map = sourceMap([{ status: "answered", question: "q", assistant: "chatgpt", sources: [
    { url: "https://www.reddit.com/r/berlin/comments/xyz789/a/", domain: "reddit.com", own: false },
    { url: "https://www.reddit.com/r/berlin/comments/def456/b/", domain: "reddit.com", own: false },
    { url: "https://www.reddit.com/r/berlin/", domain: "reddit.com", own: false },
  ] }], []);
  assert.deepEqual(postCandidates(map, new Set(["https://www.reddit.com/r/berlin/comments/xyz789/a/"])).map((s) => s.url),
    ["https://www.reddit.com/r/berlin/comments/def456/b/"]);
});

test("a Reddit thread is read from its JSON: title, post and top replies", () => {
  const json = [{ data: { children: [{ data: { title: "Roofer quotes in Austin?", selftext: "Got three quotes, wildly different.", subreddit: "Austin" } }] } },
    { data: { children: [{ kind: "t1", data: { body: "Ask for the shingle brand." } }, { kind: "more", data: {} }] } }];
  const text = redditThreadText(json)!;
  assert.match(text, /r\/Austin/);
  assert.match(text, /Roofer quotes in Austin\?/);
  assert.match(text, /Ask for the shingle brand/);
  assert.equal(redditThreadText({}), null);
});

test("a reply is drafted only from the business's own facts, with disclosure, and is checked before it's kept", () => {
  const req = postDraftRequest({ url: "https://www.reddit.com/r/berlin/comments/xyz789/a/", title: "Best German school?", text: null, questions: ["Best German course in Berlin?"] },
    { name: "Sprachhaus", domain: "sprachhaus.de", summary: "German courses in Berlin", features: ["evening classes"], pricing: "€290 a month" });
  assert.match(req.system, /never invent/i);
  assert.match(req.system, /disclosure/i);
  assert.match(req.system, /at most once/i);
  assert.match(req.userMessage, /€290 a month/);
  assert.match(req.userMessage, /couldn't be read/);
  assert.equal(parsePostDraft({ reply: "Too short.", fits: true }), null);
  const words = Array.from({ length: 60 }, () => "word").join(" ");
  assert.deepEqual(parsePostDraft({ reply: ` ${words} `, fits: false }), { reply: words, fits: false });
  assert.equal(parsePostDraft({ reply: words }), null);
});
