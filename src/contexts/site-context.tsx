"use client";

import { useAuth } from "@clerk/nextjs";
import { useParams, useRouter } from "next/navigation";

import { createContext, useContext, useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { resolveActiveSite } from "../lib/active-site";

interface SiteContextValue {
  sites: any[] | undefined;
  activeSite: any | undefined;
  activeSiteId: Id<"sites"> | undefined;
  setActiveSiteId: (id: Id<"sites">) => void;
}

const SiteContext = createContext<SiteContextValue>({
  sites: undefined,
  activeSite: undefined,
  activeSiteId: undefined,
  setActiveSiteId: () => {},
});

const STORAGE_KEY = "pentra_active_site";

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const routeSiteId = typeof params.siteId === "string" ? params.siteId : undefined;
  const { userId: clerkUserId } = useAuth();
  const sites = useQuery(api.sites.list, clerkUserId ? { clerkUserId } : {});
  const [activeSiteId, setActiveSiteIdState] = useState<Id<"sites"> | undefined>(undefined);

  // Deep links must carry their tenant into global actions. Never fall back
  // to another tenant on an unknown/unauthorized site route.
  useEffect(() => {
    if (!sites || sites.length === 0) return;
    let stored: string | undefined;
    try {
      stored = localStorage.getItem(STORAGE_KEY) ?? undefined;
    } catch {
      // Storage may be unavailable; route ownership remains authoritative.
    }
    const selected = resolveActiveSite(sites, undefined, routeSiteId);
    setActiveSiteIdState((current) => resolveActiveSite(
      sites, current ?? stored, routeSiteId,
    )?._id);
    if (selected && routeSiteId) {
      try { localStorage.setItem(STORAGE_KEY, selected._id); } catch { /* Optional persistence. */ }
    }
  }, [sites, routeSiteId]);

  const setActiveSiteId = (id: Id<"sites">) => {
    if (!sites?.some((site) => site._id === id)) return;
    setActiveSiteIdState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* Optional persistence. */ }
    if (routeSiteId && routeSiteId !== id) router.push(`/sites/${id}`);
  };

  const activeSite = resolveActiveSite(sites, activeSiteId, routeSiteId);

  return (
    <SiteContext.Provider value={{ sites, activeSite, activeSiteId: activeSite?._id, setActiveSiteId }}>
      {children}
    </SiteContext.Provider>
  );
}

export function useActiveSite() {
  return useContext(SiteContext);
}
