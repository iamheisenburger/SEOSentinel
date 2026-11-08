import { permanentRedirect } from "next/navigation";

// The founding-beta offer ended with the move to one plan (Nov 2026); old links land on the homepage.
export default function BetaPage() {
  permanentRedirect("/");
}
