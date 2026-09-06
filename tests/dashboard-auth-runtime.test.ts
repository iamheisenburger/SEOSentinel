import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const code = buildSync({
  entryPoints: ["src/components/layout/dashboard-layout.tsx"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false,
  // Keep the actual dashboard boundary. Each protected subtree is an explicit
  // query sentinel so early rendering fails instead of hiding the auth race.
  external: ["./sidebar", "./over-limit-banner", "@/contexts/site-context"],
}).outputFiles[0].text;

function render(state: { isLoading: boolean; isAuthenticated: boolean }) {
  const require = createRequire(import.meta.url);
  const calls: string[] = [];
  const querySentinel = (name: string, children?: ReactNode) => {
    calls.push(name);
    assert.ok(state.isAuthenticated && !state.isLoading, `${name} queried before Convex accepted authentication`);
    return createElement("div", null, children ?? name);
  };
  const runtime = { exports: {} as { DashboardLayout: (props: { children: ReactNode }) => ReactNode } };
  runInNewContext(code, {
    module: runtime, exports: runtime.exports,
    require: (name: string) => {
      if (name === "convex/react") return { useConvexAuth: () => state };
      if (name === "./sidebar") return { Sidebar: () => querySentinel("sidebar") };
      if (name === "./over-limit-banner") return { OverLimitBanner: () => querySentinel("plan capacity") };
      if (name === "@/contexts/site-context") return { SiteProvider: ({ children }: { children: ReactNode }) => querySentinel("site list", children) };
      return require(name);
    },
  });
  const PrivatePage = () => querySentinel("customer settings");
  return { html: renderToStaticMarkup(createElement(runtime.exports.DashboardLayout, null,
    createElement(PrivatePage))), calls };
}

test("dashboard never mounts protected queries while Convex authentication initializes", () => {
  for (const isAuthenticated of [false, true]) {
    const result = render({ isLoading: true, isAuthenticated });
    assert.deepEqual(result.calls, []);
    assert.match(result.html, /Connecting your workspace/);
    assert.match(result.html, /role="status"/);
  }
});

test("failed or expired authentication shows an actionable state without querying private data", () => {
  const result = render({ isLoading: false, isAuthenticated: false });
  assert.deepEqual(result.calls, []);
  assert.match(result.html, /Sign in/);
  assert.match(result.html, /Try again/);
});

test("authenticated dashboard renders all normal customer subtrees", () => {
  const result = render({ isLoading: false, isAuthenticated: true });
  assert.deepEqual(result.calls, ["site list", "sidebar", "plan capacity", "customer settings"]);
  assert.match(result.html, /customer settings/);
});
