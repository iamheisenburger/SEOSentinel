/** DataForSEO's `language_code` is a base language, not a browser locale.
 * Tenant profiles commonly store values such as en-AU or fa-IR. */
export function dataForSeoLanguageCode(language: string | undefined): string {
  const base = (language ?? "en")
    .trim()
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return /^[a-z]{2}$/.test(base) ? base : "en";
}
