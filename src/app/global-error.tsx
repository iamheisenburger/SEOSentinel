"use client";

import { useEffect } from "react";
import { BrandedErrorState } from "@/components/layout/branded-error-state";
import "./pentra.css";

export default function GlobalError({
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
    <html lang="en" className="dark">
      <body className="bg-bg text-text antialiased">
        <BrandedErrorState
          eyebrow="Something went wrong"
          title="Pentra didn’t load."
          description="Your data is safe. Try again, or reload Pentra from the start."
          onRetry={reset}
        />
      </body>
    </html>
  );
}
