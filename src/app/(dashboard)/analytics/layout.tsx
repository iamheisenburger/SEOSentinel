import type { ReactNode } from "react";
import { ArticlesOnly } from "@/components/answers/dashboard/articles-only";

/** An article screen: sites on Pentra Answers are sent to /dashboard. */
export default function Layout({ children }: { children: ReactNode }) {
  return <ArticlesOnly>{children}</ArticlesOnly>;
}
