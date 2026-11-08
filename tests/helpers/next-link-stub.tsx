// next/link needs a running Next.js router; tests that render a component's markup only need a plain anchor.
import { createElement, type AnchorHTMLAttributes } from "react";

export default function Link({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  delete (props as { prefetch?: boolean }).prefetch;
  return createElement("a", { href, ...props }, children);
}
