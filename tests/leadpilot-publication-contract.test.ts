import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const leadPilotBlogModule = resolve(
  process.cwd(),
  "../LeadPilot/src/lib/blog.ts",
);

test(
  "Pentra's inert Markdown delivery is discoverable by the LeadPilot consumer",
  { skip: !existsSync(leadPilotBlogModule) },
  async () => {
    const publisher = readFileSync("convex/publisher.ts", "utf8");
    assert.match(publisher, /filePath = `\$\{contentDir\}\/\$\{slug\}\.md`/);

    const consumer = await import(pathToFileURL(leadPilotBlogModule).href);
    assert.equal(
      consumer.getPentraPostSlug("new-pentra-delivery.md"),
      "new-pentra-delivery",
    );
    assert.equal(
      consumer.getPentraPostSlug("legacy-pentra-delivery.mdx"),
      "legacy-pentra-delivery",
    );
    assert.equal(consumer.getPentraPostSlug("unsafe.delivery.md"), null);
  },
);
