import { BrandedErrorState } from "@/components/layout/branded-error-state";

export default function NotFound() {
  return (
    <BrandedErrorState
      eyebrow="404 · Page not found"
      title="This page isn’t here."
      description="The link may be old, or the page may have moved. Everything else is where you left it."
    />
  );
}
