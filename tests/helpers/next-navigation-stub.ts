// next/navigation needs a mounted App Router; tests that render screens get a router that records what it was asked.
const state = { pathname: "/dashboard", search: "", pushed: [] as string[] };
export function setNavigation(next: { pathname?: string; search?: string }) {
  Object.assign(state, next);
  state.pushed = [];
}
export function navigationLog() {
  return state.pushed;
}
export function useRouter() {
  return { push: (href: string) => state.pushed.push(href), replace: (href: string) => state.pushed.push(href), back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => {} };
}
export const usePathname = () => state.pathname;
export const useSearchParams = () => new URLSearchParams(state.search);
export const useParams = () => ({});
export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}
