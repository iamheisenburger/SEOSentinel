/** When each segment of an answer video is on screen (P398): the voice reads the segments in order at an even pace, so each
 * segment holds the share of the audio its narration's words take. Shared by the server (tests) and the browser that
 * assembles the video. Pure. */
export type TimedSegment = { startMs: number; endMs: number };

export function segmentTimings(narrations: readonly string[], durationMs: number): TimedSegment[] {
  const words = narrations.map((n) => Math.max(1, n.split(/\s+/).filter(Boolean).length));
  const total = words.reduce((a, b) => a + b, 0);
  let at = 0;
  return words.map((w, i) => {
    const startMs = Math.round(at);
    at += (w / total) * durationMs;
    return { startMs, endMs: i === words.length - 1 ? Math.round(durationMs) : Math.round(at) };
  });
}

/** The segment on screen at a moment (the last one after the audio ends). */
export function segmentAt(timings: readonly TimedSegment[], ms: number): number {
  for (let i = 0; i < timings.length; i++) if (ms < timings[i].endMs) return i;
  return Math.max(0, timings.length - 1);
}

/** YouTube chapters for the description ("0:00 Heading"), from the segment timings. */
export function chapters(headings: readonly string[], timings: readonly TimedSegment[]): string {
  return timings.map((t, i) => {
    const s = Math.floor(t.startMs / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} ${headings[i] ?? ""}`.trim();
  }).join("\n");
}
