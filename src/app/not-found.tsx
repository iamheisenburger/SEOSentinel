import { BrandedErrorState } from "@/components/layout/branded-error-state";

export default function NotFound() {
  return (
    <BrandedErrorState
      eyebrow="404 · Page not found"
      title="This page isn’t in the index."
      description="The link may be outdated or the page may have moved. Return to Pentra and keep your growth loop moving."
    />
  );
}
