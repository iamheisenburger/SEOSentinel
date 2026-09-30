"use client";

import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useRef, useSyncExternalStore } from "react";

/**
 * A live Convex query that pauses while the browser tab is hidden.
 *
 * A live query re-runs on the server every time anything it read changes, and
 * a dashboard tab left open in the background would otherwise keep paying for
 * those re-runs all day. While hidden, the last result stays on screen; when
 * the tab is visible again the query resubscribes and refreshes once.
 */
function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, () => document.visibilityState !== "hidden", () => true);
}

export function useVisibleQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): Query["_returnType"] | undefined {
  const visible = usePageVisible();
  const requested = args[0];
  const live = useQuery(query, ...((visible ? args : ["skip"]) as OptionalRestArgsOrSkip<Query>));
  const last = useRef<{ key: string; value: Query["_returnType"] } | null>(null);
  const key = requested === "skip" ? "skip" : JSON.stringify(requested ?? {});
  if (live !== undefined) last.current = { key, value: live };
  if (live === undefined && !visible && last.current?.key === key) return last.current.value;
  return live;
}
