/**
 * "Here's what we understood", saved: the business and, for a local business, its city or area
 * (api.answers.updateBusiness({ ..., local?, location? })). Pure, so the fallback is tested without a backend.
 */
import { ConvexError } from "convex/values";

export type BusinessFields = { siteId: string; name: string; sells: string; buyers: string; offerings: string[] };
export type Place = { local: boolean; location?: string };

/** The City or area field: filled in means the business serves that place in person; empty means it isn't local. */
export function placeFrom(location: string): Place {
  const place = location.trim().replace(/\s+/g, " ").slice(0, 80);
  return place ? { local: true, location: place } : { local: false };
}

export async function updateBusinessWithPlace<T>(
  call: (args: BusinessFields & Partial<Place>) => Promise<T>,
  fields: BusinessFields,
  place: Place,
): Promise<T> {
  try {
    return await call({ ...fields, ...place });
  } catch (error) {
    // A sentence meant for the owner ("Say what the business sells") stands. Anything else, such as a backend that doesn't
    // take the place yet, is retried without it: the setup must not stop on the city.
    if (error instanceof ConvexError) throw error;
    return call(fields);
  }
}
