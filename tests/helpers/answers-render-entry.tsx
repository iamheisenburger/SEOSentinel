// Renders the real Answers screens through the dev harness provider (synthetic data shaped like answers-api.md).
import { renderToStaticMarkup } from "react-dom/server";
import { HarnessProvider, HarnessScreen } from "../../src/app/e2e-acceptance/answers/harness";
import { navigationLog, setNavigation } from "./next-navigation-stub";

export function renderHarness(config: string, path: string) {
  const [pathname, search = ""] = path.split("?");
  const screen = pathname.split("/").filter(Boolean);
  setNavigation({ pathname: `/e2e-acceptance/answers/${config}/${screen.join("/")}`, search });
  const html = renderToStaticMarkup(
    <HarnessProvider rawConfig={config}>
      <HarnessScreen screen={screen} />
    </HarnessProvider>,
  );
  return { html, navigations: [...navigationLog()] };
}
