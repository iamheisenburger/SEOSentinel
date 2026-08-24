export type KeywordDifficultyAuthority = {
  domainRank: number;
  referringDomains: number;
};

/** Canonical authority-to-keyword-difficulty policy shared by provider
 * planning and the durable pre-SERP checkpoint admission fence. */
export function computeAuthorityKeywordDifficultyCeiling(
  authority: KeywordDifficultyAuthority | null,
): number {
  if (!authority) return 15;

  const domainRank = Math.max(0, authority.domainRank);
  const referringDomains = Math.max(0, authority.referringDomains);
  const rankCeiling = domainRank <= 10 ? 10
    : domainRank <= 20 ? 15
      : domainRank <= 30 ? 20
        : domainRank <= 40 ? 30
          : domainRank <= 50 ? 40
            : domainRank <= 65 ? 55
              : domainRank <= 80 ? 70
                : 85;
  const referringDomainCeiling = referringDomains < 10 ? 15
    : referringDomains < 25 ? 20
      : referringDomains < 50 ? 30
        : referringDomains < 100 ? 40
          : referringDomains < 250 ? 55
            : referringDomains < 500 ? 70
              : 85;
  return Math.min(rankCeiling, referringDomainCeiling);
}
