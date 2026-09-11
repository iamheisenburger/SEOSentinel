/** A tenant-specific route is authoritative, but never grants ownership. */
export function resolveActiveSite<T extends { _id: string }>(
  sites: readonly T[] | undefined,
  selectedSiteId?: string,
  routeSiteId?: string,
): T | undefined {
  if (routeSiteId !== undefined) {
    return sites?.find((site) => site._id === routeSiteId);
  }
  return sites?.find((site) => site._id === selectedSiteId) ?? sites?.[0];
}
