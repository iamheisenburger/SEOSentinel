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

test("the X app's composer is the primary link, opened as a reply with the draft filled in", () => {
  const links = xReplyLinks({ id: "1900000000000000000", text: "a & b, 100%?", author: "alice" });
  const composer = new URL(links.composer);
  assert.equal(composer.origin + composer.pathname, "https://x.com/intent/post");
  assert.equal(composer.searchParams.get("in_reply_to"), "1900000000000000000");
  assert.equal(composer.searchParams.get("text"), "a & b, 100%?");
  // Same scheme and parameter order as the LeadPilot handoff that opens the app from Telegram.
  const app = links.app.match(/^twitter:\/\/post\?message=([^&]*)&in_reply_to_status_id=(\d+)$/);
  assert.ok(app, links.app);
  assert.equal(decodeURIComponent(app[1]), "a & b, 100%?");
  assert.equal(app[2], "1900000000000000000");
  assert.equal(links.sourceApp, "twitter://status?id=1900000000000000000");
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
  // Telegram's browser is not signed in to X: the page hands off to the app on
  // load, and the primary button is the app link, never the web login.
  assert.match(view, /window\.location\.href = links\.app/);
  assert.match(view, /<a href=\{links\.app\}[^>]*>\s*\{isPost \? "Open post in X app" : "Open reply in X app"\}/);
});

test("an original post draft opens the X app's composer with no reply target", () => {
  const hash = `#${new URLSearchParams({ kind: "post", text: TEXT })}`;
  const draft = parseXReplyHandoff(hash);
  assert.deepEqual(draft, { kind: "post", id: "", text: TEXT, author: "" });
  const links = xReplyLinks(draft!);
  assert.equal(links.app, `twitter://post?message=${encodeURIComponent(TEXT)}`);
  assert.doesNotMatch(links.app, /in_reply_to/);
  const composer = new URL(links.composer);
  assert.equal(composer.origin + composer.pathname, "https://x.com/intent/post");
  assert.equal(composer.searchParams.get("text"), TEXT);
  assert.equal(composer.searchParams.get("in_reply_to"), null);
  // A post link never carries a reply target, and a reply still needs one.
  assert.equal(parseXReplyHandoff(`#${new URLSearchParams({ kind: "post", id: "12", text: TEXT })}`), null);
  assert.equal(parseXReplyHandoff(`#${new URLSearchParams({ kind: "post", text: " " })}`), null);
  assert.equal(parseXReplyHandoff(`#${new URLSearchParams({ text: TEXT })}`), null);
});

