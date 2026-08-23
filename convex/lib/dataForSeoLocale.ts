/** DataForSEO's `language_code` is a base language, not a browser locale.
 * Tenant profiles commonly store values such as en-AU or fa-IR. */
export function dataForSeoLanguageCode(language: string | undefined): string {
  const base = (language ?? "en")
    .trim()
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return /^[a-z]{2}$/.test(base) ? base : "en";
}

/** Stable country-to-location mapping shared by measurement and audit paths. */
export function dataForSeoLocationCode(country: string | undefined): number {
  if (!country) return 2840;
  const key = country.toLowerCase().trim();
  const locations: Record<string, number> = {
    us: 2840, usa: 2840, "united states": 2840,
    uk: 2826, "united kingdom": 2826, gb: 2826,
    ca: 2124, canada: 2124,
    au: 2036, australia: 2036,
    de: 2276, germany: 2276,
    fr: 2250, france: 2250,
    in: 2356, india: 2356,
    br: 2076, brazil: 2076,
    jp: 2392, japan: 2392,
    es: 2724, spain: 2724,
    it: 2380, italy: 2380,
    nl: 2528, netherlands: 2528,
    se: 2752, sweden: 2752,
    sg: 2702, singapore: 2702,
    ae: 2784, uae: 2784, "united arab emirates": 2784,
    mx: 2484, mexico: 2484,
    global: 2840, worldwide: 2840,
  };
  return locations[key] ?? 2840;
}
