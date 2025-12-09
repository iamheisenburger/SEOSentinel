import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { convexHttp } from "@/lib/convexHttpClient";

export const runtime = "edge";

export async function GET() {
  try {
    // For now, pick the first site. In the future we can accept a siteId query param.
    const sites = await convexHttp.query(api.sites.list, {});
    const site = sites?.[0];
    if (!site?._id) {
      return NextResponse.json(
        { ok: false, message: "No site configured yet" },
        { status: 400 },
      );
    }

    const res = await convexHttp.action(api.actions.pipeline.autopilotTick, {
      siteId: site._id,
    });

    return NextResponse.json({ ok: true, processed: res?.processed ?? 0 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "autopilot failed";
    return NextResponse.json(
      { ok: false, message },
      { status: 500 },
    );
  }
}

