"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

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
  const sites = useQuery(api.sites.list);
  const [activeSiteId, setActiveSiteIdState] = useState<Id<"sites"> | undefined>(undefined);

  // Initialize from localStorage or first site
  useEffect(() => {
    if (!sites || sites.length === 0) return;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && sites.some((s) => s._id === stored)) {
      setActiveSiteIdState(stored as Id<"sites">);
    } else {
      setActiveSiteIdState(sites[0]._id);
    }
  }, [sites]);

  const setActiveSiteId = (id: Id<"sites">) => {
    setActiveSiteIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const activeSite = sites?.find((s) => s._id === activeSiteId) ?? sites?.[0];

  return (
    <SiteContext.Provider value={{ sites, activeSite, activeSiteId: activeSite?._id, setActiveSiteId }}>
      {children}
    </SiteContext.Provider>
  );
}

export function useActiveSite() {
  return useContext(SiteContext);
}
