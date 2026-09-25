/**
 * pentra.dev/x-reply: hands a reply draft from Telegram to X's own composer.
 *
 * Telegram opens links in its own browser, which is not signed in to X. This
 * page turns the draft into links that open X's composer with the reply filled
 * in; a person reads it there and presses Reply. The page never posts anything
 * and never talks to X. The payload travels in the URL fragment, so it is not
 * sent to Pentra's server or included in page analytics.
 */

export type XReplyHandoff = { id: string; text: string; author: string };

const POST_ID = /^\d{1,20}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export const MAX_REPLY_CHARS = 1000;

/** Parse "#id=…&text=…&author=…" (a "?" query is accepted as a fallback). */
export function parseXReplyHandoff(hash: string, search = ""): XReplyHandoff | null {
  const raw = hash.replace(/^#/, "") || search.replace(/^\?/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const id = (params.get("id") ?? "").trim();
  const text = (params.get("text") ?? "").trim();
  const author = (params.get("author") ?? "").trim().replace(/^@/, "");
  if (!POST_ID.test(id)) return null;
  if (!text || text.length > MAX_REPLY_CHARS) return null;
  if (author && !HANDLE.test(author)) return null;
  return { id, text, author };
}

export function xReplyLinks({ id, text, author }: XReplyHandoff) {
  const message = encodeURIComponent(text);
  return {
    /** X's web intent. On a phone with the X app, tapping it opens the app. */
    composer: `https://x.com/intent/post?in_reply_to=${id}&text=${message}`,
    /** The X app's own URL scheme, for phones where the web link stays in the browser. */
    app: `twitter://post?in_reply_to_status_id=${id}&message=${message}`,
    source: author ? `https://x.com/${author}/status/${id}` : `https://x.com/i/web/status/${id}`,
  };
}
