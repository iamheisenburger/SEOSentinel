"use client";

import { useEffect } from "react";
import { BrandedErrorState } from "@/components/layout/branded-error-state";
import "./globals.css";

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
      <body>
        <BrandedErrorState
          eyebrow="Pentra encountered an error"
          title="The engine needs a restart."
          description="Your workspace data is safe. Retry the application, or return to Pentra and begin again."
          onRetry={reset}
        />
      </body>
    </html>
  );
}
