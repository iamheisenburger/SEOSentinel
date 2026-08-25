import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

type ReceiptWindow = {
  startDate?: string;
  endDate?: string;
};

function currentReceipts(site: Doc<"sites">, window?: ReceiptWindow) {
  const byDate = new Map<string, { date: string; syncEpoch: string }>();
  for (const receipt of site.gscDateEpochs ?? []) {
    if (
      (window?.startDate && receipt.date < window.startDate) ||
      (window?.endDate && receipt.date > window.endDate)
    ) {
      continue;
    }
    byDate.set(receipt.date, receipt);
  }
  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date)
  );
}

/**
 * Reads only the exact immutable epoch/date partitions referenced by the
 * site's current Search Console receipt ledger. Superseded domain or
 * connection rows therefore cannot consume the current tenant's read cap.
 */
export async function takeCurrentGscPageRows(
  ctx: DbCtx,
  site: Doc<"sites">,
  limit: number,
  window?: ReceiptWindow,
): Promise<{ rows: Array<Doc<"search_page_daily">>; exhausted: boolean }> {
  const rows: Array<Doc<"search_page_daily">> = [];
  const boundedLimit = Math.max(1, Math.floor(limit));
  for (const receipt of currentReceipts(site, window)) {
    const remaining = boundedLimit - rows.length;
    if (remaining <= 0) return { rows, exhausted: true };
    const partition = await ctx.db
      .query("search_page_daily")
      .withIndex("by_site_epoch_date", (q) =>
        q
          .eq("siteId", site._id)
          .eq("syncEpoch", receipt.syncEpoch)
          .eq("date", receipt.date)
      )
      .take(remaining);
    rows.push(...partition);
    if (partition.length >= remaining) return { rows, exhausted: true };
  }
  return { rows, exhausted: false };
}

export async function takeCurrentGscQueryRows(
  ctx: DbCtx,
  site: Doc<"sites">,
  limit: number,
  window?: ReceiptWindow,
): Promise<{ rows: Array<Doc<"search_performance">>; exhausted: boolean }> {
  const rows: Array<Doc<"search_performance">> = [];
  const boundedLimit = Math.max(1, Math.floor(limit));
  for (const receipt of currentReceipts(site, window)) {
    const remaining = boundedLimit - rows.length;
    if (remaining <= 0) return { rows, exhausted: true };
    const partition = await ctx.db
      .query("search_performance")
      .withIndex("by_site_epoch_date", (q) =>
        q
          .eq("siteId", site._id)
          .eq("syncEpoch", receipt.syncEpoch)
          .eq("date", receipt.date)
      )
      .take(remaining);
    rows.push(...partition);
    if (partition.length >= remaining) return { rows, exhausted: true };
  }
  return { rows, exhausted: false };
}
