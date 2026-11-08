"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import {
  PENTRA_SALES_AGENT_EMBED_KEY,
  PENTRA_SALES_AGENT_ON,
  isPentraSalesAgentRoute,
} from "@/lib/pentra-sales-agent";

type LeadPilotWidgetRegistry = Record<string, { destroy: () => void }>;

function destroyPentraSalesAgent() {
  const registry = (
    window as Window & { __leadpilotWidgets?: LeadPilotWidgetRegistry }
  ).__leadpilotWidgets;
  registry?.[PENTRA_SALES_AGENT_EMBED_KEY]?.destroy();
  document.getElementById("pentra-sales-agent-script")?.remove();
  document.getElementById("leadpilot-widget")?.remove();
}

export function PentraSalesAgent() {
  const pathname = usePathname();
  const enabled = PENTRA_SALES_AGENT_ON && isPentraSalesAgentRoute(pathname);

  useEffect(() => {
    // Pentra's own site only: never on a customer's hosted answers address or custom-domain blog.
    const onPentra = /(^|\.)pentra\.dev$/.test(window.location.hostname) || ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!enabled || !onPentra) {
      destroyPentraSalesAgent();
      return;
    }

    if (
      document.getElementById("pentra-sales-agent-script") ||
      document.getElementById("leadpilot-widget")
    ) {
      return;
    }

    const script = document.createElement("script");
    script.id = "pentra-sales-agent-script";
    script.src = "https://leadpilot.chat/embed.js";
    script.async = true;
    script.dataset.agent = PENTRA_SALES_AGENT_EMBED_KEY;
    document.body.appendChild(script);

    return destroyPentraSalesAgent;
  }, [enabled]);

  return null;
}
