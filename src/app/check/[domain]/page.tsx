import { permanentRedirect } from "next/navigation";

// Shared free-check result links (kept 7 days) now land on the homepage (Nov 2026).
export default function FreeCheckResultPage() {
  permanentRedirect("/");
}
