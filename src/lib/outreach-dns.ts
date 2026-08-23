import { resolveCname, resolveTxt } from "node:dns/promises";

export type OutreachDnsReadiness = {
  senderDomain: string;
  dkimSelector: string;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  checkedAt: number;
  issues: string[];
};

const DNS_TIMEOUT_MS = 5_000;

async function bounded<T>(operation: Promise<T>): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DNS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function txtRecords(name: string): Promise<string[]> {
  const records = await bounded(resolveTxt(name));
  return records ? records.map((parts) => parts.join("")) : [];
}

export async function verifyGoogleWorkspaceDns(args: {
  senderDomain: string;
  dkimSelector?: string;
  now?: number;
}): Promise<OutreachDnsReadiness> {
  const senderDomain = args.senderDomain.trim().toLowerCase().replace(/\.$/, "");
  const dkimSelector = (args.dkimSelector || "google")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "") || "google";
  const dkimHost = `${dkimSelector}._domainkey.${senderDomain}`;
  const [rootTxt, dmarcTxt, dkimTxt, dkimCname] = await Promise.all([
    txtRecords(senderDomain),
    txtRecords(`_dmarc.${senderDomain}`),
    txtRecords(dkimHost),
    bounded(resolveCname(dkimHost)),
  ]);

  const spf = rootTxt.some((value) => {
    const normalized = value.toLowerCase();
    return (
      normalized.startsWith("v=spf1") &&
      (normalized.includes("include:_spf.google.com") ||
        normalized.includes("redirect=_spf.google.com"))
    );
  });
  const dmarc = dmarcTxt.some((value) =>
    /^v=dmarc1\s*;/i.test(value.trim()),
  );
  const dkim = dkimTxt.some((value) => {
    const normalized = value.replace(/\s+/g, "").toLowerCase();
    return normalized.includes("v=dkim1") || normalized.includes("p=");
  }) || Boolean(dkimCname && dkimCname.length > 0);

  const issues: string[] = [];
  if (!spf) issues.push("SPF must authorize Google Workspace on the secondary domain.");
  if (!dkim) issues.push(`DKIM was not found at ${dkimHost}.`);
  if (!dmarc) issues.push(`DMARC was not found at _dmarc.${senderDomain}.`);

  return {
    senderDomain,
    dkimSelector,
    spf,
    dkim,
    dmarc,
    checkedAt: args.now ?? Date.now(),
    issues,
  };
}
