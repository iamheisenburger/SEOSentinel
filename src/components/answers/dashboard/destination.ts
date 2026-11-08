"use client";

import { useAnswersQuery } from "@/lib/answers/backend";
import { describeDestination, type Destination } from "@/lib/answers/derive";
import type { Publishing } from "@/lib/answers/types";

export { describeDestination, type Destination };

export function useDestination(siteId: string, publishing: Publishing | null | undefined): Destination {
  const needsConnection = publishing !== undefined && publishing?.target !== "hosted";
  const connection = useAnswersQuery("siteConnection", needsConnection ? { siteId } : "skip");
  if (publishing === undefined) return { kind: "loading" };
  return describeDestination(publishing, needsConnection ? connection : null);
}
