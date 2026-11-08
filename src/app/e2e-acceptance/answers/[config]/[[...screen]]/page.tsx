import { Suspense } from "react";
import { HarnessScreen } from "../../harness";

export default async function HarnessPage({ params }: { params: Promise<{ screen?: string[] }> }) {
  const { screen } = await params;
  return (
    <Suspense>
      <HarnessScreen screen={screen ?? []} />
    </Suspense>
  );
}
