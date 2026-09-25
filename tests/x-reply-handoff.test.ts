import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_REPLY_CHARS,
  parseXReplyHandoff,
  xReplyLinks,
} from "../src/lib/x-reply-handoff.ts";

/**
 * The Telegram reply assistant opens pentra.dev/x-reply#id=…&text=…&author=…
 * (built by the X reply service). The page only prepares X's own composer; a
 * person presses Reply in X. The fragment keeps the draft out of server logs
 * and page analytics.
 */

const TEXT = "check how many of the 100 google has indexed before judging the writing.";

test("parses the fragment the reply service builds", () => {
  const hash = `#${new URLSearchParams({ id: "1900000000000000000", text: TEXT, author: "alice" })}`;
  assert.deepEqual(parseXReplyHandoff(hash), { id: "1900000000000000000", text: TEXT, author: "alice" });
  // A query string still works as a fallback, and "@" is tolerated.
  assert.deepEqual(parseXReplyHandoff("", `?id=12&text=hi&author=%40bob`), { id: "12", text: "hi", author: "bob" });
});

test("refuses incomplete or unsafe payloads", () => {
  const make = (p: Record<string, string>) => `#${new URLSearchParams(p)}`;
  assert.equal(parseXReplyHandoff(""), null);
  assert.equal(parseXReplyHandoff(make({ id: "abc", text: TEXT })), null);
  assert.equal(parseXReplyHandoff(make({ id: "12", text: "   " })), null);
  assert.equal(parseXReplyHandoff(make({ id: "12", text: "x".repeat(MAX_REPLY_CHARS + 1) })), null);
  assert.equal(parseXReplyHandoff(make({ id: "12", text: TEXT, author: "evil/../x" })), null);
  assert.deepEqual(parseXReplyHandoff(make({ id: "12", text: TEXT })), { id: "12", text: TEXT, author: "" });
});

test("links open X's composer as a reply with the draft filled in", () => {
  const links = xReplyLinks({ id: "1900000000000000000", text: "a & b, 100%?", author: "alice" });
  const composer = new URL(links.composer);
  assert.equal(composer.origin + composer.pathname, "https://x.com/intent/post");
  assert.equal(composer.searchParams.get("in_reply_to"), "1900000000000000000");
  assert.equal(composer.searchParams.get("text"), "a & b, 100%?");
  assert.ok(links.app.startsWith("twitter://post?in_reply_to_status_id=1900000000000000000&message="));
  assert.equal(decodeURIComponent(links.app.split("message=")[1]), "a & b, 100%?");
  assert.equal(links.source, "https://x.com/alice/status/1900000000000000000");
  assert.equal(xReplyLinks({ id: "5", text: "t", author: "" }).source, "https://x.com/i/web/status/5");
});

test("the page is public, noindex, and never posts", () => {
  const proxy = readFileSync("src/proxy.ts", "utf8");
  assert.match(proxy, /"\/x-reply"/);
  const page = readFileSync("src/app/x-reply/page.tsx", "utf8");
  assert.match(page, /index: false/);
  const view = readFileSync("src/app/x-reply/x-reply-handoff.tsx", "utf8");
  assert.doesNotMatch(view, /fetch\(|api\.x\.com|api\.twitter\.com/);
});
