export const PENTRA_SALES_AGENT_EMBED_KEY = "lp_6isln9hxckla5uap";
/** Off since P386 (Nov 8 2026): the LeadPilot agent for Pentra learned the article product from the old pentra.dev, and its
 * filled blue launcher breaks the design (blue only means "you"). On again once it is retrained on the Answers site. */
export const PENTRA_SALES_AGENT_ON = false;

export function isPentraSalesAgentRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/pricing" ||
    pathname === "/contact" ||
    pathname === "/method" ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname.startsWith("/legal/")
  );
}
