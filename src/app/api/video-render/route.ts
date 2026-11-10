/** P400: renders one answer video. Pentra's backend calls this with a single-use ticket; the route claims the render from
 * Convex (what to draw and a one-time upload address), renders the MP4 in a Vercel Sandbox from the Remotion bundle built
 * with the app (.remotion, see package.json "build"), uploads it to Convex and reports back. The sandbox is always stopped. */
import { NextResponse } from "next/server";
import { addBundleToSandbox, createSandbox, renderMediaOnVercel } from "@remotion/vercel";
import { convexHttp } from "@/lib/convexHttpClient";
import { api } from "../../../../convex/_generated/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let ticket = "";
  try {
    const body = (await request.json()) as { ticket?: unknown };
    ticket = typeof body.ticket === "string" && /^[a-f0-9-]{32,64}$/.test(body.ticket) ? body.ticket : "";
  } catch { /* not JSON */ }
  if (!ticket) return NextResponse.json({ ok: false, error: "No ticket." }, { status: 400 });

  let job: { compositionId: string; inputProps: Record<string, unknown>; uploadUrl: string };
  try {
    job = await convexHttp.mutation(api.answerVideoRender.claim, { ticket });
  } catch {
    return NextResponse.json({ ok: false, error: "This render ticket isn't valid." }, { status: 403 });
  }

  const started = Date.now();
  const sandbox = await createSandbox({ resources: { vcpus: 4 } }).catch((error: unknown) => error as Error);
  if (sandbox instanceof Error) {
    await convexHttp.mutation(api.answerVideoRender.finish, { ticket, error: `The render machine didn't start (${sandbox.message.slice(0, 160)}).` }).catch(() => {});
    return NextResponse.json({ ok: false, error: "The render machine didn't start." }, { status: 502 });
  }
  try {
    // The bundle copy creates its sub-folders but not the bundle's own folder (P401: "cannot create directory
    // remotion-bundle/public" on the first render), so that folder is made first; it is harmless when it exists.
    await sandbox.mkDir("remotion-bundle").catch(() => {});
    await addBundleToSandbox({ sandbox, bundleDir: ".remotion" });
    const rendered = await renderMediaOnVercel({ sandbox, compositionId: job.compositionId, inputProps: job.inputProps, codec: "h264", crf: 20,
      imageFormat: "jpeg", outputFile: "/tmp/video.mp4", timeoutInMilliseconds: 120_000 });
    const file = await sandbox.readFileToBuffer({ path: rendered.sandboxFilePath });
    if (!file?.length) throw new Error("The rendered file is missing.");
    const upload = await fetch(job.uploadUrl, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array(file) });
    if (!upload.ok) throw new Error(`The upload failed (HTTP ${upload.status}).`);
    const { storageId } = (await upload.json()) as { storageId: string };
    await convexHttp.mutation(api.answerVideoRender.finish, { ticket, storageId: storageId as never });
    return NextResponse.json({ ok: true, seconds: Math.round((Date.now() - started) / 1000), bytes: file.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await convexHttp.mutation(api.answerVideoRender.finish, { ticket, error: message.slice(0, 300) }).catch(() => {});
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 500 });
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
