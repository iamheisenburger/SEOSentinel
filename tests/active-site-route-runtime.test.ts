import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveActiveSite } from "../src/lib/active-site.ts";

const owned = [{ _id: "tenant-a", siteName: "First business" }, { _id: "tenant-b", siteName: "Second business" }];
const code = buildSync({
  entryPoints: ["src/contexts/site-context.tsx"], bundle: true, platform: "node",
  format: "cjs", packages: "external", write: false,
}).outputFiles[0].text;

function render(routeSiteId?: string) {
  const require = createRequire(import.meta.url);
  const runtime = { exports: {} as typeof import("../src/contexts/site-context") };
  runInNewContext(code, {
    module: runtime, exports: runtime.exports,
    require: (name: string) => {
      if (name === "next/navigation") return {
        useParams: () => routeSiteId ? { siteId: routeSiteId } : {},
        useRouter: () => ({ push: () => { throw Error("render must not navigate"); } }),
      };
      if (name === "@clerk/nextjs") return { useAuth: () => ({ userId: "synthetic-owner" }) };
      if (name === "convex/react") return { useQuery: () => owned };
      return require(name);
    },
  });
  const Consumer = () => createElement("span", null, runtime.exports.useActiveSite().activeSiteId ?? "none");
  return renderToStaticMarkup(createElement(runtime.exports.SiteProvider, null, createElement(Consumer)));
}

test("a direct owned site route scopes global actions before effects run", () => {
  assert.equal(render("tenant-b"), "<span>tenant-b</span>");
  assert.equal(render("tenant-a"), "<span>tenant-a</span>");
});

test("an unowned site route cannot silently target the first owned business", () => {
  assert.equal(render("tenant-not-owned"), "<span>none</span>");
  assert.equal(resolveActiveSite(owned, "tenant-a", "tenant-not-owned"), undefined);
  assert.equal(resolveActiveSite(undefined, "tenant-a", "tenant-b"), undefined);
});

test("normal navigation retains a valid selection and recovers deleted or stale selections", () => {
  assert.equal(resolveActiveSite(owned, "tenant-b")?._id, "tenant-b");
  assert.equal(resolveActiveSite(owned, "deleted-tenant")?._id, "tenant-a");
  assert.equal(resolveActiveSite([], "tenant-a"), undefined);
  assert.equal(resolveActiveSite(owned, "tenant-a", "tenant-b")?._id, "tenant-b");
});

// Execute the real provider's render/effect/event sequence with deterministic
// hooks; all query rows are synthetic and no browser credentials are used.
function sequence(storageAvailable = true) {
  const require = createRequire(import.meta.url);
  let routeSiteId: string | undefined = "tenant-b";
  let state: string | undefined;
  let stored = "tenant-a";
  let effects: (() => void)[] = [];
  const navigations: string[] = [];
  const runtime = { exports: {} as typeof import("../src/contexts/site-context") };
  runInNewContext(code, {
    module: runtime, exports: runtime.exports,
    localStorage: {
      getItem: () => { if (!storageAvailable) throw Error("storage disabled"); return stored; },
      setItem: (_key: string, value: string) => { if (!storageAvailable) throw Error("storage disabled"); stored = value; },
    },
    require: (name: string) => {
      if (name === "react") return {
        ...require(name),
        useState: () => [state, (next: string | undefined | ((prior: string | undefined) => string | undefined)) => {
          state = typeof next === "function" ? next(state) : next;
        }],
        useEffect: (effect: () => void) => { effects.push(effect); },
      };
      if (name === "next/navigation") return {
        useParams: () => routeSiteId ? { siteId: routeSiteId } : {},
        useRouter: () => ({ push: (path: string) => { navigations.push(path); } }),
      };
      if (name === "@clerk/nextjs") return { useAuth: () => ({ userId: "synthetic-owner" }) };
      if (name === "convex/react") return { useQuery: () => owned };
      return require(name);
    },
  });
  const render = () => {
    effects = [];
    const element = runtime.exports.SiteProvider({ children: null });
    const value = element.props.value as { activeSiteId?: string; setActiveSiteId: (id: string) => void };
    for (const effect of effects) effect();
    return value;
  };
  return { render, navigate: (id?: string) => { routeSiteId = id; }, navigations, stored: () => stored };
}

test("deep-link selection survives navigation, even when local storage is unavailable", () => {
  for (const storageAvailable of [true, false]) {
    const app = sequence(storageAvailable);
    assert.equal(app.render().activeSiteId, "tenant-b");
    app.navigate();
    assert.equal(app.render().activeSiteId, "tenant-b");
    assert.equal(app.render().activeSiteId, "tenant-b");
    if (storageAvailable) assert.equal(app.stored(), "tenant-b");
  }
});

test("switching from a detail page navigates with the validated tenant and rejects unknown IDs", () => {
  const app = sequence();
  const view = app.render();
  view.setActiveSiteId("tenant-not-owned");
  assert.deepEqual(app.navigations, []);
  view.setActiveSiteId("tenant-a");
  assert.deepEqual(app.navigations, ["/sites/tenant-a"]);
  // Until navigation completes, the visible detail route remains authoritative.
  assert.equal(app.render().activeSiteId, "tenant-b");
  app.navigate("tenant-a");
  assert.equal(app.render().activeSiteId, "tenant-a");
});
