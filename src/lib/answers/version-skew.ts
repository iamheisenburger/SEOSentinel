/** P402: a page older than the server. After an update removes or renames a function, a tab opened before it keeps
 * asking for the old one and Convex answers "Could not find public function"; re-rendering the same code can't recover,
 * so the page loads the current version (at most once a minute, so a real outage never loops). */
export const isVersionSkew = (error: unknown) => /Could not find public function/i.test(error instanceof Error ? error.message : String(error ?? ""));

export function reloadForUpdate(now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = typeof sessionStorage === "undefined" ? null : sessionStorage,
  reload: () => void = () => window.location.reload()): boolean {
  const key = "pentra-reloaded-for-update";
  try {
    const last = Number(storage?.getItem(key) ?? 0);
    if (now - last < 60_000) return false;
    storage?.setItem(key, String(now));
  } catch { /* storage blocked: reload anyway, once */ }
  reload();
  return true;
}
