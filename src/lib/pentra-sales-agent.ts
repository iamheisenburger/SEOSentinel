export const PENTRA_SALES_AGENT_EMBED_KEY = "lp_6isln9hxckla5uap";

export function isPentraSalesAgentRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/pricing" ||
    pathname === "/contact" ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname.startsWith("/legal/")
  );
}
