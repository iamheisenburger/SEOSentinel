"use client";

import { useEffect } from "react";
import { BrandedErrorState } from "@/components/layout/branded-error-state";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <BrandedErrorState
      eyebrow="Pentra encountered an error"
      title="The loop hit a snag."
      description="Your work is still safe. Try the page again, or return to Pentra and continue from your workspace."
      onRetry={reset}
    />
  );
}
