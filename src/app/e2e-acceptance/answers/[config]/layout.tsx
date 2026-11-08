import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { HarnessProvider } from "../harness";

/** Dev-only: synthetic data for screenshots and click-throughs. Never served by a production build. */
export default async function HarnessLayout({ children, params }: { children: ReactNode; params: Promise<{ config: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { config } = await params;
  return <HarnessProvider rawConfig={config}>{children}</HarnessProvider>;
}
