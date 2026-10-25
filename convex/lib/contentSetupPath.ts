/**
 * P197 (Oct 25 2026): a site set up through Pentra's content service gets its
 * articles through Start Pentra (the checked pipeline), never the older article
 * queue. One of the first real signups never pressed Start and made an article
 * in the older queue with the Articles page's Generate. Sites on the older flow
 * (never set up through the content service) keep it.
 */
export const MID_SETUP_QUEUE_MESSAGE = "Finish setup on your dashboard and press Start Pentra: Pentra writes your first article from there.";

/** Set up through the content service, and Start Pentra not pressed yet. */
export function midContentSetup(site: { contentSetupRequestedAt?: number; serviceMode?: string }): boolean {
  return site.contentSetupRequestedAt !== undefined && site.serviceMode !== "growth_first";
}

export function assertNotMidContentSetup(site: { contentSetupRequestedAt?: number; serviceMode?: string }) {
  if (midContentSetup(site)) throw new Error(MID_SETUP_QUEUE_MESSAGE);
}
