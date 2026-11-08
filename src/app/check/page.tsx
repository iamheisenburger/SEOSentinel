import { permanentRedirect } from "next/navigation";

// The free SEO check was retired with the move to the AI-answer snapshot (Nov 2026); old links land on the
// homepage, whose domain field starts the snapshot. The /api/check route is left as it was.
export default function FreeCheckPage() {
  permanentRedirect("/");
}
