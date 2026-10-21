import { test } from "node:test";
import assert from "node:assert/strict";

// P154 (Oct 21 2026): V4 ("every slot on time") was scored on the two owner sites only; the promise is for every
// customer. A slot is its deadline: a replacement that published on time makes a failed first attempt "on time".
test("slots are counted once by their best outcome: on time within the grace hour, late, or missed", async () => {
  const { slotOutcomes } = await import("../convex/lib/slotOutcomes.ts");
  const hour = 3_600_000, now = Date.UTC(2026, 9, 21, 22);
  const counts = slotOutcomes([
    { deadlineAt: now - 48 * hour, publishedAt: now - 48 * hour - 300_000 }, // a few minutes early
    { deadlineAt: now - 30 * hour },                                         // a failed first attempt...
    { deadlineAt: now - 30 * hour, publishedAt: now - 30 * hour + 20 * 60_000 }, // ...replaced in time
    { deadlineAt: now - 20 * hour, publishedAt: now - 16 * hour },           // four hours late
    { deadlineAt: now - 10 * hour },                                         // missed
    { deadlineAt: now - 30 * 60_000 },                                       // still inside its grace hour
    { deadlineAt: now + 5 * hour },                                          // not due yet
  ], now, hour);
  assert.deepEqual(counts, { due: 4, onTime: 2, late: 1, missed: 1 });
});
