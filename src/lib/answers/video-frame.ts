/** One frame of an answer video (P398): the segment's heading and on-screen points, the business's screenshot on the
 * segment that shows it, the address, and a progress bar. Drawn on a 1280x720 canvas in the owner's browser. */
export type FrameKit = { segments: ReadonlyArray<{ heading: string; lines: readonly string[] }>; productSegment: number; business: { domain: string } };

export const VIDEO_W = 1280, VIDEO_H = 720;
const W = VIDEO_W, H = VIDEO_H;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export function drawFrame(ctx: CanvasRenderingContext2D, kit: FrameKit, index: number, progress: number, shot: HTMLImageElement | null) {
  const seg = kit.segments[index];
  ctx.fillStyle = "#0B0C0E";
  ctx.fillRect(0, 0, W, H);
  const withShot = index === kit.productSegment && shot !== null;
  const textWidth = withShot ? 480 : 1040;
  ctx.fillStyle = "#F7F8F8";
  ctx.font = `600 ${index === 0 ? 56 : 48}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  let y = index === 0 ? 250 : 150;
  for (const line of wrap(ctx, seg.heading, textWidth).slice(0, 4)) { ctx.fillText(line, 120, y); y += index === 0 ? 70 : 60; }
  ctx.font = `400 32px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = "#B4B8C0";
  y += 24;
  for (const point of seg.lines) {
    const lines = wrap(ctx, point, textWidth - 40).slice(0, 2);
    ctx.fillStyle = "#3DA5F5";
    ctx.fillRect(120, y - 22, 10, 10);
    ctx.fillStyle = "#B4B8C0";
    for (const l of lines) { ctx.fillText(l, 150, y); y += 44; }
    y += 10;
  }
  if (withShot && shot) {
    const boxW = 600, boxH = Math.min(440, Math.round((shot.naturalHeight / shot.naturalWidth) * boxW));
    const x = 600 + 40, top = Math.round((H - boxH) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, top, boxW, boxH, 14);
    ctx.clip();
    const scale = boxW / shot.naturalWidth;
    ctx.drawImage(shot, 0, 0, shot.naturalWidth, boxH / scale, x, top, boxW, boxH);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, top, boxW, boxH, 14);
    ctx.stroke();
  }
  ctx.font = `500 24px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = "#8A8F98";
  ctx.fillText(kit.business.domain, 120, H - 56);
  ctx.fillStyle = "rgba(255,255,255,.08)";
  ctx.fillRect(0, H - 6, W, 6);
  ctx.fillStyle = "#3DA5F5";
  ctx.fillRect(0, H - 6, Math.round(W * Math.min(1, progress)), 6);
}

