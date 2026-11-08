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
      eyebrow="Something went wrong"
      title="This page didn’t load."
      description="Your data is safe. Try again, or go back to Pentra and pick up where you were."
      onRetry={reset}
    />
  );
}
